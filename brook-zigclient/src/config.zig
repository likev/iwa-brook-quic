const std = @import("std");
const builtin = @import("builtin");

pub const CliOptions = struct {
    http_port: u16 = 0,
    no_open: bool = false,
    app_mode: bool = false,
    auto_start: bool = false,
    show_help: bool = false,
    config_path: ?[]const u8 = null,

    // Optional overrides on top of saved config
    server: ?[]const u8 = null,
    password: ?[]const u8 = null,
    socks5_port: ?u16 = null,
    http_proxy_port: ?u16 = null,
    auto_detect: ?bool = null,
    without_brook: ?bool = null,
};

pub const PersistedConfig = struct {
    server: []const u8 = "https://brook-quic.pplx.io:4433/brook",
    password: []const u8 = "271828brook",
    socks5Port: u16 = 10808,
    httpPort: u16 = 8080,
    autoDetect: bool = false,
    withoutBrook: bool = true,
};

pub const ConfigStore = struct {
    allocator: std.mem.Allocator,
    io: std.Io,
    mutex: std.Io.Mutex = .init,
    file_path: []u8,
    config: PersistedConfig,
    owned_server: ?[]u8 = null,
    owned_password: ?[]u8 = null,
    auto_start: bool = false,

    pub fn init(
        allocator: std.mem.Allocator,
        io: std.Io,
        environ_map: *std.process.Environ.Map,
        cli: CliOptions,
    ) !ConfigStore {
        const file_path = try resolveConfigPath(allocator, environ_map, cli.config_path);
        var store = ConfigStore{
            .allocator = allocator,
            .io = io,
            .file_path = file_path,
            .config = .{},
            .auto_start = cli.auto_start,
        };

        // Load saved config from disk if present
        store.loadFromDisk();

        // Apply CLI overrides
        if (cli.server) |s| try store.setServer(s);
        if (cli.password) |p| try store.setPassword(p);
        if (cli.socks5_port) |p| store.config.socks5Port = p;
        if (cli.http_proxy_port) |p| store.config.httpPort = p;
        if (cli.auto_detect) |v| store.config.autoDetect = v;
        if (cli.without_brook) |v| store.config.withoutBrook = v;

        return store;
    }

    pub fn deinit(self: *ConfigStore) void {
        if (self.owned_server) |s| self.allocator.free(s);
        if (self.owned_password) |p| self.allocator.free(p);
        self.allocator.free(self.file_path);
    }

    fn setServer(self: *ConfigStore, s: []const u8) !void {
        const copy = try self.allocator.dupe(u8, s);
        if (self.owned_server) |old| self.allocator.free(old);
        self.owned_server = copy;
        self.config.server = copy;
    }

    fn setPassword(self: *ConfigStore, p: []const u8) !void {
        const copy = try self.allocator.dupe(u8, p);
        if (self.owned_password) |old| self.allocator.free(old);
        self.owned_password = copy;
        self.config.password = copy;
    }

    fn loadFromDisk(self: *ConfigStore) void {
        const file = std.Io.Dir.cwd().openFile(self.io, self.file_path, .{ .mode = .read_only }) catch return;
        defer file.close(self.io);

        var buf: [16 * 1024]u8 = undefined;
        var reader = file.reader(self.io, &buf);
        const raw = reader.interface.allocRemaining(self.allocator, .limited(64 * 1024)) catch return;
        defer self.allocator.free(raw);

        const parsed = std.json.parseFromSlice(PersistedConfig, self.allocator, raw, .{
            .ignore_unknown_fields = true,
        }) catch return;
        defer parsed.deinit();

        self.setServer(parsed.value.server) catch return;
        self.setPassword(parsed.value.password) catch return;
        self.config.socks5Port = parsed.value.socks5Port;
        self.config.httpPort = parsed.value.httpPort;
        self.config.autoDetect = parsed.value.autoDetect;
        self.config.withoutBrook = parsed.value.withoutBrook;
    }

    pub fn toJsonAlloc(self: *ConfigStore, allocator: std.mem.Allocator) ![]u8 {
        self.mutex.lockUncancelable(self.io);
        defer self.mutex.unlock(self.io);
        return std.json.Stringify.valueAlloc(allocator, self.config, .{});
    }

    pub fn updateFromJson(self: *ConfigStore, body: []const u8) !void {
        const parsed = try std.json.parseFromSlice(PersistedConfig, self.allocator, body, .{
            .ignore_unknown_fields = true,
        });
        defer parsed.deinit();

        self.mutex.lockUncancelable(self.io);
        defer self.mutex.unlock(self.io);

        try self.setServer(parsed.value.server);
        try self.setPassword(parsed.value.password);
        self.config.socks5Port = parsed.value.socks5Port;
        self.config.httpPort = parsed.value.httpPort;
        self.config.autoDetect = parsed.value.autoDetect;
        self.config.withoutBrook = parsed.value.withoutBrook;

        const serialized = try std.json.Stringify.valueAlloc(self.allocator, self.config, .{ .whitespace = .indent_2 });
        defer self.allocator.free(serialized);

        // Ensure parent directory exists if path contains a directory separator
        if (std.fs.path.dirname(self.file_path)) |dir_name| {
            std.Io.Dir.cwd().createDirPath(self.io, dir_name) catch {};
        }
        std.Io.Dir.cwd().writeFile(self.io, .{
            .sub_path = self.file_path,
            .data = serialized,
        }) catch |err| {
            std.debug.print("[config] warning: failed to save config to {s}: {s}\n", .{ self.file_path, @errorName(err) });
        };
    }
};

