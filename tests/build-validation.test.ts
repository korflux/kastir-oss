import type {
  SpawnSyncOptionsWithStringEncoding,
  SpawnSyncReturns,
} from "node:child_process";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import {
  createBuildEnvironment,
  hasKnownAuthBuildError,
  runProductionBuild,
  validateBuildResult,
} from "../scripts/validate-build.mjs";

describe("production build validation", () => {
  it("propagates a non-zero exit code", () => {
    expect(
      validateBuildResult({ status: 23, signal: null, stdout: "", stderr: "" }),
    ).toEqual({ exitCode: 23, signal: null });
  });

  it("propagates a terminating signal", () => {
    expect(
      validateBuildResult({
        status: null,
        signal: "SIGTERM",
        stdout: "",
        stderr: "",
      }),
    ).toEqual({ exitCode: 1, signal: "SIGTERM" });
  });

  it.each([
    "PrismaClientKnownRequestError during page collection",
    "query OauthResource findFirst failed",
    "[Better Auth] adapter failed: connect ECONNREFUSED 127.0.0.1:1",
  ])("rejects a known absorbed auth build error: %s", (stderr) => {
    expect(hasKnownAuthBuildError(stderr)).toBe(true);
    expect(
      validateBuildResult({ status: 0, signal: null, stdout: "", stderr }),
    ).toEqual({ exitCode: 1, signal: null });
  });

  it("does not confuse an unrelated loopback refusal with Better Auth", () => {
    expect(hasKnownAuthBuildError("cache probe ECONNREFUSED 127.0.0.1:1")).toBe(
      false,
    );
  });

  it("does not inherit proxies or smoke secrets from the parent process", () => {
    const environment = createBuildEnvironment({
      PATH: "build-path",
      HTTPS_PROXY: "https://proxy.invalid",
      MCP_SMOKE_TOKEN: "smoke-token-sentinel",
    });

    expect(environment.PATH).toBe("build-path");
    expect(environment).not.toHaveProperty("HTTPS_PROXY");
    expect(environment).not.toHaveProperty("MCP_SMOKE_TOKEN");
    expect(environment.__NEXT_PROCESSED_ENV).toBe("true");
  });

  it("runs the complete build without a shell and with isolated placeholders", () => {
    const calls: Array<{
      command: string;
      args: readonly string[];
      options: SpawnSyncOptionsWithStringEncoding;
    }> = [];
    const spawn = ((
      command: string,
      args: readonly string[],
      options: SpawnSyncOptionsWithStringEncoding,
    ): SpawnSyncReturns<string> => {
      calls.push({ command, args, options });
      return {
        output: [null, "", ""],
        pid: 1,
        signal: null,
        status: 0,
        stderr: "",
        stdout: "",
      };
    }) as typeof spawnSync;

    expect(runProductionBuild(spawn)).toEqual({ exitCode: 0, signal: null });
    expect(calls).toHaveLength(2);

    for (const { options } of calls) {
      expect(options).toMatchObject({ shell: false });
      expect(options.env).toBeDefined();
      if (!options.env) throw new Error("build subprocess env is required");
      const env = options.env;
      expect(env["DATABASE_URL"]).toContain("127.0.0.1:1");
      expect(env["REDIS_URL"]).toContain("127.0.0.1:1");
      expect(env["MCP_INTROSPECTION_CLIENT_ID"]).toBe("");
      expect(env["MCP_INTROSPECTION_CLIENT_SECRET"]).toBe("");
    }
  });
});
