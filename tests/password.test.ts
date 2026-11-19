import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "@/lib/Modules/Auth/Password";

describe("password hashing", () => {
  it("hashes with Argon2id and verifies the original password", async () => {
    const hash = await hashPassword("correct horse battery staple");

    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(
      verifyPassword("correct horse battery staple", hash),
    ).resolves.toBe(true);
    await expect(verifyPassword("wrong password", hash)).resolves.toBe(false);
  });
});
