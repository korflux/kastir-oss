// @vitest-environment jsdom

/**
 * Fase 2, T3: o editor de Pages no modelo do switch (spec A1 a A10, C1, C2). Jornadas
 * observáveis no DOM, com o servidor simulado em `requestJson` (estado de verdade: rascunho,
 * versão publicada, versões, `updatedAt` otimista):
 *   - ligar com edição não salva SALVA e publica o conteúdo do editor; sem alteração reativa a
 *     versão publicada (publicar é recusado e o ativar entra); nunca publicada só publica;
 *   - desligar pede confirmação e preserva a edição não salva;
 *   - "Salvar e publicar" no ar, inclusive a recusa benigna "sem alteração";
 *   - "Salvar sem publicar" e "Pré-visualizar" pelo menu ⋯;
 *   - comparação de versão pausa formulário, switch, botão e menu e Voltar a editar retoma;
 *   - restaurar não publica, mostra Desfazer, e Desfazer regrava o rascunho anterior;
 *   - item novo: criar, ou ligar = criar e publicar, sem `?created=1`;
 *   - falhas: salvar falho não publica, publicar falho deixa o rascunho salvo.
 * CodeMirror (editor e diff) e o diálogo do Base UI são trocados por stubs mínimos: o que se
 * prova aqui é a orquestração do editor, não esses componentes (têm testes próprios).
 */

import { createHash } from "node:crypto";

import {
  act,
  createElement,
  type AnchorHTMLAttributes,
  type ReactNode,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const requestJsonMock = vi.hoisted(() => vi.fn());
const routerMock = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));

