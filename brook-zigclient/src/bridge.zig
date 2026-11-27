const std = @import("std");
const ws = @import("ws.zig");
const config_mod = @import("config.zig");

pub const FRAME_ACCEPT: u8 = 0x01;
pub const FRAME_DATA: u8 = 0x02;
pub const FRAME_FIN: u8 = 0x03;
pub const FRAME_RST: u8 = 0x04;
pub const FRAME_WINDOW: u8 = 0x05;

const INITIAL_SEND_CREDIT: i64 = 1024 * 1024; // 1 MiB per TCP connection
const TCP_READ_CHUNK: usize = 32 * 1024;

const TcpConn = struct {
    id: u32,
    listener_id: []u8,
    stream: std.Io.net.Stream,
    session: *BridgeSession,
    mutex: std.Io.Mutex = .init,
    credit_cond: std.Io.Condition = .init,
    send_credit: i64 = INITIAL_SEND_CREDIT,
    closed: bool = false,
    ref_count: std.atomic.Value(u32) = .init(2), // 1 for session map, 1 for reader thread

    fn retain(self: *TcpConn) void {
        _ = self.ref_count.fetchAdd(1, .monotonic);
    }

    fn release(self: *TcpConn) void {
        if (self.ref_count.fetchSub(1, .acq_rel) == 1) {
            const alloc = self.session.allocator;
            const io = self.session.io;
            self.stream.close(io);
            alloc.free(self.listener_id);
            alloc.destroy(self);
        }
    }

    fn forceClose(self: *TcpConn) void {
        const io = self.session.io;
        self.mutex.lockUncancelable(io);
        const already = self.closed;
        self.closed = true;
        self.credit_cond.broadcast(io);
        self.mutex.unlock(io);
        if (!already) {
            self.stream.shutdown(io, .both) catch {};
        }
    }

    fn addCredit(self: *TcpConn, delta: u32) void {
        const io = self.session.io;
        self.mutex.lockUncancelable(io);
        self.send_credit += @as(i64, delta);
        self.credit_cond.signal(io);
        self.mutex.unlock(io);
    }
};

const ListenerEntry = struct {
    id: []u8,
    bound_addr: std.Io.net.IpAddress,
    server: std.Io.net.Server,
    session: *BridgeSession,
    stopped: std.atomic.Value(bool) = .init(false),
    thread: ?std.Thread = null,

    fn stop(self: *ListenerEntry) void {
        if (self.stopped.swap(true, .acq_rel)) return;
        const io = self.session.io;
        // Shutdown + self-connect wakeup ensures accept() unblocks promptly on both Linux and Windows
        var wake_addr = self.bound_addr;
        self.server.socket.close(io);
        if (wake_addr.connect(io, .{ .mode = .stream })) |s| {
            s.close(io);
        } else |_| {}
    }

    fn deinitAndFree(self: *ListenerEntry) void {
        self.stop();
        if (self.thread) |t| {
            t.join();
            self.thread = null;
        }
        const alloc = self.session.allocator;
        alloc.free(self.id);
        alloc.destroy(self);
    }
};

