// @vitest-environment jsdom

/**
 * Fase 2, T4: o editor de Scripts no modelo do switch (spec A1 a A10, C1, C2). Mesmas jornadas do
 * editor de Pages, observáveis no DOM, com o servidor simulado em `requestJson` (estado de
 * verdade: rascunho, versão publicada, versões, `updatedAt` otimista, catálogo de páginas):
 *   - ligar com edição não salva SALVA e publica o conteúdo do editor; sem alteração reativa a
 *     versão publicada (publicar é recusado e o ativar entra); nunca publicado só publica;
 *   - desligar pede a confirmação de SCRIPTS ("deixa de ser injetado no site") e preserva a
 *     edição não salva;
 *   - "Salvar e publicar" no ar, "Salvar sem publicar" pelo menu ⋯ e o menu SEM Pré-visualizar;
 *   - comparação pausa o formulário e lista os campos de script, com as páginas do escopo por
 *     nome (ids resolvidos por `?ids=`), e "página indisponível" para a que saiu do ar;
 *   - restaurar não publica e o Desfazer regrava o rascunho anterior inteiro (gatilho, escopo);
 *   - o seletor de escopo nomeia páginas selecionadas fora da lista carregada;
 *   - o modelo antigo saiu: sem Publicar, sem Ativado/Desativado, sem prompt "Ativar agora?".
 * Fase 3, T5 (A6, A7): carga inicial do snippet com um único GET (inclusive sob Strict Mode, com
 * retry e guarda contra resposta stale), sufixo do limite e cancelar da exclusão vindos do
 * dicionário em `en` e `pt-BR`, e seletor de escopo em carregamento antes da primeira resposta.
 * CodeMirror (editor e diff) e o diálogo do Base UI são trocados por stubs mínimos: o que se
 * prova aqui é a orquestração do editor, não esses componentes (têm testes próprios).
 */

import { createHash } from "node:crypto";