vi.mock("next/link", () => ({
  default: ({
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { children?: ReactNode }) =>
    createElement("a", props, children),
}));

vi.mock("@/lib/requestJson", () => ({ requestJson: requestJsonMock }));

// Editor de código: um textarea controlado simula a edição do conteúdo. Como o CodeMirror real,
// ele reemite `onChange` quando o conteúdo é trocado por fora (restaurar, desfazer): é o que
// derrubaria o aviso com "Desfazer" se o editor tratasse essa reemissão como edição do usuário.
vi.mock("@/lib/Modules/Pages/Components/PageEditor", async () => {
  const { createElement: h, useEffect, useRef } = await import("react");
  return {
    PageEditor: ({
      ariaLabel,
      onChange,
      value,
    }: {
      ariaLabel: string;
      onChange: (value: string) => void;
      value: string;
    }) => {
      const doc = useRef(value);
      useEffect(() => {
        if (doc.current === value) return;
        doc.current = value;
        onChange(value);
      }, [onChange, value]);
      return h("textarea", {
        "aria-label": ariaLabel,
        "data-testid": "content",
        value,
        onChange: (event: { target: { value: string } }) => {
          doc.current = event.target.value;
          onChange(event.target.value);
        },
      });
    },
  };
});

// Diff em CodeMirror: o stub expõe as linhas, o rodapé e o nome acessível para provar o que o
// editor repassa.
vi.mock("@/lib/Modules/Revisions/Components/RevisionDiffPane", () => ({
  RevisionDiffPane: ({
    ariaLabel,
    footer,
    lines,
  }: {
    ariaLabel?: string;
    footer?: string;
    lines: Array<{ marker: string; text: string }>;
  }) =>
    createElement(
      "div",
      { "aria-label": ariaLabel, "data-testid": "diff-pane" },
      lines.map((line, index) =>
        createElement("div", { key: index }, `${line.marker}${line.text}`),
      ),
      footer
        ? createElement("p", { "data-testid": "diff-footer" }, footer)
        : null,
    ),
}));

// Diálogo: expõe título, frase, corpo e botões, sem depender do portal do Base UI.
vi.mock("@/components/Shared/ConfirmDialog", () => ({
  ConfirmDialog: ({
    busy,
    cancelLabel,
    children,
    confirmLabel,
    description,
    onConfirm,
    onOpenChange,
    open,
    title,
  }: {
    busy?: boolean;
    cancelLabel?: string;
    children?: ReactNode;
    confirmLabel: string;
    description: string;
    onConfirm: () => void | Promise<void>;
    onOpenChange: (open: boolean) => void;
    open: boolean;
    title: string;
  }) =>
    open
      ? createElement(
          "div",
          { "aria-label": title, "data-testid": "confirm", role: "dialog" },
          createElement("h2", null, title),
          createElement("p", null, description),
          children,
          createElement(
            "button",
            {
              "data-testid": "confirm-yes",
              disabled: busy,
              onClick: () => void onConfirm(),
            },
            confirmLabel,
          ),
          createElement(
            "button",
            { "data-testid": "confirm-no", onClick: () => onOpenChange(false) },
            cancelLabel,
          ),
        )
      : null,
}));

import { PageEditorScreen } from "@/lib/Modules/Pages/Components/PageEditorScreen";
import { fillRevisionCopy } from "@/lib/Modules/Revisions/Components/RevisionHistoryPanel";
import { formatPanelDateTime } from "@/lib/Modules/Settings/format";
import { getPanelDictionary } from "@/lib/i18n/panel";

const dictionary = getPanelDictionary("en");
const pages = dictionary.pages;
const publishing = pages.publishing;
const revisions = dictionary.revisions;

/* -------------------------------------------------------------------------- */
/* Servidor simulado                                                           */
/* -------------------------------------------------------------------------- */

type Snap = {
  title: string;
  slug: string;
  content: string;
  folderId: string;
  seoTitle: string | null;
  seoDescription: string | null;
  seoKeyword: string | null;
};

type Call = { method: string; url: string; body?: Record<string, unknown> };

const BASE_SNAP: Snap = {
  title: "Home",
  slug: "home",
  content: "<p>old</p>",
  folderId: "f-base",
  seoTitle: null,
  seoDescription: null,
  seoKeyword: null,
};

const server = {
  draft: { ...BASE_SNAP } as Snap,
  published: null as { id: string; snap: Snap } | null,
  live: false,
  revisions: [] as Array<{
    id: string;
    snap: Snap;
    createdAt: string;
    pinned: boolean;
  }>,
  updatedAt: "",
  tick: 0,
  nextRevision: 1,
  calls: [] as Call[],
  failures: new Map<string, { code?: string; message: string }>(),
};

const fingerprintOf = (snap: Snap) =>
  createHash("sha1").update(JSON.stringify(snap)).digest("hex");

function bump() {
  server.tick += 1;
  server.updatedAt = new Date(
    Date.UTC(2026, 9, 14, 12, 0, server.tick),
  ).toISOString();
}

/** Estado inicial do servidor: item existente, fora do ar e nunca publicado, salvo e em dia. */
function seed(
  options: {
    live?: boolean;
    published?: Partial<Snap> | null;
    draft?: Partial<Snap>;
    revisions?: Array<{ id: string; snap: Partial<Snap>; createdAt: string }>;
  } = {},
) {
  server.tick = 0;
  server.calls = [];
  server.failures = new Map();
  server.draft = { ...BASE_SNAP, ...options.draft };
  server.live = Boolean(options.live);
  server.revisions = (options.revisions ?? []).map((revision) => ({
    ...revision,
    snap: { ...BASE_SNAP, ...revision.snap },
    pinned: false,
  }));
  server.nextRevision = server.revisions.length + 1;
  server.published = options.published
    ? {
        id: "r-published",
        snap: { ...BASE_SNAP, ...options.published },
      }
    : null;
  if (server.published) {
    server.revisions.unshift({
      id: server.published.id,
      snap: server.published.snap,
      createdAt: "2026-10-14T09:00:00.000Z",
      pinned: false,
    });
  }
  bump();
}

function pageDto(withAuthor = true) {
  return {
    id: "p1",
    ...server.draft,
    status: server.live ? "PUBLISHED" : "DRAFT",
    publishedAt: server.published ? "2026-10-14T09:00:00.000Z" : null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: server.updatedAt,
    publishedRevisionId: server.published?.id ?? null,
    hasUnpublishedChanges: server.published
      ? fingerprintOf(server.draft) !== fingerprintOf(server.published.snap)
      : true,
    draftFingerprint: fingerprintOf(server.draft),
    ...(withAuthor ? { author: { id: "u1", name: "Ana" } } : {}),
  };
}

function fail(code: string | undefined, message: string): never {
  throw Object.assign(new Error(message), { code });
}

/** Rotas do painel que o editor usa; qualquer outra é falha do teste. */
async function handle(url: string, init?: RequestInit) {
  const method = init?.method ?? "GET";
  const body = init?.body
    ? (JSON.parse(init.body as string) as Record<string, unknown>)
    : undefined;
  server.calls.push({ method, url, body });

  const failure = server.failures.get(`${method} ${url}`);
  if (failure) fail(failure.code, failure.message);

  if (method === "GET" && url === "/api/admin/pages") {
    return {
      folders: [
        {
          id: "f-base",
          name: "Base",
          color: null,
          parentId: null,
          isBase: true,
        },
      ],
    };
  }
  if (method === "GET" && url === "/api/admin/pages/p1") {
    return { page: pageDto() };
  }
  if (method === "POST" && url === "/api/admin/pages") {
    server.draft = { ...BASE_SNAP, ...(body as Partial<Snap>) };
    bump();
    return { page: { ...pageDto(false), id: "new-id" } };
  }
  if (method === "PUT" && url === "/api/admin/pages/p1") {
    if (body?.expectedUpdatedAt !== server.updatedAt) {
      fail("CONFLICT", "Page was updated by another request");
    }
    const values = { ...body } as Partial<Snap> & {
      expectedUpdatedAt?: string;
    };
    delete values.expectedUpdatedAt;
    server.draft = { ...server.draft, ...values };
    bump();
    return { page: pageDto(false) };
  }

  const lifecycle =
    /^\/api\/admin\/pages\/(p1|new-id)\/(publish|activate|unpublish)$/.exec(
      url,
    );
  if (method === "POST" && lifecycle) {
    const action = lifecycle[2];
    if (action === "publish") {
      if (
        server.published &&
        fingerprintOf(server.draft) === fingerprintOf(server.published.snap)
      ) {
        fail("INVALID_STATE", "Page has no unpublished changes");
      }
      const id = `r${server.nextRevision++}`;
      server.published = { id, snap: { ...server.draft } };
      server.revisions.unshift({
        id,
        snap: { ...server.draft },
        createdAt: "2026-10-14T12:30:00.000Z",
        pinned: false,
      });
      server.live = true;
    } else if (action === "activate") {
      if (!server.published)
        fail("INVALID_STATE", "Page has no published revision");
      server.live = true;
    } else {
      server.live = false;
    }
    bump();
    return { page: { ...pageDto(false), id: lifecycle[1] } };
  }

  if (method === "GET" && url.startsWith("/api/admin/pages/p1/revisions?")) {
    return {
      items: server.revisions.map((revision) => ({
        id: revision.id,
        fingerprint: fingerprintOf(revision.snap),
        authorId: "u1",
        authorName: "Ana",
        createdAt: revision.createdAt,
        pinned: revision.pinned,
        published: revision.id === server.published?.id,
      })),
    };
  }
  const revisionGet = /^\/api\/admin\/pages\/p1\/revisions\/([^/]+)$/.exec(url);
  if (method === "GET" && revisionGet) {
    const revision = server.revisions.find(
      (item) => item.id === revisionGet[1],
    );
    if (!revision) fail("NOT_FOUND", "Revision not found");
    return {
      revision: {
        ...revision.snap,
        id: revision.id,
        createdAt: revision.createdAt,
      },
    };
  }
  const restore = /^\/api\/admin\/pages\/p1\/revisions\/([^/]+)\/restore$/.exec(
    url,
  );
  if (method === "POST" && restore) {
    if (body?.expectedUpdatedAt !== server.updatedAt) {
      fail("CONFLICT", "Page was updated by another request");
    }
    const revision = server.revisions.find((item) => item.id === restore[1])!;
    server.draft = { ...revision.snap };
    bump();
    return { page: pageDto(false) };
  }

  throw new Error(`Rota não simulada: ${method} ${url}`);
}

/* -------------------------------------------------------------------------- */
/* Montagem e interação                                                        */
/* -------------------------------------------------------------------------- */

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  requestJsonMock.mockImplementation(handle);
  routerMock.replace.mockReset();
  routerMock.push.mockReset();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  document.body.innerHTML = "";
  requestJsonMock.mockReset();
  vi.restoreAllMocks();
});

