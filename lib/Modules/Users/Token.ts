import { createHash, randomBytes } from "node:crypto";

export const INVITE_TOKEN_BYTES = 32;
export const INVITE_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export type RandomBytesFactory = (size: number) => Buffer;

export function generateToken(
  createBytes: RandomBytesFactory = randomBytes,
): string {
  return createBytes(INVITE_TOKEN_BYTES).toString("hex");
}

export function digestToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createTokenExpiry(issuedAt: Date = new Date()): Date {
  return new Date(issuedAt.getTime() + INVITE_TOKEN_TTL_MS);
}

export function isTokenUsable(
  expiresAt: Date,
  now: Date = new Date(),
): boolean {
  return expiresAt.getTime() > now.getTime();
}
