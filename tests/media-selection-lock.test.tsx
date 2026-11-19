import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MediaGrid } from "@/lib/Modules/Media/Components/MediaGrid";
import { MediaLibrary } from "@/lib/Modules/Media/Components/MediaLibrary";
import { MediaList } from "@/lib/Modules/Media/Components/MediaList";
import { getPanelDictionary } from "@/lib/i18n/panel";

const item = {
  id: "media-id",
  name: "banner.png",
  url: "https://cdn.example.com/banner.png",
  mimeType: "image/png",
  category: "IMAGE_RASTER" as const,
  sizeBytes: 10,
  alt: null,
  processingStatus: "READY" as const,
};

describe("media selection lock", () => {
  it("disables grid selection while a bulk action is running", () => {
    const html = renderToStaticMarkup(
      createElement(MediaGrid, {
        items: [item],
        onToggle: vi.fn(),
        selectionDisabled: true,
      }),
    );

    expect(html).toContain("disabled");
  });

  it("keeps selected rows removable when the 200-item ceiling is reached", () => {
    const html = renderToStaticMarkup(
      createElement(MediaList, {
        items: [item],
        onToggle: vi.fn(),
        selectedIds: [item.id],
        selectionAtLimit: true,
      }),
    );

    expect(html).not.toContain('disabled=""');
  });

  it("explains the read-only role without rendering a bulk toolbar", () => {
    const dictionary = getPanelDictionary("en");
    const html = renderToStaticMarkup(
      createElement(MediaLibrary, {
        allSelected: false,
        bulkDictionary: dictionary.bulk,
        busyAction: null,
        canBulk: false,
        dictionary: dictionary.media,
        bulkFolderId: "",
        folders: [],
        hasMoreMedia: false,
        loading: false,
        loadingMore: false,
        media: [],
        selectedFolderPath: dictionary.media.allMedia,
        selectedIds: [],
        selectionAtLimit: false,
        someSelected: false,
        viewMode: "grid",
        onConvert: () => undefined,
        onConvertSelected: () => undefined,
        onDeleteSelected: () => undefined,
        onBulkFolderChange: () => undefined,
        onClearSelection: () => undefined,
        onToggleAllSelection: () => undefined,
        onMoveSelected: () => undefined,
        onLoadMore: () => undefined,
        onOpenDetails: () => undefined,
        onRefresh: () => undefined,
        onToggleSelected: () => undefined,
      }),
    );

    expect(html).toContain(dictionary.bulk.noPermission);
    expect(html).not.toContain('data-testid="bulk-action-bar"');
  });
});