import {
  act,
  createElement,
  StrictMode,
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
      mediaCancelLabel,
      mediaCloseLabel,
      mediaSelectLabel,
      mediaTitle,
      onChange,
      value,
    }: {
      ariaLabel: string;
      mediaCancelLabel?: string;
      mediaCloseLabel?: string;
      mediaSelectLabel?: string;
      mediaTitle?: string;
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
        "data-media-cancel": mediaCancelLabel,
        "data-media-close": mediaCloseLabel,
        "data-media-select": mediaSelectLabel,
        "data-media-title": mediaTitle,
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

import { CustomCodeEditor } from "@/lib/Modules/CustomCode/Components/CustomCodeEditor";
import { fillRevisionCopy } from "@/lib/Modules/Revisions/Components/RevisionHistoryPanel";
import { formatPanelDateTime } from "@/lib/Modules/Settings/format";
import { getPanelDictionary } from "@/lib/i18n/panel";

const dictionary = getPanelDictionary("en");
const scripts = dictionary.customCode;
const publishing = scripts.publishing;
const revisions = dictionary.revisions;

/* -------------------------------------------------------------------------- */
/* Servidor simulado                                                           */
/* -------------------------------------------------------------------------- */

type Snap = {
  name: string;
  location: "HEADER" | "BODY_START" | "BODY_END";
  content: string;
  priority: number | null;
  scopeType: "ALL_PAGES" | "SPECIFIC_PAGES";
  pageIds: string[];
  triggerType: string | null;
  triggerConfig: Record<string, unknown> | null;
  maxDisplays: number | null;
  displayResetDays: number | null;
};

type Call = { method: string; url: string; body?: Record<string, unknown> };

const BASE_SNAP: Snap = {
  name: "Banner",
  location: "HEADER",
  content: "<script>old()</script>",
  priority: null,
  scopeType: "ALL_PAGES",
  pageIds: [],
  triggerType: null,
  triggerConfig: null,
  maxDisplays: null,
  displayResetDays: null,
};

/** Catálogo de páginas do site; `deleted` = na lixeira (a rota de ids não devolve). */
const CATALOG = [
  { id: "pg-1", title: "Home", slug: "home", deleted: false },
  { id: "pg-2", title: "Pricing", slug: "pricing", deleted: false },
  { id: "pg-3", title: "Contact", slug: "contact", deleted: false },
  { id: "pg-4", title: "Old promo", slug: "old-promo", deleted: true },
];

/** A lista paginada devolve só as duas primeiras: "pg-3" fica FORA da lista carregada. */
const LIST_VISIBLE = 2;

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

/** Estado inicial do servidor: script existente, fora do ar e nunca publicado, salvo e em dia. */
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
    ? { id: "r-published", snap: { ...BASE_SNAP, ...options.published } }
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

function snippetDto() {
  const { pageIds, ...rest } = server.draft;
  return {
    id: "s1",
    ...rest,
    scopedPages: pageIds.map((pageId) => ({ pageId })),
    status: server.live ? "PUBLISHED" : "DRAFT",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: server.updatedAt,
    publishedRevisionId: server.published?.id ?? null,
    hasUnpublishedChanges: server.published
      ? fingerprintOf(server.draft) !== fingerprintOf(server.published.snap)
      : true,
    draftFingerprint: fingerprintOf(server.draft),
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

  if (method === "GET" && url === "/api/admin/custom-code/s1") {
    return { snippet: snippetDto() };
  }
  if (method === "PUT" && url === "/api/admin/custom-code/s1") {
    if (body?.expectedUpdatedAt !== server.updatedAt) {
      fail("CONFLICT", "Script was updated by another request");
    }
    const { expectedUpdatedAt, trigger, ...values } = body as Record<
      string,
      unknown
    > & {
      trigger: { triggerType: string; triggerConfig: Record<string, unknown> };
    };
    void expectedUpdatedAt;
    server.draft = {
      ...server.draft,
      ...(values as Partial<Snap>),
      triggerType: trigger ? trigger.triggerType : null,
      triggerConfig: trigger ? trigger.triggerConfig : null,
    };
    bump();
    return { snippet: snippetDto() };
  }
  if (method === "DELETE" && url === "/api/admin/custom-code/s1") {
    return { ok: true };
  }

  const lifecycle =
    /^\/api\/admin\/custom-code\/s1\/(publish|activate|unpublish)$/.exec(url);
  if (method === "POST" && lifecycle) {
    const action = lifecycle[1];
    if (action === "publish") {
      if (
        server.published &&
        fingerprintOf(server.draft) === fingerprintOf(server.published.snap)
      ) {
        fail("INVALID_STATE", "Script has no unpublished changes");
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
        fail("INVALID_STATE", "Script has no published revision");
      server.live = true;
    } else {
      server.live = false;
    }
    bump();
    return { snippet: snippetDto() };
  }

  if (
    method === "GET" &&
    url.startsWith("/api/admin/custom-code/s1/revisions?")
  ) {
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
  const revisionGet =
    /^\/api\/admin\/custom-code\/s1\/revisions\/([^/]+)$/.exec(url);
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
  const restore =
    /^\/api\/admin\/custom-code\/s1\/revisions\/([^/]+)\/restore$/.exec(url);
  if (method === "POST" && restore) {
    if (body?.expectedUpdatedAt !== server.updatedAt) {
      fail("CONFLICT", "Script was updated by another request");
    }
    const revision = server.revisions.find((item) => item.id === restore[1])!;
    server.draft = { ...revision.snap };
    bump();
    return { snippet: snippetDto() };
  }

  // Catálogo de páginas do escopo: busca paginada (só as primeiras) ou resolução por ids.
  if (method === "GET" && url.startsWith("/api/admin/custom-code/pages?")) {
    const params = new URL(url, "http://localhost").searchParams;
    const live = CATALOG.filter((page) => !page.deleted);
    const dto = (page: (typeof CATALOG)[number]) => ({
      id: page.id,
      title: page.title,
      slug: page.slug,
    });
    const ids = params.get("ids");
    if (ids) {
      const wanted = ids.split(",");
      const items = live.filter((page) => wanted.includes(page.id)).map(dto);
      return { items, total: items.length, page: 1, pageSize: wanted.length };
    }
    return {
      items: live.slice(0, LIST_VISIBLE).map(dto),
      total: live.length,
      page: 1,
      pageSize: 25,
    };
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

/** O seletor de escopo carrega a lista depois do debounce de 200 ms e só então consulta por ids. */
async function waitForScopeList() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
  });
  await flush();
}

/**
 * Monta o editor do script "s1". Padrão: dicionário `en`, sem Strict Mode. `language` troca
 * dicionário e `locale` juntos (como a página do painel); `copy` sobrepõe só o bloco `customCode`
 * (prova que um texto vem do dicionário); `strict` monta sob Strict Mode, que remonta os effects.
 */
async function mountEditor(
  options: {
    copy?: typeof scripts;
    language?: "en" | "pt-BR";
    strict?: boolean;
  } = {},
) {
  const panel = getPanelDictionary(options.language ?? "en");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const editor = createElement(CustomCodeEditor, {
    dictionary: options.copy ?? panel.customCode,
    locale: options.language,
    revisions: panel.revisions,
    snippetId: "s1",
  });
  await act(async () => {
    root!.render(
      options.strict ? createElement(StrictMode, null, editor) : editor,
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
const nameInput = () =>
  document.body.querySelector<HTMLInputElement>("#snippet-name")!;
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

/** Versão antiga que difere do rascunho em TODOS os campos de script. */
const OLD_VERSION = {
  id: "r-old",
  snap: {
    name: "Old banner",
    location: "BODY_END",
    content: "<script>older()</script>",
    priority: 5,
    scopeType: "SPECIFIC_PAGES",
    pageIds: ["pg-3", "pg-4"],
    triggerType: "PAGE_LOAD",
    triggerConfig: { delaySeconds: 3 },
    maxDisplays: 2,
    displayResetDays: 7,
  } satisfies Partial<Snap>,
  createdAt: "2026-10-10T08:15:00.000Z",
};

const versionRowButton = (id: string) =>
  document.body.querySelector(`[data-testid="revision-row-${id}"] button`);

/* -------------------------------------------------------------------------- */
/* Ligar o switch                                                              */
/* -------------------------------------------------------------------------- */

describe("CustomCodeEditor: ligar o switch (A2, A3, C1)", () => {
  it("com edição não salva: salva e publica exatamente o conteúdo do editor", async () => {
    seed({ published: {} });
    await mountEditor();
    expect(switchEl().getAttribute("aria-checked")).toBe("false");

    await setValue(contentInput(), "<script>new()</script>");
    await click(switchEl());

    expect(mutations()).toEqual([
      "PUT /api/admin/custom-code/s1",
      "POST /api/admin/custom-code/s1/publish",
    ]);
    expect(
      server.calls.find((call) => call.method === "PUT")?.body,
    ).toMatchObject({
      content: "<script>new()</script>",
      expectedUpdatedAt: expect.any(String),
    });
    expect(server.published?.snap.content).toBe("<script>new()</script>");
    expect(switchEl().getAttribute("aria-checked")).toBe("true");
    expect(pageText()).toContain(publishing.noticeSavedAndPublished);
    expect(server.revisions).toHaveLength(2);
  });

  it("sem alteração (rascunho igual ao publicado): publicar é recusado e só reativa a versão, sem versão nova", async () => {
    seed({ published: {} });
    await mountEditor();

    await click(switchEl());

    expect(mutations()).toEqual([
      "POST /api/admin/custom-code/s1/publish",
      "POST /api/admin/custom-code/s1/activate",
    ]);
    expect(server.revisions).toHaveLength(1);
    expect(switchEl().getAttribute("aria-checked")).toBe("true");
    expect(pageText()).toContain(publishing.noticeBackLive);
    expect(document.body.querySelector('[role="alert"]')).toBeNull();
  });

  it("nunca publicado, sem edição: publica o rascunho salvo e não tenta ativar", async () => {
    seed();
    await mountEditor();
    expect(switchEl().textContent).toBe(publishing.switchNeverPublished);

    await click(switchEl());

    expect(mutations()).toEqual(["POST /api/admin/custom-code/s1/publish"]);
    expect(server.published?.snap.content).toBe("<script>old()</script>");
    expect(pageText()).toContain(publishing.noticePublished);
  });

  it("salvar falho não publica nada e o switch continua fora do ar", async () => {
    seed({ published: {} });
    await mountEditor();
    server.failures.set("PUT /api/admin/custom-code/s1", {
      code: "CONFLICT",
      message: "Script was updated by another request",
    });

    await setValue(contentInput(), "<script>new()</script>");
    await click(switchEl());

    expect(mutations()).toEqual(["PUT /api/admin/custom-code/s1"]);
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(
      revisions.conflict,
    );
    expect(switchEl().getAttribute("aria-checked")).toBe("false");
    expect(contentInput().value).toBe("<script>new()</script>");
  });

  it("publicar falho depois de salvar: rascunho fica salvo, switch fora do ar e erro do servidor visível", async () => {
    seed({ published: {} });
    await mountEditor();
    server.failures.set("POST /api/admin/custom-code/s1/publish", {
      code: "VALIDATION_ERROR",
      message: "Script could not be compiled",
    });

    await setValue(contentInput(), "<script>new()</script>");
    await click(switchEl());

    expect(mutations()).toEqual([
      "PUT /api/admin/custom-code/s1",
      "POST /api/admin/custom-code/s1/publish",
    ]);
    expect(server.draft.content).toBe("<script>new()</script>");
    expect(switchEl().getAttribute("aria-checked")).toBe("false");
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(
      "Script could not be compiled",
    );
    expect(byTestId("editor-unsaved-indicator")).toBeNull();
  });

  it("gatilho incompleto: nada é salvo nem publicado e a mensagem de validação aparece", async () => {
    seed({
      published: {},
      draft: {
        triggerType: "SELECTOR_EVENT",
        triggerConfig: { selector: "#buy", event: "click" },
      },
    });
    await mountEditor();

    await setValue(
      document.body.querySelector<HTMLInputElement>("#trigger-selector")!,
      "",
    );
    await click(switchEl());

    expect(mutations()).toEqual([]);
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(
      scripts.triggerValidationError,
    );
    expect(switchEl().getAttribute("aria-checked")).toBe("false");
  });
});

/* -------------------------------------------------------------------------- */
/* Tirar do ar                                                                 */
/* -------------------------------------------------------------------------- */

describe("CustomCodeEditor: desligar o switch (A5)", () => {
  it("pede a confirmação de scripts, cancelar não muda nada e confirmar tira do ar preservando a edição", async () => {
    seed({ live: true, published: {} });
    await mountEditor();
    await setValue(contentInput(), "<script>unsaved()</script>");

    await click(switchEl());
    const dialog = byTestId("confirm");
    expect(dialog?.textContent).toContain(publishing.unpublishTitle);
    expect(dialog?.textContent).toContain(publishing.unpublishDescription);
    // Texto de script ("deixa de ser injetado"), não o de página ("a URL passa a dar 404").
    expect(publishing.unpublishDescription).toMatch(/injected/i);
    expect(dialog?.textContent).not.toContain(
      dictionary.pages.publishing.unpublishDescription,
    );
    expect(mutations()).toEqual([]);

    await click(byTestId("confirm-no"));
    expect(byTestId("confirm")).toBeNull();
    expect(mutations()).toEqual([]);
    expect(switchEl().getAttribute("aria-checked")).toBe("true");

    await click(switchEl());
    await click(byTestId("confirm-yes"));

    expect(mutations()).toEqual(["POST /api/admin/custom-code/s1/unpublish"]);
    expect(switchEl().getAttribute("aria-checked")).toBe("false");
    expect(contentInput().value).toBe("<script>unsaved()</script>");
    expect(byTestId("editor-unsaved-indicator")).not.toBeNull();
    expect(pageText()).toContain(publishing.noticeTakenOffline);
  });

  it("falha do servidor: o script continua no ar e a faixa mostra o erro", async () => {
    seed({ live: true, published: {} });
    await mountEditor();
    server.failures.set("POST /api/admin/custom-code/s1/unpublish", {
      code: "INTERNAL",
      message: "Could not take the script offline",
    });

    await click(switchEl());
    await click(byTestId("confirm-yes"));

    expect(switchEl().getAttribute("aria-checked")).toBe("true");
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(
      "Could not take the script offline",
    );
    expect(byTestId("confirm")).toBeNull();
  });

  it("tirar do ar com escopo de páginas e gatilho não vira edição não salva (o DTO do ciclo é completo)", async () => {
    seed({
      live: true,
      published: {
        scopeType: "SPECIFIC_PAGES",
        pageIds: ["pg-1", "pg-3"],
        triggerType: "SCROLL",
        triggerConfig: { percentage: 40 },
        maxDisplays: 2,
        displayResetDays: 5,
      },
      draft: {
        scopeType: "SPECIFIC_PAGES",
        pageIds: ["pg-1", "pg-3"],
        triggerType: "SCROLL",
        triggerConfig: { percentage: 40 },
        maxDisplays: 2,
        displayResetDays: 5,
      },
    });
    await mountEditor();

    await click(switchEl());
    await click(byTestId("confirm-yes"));

    expect(switchEl().getAttribute("aria-checked")).toBe("false");
    expect(byTestId("editor-unsaved-indicator")).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Salvar e publicar, Salvar sem publicar, menu ⋯                              */
/* -------------------------------------------------------------------------- */

describe("CustomCodeEditor: script no ar (A4, A6)", () => {
  it("em dia: 'Salvar e publicar' desabilitado; com edição salva e publica, criando versão", async () => {
    seed({ live: true, published: {} });
    await mountEditor();
    expect(primary().textContent).toBe(publishing.buttonSaveAndPublish);
    expect(primary().disabled).toBe(true);
    expect(byTestId("editor-pending-banner")).toBeNull();

    await setValue(contentInput(), "<script>v2()</script>");
    expect(primary().disabled).toBe(false);
    await click(primary());

    expect(mutations()).toEqual([
      "PUT /api/admin/custom-code/s1",
      "POST /api/admin/custom-code/s1/publish",
    ]);
    expect(server.published?.snap.content).toBe("<script>v2()</script>");
    expect(server.revisions).toHaveLength(2);
    expect(pageText()).toContain(publishing.noticeSavedAndPublished);
    expect(primary().disabled).toBe(true);
  });

  it("com alterações salvas não publicadas: faixa inline e publicar sem salvar de novo", async () => {
    seed({
      live: true,
      published: {},
      draft: { content: "<script>saved only</script>" },
    });
    await mountEditor();

    expect(byTestId("editor-pending-banner")?.textContent).toBe(
      publishing.pendingBanner,
    );
    expect(primary().disabled).toBe(false);

    await click(primary());

    expect(mutations()).toEqual(["POST /api/admin/custom-code/s1/publish"]);
    expect(pageText()).toContain(publishing.noticePublished);
    expect(byTestId("editor-pending-banner")).toBeNull();
  });

  it("se o salvar deixa o rascunho igual ao que está no ar, a recusa 'sem alteração' é sucesso benigno", async () => {
    seed({
      live: true,
      published: {},
      draft: { content: "<script>saved only</script>" },
    });
    await mountEditor();

    await setValue(contentInput(), "<script>old()</script>");
    await click(primary());

    expect(mutations()).toEqual([
      "PUT /api/admin/custom-code/s1",
      "POST /api/admin/custom-code/s1/publish",
    ]);
    expect(document.body.querySelector('[role="alert"]')).toBeNull();
    // O aviso descreve o resultado real (C1/A4): salvou, mas nada foi publicado.
    expect(pageText()).toContain(publishing.noticeSavedAlreadyLive);
    expect(pageText()).not.toContain(publishing.noticeSavedAndPublished);
    expect(server.revisions).toHaveLength(1);
  });

  it("fora do ar o botão é 'Salvar': grava o rascunho e não publica nem liga", async () => {
    seed({ published: {} });
    await mountEditor();
    expect(primary().textContent).toBe(publishing.buttonSave);
    expect(primary().disabled).toBe(true);

    await setValue(contentInput(), "<script>draft()</script>");
    await click(primary());

    expect(mutations()).toEqual(["PUT /api/admin/custom-code/s1"]);
    expect(server.draft.content).toBe("<script>draft()</script>");
    expect(server.live).toBe(false);
    expect(server.revisions).toHaveLength(1);
    expect(pageText()).toContain(publishing.noticeDraftSaved);
  });

  it("'Salvar sem publicar' no menu grava o rascunho e não toca no ar", async () => {
    seed({ live: true, published: {} });
    await mountEditor();
    await setValue(contentInput(), "<script>draft only</script>");

    await openMoreActions();
    await click(byTestId("editor-menu-saveWithoutPublishing"));

    expect(mutations()).toEqual(["PUT /api/admin/custom-code/s1"]);
    expect(server.published?.snap.content).toBe("<script>old()</script>");
    expect(server.draft.content).toBe("<script>draft only</script>");
    expect(switchEl().getAttribute("aria-checked")).toBe("true");
    expect(pageText()).toContain(publishing.noticeSavedNotPublished);
    expect(byTestId("editor-pending-banner")).not.toBeNull();
  });

  it("o menu mostra a versão no ar (data, hora e autor) e NÃO oferece Pré-visualizar", async () => {
    seed({ live: true, published: {} });
    await mountEditor();
    await setValue(contentInput(), "<script>edit</script>");

    await openMoreActions();

    expect(byTestId("editor-version-info")?.textContent).toBe(
      fillRevisionCopy(publishing.menuLiveVersion, {
        date: formatPanelDateTime("2026-10-14T09:00:00.000Z", undefined, "en"),
        author: "Ana",
      }),
    );
    // Com edição não salva, a única ação é "Salvar sem publicar".
    expect(byTestId("editor-menu-saveWithoutPublishing")).not.toBeNull();
    expect(byTestId("editor-menu-preview")).toBeNull();
    const menuText = document.body.textContent ?? "";
    expect(menuText).not.toContain(dictionary.pages.publishing.menuPreview);
    expect(menuText).not.toContain("Pré-visualizar");
  });

  it("script nunca publicado: o menu diz 'Ainda não publicado' e o rótulo do switch é o de script", async () => {
    seed();
    await mountEditor();

    await openMoreActions();

    expect(byTestId("editor-version-info")?.textContent).toBe(
      publishing.menuNeverPublished,
    );
    expect(switchEl().textContent).toBe(publishing.switchNeverPublished);
  });
});

/* -------------------------------------------------------------------------- */
/* Comparação de versão                                                        */
/* -------------------------------------------------------------------------- */

describe("CustomCodeEditor: comparação de versão (A7, A8)", () => {
  it("pausa formulário, switch, botão e menu com a dica; Voltar a editar devolve tudo intacto", async () => {
    seed({ live: true, published: {}, revisions: [OLD_VERSION] });
    await mountEditor();
    await setValue(contentInput(), "<script>unsaved edit</script>");

    await click(versionRowButton("r-old"));

    expect(byTestId("revision-compare-bar")).not.toBeNull();
    expect(byTestId("content")).toBeNull();
    expect(byTestId("diff-pane")).not.toBeNull();
    expect(nameInput().closest("fieldset")?.disabled).toBe(true);
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
    expect(byTestId("revision-restore-reason")?.textContent).toBe(
      revisions.restoreBlockedDirty,
    );
    expect(byTestId("diff-footer")?.textContent).toContain("Ana");

    const back = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === revisions.backToEditing,
    );
    await click(back ?? null);

    expect(byTestId("revision-compare-bar")).toBeNull();
    expect(contentInput().value).toBe("<script>unsaved edit</script>");
    expect(nameInput().closest("fieldset")?.disabled).toBe(false);
    expect(switchEl().disabled).toBe(false);
    expect(mutations()).toEqual([]);
  });

  it("lista todos os campos de script que mudam, com as páginas do escopo por nome e a indisponível rotulada", async () => {
    seed({ live: true, published: {}, revisions: [OLD_VERSION] });
    await mountEditor();

    await click(versionRowButton("r-old"));

    const fieldText = (field: string) =>
      byTestId(`revision-field-${field}`)?.textContent ?? "";
    // Nome, local, prioridade, escopo, páginas, gatilho, configuração e limites.
    expect(fieldText("name")).toContain("Banner");
    expect(fieldText("name")).toContain("Old banner");
    expect(fieldText("location")).toContain(scripts.header);
    expect(fieldText("location")).toContain(scripts.bodyEnd);
    expect(fieldText("priority")).toContain("5");
    expect(fieldText("scope")).toContain(scripts.allPages);
    expect(fieldText("scope")).toContain(scripts.specificPages);
    expect(fieldText("trigger")).toContain(scripts.triggerNone);
    expect(fieldText("trigger")).toContain(scripts.triggerPageLoad);
    expect(fieldText("triggerConfig")).toContain(
      `${scripts.triggerDelayLabel}: 3`,
    );
    expect(fieldText("maxDisplays")).toContain("2");
    expect(fieldText("displayResetDays")).toContain("7");

    // Páginas do escopo da versão: "pg-3" existe (nome), "pg-4" está na lixeira (rótulo legível).
    const pages = fieldText("scopedPages");
    expect(pages).toContain("Contact");
    expect(pages).toContain(scripts.pageUnavailable);
    expect(pages).not.toContain("pg-3");
    expect(pages).not.toContain("pg-4");
    expect(
      server.calls.filter(
        (call) => call.url === "/api/admin/custom-code/pages?ids=pg-3,pg-4",
      ),
    ).toHaveLength(1);

    // O restaurar mostra os mesmos campos antes de confirmar (C3).
    const restoreButton = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === revisions.restoreAction,
    );
    await click(restoreButton ?? null);
    const list = byTestId("revision-restore-list")?.textContent ?? "";
    expect(list).toContain("Old banner");
    expect(list).toContain(scripts.pageUnavailable);
  });

  it("comparar duas vezes a mesma versão não repete a consulta de nomes", async () => {
    seed({ live: true, published: {}, revisions: [OLD_VERSION] });
    await mountEditor();

    await click(versionRowButton("r-old"));
    const back = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === revisions.backToEditing,
    );
    await click(back ?? null);
    await click(versionRowButton("r-old"));

    expect(
      server.calls.filter((call) => call.url.includes("pages?ids=")),
    ).toHaveLength(1);
  });

  it("falha na consulta de nomes cai no próprio id, sem inventar 'indisponível'", async () => {
    seed({ live: true, published: {}, revisions: [OLD_VERSION] });
    await mountEditor();
    server.failures.set("GET /api/admin/custom-code/pages?ids=pg-3,pg-4", {
      code: "INTERNAL",
      message: "boom",
    });

    await click(versionRowButton("r-old"));

    const pages = byTestId("revision-field-scopedPages")?.textContent ?? "";
    expect(pages).toContain("pg-3");
    expect(pages).toContain("pg-4");
    expect(pages).not.toContain(scripts.pageUnavailable);
  });
});

/* -------------------------------------------------------------------------- */
/* Selo da linha Rascunho                                                      */
/* -------------------------------------------------------------------------- */

describe("CustomCodeEditor: selo da linha Rascunho", () => {
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

describe("CustomCodeEditor: restaurar e Desfazer (A9, A10)", () => {
  const restoreButton = () =>
    [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === revisions.restoreAction,
    ) ?? null;

  const CURRENT = {
    name: "Current banner",
    content: "<script>current()</script>",
    scopeType: "SPECIFIC_PAGES",
    pageIds: ["pg-1"],
    triggerType: "SCROLL",
    triggerConfig: { percentage: 50 },
    maxDisplays: 3,
    displayResetDays: 30,
  } satisfies Partial<Snap>;

  it("a confirmação lista código, campos e o aviso; confirmar restaura sem publicar e Desfazer regrava o rascunho anterior inteiro", async () => {
    seed({ published: {}, draft: CURRENT, revisions: [OLD_VERSION] });
    await mountEditor();
    const savedBeforeRestore = server.updatedAt;

    await click(versionRowButton("r-old"));
    expect(restoreButton()?.disabled).toBe(false);
    await click(restoreButton());

    const dialog = byTestId("confirm");
    expect(dialog?.textContent).toContain(revisions.confirmRestoreDescription);
    expect(byTestId("revision-restore-list")?.textContent).toContain(
      "Old banner",
    );
    // O rascunho tem alterações salvas não publicadas: o aviso de substituição aparece.
    expect(byTestId("revision-restore-warning")).not.toBeNull();

    await click(byTestId("confirm-yes"));

    // Restaurou com o updatedAt carregado, só no rascunho: nada foi publicado nem ativado.
    expect(mutations()).toEqual([
      "POST /api/admin/custom-code/s1/revisions/r-old/restore",
    ]);
    expect(
      server.calls.find((call) => call.url.endsWith("/restore"))?.body,
    ).toEqual({ expectedUpdatedAt: savedBeforeRestore });
    expect(server.draft.name).toBe("Old banner");
    expect(server.published?.snap.content).toBe("<script>old()</script>");
    expect(nameInput().value).toBe("Old banner");
    expect(contentInput().value).toBe("<script>older()</script>");
    expect(byTestId("revision-compare-bar")).toBeNull();
    const restoredAt = server.updatedAt;
    expect(
      document.body.querySelector('[role="status"]')?.textContent,
    ).toContain(
      fillRevisionCopy(revisions.restored, {
        date: formatPanelDateTime("2026-10-10T08:15:00.000Z", undefined, "en"),
      }),
    );

    // Desfazer: regrava o rascunho anterior pelo salvar normal (escopo, gatilho e limites
    // inclusos), com o updatedAt do restaurar, e não publica.
    await click(byTestId("editor-notice-action"));

    expect(mutations()).toEqual([
      "POST /api/admin/custom-code/s1/revisions/r-old/restore",
      "PUT /api/admin/custom-code/s1",
    ]);
    const undoCall = server.calls.find((call) => call.method === "PUT")!;
    expect(undoCall.body).toMatchObject({
      name: "Current banner",
      content: "<script>current()</script>",
      scopeType: "SPECIFIC_PAGES",
      pageIds: ["pg-1"],
      trigger: { triggerType: "SCROLL", triggerConfig: { percentage: 50 } },
      maxDisplays: 3,
      displayResetDays: 30,
      expectedUpdatedAt: restoredAt,
    });
    expect(server.draft).toMatchObject(CURRENT);
    expect(nameInput().value).toBe("Current banner");
    expect(contentInput().value).toBe("<script>current()</script>");
    expect(pageText()).toContain(revisions.undone);
    expect(byTestId("editor-notice-action")).toBeNull();
    expect(server.published?.snap.content).toBe("<script>old()</script>");
  });

  it("Desfazer com o script alterado em outra sessão: erro de conflito e nada é sobrescrito", async () => {
    seed({ published: {}, draft: CURRENT, revisions: [OLD_VERSION] });
    await mountEditor();
    await click(versionRowButton("r-old"));
    await click(restoreButton());
    await click(byTestId("confirm-yes"));

    // Outra sessão salva depois do restaurar: o updatedAt do Desfazer fica velho.
    bump();
    await click(byTestId("editor-notice-action"));

    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(
      revisions.conflict,
    );
    expect(server.draft.name).toBe("Old banner");
  });
});

/* -------------------------------------------------------------------------- */
/* Seletor de escopo                                                           */
/* -------------------------------------------------------------------------- */

describe("CustomCodeEditor: seletor de escopo nomeia páginas fora da lista", () => {
  it("página selecionada fora da lista carregada aparece pelo nome; a que saiu do ar, pelo rótulo legível", async () => {
    seed({
      published: {},
      draft: { scopeType: "SPECIFIC_PAGES", pageIds: ["pg-3", "pg-4"] },
    });
    await mountEditor();
    await waitForScopeList();

    const text = pageText();
    expect(text).toContain("Contact");
    expect(text).toContain("/contact");
    expect(text).toContain(scripts.pageUnavailable);
    expect(text).not.toContain("pg-3");
    expect(text).not.toContain("pg-4");
    // Uma consulta por ids para os dois, e só uma.
    expect(
      server.calls.filter((call) => call.url.includes("pages?ids=")),
    ).toEqual([
      expect.objectContaining({
        url: "/api/admin/custom-code/pages?ids=pg-3,pg-4",
      }),
    ]);
  });

  it("página já presente na lista carregada não gera consulta por ids", async () => {
    seed({
      published: {},
      draft: { scopeType: "SPECIFIC_PAGES", pageIds: ["pg-1"] },
    });
    await mountEditor();
    await waitForScopeList();

    expect(pageText()).toContain("Home");
    expect(
      server.calls.filter((call) => call.url.includes("pages?ids=")),
    ).toHaveLength(0);
    expect(byTestId("editor-unsaved-indicator")).toBeNull();
  });

  it("falha na consulta de nomes mostra o próprio id, sem chamar a página de excluída", async () => {
    seed({
      published: {},
      draft: { scopeType: "SPECIFIC_PAGES", pageIds: ["pg-3"] },
    });
    server.failures.set("GET /api/admin/custom-code/pages?ids=pg-3", {
      code: "INTERNAL",
      message: "boom",
    });
    await mountEditor();
    await waitForScopeList();

    expect(pageText()).toContain("pg-3");
    expect(pageText()).not.toContain(scripts.pageUnavailable);
  });
});

/* -------------------------------------------------------------------------- */
/* Excluir e controles removidos                                               */
/* -------------------------------------------------------------------------- */

describe("CustomCodeEditor: excluir", () => {
  it("Excluir fica sozinho na ponta e leva o script para a lixeira depois da confirmação", async () => {
    seed({ published: {} });
    await mountEditor();

    const trash = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === scripts.moveToTrash,
    );
    await click(trash ?? null);
    expect(byTestId("confirm")?.textContent).toContain(
      scripts.confirmTrashTitle,
    );
    // Cancelar é o "Cancel" das demais confirmações, não o "Back to scripts" da navegação.
    expect(byTestId("confirm-no")?.textContent).toBe(scripts.cancel);
    expect(byTestId("confirm-no")?.textContent).not.toBe(scripts.back);
    await click(byTestId("confirm-yes"));

    expect(mutations()).toEqual(["DELETE /api/admin/custom-code/s1"]);
    expect(routerMock.push).toHaveBeenCalledWith("/admin/custom-code");
  });
});

describe("CustomCodeEditor: o modelo antigo saiu (C2)", () => {
  it("não existe botão Publicar, toggle Ativado/Desativado, prompt 'Ativar agora?' nem redirecionamento de ?created=1", async () => {
    seed({ live: true, published: {} });
    await mountEditor();

    const labels = [...document.body.querySelectorAll("button")].map((button) =>
      (button.getAttribute("aria-label") ?? button.textContent ?? "").trim(),
    );
    // Rótulos do modelo antigo (chaves removidas do dicionário), em en e pt-BR.
    for (const removedLabel of [
      "Publish",
      "Publicar",
      "Activate",
      "Ativar",
      "Deactivate",
      "Desativar",
      "Activated",
      "Ativado",
    ]) {
      expect(labels).not.toContain(removedLabel);
    }
    for (const removedText of ["Activate now?", "Ativar agora?"]) {
      expect(pageText()).not.toContain(removedText);
    }
    expect(document.body.querySelector("h1")?.closest("a")).toBeNull();
    // O editor não reescreve a URL por conta própria: não há `?created=1` em Scripts.
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it("em Scripts o cabeçalho usa o texto 'Salvar e publicar' e o dicionário de scripts não define Pré-visualizar", () => {
    expect(publishing.buttonSaveAndPublish).toBe("Save and publish");
    expect(publishing).not.toHaveProperty("menuPreview");
  });
});

/* -------------------------------------------------------------------------- */
/* Fase 3, T5: carga única, copy do editor e estado inicial do seletor (A6, A7) */
/* -------------------------------------------------------------------------- */

/** O pedido de carga do snippet (as demais leituras do editor têm outra URL). */
const isSnippetGet = (call: Call) =>
  call.method === "GET" && call.url === "/api/admin/custom-code/s1";

describe("CustomCodeEditor: carga inicial do script (A6)", () => {
  it("abrir o editor pede o snippet uma única vez, também sob Strict Mode, e o form reflete a resposta", async () => {
    seed({ published: {}, draft: { name: "Carregado" } });
    await mountEditor({ strict: true });

    expect(server.calls.filter(isSnippetGet)).toHaveLength(1);
    expect(nameInput().value).toBe("Carregado");
  });

  it("a falha da carga mostra o erro e o Tentar de novo refaz o pedido uma única vez", async () => {
    seed({ published: {}, draft: { name: "Depois do retry" } });
    server.failures.set("GET /api/admin/custom-code/s1", {
      code: "INTERNAL",
      message: "boom",
    });
    await mountEditor({ strict: true });

    expect(
      document.body.querySelector('[role="alert"]')?.textContent,
    ).toContain("boom");
    expect(server.calls.filter(isSnippetGet)).toHaveLength(1);

    server.failures.delete("GET /api/admin/custom-code/s1");
    const retry = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === scripts.retry,
    );
    await click(retry ?? null);

    expect(server.calls.filter(isSnippetGet)).toHaveLength(2);
    expect(nameInput().value).toBe("Depois do retry");
    expect(document.body.querySelector('[role="alert"]')).toBeNull();
  });

  it("resposta atrasada de uma carga antiga não sobrescreve o form do script atual", async () => {
    seed({ published: {} });
    let resolveStale!: (value: unknown) => void;
    const stale = new Promise((resolve) => {
      resolveStale = resolve;
    });
    // s1 fica pendente; s2 (o script para o qual o editor navega) responde na hora.
    requestJsonMock.mockImplementation(
      async (url: string, init?: RequestInit) => {
        if (url === "/api/admin/custom-code/s1" && !init?.method) return stale;
        if (url === "/api/admin/custom-code/s2") {
          return { snippet: { ...snippetDto(), id: "s2", name: "Atual" } };
        }
        if (url.startsWith("/api/admin/custom-code/s2/revisions?")) {
          return { items: [] };
        }
        return handle(url, init);
      },
    );
    await mountEditor();
    await act(async () => {
      root!.render(
        createElement(CustomCodeEditor, {
          dictionary: scripts,
          revisions,
          snippetId: "s2",
        }),
      );
    });
    await flush();
    expect(nameInput().value).toBe("Atual");

    await act(async () => {
      resolveStale({ snippet: { ...snippetDto(), name: "Antigo" } });
    });
    await flush();

    expect(nameInput().value).toBe("Atual");
  });
});

describe("CustomCodeEditor: copy do rodapé e da exclusão em cada idioma (A6)", () => {
  it("o sufixo do limite vem do dicionário, não do JSX", async () => {
    seed({ published: {}, draft: { content: "x".repeat(1234) } });
    await mountEditor({ copy: { ...scripts, contentLimit: "/ LIMITE" } });

    expect(pageText()).toContain("1,234 / LIMITE");
    expect(pageText()).not.toContain("2 MiB");
  });

  it.each([
    { language: "en", number: "1,234", cancel: "Cancel" },
    { language: "pt-BR", number: "1.234", cancel: "Cancelar" },
  ] as const)(
    "$language: rodapé com o número e o sufixo do painel; exclusão com $cancel",
    async ({ language, number, cancel }) => {
      const copy = getPanelDictionary(language).customCode;
      seed({ published: {}, draft: { content: "x".repeat(1234) } });
      await mountEditor({ language });

      expect(pageText()).toContain(`${number} ${copy.contentLimit}`);
      expect(copy.contentLimit).toContain("2 MiB");

      const trash = [...document.body.querySelectorAll("button")].find(
        (button) => button.textContent?.trim() === copy.moveToTrash,
      );
      await click(trash ?? null);

      expect(byTestId("confirm-no")?.textContent).toBe(cancel);
      expect(byTestId("confirm-no")?.textContent).not.toBe(copy.back);
    },
  );
});

describe("CustomCodeEditor: textos do seletor de imagem do editor de código (Fase 4, T3)", () => {
  it.each([
    {
      language: "en",
      title: "Choose image",
      select: "Select",
      cancel: "Cancel",
      close: "Close",
    },
    {
      language: "pt-BR",
      title: "Escolher imagem",
      select: "Selecionar",
      cancel: "Cancelar",
      close: "Fechar",
    },
  ] as const)(
    "$language: o editor de código recebe título, confirmar, cancelar e fechar do dicionário",
    async ({ language, title, select, cancel, close }) => {
      seed({ published: {}, draft: {} });
      await mountEditor({ language });

      const editor = byTestId("content");
      expect(editor?.getAttribute("data-media-title")).toBe(title);
      expect(editor?.getAttribute("data-media-select")).toBe(select);
      expect(editor?.getAttribute("data-media-cancel")).toBe(cancel);
      // Fase 4, decisão humana: o X do seletor é "Fechar"/"Close", separado do cancelar do rodapé.
      expect(editor?.getAttribute("data-media-close")).toBe(close);
    },
  );
});

describe("CustomCodeEditor: seletor de escopo antes da primeira resposta (A7)", () => {
  /** Troca a lista paginada de páginas por uma resposta controlada pelo teste. */
  function holdScopeList() {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    requestJsonMock.mockImplementation(
      async (url: string, init?: RequestInit) =>
        url.startsWith("/api/admin/custom-code/pages?")
          ? pending.then(() => ({ items: [], total: 0, page: 1, pageSize: 25 }))
          : handle(url, init),
    );
    return release;
  }

  it("mostra carregamento, nunca 'lista vazia', até a resposta; resposta vazia mostra o vazio", async () => {
    seed({
      published: {},
      draft: { scopeType: "SPECIFIC_PAGES", pageIds: [] },
    });
    const release = holdScopeList();
    await mountEditor();

    // Antes do debounce do seletor e com a consulta em voo: carregando, sem a mensagem de vazio.
    // Fase 4, T3 (A3): o seletor fala de páginas, com chaves próprias, e não reusa a copy de scripts.
    expect(pageText()).toContain(scripts.pagesLoading);
    expect(pageText()).not.toContain(scripts.pagesEmpty);
    expect(pageText()).not.toContain(scripts.loading);
    expect(pageText()).not.toContain(scripts.empty);
    await waitForScopeList();
    expect(pageText()).toContain(scripts.pagesLoading);
    expect(pageText()).not.toContain(scripts.pagesEmpty);
    expect(pageText()).not.toContain(scripts.empty);

    await act(async () => {
      release();
    });
    await flush();

    expect(pageText()).not.toContain(scripts.pagesLoading);
    expect(pageText()).toContain(scripts.pagesEmpty);
    expect(pageText()).not.toContain(scripts.empty);
  });
});
