import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  attachExpectedUpdatedAt,
  draftRowState,
  getEditorHeaderState,
  isNothingToPublishRefusal,
  isOptimisticSaveConflict,
  statusSwitchLabelKey,
  turnOn,
  turnOnNoticeKey,
  type EditorStateInput,
} from "@/lib/Modules/Revisions/Components/revisionEditorState";
import { getPanelDictionary } from "@/lib/i18n/panel";

/* -------------------------------------------------------------------------- */
/* Modelo da fase 2: switch No ar / Fora do ar + botão principal + menu ⋯      */
/* -------------------------------------------------------------------------- */

/** Item existente, no ar, em dia, formulário limpo e válido, em Pages. */
const BASE: EditorStateInput = {
  hasResource: true,
  hasPublishedRevision: true,
  live: true,
  hasUnpublishedChanges: false,
  isDirty: false,
  inspecting: false,
  formValid: true,
  canPreview: true,
};

/** Os cinco estados do item (o servidor devolve alteração não publicada = true em "nunca publicada"). */
const STATES = {
  never: {
    ...BASE,
    hasPublishedRevision: false,
    live: false,
    hasUnpublishedChanges: true,
  },
  off: { ...BASE, live: false },
  offChanged: { ...BASE, live: false, hasUnpublishedChanges: true },
  live: BASE,
  liveChanged: { ...BASE, hasUnpublishedChanges: true },
} satisfies Record<string, EditorStateInput>;

const NEW_ITEM: EditorStateInput = {
  ...BASE,
  hasResource: false,
  hasPublishedRevision: false,
  live: false,
  hasUnpublishedChanges: false,
  isDirty: true,
};

/** Estado a partir de um dos cinco, com ou sem edição não salva. */
function header(
  name: keyof typeof STATES,
  overrides: Partial<EditorStateInput> = {},
) {
  return getEditorHeaderState({ ...STATES[name], ...overrides });
}

