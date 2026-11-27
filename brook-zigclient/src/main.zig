const std = @import("std");
const builtin = @import("builtin");
const web_assets = @import("web_assets");
const config_mod = @import("config.zig");
const ws = @import("ws.zig");
const bridge = @import("bridge.zig");

const AppContext = struct {
    allocator: std.mem.Allocator,
    io: std.Io,
    http_port: u16,
    token: [32]u8,
    config_store: *config_mod.ConfigStore,
    hub: *bridge.BridgeHub,
};

pub fn main(init: std.process.Init) !void {
    const gpa = init.gpa;
    const io = init.io;

    const cli = config_mod.parseArgs(gpa, init.minimal.args) catch |err| {
        std.debug.print("Error parsing CLI arguments: {s}\n", .{@errorName(err)});
        config_mod.printHelp();
        return;
    };

    if (cli.show_help) {
        config_mod.printHelp();
        return;
    }

    var cfg_store = try config_mod.ConfigStore.init(gpa, io, init.environ_map, cli);
    defer cfg_store.deinit();

    // Generate cryptographically random 128-bit hex session token
    var raw_token: [16]u8 = undefined;
    io.randomSecure(&raw_token) catch {
        io.random(&raw_token);
    };
    const token_hex = std.fmt.bytesToHex(raw_token, .lower);

    // Bind local HTTP + WebSocket server on 127.0.0.1:<random-port>
    const bind_addr = try std.Io.net.IpAddress.parseIp4("127.0.0.1", cli.http_port);
    var http_server = try bind_addr.listen(io, .{
        .reuse_address = true,
        .kernel_backlog = 128,
    });
    defer http_server.deinit(io);

    const actual_http_port = http_server.socket.address.getPort();
    var hub = bridge.BridgeHub.init(io);

    var ctx = AppContext{
        .allocator = gpa,
        .io = io,
        .http_port = actual_http_port,
        .token = token_hex,
        .config_store = &cfg_store,
        .hub = &hub,
    };

    var url_buf: [256]u8 = undefined;
    const ui_url = try std.fmt.bufPrint(&url_buf, "http://127.0.0.1:{d}/?token={s}", .{
        actual_http_port,
        token_hex[0..],
    });

    std.debug.print(
        \\
        \\================================================================
        \\  Brook Zig Client v1.0.0 (Native TCP Bridge + Web Worker)
        \\================================================================
        \\  UI URL:      {s}
        \\  Config File: {s}
        \\  Press Ctrl+C to stop.
        \\================================================================
        \\
    , .{ ui_url, cfg_store.file_path });

    if (!cli.no_open) {
        openBrowser(io, ui_url, cli.app_mode);
    }

    // Main HTTP/WS accept loop
    while (true) {
        const stream = http_server.accept(io) catch |err| {
            std.debug.print("[http] accept error: {s}\n", .{@errorName(err)});
            io.sleep(std.Io.Duration.fromMilliseconds(50), .awake) catch {};
            continue;
        };

        const conn_args = gpa.create(ConnTaskArgs) catch {
            stream.close(io);
            continue;
        };
        conn_args.* = .{
            .ctx = &ctx,
            .stream = stream,
        };

        const t = std.Thread.spawn(.{}, handleConnection, .{conn_args}) catch {
            stream.close(io);
            gpa.destroy(conn_args);
            continue;
        };
        t.detach();
    }
}

const ConnTaskArgs = struct {
    ctx: *AppContext,
    stream: std.Io.net.Stream,
};

