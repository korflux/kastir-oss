// @vitest-environment jsdom

/**
 * Fase 4, T3 (A3): o nome acessível do botão de fechar (X) de todo diálogo do painel vem do
 * `PanelDictionary`, em `en` e `pt-BR`, e nunca do literal "Close" que o primitivo `Dialog`
 * carregava. Cobre o primitivo (rótulo recebido por prop; sem X quando o chamador traz o seu) e os
 * consumidores com o fechar padrão que têm teste montável: ConfirmDialog (via restaurar do Backup,
 * restaurar versão de Revisions e remover destino de Split Tests), FolderEditorDialog,
 * MediaPickerDialog e o convite de Users. O tipo de `DialogContent`, o de `ConfirmDialog` e o de
 * `MediaPickerDialog` obrigam os demais consumidores a informar o rótulo, e `i18n.test.ts` fixa as
 * chaves nos dois idiomas. Em `ConfirmDialog` e `MediaPickerDialog` o X é "Fechar"/"Close" e o
 * rodapé "Cancelar"/"Cancel" (fase 4, A3, design › Diálogos e decisão humana de estender o
 * "Fechar" ao seletor de imagem): o X nunca herda o texto de cancelar.
 */

import {
  act,
  createElement,
  type AnchorHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FolderEditorDialog } from "@/components/Shared/FolderEditorDialog";
import { MediaPickerDialog } from "@/components/Shared/MediaPickerDialog";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { getPanelDictionary } from "@/lib/i18n/panel";
import { BackupWorkspace } from "@/lib/Modules/Backup/Components/BackupWorkspace";
import { RevisionCompareBar } from "@/lib/Modules/Revisions/Components/RevisionCompareBar";
import type { RevisionHistoryItem } from "@/lib/Modules/Revisions/Components/RevisionHistoryPanel";
import { SplitTestDestinations } from "@/lib/Modules/SplitTests/Components/SplitTestDestinations";
import type { CampaignDetail } from "@/lib/Modules/SplitTests/Components/SplitTestsTypes";
import { UsersWorkspace } from "@/lib/Modules/Users/Components/UsersWorkspace";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const requestJsonMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/requestJson", () => ({ requestJson: requestJsonMock }));

vi.mock("next/link", () => ({
  default: ({
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { children?: ReactNode }) =>
    createElement("a", props, children),
}));

let root: Root | undefined;

/** Monta o elemento num container novo, descartando o anterior. */
function mount(element: ReactElement) {
  unmount();
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(element));
}

function unmount() {
  if (root) {
    act(() => root?.unmount());
    root = undefined;
  }
  document.body.replaceChildren();
}

/** Conteúdo do diálogo aberto (o Base UI o renderiza num portal no `body`). */
function dialogContent(): HTMLElement {
  const content = document.body.querySelector<HTMLElement>(
    '[data-slot="dialog-content"]',
  );
  expect(content).not.toBeNull();
  return content!;
}

/** O X do canto é o único botão do diálogo que traz o ícone; devolve seu nome acessível. */
function cornerCloseName(): string | undefined {
  return [...dialogContent().querySelectorAll("button")]
    .find((button) => button.querySelector("svg"))
    ?.textContent?.trim();
}