describe("editor header state matrix", () => {
  type Row = {
    name: keyof typeof STATES;
    dirty: boolean;
    switchLabel: string;
    on: boolean;
    primary: string;
    publishes: boolean;
    primaryReason: string | null;
    versionInfo: string;
    items: string[];
    banner: boolean;
  };

  // Cada estado da matriz da spec, sem e com edição não salva (A1 a A6).
  const rows: Row[] = [
    {
      name: "never",
      dirty: false,
      switchLabel: "switchNeverPublished",
      on: false,
      primary: "buttonSave",
      publishes: false,
      primaryReason: "reasonNothingToSave",
      versionInfo: "menuNeverPublished",
      items: ["preview"],
      banner: false,
    },
    {
      name: "never",
      dirty: true,
      switchLabel: "switchNeverPublished",
      on: false,
      primary: "buttonSave",
      publishes: false,
      primaryReason: null,
      versionInfo: "menuNeverPublished",
      items: ["preview"],
      banner: false,
    },
    {
      name: "off",
      dirty: false,
      switchLabel: "switchOff",
      on: false,
      primary: "buttonSave",
      publishes: false,
      primaryReason: "reasonNothingToSave",
      versionInfo: "menuStoredVersion",
      items: ["preview"],
      banner: false,
    },
    {
      name: "off",
      dirty: true,
      switchLabel: "switchOff",
      on: false,
      primary: "buttonSave",
      publishes: false,
      primaryReason: null,
      versionInfo: "menuStoredVersion",
      items: ["preview"],
      banner: false,
    },
    {
      // Fora do ar com alteração salva: Salvar nada tem a gravar; quem leva ao ar é o switch.
      name: "offChanged",
      dirty: false,
      switchLabel: "switchOff",
      on: false,
      primary: "buttonSave",
      publishes: false,
      primaryReason: "reasonNothingToSave",
      versionInfo: "menuStoredVersion",
      items: ["preview"],
      banner: false,
    },
    {
      name: "offChanged",
      dirty: true,
      switchLabel: "switchOff",
      on: false,
      primary: "buttonSave",
      publishes: false,
      primaryReason: null,
      versionInfo: "menuStoredVersion",
      items: ["preview"],
      banner: false,
    },
    {
      // No ar em dia, sem edição: nada a publicar (A4, botão desabilitado).
      name: "live",
      dirty: false,
      switchLabel: "switchLive",
      on: true,
      primary: "buttonSaveAndPublish",
      publishes: true,
      primaryReason: "reasonNothingToPublish",
      versionInfo: "menuLiveVersion",
      items: ["preview"],
      banner: false,
    },
    {
      // No ar com edição: Salvar e publicar habilita e "Salvar sem publicar" entra no menu (A6).
      name: "live",
      dirty: true,
      switchLabel: "switchLive",
      on: true,
      primary: "buttonSaveAndPublish",
      publishes: true,
      primaryReason: null,
      versionInfo: "menuLiveVersion",
      items: ["saveWithoutPublishing", "preview"],
      banner: false,
    },
    {
      // No ar com alteração salva e sem edição: botão habilitado e faixa inline (A4).
      name: "liveChanged",
      dirty: false,
      switchLabel: "switchLive",
      on: true,
      primary: "buttonSaveAndPublish",
      publishes: true,
      primaryReason: null,
      versionInfo: "menuLiveVersion",
      items: ["preview"],
      banner: true,
    },
    {
      // Com edição por cima da alteração salva, a faixa dá lugar ao indicador Não salvo.
      name: "liveChanged",
      dirty: true,
      switchLabel: "switchLive",
      on: true,
      primary: "buttonSaveAndPublish",
      publishes: true,
      primaryReason: null,
      versionInfo: "menuLiveVersion",
      items: ["saveWithoutPublishing", "preview"],
      banner: false,
    },
  ];

  it.each(rows)(
    "$name, edição não salva: $dirty",
    ({
      name,
      dirty,
      switchLabel,
      on,
      primary,
      publishes,
      primaryReason,
      versionInfo,
      items,
      banner,
    }) => {
      const state = header(name, { isDirty: dirty });

      expect(state.switch).toEqual({
        on,
        label: switchLabel,
        enabled: true,
        disabledReason: null,
      });
      expect(state.primary).toEqual({
        label: primary,
        publishes,
        enabled: primaryReason === null,
        disabledReason: primaryReason,
      });
      expect(state.menu).toEqual({
        enabled: true,
        disabledReason: null,
        versionInfo,
        items,
      });
      expect(state.showUnsavedIndicator).toBe(dirty);
      expect(state.showPendingBanner).toBe(banner);
      expect(state.showPausedHint).toBe(false);
    },
  );

  it("treats a new item as create-and-publish: switch on 'never published', button 'Criar', menu locked", () => {
    const state = getEditorHeaderState(NEW_ITEM);

    expect(state.switch).toEqual({
      on: false,
      label: "switchNeverPublished",
      enabled: true,
      disabledReason: null,
    });
    expect(state.primary).toEqual({
      label: "buttonCreate",
      publishes: false,
      enabled: true,
      disabledReason: null,
    });
    expect(state.menu.enabled).toBe(false);
    expect(state.menu.disabledReason).toBe("reasonNewItem");
    expect(state.menu.items).toEqual([]);
    expect(state.showUnsavedIndicator).toBe(true);
    expect(state.showPendingBanner).toBe(false);

    const invalid = getEditorHeaderState({ ...NEW_ITEM, formValid: false });
    expect(invalid.primary.disabledReason).toBe("reasonInvalidForm");
    expect(invalid.switch.disabledReason).toBe("reasonInvalidForm");
  });

  it("pauses switch, main button and menu while comparing, in every state, with the pause as the reason", () => {
    for (const name of Object.keys(STATES) as (keyof typeof STATES)[]) {
      for (const dirty of [false, true]) {
        const state = header(name, { inspecting: true, isDirty: dirty });

        expect(state.switch.enabled).toBe(false);
        expect(state.switch.disabledReason).toBe("reasonInspecting");
        expect(state.primary.enabled).toBe(false);
        expect(state.primary.disabledReason).toBe("reasonInspecting");
        expect(state.menu.enabled).toBe(false);
        expect(state.menu.disabledReason).toBe("reasonInspecting");
        expect(state.showPausedHint).toBe(true);
        // A edição não salva continua existindo e visível durante a comparação.
        expect(state.showUnsavedIndicator).toBe(dirty);
      }
    }
  });

  it("keeps Switch off allowed with an invalid form but blocks Switch on and the save buttons", () => {
    const live = header("live", { isDirty: true, formValid: false });
    expect(live.switch.enabled).toBe(true);
    expect(live.primary.disabledReason).toBe("reasonInvalidForm");
    // Sem formulário válido não há o que salvar: o menu não oferece as ações que salvam.
    expect(live.menu.items).toEqual([]);

    const off = header("off", { isDirty: true, formValid: false });
    expect(off.switch.enabled).toBe(false);
    expect(off.switch.disabledReason).toBe("reasonInvalidForm");
    expect(off.primary.disabledReason).toBe("reasonInvalidForm");
    expect(off.menu.items).toEqual([]);
  });

  it("never lists Pré-visualizar for Scripts, which have no page of their own", () => {
    expect(header("live", { canPreview: false }).menu.items).toEqual([]);
    expect(
      header("live", { canPreview: false, isDirty: true }).menu.items,
    ).toEqual(["saveWithoutPublishing"]);
  });

  it("holds the invariants of the rules in every reachable combination (C1, C4)", () => {
    const flags = [false, true];
    let checked = 0;
    for (const hasResource of flags)
      for (const hasPublishedRevision of flags)
        for (const live of flags)
          for (const hasUnpublishedChanges of flags)
            for (const isDirty of flags)
              for (const inspecting of flags)
                for (const formValid of flags)
                  for (const canPreview of flags) {
                    // Alcançável: no ar implica item existente e já publicado; item novo nunca foi publicado.
                    if (live && !hasPublishedRevision) continue;
                    if (!hasResource && (hasPublishedRevision || live))
                      continue;
                    const input: EditorStateInput = {
                      hasResource,
                      hasPublishedRevision,
                      live,
                      hasUnpublishedChanges,
                      isDirty,
                      inspecting,
                      formValid,
                      canPreview,
                    };
                    const state = getEditorHeaderState(input);
                    checked += 1;

                    // C4: controle desabilitado sempre traz o motivo; habilitado nunca.
                    expect(state.switch.enabled).toBe(
                      state.switch.disabledReason === null,
                    );
                    expect(state.primary.enabled).toBe(
                      state.primary.disabledReason === null,
                    );
                    expect(state.menu.enabled).toBe(
                      state.menu.disabledReason === null,
                    );
                    // Só existem Criar, Salvar e Salvar e publicar: nenhum botão Publicar avulso.
                    expect([
                      "buttonCreate",
                      "buttonSave",
                      "buttonSaveAndPublish",
                    ]).toContain(state.primary.label);
                    // C1: publicar (botão principal) só com o item no ar; o switch é o único caminho de ligar.
                    expect(state.primary.publishes).toBe(live && hasResource);
                    // Qualquer gravação exige formulário válido e fora de comparação.
                    if (state.primary.enabled) {
                      expect(formValid && !inspecting).toBe(true);
                    }
                    if (state.switch.enabled && !state.switch.on) {
                      expect(formValid && !inspecting).toBe(true);
                    }
                    // Desligar é sempre possível fora de comparação.
                    if (live && !inspecting) {
                      expect(state.switch.enabled).toBe(true);
                    }
                    if (state.menu.items.includes("saveWithoutPublishing")) {
                      expect(live && isDirty && formValid).toBe(true);
                    }
                    if (state.menu.items.includes("preview")) {
                      expect(canPreview && hasResource).toBe(true);
                    }
                    if (state.showPendingBanner) {
                      expect(live && !isDirty).toBe(true);
                    }
                    expect(state.showPausedHint).toBe(inspecting);
                  }
    expect(checked).toBeGreaterThan(100);
  });

  it("returns only dictionary keys that exist for Pages and Scripts in both languages", () => {
    const flags = [false, true];
    const keys = new Set<string>();
    for (const hasResource of flags)
      for (const hasPublishedRevision of flags)
        for (const live of flags)
          for (const isDirty of flags)
            for (const inspecting of flags)
              for (const formValid of flags) {
                if (live && !hasPublishedRevision) continue;
                const state = getEditorHeaderState({
                  hasResource,
                  hasPublishedRevision,
                  live,
                  hasUnpublishedChanges: true,
                  isDirty,
                  inspecting,
                  formValid,
                  canPreview: false,
                });
                keys.add(state.switch.label);
                keys.add(state.primary.label);
                keys.add(state.menu.versionInfo);
                for (const reason of [
                  state.switch.disabledReason,
                  state.primary.disabledReason,
                  state.menu.disabledReason,
                ]) {
                  if (reason) keys.add(reason);
                }
              }
    for (const key of [
      "noticeSavedAndPublished",
      "noticePublished",
      "noticeBackLive",
    ]) {
      keys.add(key);
    }

    expect(keys.size).toBeGreaterThanOrEqual(12);
    for (const language of ["en", "pt-BR"]) {
      const dictionary = getPanelDictionary(language);
      for (const copy of [
        dictionary.pages.publishing,
        dictionary.customCode.publishing,
      ]) {
        for (const key of keys) {
          const text = (copy as Record<string, string>)[key];
          expect(text, `${language}: ${key}`).toBeTruthy();
        }
      }
    }
  });
});

