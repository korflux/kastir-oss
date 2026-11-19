import { describe, expect, it } from "vitest";

import {
  LEGACY_MEDIA_FOLDER_ACTIONS,
  effectiveLogObjectType,
  isLegacyMediaFolderAction,
} from "@/lib/Modules/Logs/Types";

describe("log object classification", () => {
  it("recognizes only the closed legacy media-folder action list", () => {
    expect(LEGACY_MEDIA_FOLDER_ACTIONS).toEqual([
      "MEDIA_FOLDER_CREATED",
      "MEDIA_FOLDER_RENAMED",
      "MEDIA_FOLDER_RECOLORED",
      "MEDIA_FOLDER_DELETED",
    ]);
    expect(isLegacyMediaFolderAction("MEDIA_FOLDER_CREATED")).toBe(true);
    expect(isLegacyMediaFolderAction("MEDIA_FOLDER_MOVED")).toBe(false);
  });

  it("shows legacy media-folder rows as folders without changing raw data", () => {
    expect(
      effectiveLogObjectType({
        objectType: "MEDIA",
        action: "MEDIA_FOLDER_DELETED",
      }),
    ).toBe("FOLDER");
    expect(
      effectiveLogObjectType({
        objectType: "MEDIA",
        action: "MEDIA_DELETED",
      }),
    ).toBe("MEDIA");
  });
});