pub const BridgeSession = struct {
    allocator: std.mem.Allocator,
    io: std.Io,
    ws_conn: *ws.WsConn,
    mutex: std.Io.Mutex = .init,
    listeners: std.StringHashMapUnmanaged(*ListenerEntry) = .empty,
    conns: std.AutoHashMapUnmanaged(u32, *TcpConn) = .empty,
    next_conn_id: std.atomic.Value(u32) = .init(1),
    stopping: std.atomic.Value(bool) = .init(false),

    pub fn create(allocator: std.mem.Allocator, io: std.Io, ws_conn: *ws.WsConn) !*BridgeSession {
        const sess = try allocator.create(BridgeSession);
        sess.* = .{
            .allocator = allocator,
            .io = io,
            .ws_conn = ws_conn,
        };
        return sess;
    }

    pub fn closeAll(self: *BridgeSession) void {
        self.stopping.store(true, .release);

        // Detach all listeners first
        var to_free_listeners: std.ArrayList(*ListenerEntry) = .empty;
        defer to_free_listeners.deinit(self.allocator);

        // Detach all TCP connections
        var to_close_conns: std.ArrayList(*TcpConn) = .empty;
        defer to_close_conns.deinit(self.allocator);

        self.mutex.lockUncancelable(self.io);
        {
            var lit = self.listeners.valueIterator();
            while (lit.next()) |lp| {
                to_free_listeners.append(self.allocator, lp.*) catch {};
            }
            self.listeners.clearRetainingCapacity();

            var cit = self.conns.valueIterator();
            while (cit.next()) |cp| {
                to_close_conns.append(self.allocator, cp.*) catch {};
            }
            self.conns.clearRetainingCapacity();
        }
        self.mutex.unlock(self.io);

        for (to_free_listeners.items) |l| {
            l.deinitAndFree();
        }

        for (to_close_conns.items) |c| {
            c.forceClose();
            c.release(); // drop session map ref
        }
    }

    pub fn destroy(self: *BridgeSession) void {
        self.closeAll();
        self.listeners.deinit(self.allocator);
        self.conns.deinit(self.allocator);
        self.allocator.destroy(self);
    }

    pub fn sendReady(self: *BridgeSession, http_port: u16, cfg_store: *config_mod.ConfigStore) !void {
        const cfg_json = try cfg_store.toJsonAlloc(self.allocator);
        defer self.allocator.free(cfg_json);

        const payload = try std.fmt.allocPrint(
            self.allocator,
            "{{\"type\":\"ready\",\"version\":\"1.0.0\",\"httpPort\":{d},\"autoStart\":{s},\"config\":{s}}}",
            .{ http_port, if (cfg_store.auto_start) "true" else "false", cfg_json },
        );
        defer self.allocator.free(payload);
        try self.ws_conn.sendText(payload);
    }

    pub fn handleControlText(self: *BridgeSession, text: []const u8) void {
        const ControlMsg = struct {
            type: []const u8,
            id: ?[]const u8 = null,
            host: ?[]const u8 = null,
            port: ?u16 = null,
            closeActive: ?bool = null,
        };

        const parsed = std.json.parseFromSlice(ControlMsg, self.allocator, text, .{
            .ignore_unknown_fields = true,
        }) catch return;
        defer parsed.deinit();

        const msg = parsed.value;
        if (std.mem.eql(u8, msg.type, "ping")) {
            self.ws_conn.sendText("{\"type\":\"pong\"}") catch {};
        } else if (std.mem.eql(u8, msg.type, "listen")) {
            const id = msg.id orelse return;
            const host = msg.host orelse "127.0.0.1";
            const port = msg.port orelse 0;
            self.startListener(id, host, port);
        } else if (std.mem.eql(u8, msg.type, "unlisten")) {
            const id = msg.id orelse return;
            const close_active = msg.closeActive orelse true;
            self.stopListener(id, close_active);
        }
    }

    fn startListener(self: *BridgeSession, id: []const u8, host: []const u8, port: u16) void {
        // Stop existing listener with same ID if any
        self.stopListener(id, true);

        const bind_host = if (host.len == 0) "127.0.0.1" else host;
        const addr = std.Io.net.IpAddress.parse(bind_host, port) catch
            (std.Io.net.IpAddress.parseIp4("127.0.0.1", port) catch unreachable);

        const server = addr.listen(self.io, .{
            .reuse_address = true,
            .kernel_backlog = 128,
        }) catch |err| {
            self.sendListenError(id, @errorName(err));
            return;
        };

        const actual_port = server.socket.address.getPort();
        const id_copy = self.allocator.dupe(u8, id) catch {
            var s = server;
            s.deinit(self.io);
            self.sendListenError(id, "OutOfMemory");
            return;
        };

        const entry = self.allocator.create(ListenerEntry) catch {
            self.allocator.free(id_copy);
            var s = server;
            s.deinit(self.io);
            self.sendListenError(id, "OutOfMemory");
            return;
        };
        entry.* = .{
            .id = id_copy,
            .bound_addr = server.socket.address,
            .server = server,
            .session = self,
        };

        const thread = std.Thread.spawn(.{}, acceptLoop, .{entry}) catch |err| {
            var s = server;
            s.deinit(self.io);
            self.allocator.free(id_copy);
            self.allocator.destroy(entry);
            self.sendListenError(id, @errorName(err));
            return;
        };
        entry.thread = thread;

        self.mutex.lockUncancelable(self.io);
        self.listeners.put(self.allocator, entry.id, entry) catch {
            self.mutex.unlock(self.io);
            entry.deinitAndFree();
            self.sendListenError(id, "OutOfMemory");
            return;
        };
        self.mutex.unlock(self.io);

        std.debug.print("[bridge] TCP listener '{s}' bound on {s}:{d}\n", .{ id, bind_host, actual_port });

        const resp = std.fmt.allocPrint(
            self.allocator,
            "{{\"type\":\"listening\",\"id\":{f},\"host\":{f},\"port\":{d}}}",
            .{ std.json.fmt(id, .{}), std.json.fmt(bind_host, .{}), actual_port },
        ) catch return;
        defer self.allocator.free(resp);
        self.ws_conn.sendText(resp) catch {};
    }

    fn sendListenError(self: *BridgeSession, id: []const u8, err_msg: []const u8) void {
        const resp = std.fmt.allocPrint(
            self.allocator,
            "{{\"type\":\"listen_error\",\"id\":{f},\"error\":{f}}}",
            .{ std.json.fmt(id, .{}), std.json.fmt(err_msg, .{}) },
        ) catch return;
        defer self.allocator.free(resp);
        self.ws_conn.sendText(resp) catch {};
    }

    fn stopListener(self: *BridgeSession, id: []const u8, close_active: bool) void {
        var found: ?*ListenerEntry = null;
        var conns_to_close: std.ArrayList(*TcpConn) = .empty;
        defer conns_to_close.deinit(self.allocator);

        self.mutex.lockUncancelable(self.io);
        if (self.listeners.fetchRemove(id)) |kv| {
            found = kv.value;
        }
        if (close_active) {
            var ids_to_remove: std.ArrayList(u32) = .empty;
            defer ids_to_remove.deinit(self.allocator);

            var cit = self.conns.iterator();
            while (cit.next()) |kv| {
                if (std.mem.eql(u8, kv.value_ptr.*.listener_id, id)) {
                    ids_to_remove.append(self.allocator, kv.key_ptr.*) catch {};
                }
            }
            for (ids_to_remove.items) |cid| {
                if (self.conns.fetchRemove(cid)) |kv| {
                    conns_to_close.append(self.allocator, kv.value) catch {};
                }
            }
        }
        self.mutex.unlock(self.io);

        if (found) |l| {
            std.debug.print("[bridge] Stopping TCP listener '{s}' (closeActive={})\n", .{ l.id, close_active });
            l.deinitAndFree();
        }
        for (conns_to_close.items) |c| {
            c.forceClose();
            c.release();
        }

        const resp = std.fmt.allocPrint(
            self.allocator,
            "{{\"type\":\"unlistened\",\"id\":{f}}}",
            .{std.json.fmt(id, .{})},
        ) catch return;
        defer self.allocator.free(resp);
        self.ws_conn.sendText(resp) catch {};
    }

    pub fn handleBinaryFrame(self: *BridgeSession, data: []const u8) void {
        if (data.len < 5) return;
        const frame_type = data[0];
        const conn_id = std.mem.readInt(u32, data[1..5], .big);
        const payload = data[5..];

        switch (frame_type) {
            FRAME_DATA => {
                const conn = self.getConnRetained(conn_id) orelse {
                    self.sendBinaryHeader(FRAME_RST, conn_id);
                    return;
                };
                defer conn.release();

                if (payload.len > 0) {
                    var wbuf: [4096]u8 = undefined;
                    var writer = conn.stream.writer(self.io, &wbuf);
                    writer.interface.writeAll(payload) catch {
                        self.removeAndCloseConn(conn_id);
                        self.sendBinaryHeader(FRAME_RST, conn_id);
                        return;
                    };
                    writer.interface.flush() catch {
                        self.removeAndCloseConn(conn_id);
                        self.sendBinaryHeader(FRAME_RST, conn_id);
                        return;
                    };
                }
            },
            FRAME_FIN => {
                const conn = self.getConnRetained(conn_id) orelse return;
                defer conn.release();
                conn.stream.shutdown(self.io, .send) catch {};
            },
            FRAME_RST => {
                self.removeAndCloseConn(conn_id);
            },
            FRAME_WINDOW => {
                if (payload.len < 4) return;
                const delta = std.mem.readInt(u32, payload[0..4], .big);
                const conn = self.getConnRetained(conn_id) orelse return;
                defer conn.release();
                conn.addCredit(delta);
            },
            else => {},
        }
    }

    fn getConnRetained(self: *BridgeSession, conn_id: u32) ?*TcpConn {
        self.mutex.lockUncancelable(self.io);
        defer self.mutex.unlock(self.io);
        const conn = self.conns.get(conn_id) orelse return null;
        conn.retain();
        return conn;
    }

    fn removeAndCloseConn(self: *BridgeSession, conn_id: u32) void {
        var removed: ?*TcpConn = null;
        self.mutex.lockUncancelable(self.io);
        if (self.conns.fetchRemove(conn_id)) |kv| {
            removed = kv.value;
        }
        self.mutex.unlock(self.io);

        if (removed) |c| {
            c.forceClose();
            c.release();
        }
    }

    fn removeConnIfPresent(self: *BridgeSession, conn_id: u32) void {
        var removed: ?*TcpConn = null;
        self.mutex.lockUncancelable(self.io);
        if (self.conns.fetchRemove(conn_id)) |kv| {
            removed = kv.value;
        }
        self.mutex.unlock(self.io);

        if (removed) |c| {
            c.release();
        }
    }

    fn sendBinaryHeader(self: *BridgeSession, frame_type: u8, conn_id: u32) void {
        var frame: [5]u8 = undefined;
        frame[0] = frame_type;
        std.mem.writeInt(u32, frame[1..5], conn_id, .big);
        self.ws_conn.sendBinary(&frame) catch {};
    }

    fn sendAcceptFrame(self: *BridgeSession, conn_id: u32, listener_id: []const u8, remote_addr: std.Io.net.IpAddress) !void {
        var ip_buf: [64]u8 = undefined;
        const ip_str = switch (remote_addr) {
            .ip4 => |ip4| std.fmt.bufPrint(&ip_buf, "{d}.{d}.{d}.{d}", .{
                ip4.bytes[0], ip4.bytes[1], ip4.bytes[2], ip4.bytes[3],
            }) catch "127.0.0.1",
            .ip6 => "::1",
        };
        const remote_port = remote_addr.getPort();

        const id_len: usize = @min(listener_id.len, 255);
        const ip_len: usize = @min(ip_str.len, 255);
        const total = 5 + 1 + id_len + 1 + ip_len + 2;

        var frame_buf: [512]u8 = undefined;
        frame_buf[0] = FRAME_ACCEPT;
        std.mem.writeInt(u32, frame_buf[1..5], conn_id, .big);
        frame_buf[5] = @intCast(id_len);
        @memcpy(frame_buf[6 .. 6 + id_len], listener_id[0..id_len]);
        frame_buf[6 + id_len] = @intCast(ip_len);
        @memcpy(frame_buf[7 + id_len .. 7 + id_len + ip_len], ip_str[0..ip_len]);
        std.mem.writeInt(u16, frame_buf[7 + id_len + ip_len ..][0..2], remote_port, .big);

        try self.ws_conn.sendBinary(frame_buf[0..total]);
    }
};

