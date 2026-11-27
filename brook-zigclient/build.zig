const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    const web_assets_mod = b.createModule(.{
        .root_source_file = b.path("web/assets.zig"),
    });

    const root_mod = b.createModule(.{
        .root_source_file = b.path("src/main.zig"),
        .target = target,
        .optimize = optimize,
        .imports = &.{
            .{ .name = "web_assets", .module = web_assets_mod },
        },
    });

    const exe = b.addExecutable(.{
        .name = "brook-zigclient",
        .root_module = root_mod,
    });
    b.installArtifact(exe);

    const run_cmd = b.addRunArtifact(exe);
    run_cmd.step.dependOn(b.getInstallStep());
    run_cmd.addPassthruArgs();
    const run_step = b.step("run", "Run brook-zigclient");
    run_step.dependOn(&run_cmd.step);

    // Cross-compile single static executables for Linux x86_64 and Windows 10 x86_64
    const release_step = b.step("release-all", "Build single executables for Linux x86_64 and Windows 10 x86_64");

    const ReleaseTarget = struct {
        query: std.Target.Query,
        name: []const u8,
        out_name: []const u8,
    };

    const release_targets = [_]ReleaseTarget{
        .{
            .query = .{
                .cpu_arch = .x86_64,
                .os_tag = .linux,
                .abi = .musl,
            },
            .name = "brook-zigclient-linux-x86_64",
            .out_name = "brook-zigclient-linux-x86_64",
        },
        .{
            .query = .{
                .cpu_arch = .x86_64,
                .os_tag = .windows,
                .abi = .gnu,
                .os_version_min = .{ .windows = .win10 },
            },
            .name = "brook-zigclient-windows-x86_64",
            .out_name = "brook-zigclient-windows-x86_64.exe",
        },
    };

    for (release_targets) |rt| {
        const resolved = b.resolveTargetQuery(rt.query);
        const mod = b.createModule(.{
            .root_source_file = b.path("src/main.zig"),
            .target = resolved,
            .optimize = .ReleaseFast,
            .strip = true,
            .imports = &.{
                .{ .name = "web_assets", .module = web_assets_mod },
            },
        });
        const rel_exe = b.addExecutable(.{
            .name = rt.name,
            .root_module = mod,
        });
        const install = b.addInstallArtifact(rel_exe, .{
            .dest_dir = .{ .override = .{ .custom = "release" } },
            .dest_sub_path = rt.out_name,
        });
        release_step.dependOn(&install.step);
    }

    // Unit tests
    const unit_tests = b.addTest(.{
        .root_module = root_mod,
    });
    const run_tests = b.addRunArtifact(unit_tests);
    const test_step = b.step("test", "Run Zig unit tests");
    test_step.dependOn(&run_tests.step);
}