describe("statusSwitchLabelKey (shared with the lists)", () => {
  it("labels live, offline with a published version, and never published", () => {
    expect(
      statusSwitchLabelKey({ live: true, hasPublishedRevision: true }),
    ).toBe("switchLive");
    expect(
      statusSwitchLabelKey({ live: false, hasPublishedRevision: true }),
    ).toBe("switchOff");
    expect(
      statusSwitchLabelKey({ live: false, hasPublishedRevision: false }),
    ).toBe("switchNeverPublished");
  });
});

describe("draftRowState", () => {
  it("marks the Draft row as unsaved, not published, or same as live/published", () => {
    const saved = {
      live: true,
      hasPublishedRevision: true,
      hasUnpublishedChanges: false,
    };
    expect(draftRowState({ ...saved, isDirty: true })).toBe("draftUnsaved");
    // Edição na tela vence qualquer estado salvo.
    expect(
      draftRowState({
        isDirty: true,
        live: false,
        hasPublishedRevision: false,
        hasUnpublishedChanges: true,
      }),
    ).toBe("draftUnsaved");
    expect(
      draftRowState({
        isDirty: false,
        live: true,
        hasPublishedRevision: true,
        hasUnpublishedChanges: true,
      }),
    ).toBe("draftUnpublished");
    expect(
      draftRowState({
        isDirty: false,
        live: false,
        hasPublishedRevision: false,
        hasUnpublishedChanges: false,
      }),
    ).toBe("draftUnpublished");
    // Salvo e igual à versão publicada guardada: "igual ao ar" só com o item no ar.
    expect(draftRowState({ ...saved, isDirty: false })).toBe("draftSameAsLive");
  });

  it("says 'same as published' (never 'same as live') when the item is offline", () => {
    expect(
      draftRowState({
        isDirty: false,
        live: false,
        hasPublishedRevision: true,
        hasUnpublishedChanges: false,
      }),
    ).toBe("draftSameAsPublished");
    // Fora do ar com diferença salva continua "não publicado"; com edição, "não salvo".
    expect(
      draftRowState({
        isDirty: false,
        live: false,
        hasPublishedRevision: true,
        hasUnpublishedChanges: true,
      }),
    ).toBe("draftUnpublished");
    expect(
      draftRowState({
        isDirty: true,
        live: false,
        hasPublishedRevision: true,
        hasUnpublishedChanges: false,
      }),
    ).toBe("draftUnsaved");
  });
});