fn acceptLoop(entry: *ListenerEntry) void {
    const sess = entry.session;
    const io = sess.io;

    while (!entry.stopped.load(.acquire) and !sess.stopping.load(.acquire)) {
        const stream = entry.server.accept(io) catch {
            if (entry.stopped.load(.acquire) or sess.stopping.load(.acquire)) break;
            io.sleep(std.Io.Duration.fromMilliseconds(20), .awake) catch {};
            continue;
        };

        if (entry.stopped.load(.acquire) or sess.stopping.load(.acquire)) {
            stream.close(io);
            break;
        }

        const conn_id = sess.next_conn_id.fetchAdd(1, .monotonic);
        const lid_copy = sess.allocator.dupe(u8, entry.id) catch {
            stream.close(io);
            continue;
        };

        const conn = sess.allocator.create(TcpConn) catch {
            sess.allocator.free(lid_copy);
            stream.close(io);
            continue;
        };
        conn.* = .{
            .id = conn_id,
            .listener_id = lid_copy,
            .stream = stream,
            .session = sess,
        };

        sess.mutex.lockUncancelable(io);
        if (sess.stopping.load(.acquire)) {
            sess.mutex.unlock(io);
            conn.release();
            conn.release();
            break;
        }
        sess.conns.put(sess.allocator, conn_id, conn) catch {
            sess.mutex.unlock(io);
            conn.release();
            conn.release();
            continue;
        };
        sess.mutex.unlock(io);

        // Notify Worker before spawning TCP reader so ACCEPT always precedes DATA
        sess.sendAcceptFrame(conn_id, entry.id, stream.socket.address) catch {
            sess.removeAndCloseConn(conn_id);
            conn.release(); // reader thread wasn't spawned
            continue;
        };

        const reader_thread = std.Thread.spawn(.{}, tcpReadLoop, .{conn}) catch {
            sess.removeAndCloseConn(conn_id);
            conn.release();
            continue;
        };
        reader_thread.detach();
    }
}

