import { decryptCloudflareToken } from "@/lib/Modules/Settings/Crypto";

export type CloudflarePurgeResult =
  | { status: "SKIPPED" }
  | { status: "PURGED" }
  | { status: "FAILED"; message: string };

export type CloudflarePurgeOptions = {
  credentials?: {
    cloudflareApiTokenEncrypted: string | null;
    cloudflareZoneId: string | null;
  } | null;
  fetcher?: typeof fetch;
};

type CloudflarePurgeTarget = string | readonly string[];

function safeFailureMessage(error: unknown): string {
  return error instanceof Error
    ? error.message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    : "Cloudflare purge failed";
}

export async function cloudflarePurge(
  publicUrl: CloudflarePurgeTarget,
  options: CloudflarePurgeOptions = {},
): Promise<CloudflarePurgeResult> {
  const publicUrls = Array.isArray(publicUrl) ? [...publicUrl] : [publicUrl];
  if (
    publicUrls.length === 0 ||
    publicUrls.some((url) => !/^https?:\/\//i.test(url))
  ) {
    return {
      status: "FAILED",
      message: "Cloudflare purge requires an absolute HTTP(S) URL",
    };
  }

  try {
    let credentials = options.credentials;
    if (credentials === undefined) {
      const { prisma } = await import("@/lib/prisma");
      credentials = await prisma.siteSettings.findUnique({
        where: { id: "singleton" },
      });
    }
    if (
      !credentials?.cloudflareApiTokenEncrypted ||
      !credentials.cloudflareZoneId
    ) {
      return { status: "SKIPPED" };
    }

    const token = decryptCloudflareToken(
      credentials.cloudflareApiTokenEncrypted,
    );
    const fetcher = options.fetcher ?? fetch;
    const response = await fetcher(
      `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(credentials.cloudflareZoneId)}/purge_cache`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ files: publicUrls }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) {
      return {
        status: "FAILED",
        message: `Cloudflare purge returned HTTP ${response.status}`,
      };
    }
    return { status: "PURGED" };
  } catch (error) {
    return { status: "FAILED", message: safeFailureMessage(error) };
  }
}
