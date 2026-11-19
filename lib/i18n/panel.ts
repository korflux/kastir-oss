import type { McpScope } from "@/lib/Modules/Mcp/Scopes";
import {
  NEW_POPUP_TEMPLATE_EN,
  NEW_POPUP_TEMPLATE_PT_BR,
  NEW_SCRIPT_TEMPLATE_EN,
  NEW_SCRIPT_TEMPLATE_PT_BR,
} from "@/lib/Modules/CustomCode/newScriptTemplate";
import {
  NEW_PAGE_TEMPLATE_EN,
  NEW_PAGE_TEMPLATE_PT_BR,
} from "@/lib/Modules/Pages/newPageTemplate";

export type ActivationPromptCopy = {
  title: string;
  description: string;
  keepDraft: string;
};

const ACTIVATION_PROMPT_EN: ActivationPromptCopy = {
  title: "Activate now?",
  description:
    "This item is saved as a draft and is not live yet. Activate it now, or continue editing as a draft.",
  keepDraft: "Continue as draft",
};

const ACTIVATION_PROMPT_PT_BR: ActivationPromptCopy = {
  title: "Ativar agora?",
  description:
    "Este item foi salvo como rascunho e ainda não está no ar. Ative agora ou continue editando como rascunho.",
  keepDraft: "Continuar rascunho",
};

/**
 * Textos do ciclo "no ar / fora do ar" de Pages e Scripts: switch, confirmação de tirar do
 * ar, avisos de resultado e cabeçalho do editor. Listagens e editores só recebem o
 * dicionário do próprio módulo, por isso o bloco mora em `pages.publishing` e
 * `customCode.publishing` (mesmas chaves, textos de módulo nos campos de
 * `PublishingModuleCopy`).
 *
 * Os campos `switch*`, `button*`, `menu*` e `reason*` são as chaves devolvidas por
 * `getEditorHeaderState` (revisionEditorState.ts): o componente lê `copy[state.campo]`.
 * Placeholders: `{date}` e `{author}` (formatados pelo componente).
 */
export type PublishingCopy = {
  /** Switch: estado no ar. */
  switchLive: string;
  /** Switch: fora do ar, com versão publicada guardada. */
  switchOff: string;
  /** Switch: fora do ar e nunca publicada (texto com gênero do módulo). */
  switchNeverPublished: string;
  /** Rótulo curto do estado fora do ar no mobile da listagem (nome acessível segue completo). */
  switchOffShort: string;
  /** Nome acessível do switch quando está fora do ar (a ação de ligar). */
  switchTurnOn: string;
  /** Nome acessível do switch quando está no ar (a ação de desligar). */
  switchTurnOff: string;
  /** Confirmação ao desligar: título, frase (texto do módulo) e botão destrutivo. */
  unpublishTitle: string;
  unpublishDescription: string;
  unpublishConfirm: string;
  /** Avisos de sucesso (toast): editor e listagem. */
  noticeSavedAndPublished: string;
  /**
   * "Salvar e publicar" em que o salvar iguala o rascunho ao que já está no ar: o servidor recusa
   * publicar ("sem alteração") e nada foi publicado, então o aviso não pode dizer "publicado".
   */
  noticeSavedAlreadyLive: string;
  noticePublished: string;
  noticeBackLive: string;
  noticeTakenOffline: string;
  noticeDraftSaved: string;
  noticeSavedNotPublished: string;
  /** Botão principal do cabeçalho e seus estados ocupados. */
  buttonSave: string;
  buttonSaveAndPublish: string;
  buttonCreate: string;
  buttonSaving: string;
  buttonPublishing: string;
  /** Indicador de edição não salva e faixa de alteração salva não publicada. */
  unsavedIndicator: string;
  pendingBanner: string;
  /** Nome acessível e tooltip do trigger do menu ⋯. */
  moreActions: string;
  /** Primeira linha do menu ⋯ (versão no ar, publicada fora do ar, nunca publicada). */
  menuLiveVersion: string;
  menuStoredVersion: string;
  menuNeverPublished: string;
  /** Ação "Salvar sem publicar" do menu ⋯ e sua linha de ajuda. */
  menuSaveWithoutPublishing: string;
  menuSaveWithoutPublishingHint: string;
  /** Motivos de um controle estar desabilitado (C4: nenhum bloqueio sem texto). */
  reasonInspecting: string;
  reasonNothingToSave: string;
  reasonNothingToPublish: string;
  reasonInvalidForm: string;
  reasonNewItem: string;
};

/** Campos de `PublishingCopy` cujo texto muda entre Pages e Scripts (gênero e vocabulário). */
type PublishingModuleCopy = Pick<
  PublishingCopy,
  | "switchNeverPublished"
  | "menuNeverPublished"
  | "unpublishDescription"
  | "reasonInvalidForm"
>;

/** Pages acrescenta Pré-visualizar ao menu ⋯; Scripts não tem página própria. */
export type PagesPublishingCopy = PublishingCopy & {
  menuPreview: string;
  menuPreviewHint: string;
};

const PUBLISHING_SHARED_EN: Omit<PublishingCopy, keyof PublishingModuleCopy> = {
  switchLive: "Live",
  switchOff: "Offline",
  switchOffShort: "Off",
  switchTurnOn: "Put live",
  switchTurnOff: "Take offline",
  unpublishTitle: "Take offline?",
  unpublishConfirm: "Take offline",
  noticeSavedAndPublished: "Saved and published.",
  noticeSavedAlreadyLive: "Saved. The live version already matches this draft.",
  noticePublished: "Published.",
  noticeBackLive: "Back live.",
  noticeTakenOffline: "Taken offline.",
  noticeDraftSaved: "Draft saved. Still offline.",
  noticeSavedNotPublished:
    "Saved without publishing. The live version is unchanged.",
  buttonSave: "Save",
  buttonSaveAndPublish: "Save and publish",
  buttonCreate: "Create",
  buttonSaving: "Saving…",
  buttonPublishing: "Publishing…",
  unsavedIndicator: "Unsaved",
  pendingBanner: "There are saved changes that are not live yet.",
  moreActions: "More actions",
  menuLiveVersion: "Live version: {date} · {author}",
  menuStoredVersion: "Published version (offline): {date} · {author}",
  menuSaveWithoutPublishing: "Save without publishing",
  menuSaveWithoutPublishingHint:
    "Keeps your work; the live version only changes on the next Save and publish.",
  reasonInspecting: "Paused while comparing",
  reasonNothingToSave: "Nothing to save.",
  reasonNothingToPublish:
    "Nothing to publish: what is in the editor is already live.",
  reasonNewItem: "Available after you create it.",
};

const PUBLISHING_SHARED_PT_BR: Omit<
  PublishingCopy,
  keyof PublishingModuleCopy
> = {
  switchLive: "No ar",
  switchOff: "Fora do ar",
  switchOffShort: "Fora",
  switchTurnOn: "Colocar no ar",
  switchTurnOff: "Tirar do ar",
  unpublishTitle: "Tirar do ar?",
  unpublishConfirm: "Tirar do ar",
  noticeSavedAndPublished: "Salvo e publicado.",
  noticeSavedAlreadyLive: "Salvo. O ar já está com esta versão.",
  noticePublished: "Publicado.",
  noticeBackLive: "De volta ao ar.",
  noticeTakenOffline: "Fora do ar.",
  noticeDraftSaved: "Rascunho salvo. Continua fora do ar.",
  noticeSavedNotPublished:
    "Salvo sem publicar. O ar continua com a versão anterior.",
  buttonSave: "Salvar",
  buttonSaveAndPublish: "Salvar e publicar",
  buttonCreate: "Criar",
  buttonSaving: "Salvando…",
  buttonPublishing: "Publicando…",
  unsavedIndicator: "Não salvo",
  pendingBanner: "Há alterações salvas que ainda não estão no ar.",
  moreActions: "Mais ações",
  menuLiveVersion: "Versão no ar: {date} · {author}",
  menuStoredVersion: "Versão publicada (fora do ar): {date} · {author}",
  menuSaveWithoutPublishing: "Salvar sem publicar",
  menuSaveWithoutPublishingHint:
    "Guarda o trabalho; o ar só muda no próximo Salvar e publicar.",
  reasonInspecting: "Pausado durante a comparação",
  reasonNothingToSave: "Nada para salvar.",
  reasonNothingToPublish:
    "Nada para publicar: o que está no editor já está no ar.",
  reasonNewItem: "Disponível depois de criar.",
};