fn tcpReadLoop(conn: *TcpConn) void {
    defer conn.release();
    const sess = conn.session;
    const io = sess.io;

    var frame_buf: [5 + TCP_READ_CHUNK]u8 = undefined;
    frame_buf[0] = FRAME_DATA;
    std.mem.writeInt(u32, frame_buf[1..5], conn.id, .big);

    while (!sess.stopping.load(.acquire)) {
        // Flow control: wait for send_credit if browser hasn't replenished window yet
        conn.mutex.lockUncancelable(io);
        while (conn.send_credit <= 0 and !conn.closed and !sess.stopping.load(.acquire)) {
            conn.credit_cond.wait(io, &conn.mutex) catch break;
        }
        const is_closed = conn.closed;
        conn.mutex.unlock(io);

        if (is_closed or sess.stopping.load(.acquire)) break;

        var iov = [1][]u8{frame_buf[5..]};
        const n = conn.stream.read(io, &iov) catch {
            conn.mutex.lockUncancelable(io);
            const already_closed = conn.closed;
            conn.mutex.unlock(io);
            if (!already_closed and !sess.stopping.load(.acquire)) {
                sess.sendBinaryHeader(FRAME_RST, conn.id);
            }
            sess.removeConnIfPresent(conn.id);
            return;
        };

        if (n == 0) {
            // Clean EOF from local TCP client -> send FIN
            sess.sendBinaryHeader(FRAME_FIN, conn.id);
            return;
        }

        sess.ws_conn.sendBinary(frame_buf[0 .. 5 + n]) catch {
            sess.removeConnIfPresent(conn.id);
            return;
        };

        conn.mutex.lockUncancelable(io);
        conn.send_credit -= @as(i64, @intCast(n));
        conn.mutex.unlock(io);
    }
}

