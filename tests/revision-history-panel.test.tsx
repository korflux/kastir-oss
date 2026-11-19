// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StatusToggle } from "@/components/Shared/StatusToggle";
import { revisionRestoreBlockedReason } from "@/lib/Modules/Revisions/Components/RevisionCompareBar";
import {
  fillRevisionCopy,
  formatRevisionDateTime,
  revisionPinBlocked,
  revisionShortId,
  RevisionHistoryPanel,
  type RevisionHistoryItem,
} from "@/lib/Modules/Revisions/Components/RevisionHistoryPanel";
import { useRevisionHistory } from "@/lib/Modules/Revisions/Components/useRevisionHistory";
import { getPanelDictionary } from "@/lib/i18n/panel";

// Habilita o flush determinístico dos efeitos React usados pelas montagens.
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const requestJsonMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/requestJson", () => ({ requestJson: requestJsonMock }));

const copy = getPanelDictionary("en").revisions;

const items: RevisionHistoryItem[] = [
  {
    id: "rev-live",
    fingerprint: "aabbccddeeff00112233445566778899",
    authorName: "Ada",
    createdAt: "2026-08-01T12:00:00.000Z",
    pinned: false,
    published: true,
  },
  {
    id: "rev-old",
    fingerprint: "11223344556677889900aabbccddeeff",
    authorName: "Grace",
    createdAt: "2026-07-30T12:00:00.000Z",
    pinned: true,
    published: false,
  },
];

/** Formatador fixo: o teste não depende do fuso nem do idioma da máquina. */
const formatDateTime = (value: string) =>
  `${value.slice(8, 10)}/${value.slice(5, 7)} ${value.slice(11, 16)}`;

function panel(
  props: Partial<Parameters<typeof RevisionHistoryPanel>[0]> = {},
) {
  return createElement(RevisionHistoryPanel, {
    copy,
    items,
    status: "ready",
    onSelect: () => undefined,
    onPin: () => undefined,
    onRetry: () => undefined,
    draftState: "draftUnpublished",
    draftUpdatedAt: "2026-08-13T12:00:00.000Z",
    formatDateTime,
    ...props,
  });
}

function render(
  props: Partial<Parameters<typeof RevisionHistoryPanel>[0]> = {},
) {
  return renderToStaticMarkup(panel(props));
}

let root: Root | undefined;

function unmount() {
  if (root) {
    act(() => root?.unmount());
    root = undefined;
  }
  document.body.replaceChildren();
}

afterEach(() => {
  unmount();
  requestJsonMock.mockReset();
});

function mount(element: React.ReactElement) {
  unmount();
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(element));
  return container;
}

const row = (container: ParentNode, id: string) =>
  container.querySelector<HTMLElement>(`[data-testid="revision-row-${id}"]`)!;
const rowButton = (container: ParentNode, id: string) =>
  row(container, id).querySelector<HTMLButtonElement>("button")!;
const pinButton = (container: ParentNode, id: string) =>
  container.querySelector<HTMLButtonElement>(
    `[data-testid="revision-pin-${id}"]`,
  )!;

describe("revisionShortId", () => {
  it("uses the first seven fingerprint characters", () => {
    expect(revisionShortId("aabbccddeeff0011")).toBe("aabbccd");
  });
});

describe("fillRevisionCopy and formatRevisionDateTime", () => {
  it("fills placeholders and leaves unknown ones untouched", () => {
    expect(
      fillRevisionCopy("{date} ({author}) {missing}", {
        date: "13/08",
        author: "Ada",
      }),
    ).toBe("13/08 (Ada) {missing}");
  });

  it("formats date and time together, and survives an invalid date", () => {
    const text = formatRevisionDateTime("2026-08-01T12:00:00.000Z");
    expect(text).toMatch(/\d/);
    expect(text).toMatch(/\d{1,2}:\d{2}/);
    expect(formatRevisionDateTime("not a date")).toBe("—");
  });
});