fn handleConnection(args: *ConnTaskArgs) void {
    const ctx = args.ctx;
    const stream = args.stream;
    ctx.allocator.destroy(args);

    var rbuf: [16 * 1024]u8 = undefined;
    var wbuf: [16 * 1024]u8 = undefined;
    var net_reader = stream.reader(ctx.io, &rbuf);
    var net_writer = stream.writer(ctx.io, &wbuf);
    var http_srv = std.http.Server.init(&net_reader.interface, &net_writer.interface);

    var upgraded_to_ws = false;
    defer if (!upgraded_to_ws) {
        stream.close(ctx.io);
    };

    while (true) {
        var req = http_srv.receiveHead() catch return;

        const target = req.head.target;
        const path = stripQuery(target);

        // 1. WebSocket upgrade endpoint: GET /ws?token=<hex>
        if (std.mem.eql(u8, path, "/ws")) {
            if (!isTokenValid(target, &ctx.token) or !isOriginAllowed(req.head_buffer, ctx.http_port)) {
                sendSimpleResponse(&req, .forbidden, "text/plain", "Forbidden: invalid token or origin") catch {};
                return;
            }

            const sec_key = findHeaderValue(req.head_buffer, "sec-websocket-key") orelse {
                sendSimpleResponse(&req, .bad_request, "text/plain", "Missing Sec-WebSocket-Key") catch {};
                return;
            };

            var accept_buf: [28]u8 = undefined;
            const accept_key = ws.computeAcceptKey(sec_key, &accept_buf);

            var resp_buf: [256]u8 = undefined;
            const handshake = std.fmt.bufPrint(
                &resp_buf,
                "HTTP/1.1 101 Switching Protocols\r\n" ++
                    "Upgrade: websocket\r\n" ++
                    "Connection: Upgrade\r\n" ++
                    "Sec-WebSocket-Accept: {s}\r\n\r\n",
                .{accept_key},
            ) catch return;

            net_writer.interface.writeAll(handshake) catch return;
            net_writer.interface.flush() catch return;

            upgraded_to_ws = true;
            serveWebSocketSession(ctx, stream, &net_reader.interface);
            return;
        }

        // 2. Config persistence API: GET / POST /api/config?token=<hex>
        if (std.mem.eql(u8, path, "/api/config")) {
            if (!isTokenValid(target, &ctx.token) or !isOriginAllowed(req.head_buffer, ctx.http_port)) {
                sendSimpleResponse(&req, .forbidden, "text/plain", "Forbidden") catch {};
                return;
            }

            if (req.head.method == .GET) {
                const json_body = ctx.config_store.toJsonAlloc(ctx.allocator) catch {
                    sendSimpleResponse(&req, .internal_server_error, "text/plain", "Internal Error") catch {};
                    return;
                };
                defer ctx.allocator.free(json_body);
                sendSimpleResponse(&req, .ok, "application/json; charset=utf-8", json_body) catch return;
            } else if (req.head.method == .POST) {
                var body_buf: [16 * 1024]u8 = undefined;
                const body_reader = req.readerExpectNone(&body_buf);
                const body = body_reader.allocRemaining(ctx.allocator, .limited(64 * 1024)) catch {
                    sendSimpleResponse(&req, .bad_request, "text/plain", "Invalid body") catch {};
                    return;
                };
                defer ctx.allocator.free(body);

                ctx.config_store.updateFromJson(body) catch {
                    sendSimpleResponse(&req, .bad_request, "text/plain", "Invalid JSON config") catch {};
                    return;
                };
                sendSimpleResponse(&req, .ok, "application/json; charset=utf-8", "{\"ok\":true}") catch return;
            } else {
                sendSimpleResponse(&req, .method_not_allowed, "text/plain", "Method Not Allowed") catch {};
            }

            if (!req.head.keep_alive) return;
            continue;
        }

        // 3. Health probe: GET /api/health
        if (std.mem.eql(u8, path, "/api/health")) {
            sendSimpleResponse(&req, .ok, "application/json; charset=utf-8", "{\"ok\":true,\"version\":\"1.0.0\"}") catch return;
            if (!req.head.keep_alive) return;
            continue;
        }

        // 4. Embedded static web UI assets
        if (req.head.method == .GET or req.head.method == .HEAD) {
            if (web_assets.lookup(path)) |asset| {
                const body = if (req.head.method == .HEAD) "" else asset.data;
                req.respond(body, .{
                    .status = .ok,
                    .extra_headers = &.{
                        .{ .name = "content-type", .value = asset.content_type },
                        .{ .name = "cache-control", .value = "no-store" },
                    },
                }) catch return;
                if (!req.head.keep_alive) return;
                continue;
            }
        }

        sendSimpleResponse(&req, .not_found, "text/plain; charset=utf-8", "Not Found") catch return;
        if (!req.head.keep_alive) return;
    }
}

fn serveWebSocketSession(ctx: *AppContext, stream: std.Io.net.Stream, reader: *std.Io.Reader) void {
    var ws_conn = ws.WsConn.init(stream, ctx.io);
    ctx.hub.replaceActive(&ws_conn);
    defer {
        ws_conn.close();
        ctx.hub.clearIfActive(&ws_conn);
    }

    const session = bridge.BridgeSession.create(ctx.allocator, ctx.io, &ws_conn) catch return;
    defer session.destroy();

    std.debug.print("[ws] Browser Web Worker bridge connected\n", .{});

    session.sendReady(ctx.http_port, ctx.config_store) catch return;

    while (!ws_conn.isClosed()) {
        const msg = ws.readMessage(reader, ctx.allocator) catch break;
        defer ctx.allocator.free(msg.payload);

        switch (msg.opcode) {
            .text => session.handleControlText(msg.payload),
            .binary => session.handleBinaryFrame(msg.payload),
            .ping => ws_conn.sendPong(msg.payload) catch break,
            .pong => {},
            .close => {
                ws_conn.sendClose();
                break;
            },
            else => {},
        }
    }

    std.debug.print("[ws] Browser Web Worker bridge disconnected — cleaning up local listeners\n", .{});
}