/** Botão visível do documento pelo texto exato. */
function buttonByText(text: string): HTMLButtonElement {
  const button = [...document.body.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  expect(button, `botão "${text}"`).toBeDefined();
  return button as HTMLButtonElement;
}

/** Versão em comparação do `RevisionCompareBar` (só precisa existir e diferir do rascunho). */
const revisionTarget: RevisionHistoryItem = {
  id: "rev-old",
  fingerprint: "11223344556677889900aabbccddeeff",
  authorName: "Grace",
  createdAt: "2026-07-30T12:00:00.000Z",
  pinned: false,
  published: false,
};

/** Campanha com dois destinos: com um só, o botão de remover fica desabilitado. */
const campaign: CampaignDetail = {
  id: "campaign-id",
  name: "Campaign",
  slug: "campaign",
  status: "ACTIVE",
  author: null,
  totalHits: 0,
  createdAt: "2026-08-10T00:00:00.000Z",
  updatedAt: "2026-08-10T00:00:00.000Z",
  destinations: ["a", "b"].map((id, sortOrder) => ({
    id: `destination-${id}`,
    url: `https://example.com/${id}`,
    label: `Landing ${id}`,
    status: "ACTIVE" as const,
    sortOrder,
    hitCount: 0,
    theoreticalWeight: 50,
    realPercent: 50,
  })),
};

/** Deixa efeitos e promessas pendentes assentarem dentro do `act`. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  requestJsonMock.mockReset();
  requestJsonMock.mockResolvedValue({
    users: { items: [], total: 0, page: 1 },
  });
  // Rede parada: o seletor de mídia e o Backup só precisam do primeiro render.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => undefined)),
  );
});

afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
});

describe.each(["en", "pt-BR"] as const)(
  "close button name (%s)",
  (language) => {
    const dictionary = getPanelDictionary(language);
    const expectedClose = language === "en" ? "Close" : "Fechar";
    const expectedCancel = language === "en" ? "Cancel" : "Cancelar";

    it("primitive: DialogContent names the X with the label it receives", () => {
      mount(
        createElement(
          Dialog,
          { open: true },
          createElement(
            DialogContent,
            { closeLabel: dictionary.users.close },
            createElement(DialogTitle, null, "Title"),
          ),
        ),
      );

      expect(cornerCloseName()).toBe(expectedClose);

      // Trava de tipo (checada pelo `tsc`): manter o X padrão sem rótulo não compila, então um
      // consumidor novo não volta ao literal em inglês por esquecimento.
      // @ts-expect-error `closeLabel` é obrigatório enquanto `showCloseButton` não é `false`.
      const withoutLabel = () => <DialogContent />;
      void withoutLabel;
    });

    it("primitive: no X when the caller brings its own close button", () => {
      mount(
        createElement(
          Dialog,
          { open: true },
          createElement(
            DialogContent,
            { showCloseButton: false },
            createElement(DialogTitle, null, "Title"),
          ),
        ),
      );

      expect(cornerCloseName()).toBeUndefined();
    });

    it("ConfirmDialog of Backup restore: cancel and X come from the dictionary", () => {
      mount(
        createElement(BackupWorkspace, {
          copy: dictionary.backup,
          initialSchedule: {
            enabled: false,
            intervalDays: 7,
            hour: 3,
            minute: 0,
            timezone: "UTC",
          },
          initialSnapshots: [
            {
              id: "snapshot-1",
              fileName: "snapshot-1.kastir",
              createdAt: "2026-10-16T12:00:00.000Z",
              sizeBytes: 1024,
              kastirVersion: "2.3.0",
              schemaVersion: "1",
              origin: "https://cms.example.test",
              siteTitle: "Site",
            },
          ],
        }),
      );

      act(() => buttonByText(dictionary.backup.restore).click());

      const content = dialogContent();
      expect(cornerCloseName()).toBe(expectedClose);
      expect(
        [...content.querySelectorAll("button")].some(
          (button) => button.textContent === expectedCancel,
        ),
      ).toBe(true);
      // Nenhum literal em inglês sobra no diálogo em pt-BR.
      if (language === "pt-BR") {
        expect(content.textContent).not.toMatch(/\b(Close|Cancel)\b/);
      }
    });

    it("ConfirmDialog of Revisions restore: the X is the revisions close, apart from cancel", () => {
      mount(
        createElement(RevisionCompareBar, {
          copy: dictionary.revisions,
          target: revisionTarget,
          lines: [],
          fieldChanges: [],
          dirty: false,
          draftFingerprint: "ffffffffffffffffffffffffffffffff",
          onRestore: () => undefined,
          onBack: () => undefined,
        }),
      );

      act(() => buttonByText(dictionary.revisions.restoreAction).click());

      expect(cornerCloseName()).toBe(expectedClose);
      expect(
        [...dialogContent().querySelectorAll("button")].some(
          (button) => button.textContent === expectedCancel,
        ),
      ).toBe(true);
    });

    it("ConfirmDialog of Split Tests remove destination: the X is the split tests close", () => {
      mount(
        createElement(SplitTestDestinations, {
          campaign,
          campaignId: "campaign-id",
          dictionary: dictionary.splitTests,
          busy: false,
          onBusyChange: () => undefined,
          onCampaignChange: () => undefined,
          onError: () => undefined,
          onSaved: () => undefined,
        }),
      );

      const remove = document.body.querySelector<HTMLButtonElement>(
        `button[aria-label="${dictionary.splitTests.removeDestination}"]`,
      );
      expect(remove).not.toBeNull();
      act(() => remove?.click());

      expect(cornerCloseName()).toBe(expectedClose);
      expect(
        [...dialogContent().querySelectorAll("button")].some(
          (button) => button.textContent === expectedCancel,
        ),
      ).toBe(true);
    });

    it("FolderEditorDialog: the X is named by the folders copy", () => {
      mount(
        createElement(FolderEditorDialog, {
          open: true,
          mode: "create",
          labels: dictionary.folders,
          onOpenChange: () => undefined,
          onSubmit: async () => undefined,
        }),
      );

      expect(cornerCloseName()).toBe(expectedClose);
    });

    // Fase 4, A3, design › Diálogos e decisão humana de estender o "Fechar" ao seletor: o X é
    // anunciado "Fechar"/"Close" e o rodapé "Cancelar"/"Cancel". Antes os dois dividiam `closeLabel`
    // (X = cancelar); agora são props separadas e obrigatórias, como no ConfirmDialog.
    it("MediaPickerDialog: the X is the close label, apart from the footer cancel", async () => {
      mount(
        createElement(MediaPickerDialog, {
          open: true,
          title: "Choose image",
          cancelLabel: dictionary.customCode.cancel,
          closeLabel: dictionary.customCode.close,
          selectLabel: "Select",
          selectedId: "",
          onOpenChange: () => undefined,
          onSelect: () => undefined,
        }),
      );
      await flush();

      expect(cornerCloseName()).toBe(expectedClose);
      expect(cornerCloseName()).not.toBe(expectedCancel);
      // O rodapé segue com o texto de cancelar, e só o X traz o ícone.
      expect(
        [...dialogContent().querySelectorAll("button")].filter(
          (button) => button.textContent === expectedCancel,
        ),
      ).toHaveLength(1);
    });

    // Trava de tipo (checada pelo `tsc`): sem `cancelLabel` e `closeLabel` o seletor não compila,
    // então um consumidor novo não volta a anunciar o X como "Cancelar" por esquecimento.
    it("MediaPickerDialog: requires cancelLabel and closeLabel at the type level", () => {
      const withoutLabels = () =>
        // @ts-expect-error `cancelLabel` e `closeLabel` são obrigatórios no MediaPickerDialog.
        createElement(MediaPickerDialog, {
          open: true,
          title: "Choose image",
          selectLabel: "Select",
          selectedId: "",
          onOpenChange: () => undefined,
          onSelect: () => undefined,
        });
      void withoutLabels;
    });

    it("Users invite dialog: the X is named by the users copy", async () => {
      mount(
        createElement(UsersWorkspace, {
          dictionary: dictionary.users,
          actorId: "user-1",
          actorRole: "MASTER",
        }),
      );
      await flush();

      act(() => buttonByText(dictionary.users.newUser).click());

      expect(cornerCloseName()).toBe(expectedClose);
    });
  },
);