/// Ensures only one active browser Web Worker session owns TCP listeners at a time.
/// Refreshing the browser tab cleanly tears down the previous WS bridge session and waits
/// until its TCP listeners are released before activating the new session.
pub const BridgeHub = struct {
    io: std.Io,
    mutex: std.Io.Mutex = .init,
    cond: std.Io.Condition = .init,
    active_ws: ?*ws.WsConn = null,

    pub fn init(io: std.Io) BridgeHub {
        return .{ .io = io };
    }

    pub fn replaceActive(self: *BridgeHub, new_ws: *ws.WsConn) void {
        self.mutex.lockUncancelable(self.io);
        defer self.mutex.unlock(self.io);

        while (self.active_ws) |old| {
            std.debug.print("[bridge] Replacing previous WebSocket bridge session (page reloaded)\n", .{});
            // Release hub mutex while closing old WS to avoid lock ordering issues
            self.mutex.unlock(self.io);
            old.sendClose();
            old.close();
            self.mutex.lockUncancelable(self.io);
            if (self.active_ws == old) {
                self.cond.wait(self.io, &self.mutex) catch break;
            }
        }
        self.active_ws = new_ws;
    }

    pub fn clearIfActive(self: *BridgeHub, ws_conn: *ws.WsConn) void {
        self.mutex.lockUncancelable(self.io);
        if (self.active_ws == ws_conn) {
            self.active_ws = null;
            self.cond.broadcast(self.io);
        }
        self.mutex.unlock(self.io);
    }
};