/** Deixa as cadeias de promessas e efeitos assentarem (várias voltas de macrotarefa). */
async function flush() {
  for (let index = 0; index < 5; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function mountEditor(pageId = "p1") {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      createElement(PageEditorScreen, {
        dictionary: pages,
        pageId,
        revisions,
      }),
    );
  });
  await flush();
}

const byTestId = (id: string) =>
  document.body.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const switchEl = () =>
  document.body.querySelector<HTMLButtonElement>('[role="switch"]')!;
const primary = () => byTestId("editor-primary-action") as HTMLButtonElement;
const moreActions = () => byTestId("editor-more-actions") as HTMLButtonElement;
const contentInput = () => byTestId("content") as HTMLTextAreaElement;
const titleInput = () =>
  document.body.querySelector<HTMLInputElement>("#page-title")!;
const pageText = () => document.body.textContent ?? "";

/** Campo controlado do React: precisa do setter nativo e de um evento `input`. */
async function setValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
      element,
      value,
    );
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(element: Element | null) {
  expect(element).not.toBeNull();
  await act(async () => {
    (element as HTMLElement).click();
  });
  await flush();
}

/** O menu do Base UI abre por teclado no jsdom (o clique do mouse depende de eventos de ponteiro). */
async function openMoreActions() {
  await act(async () => {
    moreActions().focus();
    moreActions().dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
    );
  });
}

