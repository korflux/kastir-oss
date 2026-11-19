import { afterEach, describe, expect, it, vi } from "vitest";

import {
  parseConfigGetValue,
  runBootstrap,
} from "../scripts/bootstrap-runtime";

function baseDeps() {
  return {
    bootstrapMaster: vi.fn().mockResolvedValue(undefined),
    reconcilePublishedSite: vi
      .fn()
      .mockResolvedValue({ checked: 0, missing: 0, rebuilt: false }),
    reconcileMedia: vi.fn().mockResolvedValue({ checked: 0, missing: 0 }),
    reconcileStuckMedia: vi.fn().mockResolvedValue({ checked: 0, failed: 0 }),
    checkRedisMaxmemoryPolicy: vi
      .fn()
      .mockResolvedValue({ policy: "noeviction" }),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };
}

describe("bootstrap runtime", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs the shared bootstrap and disconnects Prisma after success", async () => {
    const deps = baseDeps();

    await runBootstrap(deps);

    expect(deps.bootstrapMaster).toHaveBeenCalledOnce();
    expect(deps.reconcilePublishedSite).toHaveBeenCalledOnce();
    expect(deps.reconcileMedia).toHaveBeenCalledOnce();
    expect(deps.reconcileStuckMedia).toHaveBeenCalledOnce();
    expect(deps.disconnect).toHaveBeenCalledOnce();
  });

  it("disconnects Prisma when the shared bootstrap fails", async () => {
    const bootstrapError = new Error("bootstrap failed");
    const deps = baseDeps();
    deps.bootstrapMaster.mockRejectedValue(bootstrapError);

    await expect(runBootstrap(deps)).rejects.toBe(bootstrapError);
    expect(deps.disconnect).toHaveBeenCalledOnce();
    expect(deps.reconcilePublishedSite).not.toHaveBeenCalled();
  });

  it("logs and continues when published site reconciliation rebuilt the site", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const deps = baseDeps();
    deps.reconcilePublishedSite.mockResolvedValue({
      checked: 5,
      missing: 5,
      rebuilt: true,
    });

    await runBootstrap(deps);

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("5/5 published pages"),
    );
    expect(deps.disconnect).toHaveBeenCalledOnce();
  });

  it("logs and continues when media reconciliation finds missing bytes", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const deps = baseDeps();
    deps.reconcileMedia.mockResolvedValue({ checked: 10, missing: 3 });

    await runBootstrap(deps);

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("3/10 media files"),
    );
    expect(deps.disconnect).toHaveBeenCalledOnce();
  });

  it("logs and continues when stuck media reconciliation marks records FAILED", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const deps = baseDeps();
    deps.reconcileStuckMedia.mockResolvedValue({ checked: 4, failed: 2 });

    await runBootstrap(deps);

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("2/4 media files were stuck in PROCESSING"),
    );
    expect(deps.disconnect).toHaveBeenCalledOnce();
  });

  it("does not let a reconciliation failure block boot or skip disconnect", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const deps = baseDeps();
    deps.reconcilePublishedSite.mockRejectedValue(
      new Error("disk unreachable"),
    );
    deps.reconcileMedia.mockRejectedValue(new Error("db unreachable"));
    deps.reconcileStuckMedia.mockRejectedValue(new Error("db unreachable"));
    deps.checkRedisMaxmemoryPolicy.mockRejectedValue(
      new Error("redis unreachable"),
    );

    await runBootstrap(deps);

    expect(deps.disconnect).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledWith(
      "[Kastir] Published site reconciliation failed",
      "disk unreachable",
    );
    expect(errorSpy).toHaveBeenCalledWith(
      "[Kastir] Media reconciliation failed",
      "db unreachable",
    );
    expect(errorSpy).toHaveBeenCalledWith(
      "[Kastir] Stuck media reconciliation failed",
      "db unreachable",
    );
    expect(errorSpy).toHaveBeenCalledWith(
      "[Kastir] Redis maxmemory-policy check failed",
      "redis unreachable",
    );
  });

  it("does not log when Redis maxmemory-policy is already noeviction", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const deps = baseDeps();
    deps.checkRedisMaxmemoryPolicy.mockResolvedValue({ policy: "noeviction" });

    await runBootstrap(deps);

    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining("maxmemory-policy"),
    );
  });

  it("warns when Redis maxmemory-policy is not noeviction", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const deps = baseDeps();
    deps.checkRedisMaxmemoryPolicy.mockResolvedValue({ policy: "allkeys-lru" });

    await runBootstrap(deps);

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'Redis maxmemory-policy is "allkeys-lru", not "noeviction"',
      ),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "redis-cli CONFIG SET maxmemory-policy noeviction",
      ),
    );
  });

  it("does not block boot when Redis is unreachable for the maxmemory-policy check", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const deps = baseDeps();
    deps.checkRedisMaxmemoryPolicy.mockRejectedValue(
      new Error("connect ECONNREFUSED"),
    );

    await runBootstrap(deps);

    expect(deps.disconnect).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledWith(
      "[Kastir] Redis maxmemory-policy check failed",
      "connect ECONNREFUSED",
    );
  });

  it("parses ioredis's CONFIG GET flat [key, value] array response", () => {
    expect(parseConfigGetValue(["maxmemory-policy", "noeviction"])).toBe(
      "noeviction",
    );
    expect(parseConfigGetValue(["maxmemory-policy", "allkeys-lru"])).toBe(
      "allkeys-lru",
    );
    expect(parseConfigGetValue([])).toBeNull();
    expect(parseConfigGetValue(null)).toBeNull();
    expect(parseConfigGetValue("noeviction")).toBeNull();
  });
});
