import { afterEach, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  delete process.env.MASTER_FORCE_RESET;
});