/** Chamadas que mudam o servidor, na ordem, como "METHOD /caminho" (sem as leituras). */
const mutations = () =>
  server.calls
    .filter((call) => call.method !== "GET")
    .map((call) => `${call.method} ${call.url}`);

const REVISION_ROWS = [
  {
    id: "r-old",
    snap: { title: "Old title", content: "<p>older</p>" },
    createdAt: "2026-10-10T08:15:00.000Z",
  },
];

/* -------------------------------------------------------------------------- */
/* Ligar o switch                                                              */
/* -------------------------------------------------------------------------- */

describe("PageEditorScreen: ligar o switch (A2, A3, C1)", () => {
  it("com edição não salva: salva e publica exatamente o conteúdo do editor", async () => {
    seed({ published: {} });
    await mountEditor();
    expect(switchEl().getAttribute("aria-checked")).toBe("false");

    await setValue(contentInput(), "<p>new</p>");
    await click(switchEl());

    expect(mutations()).toEqual([
      "PUT /api/admin/pages/p1",
      "POST /api/admin/pages/p1/publish",
    ]);
    expect(
      server.calls.find((call) => call.method === "PUT")?.body,
    ).toMatchObject({
      content: "<p>new</p>",
      expectedUpdatedAt: expect.any(String),
    });
    expect(server.published?.snap.content).toBe("<p>new</p>");
    expect(switchEl().getAttribute("aria-checked")).toBe("true");
    expect(pageText()).toContain(publishing.noticeSavedAndPublished);
    expect(server.revisions).toHaveLength(2);
  });

  it("sem alteração (rascunho igual ao publicado): publicar é recusado e só reativa a versão, sem versão nova", async () => {
    seed({ published: {} });
    await mountEditor();

    await click(switchEl());

    expect(mutations()).toEqual([
      "POST /api/admin/pages/p1/publish",
      "POST /api/admin/pages/p1/activate",
    ]);
    expect(server.revisions).toHaveLength(1);
    expect(switchEl().getAttribute("aria-checked")).toBe("true");
    expect(pageText()).toContain(publishing.noticeBackLive);
    expect(document.body.querySelector('[role="alert"]')).toBeNull();
  });

  it("nunca publicada, sem edição: publica o rascunho salvo e não tenta ativar", async () => {
    seed();
    await mountEditor();
    expect(switchEl().textContent).toBe(publishing.switchNeverPublished);

    await click(switchEl());

    expect(mutations()).toEqual(["POST /api/admin/pages/p1/publish"]);
    expect(server.published?.snap.content).toBe("<p>old</p>");
    expect(pageText()).toContain(publishing.noticePublished);
  });

  it("salvar falho não publica nada e o switch continua fora do ar", async () => {
    seed({ published: {} });
    await mountEditor();
    server.failures.set("PUT /api/admin/pages/p1", {
      code: "CONFLICT",
      message: "Page was updated by another request",
    });

    await setValue(contentInput(), "<p>new</p>");
    await click(switchEl());

    expect(mutations()).toEqual(["PUT /api/admin/pages/p1"]);
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(
      revisions.conflict,
    );
    expect(switchEl().getAttribute("aria-checked")).toBe("false");
    expect(contentInput().value).toBe("<p>new</p>");
  });

  it("publicar falho depois de salvar: rascunho fica salvo, switch fora do ar e erro do servidor visível", async () => {
    seed({ published: {} });
    await mountEditor();
    server.failures.set("POST /api/admin/pages/p1/publish", {
      code: "VALIDATION_ERROR",
      message: "Referenced media is not ready",
    });

    await setValue(contentInput(), "<p>new</p>");
    await click(switchEl());

    expect(mutations()).toEqual([
      "PUT /api/admin/pages/p1",
      "POST /api/admin/pages/p1/publish",
    ]);
    expect(server.draft.content).toBe("<p>new</p>");
    expect(switchEl().getAttribute("aria-checked")).toBe("false");
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(
      "Referenced media is not ready",
    );
    // O rascunho foi salvo: já não há "Não salvo".
    expect(byTestId("editor-unsaved-indicator")).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Tirar do ar                                                                 */
/* -------------------------------------------------------------------------- */

describe("PageEditorScreen: desligar o switch (A5)", () => {
  it("pede confirmação, cancelar não muda nada e confirmar tira do ar preservando a edição não salva", async () => {
    seed({ live: true, published: {} });
    await mountEditor();
    await setValue(contentInput(), "<p>unsaved edit</p>");

    await click(switchEl());
    const dialog = byTestId("confirm");
    expect(dialog?.textContent).toContain(publishing.unpublishTitle);
    expect(dialog?.textContent).toContain(publishing.unpublishDescription);
    expect(mutations()).toEqual([]);

    await click(byTestId("confirm-no"));
    expect(byTestId("confirm")).toBeNull();
    expect(mutations()).toEqual([]);
    expect(switchEl().getAttribute("aria-checked")).toBe("true");

    await click(switchEl());
    await click(byTestId("confirm-yes"));

    expect(mutations()).toEqual(["POST /api/admin/pages/p1/unpublish"]);
    expect(switchEl().getAttribute("aria-checked")).toBe("false");
    expect(contentInput().value).toBe("<p>unsaved edit</p>");
    expect(byTestId("editor-unsaved-indicator")).not.toBeNull();
    expect(pageText()).toContain(publishing.noticeTakenOffline);
  });

  it("falha do servidor: o item continua no ar e a faixa mostra o erro", async () => {
    seed({ live: true, published: {} });
    await mountEditor();
    server.failures.set("POST /api/admin/pages/p1/unpublish", {
      code: "INTERNAL",
      message: "Could not take the page offline",
    });

    await click(switchEl());
    await click(byTestId("confirm-yes"));

    expect(switchEl().getAttribute("aria-checked")).toBe("true");
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(
      "Could not take the page offline",
    );
    expect(byTestId("confirm")).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Salvar e publicar, Salvar sem publicar, Pré-visualizar                       */
/* -------------------------------------------------------------------------- */

describe("PageEditorScreen: item no ar (A4, A6)", () => {
  it("em dia: 'Salvar e publicar' desabilitado; com edição salva e publica, criando versão", async () => {
    seed({ live: true, published: {} });
    await mountEditor();
    expect(primary().textContent).toBe(publishing.buttonSaveAndPublish);
    expect(primary().disabled).toBe(true);
    expect(byTestId("editor-pending-banner")).toBeNull();

    await setValue(contentInput(), "<p>v2</p>");
    expect(primary().disabled).toBe(false);
    await click(primary());

    expect(mutations()).toEqual([
      "PUT /api/admin/pages/p1",
      "POST /api/admin/pages/p1/publish",
    ]);
    expect(server.published?.snap.content).toBe("<p>v2</p>");
    expect(server.revisions).toHaveLength(2);
    expect(pageText()).toContain(publishing.noticeSavedAndPublished);
    expect(primary().disabled).toBe(true);
  });

  it("com alterações salvas não publicadas: faixa inline e publicar sem salvar de novo", async () => {
    seed({
      live: true,
      published: {},
      draft: { content: "<p>saved only</p>" },
    });
    await mountEditor();

    expect(byTestId("editor-pending-banner")?.textContent).toBe(
      publishing.pendingBanner,
    );
    expect(primary().disabled).toBe(false);

    await click(primary());

    expect(mutations()).toEqual(["POST /api/admin/pages/p1/publish"]);
    expect(pageText()).toContain(publishing.noticePublished);
    expect(byTestId("editor-pending-banner")).toBeNull();
  });

  it("se o salvar deixa o rascunho igual ao que está no ar, a recusa 'sem alteração' é sucesso benigno", async () => {
    seed({
      live: true,
      published: {},
      draft: { content: "<p>saved only</p>" },
    });
    await mountEditor();

    // O usuário volta o texto ao que já está no ar: salvar iguala rascunho e publicado.
    await setValue(contentInput(), "<p>old</p>");
    await click(primary());

    expect(mutations()).toEqual([
      "PUT /api/admin/pages/p1",
      "POST /api/admin/pages/p1/publish",
    ]);
    expect(document.body.querySelector('[role="alert"]')).toBeNull();
    // O aviso descreve o resultado real (C1/A4): salvou, mas nada foi publicado.
    expect(pageText()).toContain(publishing.noticeSavedAlreadyLive);
    expect(pageText()).not.toContain(publishing.noticeSavedAndPublished);
    expect(server.revisions).toHaveLength(1);
  });

  it("'Salvar sem publicar' no menu grava o rascunho e não toca no ar", async () => {
    seed({ live: true, published: {} });
    await mountEditor();
    await setValue(contentInput(), "<p>draft only</p>");

    await openMoreActions();
    await click(byTestId("editor-menu-saveWithoutPublishing"));

    expect(mutations()).toEqual(["PUT /api/admin/pages/p1"]);
    expect(server.published?.snap.content).toBe("<p>old</p>");
    expect(server.draft.content).toBe("<p>draft only</p>");
    expect(switchEl().getAttribute("aria-checked")).toBe("true");
    expect(pageText()).toContain(publishing.noticeSavedNotPublished);
    expect(byTestId("editor-pending-banner")).not.toBeNull();
  });

  it("o menu mostra a versão no ar (data, hora e autor) e Pré-visualizar", async () => {
    seed({ live: true, published: {} });
    await mountEditor();

    await openMoreActions();

    const info = byTestId("editor-version-info")?.textContent;
    expect(info).toBe(
      fillRevisionCopy(publishing.menuLiveVersion, {
        date: formatPanelDateTime("2026-10-14T09:00:00.000Z", undefined, "en"),
        author: "Ana",
      }),
    );
    expect(byTestId("editor-menu-preview")).not.toBeNull();
    // Sem edição não salva, "Salvar sem publicar" não se aplica e não aparece.
    expect(byTestId("editor-menu-saveWithoutPublishing")).toBeNull();
  });

  it("Pré-visualizar com edição: abre a aba no clique, salva sem publicar e navega para /p/<slug>", async () => {
    seed({ live: true, published: {} });
    await mountEditor();
    await setValue(contentInput(), "<p>preview me</p>");
    const tab = { opener: "panel", location: { href: "" }, close: vi.fn() };
    const open = vi
      .spyOn(window, "open")
      .mockReturnValue(tab as unknown as Window);

    await openMoreActions();
    await click(byTestId("editor-menu-preview"));

    expect(open).toHaveBeenCalledWith("about:blank", "_blank");
    expect(tab.opener).toBeNull();
    expect(tab.location.href).toBe("/p/home");
    expect(mutations()).toEqual(["PUT /api/admin/pages/p1"]);
    expect(server.published?.snap.content).toBe("<p>old</p>");
    expect(tab.close).not.toHaveBeenCalled();
  });

  it("Pré-visualizar com erro no salvar: fecha a aba em branco e não abre a pré-visualização", async () => {
    seed({ live: true, published: {} });
    await mountEditor();
    await setValue(contentInput(), "<p>preview me</p>");
    server.failures.set("PUT /api/admin/pages/p1", {
      code: "VALIDATION_ERROR",
      message: "Invalid page",
    });
    const tab = { opener: "panel", location: { href: "" }, close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);

    await openMoreActions();
    await click(byTestId("editor-menu-preview"));

    expect(tab.close).toHaveBeenCalledTimes(1);
    expect(tab.location.href).toBe("");
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(
      "Invalid page",
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Comparação de versão                                                        */
/* -------------------------------------------------------------------------- */

describe("PageEditorScreen: comparação de versão (A7, A8)", () => {
  it("pausa formulário, switch, botão e menu com a dica; Voltar a editar devolve tudo intacto", async () => {
    seed({ live: true, published: {}, revisions: REVISION_ROWS });
    await mountEditor();
    await setValue(contentInput(), "<p>unsaved edit</p>");

    await click(
      document.body.querySelector('[data-testid="revision-row-r-old"] button'),
    );

    expect(byTestId("revision-compare-bar")).not.toBeNull();
    expect(byTestId("content")).toBeNull();
    expect(byTestId("diff-pane")).not.toBeNull();
    expect(titleInput().disabled).toBe(true);
    expect(switchEl().disabled).toBe(true);
    expect(primary().disabled).toBe(true);
    expect(moreActions().disabled).toBe(true);
    expect(byTestId("editor-paused-hint")?.textContent).toBe(
      publishing.reasonInspecting,
    );
    expect(byTestId("editor-form-paused-note")?.textContent).toBe(
      revisions.formPausedNote,
    );
    // A nota vive no slot fixo do Details, fora da área que rola: nunca cobre um campo.
    expect(
      byTestId("editor-form-paused-note")?.closest(
        '[data-testid="details-notice"]',
      ),
    ).not.toBeNull();
    const scroller = byTestId("details-notice")?.parentElement?.querySelector(
      ":scope > .overflow-y-auto",
    );
    expect(scroller).not.toBeNull();
    expect(
      scroller?.contains(byTestId("editor-form-paused-note") as Node),
    ).toBe(false);
    // O código somente leitura tem nome próprio, distinto da região "Versões".
    expect(byTestId("diff-pane")?.getAttribute("aria-label")).toBe(
      revisions.versionCode,
    );
    expect(revisions.versionCode).not.toBe(revisions.title);
    // Restaurar indisponível por edição não salva, com o motivo ao lado.
    expect(byTestId("revision-restore-reason")?.textContent).toBe(
      revisions.restoreBlockedDirty,
    );
    expect(byTestId("diff-footer")?.textContent).toContain("Ana");
    // Os campos fora do código que o restaurar trocaria aparecem na barra.
    expect(byTestId("revision-field-name")?.textContent).toContain("Old title");

    const back = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === revisions.backToEditing,
    );
    await click(back ?? null);

    expect(byTestId("revision-compare-bar")).toBeNull();
    expect(contentInput().value).toBe("<p>unsaved edit</p>");
    expect(titleInput().disabled).toBe(false);
    expect(switchEl().disabled).toBe(false);
    expect(mutations()).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Selo da linha Rascunho                                                      */
/* -------------------------------------------------------------------------- */

describe("PageEditorScreen: selo da linha Rascunho", () => {
  const draftRow = () => byTestId("revision-row-draft")?.textContent ?? "";

  it("fora do ar, com o rascunho igual à versão publicada guardada: 'igual à publicada', não 'igual ao ar'", async () => {
    seed({ live: false, published: {} });
    await mountEditor();

    expect(draftRow()).toContain(revisions.draftSameAsPublished);
    expect(draftRow()).not.toContain(revisions.draftSameAsLive);
  });

  it("no ar, com o rascunho igual à versão publicada: 'igual ao ar'", async () => {
    seed({ live: true, published: {} });
    await mountEditor();

    expect(draftRow()).toContain(revisions.draftSameAsLive);
    expect(draftRow()).not.toContain(revisions.draftSameAsPublished);
  });
});

/* -------------------------------------------------------------------------- */
/* Restaurar e desfazer                                                        */
/* -------------------------------------------------------------------------- */

describe("PageEditorScreen: restaurar e Desfazer (A9, A10)", () => {
  const restoreButton = () =>
    [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === revisions.restoreAction,
    ) ?? null;

  it("a confirmação lista código e campos; confirmar restaura sem publicar e Desfazer devolve o rascunho anterior", async () => {
    seed({
      published: {},
      draft: { title: "Current title", content: "<p>current draft</p>" },
      revisions: REVISION_ROWS,
    });
    await mountEditor();
    const savedBeforeRestore = server.updatedAt;

    await click(
      document.body.querySelector('[data-testid="revision-row-r-old"] button'),
    );
    expect(restoreButton()?.disabled).toBe(false);
    await click(restoreButton());

    // Confirmação: título com data e autor, frase "nada é publicado" e a lista de campos.
    const dialog = byTestId("confirm");
    expect(dialog?.textContent).toContain(revisions.confirmRestoreDescription);
    expect(byTestId("revision-restore-list")?.textContent).toContain(
      "Old title",
    );
    expect(byTestId("revision-restore-warning")).not.toBeNull();

    await click(byTestId("confirm-yes"));

    // Restaurou com o updatedAt carregado, no rascunho, e nada foi publicado nem ativado.
    expect(mutations()).toEqual([
      "POST /api/admin/pages/p1/revisions/r-old/restore",
    ]);
    expect(
      server.calls.find((call) => call.url.endsWith("/restore"))?.body,
    ).toEqual({ expectedUpdatedAt: savedBeforeRestore });
    expect(server.draft.title).toBe("Old title");
    expect(server.published?.snap.content).toBe("<p>old</p>");
    expect(titleInput().value).toBe("Old title");
    expect(contentInput().value).toBe("<p>older</p>");
    expect(byTestId("revision-compare-bar")).toBeNull();
    const restoredAt = server.updatedAt;
    expect(
      document.body.querySelector('[role="status"]')?.textContent,
    ).toContain(
      fillRevisionCopy(revisions.restored, {
        date: formatPanelDateTime("2026-10-10T08:15:00.000Z", undefined, "en"),
      }),
    );

    // Desfazer: regrava o rascunho anterior pelo salvar normal, com o updatedAt do restaurar.
    await click(byTestId("editor-notice-action"));

    expect(mutations()).toEqual([
      "POST /api/admin/pages/p1/revisions/r-old/restore",
      "PUT /api/admin/pages/p1",
    ]);
    const undoCall = server.calls.find((call) => call.method === "PUT")!;
    expect(undoCall.body).toMatchObject({
      title: "Current title",
      content: "<p>current draft</p>",
      expectedUpdatedAt: restoredAt,
    });
    expect(server.draft.title).toBe("Current title");
    expect(titleInput().value).toBe("Current title");
    expect(contentInput().value).toBe("<p>current draft</p>");
    expect(pageText()).toContain(revisions.undone);
    expect(byTestId("editor-notice-action")).toBeNull();
  });

  it("restaurar com a pasta da versão excluída: o erro do servidor aparece e o formulário não muda", async () => {
    seed({
      published: {},
      draft: { title: "Current title" },
      revisions: REVISION_ROWS,
    });
    await mountEditor();
    server.failures.set("POST /api/admin/pages/p1/revisions/r-old/restore", {
      code: "NOT_FOUND",
      message: "Page folder was not found",
    });

    await click(
      document.body.querySelector('[data-testid="revision-row-r-old"] button'),
    );
    await click(restoreButton());
    await click(byTestId("confirm-yes"));

    expect(pageText()).toContain("Page folder was not found");
    expect(server.draft.title).toBe("Current title");
    expect(document.body.querySelector('[role="status"]')).toBeNull();
  });

  it("Desfazer com a página alterada em outra sessão: erro de conflito e nada é sobrescrito", async () => {
    seed({
      published: {},
      draft: { title: "Current title" },
      revisions: REVISION_ROWS,
    });
    await mountEditor();
    await click(
      document.body.querySelector('[data-testid="revision-row-r-old"] button'),
    );
    await click(restoreButton());
    await click(byTestId("confirm-yes"));

    // Outra sessão salva depois do restaurar: o updatedAt do Desfazer fica velho.
    bump();
    await click(byTestId("editor-notice-action"));

    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(
      revisions.conflict,
    );
    expect(server.draft.title).toBe("Old title");
  });
});

/* -------------------------------------------------------------------------- */
/* Item novo                                                                   */
/* -------------------------------------------------------------------------- */

describe("PageEditorScreen: item novo", () => {
  it("botão 'Criar', switch ligável com formulário válido e menu ⋯ desabilitado com motivo", async () => {
    seed();
    await mountEditor("new");

    expect(primary().textContent).toBe(publishing.buttonCreate);
    expect(primary().disabled).toBe(true);
    expect(moreActions().disabled).toBe(true);
    expect(pageText()).toContain(publishing.reasonNewItem);
    expect(switchEl().disabled).toBe(true);

    await setValue(titleInput(), "Nova");

    expect(primary().disabled).toBe(false);
    expect(switchEl().disabled).toBe(false);
    expect(switchEl().textContent).toBe(publishing.switchNeverPublished);
  });

  it("Criar grava o rascunho e vai para a página criada, sem ?created=1 e sem publicar", async () => {
    seed();
    await mountEditor("new");
    await setValue(titleInput(), "Nova");

    await click(primary());

    expect(mutations()).toEqual(["POST /api/admin/pages"]);
    expect(routerMock.replace).toHaveBeenCalledTimes(1);
    expect(routerMock.replace).toHaveBeenCalledWith("/admin/pages/new-id");
  });

  it("ligar o switch cria e publica numa só ação e vai para a página criada", async () => {
    seed();
    await mountEditor("new");
    await setValue(titleInput(), "Nova");

    await click(switchEl());

    expect(mutations()).toEqual([
      "POST /api/admin/pages",
      "POST /api/admin/pages/new-id/publish",
    ]);
    expect(routerMock.replace).toHaveBeenCalledTimes(1);
    expect(routerMock.replace).toHaveBeenCalledWith("/admin/pages/new-id");
    expect(server.live).toBe(true);
  });

  it("publicar falho depois de criar leva para a página criada (tentar de novo não duplica)", async () => {
    seed();
    await mountEditor("new");
    await setValue(titleInput(), "Nova");
    server.failures.set("POST /api/admin/pages/new-id/publish", {
      code: "VALIDATION_ERROR",
      message: "Referenced media is not ready",
    });

    await click(switchEl());

    expect(routerMock.replace).toHaveBeenCalledWith("/admin/pages/new-id");
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(
      "Referenced media is not ready",
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Controles removidos                                                         */
/* -------------------------------------------------------------------------- */

describe("PageEditorScreen: o modelo antigo saiu (C2)", () => {
  it("não existe botão Publicar, toggle Ativado nem link do título com ícone de envio", async () => {
    seed({ live: true, published: {} });
    await mountEditor();

    const labels = [...document.body.querySelectorAll("button")].map((button) =>
      (button.getAttribute("aria-label") ?? button.textContent ?? "").trim(),
    );
    // As chaves do modelo antigo (`pages.publish`, `activate`, `deactivate`, `activationPrompt`)
    // saíram do dicionário na T4; os textos que elas tinham, em en e pt-BR, seguem proibidos
    // na tela, então a asserção de ausência passa a usar o literal.
    for (const removedLabel of [
      "Publish",
      "Publicar",
      "Activate",
      "Ativar",
      "Deactivate",
      "Desativar",
    ]) {
      expect(labels).not.toContain(removedLabel);
    }
    for (const removedPromptTitle of ["Activate now?", "Ativar agora?"]) {
      expect(pageText()).not.toContain(removedPromptTitle);
    }
    expect(document.body.querySelector("h1")?.closest("a")).toBeNull();
  });
});