describe("RevisionHistoryPanel", () => {
  it("announces loading, error and empty states", () => {
    expect(render({ status: "loading", items: [] })).toContain(copy.loading);
    expect(render({ status: "loading", items: [] })).toContain('role="status"');

    const errorHtml = render({
      status: "error",
      items: [],
      errorMessage: copy.error,
    });
    expect(errorHtml).toContain(copy.error);
    expect(errorHtml).toContain('role="alert"');
    expect(errorHtml).toContain(copy.retry);

    // Só Rascunho: a lista tem uma linha, com contador e política (sem estado vazio à parte).
    const emptyHtml = render({ status: "empty", items: [] });
    expect(emptyHtml).toContain(copy.draft);
    expect(emptyHtml).toContain(copy.title);
    expect(emptyHtml).toContain("0 of 5 · 0/3 pinned");
    expect(emptyHtml).toContain('data-testid="revision-policy"');
    expect(emptyHtml).not.toContain('data-testid="revision-row-rev-');
  });

  it("renders button rows with Draft on top and the versions below it", () => {
    const html = render({ live: true });
    expect(html).toContain(copy.draft);
    expect(html).toContain("aabbccd");
    expect(html).toContain("1122334");
    expect(html).not.toContain("<table");
    expect(html).not.toContain('type="radio"');
    expect(html).not.toContain("<textarea");

    const draftAt = html.indexOf('data-testid="revision-row-draft"');
    const liveAt = html.indexOf('data-testid="revision-row-rev-live"');
    const oldAt = html.indexOf('data-testid="revision-row-rev-old"');
    expect(draftAt).toBeGreaterThan(-1);
    expect(liveAt).toBeGreaterThan(draftAt);
    expect(oldAt).toBeGreaterThan(liveAt);
  });

  // A7: data, hora e autor em cada linha.
  it("shows date, time, author and short code on every version row", () => {
    const container = mount(panel());
    const live = row(container, "rev-live").textContent ?? "";
    expect(live).toContain("01/08 12:00");
    expect(live).toContain("Ada");
    expect(live).toContain("aabbccd");
    const old = row(container, "rev-old").textContent ?? "";
    expect(old).toContain("30/07 12:00");
    expect(old).toContain("Grace");
    expect(old).toContain("1122334");
  });

  // A7: o aria-label substitui o texto visível, então o nome acessível carrega o mesmo marcador
  // do Badge nos três casos: comum (sem marcador), no ar e publicada com o item fora do ar.
  it("names every version row for assistive technology, marking the live one", () => {
    const container = mount(panel({ live: true }));
    expect(rowButton(container, "rev-live").getAttribute("aria-label")).toBe(
      "Version from 01/08 12:00 by Ada, live",
    );
    expect(rowButton(container, "rev-old").getAttribute("aria-label")).toBe(
      "Version from 30/07 12:00 by Grace",
    );
  });

  it("names the published version as published, not live, when the item is offline", () => {
    const container = mount(panel({ live: false }));
    expect(rowButton(container, "rev-live").getAttribute("aria-label")).toBe(
      "Version from 01/08 12:00 by Ada, published",
    );
    // Versão comum continua sem marcador, no ar ou fora do ar.
    expect(rowButton(container, "rev-old").getAttribute("aria-label")).toBe(
      "Version from 30/07 12:00 by Grace",
    );
  });

  it("keeps the accessible name aligned with the visible badge in Portuguese", () => {
    const pt = getPanelDictionary("pt-BR").revisions;
    const live = mount(panel({ copy: pt, live: true }));
    expect(rowButton(live, "rev-live").getAttribute("aria-label")).toBe(
      "Versão de 01/08 12:00 por Ada, no ar",
    );
    expect(row(live, "rev-live").textContent).toContain(pt.live);

    const offline = mount(panel({ copy: pt, live: false }));
    expect(rowButton(offline, "rev-live").getAttribute("aria-label")).toBe(
      "Versão de 01/08 12:00 por Ada, publicada",
    );
    expect(row(offline, "rev-live").textContent).toContain(pt.publishedOffline);
    expect(rowButton(offline, "rev-old").getAttribute("aria-label")).toBe(
      "Versão de 30/07 12:00 por Grace",
    );
  });

  // A7: marcador No ar ou Publicada conforme o estado do item.
  it("marks the published version as Live when the item is live and Published when offline", () => {
    const live = mount(panel({ live: true }));
    expect(row(live, "rev-live").textContent).toContain(copy.live);
    expect(row(live, "rev-live").innerHTML).toContain("text-brand");
    expect(row(live, "rev-old").textContent).not.toContain(copy.live);
    expect(row(live, "rev-old").textContent).not.toContain(
      copy.publishedOffline,
    );

    const offline = mount(panel({ live: false }));
    expect(row(offline, "rev-live").textContent).toContain(
      copy.publishedOffline,
    );
    expect(row(offline, "rev-live").textContent).not.toContain(copy.live);
    expect(row(offline, "rev-live").innerHTML).not.toContain("text-brand");
  });

  // A7: estado da linha Rascunho.
  it("labels the Draft row with its state", () => {
    const states = [
      ["draftUnsaved", copy.draftUnsaved],
      ["draftUnpublished", copy.draftUnpublished],
      ["draftSameAsLive", copy.draftSameAsLive],
      ["draftSameAsPublished", copy.draftSameAsPublished],
    ] as const;
    for (const [draftState, text] of states) {
      const container = mount(panel({ draftState }));
      const draft = row(container, "draft").textContent ?? "";
      expect(draft).toContain(copy.draft);
      expect(draft).toContain(text);
      expect(draft).toContain("13/08 12:00");
    }
  });

  // Layout da linha 1: data e selo no mesmo contêiner flex (o selo é compacto e a data não
  // quebra), em todas as linhas com selo. A quebra do selo para baixo da data, na coluna estreita
  // do Details, era o defeito.
  it("keeps the date and its badge together on line 1, with a compact badge", () => {
    const container = mount(panel({ live: false }));
    for (const id of ["draft", "rev-live"]) {
      const line1 = row(container, id).querySelector<HTMLElement>(
        "button > span:nth-of-type(2) > span:first-child",
      )!;
      const badge = line1.querySelector<HTMLElement>('[data-slot="badge"]');
      expect(badge, id).not.toBeNull();
      expect(badge!.className).toContain("px-1.5");
      expect(badge!.className).toContain("text-[11px]");
      // O texto da data/rótulo não quebra por dentro; só o selo pode descer, nunca a data picada.
      expect(line1.firstElementChild?.className).toContain("whitespace-nowrap");
    }
  });

  // O alfinete só aparece nas versões; a linha Rascunho reserva o mesmo espaço (size-7) para
  // as linhas não se deslocarem quando o alfinete aparece no hover/foco.
  it("reserves the pin slot so rows don't shift", () => {
    const container = mount(panel());
    const draft = row(container, "draft");
    const placeholder = draft.querySelector("span[aria-hidden].size-7");
    expect(placeholder).not.toBeNull();
    expect(draft.querySelector("button[aria-pressed]")).toBeNull();

    const version = row(container, "rev-old");
    expect(version.querySelector("span[aria-hidden].size-7")).toBeNull();
    const pin = pinButton(container, "rev-old");
    expect(pin.className).toContain("size-7");
    // Mesma largura e mesma posição (última coluna da linha) nos dois casos.
    expect(draft.lastElementChild).toBe(placeholder);
    expect(version.lastElementChild).toBe(pin);
  });

  it("shows the counter and the retention policy with the configured limit", () => {
    const standard = mount(panel());
    expect(
      standard.querySelector('[data-testid="revision-counter"]')?.textContent,
    ).toBe("2 of 5 · 1/3 pinned");
    expect(
      standard.querySelector('[data-testid="revision-policy"]')?.textContent,
    ).toBe(
      "Every publication creates a version. We keep the 5 most recent; the published one and pinned ones are never removed.",
    );

    const custom = mount(panel({ retentionLimit: 12 }));
    expect(
      custom.querySelector('[data-testid="revision-counter"]')?.textContent,
    ).toBe("2 of 12 · 1/3 pinned");
    expect(custom.textContent).toContain("We keep the 12 most recent");
  });

  it("no longer renders a restore control (it moved to the comparison bar)", () => {
    const container = mount(panel({ selectedId: "rev-old" }));
    expect(
      container.querySelector('[data-testid^="revision-restore"]'),
    ).toBeNull();
    const labels = [...container.querySelectorAll("button")].map(
      (button) => button.getAttribute("aria-label") ?? button.textContent,
    );
    expect(labels.some((label) => label === copy.restore)).toBe(false);
  });

  it("marks only the selected row as current", () => {
    const draft = mount(panel({ selectedId: null }));
    expect(rowButton(draft, "draft").getAttribute("aria-current")).toBe("true");
    expect(rowButton(draft, "rev-old").hasAttribute("aria-current")).toBe(
      false,
    );

    const selected = mount(panel({ selectedId: "rev-old" }));
    expect(rowButton(selected, "rev-old").getAttribute("aria-current")).toBe(
      "true",
    );
    expect(rowButton(selected, "draft").hasAttribute("aria-current")).toBe(
      false,
    );
  });

  it("selects a version, or goes back to the draft, with one click on the row", () => {
    const onSelect = vi.fn();
    const container = mount(panel({ onSelect }));

    act(() => rowButton(container, "rev-old").click());
    expect(onSelect).toHaveBeenLastCalledWith("rev-old");

    act(() => rowButton(container, "draft").click());
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("disables rows and pins while a request is running", () => {
    const container = mount(panel({ busy: true }));
    expect(rowButton(container, "rev-old").hasAttribute("disabled")).toBe(true);
    expect(rowButton(container, "draft").hasAttribute("disabled")).toBe(true);
    expect(pinButton(container, "rev-old").hasAttribute("disabled")).toBe(true);
  });

  it("exposes conflict as an accessible alert", () => {
    const html = render({ conflict: true });
    expect(html).toContain(copy.conflict);
    expect(html).toContain('role="alert"');
  });

  it("surfaces an action error while the list stays ready", () => {
    const html = render({
      status: "ready",
      errorMessage: copy.error,
    });
    expect(html).toContain(copy.error);
    expect(html).toContain('role="alert"');
    expect(html).not.toContain(copy.retry);
    expect(html).toContain(copy.draft);
  });

  it("offers Retry for a failed version load when the hook says it is retryable", () => {
    const onRetry = vi.fn();
    const container = mount(
      panel({ errorMessage: "Boom", retryable: true, onRetry }),
    );
    expect(container.textContent).toContain("Boom");
    const retry = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === copy.retry,
    );
    act(() => retry?.click());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("RevisionHistoryPanel pins (A11)", () => {
  const fourVersions: RevisionHistoryItem[] = [
    ...items,
    {
      id: "rev-p2",
      fingerprint: "cccccccccccccccccccccccccccccccc",
      authorName: "A",
      createdAt: "2026-07-01T00:00:00.000Z",
      pinned: true,
      published: false,
    },
    {
      id: "rev-p3",
      fingerprint: "dddddddddddddddddddddddddddddddd",
      authorName: "B",
      createdAt: "2026-06-01T00:00:00.000Z",
      pinned: true,
      published: false,
    },
    {
      id: "rev-free",
      fingerprint: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      authorName: "C",
      createdAt: "2026-05-01T00:00:00.000Z",
      pinned: false,
      published: false,
    },
  ];

  it("blocks a fourth pin without disabling unpin", () => {
    expect(revisionPinBlocked(false, 3)).toBe(true);
    expect(revisionPinBlocked(true, 3)).toBe(false);
    expect(revisionPinBlocked(false, 2)).toBe(false);
  });

  it("shows the pinned state with aria-pressed and a dated accessible name", () => {
    const container = mount(panel());
    const pinned = pinButton(container, "rev-old");
    expect(pinned.getAttribute("aria-pressed")).toBe("true");
    expect(pinned.getAttribute("aria-label")).toBe(
      "Unpin version from 30/07 12:00",
    );
    expect(pinned.getAttribute("title")).toBe("Unpin version from 30/07 12:00");
    expect(pinned.querySelector("svg")?.getAttribute("class")).toContain(
      "fill-current",
    );

    const free = pinButton(container, "rev-live");
    expect(free.getAttribute("aria-pressed")).toBe("false");
    expect(free.getAttribute("aria-label")).toBe(
      "Pin version from 01/08 12:00",
    );
    expect(free.querySelector("svg")?.getAttribute("class")).not.toContain(
      "fill-current",
    );
    // O Rascunho não tem alfinete.
    expect(pinButton(container, "draft")).toBeNull();
  });

  it("pins and unpins through onPin without selecting the row", () => {
    const onPin = vi.fn();
    const onSelect = vi.fn();
    const container = mount(panel({ onPin, onSelect }));

    act(() => pinButton(container, "rev-live").click());
    expect(onPin).toHaveBeenLastCalledWith("rev-live", true);
    act(() => pinButton(container, "rev-old").click());
    expect(onPin).toHaveBeenLastCalledWith("rev-old", false);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shows the limit message on the fourth pin and does not call the server", () => {
    const onPin = vi.fn();
    const container = mount(panel({ items: fourVersions, onPin }));
    expect(
      container.querySelector('[data-testid="revision-counter"]')?.textContent,
    ).toBe("5 of 5 · 3/3 pinned");

    act(() => pinButton(container, "rev-free").click());

    expect(onPin).not.toHaveBeenCalled();
    const alert = [...container.querySelectorAll('[role="alert"]')].find(
      (node) => node.textContent === copy.pinLimit,
    );
    expect(alert).toBeDefined();
    // A contagem segue 3/3: nada foi gravado.
    expect(
      container.querySelector('[data-testid="revision-counter"]')?.textContent,
    ).toBe("5 of 5 · 3/3 pinned");
  });

  it("clears the limit message on the next valid click and still allows unpin", () => {
    const onPin = vi.fn();
    const container = mount(panel({ items: fourVersions, onPin }));
    act(() => pinButton(container, "rev-free").click());
    expect(container.textContent).toContain(copy.pinLimit);

    // Desafixar nunca é bloqueado, e limpa a mensagem.
    act(() => pinButton(container, "rev-old").click());
    expect(onPin).toHaveBeenCalledTimes(1);
    expect(onPin).toHaveBeenLastCalledWith("rev-old", false);
    expect(container.textContent).not.toContain(copy.pinLimit);
  });
});

describe("revisionRestoreBlockedReason", () => {
  const version = items[1]!;

  it("blocks restore for unsaved edits and for a version identical to the draft", () => {
    expect(
      revisionRestoreBlockedReason({
        dirty: true,
        versionFingerprint: version.fingerprint,
        draftFingerprint: "ffff",
      }),
    ).toBe("restoreBlockedDirty");
    expect(
      revisionRestoreBlockedReason({
        dirty: false,
        versionFingerprint: version.fingerprint,
        draftFingerprint: version.fingerprint,
      }),
    ).toBe("restoreBlockedIdentical");
    expect(
      revisionRestoreBlockedReason({
        dirty: false,
        versionFingerprint: version.fingerprint,
        draftFingerprint: "ffff",
      }),
    ).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Hook de histórico                                                           */
/* -------------------------------------------------------------------------- */

type PageSnapshotJson = {
  content: string;
  title: string;
  slug: string;
  folderId: string;
};

describe("useRevisionHistory", () => {
  const listUrl = "/api/admin/pages/page-1/revisions";
  const versionRecord: PageSnapshotJson & { id: string; fingerprint: string } =
    {
      id: "rev-old",
      fingerprint: items[1]!.fingerprint,
      title: "Old title",
      slug: "old-slug",
      folderId: "folder-b",
      content: "<h1>title</h1>\n<p>only in the version</p>\n",
    };

  let latest:
    ReturnType<typeof useRevisionHistory<PageSnapshotJson>> | undefined;

  function respond(overrides: Record<string, unknown | (() => unknown)> = {}) {
    requestJsonMock.mockImplementation(
      async (url: string, init?: RequestInit) => {
        const handler = overrides[`${init?.method ?? "GET"} ${url}`];
        if (handler !== undefined) {
          const value = typeof handler === "function" ? handler() : handler;
          if (value instanceof Error) throw value;
          return value;
        }
        if (url.startsWith(listUrl) && !url.includes("/rev-")) {
          return {
            items: items.map((item) => ({
              ...item,
              authorId: "user-1",
            })),
          };
        }
        if (url === `${listUrl}/rev-old`) return { revision: versionRecord };
        throw new Error(`unexpected request ${url}`);
      },
    );
  }

  async function mountHook(
    updatedAt: string | null = "2026-08-13T12:00:00.000Z",
  ) {
    function Probe() {
      latest = useRevisionHistory<PageSnapshotJson>({
        listUrl,
        expectedUpdatedAt: updatedAt,
        enabled: true,
        fallbackError: "fallback error",
      });
      return null;
    }
    unmount();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(Probe));
    });
  }

  beforeEach(() => {
    latest = undefined;
  });

  it("loads the whole list in one request (retention max + pinned fit in one page)", async () => {
    respond();
    await mountHook();
    expect(requestJsonMock).toHaveBeenCalledWith(`${listUrl}?pageSize=50`);
    expect(latest?.status).toBe("ready");
    expect(latest?.items.map((item) => item.id)).toEqual([
      "rev-live",
      "rev-old",
    ]);
  });

  // A8: − é o que sai do rascunho (editor), + é o que volta com a versão.
  it("compares the editor content to the version: - leaves the draft, + comes back", async () => {
    respond();
    await mountHook();

    await act(async () => {
      await latest?.select(
        "rev-old",
        "<h1>title</h1>\n<p>only in the editor</p>\n",
      );
    });

    expect(requestJsonMock).toHaveBeenCalledWith(`${listUrl}/rev-old`);
    expect(latest?.selectedId).toBe("rev-old");
    expect(latest?.selected?.authorName).toBe("Grace");
    const removed = latest?.diffLines.filter((line) => line.kind === "removed");
    const added = latest?.diffLines.filter((line) => line.kind === "added");
    expect(removed?.map((line) => line.text)).toEqual([
      "<p>only in the editor</p>",
    ]);
    expect(added?.map((line) => line.text)).toEqual([
      "<p>only in the version</p>",
    ]);
  });

  it("keeps the full snapshot of the version for the field comparison", async () => {
    respond();
    await mountHook();
    await act(async () => {
      await latest?.select("rev-old", "<h1>title</h1>\n");
    });
    expect(latest?.version).toMatchObject({
      title: "Old title",
      slug: "old-slug",
      folderId: "folder-b",
    });
  });

  it("does not switch mode when the version fails to load, and retries the same version", async () => {
    respond({
      [`GET ${listUrl}/rev-old`]: () =>
        Object.assign(new Error("Boom"), { code: "X" }),
    });
    await mountHook();

    await act(async () => {
      await latest?.select("rev-old", "<h1>title</h1>\n");
    });
    expect(latest?.selectedId).toBeNull();
    expect(latest?.errorMessage).toBe("Boom");
    expect(latest?.retryable).toBe(true);

    respond();
    await act(async () => {
      await latest?.retry("<h1>edited meanwhile</h1>\n");
    });
    expect(latest?.selectedId).toBe("rev-old");
    expect(latest?.errorMessage).toBeUndefined();
    expect(latest?.retryable).toBe(false);
    // O diff do "tentar de novo" usa o conteúdo ATUAL do editor.
    expect(
      latest?.diffLines.some(
        (line) => line.text === "<h1>edited meanwhile</h1>",
      ),
    ).toBe(true);
  });

  it("reloads the list on retry when the list itself failed", async () => {
    respond({
      [`GET ${listUrl}?pageSize=50`]: () =>
        Object.assign(new Error("List down"), { code: "X" }),
    });
    await mountHook();
    expect(latest?.status).toBe("error");
    expect(latest?.retryable).toBe(true);

    respond();
    await act(async () => {
      await latest?.retry("");
    });
    expect(latest?.status).toBe("ready");
  });

  it("leaves the comparison and clears the version", async () => {
    respond();
    await mountHook();
    await act(async () => {
      await latest?.select("rev-old", "<h1>title</h1>\n");
    });
    act(() => latest?.closeView());
    expect(latest?.selectedId).toBeNull();
    expect(latest?.version).toBeNull();
    expect(latest?.diffLines).toEqual([]);
  });

  it("restores with the expected updatedAt, returns the resource and leaves the comparison", async () => {
    const restored = {
      page: { id: "page-1", updatedAt: "2026-08-13T13:00:00.000Z" },
    };
    respond({ [`POST ${listUrl}/rev-old/restore`]: restored });
    await mountHook("2026-08-13T12:00:00.000Z");
    await act(async () => {
      await latest?.select("rev-old", "<h1>title</h1>\n");
    });

    let result: unknown;
    await act(async () => {
      result = await latest?.restore("rev-old");
    });

    expect(result).toEqual(restored);
    expect(requestJsonMock).toHaveBeenCalledWith(`${listUrl}/rev-old/restore`, {
      method: "POST",
      body: JSON.stringify({ expectedUpdatedAt: "2026-08-13T12:00:00.000Z" }),
    });
    expect(latest?.selectedId).toBeNull();
    expect(latest?.conflict).toBe(false);
  });

  it("reports a conflict on restore without leaving the comparison", async () => {
    respond({
      [`POST ${listUrl}/rev-old/restore`]: () =>
        Object.assign(new Error("changed"), { code: "CONFLICT" }),
    });
    await mountHook();
    await act(async () => {
      await latest?.select("rev-old", "<h1>title</h1>\n");
    });

    let result: unknown = "unset";
    await act(async () => {
      result = await latest?.restore("rev-old");
    });

    expect(result).toBeNull();
    expect(latest?.conflict).toBe(true);
    expect(latest?.selectedId).toBe("rev-old");
  });

  it("bumps the expand-all signal on demand", async () => {
    respond();
    await mountHook();
    const before = latest?.expandAllSignal ?? 0;
    act(() => latest?.expandAll());
    expect(latest?.expandAllSignal).toBe(before + 1);
  });
});

describe("StatusToggle inert availability", () => {
  it("stays visible and disabled when the resource was never published", () => {
    const html = renderToStaticMarkup(
      createElement(StatusToggle, {
        appearance: "switch",
        published: false,
        publishedLabel: "Activated",
        draftLabel: "Deactivated",
        publishLabel: "Activate",
        unpublishLabel: "Deactivate",
        disabled: true,
        onToggle: () => undefined,
      }),
    );
    expect(html).toContain("Deactivated");
    expect(html).toContain("disabled");
    expect(html).toContain('aria-disabled="true"');
  });
});
