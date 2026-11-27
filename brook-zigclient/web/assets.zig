const std = @import("std");

pub const Asset = struct {
    path: []const u8,
    content_type: []const u8,
    data: []const u8,
};

pub const assets = [_]Asset{
    .{ .path = "/", .content_type = "text/html; charset=utf-8", .data = @embedFile("index.html") },
    .{ .path = "/index.html", .content_type = "text/html; charset=utf-8", .data = @embedFile("index.html") },
    .{ .path = "/app.js", .content_type = "application/javascript; charset=utf-8", .data = @embedFile("app.js") },
    .{ .path = "/styles.css", .content_type = "text/css; charset=utf-8", .data = @embedFile("styles.css") },
    .{ .path = "/icons/icon.svg", .content_type = "image/svg+xml", .data = @embedFile("icons/icon.svg") },

    // Core
    .{ .path = "/src/core/brook-crypto.js", .content_type = "application/javascript; charset=utf-8", .data = @embedFile("src/core/brook-crypto.js") },
    .{ .path = "/src/core/brook-framing.js", .content_type = "application/javascript; charset=utf-8", .data = @embedFile("src/core/brook-framing.js") },
    .{ .path = "/src/core/brook-tunnel.js", .content_type = "application/javascript; charset=utf-8", .data = @embedFile("src/core/brook-tunnel.js") },
    .{ .path = "/src/core/byte-utils.js", .content_type = "application/javascript; charset=utf-8", .data = @embedFile("src/core/byte-utils.js") },
    .{ .path = "/src/core/dns-resolver.js", .content_type = "application/javascript; charset=utf-8", .data = @embedFile("src/core/dns-resolver.js") },
    .{ .path = "/src/core/network-monitor.js", .content_type = "application/javascript; charset=utf-8", .data = @embedFile("src/core/network-monitor.js") },

    // Protocols
    .{ .path = "/src/protocols/http-proxy-parser.js", .content_type = "application/javascript; charset=utf-8", .data = @embedFile("src/protocols/http-proxy-parser.js") },
    .{ .path = "/src/protocols/protocol-detector.js", .content_type = "application/javascript; charset=utf-8", .data = @embedFile("src/protocols/protocol-detector.js") },
    .{ .path = "/src/protocols/socks5-parser.js", .content_type = "application/javascript; charset=utf-8", .data = @embedFile("src/protocols/socks5-parser.js") },

    // Server / Bridge
    .{ .path = "/src/server/proxy-dispatcher.js", .content_type = "application/javascript; charset=utf-8", .data = @embedFile("src/server/proxy-dispatcher.js") },
    .{ .path = "/src/server/session-tracker.js", .content_type = "application/javascript; charset=utf-8", .data = @embedFile("src/server/session-tracker.js") },
    .{ .path = "/src/server/tcp-listener.js", .content_type = "application/javascript; charset=utf-8", .data = @embedFile("src/server/tcp-listener.js") },
    .{ .path = "/src/server/ws-bridge-client.js", .content_type = "application/javascript; charset=utf-8", .data = @embedFile("src/server/ws-bridge-client.js") },

    // UI
    .{ .path = "/src/ui/dom-builder.js", .content_type = "application/javascript; charset=utf-8", .data = @embedFile("src/ui/dom-builder.js") },
    .{ .path = "/src/ui/log-stream.js", .content_type = "application/javascript; charset=utf-8", .data = @embedFile("src/ui/log-stream.js") },
    .{ .path = "/src/ui/trusted-types-policy.js", .content_type = "application/javascript; charset=utf-8", .data = @embedFile("src/ui/trusted-types-policy.js") },
    .{ .path = "/src/ui/ui-controller.js", .content_type = "application/javascript; charset=utf-8", .data = @embedFile("src/ui/ui-controller.js") },

    // WebTransport / WS Fallback
    .{ .path = "/src/webtransport/ws-connection-manager.js", .content_type = "application/javascript; charset=utf-8", .data = @embedFile("src/webtransport/ws-connection-manager.js") },
    .{ .path = "/src/webtransport/wt-connection-manager.js", .content_type = "application/javascript; charset=utf-8", .data = @embedFile("src/webtransport/wt-connection-manager.js") },
    .{ .path = "/src/webtransport/wt-stream-adapter.js", .content_type = "application/javascript; charset=utf-8", .data = @embedFile("src/webtransport/wt-stream-adapter.js") },

    // Dedicated Proxy Engine Web Worker
    .{ .path = "/src/workers/proxy-engine.worker.js", .content_type = "application/javascript; charset=utf-8", .data = @embedFile("src/workers/proxy-engine.worker.js") },
};

pub fn lookup(raw_path: []const u8) ?Asset {
    // Strip query string if present
    const path = if (std.mem.indexOfScalar(u8, raw_path, '?')) |idx| raw_path[0..idx] else raw_path;
    for (assets) |a| {
        if (std.mem.eql(u8, a.path, path)) return a;
    }
    return null;
}