export type PanelDictionary = {
  login: {
    eyebrow: string;
    title: string;
    description: string;
    email: string;
    password: string;
    submit: string;
    submitting: string;
    invalidCredentials: string;
    invalidForm: string;
    tooManyAttempts: string;
    unavailable: string;
  };
  mcpConsent: {
    eyebrow: string;
    title: string;
    description: string;
    client: string;
    unverifiedBadge: string;
    unverifiedWarning: string;
    redirectUri: string;
    resource: string;
    scopesTitle: string;
    scopes: Record<McpScope, string>;
    allowed: string;
    notAllowed: string;
    unknownScope: string;
    allow: string;
    deny: string;
    working: string;
    error: string;
    invalidRequest: string;
    invalidRole: string;
  };
  mcpConnections: {
    title: string;
    description: string;
    endpoint: string;
    client: string;
    user: string;
    scopes: string;
    created: string;
    updated: string;
    lastTokenIssued: string;
    active: string;
    inactive: string;
    revoke: string;
    revoking: string;
    empty: string;
    loading: string;
    error: string;
    retry: string;
    noTokenIssued: string;
    /** Cancelar do diálogo de revogação (ConfirmDialog). */
    cancel: string;
    /** Nome acessível do botão de fechar (X) dos diálogos deste módulo. */
    close: string;
  };
  menu: {
    home: string;
    panel: string;
    pages: string;
    media: string;
    scripts: string;
    splitTests: string;
    users: string;
  };
  bulk: {
    selected: string;
    selectItem: string;
    selectAll: string;
    selectionLimit: string;
    clear: string;
    moveFolder: string;
    moveToTrash: string;
    convertWebp: string;
    delete: string;
    save: string;
    cancel: string;
    working: string;
    success: string;
    partial: string;
    failed: string;
    noPermission: string;
  };
  backup: {
    title: string;
    description: string;
    exportTitle: string;
    exportDescription: string;
    exportButton: string;
    /** CTA do mockup ("Create a Snapshot"). */
    createSnapshot: string;
    exportWorking: string;
    exportCredentialsWarning: string;
    importTitle: string;
    importDescription: string;
    importChooseFile: string;
    /** Botão "Select Archive" do mockup. */
    selectArchive: string;
    importStage: string;
    importConfirm: string;
    importWorking: string;
    historyTitle: string;
    historyEmpty: string;
    download: string;
    restore: string;
    restoreWorking: string;
    delete: string;
    confirmationLabel: string;
    confirmationHint: string;
    targetOrigin: string;
    sourceOrigin: string;
    replacements: string;
    jobStatus: string;
    refresh: string;
    error: string;
    successExport: string;
    successRestore: string;
    successImport: string;
    recoveryBadge: string;
    recoveryHint: string;
    downloadExport: string;
    restoreConfirmPlaceholder: string;
    sessionExpired: string;
    sessionEndedTitle: string;
    sessionEndedRestoreDescription: string;
    sessionEndedImportDescription: string;
    goToLogin: string;
    /** Seção de agendamento de snapshot automático (fase 33). */
    autoTitle: string;
    autoDescription: string;
    autoEnabled: string;
    autoIntervalDays: string;
    autoTime: string;
    autoTimezone: string;
    autoSave: string;
    autoSaving: string;
    autoSaved: string;
    autoSavedSchedulerDeferred: string;
    autoInvalidInterval: string;
    /** Cancelar do diálogo de restauração (ConfirmDialog). */
    cancel: string;
    /** Nome acessível do botão de fechar (X) dos diálogos deste módulo. */
    close: string;
  };
  shell: {
    brand: string;
    panel: string;
    openMenu: string;
    theme: string;
    switchToLight: string;
    switchToDark: string;
    notifications: string;
    profile: string;
    accessSite: string;
    setup: string;
    more: string;
    closeMore: string;
    /** Preferência local de quais abas do menu ficam visíveis. */
    customizeMenu: string;
    customizeMenuDescription: string;
  };
  notifications: {
    title: string;
    description: string;
    buttonLabel: string;
    unreadCount: string;
    unread: string;
    read: string;
    markAsRead: string;
    relatedLink: string;
    loading: string;
    empty: string;
    error: string;
    retry: string;
    close: string;
  };
  profile: {
    title: string;
    description: string;
    name: string;
    role: string;
    roles: {
      MASTER: string;
      ADMIN: string;
      EDITOR: string;
    };
    save: string;
    saving: string;
    saved: string;
    invalidName: string;
    updateFailed: string;
    close: string;
    logout: string;
  };
  footer: {
    version: string;
    releases: string;
  };
  home: {
    greeting: string;
    greetingMorning: string;
    greetingAfternoon: string;
    greetingEvening: string;
    subtitle: string;
    newPage: string;
    overview: string;
    pagesUnit: string;
    mediasUnit: string;
    scriptsUnit: string;
    splitTestsUnit: string;
    usersUnit: string;
    pagesDetail: string;
    mediasDetail: string;
    scriptsDetail: string;
    splitTestsDetail: string;
    usersDetail: string;
  };
  tour: {
    title: string;
    description: string;
    progress: string;
    previous: string;
    next: string;
    finish: string;
    skip: string;
    close: string;
    pagesTitle: string;
    pagesDescription: string;
    mediaTitle: string;
    mediaDescription: string;
    customCodeTitle: string;
    customCodeDescription: string;
    usersTitle: string;
    usersDescription: string;
    logsTitle: string;
    logsDescription: string;
  };
  pages: {
    title: string;
    description: string;
    newPage: string;
    searchBy: string;
    allPages: string;
    folderDescription: string;

    trashDescription: string;
    titleLabel: string;
    /** Label do campo no editor (Figma: Name) e texto do botão de ordenação mobile da listagem. */
    nameLabel: string;
    /**
     * Nome acessível do botão de ordenação mobile da listagem, com a direção atual
     * (`asc` = A a Z, `desc` = Z a A). O botão alterna a direção; o texto visível é `nameLabel`.
     */
    sortNameAsc: string;
    sortNameDesc: string;
    pageColumn: string;
    author: string;
    /** Coluna na lixeira: quem moveu a página pro trash. */
    deletedBy: string;
    folderLabel: string;
    createdAtLabel: string;
    publishedAtLabel: string;
    delete: string;

    status: string;
    activeSnippets: string;
    published: string;
    draft: string;
    created: string;
    deleted: string;
    actions: string;
    edit: string;
    preview: string;
    viewPublished: string;
    publicUrl: string;
    copyUrl: string;
    back: string;
    create: string;
    folders: string;
    trash: string;
    deletedPages: string;
    active: string;

    empty: string;
    loading: string;
    error: string;
    save: string;
    invalidForm: string;
    duplicate: string;
    moveToTrash: string;
    quickEdit: string;
    moveToFolder: string;
    confirmBulkTrashTitle: string;
    confirmBulkTrashDescription: string;
    confirmBulkPermanentTitle: string;
    confirmBulkPermanentDescription: string;
    restore: string;
    permanentlyDelete: string;
    confirmPermanentTitle: string;
    confirmPermanentDescription: string;
    slugConflict: string;
    contentTooLarge: string;
    retry: string;
    working: string;
    cancel: string;
    /** Nome acessível do botão de fechar (X) dos diálogos deste módulo. */
    close: string;
    /** Seletor de imagem do editor de código (título e confirmar); o cancelar reusa `cancel`. */
    chooseImage: string;
    selectImage: string;
    confirmTrashTitle: string;
    confirmTrashDescription: string;
    confirmFolderDeleteTitle: string;
    confirmFolderDeleteDescription: string;
    editorDescription: string;
    content: string;
    contentPlaceholder: string;
    contentBytes: string;
    newPageTemplate: string;
    selectFolder: string;
    seo: string;
    seoTitle: string;
    seoDescription: string;
    seoKeyword: string;
    /** Switch, confirmação, avisos e cabeçalho do editor (fase 2). */
    publishing: PagesPublishingCopy;
  };
  media: {
    title: string;
    description: string;
    allMedia: string;
    folders: string;
    folderDescription: string;
    upload: string;
    uploading: string;
    chooseFiles: string;
    searchPlaceholder: string;
    empty: string;
    loading: string;
    error: string;
    retry: string;
    selected: string;
    deleteSelected: string;
    delete: string;
    replace: string;
    convertToWebp: string;
    convertAllToWebp: string;
    converting: string;
    copyLink: string;
    largeRaster: string;
    details: string;
    name: string;
    alt: string;
    descriptionLabel: string;
    save: string;
    saving: string;
    saved: string;
    type: string;
    size: string;
    status: string;
    ready: string;
    processing: string;
    failed: string;
    date: string;
    viewGrid: string;
    viewList: string;
    confirmDeleteTitle: string;
    confirmDeleteDescription: string;
    /** Frase exata exigida no delete em lote (2+). */
    confirmBulkDeletePhrase: string;
    confirmBulkDeletePhraseLabel: string;
    confirmFolderDeleteTitle: string;
    confirmFolderDeleteDescription: string;
    cancel: string;
    /** Nome acessível do botão de fechar (X) dos diálogos deste módulo. */
    close: string;
    working: string;
    uploadHint: string;
    moveToFolder: string;
  };
  settings: {
    title: string;
    description: string;
    /** Título/descrição da aba General (Setup). */
    generalTitle: string;
    generalDescription: string;
    /** Título/descrição da aba Settings (Setup). */
    settingsTitle: string;
    settingsDescription: string;
    general: string;
    siteTitle: string;
    siteTitleHelp: string;
    tagline: string;
    taglineHelp: string;
    seoDescription: string;
    seoDescriptionHelp: string;
    favicon: string;
    faviconHelp: string;
    faviconNone: string;
    selectMedia: string;
    clearMedia: string;
    url: string;
    urlHelp: string;
    localization: string;
    siteLanguage: string;
    siteLanguageHelp: string;
    timezone: string;
    dateFormat: string;
    timeFormat: string;
    weekStartsOn: string;
    localizationHelp: string;
    localizationPreview: string;
    publishing: string;
    homePage: string;
    homePageNone: string;
    homePageHelp: string;
    notFoundPage: string;
    /** Rótulo curto do mockup Settings ("404 Redirect"). */
    notFoundPageShort: string;
    notFoundNone: string;
    notFoundHelp: string;
    redirect404: string;
    /** Rótulo curto do mockup ("Redirect to Home Page"). */
    redirect404Short: string;
    or: string;
    indexing: string;
    indexable: string;
    allowAiCrawlers: string;
    sitemapEnabled: string;
    indexingHelp: string;
    cache: string;
    cacheHelp: string;
    cloudflareToken: string;
    tokenConfigured: string;
    tokenPlaceholder: string;
    removeToken: string;
    cloudflareZoneId: string;
    webp: string;
    webpConversion: string;
    webpHelp: string;
    revisionRetention: string;
    revisionRetentionLimit: string;
    revisionRetentionHelp: string;
    verifyPublished: string;
    verifyHome: string;
    verifyRobots: string;
    verifySitemap: string;
    save: string;
    saving: string;
    saved: string;
    error: string;
    retry: string;
    confirmUrlTitle: string;
    confirmUrlDescription: string;
    confirm: string;
    cancel: string;
    /** Nome acessível do botão de fechar (X) dos diálogos deste módulo. */
    close: string;
    queueFailed: string;
    invalidTitle: string;
    formats: {
      en: string;
      ptBR: string;
      dateDMY: string;
      dateMDY: string;
      dateISO: string;
      time24: string;
      time12: string;
      sunday: string;
      monday: string;
      tuesday: string;
      wednesday: string;
      thursday: string;
      friday: string;
      saturday: string;
    };
  };
  splitTests: {
    title: string;
    description: string;
    newCampaign: string;
    name: string;
    /** Coluna da lista (Figma: Tests). */
    testsColumn: string;
    /** Coluna do editor de destinos (Figma: Page). */
    pageColumn: string;
    /** Coluna do editor de destinos (Figma: URL). */
    urlColumn: string;
    slug: string;
    status: string;
    /** ACTIVE no banco; UI/Figma: Published. */
    published: string;
    /** PAUSED no banco; UI/Figma: Draft — /s/slug → 404. */
    draft: string;
    publish: string;
    unpublish: string;
    active: string;
    paused: string;
    activateCampaign: string;
    pauseCampaign: string;
    destinations: string;
    /** Contagem na lista — ex.: "2 Urls". */
    destinationsCount: string;
    destinationUrl: string;
    destinationLabel: string;
    /** Seed do 1º destino ao criar campanha. */
    defaultDestinationName: string;
    /** Name + URL obrigatórios no form de destino. */
    destinationRequired: string;
    newDestination: string;
    addDestination: string;
    removeDestination: string;
    pauseDestination: string;
    activateDestination: string;
    editDestination: string;
    saveDestination: string;
    cannotPauseLastActive: string;
    moveUp: string;
    moveDown: string;
    theoretical: string;
    real: string;
    hits: string;
    totalHits: string;
    publicUrl: string;
    copyUrl: string;
    copied: string;
    save: string;
    saved: string;
    create: string;
    edit: string;
    quickEdit: string;
    quickEditValidationError: string;
    delete: string;
    actions: string;
    author: string;
    created: string;
    createdAtLabel: string;
    updatedAtLabel: string;
    search: string;
    searchBy: string;
    empty: string;
    loading: string;
    error: string;
    retry: string;
    back: string;
    working: string;
    confirmDeleteTitle: string;
    confirmDeleteDescription: string;
    confirmDeleteDestinationTitle: string;
    confirmDeleteDestinationDescription: string;
    /** Soft delete (paridade Pages). */
    moveToTrash: string;
    confirmBulkTrashTitle: string;
    confirmBulkTrashDescription: string;
    confirmBulkPermanentTitle: string;
    confirmBulkPermanentDescription: string;
    confirmTrashTitle: string;
    confirmTrashDescription: string;
    deletedCampaigns: string;
    restore: string;
    permanentlyDelete: string;
    confirmPermanentTitle: string;
    confirmPermanentDescription: string;
    deleted: string;
    deletedBy: string;
    confirm: string;
    cancel: string;
    /** Nome acessível do botão de fechar (X) dos diálogos deste módulo. */
    close: string;
    atLeastOneDestination: string;
    activationPrompt: ActivationPromptCopy;
  };
  customCode: {
    title: string;
    description: string;
    newSnippet: string;
    /** Canonical HTML seed for a brand-new script (base variant). */
    newScriptTemplate: string;
    /** Canonical popup seed for MCP `{ popup: true }` — not shown in the panel. */
    popupTemplate: string;
    name: string;
    /** Coluna da lista (Figma: Script). */
    scriptColumn: string;
    location: string;
    header: string;
    bodyStart: string;
    bodyEnd: string;
    content: string;
    priority: string;
    scope: string;
    status: string;
    allPages: string;
    specificPages: string;
    pages: string;
    selectPages: string;
    searchPages: string;
    save: string;
    published: string;
    draft: string;
    duplicate: string;
    delete: string;
    confirmDeleteTitle: string;
    confirmDeleteDescription: string;
    /** Soft delete (paridade Pages). */
    moveToTrash: string;
    quickEdit: string;
    confirmBulkTrashTitle: string;
    confirmBulkTrashDescription: string;
    confirmBulkPermanentTitle: string;
    confirmBulkPermanentDescription: string;
    confirmTrashTitle: string;
    confirmTrashDescription: string;
    deletedScripts: string;
    restore: string;
    permanentlyDelete: string;
    confirmPermanentTitle: string;
    confirmPermanentDescription: string;
    deleted: string;
    deletedBy: string;
    actions: string;
    author: string;
    created: string;
    updated: string;
    searchSnippets: string;
    searchBy: string;
    loadMorePages: string;
    /** Estados do seletor de páginas do escopo (não reusam `empty`/`loading`/`error`, que falam de scripts). */
    pagesLoading: string;
    pagesEmpty: string;
    pagesError: string;
    empty: string;
    loading: string;
    error: string;
    retry: string;
    edit: string;
    create: string;
    back: string;
    cancel: string;
    /** Nome acessível do botão de fechar (X) dos diálogos deste módulo. */
    close: string;
    /** Seletor de imagem do editor de código (título e confirmar); o cancelar reusa `cancel`. */
    chooseImage: string;
    selectImage: string;
    working: string;
    quickEditValidationError: string;
    contentHelp: string;
    /** Sufixo do contador de bytes no rodapé do código do editor: `<bytes> <sufixo>` (limite de 2 MiB). */
    contentLimit: string;
    priorityHelp: string;
    scopeHelp: string;
    trigger: string;
    triggerHelp: string;
    triggerNone: string;
    triggerSelectorEvent: string;
    triggerPageLoad: string;
    triggerScroll: string;
    triggerReferrer: string;
    triggerSelectorLabel: string;
    triggerSelectorPlaceholder: string;
    chooseSelector: string;
    searchSelectors: string;
    loadingSelectors: string;
    noSelectorsFound: string;
    triggerEventLabel: string;
    triggerEventClick: string;
    triggerEventSubmit: string;
    triggerDelayLabel: string;
    triggerPercentageLabel: string;
    triggerReferrerLabel: string;
    triggerReferrerPlaceholder: string;
    maxDisplaysLabel: string;
    maxDisplaysHelp: string;
    displayResetDaysLabel: string;
    triggerValidationError: string;
    /** Switch, confirmação, avisos e cabeçalho do editor (fase 2). */
    publishing: PublishingCopy;
    /** Nome de uma página do escopo que não existe mais (excluída ou na lixeira). */
    pageUnavailable: string;
  };
  users: {
    title: string;
    description: string;
    inviteTitle: string;
    inviteDescription: string;
    /** CTA ListHeader (Figma: + New User). */
    newUser: string;
    name: string;
    email: string;
    role: string;
    roleAdmin: string;
    roleEditor: string;
    master: string;
    created: string;
    actions: string;
    search: string;
    searchBy: string;
    invite: string;
    createInvite: string;
    inviteCreated: string;
    copyLink: string;
    copied: string;
    edit: string;
    editUser: string;
    saveUser: string;
    userSaved: string;
    changeRole: string;
    resetPassword: string;
    resetLinkCreated: string;
    remove: string;
    empty: string;
    loading: string;
    error: string;
    retry: string;
    working: string;
    cancel: string;
    confirmRoleTitle: string;
    confirmRoleDescription: string;
    confirmResetTitle: string;
    confirmResetDescription: string;
    confirmRemoveTitle: string;
    confirmRemoveDescription: string;
    confirm: string;
    linkExpires: string;
    totalCount: string;
    previous: string;
    next: string;
    /** Nome acessível do botão de fechar (X) dos diálogos de convite e edição. */
    close: string;
  };
  logs: {
    title: string;
    description: string;
    date: string;
    user: string;
    action: string;
    object: string;
    target: string;
    allUsers: string;
    allObjects: string;
    objectLabels: Record<string, string>;
    actionLabels: Record<string, string>;
    roles: Record<string, string>;
    from: string;
    to: string;
    apply: string;
    clear: string;
    previous: string;
    next: string;
    pageSummary: string;
    totalCount: string;
    loading: string;
    empty: string;
    error: string;
    retry: string;
    removedUser: string;
  };
  folders: {
    create: string;
    createRoot: string;
    name: string;
    color: string;
    rename: string;
    moveToRoot: string;
    delete: string;
    reassignTo: string;
    reassignHint: string;
    baseProtected: string;
    /** Nome acessível do botão de fechar (X) do diálogo de pasta. */
    close: string;
  };
  stubs: {
    pages: { title: string; description: string };
    media: { title: string; description: string };
    customCode: { title: string; description: string };
    users: { title: string; description: string };
    logs: { title: string; description: string };
    settings: { title: string; description: string };
  };
  forbidden: {
    eyebrow: string;
    title: string;
    description: string;
    backToPanel: string;
  };
  /**
   * Versões, comparação, restaurar e desfazer, compartilhados pelos editores de Pages e
   * Scripts. Placeholders: `{date}` (data e hora), `{author}`, `{code}` (código curto da
   * versão), `{total}`, `{limit}`, `{pinned}`, `{added}`, `{removed}`, `{count}`.
   */
  revisions: {
    /** Cabeçalho do bloco Versões e nome acessível da seção. */
    title: string;
    /** Linha Rascunho e o selo `draft*` que a acompanha (ver `draftRowState`). */
    draft: string;
    draftUnsaved: string;
    draftUnpublished: string;
    draftSameAsLive: string;
    /** Rascunho salvo igual à versão publicada guardada, com o item fora do ar. */
    draftSameAsPublished: string;
    /** Selo da versão no ar. */
    live: string;
    /** Selo da versão publicada quando o item está fora do ar. */
    publishedOffline: string;
    loading: string;
    error: string;
    retry: string;
    /** "{total} de {limit} · {pinned}/3 fixadas" e o rodapé de política de retenção. */
    versionsCounter: string;
    versionsPolicy: string;
    /**
     * Nome acessível da linha de versão. O `aria-label` substitui o texto visível da linha, então
     * o marcador do Badge precisa estar no nome: "no ar" (`Live`) ou "publicada" (`Published`,
     * item fora do ar). Os três textos usam os mesmos placeholders `{date}` e `{author}`.
     */
    versionRowLabel: string;
    versionRowLabelLive: string;
    versionRowLabelPublished: string;
    /** Alfinete: nome acessível e tooltip, e a mensagem do quarto pin. */
    pinVersion: string;
    unpinVersion: string;
    pinLimit: string;
    conflict: string;
    /** Barra de comparação: direção, contagem, legenda e expansão das linhas iguais. */
    compareTitle: string;
    compareDraftBadge: string;
    compareStats: string;
    legendRemoved: string;
    legendAdded: string;
    expandAll: string;
    foldedLines: string;
    /** Campos fora do código que o restaurar troca, e o estado "só o código muda". */
    otherFieldsTitle: string;
    otherFieldsNone: string;
    /** Rótulos dos campos comparados (valores de enum vêm de `pages` e `customCode`). */
    fields: {
      name: string;
      slug: string;
      folder: string;
      seoTitle: string;
      seoDescription: string;
      seoKeyword: string;
      location: string;
      priority: string;
      scope: string;
      scopedPages: string;
      trigger: string;
      triggerConfig: string;
      maxDisplays: string;
      displayResetDays: string;
    };
    /** Valor de campo vazio na comparação e na confirmação. */
    fieldEmpty: string;
    /** Conteúdo idêntico (substitui o código na comparação sem diferença). */
    noDifference: string;
    /** Ações da barra e os dois motivos de "Restaurar" indisponível. */
    restoreAction: string;
    backToEditing: string;
    restoreBlockedDirty: string;
    restoreBlockedIdentical: string;
    /** Nota no topo do Details e rodapé do painel durante a comparação. */
    formPausedNote: string;
    readOnlyFooter: string;
    /** Nome acessível da área de código somente leitura da comparação (distinto de `title`). */
    versionCode: string;
    /** Confirmação de restaurar: título, frase, linha de código, aviso, botões. */
    restore: string;
    confirmRestoreTitle: string;
    confirmRestoreDescription: string;
    restoreConfirmCode: string;
    restoreConfirmUnpublishedWarning: string;
    cancel: string;
    /** Nome acessível do botão de fechar (X) dos diálogos deste módulo. */
    close: string;
    working: string;
    /** Avisos após restaurar e desfazer (ação "Desfazer" no aviso). */
    restored: string;
    undo: string;
    undoing: string;
    undone: string;
  };
  /** Menu interno do Setup (5 abas sob /admin/settings). */
  setup: {
    nav: {
      general: string;
      settings: string;
      connections: string;
      logs: string;
      backup: string;
    };
  };
};

