const std = @import("std");

pub const Opcode = enum(u4) {
    continuation = 0x0,
    text = 0x1,
    binary = 0x2,
    close = 0x8,
    ping = 0x9,
    pong = 0xA,
    _,
};

pub const Message = struct {
    opcode: Opcode,
    payload: []u8,
};

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_FRAME_PAYLOAD: usize = 8 * 1024 * 1024;

pub fn computeAcceptKey(sec_key: []const u8, out_buf: *[28]u8) []const u8 {
    var sha = std.crypto.hash.Sha1.init(.{});
    sha.update(sec_key);
    sha.update(WS_GUID);
    var digest: [20]u8 = undefined;
    sha.final(&digest);
    return std.base64.standard.Encoder.encode(out_buf, &digest);
}

pub const WsConn = struct {
    stream: std.Io.net.Stream,
    io: std.Io,
    write_mutex: std.Io.Mutex = .init,
    closed: std.atomic.Value(bool) = .init(false),

    pub fn init(stream: std.Io.net.Stream, io: std.Io) WsConn {
        return .{
            .stream = stream,
            .io = io,
        };
    }

    pub fn close(self: *WsConn) void {
        if (self.closed.swap(true, .acq_rel)) return;
        self.stream.shutdown(self.io, .both) catch {};
        self.stream.close(self.io);
    }

    pub fn isClosed(self: *const WsConn) bool {
        return self.closed.load(.acquire);
    }

    /// Thread-safe RFC 6455 server->client frame send (unmasked).
    pub fn sendFrame(self: *WsConn, opcode: Opcode, payload: []const u8) !void {
        if (self.isClosed()) return error.ConnectionClosed;

        self.write_mutex.lockUncancelable(self.io);
        defer self.write_mutex.unlock(self.io);

        if (self.isClosed()) return error.ConnectionClosed;

        var hdr: [10]u8 = undefined;
        hdr[0] = 0x80 | @as(u8, @intFromEnum(opcode));
        var hdr_len: usize = 2;

        if (payload.len < 126) {
            hdr[1] = @intCast(payload.len);
        } else if (payload.len <= 65535) {
            hdr[1] = 126;
            std.mem.writeInt(u16, hdr[2..4], @intCast(payload.len), .big);
            hdr_len = 4;
        } else {
            hdr[1] = 127;
            std.mem.writeInt(u64, hdr[2..10], @intCast(payload.len), .big);
            hdr_len = 10;
        }

        var wbuf: [4096]u8 = undefined;
        var writer = self.stream.writer(self.io, &wbuf);
        try writer.interface.writeAll(hdr[0..hdr_len]);
        if (payload.len > 0) {
            try writer.interface.writeAll(payload);
        }
        try writer.interface.flush();
    }

    pub fn sendText(self: *WsConn, text: []const u8) !void {
        return self.sendFrame(.text, text);
    }

    pub fn sendBinary(self: *WsConn, data: []const u8) !void {
        return self.sendFrame(.binary, data);
    }

    pub fn sendPong(self: *WsConn, payload: []const u8) !void {
        return self.sendFrame(.pong, payload);
    }

    pub fn sendClose(self: *WsConn) void {
        self.sendFrame(.close, &.{}) catch {};
    }
};

/// Reads the next complete WebSocket message (reassembling fragmented frames).
/// Caller owns the returned `Message.payload` allocated with `allocator`.
pub fn readMessage(reader: *std.Io.Reader, allocator: std.mem.Allocator) !Message {
    var msg_opcode: ?Opcode = null;
    var assembled: std.ArrayList(u8) = .empty;
    errdefer assembled.deinit(allocator);

    while (true) {
        var hdr2: [2]u8 = undefined;
        try reader.readSliceAll(&hdr2);

        const fin = (hdr2[0] & 0x80) != 0;
        const opcode: Opcode = @enumFromInt(@as(u4, @truncate(hdr2[0] & 0x0F)));
        const masked = (hdr2[1] & 0x80) != 0;
        var payload_len: u64 = hdr2[1] & 0x7F;

        if (payload_len == 126) {
            var ext: [2]u8 = undefined;
            try reader.readSliceAll(&ext);
            payload_len = std.mem.readInt(u16, &ext, .big);
        } else if (payload_len == 127) {
            var ext: [8]u8 = undefined;
            try reader.readSliceAll(&ext);
            payload_len = std.mem.readInt(u64, &ext, .big);
        }

        if (payload_len > MAX_FRAME_PAYLOAD or assembled.items.len + payload_len > MAX_FRAME_PAYLOAD) {
            return error.MessageTooLarge;
        }

        var mask_key: [4]u8 = .{ 0, 0, 0, 0 };
        if (masked) {
            try reader.readSliceAll(&mask_key);
        }

        const plen: usize = @intCast(payload_len);

        // Control frames (ping/pong/close) can arrive in the middle of fragmented data frames
        if (@intFromEnum(opcode) >= 0x8) {
            const ctrl = try allocator.alloc(u8, plen);
            errdefer allocator.free(ctrl);
            if (plen > 0) {
                try reader.readSliceAll(ctrl);
                if (masked) unmask(ctrl, mask_key);
            }
            return .{ .opcode = opcode, .payload = ctrl };
        }

        if (opcode != .continuation) {
            msg_opcode = opcode;
        } else if (msg_opcode == null) {
            return error.ProtocolError;
        }

        const start = assembled.items.len;
        try assembled.resize(allocator, start + plen);
        if (plen > 0) {
            const slice = assembled.items[start .. start + plen];
            try reader.readSliceAll(slice);
            if (masked) unmask(slice, mask_key);
        }

        if (fin) {
            return .{
                .opcode = msg_opcode orelse .binary,
                .payload = try assembled.toOwnedSlice(allocator),
            };
        }
    }
}

fn unmask(buf: []u8, key: [4]u8) void {
    for (buf, 0..) |*b, i| {
        b.* ^= key[i & 3];
    }
}

test "RFC 6455 Sec-WebSocket-Accept calculation" {
    var out: [28]u8 = undefined;
    const accept = computeAcceptKey("dGhlIHNhbXBsZSBub25jZQ==", &out);
    try std.testing.expectEqualStrings("s3pPLMBiTxaQ9kYGzzhZRbK+xOo=", accept);
}
