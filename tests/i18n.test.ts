import { describe, expect, it } from "vitest";

import {
  NEW_POPUP_TEMPLATE_EN,
  NEW_POPUP_TEMPLATE_PT_BR,
} from "@/lib/Modules/CustomCode/newScriptTemplate";
import { MCP_POPUP_PLAYBOOK } from "@/lib/Modules/Mcp/Guide";
import { getPanelDictionary } from "@/lib/i18n/panel";

/** Caminhos de todas as folhas de texto do dicionário, ex.: "revisions.fields.name". */
function leafPaths(value: unknown, prefix = ""): string[] {
  if (typeof value === "string") return [prefix];
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) =>
      leafPaths(child, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [];
}

/** Valor em `path` ("a.b.c") dentro de um objeto aninhado. */
function valueAt(root: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (current, key) => (current as Record<string, unknown> | undefined)?.[key],
      root,
    );
}

/** Placeholders `{nome}` de um texto, em ordem alfabética (idiomas podem reordenar). */
function placeholdersOf(text: unknown): string[] {
  return typeof text === "string" ? (text.match(/\{\w+\}/g) ?? []).sort() : [];
}

describe("panel i18n", () => {
  it("provides English and Brazilian Portuguese dictionaries", () => {
    expect(getPanelDictionary("en").login.submit).toBe("Sign in");
    expect(getPanelDictionary("pt-BR").login.submit).toBe("Entrar");
    expect(
      getPanelDictionary("en").login.tooManyAttempts.length,
    ).toBeGreaterThan(0);
    expect(
      getPanelDictionary("pt-BR").login.tooManyAttempts.length,
    ).toBeGreaterThan(0);
  });

  it("falls back to English for an unknown language", () => {
    expect(getPanelDictionary("fr").login.title).toBe(
      getPanelDictionary("en").login.title,
    );
    expect(getPanelDictionary("fr").home.greeting).toBe(
      getPanelDictionary("en").home.greeting,
    );
  });

  it("provides localized Home copy with the canonical name placeholder", () => {
    const english = getPanelDictionary("en").home;
    const portuguese = getPanelDictionary("pt-BR").home;

    expect(english.greetingAfternoon).toBe("Good afternoon, {name}.");
    expect(english.newPage).toBe("New page");
    expect(english.subtitle.length).toBeGreaterThan(0);
    expect(english.overview).toBe("Overview");
    expect(portuguese.greetingAfternoon).toBe("Boa tarde, {name}.");
    expect(portuguese.newPage).toBe("New page");
    expect(english.greetingAfternoon).toContain("{name}");
    expect(portuguese.greetingAfternoon).toContain("{name}");
  });

  it("provides complete shell copy in both supported languages", () => {
    for (const language of ["en", "pt-BR"]) {
      const dictionary = getPanelDictionary(language);

      expect(dictionary.menu.panel.length).toBeGreaterThan(0);
      expect(dictionary.menu.scripts.length).toBeGreaterThan(0);
      expect(dictionary.menu.splitTests).toBe("SplitTests");
      expect(dictionary.splitTests.title.length).toBeGreaterThan(0);
      expect(dictionary.shell.panel.length).toBeGreaterThan(0);
      expect(dictionary.shell.setup.length).toBeGreaterThan(0);
      expect(dictionary.shell.notifications.length).toBeGreaterThan(0);
      expect(dictionary.profile.roles.MASTER.length).toBeGreaterThan(0);
      expect(dictionary.footer.releases.length).toBeGreaterThan(0);
      expect(dictionary.stubs.settings.description.length).toBeGreaterThan(0);
      expect(dictionary.forbidden.backToPanel.length).toBeGreaterThan(0);
      expect(dictionary.users.totalCount).toContain("{count}");
      expect(dictionary.logs.totalCount).toContain("{total}");
      expect(dictionary.notifications.title.length).toBeGreaterThan(0);
      expect(dictionary.notifications.unreadCount).toContain("{count}");
      expect(dictionary.notifications.relatedLink.length).toBeGreaterThan(0);
    }
  });

  it("provides localized bulk and quick-edit copy in both languages", () => {
    for (const language of ["en", "pt-BR"]) {
      const dictionary = getPanelDictionary(language);

      expect(dictionary.bulk.selectAll.length).toBeGreaterThan(0);
      expect(dictionary.bulk.selected.length).toBeGreaterThan(0);
      expect(dictionary.bulk.success).toContain("{count}");
      expect(dictionary.bulk.partial).toContain("{ok}");
      expect(dictionary.bulk.partial).toContain("{failed}");
      expect(dictionary.pages.quickEdit.length).toBeGreaterThan(0);
      expect(dictionary.customCode.quickEdit.length).toBeGreaterThan(0);
      expect(dictionary.pages.confirmBulkTrashDescription).toContain("{count}");
      expect(dictionary.customCode.confirmBulkTrashDescription).toContain(
        "{count}",
      );
      expect(dictionary.splitTests.confirmBulkTrashDescription).toContain(
        "{count}",
      );
      expect(dictionary.media.moveToFolder.length).toBeGreaterThan(0);
    }
  });

  // Fase 2 (C2, A12): o prompt "Ativar agora?", o toggle Ativado/Desativado, o aviso de ativação
  // ao publicar e a tabela antiga do histórico saíram de Pages, Scripts e Revisions; as asserções
  // sobre essas chaves viraram asserções de ausência. Split Tests mantém o prompt (não mudou).
  it("keeps the split-test activation prompt and drops the old Pages, Scripts and history labels", () => {
    const english = getPanelDictionary("en");
    const portuguese = getPanelDictionary("pt-BR");

    expect(english.splitTests.activationPrompt.title).toBeTruthy();
    expect(portuguese.splitTests.activationPrompt.keepDraft).toBeTruthy();
    expect(english.splitTests.activationPrompt.description).toContain(
      "/s/{slug}",
    );
    expect(english.splitTests.activationPrompt.description).toContain("307");
    expect(portuguese.splitTests.activationPrompt.description).toContain("307");

    for (const dictionary of [english, portuguese]) {
      for (const copyBlock of [dictionary.pages, dictionary.customCode]) {
        for (const key of [
          "activationPrompt",
          "activated",
          "deactivated",
          "activate",
          "deactivate",
          "publishedActivatedToast",
          "publish",
          "saved",
        ]) {
          expect(copyBlock, key).not.toHaveProperty(key);
        }
      }
      for (const key of [
        "columnActions",
        "columnVersions",
        "columnDate",
        "pin",
        "unpin",
        // `close` saiu daqui na fase 4: a chave voltou com outro significado (X do diálogo de
        // restaurar versão), coberta pelo teste de `close` por módulo abaixo.
        "empty",
        "published",
        "pinned",
      ]) {
        expect(dictionary.revisions, key).not.toHaveProperty(key);
      }
    }
    expect(english.revisions.pinLimit.length).toBeGreaterThan(0);
    expect(portuguese.revisions.restore).toBe("Restaurar");
  });

  // Fase 4 (A3, design › Diálogos): o X de todo diálogo é anunciado "Fechar"/"Close" pelo
  // dicionário do módulo que o abre; `ConfirmDialog` e `DialogContent` exigem o rótulo por tipo.
  it("names the dialog close button in every module that opens a dialog, in both languages", () => {
    const modules = [
      "pages",
      "media",
      "settings",
      "splitTests",
      "customCode",
      "revisions",
    ] as const;

    for (const [language, expected] of [
      ["en", "Close"],
      ["pt-BR", "Fechar"],
    ] as const) {
      const dictionary = getPanelDictionary(language);
      for (const block of modules) {
        expect(dictionary[block].close, `${language} ${block}`).toBe(expected);
      }
    }
  });

  it("names the MCP consent scopes with the Live / Offline vocabulary of the switch", () => {
    const english = getPanelDictionary("en").mcpConsent.scopes;
    const portuguese = getPanelDictionary("pt-BR").mcpConsent.scopes;

    expect(english["cms:pages:publish"]).toBe(
      "Publish pages and put them live",
    );
    expect(english["cms:pages:unpublish"]).toBe("Take pages offline");
    expect(english["cms:scripts:publish"]).toBe(
      "Publish scripts and put them live",
    );
    expect(english["cms:scripts:unpublish"]).toBe("Take scripts offline");
    expect(portuguese["cms:pages:publish"]).toBe(
      "Publicar páginas e colocá-las no ar",
    );
    expect(portuguese["cms:pages:unpublish"]).toBe("Tirar páginas do ar");
    expect(portuguese["cms:scripts:publish"]).toBe(
      "Publicar scripts e colocá-los no ar",
    );
    expect(portuguese["cms:scripts:unpublish"]).toBe("Tirar scripts do ar");
    // O rascunho deixou de ser o destino de "tirar do ar": o rótulo antigo não volta.
    for (const label of [
      ...Object.values(english),
      ...Object.values(portuguese),
    ]) {
      expect(label).not.toMatch(/draft|rascunho/i);
    }
  });

  it("names a scope page that no longer exists, in both languages", () => {
    expect(getPanelDictionary("en").customCode.pageUnavailable).toMatch(
      /unavailable/i,
    );
    expect(getPanelDictionary("pt-BR").customCode.pageUnavailable).toMatch(
      /indispon/i,
    );
  });

  // Fase 3, T5 (A6): o rodapé do código do editor de scripts e o cancelar da exclusão leem o
  // dicionário nos dois idiomas, sem texto fixo no JSX nem a chave de navegação (`back`).
  it("provides the script editor footer limit and the confirmation cancel label in both languages", () => {
    for (const language of ["en", "pt-BR"]) {
      const { customCode } = getPanelDictionary(language);

      expect(customCode.contentLimit).toContain("2 MiB");
      expect(customCode.cancel).not.toBe(customCode.back);
    }
    expect(getPanelDictionary("en").customCode.cancel).toBe("Cancel");
    expect(getPanelDictionary("pt-BR").customCode.cancel).toBe("Cancelar");
  });

  it("keeps every key of the English and Brazilian Portuguese dictionaries in sync", () => {
    const english = leafPaths(getPanelDictionary("en"));
    const portuguese = leafPaths(getPanelDictionary("pt-BR"));

    expect(english.length).toBeGreaterThan(500);
    expect(portuguese.filter((path) => !english.includes(path))).toEqual([]);
    expect(english.filter((path) => !portuguese.includes(path))).toEqual([]);
  });

  it("uses the same placeholders in both languages for the publishing and versions copy", () => {
    const english = getPanelDictionary("en");
    const portuguese = getPanelDictionary("pt-BR");

    for (const block of [
      "pages.publishing",
      "customCode.publishing",
      "revisions",
    ]) {
      const englishBlock = valueAt(english, block);
      const portugueseBlock = valueAt(portuguese, block);
      for (const path of leafPaths(englishBlock)) {
        expect(
          placeholdersOf(valueAt(portugueseBlock, path)),
          `${block}.${path}`,
        ).toEqual(placeholdersOf(valueAt(englishBlock, path)));
      }
    }
  });

  it("carries the publishing vocabulary the spec fixes, in Portuguese and in English", () => {
    const pt = getPanelDictionary("pt-BR");
    const en = getPanelDictionary("en");

    // Switch, botão principal, menu e avisos de Pages (spec F1 a F5, F9).
    expect(pt.pages.publishing).toMatchObject({
      switchLive: "No ar",
      switchOff: "Fora do ar",
      switchNeverPublished: "Fora do ar · nunca publicada",
      buttonSave: "Salvar",
      buttonSaveAndPublish: "Salvar e publicar",
      buttonCreate: "Criar",
      menuSaveWithoutPublishing: "Salvar sem publicar",
      menuPreview: "Pré-visualizar",
      pendingBanner: "Há alterações salvas que ainda não estão no ar.",
      unsavedIndicator: "Não salvo",
      reasonInspecting: "Pausado durante a comparação",
      menuNeverPublished: "Ainda não publicada",
      noticeSavedAndPublished: "Salvo e publicado.",
      noticeSavedAlreadyLive: "Salvo. O ar já está com esta versão.",
      noticePublished: "Publicado.",
      noticeBackLive: "De volta ao ar.",
      noticeTakenOffline: "Fora do ar.",
      noticeDraftSaved: "Rascunho salvo. Continua fora do ar.",
      unpublishTitle: "Tirar do ar?",
      unpublishDescription:
        "A URL passa a dar 404. O rascunho e as versões ficam.",
    });
    expect(pt.pages.publishing.menuLiveVersion).toBe(
      "Versão no ar: {date} · {author}",
    );
    expect(en.pages.publishing).toMatchObject({
      switchLive: "Live",
      switchOff: "Offline",
      buttonSaveAndPublish: "Save and publish",
      menuPreview: "Preview",
      noticeSavedAlreadyLive:
        "Saved. The live version already matches this draft.",
    });
    // O aviso da recusa "sem alteração" nunca afirma publicação, em nenhum módulo nem idioma.
    expect(en.customCode.publishing.noticeSavedAlreadyLive).toBe(
      en.pages.publishing.noticeSavedAlreadyLive,
    );
    expect(pt.customCode.publishing.noticeSavedAlreadyLive).toBe(
      pt.pages.publishing.noticeSavedAlreadyLive,
    );
    expect(pt.pages.publishing.noticeSavedAlreadyLive).not.toMatch(/publicad/i);
    expect(en.pages.publishing.noticeSavedAlreadyLive).not.toMatch(
      /published/i,
    );

    // Scripts: mesma regra, texto de script e sem Pré-visualizar (spec F5, F4).
    expect(pt.customCode.publishing.unpublishDescription).toBe(
      "O script deixa de ser injetado no site. O rascunho e as versões ficam.",
    );
    expect(pt.customCode.publishing.buttonSaveAndPublish).toBe(
      "Salvar e publicar",
    );
    expect(pt.customCode.publishing).not.toHaveProperty("menuPreview");
    expect(en.customCode.publishing).not.toHaveProperty("menuPreview");

    // Versões, comparação, restaurar e desfazer (spec F6 a F8).
    expect(pt.revisions).toMatchObject({
      title: "Versões",
      live: "No ar",
      publishedOffline: "Publicada",
      draftUnsaved: "não salvo",
      draftUnpublished: "não publicado",
      draftSameAsLive: "igual ao ar",
      draftSameAsPublished: "igual à publicada",
      pinLimit: "Já há 3 versões fixadas. Desafixe uma para fixar esta.",
      compareTitle: "Comparando",
      compareDraftBadge: "Rascunho atual",
      otherFieldsTitle: "Outros campos que mudam",
      otherFieldsNone: "Nenhum. Só o código muda.",
      noDifference: "Conteúdo idêntico ao rascunho.",
      restoreAction: "Restaurar esta versão no rascunho",
      backToEditing: "Voltar a editar",
      restoreBlockedDirty:
        "Salve ou descarte as alterações não salvas para restaurar.",
      restoreBlockedIdentical: "Esta versão é idêntica ao rascunho.",
      formPausedNote: "Edição pausada enquanto você compara.",
      confirmRestoreDescription:
        "O rascunho passa a ter o conteúdo desta versão. Nada é publicado.",
      undo: "Desfazer",
      undone: "Restauração desfeita.",
      conflict:
        "Este rascunho mudou em outra sessão. Recarregue e tente de novo.",
    });
    expect(pt.revisions.confirmRestoreTitle).toBe(
      "Restaurar a versão de {date} ({author})?",
    );
    // Selo "igual" com o item fora do ar e nome do código somente leitura da comparação.
    expect(en.revisions.draftSameAsPublished).toBe("same as published");
    expect(pt.revisions.versionCode).toBe("Código da versão");
    expect(en.revisions.versionCode).toBe("Version code");
    // O nome do código não pode repetir o da região "Versões" (nome acessível distinto).
    expect(en.revisions.versionCode).not.toBe(en.revisions.title);
    expect(pt.revisions.versionCode).not.toBe(pt.revisions.title);
    expect(pt.revisions.restored).toBe(
      "Versão de {date} restaurada no rascunho. Nada foi publicado.",
    );
    expect(pt.revisions.versionsCounter).toBe(
      "{total} de {limit} · {pinned}/3 fixadas",
    );
    // Nome acessível da linha: o marcador do Badge (No ar / Publicada) entra no texto, nos dois
    // idiomas, porque o aria-label substitui o texto visível (A7).
    expect(pt.revisions.versionRowLabelLive).toBe(
      "Versão de {date} por {author}, no ar",
    );
    expect(pt.revisions.versionRowLabelPublished).toBe(
      "Versão de {date} por {author}, publicada",
    );
    expect(en.revisions.versionRowLabelPublished).toBe(
      "Version from {date} by {author}, published",
    );
  });

  it("names every compared field of Pages and Scripts in both languages", () => {
    for (const language of ["en", "pt-BR"]) {
      const { fields } = getPanelDictionary(language).revisions;

      expect(Object.keys(fields).sort()).toEqual(
        [
          "displayResetDays",
          "folder",
          "location",
          "maxDisplays",
          "name",
          "priority",
          "scope",
          "scopedPages",
          "seoDescription",
          "seoKeyword",
          "seoTitle",
          "slug",
          "trigger",
          "triggerConfig",
        ].sort(),
      );
      for (const label of Object.values(fields)) {
        expect(label.length).toBeGreaterThan(0);
      }
    }
  });

  it("drops the unused Unpublish labels of Pages and Scripts and keeps the Split Tests ones", () => {
    for (const language of ["en", "pt-BR"]) {
      const dictionary = getPanelDictionary(language);

      expect(dictionary.pages).not.toHaveProperty("unpublish");
      expect(dictionary.customCode).not.toHaveProperty("unpublish");
      expect(dictionary.splitTests.unpublish.length).toBeGreaterThan(0);
    }
  });

  it("shares the popup starter with MCP and keeps its rules in the guide", () => {
    const english = getPanelDictionary("en").customCode;
    const portuguese = getPanelDictionary("pt-BR").customCode;

    expect(english.popupTemplate).toBe(NEW_POPUP_TEMPLATE_EN);
    expect(portuguese.popupTemplate).toBe(NEW_POPUP_TEMPLATE_PT_BR);
    // O playbook de popup vive só no manual do MCP (inglês): o painel não o exibe, então o
    // dicionário não guarda cópia em nenhum idioma.
    expect(english).not.toHaveProperty("popupPlaybook");
    expect(portuguese).not.toHaveProperty("popupPlaybook");
    expect(MCP_POPUP_PLAYBOOK).toContain("never closes the popup");
    expect(english).not.toHaveProperty("usePopupTemplate");
    expect(english).not.toHaveProperty("popupSummary");
  });

  // Fase 4, T3 (A3): cada módulo com diálogo traz o cancelar e o nome acessível do X no seu bloco,
  // nos dois idiomas, em vez de literal em inglês no JSX ou no primitivo `Dialog`.
  it("provides the dialog cancel and close labels of Backup, MCP connections, Users and Folders in both languages", () => {
    const english = getPanelDictionary("en");
    const portuguese = getPanelDictionary("pt-BR");

    for (const block of ["backup", "mcpConnections"] as const) {
      expect(english[block].cancel).toBe("Cancel");
      expect(portuguese[block].cancel).toBe("Cancelar");
    }
    for (const block of [
      "backup",
      "mcpConnections",
      "users",
      "folders",
    ] as const) {
      expect(english[block].close).toBe("Close");
      expect(portuguese[block].close).toBe("Fechar");
    }
  });

  // Fase 4, T3 (A3): o seletor de páginas do escopo tem texto próprio de carregando, vazio e erro,
  // em vez de reusar a copy de scripts (`loading`, `empty`, `error`), nos dois idiomas.
  it("gives the script scope page picker its own loading, empty and error copy about pages", () => {
    const english = getPanelDictionary("en").customCode;
    const portuguese = getPanelDictionary("pt-BR").customCode;

    expect(english.pagesLoading).toBe("Loading pages…");
    expect(english.pagesEmpty).toBe("No pages match this search.");
    expect(english.pagesError).toMatch(/pages/i);
    expect(portuguese.pagesLoading).toBe("Carregando páginas…");
    expect(portuguese.pagesEmpty).toBe(
      "Nenhuma página corresponde a esta busca.",
    );
    expect(portuguese.pagesError).toMatch(/páginas/i);
    for (const copy of [english, portuguese]) {
      expect(copy.pagesLoading).not.toBe(copy.loading);
      expect(copy.pagesEmpty).not.toBe(copy.empty);
      expect(copy.pagesError).not.toBe(copy.error);
    }
  });

  // Fase 4, T4 (A4): o botão de ordenação mobile da listagem de Pages tem o texto visível "Nome" e
  // um nome acessível por direção atual, nos dois idiomas. O nome acessível contém o texto visível
  // (rótulo no nome) para quem controla por voz.
  it("names the Pages sort button by its visible text and its current direction in both languages", () => {
    const english = getPanelDictionary("en").pages;
    const portuguese = getPanelDictionary("pt-BR").pages;

    expect(english.nameLabel).toBe("Name");
    expect(english.sortNameAsc).toBe("Sort by name, A to Z");
    expect(english.sortNameDesc).toBe("Sort by name, Z to A");
    expect(portuguese.nameLabel).toBe("Nome");
    expect(portuguese.sortNameAsc).toBe("Ordenar por nome, A a Z");
    expect(portuguese.sortNameDesc).toBe("Ordenar por nome, Z a A");
    for (const copy of [english, portuguese]) {
      expect(copy.sortNameAsc).not.toBe(copy.sortNameDesc);
      for (const accessibleName of [copy.sortNameAsc, copy.sortNameDesc]) {
        expect(accessibleName.toLowerCase()).toContain(
          copy.nameLabel.toLowerCase(),
        );
      }
    }
  });
});
