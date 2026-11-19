import { describe, expect, it } from "vitest";

import {
  detectMediaType,
  getMediaUploadLimit,
  getMediaExtension,
} from "@/lib/Processing/detectFileType";

const PNG_SIGNATURE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

describe("media file detection", () => {
  it("accepts a PNG only when its signature matches the declared extension", async () => {
    await expect(
      detectMediaType(PNG_SIGNATURE, "hero.png"),
    ).resolves.toMatchObject({
      category: "IMAGE_RASTER",
      mimeType: "image/png",
    });
  });

  it("rejects an executable renamed with an allowed image extension", async () => {
    await expect(
      detectMediaType(Buffer.from("MZ-this-is-not-an-image"), "hero.jpg"),
    ).rejects.toThrow("signature");
  });

  it("treats SVG as a text format that must be sanitized separately", async () => {
    await expect(
      detectMediaType(
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
        "icon.svg",
      ),
    ).resolves.toMatchObject({
      category: "IMAGE_SVG",
      mimeType: "image/svg+xml",
    });
  });

  it("rejects a valid signature with a mismatched extension", async () => {
    await expect(detectMediaType(PNG_SIGNATURE, "hero.jpg")).rejects.toThrow(
      "does not match",
    );
  });

  it("uses the category limits and normalizes extensions", () => {
    expect(getMediaExtension("PHOTO.JPEG")).toBe("jpeg");
    expect(getMediaUploadLimit("photo.png")).toBe(20 * 1024 * 1024);
    expect(getMediaUploadLimit("movie.mp4")).toBe(200 * 1024 * 1024);
  });
});