/* -------------------------------------------------------------------------- */
/* Ligar o switch                                                              */
/* -------------------------------------------------------------------------- */

/** Erro no formato que `requestJson` dos editores lança: Error com `code` do envelope da API. */
function apiError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

const NO_CHANGES = apiError("INVALID_STATE", "Page has no unpublished changes");

describe("isNothingToPublishRefusal", () => {
  it("recognises only the INVALID_STATE 'no unpublished changes' refusal", () => {
    expect(
      isNothingToPublishRefusal(
        "INVALID_STATE",
        "Page has no unpublished changes",
      ),
    ).toBe(true);
    expect(
      isNothingToPublishRefusal(
        "INVALID_STATE",
        "Script has no unpublished changes",
      ),
    ).toBe(true);
    // Mesma família de código, outra recusa: ativar não resolve.
    expect(
      isNothingToPublishRefusal(
        "INVALID_STATE",
        "Page has no published revision",
      ),
    ).toBe(false);
    expect(
      isNothingToPublishRefusal("CONFLICT", "Page has no unpublished changes"),
    ).toBe(false);
    expect(isNothingToPublishRefusal(undefined, undefined)).toBe(false);
    expect(isNothingToPublishRefusal("INVALID_STATE", undefined)).toBe(false);
  });

  it("matches the exact refusal the Pages and Scripts lifecycles throw on Publish", () => {
    // O cliente depende desta frase para decidir ativar: reescrevê-la no servidor
    // faria "ligar" mostrar erro em vez de voltar a versão ao ar. A recusa mora nos
    // lifecycles (`publish` de cada módulo), que os Services apenas delegam.
    const sources = [
      "lib/Modules/Pages/lifecycle.ts",
      "lib/Modules/CustomCode/lifecycle.ts",
    ].map((path) => readFileSync(path, "utf8"));
    const messages = sources.map(
      (source) =>
        source.match(
          /"INVALID_STATE",\s*"((?:Page|Script) has no unpublished changes)"/,
        )?.[1],
    );

    expect(messages).toEqual([
      "Page has no unpublished changes",
      "Script has no unpublished changes",
    ]);
    for (const message of messages) {
      expect(isNothingToPublishRefusal("INVALID_STATE", message)).toBe(true);
    }
  });
});