const dictionaries: Record<string, PanelDictionary> = {
  en: {
    login: {
      eyebrow: "Kastir admin",
      title: "Sign in to your panel",
      description:
        "Use the administrator credentials configured for this installation.",
      email: "Email",
      password: "Password",
      submit: "Sign in",
      submitting: "Signing in…",
      invalidCredentials: "Unable to sign in with these credentials.",
      invalidForm:
        "Enter a valid email and a password with at least 8 characters.",
      tooManyAttempts: "Too many authentication attempts. Try again later.",
      unavailable: "The authentication service is unavailable. Try again.",
    },
    mcpConsent: {
      eyebrow: "MCP connection",
      title: "Allow this client to access Kastir?",
      description:
        "Review the access requested by this client. Permissions are recalculated from your current panel role.",
      client: "Client",
      unverifiedBadge: "Unverified",
      unverifiedWarning:
        "This unknown client may be impersonating another tool. Check the client ID and redirect URL before allowing access.",
      redirectUri: "Redirect URL",
      resource: "Resource",
      scopesTitle: "Requested permissions",
      scopes: {
        "cms:read": "Read CMS content",
        "cms:pages:write": "Create and edit pages",
        "cms:pages:publish": "Publish pages and put them live",
        "cms:pages:unpublish": "Take pages offline",
        "cms:media:write": "Edit media metadata and folders",
        "cms:scripts:write": "Create and edit scripts",
        "cms:scripts:publish": "Publish scripts and put them live",
        "cms:scripts:unpublish": "Take scripts offline",
        "cms:split-tests:write": "Create and edit split tests",
        "cms:settings:write": "Edit non-sensitive site settings",
        "cms:logs:read": "Read the audit log",
      },
      allowed: "Allowed",
      notAllowed: "Not allowed by your role",
      unknownScope: "Unknown permission",
      allow: "Allow access",
      deny: "Deny",
      working: "Processing…",
      error: "We could not complete this consent request.",
      invalidRequest: "This consent request is invalid or has expired.",
      invalidRole: "Your current role cannot approve this request.",
    },
    mcpConnections: {
      title: "MCP connections",
      description:
        "Review OAuth connections that can access this Kastir installation. Revoking removes their tokens immediately.",
      endpoint: "MCP endpoint",
      client: "Client",
      user: "User",
      scopes: "Permissions",
      created: "Created",
      updated: "Updated",
      lastTokenIssued: "Last token issued",
      active: "Active",
      inactive: "No active token",
      revoke: "Revoke",
      revoking: "Revoking…",
      empty: "No MCP connections yet.",
      loading: "Loading connections…",
      error: "Unable to load MCP connections.",
      retry: "Try again",
      noTokenIssued: "No access token issued yet.",
      cancel: "Cancel",
      close: "Close",
    },
    menu: {
      home: "Home",
      panel: "Panel",
      pages: "Pages",
      media: "Medias",
      scripts: "Scripts",
      splitTests: "SplitTests",
      users: "Users",
    },
    bulk: {
      selected: "selected",
      selectItem: "Select item",
      selectAll: "Select all visible",
      selectionLimit: "Select up to {count} items",
      clear: "Clear",
      moveFolder: "Move to folder",
      moveToTrash: "Move to trash",
      convertWebp: "Convert WebP",
      delete: "Delete",
      save: "Save",
      cancel: "Cancel",
      working: "Working…",
      success: "{count} item(s) completed.",
      partial: "{ok} completed; {failed} failed.",
      failed: "No item was completed.",
      noPermission:
        "Your role can view this list but cannot change these items.",
    },
    backup: {
      title: "Backup",
      description:
        "Export, import, and restore full site snapshots. Imports rewrite the previous domain to this installation.",
      exportTitle: "Snapshot",
      exportDescription:
        "Creates a downloadable .kastir package and stores it in local history (max 5).",
      exportButton: "Export now",
      createSnapshot: "Create a Snapshot",
      exportWorking: "Exporting…",
      exportCredentialsWarning:
        "The package includes user accounts with password hashes. Treat it as a secret.",
      importTitle: "Import package",
      importDescription:
        "Upload a .kastir or .zip package. This replaces all site content and users on this installation.",
      importChooseFile: "Choose package",
      selectArchive: "Select Archive",
      importStage: "Validate Package",
      importConfirm: "Import and Replace",
      importWorking: "Importing…",
      historyTitle: "History",
      historyEmpty: "No local snapshots yet.",
      download: "Download",
      restore: "Restore snapshot",
      restoreWorking: "Restoring…",
      delete: "Delete snapshot",
      confirmationLabel: "Type RESTAURAR to confirm",
      confirmationHint: "Required for restore and import.",
      targetOrigin: "Destination URL",
      sourceOrigin: "Source URL",
      replacements: "URL replacements",
      jobStatus: "Job status",
      refresh: "Refresh",
      error: "Backup operation failed.",
      successExport: "Export ready.",
      successRestore: "Restore complete.",
      successImport: "Import complete.",
      recoveryBadge: "Recovery",
      recoveryHint:
        "Created before a failed restore/import. Download or restore to recover the previous state.",
      downloadExport: "Download export",
      restoreConfirmPlaceholder: "RESTAURAR",
      sessionExpired: "Your session expired. Sign in again to continue.",
      sessionEndedTitle: "Your session ended",
      sessionEndedRestoreDescription:
        "The restore replaced this installation's users, which signs everyone out on purpose — including you. This almost always means the restore finished successfully. Sign in again and check the history to confirm.",
      sessionEndedImportDescription:
        "The import replaced this installation's users, which signs everyone out on purpose — including you. This almost always means the import finished successfully. Sign in again and check the history to confirm.",
      goToLogin: "Go to login",
      autoTitle: "Automatic backup",
      autoDescription:
        "Create local snapshots on a schedule. Uses the same 5-slot history as manual exports.",
      autoEnabled: "Enable automatic backups",
      autoIntervalDays: "Every N days",
      autoTime: "Time of day",
      autoTimezone: "Uses site timezone: {timezone}",
      autoSave: "Save schedule",
      autoSaving: "Saving…",
      autoSaved: "Schedule saved.",
      // Retry acessível: reenviar o form já re-registra na hora (Service.updateAutoSchedule
      // chama registerBackupAutoSnapshotScheduler sempre) — restart é só o fallback, não o único caminho.
      autoSavedSchedulerDeferred:
        'Schedule saved, but the background scheduler could not be updated right now (queue unavailable). Click "Save schedule" again once the issue clears — it reapplies immediately, no server restart needed.',
      autoInvalidInterval: "Interval must be between 1 and 3650 days.",
      cancel: "Cancel",
      close: "Close",
    },
    shell: {
      brand: "Kastir",
      panel: "Panel",
      openMenu: "Open panel menu",
      theme: "Theme",
      switchToLight: "Switch to light theme",
      switchToDark: "Switch to dark theme",
      notifications: "Notifications",
      profile: "Profile",
      accessSite: "Access Site",
      setup: "Setup",
      more: "More",
      closeMore: "Close more menu",
      customizeMenu: "Customize menu",
      customizeMenuDescription:
        "Choose which menu items appear in the panel. Hidden items stay reachable by URL.",
    },
    notifications: {
      title: "Notifications",
      description:
        "System notices for the workspaces and content you can access.",
      buttonLabel: "Open notifications",
      unreadCount: "{count} unread notifications",
      unread: "Unread",
      read: "Read",
      markAsRead: "Mark as read",
      relatedLink: "Open related item",
      loading: "Loading notifications…",
      empty: "You have no notifications.",
      error: "Unable to load notifications.",
      retry: "Try again",
      close: "Close notifications",
    },
    profile: {
      title: "Profile",
      description: "Update the name shown in your panel.",
      name: "Name",
      role: "Role",
      roles: {
        MASTER: "Master",
        ADMIN: "Administrator",
        EDITOR: "Editor",
      },
      save: "Save name",
      saving: "Saving…",
      saved: "Name updated.",
      invalidName: "Enter a name between 1 and 120 characters.",
      updateFailed: "Unable to update your name.",
      close: "Close",
      logout: "Sign out",
    },
    footer: {
      version: "Version",
      releases: "View releases",
    },
    home: {
      greeting: "Hi, {name}! What are we creating today?",
      greetingMorning: "Good morning, {name}.",
      greetingAfternoon: "Good afternoon, {name}.",
      greetingEvening: "Good evening, {name}.",
      subtitle: "The ultra-lightweight CMS designed for your AI workflow.",
      newPage: "New page",
      overview: "Overview",
      pagesUnit: "pages",
      mediasUnit: "medias",
      scriptsUnit: "Scripts",
      splitTestsUnit: "SplitTests",
      usersUnit: "Users",
      pagesDetail: "Published {count} new pages this week",
      mediasDetail: "files {size} MB",
      scriptsDetail: "{count} Drafts",
      splitTestsDetail: "{count} inactive",
      usersDetail: "{count} Administrators",
    },
    tour: {
      title: "A quick tour of Kastir",
      description:
        "You can skip this tour at any time and keep using the panel.",
      progress: "Step {current} of {total}",
      previous: "Previous",
      next: "Next",
      finish: "Finish",
      skip: "Skip tour",
      close: "Close tour",
      pagesTitle: "Pages",
      pagesDescription:
        "Create, organize, preview, publish, and restore static pages here.",
      mediaTitle: "Media",
      mediaDescription:
        "Upload and organize the files used by your published pages.",
      customCodeTitle: "Scripts",
      customCodeDescription:
        "Manage snippets that are injected into published pages.",
      usersTitle: "Users",
      usersDescription: "Invite teammates and manage their panel roles.",
      logsTitle: "Logs",
      logsDescription: "Review the audit trail of changes made in the panel.",
    },
    pages: {
      title: "Pages",
      description:
        "Create static pages and publish them directly from the panel.",
      newPage: "New page",
      searchBy: "Search by",
      allPages: "All pages",
      folderDescription: "Organize pages into nested folders.",

      trashDescription: "Restore or permanently remove deleted pages.",
      titleLabel: "Title",
      nameLabel: "Name",
      sortNameAsc: "Sort by name, A to Z",
      sortNameDesc: "Sort by name, Z to A",
      pageColumn: "Page",
      author: "Author",
      deletedBy: "Deleted by",
      folderLabel: "Folder",
      createdAtLabel: "Created At",
      publishedAtLabel: "Published At",
      delete: "Delete",

      status: "Status",
      activeSnippets: "Active scripts",
      published: "Published",
      draft: "Draft",
      created: "Created",
      deleted: "Deleted",
      actions: "Actions",
      edit: "Edit",
      preview: "Preview draft",
      viewPublished: "View live page",
      publicUrl: "Public URL",
      copyUrl: "Copy URL",
      back: "Back to pages",
      create: "Create page",
      folders: "Folders",
      trash: "Trash",
      deletedPages: "Deleted Pages",
      active: "Active pages",

      empty: "No pages in this folder yet.",
      loading: "Loading pages…",
      error: "Unable to load pages.",
      save: "Save page",
      invalidForm: "Complete the title and folder fields.",
      duplicate: "Duplicate",
      moveToTrash: "Move to trash",
      quickEdit: "Quick edit",
      moveToFolder: "Move to folder",
      confirmBulkTrashTitle: "Move selected pages to trash?",
      confirmBulkTrashDescription:
        "{count} page(s) will leave the active list and can be restored later.",
      confirmBulkPermanentTitle: "Delete selected pages permanently?",
      confirmBulkPermanentDescription:
        "This permanently removes the selected pages and releases their slugs.",
      restore: "Restore",
      permanentlyDelete: "Delete permanently",
      confirmPermanentTitle: "Delete page permanently?",
      confirmPermanentDescription:
        "This removes the page and releases its slug immediately.",
      slugConflict: "This slug is already in use.",
      contentTooLarge: "Content must be at most 2 MiB.",
      retry: "Retry",
      working: "Working…",
      cancel: "Cancel",
      close: "Close",
      chooseImage: "Choose image",
      selectImage: "Select",
      confirmTrashTitle: "Move page to trash?",
      confirmTrashDescription:
        "The published file will be removed and the page can be restored later.",
      confirmFolderDeleteTitle: "Delete folder?",
      confirmFolderDeleteDescription:
        "Pages and nested folders will be moved to Base.",
      editorDescription:
        "Edit the source that will be written to the public static file.",
      content: "HTML, CSS and JavaScript",
      contentPlaceholder: "Paste or type HTML, CSS and JavaScript here…",
      contentBytes: "{count} bytes of 2 MiB",
      // Canonical HTML lives in Pages/newPageTemplate — panel only reuses it.
      newPageTemplate: NEW_PAGE_TEMPLATE_EN,
      selectFolder: "Select a folder",
      seo: "SEO metadata",
      seoTitle: "SEO title",
      seoDescription: "SEO description",
      seoKeyword: "SEO keyword",
      publishing: {
        ...PUBLISHING_SHARED_EN,
        switchNeverPublished: "Offline · never published",
        unpublishDescription:
          "The URL will return 404. The draft and versions are kept.",
        menuNeverPublished: "Not published yet",
        reasonInvalidForm:
          "Complete the name and folder, and keep the content under 2 MiB.",
        menuPreview: "Preview",
        menuPreviewHint:
          "Opens the draft in a new tab without publishing. Saves first if there are unsaved edits.",
      },
    },
    media: {
      title: "Medias",
      description: "Upload, organize and reuse the files used by your pages.",
      allMedia: "All media",
      folders: "Folders",
      folderDescription:
        "Folders organize the library without changing public URLs.",
      upload: "Upload Media",
      uploading: "Uploading…",
      chooseFiles: "Choose files",
      searchPlaceholder: "Search by",
      empty: "No media files match this view.",
      loading: "Loading media…",
      error: "Unable to load media.",
      retry: "Retry",
      selected: "selected",
      deleteSelected: "Delete selected",
      delete: "Delete",
      replace: "Replace File",
      convertToWebp: "Convert WebP",
      convertAllToWebp: "Convert All to WebP",
      converting: "Converting…",
      copyLink: "Copy link",
      largeRaster:
        "This raster image is larger than 1 MiB and will be optimized in the background.",
      details: "Details",
      name: "Name",
      alt: "Alt Text",
      descriptionLabel: "Description",
      save: "Save",
      saving: "Saving…",
      saved: "Details saved.",
      type: "Type",
      size: "Size",
      status: "Status",
      ready: "Ready",
      processing: "Processing",
      failed: "Failed",
      date: "Date",
      viewGrid: "Grid view",
      viewList: "List view",
      confirmDeleteTitle: "Delete media?",
      confirmDeleteDescription:
        "This file may be referenced in published pages. Deleting it can break those links. This cannot be undone.",
      confirmBulkDeletePhrase: "DELETE ALL",
      confirmBulkDeletePhraseLabel: "Type DELETE ALL to confirm",
      confirmFolderDeleteTitle: "Delete folder?",
      confirmFolderDeleteDescription:
        "Files in this folder and its subfolders will be moved to Base. The folders will be removed.",
      cancel: "Cancel",
      close: "Close",
      working: "Working…",
      uploadHint:
        "Images are converted to WebP in the background. SVG files are sanitized before publication.",
      moveToFolder: "Move to folder",
    },
    settings: {
      title: "Site settings",
      description:
        "Control the defaults and public behavior of this installation.",
      generalTitle: "General",
      generalDescription:
        "Manage primary site identity, SEO metadata, public URL, icon, and language settings.",
      settingsTitle: "Settings",
      settingsDescription:
        "Manage general site preferences, navigation defaults, indexing options, and system integrations.",
      general: "General",
      siteTitle: "Site Title",
      siteTitleHelp:
        "SEO title wins when provided. Otherwise the home uses the site title - tagline and other pages use their page title.",
      tagline: "Tagline",
      taglineHelp:
        "Short phrase used with the site title on the public home page.",
      seoDescription: "SEO Description",
      seoDescriptionHelp:
        "Fallback description for pages without their own SEO description.",
      favicon: "Site Icon",
      faviconHelp:
        "Recommended: a 512×512 px WebP image. This recommendation is informational.",
      faviconNone: "No site icon",
      selectMedia: "Select media",
      clearMedia: "Clear selection",
      url: "Public URL",
      urlHelp:
        "Optional correction for absolute public links. Saving a different origin requires confirmation.",
      localization: "Panel localization",
      siteLanguage: "Site Language",
      siteLanguageHelp:
        'Sets only the published HTML attribute lang="…" (SEO/accessibility). It does not translate page content and does not change the admin panel language (PANEL_LANGUAGE).',
      timezone: "Time zone",
      dateFormat: "Date format",
      timeFormat: "Time format",
      weekStartsOn: "Week starts on",
      localizationHelp:
        "These four fields affect only the admin panel (Logs, Notifications, page lists). They never change published HTML.",
      localizationPreview: "Panel date preview",
      publishing: "Publishing",
      homePage: "Home Page",
      homePageNone: "No home page",
      homePageHelp:
        "Published at /. The page slug uses a clean URL without index.html. Without a home page, / shows the installation fallback.",
      notFoundPage: "404 error page",
      notFoundPageShort: "404 Redirect",
      notFoundNone: "Default server 404",
      notFoundHelp: "Use a published page as the body for missing public URLs.",
      redirect404: "Redirect missing public URLs to the home page",
      redirect404Short: "Redirect to Home Page",
      or: "or",
      indexing: "Indexing and AI crawlers",
      indexable: "Allow search engines to index this site",
      allowAiCrawlers: "Allow AI training crawlers",
      sitemapEnabled: "Publish sitemap.xml",
      indexingHelp:
        "After save, open /robots.txt: indexing off → Disallow: / and no Sitemap line; indexing on → Allow: / and Sitemap. AI off → blocks GPTBot, ClaudeBot, etc. Indexing off also injects meta robots noindex into published pages.",
      cache: "Cloudflare cache",
      cacheHelp:
        "Optional. Purge runs only when both token and zone ID are saved. Without them, publish/rebuild still works and purge is skipped. Failures never undo local files.",
      cloudflareToken: "API Token",
      tokenConfigured: "A token is configured and will not be shown.",
      tokenPlaceholder: "Enter a new token to replace it",
      removeToken: "Remove the configured token",
      cloudflareZoneId: "Zone ID",
      webp: "Image conversion",
      webpConversion: "Convert new raster uploads to WebP",
      webpHelp:
        "Applies only to new raster uploads (and replacements) after save. Existing files are not converted back. With this off, a new PNG stays .png and no WebP job is queued.",
      revisionRetention: "Page and script revisions",
      revisionRetentionLimit: "Revisions to keep",
      revisionRetentionHelp:
        "Applies to pages and scripts. Between 5 and 30. Changing this does not delete revisions immediately; the next retention job applies the new limit. Up to 3 pinned revisions per item are kept in addition.",
      verifyPublished: "Check published output",
      verifyHome: "Open home (/)",
      verifyRobots: "Open robots.txt",
      verifySitemap: "Open sitemap.xml",
      save: "Save changes",
      saving: "Saving…",
      saved: "Saved",
      error: "Unable to save site settings.",
      retry: "Try again",
      confirmUrlTitle: "Save a different public URL?",
      confirmUrlDescription:
        "This changes the origin used by absolute links and cache purges. Confirm that this URL is intentional.",
      confirm: "Confirm URL",
      cancel: "Cancel",
      close: "Close",
      queueFailed:
        "Settings were saved, but the background rebuild could not be queued.",
      invalidTitle: "Enter a site title.",
      formats: {
        en: "English",
        ptBR: "Portuguese (Brazil)",
        dateDMY: "DD/MM/YYYY",
        dateMDY: "MM/DD/YYYY",
        dateISO: "YYYY-MM-DD",
        time24: "24-hour",
        time12: "12-hour (AM/PM)",
        sunday: "Sunday",
        monday: "Monday",
        tuesday: "Tuesday",
        wednesday: "Wednesday",
        thursday: "Thursday",
        friday: "Friday",
        saturday: "Saturday",
      },
    },
    splitTests: {
      title: "SplitTests",
      description:
        "Route ad traffic across destination URLs with balanced split campaigns.",
      newCampaign: "New test",
      name: "Name",
      testsColumn: "Tests",
      pageColumn: "Page",
      urlColumn: "URL",
      slug: "Slug",
      status: "Status",
      published: "Published",
      draft: "Draft",
      publish: "Publish campaign",
      unpublish: "Unpublish campaign",
      active: "Active",
      paused: "Paused",
      activateCampaign: "Activate campaign",
      pauseCampaign: "Pause campaign",
      destinations: "Destinations",
      destinationsCount: "{count} Urls",
      destinationUrl: "URL",
      destinationLabel: "Name",
      defaultDestinationName: "Destination 1",
      destinationRequired: "Name and URL are required for each destination.",
      newDestination: "New Destination",
      addDestination: "Insert destinations",
      removeDestination: "Remove",
      pauseDestination: "Pause",
      activateDestination: "Activate",
      editDestination: "Edit",
      saveDestination: "Save destination",
      cannotPauseLastActive: "Keep at least one active destination.",
      moveUp: "Move up",
      moveDown: "Move down",
      theoretical: "Theoretical %",
      real: "Real %",
      hits: "Hits",
      totalHits: "Total hits",
      publicUrl: "Public URL",
      copyUrl: "Copy URL",
      copied: "Copied",
      save: "Save campaign",
      saved: "Campaign saved.",
      create: "Create campaign",
      edit: "Edit",
      quickEdit: "Quick edit",
      quickEditValidationError: "Complete the campaign name and slug.",
      delete: "Delete",
      actions: "Actions",
      author: "Author",
      created: "Created",
      createdAtLabel: "Created At",
      updatedAtLabel: "Updated At",
      search: "Search campaigns",
      searchBy: "Search by",
      empty: "No campaigns match this view.",
      loading: "Loading campaigns…",
      error: "Unable to load campaigns.",
      retry: "Retry",
      back: "Back to SplitTests",
      working: "Working…",
      confirmDeleteTitle: "Delete this campaign?",
      confirmDeleteDescription:
        "The public /s/ URL and all destinations will be removed.",
      confirmDeleteDestinationTitle: "Remove this destination?",
      confirmDeleteDestinationDescription:
        "Hit history for this destination will be deleted.",
      moveToTrash: "Move to trash",
      confirmBulkTrashTitle: "Move selected campaigns to trash?",
      confirmBulkTrashDescription:
        "{count} campaign(s) will leave the active list and can be restored later.",
      confirmBulkPermanentTitle: "Permanently delete selected campaigns?",
      confirmBulkPermanentDescription:
        "This cannot be undone. The selected campaigns and their destinations will be removed forever.",
      confirmTrashTitle: "Move campaign to trash?",
      confirmTrashDescription:
        "The public /s/ URL stops working. You can restore it later from Deleted SplitTests.",
      deletedCampaigns: "Deleted SplitTests",
      restore: "Restore",
      permanentlyDelete: "Delete permanently",
      confirmPermanentTitle: "Permanently delete this campaign?",
      confirmPermanentDescription:
        "This cannot be undone. The campaign and its destinations will be removed forever.",
      deleted: "Deleted",
      deletedBy: "Deleted by",
      confirm: "Confirm",
      cancel: "Cancel",
      close: "Close",
      atLeastOneDestination: "Add at least one destination URL.",
      activationPrompt: {
        ...ACTIVATION_PROMPT_EN,
        title: "Activate campaign now?",
        description:
          "This campaign is a draft. Activating it makes /s/{slug} respond with a 307 redirect; continue as a draft if you still need to edit it.",
      },
    },
    customCode: {
      title: "Custom scripts",
      description:
        "Manage small HTML, CSS and JavaScript snippets injected into published pages.",
      newSnippet: "New script",
      // Canonical HTML lives in CustomCode/newScriptTemplate — panel only reuses it.
      newScriptTemplate: NEW_SCRIPT_TEMPLATE_EN,
      popupTemplate: NEW_POPUP_TEMPLATE_EN,
      name: "Name",
      scriptColumn: "Script",
      location: "Injection",
      header: "Header",
      bodyStart: "Body start",
      bodyEnd: "Body end",
      content: "Code",
      priority: "Priority",
      scope: "Scope",
      status: "Status",
      allPages: "All published pages",
      specificPages: "Selected pages",
      pages: "Pages",
      selectPages: "Select pages",
      searchPages: "Search pages",
      save: "Save script",
      published: "Published",
      draft: "Draft",
      duplicate: "Duplicate",
      delete: "Delete",
      confirmDeleteTitle: "Delete this script?",
      confirmDeleteDescription:
        "The script will be removed and affected published pages will be rebuilt.",
      moveToTrash: "Move to trash",
      quickEdit: "Quick edit",
      confirmBulkTrashTitle: "Move selected scripts to trash?",
      confirmBulkTrashDescription:
        "{count} script(s) will leave the active list and can be restored later.",
      confirmBulkPermanentTitle: "Delete selected scripts permanently?",
      confirmBulkPermanentDescription:
        "This permanently removes the selected scripts from the trash.",
      confirmTrashTitle: "Move script to trash?",
      confirmTrashDescription:
        "The script will leave published pages. You can restore it later from Deleted Scripts.",
      deletedScripts: "Deleted Scripts",
      restore: "Restore",
      permanentlyDelete: "Delete permanently",
      confirmPermanentTitle: "Permanently delete this script?",
      confirmPermanentDescription:
        "This cannot be undone. The script will be removed forever.",
      deleted: "Deleted",
      deletedBy: "Deleted by",
      actions: "Actions",
      author: "Author",
      created: "Created",
      updated: "Last updated",
      searchSnippets: "Search scripts",
      searchBy: "Search by",
      loadMorePages: "Load more pages",
      pagesLoading: "Loading pages…",
      pagesEmpty: "No pages match this search.",
      pagesError: "Unable to load pages.",
      empty: "No scripts match this view.",
      loading: "Loading scripts…",
      error: "Unable to load scripts.",
      retry: "Retry",
      edit: "Edit",
      create: "Create script",
      back: "Back to scripts",
      cancel: "Cancel",
      close: "Close",
      chooseImage: "Choose image",
      selectImage: "Select",
      working: "Working…",
      quickEditValidationError:
        "Complete the script name and use a valid priority.",
      contentHelp:
        "HTML tags, CSS and JavaScript are stored exactly as entered. Maximum 2 MiB.",
      contentLimit: "/ 2 MiB",
      priorityHelp:
        "Lower numbers run first. Equal priorities use creation time.",
      scopeHelp:
        "Changing scope rebuilds the union of old and new published pages.",
      trigger: "Trigger",
      triggerHelp:
        "Optional: choose when the popup runtime should show this script.",
      triggerNone: "None (always visible, current behavior)",
      triggerSelectorEvent: "On selector interaction",
      triggerPageLoad: "On page load",
      triggerScroll: "On scroll",
      triggerReferrer: "Coming from a specific URL",
      triggerSelectorLabel: "CSS selector",
      triggerSelectorPlaceholder: "#my-button",
      chooseSelector: "Choose selector",
      searchSelectors: "Search selectors",
      loadingSelectors: "Loading selectors…",
      noSelectorsFound: "No selectors found in the scope pages.",
      triggerEventLabel: "Event",
      triggerEventClick: "Click",
      triggerEventSubmit: "Form submit",
      triggerDelayLabel: "Delay (seconds)",
      triggerPercentageLabel: "Scroll (%)",
      triggerReferrerLabel: "Referrer URL contains",
      triggerReferrerPlaceholder: "instagram.com",
      maxDisplaysLabel: "Show X times",
      maxDisplaysHelp:
        "Counted per browser (localStorage), leave empty for no limit.",
      displayResetDaysLabel: "Reset every X days",
      triggerValidationError:
        "Fill in the required trigger field (selector, or a scroll percentage between 1 and 100).",
      publishing: {
        ...PUBLISHING_SHARED_EN,
        switchNeverPublished: "Offline · never published",
        unpublishDescription:
          "The script stops being injected into the site. The draft and versions are kept.",
        menuNeverPublished: "Not published yet",
        reasonInvalidForm: "Complete the name to continue.",
      },
      pageUnavailable: "Page unavailable (deleted or in the trash)",
    },
    users: {
      title: "Users",
      description:
        "Manage panel access without public sign-up or email delivery.",
      inviteTitle: "Create an invite",
      inviteDescription: "The link is shown once so you can share it manually.",
      newUser: "New User",
      name: "Name",
      email: "e-Mail",
      role: "Role",
      roleAdmin: "Administrator",
      roleEditor: "Editor",
      master: "Master",
      created: "Created",
      actions: "Actions",
      search: "Search users",
      searchBy: "Search by",
      invite: "Invite user",
      createInvite: "Create invite",
      inviteCreated: "Invite link created",
      copyLink: "Copy link",
      copied: "Copied",
      edit: "Edit",
      editUser: "Edit user",
      saveUser: "Save changes",
      userSaved: "User updated.",
      changeRole: "Change role",
      resetPassword: "Create reset link",
      resetLinkCreated: "Password reset link created",
      remove: "Remove",
      empty: "No users match this search.",
      loading: "Loading users…",
      error: "Unable to load users.",
      retry: "Try again",
      working: "Working…",
      cancel: "Cancel",
      confirmRoleTitle: "Change this role?",
      confirmRoleDescription:
        "Active sessions are revoked so the new role applies immediately.",
      confirmResetTitle: "Create a reset link?",
      confirmResetDescription:
        "The link expires in 24 hours and can be used once.",
      confirmRemoveTitle: "Remove this user?",
      confirmRemoveDescription:
        "Authored pages are reassigned to you, sessions are revoked, and the user is removed.",
      confirm: "Confirm",
      linkExpires: "Expires {date}",
      totalCount: "{count} users",
      previous: "Previous",
      next: "Next",
      close: "Close",
    },
    logs: {
      title: "Logs",
      description: "Review the metadata trail of changes made in your panel.",
      date: "Date and time",
      user: "User",
      action: "Action",
      object: "Object",
      target: "Target",
      allUsers: "All users",
      allObjects: "All objects",
      objectLabels: {
        PAGE: "Page",
        FOLDER: "Folder",
        MEDIA: "Media",
        SCRIPT: "Script",
        USER: "User",
        SETTINGS: "Settings",
        SPLIT_TEST: "Split Test",
      },
      actionLabels: {
        PAGE_CREATED: "Created page",
        PAGE_UPDATED: "Updated page",
        PAGE_PUBLISHED: "Published page",
        PAGE_UNPUBLISHED: "Unpublished page",
        PAGE_TRASHED: "Moved page to trash",
        PAGE_RESTORED: "Restored page",
        PAGE_REVISION_RESTORED: "Restored page revision",
        PAGE_REVISION_PINNED: "Pinned page revision",
        PAGE_REVISION_UNPINNED: "Unpinned page revision",
        PAGE_REVISION_PURGED: "Purged page revisions",
        PAGE_PERMANENTLY_DELETED: "Deleted page permanently",
        PAGE_DUPLICATED: "Duplicated page",
        FOLDER_CREATED: "Created folder",
        FOLDER_RENAMED: "Renamed folder",
        FOLDER_RECOLORED: "Changed folder color",
        FOLDER_MOVED: "Moved folder",
        FOLDER_DELETED: "Deleted folder",
        MEDIA_FOLDER_CREATED: "Created media folder",
        MEDIA_FOLDER_RENAMED: "Renamed media folder",
        MEDIA_FOLDER_RECOLORED: "Changed media folder color",
        MEDIA_FOLDER_MOVED: "Moved media folder",
        MEDIA_FOLDER_DELETED: "Deleted media folder",

        MEDIA_CREATED: "Uploaded media",
        MEDIA_UPDATED: "Updated media",
        MEDIA_REPLACED: "Replaced media",
        MEDIA_DELETED: "Deleted media",
        MEDIA_PROCESSING_FAILED: "Media processing failed",
        SCRIPT_CREATED: "Created script",
        SCRIPT_UPDATED: "Updated script",
        SCRIPT_PUBLISHED: "Published script",
        SCRIPT_UNPUBLISHED: "Unpublished script",
        SCRIPT_DUPLICATED: "Duplicated script",
        SCRIPT_TRASHED: "Moved script to trash",
        SCRIPT_RESTORED: "Restored script",
        SCRIPT_REVISION_RESTORED: "Restored script revision",
        SCRIPT_REVISION_PINNED: "Pinned script revision",
        SCRIPT_REVISION_UNPINNED: "Unpinned script revision",
        SCRIPT_REVISION_PURGED: "Purged script revisions",
        SCRIPT_PERMANENTLY_DELETED: "Deleted script permanently",
        SCRIPT_DELETED: "Deleted script",
        SNIPPET_AUTO_DISABLED: "Automatically disabled script",
        USER_INVITE_CREATED: "Created user invite",
        USER_INVITE_ACCEPTED: "Accepted user invite",
        USER_UPDATED: "Updated user profile",
        USER_ROLE_CHANGED: "Changed user role",
        USER_REMOVED: "Removed user",
        USER_PASSWORD_RESET_CREATED: "Created password reset link",
        USER_PASSWORD_RESET_COMPLETED: "Completed password reset",
        SETTINGS_UPDATED: "Updated site settings",
        HOME_POINTER_RESET: "Cleared home page",
        SPLIT_CAMPAIGN_CREATED: "Created split campaign",
        SPLIT_CAMPAIGN_UPDATED: "Updated split campaign",
        SPLIT_CAMPAIGN_TRASHED: "Moved split campaign to trash",
        SPLIT_CAMPAIGN_RESTORED: "Restored split campaign",
        SPLIT_CAMPAIGN_PERMANENTLY_DELETED:
          "Deleted split campaign permanently",
        SPLIT_CAMPAIGN_DELETED: "Deleted split campaign",
        SPLIT_DESTINATION_CREATED: "Added split destination",
        SPLIT_DESTINATION_UPDATED: "Updated split destination",
        SPLIT_DESTINATION_DELETED: "Removed split destination",
      },
      roles: {
        MASTER: "Master",
        ADMIN: "Administrator",
        EDITOR: "Editor",
      },
      from: "From",
      to: "To",
      apply: "Apply Filters",
      clear: "Clear Filters",
      previous: "Previous",
      next: "Next",
      pageSummary: "Page {page} of {pages}",
      totalCount: "{total} events",
      loading: "Loading logs…",
      empty: "No audit events match these filters.",
      error: "Unable to load audit logs.",
      retry: "Try again",
      removedUser: "Removed user",
    },
    folders: {
      create: "Create folder",
      createRoot: "New root folder",
      name: "Folder name",
      color: "Folder color",
      rename: "Rename folder",
      moveToRoot: "Move to root",
      delete: "Delete folder",
      reassignTo: "Move contents to",
      reassignHint: "Choose where pages or files from this folder should go.",
      baseProtected: "Base cannot be deleted.",
      close: "Close",
    },
    stubs: {
      pages: {
        title: "Pages",
        description: "Page management will arrive in a future phase.",
      },
      media: {
        title: "Media",
        description: "The media library will arrive in a future phase.",
      },
      customCode: {
        title: "Scripts",
        description: "Custom code management will arrive in a future phase.",
      },
      users: {
        title: "Users",
        description: "User management will arrive in a future phase.",
      },
      logs: {
        title: "Logs",
        description: "Audit logs will arrive in a future phase.",
      },
      settings: {
        title: "Settings",
        description: "Site settings will arrive in a future phase.",
      },
    },
    forbidden: {
      eyebrow: "Access denied",
      title: "You do not have access to this area",
      description: "Your current role cannot open this panel destination.",
      backToPanel: "Back to panel",
    },
    setup: {
      nav: {
        general: "General",
        settings: "Settings",
        connections: "Connections",
        logs: "Logs",
        backup: "Backup",
      },
    },
    revisions: {
      title: "Versions",
      draft: "Draft",
      draftUnsaved: "unsaved",
      draftUnpublished: "not published",
      draftSameAsLive: "same as live",
      draftSameAsPublished: "same as published",
      live: "Live",
      publishedOffline: "Published",
      loading: "Loading versions…",
      error: "Unable to load versions.",
      retry: "Retry",
      versionsCounter: "{total} of {limit} · {pinned}/3 pinned",
      versionsPolicy:
        "Every publication creates a version. We keep the {limit} most recent; the published one and pinned ones are never removed.",
      versionRowLabel: "Version from {date} by {author}",
      versionRowLabelLive: "Version from {date} by {author}, live",
      versionRowLabelPublished: "Version from {date} by {author}, published",
      pinVersion: "Pin version from {date}",
      unpinVersion: "Unpin version from {date}",
      pinLimit:
        "There are already 3 pinned versions. Unpin one to pin this one.",
      conflict: "This draft changed in another session. Reload and try again.",
      compareTitle: "Comparing",
      compareDraftBadge: "Current draft",
      compareStats: "+{added} −{removed} lines",
      legendRemoved: "leaves the draft if you restore",
      legendAdded: "comes back with this version",
      expandAll: "Expand all",
      foldedLines: "{count} unchanged lines",
      otherFieldsTitle: "Other fields that change",
      otherFieldsNone: "None. Only the code changes.",
      fields: {
        name: "Name",
        slug: "Slug",
        folder: "Folder",
        seoTitle: "SEO title",
        seoDescription: "SEO description",
        seoKeyword: "SEO keyword",
        location: "Injection",
        priority: "Priority",
        scope: "Scope",
        scopedPages: "Pages in scope",
        trigger: "Trigger",
        triggerConfig: "Trigger settings",
        maxDisplays: "Show X times",
        displayResetDays: "Reset every X days",
      },
      fieldEmpty: "(empty)",
      noDifference: "Content identical to the draft.",
      restoreAction: "Restore this version to the draft",
      backToEditing: "Back to editing",
      restoreBlockedDirty: "Save or discard your unsaved changes to restore.",
      restoreBlockedIdentical: "This version is identical to the draft.",
      formPausedNote: "Editing is paused while you compare.",
      readOnlyFooter: "Read-only · {code} · {author}",
      versionCode: "Version code",
      restore: "Restore",
      confirmRestoreTitle: "Restore the version from {date} ({author})?",
      confirmRestoreDescription:
        "The draft takes on the content of this version. Nothing is published.",
      restoreConfirmCode: "Code: +{added} / −{removed} lines",
      restoreConfirmUnpublishedWarning:
        "The draft has saved changes that are not live yet. They will be replaced, and you can undo right after.",
      cancel: "Cancel",
      close: "Close",
      working: "Working…",
      restored:
        "Version from {date} restored to the draft. Nothing was published.",
      undo: "Undo",
      undoing: "Undoing…",
      undone: "Restore undone.",
    },
  },
  "pt-BR": {
    login: {
      eyebrow: "Admin Kastir",
      title: "Entre no seu painel",
      description:
        "Use as credenciais de administrador configuradas para esta instalação.",
      email: "E-mail",
      password: "Senha",
      submit: "Entrar",
      submitting: "Entrando…",
      invalidCredentials: "Não foi possível entrar com essas credenciais.",
      invalidForm:
        "Informe um e-mail válido e uma senha com pelo menos 8 caracteres.",
      tooManyAttempts:
        "Muitas tentativas de autenticação. Tente novamente mais tarde.",
      unavailable:
        "Não foi possível acessar o serviço de autenticação. Tente novamente.",
    },
    mcpConsent: {
      eyebrow: "Conexão MCP",
      title: "Permitir acesso deste cliente ao Kastir?",
      description:
        "Revise o acesso pedido por este cliente. As permissões são recalculadas conforme o seu papel atual no painel.",
      client: "Cliente",
      unverifiedBadge: "Não verificado",
      unverifiedWarning:
        "Este cliente desconhecido pode estar se passando por outra ferramenta. Confira o ID do cliente e a URL de redirecionamento antes de permitir o acesso.",
      redirectUri: "URL de redirecionamento",
      resource: "Recurso",
      scopesTitle: "Permissões solicitadas",
      scopes: {
        "cms:read": "Ler conteúdo do CMS",
        "cms:pages:write": "Criar e editar páginas",
        "cms:pages:publish": "Publicar páginas e colocá-las no ar",
        "cms:pages:unpublish": "Tirar páginas do ar",
        "cms:media:write": "Editar metadados e pastas de mídia",
        "cms:scripts:write": "Criar e editar scripts",
        "cms:scripts:publish": "Publicar scripts e colocá-los no ar",
        "cms:scripts:unpublish": "Tirar scripts do ar",
        "cms:split-tests:write": "Criar e editar testes A/B",
        "cms:settings:write": "Editar configurações não sensíveis do site",
        "cms:logs:read": "Ler o log de auditoria",
      },
      allowed: "Permitida",
      notAllowed: "Não permitida pelo seu papel",
      unknownScope: "Permissão desconhecida",
      allow: "Permitir acesso",
      deny: "Recusar",
      working: "Processando…",
      error: "Não foi possível concluir este consentimento.",
      invalidRequest: "Este pedido de consentimento é inválido ou expirou.",
      invalidRole: "Seu papel atual não pode aprovar este pedido.",
    },
    mcpConnections: {
      title: "Conexões MCP",
      description:
        "Revise as conexões OAuth que podem acessar esta instalação Kastir. Revogar remove os tokens imediatamente.",
      endpoint: "Endpoint MCP",
      client: "Cliente",
      user: "Usuário",
      scopes: "Permissões",
      created: "Criada em",
      updated: "Atualizada em",
      lastTokenIssued: "Último token emitido",
      active: "Ativa",
      inactive: "Sem token ativo",
      revoke: "Revogar",
      revoking: "Revogando…",
      empty: "Nenhuma conexão MCP ainda.",
      loading: "Carregando conexões…",
      error: "Não foi possível carregar as conexões MCP.",
      retry: "Tentar novamente",
      noTokenIssued: "Nenhum token de acesso foi emitido ainda.",
      cancel: "Cancelar",
      close: "Fechar",
    },
    menu: {
      home: "Home",
      panel: "Panel",
      pages: "Pages",
      media: "Medias",
      scripts: "Scripts",
      splitTests: "SplitTests",
      users: "Users",
    },
    bulk: {
      selected: "selecionado(s)",
      selectItem: "Selecionar item",
      selectAll: "Selecionar todos visíveis",
      selectionLimit: "Selecione até {count} itens",
      clear: "Limpar",
      moveFolder: "Mover para pasta",
      moveToTrash: "Mover para lixeira",
      convertWebp: "Converter WebP",
      delete: "Excluir",
      save: "Salvar",
      cancel: "Cancelar",
      working: "Processando…",
      success: "{count} item(ns) concluído(s).",
      partial: "{ok} concluído(s); {failed} falhou(aram).",
      failed: "Nenhum item foi concluído.",
      noPermission:
        "Seu papel pode consultar esta lista, mas não pode alterar estes itens.",
    },
    backup: {
      title: "Backup",
      description:
        "Exporte, importe e restaure snapshots completos do site. Na importação, o domínio antigo é reescrito para esta instalação.",
      exportTitle: "Snapshot",
      exportDescription:
        "Gera um pacote .kastir para download e guarda no histórico local (máx. 5).",
      exportButton: "Exportar agora",
      createSnapshot: "Criar snapshot",
      exportWorking: "Exportando…",
      exportCredentialsWarning:
        "O pacote inclui contas de usuário com hashes de senha. Trate-o como segredo.",
      importTitle: "Importar pacote",
      importDescription:
        "Envie um arquivo .kastir ou .zip. Isso substitui todo o conteúdo e os usuários desta instalação.",
      importChooseFile: "Escolher pacote",
      selectArchive: "Selecionar arquivo",
      importStage: "Validar pacote",
      importConfirm: "Importar e substituir",
      importWorking: "Importando…",
      historyTitle: "Histórico",
      historyEmpty: "Nenhum snapshot local ainda.",
      download: "Baixar",
      restore: "Restaurar snapshot",
      restoreWorking: "Restaurando…",
      delete: "Excluir snapshot",
      confirmationLabel: "Digite RESTAURAR para confirmar",
      confirmationHint: "Obrigatório para restaurar e importar.",
      targetOrigin: "URL de destino",
      sourceOrigin: "URL de origem",
      replacements: "Substituições de URL",
      jobStatus: "Status do job",
      refresh: "Atualizar",
      error: "Falha na operação de backup.",
      successExport: "Exportação pronta.",
      successRestore: "Restauração concluída.",
      successImport: "Importação concluída.",
      recoveryBadge: "Recuperação",
      recoveryHint:
        "Criado antes de um restore/import com falha. Baixe ou restaure para recuperar o estado anterior.",
      downloadExport: "Baixar exportação",
      restoreConfirmPlaceholder: "RESTAURAR",
      sessionExpired:
        "Sua sessão expirou. Faça login novamente para continuar.",
      sessionEndedTitle: "Sua sessão foi encerrada",
      sessionEndedRestoreDescription:
        "A restauração substituiu os usuários desta instalação, o que encerra todas as sessões de propósito — inclusive a sua. Isso normalmente significa que a restauração foi concluída com sucesso. Faça login novamente e confira o histórico para confirmar.",
      sessionEndedImportDescription:
        "A importação substituiu os usuários desta instalação, o que encerra todas as sessões de propósito — inclusive a sua. Isso normalmente significa que a importação foi concluída com sucesso. Faça login novamente e confira o histórico para confirmar.",
      goToLogin: "Ir para o login",
      autoTitle: "Backup automático",
      autoDescription:
        "Cria snapshots locais no horário configurado. Usa o mesmo histórico de 5 slots dos exports manuais.",
      autoEnabled: "Ativar backup automático",
      autoIntervalDays: "A cada N dias",
      autoTime: "Horário",
      autoTimezone: "Usa o fuso do site: {timezone}",
      autoSave: "Salvar agendamento",
      autoSaving: "Salvando…",
      autoSaved: "Agendamento salvo.",
      autoSavedSchedulerDeferred:
        'Agendamento salvo, mas o scheduler em background não pôde ser atualizado agora (fila indisponível). Clique em "Salvar agendamento" de novo quando a fila voltar — reaplica na hora, sem precisar reiniciar o servidor.',
      autoInvalidInterval: "O intervalo deve ser entre 1 e 3650 dias.",
      cancel: "Cancelar",
      close: "Fechar",
    },
    shell: {
      brand: "Kastir",
      panel: "Painel",
      openMenu: "Abrir menu do painel",
      theme: "Tema",
      switchToLight: "Mudar para tema claro",
      switchToDark: "Mudar para tema escuro",
      notifications: "Notificações",
      profile: "Perfil",
      accessSite: "Acessar Site",
      setup: "Setup",
      more: "Mais",
      closeMore: "Fechar menu Mais",
      customizeMenu: "Personalizar menu",
      customizeMenuDescription:
        "Escolha quais itens do menu aparecem no painel. Itens ocultos continuam acessíveis pela URL.",
    },
    notifications: {
      title: "Notificações",
      description:
        "Avisos do sistema sobre os espaços e conteúdos que você pode acessar.",
      buttonLabel: "Abrir notificações",
      unreadCount: "{count} notificações não lidas",
      unread: "Não lida",
      read: "Lida",
      markAsRead: "Marcar como lida",
      relatedLink: "Abrir item relacionado",
      loading: "Carregando notificações…",
      empty: "Você não tem notificações.",
      error: "Não foi possível carregar as notificações.",
      retry: "Tentar novamente",
      close: "Fechar notificações",
    },
    profile: {
      title: "Perfil",
      description: "Atualize o nome exibido no seu painel.",
      name: "Nome",
      role: "Papel",
      roles: {
        MASTER: "Master",
        ADMIN: "Administrador",
        EDITOR: "Editor",
      },
      save: "Salvar nome",
      saving: "Salvando…",
      saved: "Nome atualizado.",
      invalidName: "Informe um nome entre 1 e 120 caracteres.",
      updateFailed: "Não foi possível atualizar seu nome.",
      close: "Fechar",
      logout: "Sair",
    },
    footer: {
      version: "Versão",
      releases: "Ver releases",
    },
    home: {
      greeting: "Olá, {name}! O que vamos criar hoje?",
      greetingMorning: "Bom dia, {name}.",
      greetingAfternoon: "Boa tarde, {name}.",
      greetingEvening: "Boa noite, {name}.",
      subtitle: "The ultra-lightweight CMS designed for your AI workflow.",
      newPage: "New page",
      overview: "Overview",
      pagesUnit: "pages",
      mediasUnit: "medias",
      scriptsUnit: "Scripts",
      splitTestsUnit: "SplitTests",
      usersUnit: "Users",
      pagesDetail: "Published {count} new pages this week",
      mediasDetail: "files {size} MB",
      scriptsDetail: "{count} Drafts",
      splitTestsDetail: "{count} inactive",
      usersDetail: "{count} Administrators",
    },
    tour: {
      title: "Um tour rápido pelo Kastir",
      description:
        "Você pode pular este tour a qualquer momento e continuar usando o painel.",
      progress: "Etapa {current} de {total}",
      previous: "Anterior",
      next: "Próxima",
      finish: "Concluir",
      skip: "Pular tour",
      close: "Fechar tour",
      pagesTitle: "Páginas",
      pagesDescription:
        "Crie, organize, pré-visualize, publique e restaure páginas estáticas aqui.",
      mediaTitle: "Mídia",
      mediaDescription:
        "Envie e organize os arquivos usados pelas suas páginas publicadas.",
      customCodeTitle: "Scripts",
      customCodeDescription:
        "Gerencie snippets que são injetados nas páginas publicadas.",
      usersTitle: "Usuários",
      usersDescription:
        "Convide pessoas do time e gerencie os papéis do painel.",
      logsTitle: "Logs",
      logsDescription:
        "Consulte o histórico de auditoria das alterações feitas no painel.",
    },
    pages: {
      title: "Páginas",
      description:
        "Crie páginas estáticas e publique-as diretamente pelo painel.",
      newPage: "Nova página",
      searchBy: "Buscar por",
      allPages: "Todas as páginas",
      folderDescription: "Organize páginas em pastas aninhadas.",

      trashDescription: "Restaure ou remova permanentemente páginas excluídas.",
      titleLabel: "Título",
      nameLabel: "Nome",
      sortNameAsc: "Ordenar por nome, A a Z",
      sortNameDesc: "Ordenar por nome, Z a A",
      pageColumn: "Página",
      author: "Autor",
      deletedBy: "Excluída por",
      folderLabel: "Pasta",
      createdAtLabel: "Criado em",
      publishedAtLabel: "Publicado em",
      delete: "Excluir",

      status: "Status",
      activeSnippets: "Scripts ativos",
      published: "Publicada",
      draft: "Rascunho",
      created: "Criada em",
      deleted: "Excluída em",
      actions: "Ações",
      edit: "Editar",
      preview: "Pré-visualizar rascunho",
      viewPublished: "Ver página publicada",
      publicUrl: "URL pública",
      copyUrl: "Copiar URL",
      back: "Voltar para páginas",
      create: "Criar página",
      folders: "Pastas",
      trash: "Lixeira",
      deletedPages: "Páginas excluídas",
      active: "Páginas ativas",

      empty: "Ainda não há páginas nesta pasta.",
      loading: "Carregando páginas…",
      error: "Não foi possível carregar as páginas.",
      save: "Salvar página",
      invalidForm: "Preencha os campos de título e pasta.",
      duplicate: "Duplicar",
      moveToTrash: "Mover para lixeira",
      quickEdit: "Edição rápida",
      moveToFolder: "Mover para pasta",
      confirmBulkTrashTitle: "Mover as páginas selecionadas para a lixeira?",
      confirmBulkTrashDescription:
        "{count} página(s) sairão da lista ativa e poderão ser restaurada(s) depois.",
      confirmBulkPermanentTitle:
        "Excluir as páginas selecionadas permanentemente?",
      confirmBulkPermanentDescription:
        "As páginas selecionadas serão removidas para sempre e seus slugs serão liberados.",
      restore: "Restaurar",
      permanentlyDelete: "Excluir permanentemente",
      confirmPermanentTitle: "Excluir página permanentemente?",
      confirmPermanentDescription:
        "A página será removida e o slug liberado imediatamente.",
      slugConflict: "Este slug já está em uso.",
      contentTooLarge: "O conteúdo deve ter no máximo 2 MiB.",
      retry: "Tentar novamente",
      working: "Processando…",
      cancel: "Cancelar",
      close: "Fechar",
      chooseImage: "Escolher imagem",
      selectImage: "Selecionar",
      confirmTrashTitle: "Mover página para a lixeira?",
      confirmTrashDescription:
        "O arquivo publicado será removido e a página poderá ser restaurada depois.",
      confirmFolderDeleteTitle: "Excluir pasta?",
      confirmFolderDeleteDescription:
        "As páginas e pastas aninhadas serão movidas para a Base.",
      editorDescription:
        "Edite a fonte que será gravada no arquivo estático público.",
      content: "HTML, CSS e JavaScript",
      contentPlaceholder: "Cole ou digite HTML, CSS e JavaScript aqui…",
      contentBytes: "{count} bytes de 2 MiB",
      // Canonical HTML lives in Pages/newPageTemplate — panel only reuses it.
      newPageTemplate: NEW_PAGE_TEMPLATE_PT_BR,
      selectFolder: "Selecione uma pasta",
      seo: "Metadados de SEO",
      seoTitle: "Título de SEO",
      seoDescription: "Descrição de SEO",
      seoKeyword: "Palavra-chave de SEO",
      publishing: {
        ...PUBLISHING_SHARED_PT_BR,
        switchNeverPublished: "Fora do ar · nunca publicada",
        unpublishDescription:
          "A URL passa a dar 404. O rascunho e as versões ficam.",
        menuNeverPublished: "Ainda não publicada",
        reasonInvalidForm:
          "Preencha o nome e a pasta e mantenha o conteúdo abaixo de 2 MiB.",
        menuPreview: "Pré-visualizar",
        menuPreviewHint:
          "Abre o rascunho em outra aba, sem publicar. Salva antes se houver edição não salva.",
      },
    },
    media: {
      title: "Medias",
      description:
        "Envie, organize e reutilize os arquivos usados pelas suas páginas.",
      allMedia: "Todas as mídias",
      folders: "Pastas",
      folderDescription:
        "As pastas organizam a biblioteca sem alterar as URLs públicas.",
      upload: "Enviar mídia",
      uploading: "Enviando…",
      chooseFiles: "Escolher arquivos",
      searchPlaceholder: "Buscar por",
      empty: "Nenhum arquivo de mídia corresponde a esta visão.",
      loading: "Carregando mídia…",
      error: "Não foi possível carregar a mídia.",
      retry: "Tentar novamente",
      selected: "selecionado(s)",
      deleteSelected: "Excluir selecionados",
      delete: "Excluir",
      replace: "Substituir arquivo",
      convertToWebp: "Convert WebP",
      convertAllToWebp: "Converter tudo para WebP",
      converting: "Convertendo…",
      copyLink: "Copiar link",
      largeRaster:
        "Esta imagem raster é maior que 1 MiB e será otimizada em segundo plano.",
      details: "Detalhes",
      name: "Nome",
      alt: "Texto alternativo",
      descriptionLabel: "Descrição",
      save: "Salvar",
      saving: "Salvando…",
      saved: "Detalhes salvos.",
      type: "Tipo",
      size: "Tamanho",
      status: "Status",
      ready: "Pronta",
      processing: "Processando",
      failed: "Falhou",
      date: "Data",
      viewGrid: "Visualização em grade",
      viewList: "Visualização em lista",
      confirmDeleteTitle: "Excluir mídia?",
      confirmDeleteDescription:
        "Este arquivo pode estar em uso em páginas publicadas. Excluí-lo pode quebrar esses links. Esta ação não pode ser desfeita.",
      confirmBulkDeletePhrase: "DELETAR TODAS",
      confirmBulkDeletePhraseLabel: "Digite DELETAR TODAS para confirmar",
      confirmFolderDeleteTitle: "Excluir pasta?",
      confirmFolderDeleteDescription:
        "Arquivos desta pasta e das subpastas serão movidos para a Base. As pastas serão removidas.",
      cancel: "Cancelar",
      close: "Fechar",
      working: "Processando…",
      uploadHint:
        "Imagens são convertidas para WebP em segundo plano. SVGs são sanitizados antes da publicação.",
      moveToFolder: "Mover para pasta",
    },
    settings: {
      title: "Configurações do site",
      description:
        "Controle os padrões e o comportamento público desta instalação.",
      generalTitle: "Geral",
      generalDescription:
        "Gerencie a identidade principal do site, metadados de SEO, URL pública, ícone e idioma.",
      settingsTitle: "Configurações",
      settingsDescription:
        "Gerencie preferências gerais do site, navegação, indexação e integrações de sistema.",
      general: "Geral",
      siteTitle: "Título do site",
      siteTitleHelp:
        "O título de SEO tem prioridade. Sem ele, a home usa título do site - frase curta e as outras páginas usam o próprio título.",
      tagline: "Frase curta",
      taglineHelp: "Frase curta usada com o título do site na home pública.",
      seoDescription: "Descrição de SEO",
      seoDescriptionHelp:
        "Fallback para páginas sem sua própria descrição de SEO.",
      favicon: "Ícone do site",
      faviconHelp:
        "Recomendação: imagem WebP de 512×512 px. Esta recomendação é apenas informativa.",
      faviconNone: "Sem ícone do site",
      selectMedia: "Selecionar mídia",
      clearMedia: "Limpar seleção",
      url: "URL pública",
      urlHelp:
        "Correção opcional para links públicos absolutos. Salvar outra origem exige confirmação.",
      localization: "Localização do painel",
      siteLanguage: "Idioma do site publicado",
      siteLanguageHelp:
        'Define só o atributo HTML lang="…" nas páginas publicadas (SEO/acessibilidade). Não traduz o conteúdo e não muda o idioma do painel (PANEL_LANGUAGE).',
      timezone: "Fuso horário",
      dateFormat: "Formato de data",
      timeFormat: "Formato de hora",
      weekStartsOn: "Semana começa em",
      localizationHelp:
        "Esses quatro campos valem só no painel (Logs, Notificações, listagens). Nunca alteram o HTML publicado.",
      localizationPreview: "Prévia de data no painel",
      publishing: "Publicação",
      homePage: "Página inicial",
      homePageNone: "Sem página inicial",
      homePageHelp:
        "Publicada em /. O slug da página usa uma URL limpa, sem index.html. Sem página inicial, / mostra a instalação.",
      notFoundPage: "Página de erro 404",
      notFoundPageShort: "Redirect 404",
      notFoundNone: "404 padrão do servidor",
      notFoundHelp:
        "Use uma página publicada como corpo para URLs públicas inexistentes.",
      redirect404: "Redirecionar URLs públicas inexistentes para a home",
      redirect404Short: "Redirecionar para a home",
      or: "ou",
      indexing: "Indexação e crawlers de IA",
      indexable: "Permitir que buscadores indexem este site",
      allowAiCrawlers: "Permitir crawlers de treinamento de IA",
      sitemapEnabled: "Publicar sitemap.xml",
      indexingHelp:
        "Depois de salvar, abra /robots.txt: indexação off → Disallow: / e sem Sitemap; on → Allow: / e Sitemap. IA off → bloqueia GPTBot, ClaudeBot etc. Indexação off também injeta meta robots noindex nas páginas publicadas.",
      cache: "Cache Cloudflare",
      cacheHelp:
        "Opcional. O purge só roda com token e zone ID salvos. Sem eles, publicar/rebuild continua e o purge é ignorado. Falhas nunca desfazem arquivos locais.",
      cloudflareToken: "Token da API",
      tokenConfigured: "Um token está configurado e nunca será exibido.",
      tokenPlaceholder: "Digite um novo token para substituí-lo",
      removeToken: "Remover o token configurado",
      cloudflareZoneId: "ID da zona",
      webp: "Conversão de imagem",
      webpConversion: "Converter novos uploads raster para WebP",
      webpHelp:
        "Vale só para uploads (e substituições) raster novos após salvar. Arquivos antigos não voltam ao formato original. Com isso desligado, um PNG novo fica .png e não enfileira job WebP.",
      revisionRetention: "Revisões de páginas e scripts",
      revisionRetentionLimit: "Revisões a manter",
      revisionRetentionHelp:
        "Vale para páginas e scripts. Entre 5 e 30. Alterar não apaga revisões na hora; o próximo job aplica o corte. Até 3 revisões fixadas por item são preservadas além disso.",
      verifyPublished: "Conferir saída publicada",
      verifyHome: "Abrir home (/)",
      verifyRobots: "Abrir robots.txt",
      verifySitemap: "Abrir sitemap.xml",
      save: "Salvar alterações",
      saving: "Salvando…",
      saved: "Salvo",
      error: "Não foi possível salvar as configurações do site.",
      retry: "Tentar novamente",
      confirmUrlTitle: "Salvar outra URL pública?",
      confirmUrlDescription:
        "Isso altera a origem usada por links absolutos e purges de cache. Confirme que a URL é intencional.",
      confirm: "Confirmar URL",
      cancel: "Cancelar",
      close: "Fechar",
      queueFailed:
        "As configurações foram salvas, mas o rebuild em segundo plano não entrou na fila.",
      invalidTitle: "Informe um título para o site.",
      formats: {
        en: "Inglês",
        ptBR: "Português (Brasil)",
        dateDMY: "DD/MM/AAAA",
        dateMDY: "MM/DD/AAAA",
        dateISO: "AAAA-MM-DD",
        time24: "24 horas",
        time12: "12 horas (AM/PM)",
        sunday: "Domingo",
        monday: "Segunda-feira",
        tuesday: "Terça-feira",
        wednesday: "Quarta-feira",
        thursday: "Quinta-feira",
        friday: "Sexta-feira",
        saturday: "Sábado",
      },
    },
    splitTests: {
      title: "SplitTests",
      description:
        "Distribua o tráfego de campanhas entre URLs de destino com balanceamento automático.",
      newCampaign: "Novo teste",
      name: "Nome",
      testsColumn: "Testes",
      pageColumn: "Página",
      urlColumn: "URL",
      slug: "Slug",
      status: "Status",
      published: "Publicado",
      draft: "Rascunho",
      publish: "Publicar campanha",
      unpublish: "Despublicar campanha",
      active: "Ativa",
      paused: "Pausada",
      activateCampaign: "Ativar campanha",
      pauseCampaign: "Pausar campanha",
      destinations: "Destinos",
      destinationsCount: "{count} Urls",
      destinationUrl: "URL",
      destinationLabel: "Nome",
      defaultDestinationName: "Destino 1",
      destinationRequired: "Nome e URL são obrigatórios em cada destino.",
      newDestination: "Novo destino",
      addDestination: "Inserir destinos",
      removeDestination: "Remover",
      pauseDestination: "Pausar",
      activateDestination: "Ativar",
      editDestination: "Editar",
      saveDestination: "Salvar destino",
      cannotPauseLastActive: "Mantenha pelo menos um destino ativo.",
      moveUp: "Mover para cima",
      moveDown: "Mover para baixo",
      theoretical: "% teórica",
      real: "% real",
      hits: "Hits",
      totalHits: "Hits totais",
      publicUrl: "URL pública",
      copyUrl: "Copiar URL",
      copied: "Copiado",
      save: "Salvar campanha",
      saved: "Campanha salva.",
      create: "Criar campanha",
      edit: "Editar",
      quickEdit: "Edição rápida",
      quickEditValidationError: "Preencha o nome e o slug da campanha.",
      delete: "Excluir",
      actions: "Ações",
      author: "Autor",
      created: "Criado",
      createdAtLabel: "Criado em",
      updatedAtLabel: "Atualizado em",
      search: "Buscar campanhas",
      searchBy: "Buscar por",
      empty: "Nenhuma campanha corresponde a esta visão.",
      loading: "Carregando campanhas…",
      error: "Não foi possível carregar as campanhas.",
      retry: "Tentar novamente",
      back: "Voltar para SplitTests",
      working: "Processando…",
      confirmDeleteTitle: "Excluir esta campanha?",
      confirmDeleteDescription:
        "A URL pública /s/ e todos os destinos serão removidos.",
      confirmDeleteDestinationTitle: "Remover este destino?",
      confirmDeleteDestinationDescription:
        "O histórico de hits deste destino será excluído.",
      moveToTrash: "Mover para lixeira",
      confirmBulkTrashTitle: "Mover as campanhas selecionadas para a lixeira?",
      confirmBulkTrashDescription:
        "{count} campanha(s) sairão da lista ativa e poderão ser restaurada(s) depois.",
      confirmBulkPermanentTitle:
        "Excluir as campanhas selecionadas permanentemente?",
      confirmBulkPermanentDescription:
        "Isso não pode ser desfeito. As campanhas selecionadas e seus destinos serão removidos para sempre.",
      confirmTrashTitle: "Mover campanha para a lixeira?",
      confirmTrashDescription:
        "A URL pública /s/ para de funcionar. Você pode restaurar depois em SplitTests excluídos.",
      deletedCampaigns: "SplitTests excluídos",
      restore: "Restaurar",
      permanentlyDelete: "Excluir permanentemente",
      confirmPermanentTitle: "Excluir esta campanha permanentemente?",
      confirmPermanentDescription:
        "Isso não pode ser desfeito. A campanha e os destinos serão removidos para sempre.",
      deleted: "Excluída em",
      deletedBy: "Excluída por",
      confirm: "Confirmar",
      cancel: "Cancelar",
      close: "Fechar",
      atLeastOneDestination: "Adicione pelo menos uma URL de destino.",
      activationPrompt: {
        ...ACTIVATION_PROMPT_PT_BR,
        title: "Ativar campanha agora?",
        description:
          "Esta campanha está em rascunho. Ativá-la fará /s/{slug} responder com um redirecionamento 307; continue como rascunho se ainda precisar editá-la.",
      },
    },
    customCode: {
      title: "Scripts personalizados",
      description:
        "Gerencie pequenos trechos de HTML, CSS e JavaScript injetados nas páginas publicadas.",
      newSnippet: "Novo script",
      // Canonical HTML lives in CustomCode/newScriptTemplate — panel only reuses it.
      newScriptTemplate: NEW_SCRIPT_TEMPLATE_PT_BR,
      popupTemplate: NEW_POPUP_TEMPLATE_PT_BR,
      name: "Nome",
      scriptColumn: "Script",
      location: "Injeção",
      header: "Cabeçalho",
      bodyStart: "Início do body",
      bodyEnd: "Fim do body",
      content: "Código",
      priority: "Prioridade",
      scope: "Escopo",
      status: "Status",
      allPages: "Todas as páginas publicadas",
      specificPages: "Páginas selecionadas",
      pages: "Páginas",
      selectPages: "Selecionar páginas",
      searchPages: "Buscar páginas",
      save: "Salvar script",
      published: "Publicado",
      draft: "Rascunho",
      duplicate: "Duplicar",
      delete: "Excluir",
      confirmDeleteTitle: "Excluir este script?",
      confirmDeleteDescription:
        "O script será removido e as páginas publicadas afetadas serão recompiladas.",
      moveToTrash: "Mover para lixeira",
      quickEdit: "Edição rápida",
      confirmBulkTrashTitle: "Mover os scripts selecionados para a lixeira?",
      confirmBulkTrashDescription:
        "{count} script(s) sairão da lista ativa e poderão ser restaurado(s) depois.",
      confirmBulkPermanentTitle:
        "Excluir os scripts selecionados permanentemente?",
      confirmBulkPermanentDescription:
        "Os scripts selecionados serão removidos para sempre da lixeira.",
      confirmTrashTitle: "Mover script para a lixeira?",
      confirmTrashDescription:
        "O script sai das páginas publicadas. Você pode restaurar depois em Scripts excluídos.",
      deletedScripts: "Scripts excluídos",
      restore: "Restaurar",
      permanentlyDelete: "Excluir permanentemente",
      confirmPermanentTitle: "Excluir este script permanentemente?",
      confirmPermanentDescription:
        "Isso não pode ser desfeito. O script será removido para sempre.",
      deleted: "Excluído em",
      deletedBy: "Excluído por",
      actions: "Ações",
      author: "Autor",
      created: "Criado",
      updated: "Última atualização",
      searchSnippets: "Buscar scripts",
      searchBy: "Buscar por",
      loadMorePages: "Carregar mais páginas",
      pagesLoading: "Carregando páginas…",
      pagesEmpty: "Nenhuma página corresponde a esta busca.",
      pagesError: "Não foi possível carregar as páginas.",
      empty: "Nenhum script corresponde a esta visão.",
      loading: "Carregando scripts…",
      error: "Não foi possível carregar os scripts.",
      retry: "Tentar novamente",
      edit: "Editar",
      create: "Criar script",
      back: "Voltar para scripts",
      cancel: "Cancelar",
      close: "Fechar",
      chooseImage: "Escolher imagem",
      selectImage: "Selecionar",
      working: "Processando…",
      quickEditValidationError:
        "Preencha o nome do script e informe uma prioridade válida.",
      contentHelp:
        "Tags HTML, CSS e JavaScript são armazenados exatamente como informados. Máximo de 2 MiB.",
      // "/" e "MiB" valem nos dois idiomas; a chave existe para o texto acompanhar o dicionário.
      contentLimit: "/ 2 MiB",
      priorityHelp:
        "Números menores executam primeiro. Empates usam a data de criação.",
      scopeHelp:
        "Ao mudar o escopo, a união das páginas antiga e nova será recompilada.",
      trigger: "Gatilho",
      triggerHelp:
        "Opcional: escolha quando o runtime de popup deve mostrar este script.",
      triggerNone: "Nenhum (sempre visível, comportamento atual)",
      triggerSelectorEvent: "Ao interagir com um seletor",
      triggerPageLoad: "Ao carregar a página",
      triggerScroll: "Ao rolar a página",
      triggerReferrer: "Ao vir de uma URL específica",
      triggerSelectorLabel: "Seletor CSS",
      triggerSelectorPlaceholder: "#meu-botao",
      chooseSelector: "Escolher seletor",
      searchSelectors: "Buscar seletores",
      loadingSelectors: "Carregando seletores…",
      noSelectorsFound: "Nenhum seletor encontrado nas páginas de escopo.",
      triggerEventLabel: "Evento",
      triggerEventClick: "Clique",
      triggerEventSubmit: "Envio do formulário",
      triggerDelayLabel: "Atraso (segundos)",
      triggerPercentageLabel: "Rolagem (%)",
      triggerReferrerLabel: "URL de origem contém",
      triggerReferrerPlaceholder: "instagram.com",
      maxDisplaysLabel: "Mostrar X vezes",
      maxDisplaysHelp:
        "Contado por navegador (localStorage); deixe em branco para sem limite.",
      displayResetDaysLabel: "Reset a cada X dias",
      triggerValidationError:
        "Preencha o campo obrigatório do gatilho (seletor, ou uma porcentagem de scroll entre 1 e 100).",
      publishing: {
        ...PUBLISHING_SHARED_PT_BR,
        switchNeverPublished: "Fora do ar · nunca publicado",
        unpublishDescription:
          "O script deixa de ser injetado no site. O rascunho e as versões ficam.",
        menuNeverPublished: "Ainda não publicado",
        reasonInvalidForm: "Preencha o nome para continuar.",
      },
      pageUnavailable: "Página indisponível (excluída ou na lixeira)",
    },
    users: {
      title: "Usuários",
      description:
        "Gerencie o acesso ao painel sem cadastro público ou envio de e-mail.",
      inviteTitle: "Criar convite",
      inviteDescription:
        "O link é exibido uma vez para compartilhamento manual.",
      newUser: "Novo usuário",
      name: "Nome",
      email: "E-mail",
      role: "Papel",
      roleAdmin: "Administrador",
      roleEditor: "Editor",
      master: "Master",
      created: "Criado em",
      actions: "Ações",
      search: "Buscar usuários",
      searchBy: "Buscar por",
      invite: "Convidar usuário",
      createInvite: "Criar convite",
      inviteCreated: "Link de convite criado",
      copyLink: "Copiar link",
      copied: "Copiado",
      edit: "Editar",
      editUser: "Editar usuário",
      saveUser: "Salvar alterações",
      userSaved: "Usuário atualizado.",
      changeRole: "Alterar papel",
      resetPassword: "Criar link de reset",
      resetLinkCreated: "Link de reset de senha criado",
      remove: "Remover",
      empty: "Nenhum usuário corresponde à busca.",
      loading: "Carregando usuários…",
      error: "Não foi possível carregar os usuários.",
      retry: "Tentar novamente",
      working: "Processando…",
      cancel: "Cancelar",
      confirmRoleTitle: "Alterar este papel?",
      confirmRoleDescription:
        "As sessões ativas são revogadas para o novo papel valer na hora.",
      confirmResetTitle: "Criar um link de reset?",
      confirmResetDescription:
        "O link expira em 24 horas e pode ser usado uma vez.",
      confirmRemoveTitle: "Remover este usuário?",
      confirmRemoveDescription:
        "Páginas autoradas passam para você, as sessões são revogadas e o usuário é removido.",
      confirm: "Confirmar",
      linkExpires: "Expira em {date}",
      totalCount: "{count} usuários",
      previous: "Anterior",
      next: "Próxima",
      close: "Fechar",
    },
    logs: {
      title: "Logs",
      description:
        "Consulte o histórico de metadados das alterações feitas no painel.",
      date: "Data e hora",
      user: "Usuário",
      action: "Ação",
      object: "Objeto",
      target: "Alvo",
      allUsers: "Todos os usuários",
      allObjects: "Todos os objetos",
      objectLabels: {
        PAGE: "Página",
        FOLDER: "Pasta",
        MEDIA: "Mídia",
        SCRIPT: "Script",
        USER: "Usuário",
        SETTINGS: "Configurações",
        SPLIT_TEST: "Split Test",
      },
      actionLabels: {
        PAGE_CREATED: "Criou página",
        PAGE_UPDATED: "Editou página",
        PAGE_PUBLISHED: "Publicou página",
        PAGE_UNPUBLISHED: "Despublicou página",
        PAGE_TRASHED: "Moveu página para a lixeira",
        PAGE_RESTORED: "Restaurou página",
        PAGE_REVISION_RESTORED: "Restaurou revisão da página",
        PAGE_REVISION_PINNED: "Fixou revisão da página",
        PAGE_REVISION_UNPINNED: "Desafixou revisão da página",
        PAGE_REVISION_PURGED: "Purgou revisões da página",
        PAGE_PERMANENTLY_DELETED: "Excluiu página permanentemente",
        PAGE_DUPLICATED: "Duplicou página",
        FOLDER_CREATED: "Criou pasta",
        FOLDER_RENAMED: "Renomeou pasta",
        FOLDER_RECOLORED: "Alterou cor da pasta",
        FOLDER_MOVED: "Moveu pasta",
        FOLDER_DELETED: "Excluiu pasta",
        MEDIA_FOLDER_CREATED: "Criou pasta de mídia",
        MEDIA_FOLDER_RENAMED: "Renomeou pasta de mídia",
        MEDIA_FOLDER_RECOLORED: "Alterou cor da pasta de mídia",
        MEDIA_FOLDER_MOVED: "Moveu pasta de mídia",
        MEDIA_FOLDER_DELETED: "Excluiu pasta de mídia",

        MEDIA_CREATED: "Enviou mídia",
        MEDIA_UPDATED: "Editou mídia",
        MEDIA_REPLACED: "Substituiu mídia",
        MEDIA_DELETED: "Excluiu mídia",
        MEDIA_PROCESSING_FAILED: "Falha ao processar mídia",
        SCRIPT_CREATED: "Criou script",
        SCRIPT_UPDATED: "Editou script",
        SCRIPT_PUBLISHED: "Publicou script",
        SCRIPT_UNPUBLISHED: "Despublicou script",
        SCRIPT_DUPLICATED: "Duplicou script",
        SCRIPT_TRASHED: "Moveu script para a lixeira",
        SCRIPT_RESTORED: "Restaurou script",
        SCRIPT_REVISION_RESTORED: "Restaurou revisão do script",
        SCRIPT_REVISION_PINNED: "Fixou revisão do script",
        SCRIPT_REVISION_UNPINNED: "Desafixou revisão do script",
        SCRIPT_REVISION_PURGED: "Purgou revisões do script",
        SCRIPT_PERMANENTLY_DELETED: "Excluiu script permanentemente",
        SCRIPT_DELETED: "Excluiu script",
        SNIPPET_AUTO_DISABLED: "Desativou script automaticamente",
        USER_INVITE_CREATED: "Criou convite de usuário",
        USER_INVITE_ACCEPTED: "Aceitou convite de usuário",
        USER_UPDATED: "Atualizou perfil de usuário",
        USER_ROLE_CHANGED: "Alterou papel de usuário",
        USER_REMOVED: "Removeu usuário",
        USER_PASSWORD_RESET_CREATED: "Criou link de redefinição",
        USER_PASSWORD_RESET_COMPLETED: "Concluiu redefinição de senha",
        SETTINGS_UPDATED: "Atualizou as configurações do site",
        HOME_POINTER_RESET: "Removeu a página inicial",
        SPLIT_CAMPAIGN_CREATED: "Criou campanha de split",
        SPLIT_CAMPAIGN_UPDATED: "Atualizou campanha de split",
        SPLIT_CAMPAIGN_TRASHED: "Moveu campanha de split para a lixeira",
        SPLIT_CAMPAIGN_RESTORED: "Restaurou campanha de split",
        SPLIT_CAMPAIGN_PERMANENTLY_DELETED:
          "Excluiu campanha de split permanentemente",
        SPLIT_CAMPAIGN_DELETED: "Excluiu campanha de split",
        SPLIT_DESTINATION_CREATED: "Adicionou destino de split",
        SPLIT_DESTINATION_UPDATED: "Atualizou destino de split",
        SPLIT_DESTINATION_DELETED: "Removeu destino de split",
      },
      roles: {
        MASTER: "Master",
        ADMIN: "Administrador",
        EDITOR: "Editor",
      },
      from: "De",
      to: "Até",
      apply: "Aplicar filtros",
      clear: "Limpar filtros",
      previous: "Anterior",
      next: "Próxima",
      pageSummary: "Página {page} de {pages}",
      totalCount: "{total} eventos",
      loading: "Carregando logs…",
      empty: "Nenhum evento de auditoria corresponde aos filtros.",
      error: "Não foi possível carregar os logs.",
      retry: "Tentar novamente",
      removedUser: "Usuário removido",
    },
    folders: {
      create: "Criar pasta",
      createRoot: "Nova pasta raiz",
      name: "Nome da pasta",
      color: "Cor da pasta",
      rename: "Renomear pasta",
      moveToRoot: "Mover para a raiz",
      delete: "Excluir pasta",
      reassignTo: "Mover conteúdo para",
      reassignHint: "Escolha para onde vão as páginas ou arquivos desta pasta.",
      baseProtected: "A Base não pode ser excluída.",
      close: "Fechar",
    },
    stubs: {
      pages: {
        title: "Páginas",
        description: "A gestão de páginas chegará em uma fase futura.",
      },
      media: {
        title: "Mídia",
        description: "A biblioteca de mídia chegará em uma fase futura.",
      },
      customCode: {
        title: "Scripts",
        description: "A gestão de código chegará em uma fase futura.",
      },
      users: {
        title: "Usuários",
        description: "A gestão de usuários chegará em uma fase futura.",
      },
      logs: {
        title: "Logs",
        description: "Os logs de auditoria chegarão em uma fase futura.",
      },
      settings: {
        title: "Configurações",
        description: "As configurações do site chegarão em uma fase futura.",
      },
    },
    forbidden: {
      eyebrow: "Acesso negado",
      title: "Você não tem acesso a esta área",
      description: "Seu papel atual não pode abrir este destino do painel.",
      backToPanel: "Voltar ao painel",
    },
    setup: {
      nav: {
        general: "Geral",
        settings: "Configurações",
        connections: "Conexões",
        logs: "Logs",
        backup: "Backup",
      },
    },
    revisions: {
      title: "Versões",
      draft: "Rascunho",
      draftUnsaved: "não salvo",
      draftUnpublished: "não publicado",
      draftSameAsLive: "igual ao ar",
      draftSameAsPublished: "igual à publicada",
      live: "No ar",
      publishedOffline: "Publicada",
      loading: "Carregando versões…",
      error: "Não foi possível carregar as versões.",
      retry: "Tentar de novo",
      versionsCounter: "{total} de {limit} · {pinned}/3 fixadas",
      versionsPolicy:
        "Cada publicação cria uma versão. Guardamos as {limit} mais recentes; a publicada e as fixadas nunca saem.",
      versionRowLabel: "Versão de {date} por {author}",
      versionRowLabelLive: "Versão de {date} por {author}, no ar",
      versionRowLabelPublished: "Versão de {date} por {author}, publicada",
      pinVersion: "Fixar versão de {date}",
      unpinVersion: "Desafixar versão de {date}",
      pinLimit: "Já há 3 versões fixadas. Desafixe uma para fixar esta.",
      conflict:
        "Este rascunho mudou em outra sessão. Recarregue e tente de novo.",
      compareTitle: "Comparando",
      compareDraftBadge: "Rascunho atual",
      compareStats: "+{added} −{removed} linhas",
      legendRemoved: "sai do rascunho se restaurar",
      legendAdded: "volta com esta versão",
      expandAll: "Expandir tudo",
      foldedLines: "{count} linhas iguais",
      otherFieldsTitle: "Outros campos que mudam",
      otherFieldsNone: "Nenhum. Só o código muda.",
      fields: {
        name: "Nome",
        slug: "Slug",
        folder: "Pasta",
        seoTitle: "Título de SEO",
        seoDescription: "Descrição de SEO",
        seoKeyword: "Palavra-chave de SEO",
        location: "Injeção",
        priority: "Prioridade",
        scope: "Escopo",
        scopedPages: "Páginas do escopo",
        trigger: "Gatilho",
        triggerConfig: "Configuração do gatilho",
        maxDisplays: "Mostrar X vezes",
        displayResetDays: "Reset a cada X dias",
      },
      fieldEmpty: "(vazio)",
      noDifference: "Conteúdo idêntico ao rascunho.",
      restoreAction: "Restaurar esta versão no rascunho",
      backToEditing: "Voltar a editar",
      restoreBlockedDirty:
        "Salve ou descarte as alterações não salvas para restaurar.",
      restoreBlockedIdentical: "Esta versão é idêntica ao rascunho.",
      formPausedNote: "Edição pausada enquanto você compara.",
      readOnlyFooter: "Somente leitura · {code} · {author}",
      versionCode: "Código da versão",
      restore: "Restaurar",
      confirmRestoreTitle: "Restaurar a versão de {date} ({author})?",
      confirmRestoreDescription:
        "O rascunho passa a ter o conteúdo desta versão. Nada é publicado.",
      restoreConfirmCode: "Código: +{added} / −{removed} linhas",
      restoreConfirmUnpublishedWarning:
        "O rascunho tem alterações salvas que ainda não estão no ar. Elas serão substituídas e você poderá desfazer em seguida.",
      cancel: "Cancelar",
      close: "Fechar",
      working: "Trabalhando…",
      restored: "Versão de {date} restaurada no rascunho. Nada foi publicado.",
      undo: "Desfazer",
      undoing: "Desfazendo…",
      undone: "Restauração desfeita.",
    },
  },
};

export function getPanelDictionary(language: string): PanelDictionary {
  return dictionaries[language] ?? dictionaries.en;
}