fn sendSimpleResponse(
    req: *std.http.Server.Request,
    status: std.http.Status,
    content_type: []const u8,
    body: []const u8,
) !void {
    try req.respond(body, .{
        .status = status,
        .extra_headers = &.{
            .{ .name = "content-type", .value = content_type },
            .{ .name = "cache-control", .value = "no-store" },
        },
    });
}

fn stripQuery(target: []const u8) []const u8 {
    if (std.mem.indexOfScalar(u8, target, '?')) |idx| {
        return target[0..idx];
    }
    return target;
}

fn extractQueryParam(target: []const u8, name: []const u8) ?[]const u8 {
    const q_idx = std.mem.indexOfScalar(u8, target, '?') orelse return null;
    const query = target[q_idx + 1 ..];
    var it = std.mem.splitScalar(u8, query, '&');
    while (it.next()) |pair| {
        const eq = std.mem.indexOfScalar(u8, pair, '=') orelse continue;
        if (std.mem.eql(u8, pair[0..eq], name)) {
            return pair[eq + 1 ..];
        }
    }
    return null;
}

fn isTokenValid(target: []const u8, expected: []const u8) bool {
    const provided = extractQueryParam(target, "token") orelse return false;
    if (provided.len != expected.len) return false;
    var diff: u8 = 0;
    for (provided, expected) |a, b| {
        diff |= a ^ b;
    }
    return diff == 0;
}

fn findHeaderValue(head_buffer: []const u8, header_name_lower: []const u8) ?[]const u8 {
    var lines = std.mem.splitSequence(u8, head_buffer, "\r\n");
    _ = lines.next(); // request line
    while (lines.next()) |line| {
        if (line.len == 0) break;
        const colon = std.mem.indexOfScalar(u8, line, ':') orelse continue;
        const name = std.mem.trim(u8, line[0..colon], " \t");
        if (std.ascii.eqlIgnoreCase(name, header_name_lower)) {
            return std.mem.trim(u8, line[colon + 1 ..], " \t");
        }
    }
    return null;
}

fn isOriginAllowed(head_buffer: []const u8, http_port: u16) bool {
    const origin = findHeaderValue(head_buffer, "origin") orelse return true;
    var buf1: [64]u8 = undefined;
    var buf2: [64]u8 = undefined;
    const allowed1 = std.fmt.bufPrint(&buf1, "http://127.0.0.1:{d}", .{http_port}) catch return false;
    const allowed2 = std.fmt.bufPrint(&buf2, "http://localhost:{d}", .{http_port}) catch return false;
    return std.ascii.eqlIgnoreCase(origin, allowed1) or std.ascii.eqlIgnoreCase(origin, allowed2);
}

fn openBrowser(io: std.Io, url: []const u8, app_mode: bool) void {
    var app_arg_buf: [300]u8 = undefined;
    const app_arg = std.fmt.bufPrint(&app_arg_buf, "--app={s}", .{url}) catch null;

    if (builtin.os.tag == .windows) {
        if (app_mode and app_arg != null) {
            const win_browsers = [_][]const u8{
                "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
                "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
                "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
                "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
            };
            for (win_browsers) |bin| {
                if (spawnDetached(io, &.{ bin, app_arg.? })) return;
            }
        }
        _ = spawnDetached(io, &.{ "cmd.exe", "/c", "start", "", url });
    } else if (builtin.os.tag == .macos) {
        _ = spawnDetached(io, &.{ "open", url });
    } else {
        if (app_mode and app_arg != null) {
            const linux_browsers = [_][]const u8{ "google-chrome", "chromium", "chromium-browser", "microsoft-edge" };
            for (linux_browsers) |bin| {
                if (spawnDetached(io, &.{ bin, app_arg.? })) return;
            }
        }
        _ = spawnDetached(io, &.{ "xdg-open", url });
    }
}

fn spawnDetached(io: std.Io, argv: []const []const u8) bool {
    _ = std.process.spawn(io, .{
        .argv = argv,
        .stdin = .ignore,
        .stdout = .ignore,
        .stderr = .ignore,
        .create_no_window = true,
    }) catch return false;
    return true;
}

test {
    _ = ws;
    _ = config_mod;
    _ = bridge;
}
