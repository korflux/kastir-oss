import { createHmac, timingSafeEqual } from "node:crypto";

import { env } from "@/lib/env";

export const MCP_MEDIA_DOWNLOAD_TTL_SECONDS = 5 * 60;

function signaturePayload(mediaId: string, expiresAt: number): string {
  return `${mediaId}.${expiresAt}`;
}

export function createMcpMediaDownloadSignature(
  mediaId: string,
  expiresAt: number,
): string {
  return createHmac("sha256", env.NEXTAUTH_SECRET)
    .update(signaturePayload(mediaId, expiresAt))
    .digest("base64url");
}

export function createMcpMediaDownloadUrl({
  baseUrl,
  mediaId,
  now = Math.floor(Date.now() / 1000),
  ttlSeconds = MCP_MEDIA_DOWNLOAD_TTL_SECONDS,
}: {
  baseUrl: string;
  mediaId: string;
  now?: number;
  ttlSeconds?: number;
}): { url: string; expiresAt: number } {
  const expiresAt = now + ttlSeconds;
  const url = new URL(
    `/api/mcp/media/${encodeURIComponent(mediaId)}/download`,
    baseUrl,
  );
  url.searchParams.set("expires", String(expiresAt));
  url.searchParams.set(
    "sig",
    createMcpMediaDownloadSignature(mediaId, expiresAt),
  );
  return { url: url.toString(), expiresAt };
}

export function isValidMcpMediaDownloadSignature(
  mediaId: string,
  expiresAtValue: string | null,
  signature: string | null,
  now = Math.floor(Date.now() / 1000),
): boolean {
  if (!expiresAtValue || !signature) return false;
  const expiresAt = Number(expiresAtValue);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return false;

  const expected = createMcpMediaDownloadSignature(mediaId, expiresAt);
  const providedBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  return (
    providedBytes.length === expectedBytes.length &&
    timingSafeEqual(providedBytes, expectedBytes)
  );
}