describe("turnOn", () => {
  const item = { id: "page-1" };

  it("publishes the saved draft without saving when there is no edit, and never activates", async () => {
    const publish = vi.fn(async () => item);
    const activate = vi.fn(async () => item);

    const result = await turnOn({ publish, activate });

    expect(result).toEqual({
      saved: false,
      outcome: "published",
      resource: item,
    });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(null);
    expect(activate).not.toHaveBeenCalled();
  });

  it("saves the edit first and hands the saved item to publish", async () => {
    const calls: string[] = [];
    const saved = { id: "new-page-id" };
    const save = vi.fn(async () => {
      calls.push("save");
      return saved;
    });
    const publish = vi.fn(async (current: typeof saved | null) => {
      calls.push("publish");
      expect(current).toBe(saved);
      return { id: "published" };
    });
    const activate = vi.fn(async () => item);

    const result = await turnOn({ save, publish, activate });

    expect(calls).toEqual(["save", "publish"]);
    expect(result).toEqual({
      saved: true,
      outcome: "published",
      resource: { id: "published" },
    });
    expect(activate).not.toHaveBeenCalled();
  });

  it("publishes nothing when the save fails (the caller already showed the error)", async () => {
    const save = vi.fn(async () => null);
    const publish = vi.fn(async () => item);
    const activate = vi.fn(async () => item);

    await expect(turnOn({ save, publish, activate })).resolves.toBeNull();

    expect(publish).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
  });

  it("activates only after the recognised refusal, publish first and once", async () => {
    const calls: string[] = [];
    const publish = vi.fn(async () => {
      calls.push("publish");
      throw NO_CHANGES;
    });
    const activate = vi.fn(async () => {
      calls.push("activate");
      return { id: "reactivated" };
    });

    const result = await turnOn({ publish, activate });

    expect(calls).toEqual(["publish", "activate"]);
    expect(result).toEqual({
      saved: false,
      outcome: "activated",
      resource: { id: "reactivated" },
    });
  });

  it("activates the item that was just saved when the saved edit equals the published version", async () => {
    const saved = { id: "saved" };
    const activate = vi.fn(
      async (current: typeof saved | null) => current ?? item,
    );

    const result = await turnOn({
      save: async () => saved,
      publish: async () => {
        throw NO_CHANGES;
      },
      activate,
    });

    expect(activate).toHaveBeenCalledWith(saved);
    expect(result).toEqual({
      saved: true,
      outcome: "activated",
      resource: saved,
    });
  });

  it("propagates any other publish error untouched and does not activate", async () => {
    const refusals = [
      apiError("INVALID_STATE", "Page has no published revision"),
      apiError("CONFLICT", "Page was updated by another request"),
      apiError("VALIDATION_ERROR", "Media is not ready"),
      apiError("INTERNAL_ERROR", "Unable to complete the page operation"),
      new Error("Failed to fetch"),
    ];
    for (const error of refusals) {
      const activate = vi.fn(async () => item);
      await expect(
        turnOn({
          publish: async () => {
            throw error;
          },
          activate,
        }),
      ).rejects.toBe(error);
      expect(activate).not.toHaveBeenCalled();
    }
  });

  it("propagates an activate error after the refusal", async () => {
    const failure = apiError("NOT_FOUND", "Page not found");

    await expect(
      turnOn({
        publish: async () => {
          throw NO_CHANGES;
        },
        activate: async () => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
  });

  it("keeps a failed publish after a successful save visible: the draft stays saved and the error surfaces", async () => {
    const failure = apiError("VALIDATION_ERROR", "Media is not ready");
    const save = vi.fn(async () => item);

    await expect(
      turnOn({
        save,
        publish: async () => {
          throw failure;
        },
        activate: async () => item,
      }),
    ).rejects.toBe(failure);

    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe("turnOnNoticeKey", () => {
  it("tells what actually happened: saved and published, published, or back live", () => {
    expect(turnOnNoticeKey({ saved: true, outcome: "published" })).toBe(
      "noticeSavedAndPublished",
    );
    expect(turnOnNoticeKey({ saved: false, outcome: "published" })).toBe(
      "noticePublished",
    );
    expect(turnOnNoticeKey({ saved: false, outcome: "activated" })).toBe(
      "noticeBackLive",
    );
    // Ativar nunca publica: mesmo após salvar, o aviso não afirma "publicado".
    expect(turnOnNoticeKey({ saved: true, outcome: "activated" })).toBe(
      "noticeBackLive",
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Salvar com versão otimista                                                  */
/* -------------------------------------------------------------------------- */

describe("save with the optimistic version", () => {
  it("attaches expectedUpdatedAt only when the draft already has a timestamp", () => {
    expect(
      attachExpectedUpdatedAt({ title: "Home" }, "2026-08-13T12:00:00.000Z"),
    ).toEqual({
      title: "Home",
      expectedUpdatedAt: "2026-08-13T12:00:00.000Z",
    });
    expect(attachExpectedUpdatedAt({ title: "Home" }, null)).toEqual({
      title: "Home",
    });
  });

  it("treats a stale Save as a version conflict, not a slug clash", () => {
    expect(
      isOptimisticSaveConflict(
        "CONFLICT",
        "Page was updated by another request",
      ),
    ).toBe(true);
    expect(
      isOptimisticSaveConflict(
        "CONFLICT",
        "Script was updated by another request",
      ),
    ).toBe(true);
    expect(
      isOptimisticSaveConflict("CONFLICT", "Page slug is already in use"),
    ).toBe(false);
    expect(isOptimisticSaveConflict("VALIDATION_ERROR", "nope")).toBe(false);
  });
});
