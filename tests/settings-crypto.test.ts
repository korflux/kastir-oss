import { describe, expect, it } from "vitest";

import {
  decryptCloudflareToken,
  encryptCloudflareToken,
} from "@/lib/Modules/Settings/Crypto";

const secret = "a-stable-test-secret-with-at-least-32-bytes";

describe("Cloudflare token encryption", () => {
  it("round-trips with AES-GCM and never stores plaintext", () => {
    const plaintext = "cf-secret-token-value";
    const ciphertext = encryptCloudflareToken(plaintext, secret);

    expect(ciphertext).toMatch(
      /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
    );
    expect(ciphertext).not.toContain(plaintext);
    expect(decryptCloudflareToken(ciphertext, secret)).toBe(plaintext);
  });

  it("uses a fresh IV and fails safely for tampered or wrong-secret payloads", () => {
    const first = encryptCloudflareToken("same-value", secret);
    const second = encryptCloudflareToken("same-value", secret);

    expect(first).not.toBe(second);
    expect(() =>
      decryptCloudflareToken(first, "another-stable-secret-with-32-bytes"),
    ).toThrow("Unable to decrypt Cloudflare token");
    expect(() => decryptCloudflareToken(`${first}x`, secret)).toThrow(
      "Unable to decrypt Cloudflare token",
    );
  });
});
