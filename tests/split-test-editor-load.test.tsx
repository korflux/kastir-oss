// @vitest-environment jsdom

/**
 * Fase 4, T2 (spec A2): carga inicial do editor de Split Test (`SplitTestEditor`).
 *
 * O editor tinha uma carga que o effect disparava sem guarda: sob Strict Mode (dev) a montagem
 * remontava o effect e a rede via DOIS `GET /api/admin/split-tests/<id>`, e a resposta de uma
 * carga antiga (outra campanha, outra montagem) podia sobrescrever o formulário atual. Agora a
 * carga é única (`load(isCurrent)`), no padrão do `CustomCodeEditor`. Provado no DOM, com o
 * servidor simulado em `requestJson`:
 *   - abrir o editor, também sob Strict Mode, faz um único GET da campanha e o form reflete a
 *     resposta;
 *   - a falha da carga mostra o erro e o "Tentar de novo" refaz o pedido uma única vez;
 *   - a resposta atrasada de uma campanha anterior não sobrescreve a campanha atual.
 */

import {
  act,
  createElement,
  StrictMode,
  type AnchorHTMLAttributes,
  type ReactNode,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const requestJsonMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { children?: ReactNode }) =>
    createElement("a", props, children),
}));

vi.mock("@/lib/requestJson", () => ({ requestJson: requestJsonMock }));

import { SplitTestEditor } from "@/lib/Modules/SplitTests/Components/SplitTestEditor";
import type { CampaignDetail } from "@/lib/Modules/SplitTests/Components/SplitTestsTypes";
import { getPanelDictionary } from "@/lib/i18n/panel";

const dictionary = getPanelDictionary("en").splitTests;

/** Campanha mínima com um destino: o suficiente para o editor sair do estado de carregamento. */
function campaignDto(id: string, name: string): CampaignDetail {
  return {
    id,
    name,
    slug: id,
    status: "ACTIVE",
    author: null,
    totalHits: 4,
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
    destinations: [
      {
        id: `${id}-destination`,
        url: "https://example.com",
        label: "Landing",
        status: "ACTIVE",
        sortOrder: 0,
        hitCount: 4,
        theoreticalWeight: 100,
        realPercent: 100,
      },
    ],
  };
}

const urlOf = (campaignId: string) => `/api/admin/split-tests/${campaignId}`;

/** Pedidos de LEITURA da campanha (GET: `requestJson(url)` sem `init`), por id. */
function campaignGets(campaignId: string) {
  return requestJsonMock.mock.calls.filter(
    ([url, init]) =>
      url === urlOf(campaignId) && !(init as RequestInit | undefined)?.method,
  );
}

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
    root = undefined;
  }
  host?.remove();
  host = undefined;
  requestJsonMock.mockReset();
});

/** Elemento do editor para a campanha `campaignId`, opcionalmente sob Strict Mode. */
function editorFor(campaignId: string, strict: boolean) {
  const editor = createElement(SplitTestEditor, {
    dictionary,
    campaignId,
    publicOrigin: "https://example.com",
  });
  return strict ? createElement(StrictMode, null, editor) : editor;
}

/** Monta o editor e espera as cargas (microtasks do effect e das respostas) assentarem. */
async function mountEditor(campaignId: string, strict = false) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(editorFor(campaignId, strict));
  });
  await flush();
}

/** Deixa os microtasks pendentes (carga no effect, resposta simulada) rodarem dentro do `act`. */
async function flush() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const nameInput = () =>
  host?.querySelector<HTMLInputElement>("#split-campaign-name") ?? null;

describe("SplitTestEditor: carga inicial da campanha (A2)", () => {
  it("abrir o editor pede a campanha uma única vez, também sob Strict Mode, e o form reflete a resposta", async () => {
    requestJsonMock.mockResolvedValue({
      campaign: campaignDto("campaign-a", "Campanha A"),
    });

    await mountEditor("campaign-a", true);

    expect(campaignGets("campaign-a")).toHaveLength(1);
    expect(nameInput()?.value).toBe("Campanha A");
    expect(host?.querySelector("h1")?.textContent).toBe("Campanha A");
  });

  it("a falha da carga mostra o erro e o Tentar de novo refaz o pedido uma única vez", async () => {
    requestJsonMock.mockRejectedValue({ code: "INTERNAL", message: "boom" });

    await mountEditor("campaign-a", true);

    expect(host?.querySelector('[role="alert"]')?.textContent).toContain(
      "boom",
    );
    expect(campaignGets("campaign-a")).toHaveLength(1);
    // Sem campanha, o editor oferece refazer a carga e voltar para a lista.
    expect(
      host?.querySelector(`a[href="/admin/split-tests"]`)?.textContent,
    ).toBe(dictionary.back);

    requestJsonMock.mockResolvedValue({
      campaign: campaignDto("campaign-a", "Depois do retry"),
    });
    const retry = [...(host?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.trim() === dictionary.retry,
    );
    expect(retry).toBeDefined();
    await act(async () => {
      retry?.click();
    });
    await flush();

    expect(campaignGets("campaign-a")).toHaveLength(2);
    expect(nameInput()?.value).toBe("Depois do retry");
    expect(host?.querySelector('[role="alert"]')).toBeNull();
  });

  it("resposta atrasada de uma campanha anterior não sobrescreve o form da campanha atual", async () => {
    let resolveStale!: (value: unknown) => void;
    const stale = new Promise((resolve) => {
      resolveStale = resolve;
    });
    // A fica pendente; B (a campanha para a qual o editor navega) responde na hora.
    requestJsonMock.mockImplementation(async (url: string) => {
      if (url === urlOf("campaign-a")) return stale;
      if (url === urlOf("campaign-b")) {
        return { campaign: campaignDto("campaign-b", "Campanha B") };
      }
      throw new Error(`requisição inesperada: ${url}`);
    });

    await mountEditor("campaign-a");
    await act(async () => {
      root?.render(editorFor("campaign-b", false));
    });
    await flush();
    expect(nameInput()?.value).toBe("Campanha B");

    await act(async () => {
      resolveStale({
        campaign: campaignDto("campaign-a", "Campanha A antiga"),
      });
    });
    await flush();

    expect(nameInput()?.value).toBe("Campanha B");
    expect(host?.querySelector("h1")?.textContent).toBe("Campanha B");
    expect(campaignGets("campaign-a")).toHaveLength(1);
    expect(campaignGets("campaign-b")).toHaveLength(1);
  });
});