fn resolveConfigPath(
    allocator: std.mem.Allocator,
    environ_map: *std.process.Environ.Map,
    override: ?[]const u8,
) ![]u8 {
    if (override) |p| {
        return allocator.dupe(u8, p);
    }

    if (builtin.os.tag == .windows) {
        if (environ_map.get("APPDATA")) |appdata| {
            return std.fmt.allocPrint(allocator, "{s}\\brook-zigclient\\config.json", .{appdata});
        }
        return allocator.dupe(u8, "brook-zigclient-config.json");
    } else {
        if (environ_map.get("XDG_CONFIG_HOME")) |xdg| {
            return std.fmt.allocPrint(allocator, "{s}/brook-zigclient/config.json", .{xdg});
        }
        if (environ_map.get("HOME")) |home| {
            return std.fmt.allocPrint(allocator, "{s}/.config/brook-zigclient/config.json", .{home});
        }
        return allocator.dupe(u8, "brook-zigclient-config.json");
    }
}

pub fn parseArgs(allocator: std.mem.Allocator, args: std.process.Args) !CliOptions {
    var opts: CliOptions = .{};
    var it = try std.process.Args.Iterator.initAllocator(args, allocator);
    defer it.deinit();

    _ = it.next(); // skip argv[0]

    while (it.next()) |arg| {
        if (std.mem.eql(u8, arg, "-h") or std.mem.eql(u8, arg, "--help")) {
            opts.show_help = true;
        } else if (std.mem.eql(u8, arg, "--no-open")) {
            opts.no_open = true;
        } else if (std.mem.eql(u8, arg, "--app-mode")) {
            opts.app_mode = true;
        } else if (std.mem.eql(u8, arg, "--auto-start")) {
            opts.auto_start = true;
        } else if (std.mem.eql(u8, arg, "--auto-detect")) {
            opts.auto_detect = true;
        } else if (std.mem.eql(u8, arg, "--http-port")) {
            if (it.next()) |val| {
                opts.http_port = try std.fmt.parseInt(u16, val, 10);
            }
        } else if (std.mem.eql(u8, arg, "--server")) {
            if (it.next()) |val| {
                opts.server = try allocator.dupe(u8, val);
            }
        } else if (std.mem.eql(u8, arg, "--password")) {
            if (it.next()) |val| {
                opts.password = try allocator.dupe(u8, val);
            }
        } else if (std.mem.eql(u8, arg, "--socks5")) {
            if (it.next()) |val| {
                opts.socks5_port = try std.fmt.parseInt(u16, val, 10);
            }
        } else if (std.mem.eql(u8, arg, "--http")) {
            if (it.next()) |val| {
                opts.http_proxy_port = try std.fmt.parseInt(u16, val, 10);
            }
        } else if (std.mem.eql(u8, arg, "--config")) {
            if (it.next()) |val| {
                opts.config_path = try allocator.dupe(u8, val);
            }
        }
    }

    return opts;
}

pub fn printHelp() void {
    std.debug.print(
        \\Brook Zig Client v1.0.0 — Native TCP-over-WS Bridge for WebTransport Proxy
        \\
        \\Usage:
        \\  brook-zigclient [options]
        \\
        \\Options:
        \\  --http-port <port>   Local HTTP/WS server port (default: 0 = OS random port)
        \\  --no-open            Do not auto-open the browser UI on startup
        \\  --app-mode           Prefer standalone Chrome/Edge --app window when opening browser
        \\  --auto-start         Automatically start the proxy as soon as the Web Worker connects
        \\  --server <url>       Override Brook WebTransport server URL (e.g. https://host:4433/brook)
        \\  --password <pass>    Override Brook server password
        \\  --socks5 <port>      Override local SOCKS5 listen port (e.g. 10808 or 1080)
        \\  --http <port>        Override local HTTP proxy listen port (e.g. 8080)
        \\  --auto-detect        Enable single-port SOCKS5/HTTP auto-detect mode
        \\  --config <path>      Custom JSON config file path
        \\  -h, --help           Show this help message
        \\
    , .{});
}
