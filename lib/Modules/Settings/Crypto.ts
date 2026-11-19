import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const VERSION = "v1";
const IV_BYTES = 12;
const KEY_BYTES = 32;

function keyFromSecret(secret: string): Buffer {
  return createHash("sha256")
    .update("kastir/site-settings/cloudflare-token:")
    .update(secret)
    .digest()
    .subarray(0, KEY_BYTES);
}

function resolveSecret(secret?: string): string {
  const resolved = secret ?? process.env.NEXTAUTH_SECRET;
  if (!resolved || resolved.length < 32) {
    throw new Error("NEXTAUTH_SECRET must be configured");
  }
  return resolved;
}

function encoded(value: Buffer): string {
  return value.toString("base64url");
}

function decoded(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

export function encryptCloudflareToken(
  plaintext: string,
  secret?: string,
): string {
  if (!plaintext) throw new Error("Cloudflare token cannot be empty");

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(
    "aes-256-gcm",
    keyFromSecret(resolveSecret(secret)),
    iv,
  );
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return [
    VERSION,
    encoded(iv),
    encoded(cipher.getAuthTag()),
    encoded(ciphertext),
  ].join(".");
}

export function decryptCloudflareToken(
  payload: string,
  secret?: string,
): string {
  try {
    const [version, ivValue, tagValue, ciphertextValue] = payload.split(".");
    if (version !== VERSION || !ivValue || !tagValue || !ciphertextValue)
      throw new Error();

    const iv = decoded(ivValue);
    const tag = decoded(tagValue);
    const ciphertext = decoded(ciphertextValue);
    if (iv.length !== IV_BYTES || tag.length !== 16 || ciphertext.length === 0)
      throw new Error();

    const decipher = createDecipheriv(
      "aes-256-gcm",
      keyFromSecret(resolveSecret(secret)),
      iv,
    );
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("Unable to decrypt Cloudflare token");
  }
}
