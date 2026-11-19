export const PUBLIC_BAR_LOCALES = ["en", "pt-BR"] as const;

export type PublicBarLocale = (typeof PUBLIC_BAR_LOCALES)[number];

export type PublicBarLabels = {
  home: string;
  panel: string;
  pages: string;
  media: string;
  scripts: string;
  splitTests: string;
  users: string;
  setup: string;
  theme: string;
  switchToLight: string;
  switchToDark: string;
  profile: string;
  editPage: string;
  logout: string;
  /** Bell aria-label — fetch só ao abrir (não no load da página). */
  notifications: string;
  notificationsTitle: string;
  notificationsEmpty: string;
  notificationsLoading: string;
  notificationsError: string;
  notificationsRetry: string;
  notificationsClose: string;
  roles: Record<"MASTER" | "ADMIN" | "EDITOR", string>;
};

/**
 * Canonical copy for the published admin bar.
 * `public-scripts/admin-bar.ts` keeps an identical inlined copy so the browser
 * bundle has zero runtime imports — `tests/admin-bar-render.test.ts` asserts parity.
 */
export const publicBarLabels: Record<PublicBarLocale, PublicBarLabels> = {
  en: {
    home: "Home",
    panel: "Panel",
    pages: "Pages",
    media: "Medias",
    scripts: "Scripts",
    splitTests: "SplitTests",
    users: "Users",
    setup: "Setup",
    theme: "Theme",
    switchToLight: "Switch to light theme",
    switchToDark: "Switch to dark theme",
    profile: "Profile",
    editPage: "Edit this page",
    logout: "Log out",
    notifications: "Open notifications",
    notificationsTitle: "Notifications",
    notificationsEmpty: "You have no notifications.",
    notificationsLoading: "Loading notifications…",
    notificationsError: "Unable to load notifications.",
    notificationsRetry: "Try again",
    notificationsClose: "Close notifications",
    roles: {
      MASTER: "Master",
      ADMIN: "Administrator",
      EDITOR: "Editor",
    },
  },
  "pt-BR": {
    home: "Home",
    panel: "Painel",
    pages: "Pages",
    media: "Medias",
    scripts: "Scripts",
    splitTests: "SplitTests",
    users: "Users",
    setup: "Setup",
    theme: "Tema",
    switchToLight: "Ativar tema claro",
    switchToDark: "Ativar tema escuro",
    profile: "Perfil",
    editPage: "Editar esta página",
    logout: "Sair",
    notifications: "Abrir notificações",
    notificationsTitle: "Notificações",
    notificationsEmpty: "Você não tem notificações.",
    notificationsLoading: "Carregando notificações…",
    notificationsError: "Não foi possível carregar as notificações.",
    notificationsRetry: "Tentar novamente",
    notificationsClose: "Fechar notificações",
    roles: {
      MASTER: "Master",
      ADMIN: "Administrador",
      EDITOR: "Editor",
    },
  },
};

export function normalizePublicBarLocale(value: unknown): PublicBarLocale {
  return value === "pt-BR" ? "pt-BR" : "en";
}
