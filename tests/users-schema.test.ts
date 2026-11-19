import { describe, expect, it } from "vitest";

import {
  acceptInviteSchema,
  changeUserRoleSchema,
  createInviteSchema,
  resetPasswordSchema,
  updateUserSchema,
} from "@/lib/Modules/Users/Schema";

describe("Users schemas", () => {
  it("accepts only ADMIN or EDITOR invite roles", () => {
    expect(
      createInviteSchema.parse({ name: "  Ana  ", role: "EDITOR" }),
    ).toEqual({ name: "Ana", role: "EDITOR" });

    expect(() =>
      createInviteSchema.parse({ name: "Ana", role: "MASTER" }),
    ).toThrow();
    expect(() =>
      createInviteSchema.parse({ name: "Ana", role: "READER" }),
    ).toThrow();
  });

  it("rejects client-controlled authorization fields", () => {
    expect(() =>
      createInviteSchema.parse({
        name: "Ana",
        role: "EDITOR",
        isMaster: true,
        createdById: "attacker",
      }),
    ).toThrow();
    expect(() =>
      changeUserRoleSchema.parse({ role: "EDITOR", isMaster: true }),
    ).toThrow();
  });

  it("accepts name/email/role patches and normalizes email", () => {
    expect(
      updateUserSchema.parse({
        name: "  Ana  ",
        email: "  ANA@EXAMPLE.COM ",
        role: "ADMIN",
      }),
    ).toEqual({ name: "Ana", email: "ana@example.com", role: "ADMIN" });
    expect(updateUserSchema.parse({ name: "Only name" })).toEqual({
      name: "Only name",
    });
    expect(() => updateUserSchema.parse({})).toThrow();
  });

  it("normalizes invite email and requires a Better Auth compatible password", () => {
    expect(
      acceptInviteSchema.parse({
        email: "  ANA@EXAMPLE.COM ",
        password: "secret-123",
      }),
    ).toEqual({ email: "ana@example.com", password: "secret-123" });

    expect(() =>
      acceptInviteSchema.parse({ email: "ana@example.com", password: "short" }),
    ).toThrow();
  });

  it("validates reset passwords and rejects extra fields", () => {
    expect(resetPasswordSchema.parse({ password: "secret-123" })).toEqual({
      password: "secret-123",
    });
    expect(() =>
      resetPasswordSchema.parse({ password: "secret-123", userId: "master" }),
    ).toThrow();
  });
});
