type PublicBarLocale = "en" | "pt-BR";
type PublicBarRole = "MASTER" | "ADMIN" | "EDITOR";

export type PublicBarUser = {
  id: string;
  name: string;
  role: PublicBarRole;
};

type PublicBarLabels = {
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
  notifications: string;
  notificationsTitle: string;
  notificationsEmpty: string;
  notificationsLoading: string;
  notificationsError: string;
  notificationsRetry: string;
  notificationsClose: string;
  roles: Record<PublicBarRole, string>;
};

/**
 * Inlined copy of `lib/i18n/publicBar.ts` labels — keep identical.
 * The browser bundle must not import app modules; parity is asserted in tests.
 */
export const publicScriptBarLabels: Record<PublicBarLocale, PublicBarLabels> = {
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

const labels = publicScriptBarLabels;

/** Lucide paths inlined — published bundle cannot import lucide-react. */
// No xmlns — avoids false positives in "no external http links" assertions.
const ICON_ATTRS =
  'class="kastir-admin-bar__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';

function svgIcon(paths: string): string {
  return `<svg ${ICON_ATTRS}>${paths}</svg>`;
}

const ICONS = {
  home: svgIcon(
    '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  ),
  layoutDashboard: svgIcon(
    '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  ),
  fileText: svgIcon(
    '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  ),
  image: svgIcon(
    '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  ),
  code2: svgIcon(
    '<path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/>',
  ),
  gitBranch: svgIcon(
    '<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  ),
  users: svgIcon(
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  ),
  settings: svgIcon(
    '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  ),
  penLine: svgIcon(
    '<path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/>',
  ),
  sun: svgIcon(
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  ),
  moon: svgIcon(
    '<path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/>',
  ),
  bell: svgIcon(
    '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>',
  ),
};

type NavKey =
  "home" | "panel" | "pages" | "media" | "scripts" | "splitTests" | "users";

const NAV_ITEMS: Array<{
  key: NavKey;
  href: string;
  icon: string;
  roles?: readonly PublicBarRole[];
}> = [
  { key: "home", href: "/", icon: ICONS.home },
  { key: "panel", href: "/admin", icon: ICONS.layoutDashboard },
  { key: "pages", href: "/admin/pages", icon: ICONS.fileText },
  { key: "media", href: "/admin/media", icon: ICONS.image },
  { key: "scripts", href: "/admin/custom-code", icon: ICONS.code2 },
  { key: "splitTests", href: "/admin/split-tests", icon: ICONS.gitBranch },
  {
    key: "users",
    href: "/admin/users",
    icon: ICONS.users,
    roles: ["MASTER", "ADMIN"],
  },
];

/**
 * Visual parity com shell do painel:
 * - brand cell 93×93 (BrandRail topo) + topbar 93px (nav + ações)
 * - tokens canvas/ink do globals.css
 */
const BAR_CSS = `
#kastir-admin-bar{--kastir-bar-background:#f5f5f5;--kastir-bar-foreground:#0a0a0a;--kastir-bar-muted:#737373;--kastir-bar-muted-bg:#fafafa;--kastir-bar-border:#e5e5e5;--kastir-bar-accent:#0a0a0a;--kastir-bar-active:#15cb18;--kastir-bar-paper:#ffffff;all:initial;box-sizing:border-box;color:var(--kastir-bar-foreground);display:block;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:16px;line-height:1.5;position:fixed;top:0;left:0;right:0;width:100%;height:93px;z-index:2147483000;pointer-events:none}
#kastir-admin-bar[data-theme="dark"]{--kastir-bar-background:#0a0a0a;--kastir-bar-foreground:#fafafa;--kastir-bar-muted:#a1a1a1;--kastir-bar-muted-bg:#111111;--kastir-bar-border:#262626;--kastir-bar-accent:#fafafa;--kastir-bar-paper:#171717}
#kastir-admin-bar *,#kastir-admin-bar *::before,#kastir-admin-bar *::after{box-sizing:border-box}
#kastir-admin-bar .kastir-admin-bar__shell{display:flex;align-items:stretch;height:93px;width:100%;pointer-events:auto;background:var(--kastir-bar-background);border-bottom:1px solid var(--kastir-bar-border)}
#kastir-admin-bar .kastir-admin-bar__brand{display:flex;align-items:center;justify-content:center;width:93px;min-width:93px;height:93px;border-right:1px solid var(--kastir-bar-border);flex-shrink:0;text-decoration:none;background:var(--kastir-bar-background)}
#kastir-admin-bar .kastir-admin-bar__brand:hover{background:color-mix(in srgb,var(--kastir-bar-accent) 6%,transparent)}
#kastir-admin-bar .kastir-admin-bar__brand:focus-visible{outline:2px solid var(--kastir-bar-accent);outline-offset:-2px}
#kastir-admin-bar .kastir-admin-bar__brand-img{display:block;width:24px;height:29px;object-fit:contain}
#kastir-admin-bar .kastir-admin-bar__inner{flex:1;min-width:0;display:flex;align-items:center;justify-content:space-between;gap:16px;height:93px;padding:0 24px;background:color-mix(in srgb,var(--kastir-bar-background) 95%,transparent);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
#kastir-admin-bar .kastir-admin-bar__nav{display:flex;align-items:center;gap:32px;min-width:0;overflow-x:auto;scrollbar-width:none}
#kastir-admin-bar .kastir-admin-bar__nav::-webkit-scrollbar{display:none}
#kastir-admin-bar .kastir-admin-bar__nav-link{position:relative;display:inline-flex;align-items:center;gap:10px;padding:0 0 8px;color:var(--kastir-bar-muted);font-size:16px;font-weight:400;line-height:1.5;white-space:nowrap;text-decoration:none;background:transparent;border:0;border-radius:0;cursor:pointer}
#kastir-admin-bar .kastir-admin-bar__nav-link:hover{color:var(--kastir-bar-foreground);background:transparent}
#kastir-admin-bar .kastir-admin-bar__nav-link[aria-current="page"]{color:var(--kastir-bar-foreground)}
#kastir-admin-bar .kastir-admin-bar__nav-link[aria-current="page"]::after{content:"";position:absolute;bottom:0;left:50%;transform:translateX(-50%);width:82px;max-width:100%;height:6px;border-radius:6px;background:var(--kastir-bar-active)}
#kastir-admin-bar .kastir-admin-bar__actions{display:flex;align-items:center;gap:16px;flex-shrink:0;margin-left:auto}
/* size-icon do painel = 32px; profile usa rounded-full como o Avatar trigger. */
#kastir-admin-bar .kastir-admin-bar__icon-btn{position:relative;display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;padding:0;border:0;border-radius:8px;background:transparent;color:var(--kastir-bar-foreground);cursor:pointer;text-decoration:none}
#kastir-admin-bar .kastir-admin-bar__icon-btn:hover{background:color-mix(in srgb,var(--kastir-bar-accent) 10%,transparent)}
#kastir-admin-bar .kastir-admin-bar__icon-btn:focus-visible,#kastir-admin-bar .kastir-admin-bar__nav-link:focus-visible{outline:2px solid var(--kastir-bar-accent);outline-offset:2px}
#kastir-admin-bar .kastir-admin-bar__icon-btn[data-admin-bar-action="profile"]{border-radius:999px}
#kastir-admin-bar .kastir-admin-bar__icon{display:block;flex-shrink:0;width:16px;height:16px}
/* Avatar sm do painel: size-6, bg-muted, text-xs muted, borda. */
#kastir-admin-bar .kastir-admin-bar__avatar{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:999px;background:var(--kastir-bar-muted-bg,#fafafa);color:var(--kastir-bar-muted);font-size:12px;font-weight:500;line-height:1;letter-spacing:0;border:1px solid var(--kastir-bar-border);user-select:none;box-sizing:border-box}
#kastir-admin-bar[data-theme="dark"] .kastir-admin-bar__avatar{background:#111111}
#kastir-admin-bar .kastir-admin-bar__muted{color:var(--kastir-bar-muted);font-size:12px}
#kastir-admin-bar .kastir-admin-bar__profile,#kastir-admin-bar .kastir-admin-bar__notif{position:relative}
/* Dropdown = shadcn DropdownMenuContent (min-w-48, p-1, rounded-lg, ring). */
#kastir-admin-bar .kastir-admin-bar__menu,#kastir-admin-bar .kastir-admin-bar__notif-panel{background:var(--kastir-bar-paper);border:0;border-radius:8px;box-shadow:0 4px 6px -1px #0000001a,0 2px 4px -2px #0000001a;ring:none;outline:1px solid color-mix(in srgb,var(--kastir-bar-foreground) 10%,transparent);position:absolute;right:0;top:calc(100% + 4px);z-index:2}
#kastir-admin-bar .kastir-admin-bar__menu{display:flex;flex-direction:column;gap:0;min-width:12rem;padding:4px}
#kastir-admin-bar .kastir-admin-bar__menu[hidden],#kastir-admin-bar .kastir-admin-bar__notif-panel[hidden]{display:none}
#kastir-admin-bar .kastir-admin-bar__menu-group{display:flex;flex-direction:column;padding:0}
#kastir-admin-bar .kastir-admin-bar__menu-label{padding:4px 6px;font-size:12px;font-weight:500;line-height:1.25;color:var(--kastir-bar-muted)}
#kastir-admin-bar .kastir-admin-bar__menu-label--soft{font-weight:400}
#kastir-admin-bar .kastir-admin-bar__menu-sep{height:1px;margin:4px -4px;background:var(--kastir-bar-border);border:0}
#kastir-admin-bar .kastir-admin-bar__menu a,#kastir-admin-bar .kastir-admin-bar__menu button,#kastir-admin-bar .kastir-admin-bar__notif-panel button{justify-content:flex-start;width:100%;display:inline-flex;align-items:center;gap:6px;min-height:0;padding:4px 6px;border:0;border-radius:6px;background:transparent;color:var(--kastir-bar-foreground);font:inherit;font-size:14px;font-weight:400;cursor:pointer;text-decoration:none;text-align:left}
#kastir-admin-bar .kastir-admin-bar__menu a:hover,#kastir-admin-bar .kastir-admin-bar__menu button:hover,#kastir-admin-bar .kastir-admin-bar__notif-panel button:hover{background:color-mix(in srgb,var(--kastir-bar-accent) 8%,transparent)}
#kastir-admin-bar .kastir-admin-bar__badge{position:absolute;top:-2px;right:-2px;min-width:18px;height:18px;padding:0 4px;border-radius:999px;background:#e7000b;color:#fff;font-size:10px;font-weight:600;line-height:18px;text-align:center;pointer-events:none}
#kastir-admin-bar .kastir-admin-bar__badge[hidden]{display:none}
#kastir-admin-bar .kastir-admin-bar__notif-panel{width:min(22rem,calc(100vw - 1.5rem));overflow:hidden;padding:0}
#kastir-admin-bar .kastir-admin-bar__notif-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;padding:14px 14px 12px;border-bottom:1px solid var(--kastir-bar-border)}
#kastir-admin-bar .kastir-admin-bar__notif-head strong{display:block;font-size:15px;font-weight:600}
#kastir-admin-bar .kastir-admin-bar__notif-list{max-height:16rem;overflow-y:auto;padding:6px}
#kastir-admin-bar .kastir-admin-bar__notif-item{display:flex;flex-direction:column;align-items:flex-start;gap:4px;width:100%;padding:10px;border:0;border-radius:8px;background:transparent;color:var(--kastir-bar-foreground);font:inherit;font-size:13px;text-align:left;cursor:pointer}
#kastir-admin-bar .kastir-admin-bar__notif-item[data-unread="true"]{background:color-mix(in srgb,var(--kastir-bar-accent) 6%,transparent)}
#kastir-admin-bar .kastir-admin-bar__notif-item:hover{background:color-mix(in srgb,var(--kastir-bar-accent) 10%,transparent)}
#kastir-admin-bar .kastir-admin-bar__notif-status{padding:20px 14px;text-align:center;color:var(--kastir-bar-muted);font-size:13px}
@media(max-width:900px){
  #kastir-admin-bar .kastir-admin-bar__inner{padding:0 16px;gap:12px}
  #kastir-admin-bar .kastir-admin-bar__nav{gap:20px}
  #kastir-admin-bar .kastir-admin-bar__actions{gap:10px}
}
@media(max-width:640px){
  #kastir-admin-bar .kastir-admin-bar__brand{width:56px;min-width:56px}
  #kastir-admin-bar .kastir-admin-bar__brand-img{width:18px;height:22px}
  #kastir-admin-bar .kastir-admin-bar__nav-text{display:none}
  #kastir-admin-bar .kastir-admin-bar__nav{gap:12px}
  #kastir-admin-bar .kastir-admin-bar__nav-link{padding-bottom:6px}
  #kastir-admin-bar .kastir-admin-bar__nav-link[aria-current="page"]::after{width:28px;height:4px}
  #kastir-admin-bar .kastir-admin-bar__inner{padding:0 10px}
  #kastir-admin-bar .kastir-admin-bar__actions{gap:4px}
}
`;

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}

function themeIconHtml(isDark: boolean): string {
  return isDark ? ICONS.sun : ICONS.moon;
}

function avatarHtml(name: string): string {
  // Mesmo visual do Avatar size=sm + AvatarFallback do painel.
  return `<span class="kastir-admin-bar__avatar" aria-hidden="true">${escapeHtml(initials(name))}</span>`;
}

function profileMenuHtml(user: PublicBarUser, copy: PublicBarLabels): string {
  const name = escapeHtml(user.name);
  const role = escapeHtml(copy.roles[user.role]);
  return `<div id="kastir-admin-bar-profile" class="kastir-admin-bar__menu" hidden><div class="kastir-admin-bar__menu-group"><div class="kastir-admin-bar__menu-label">${name}</div><div class="kastir-admin-bar__menu-label kastir-admin-bar__menu-label--soft">${role}</div></div><div class="kastir-admin-bar__menu-sep" role="separator"></div><a href="/admin">${escapeHtml(copy.profile)}</a><button type="button" data-admin-bar-action="logout">${escapeHtml(copy.logout)}</button></div>`;
}

const STORAGE_KEY = "kastir:published-admin-bar:theme";
const SYMBOL_SRC = {
  light: "/admin-brand/kastir-symbol-light.webp",
  dark: "/admin-brand/kastir-symbol-dark.webp",
} as const;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function localeFor(value: unknown): PublicBarLocale {
  return value === "pt-BR" ? "pt-BR" : "en";
}

function roleFor(value: unknown): value is PublicBarRole {
  return value === "MASTER" || value === "ADMIN" || value === "EDITOR";
}

function isPublicBarUser(value: unknown): value is PublicBarUser {
  if (!value || typeof value !== "object") return false;
  const user = value as Partial<PublicBarUser>;
  return (
    typeof user.id === "string" &&
    user.id.length > 0 &&
    typeof user.name === "string" &&
    typeof user.role === "string" &&
    roleFor(user.role)
  );
}

function internalEditPath(pageId: string): string {
  return `/admin/pages/${encodeURIComponent(pageId)}`;
}

function navActive(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/" || pathname === "";
  if (href === "/admin") return pathname === "/admin" || pathname === "/admin/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function visibleNavItems(role: PublicBarRole) {
  return NAV_ITEMS.filter(
    (item) => !item.roles || item.roles.some((allowed) => allowed === role),
  );
}

function navLinkHtml(
  item: (typeof NAV_ITEMS)[number],
  copy: PublicBarLabels,
  pathname: string,
): string {
  const label = copy[item.key];
  const active = navActive(item.href, pathname);
  return `<a class="kastir-admin-bar__nav-link" href="${escapeHtml(item.href)}"${active ? ' aria-current="page"' : ""}>${item.icon}<span class="kastir-admin-bar__nav-text">${escapeHtml(label)}</span></a>`;
}

function brandHtml(copy: PublicBarLabels): string {
  return `<a class="kastir-admin-bar__brand" href="/admin" aria-label="${escapeHtml(copy.panel)}"><img class="kastir-admin-bar__brand-img" src="${SYMBOL_SRC.light}" alt="" width="24" height="29" decoding="async"></a>`;
}

/** Pure, escaped markup used by focused tests and as a stable renderer contract. */
export function renderBarHtml(
  user: PublicBarUser,
  pageId: string,
  locale: PublicBarLocale = "en",
  pathname = "/",
): string {
  const copy = labels[localeFor(locale)];
  const nav = visibleNavItems(user.role)
    .map((item) => navLinkHtml(item, copy, pathname))
    .join("");
  const edit =
    pageId.trim().length > 0
      ? `<a class="kastir-admin-bar__nav-link" href="${escapeHtml(internalEditPath(pageId))}" data-admin-bar-edit="1">${ICONS.penLine}<span class="kastir-admin-bar__nav-text">${escapeHtml(copy.editPage)}</span></a>`
      : "";

  return `<div id="kastir-admin-bar" data-theme="light"><style>${BAR_CSS}</style><div class="kastir-admin-bar__shell" role="toolbar" aria-label="Kastir">${brandHtml(copy)}<div class="kastir-admin-bar__inner"><nav class="kastir-admin-bar__nav" aria-label="Kastir">${nav}${edit}</nav><div class="kastir-admin-bar__actions"><button type="button" class="kastir-admin-bar__icon-btn" data-admin-bar-action="theme" aria-label="${escapeHtml(copy.switchToDark)}" aria-pressed="false" title="${escapeHtml(copy.theme)}">${themeIconHtml(false)}</button><a class="kastir-admin-bar__icon-btn" href="/admin/settings" aria-label="${escapeHtml(copy.setup)}" title="${escapeHtml(copy.setup)}">${ICONS.settings}</a><div class="kastir-admin-bar__notif"><button type="button" class="kastir-admin-bar__icon-btn" data-admin-bar-action="notifications" aria-expanded="false" aria-controls="kastir-admin-bar-notifications" aria-label="${escapeHtml(copy.notifications)}" title="${escapeHtml(copy.notifications)}">${ICONS.bell}<span class="kastir-admin-bar__badge" data-admin-bar-badge hidden>0</span></button><div id="kastir-admin-bar-notifications" class="kastir-admin-bar__notif-panel" hidden><div class="kastir-admin-bar__notif-head"><strong>${escapeHtml(copy.notificationsTitle)}</strong><button type="button" data-admin-bar-action="notifications-close" aria-label="${escapeHtml(copy.notificationsClose)}">×</button></div><div class="kastir-admin-bar__notif-list" data-admin-bar-notif-list></div></div></div><div class="kastir-admin-bar__profile"><button type="button" class="kastir-admin-bar__icon-btn" data-admin-bar-action="profile" aria-expanded="false" aria-controls="kastir-admin-bar-profile" aria-label="${escapeHtml(copy.profile)}">${avatarHtml(user.name)}</button>${profileMenuHtml(user, copy)}</div></div></div></div></div>`;
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  documentRef: Document,
  tagName: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const element = documentRef.createElement(tagName);
  if (className) element.className = className;
  return element;
}

function setTheme(
  root: HTMLElement,
  themeButton: HTMLButtonElement,
  theme: "light" | "dark",
  copy: PublicBarLabels,
  windowRef: Window,
) {
  const isDark = theme === "dark";
  const actionLabel = isDark ? copy.switchToLight : copy.switchToDark;
  root.dataset.theme = theme;
  const brandImage = root.querySelector<HTMLImageElement>(
    ".kastir-admin-bar__brand-img",
  );
  if (brandImage) brandImage.src = SYMBOL_SRC[theme];
  themeButton.setAttribute("aria-pressed", String(isDark));
  themeButton.setAttribute("aria-label", actionLabel);
  themeButton.title = copy.theme;
  themeButton.innerHTML = themeIconHtml(isDark);
  try {
    windowRef.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Private browsing and blocked storage must not disable the bar.
  }
}

function applyBarOffset(
  root: HTMLElement,
  documentRef: Document,
  windowRef: Window,
): void {
  const html = documentRef.documentElement;
  const basePadding =
    parseFloat(windowRef.getComputedStyle(html).paddingTop) || 0;
  const sync = () => {
    html.style.paddingTop = `${basePadding + root.getBoundingClientRect().height}px`;
  };
  sync();
  const ResizeObserverRef = (
    windowRef as typeof windowRef & { ResizeObserver?: typeof ResizeObserver }
  ).ResizeObserver;
  if (!ResizeObserverRef) return;
  new ResizeObserverRef(sync).observe(root);
}

function appendNavLink(
  documentRef: Document,
  nav: HTMLElement,
  href: string,
  label: string,
  iconHtml: string,
  active: boolean,
  editMarker = false,
): HTMLAnchorElement {
  const link = createElement(documentRef, "a", "kastir-admin-bar__nav-link");
  link.href = href;
  if (active) link.setAttribute("aria-current", "page");
  if (editMarker) link.dataset.adminBarEdit = "1";
  link.innerHTML = `${iconHtml}<span class="kastir-admin-bar__nav-text"></span>`;
  const text = link.querySelector(".kastir-admin-bar__nav-text");
  if (text) text.textContent = label;
  nav.append(link);
  return link;
}

type NotifItem = {
  id: string;
  message: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
};

function mountAdminBar(
  user: PublicBarUser,
  pageId: string,
  locale: PublicBarLocale,
  documentRef: Document,
  windowRef: Window,
): HTMLElement {
  const existing = documentRef.getElementById("kastir-admin-bar");
  if (existing) return existing;

  const copy = labels[localeFor(locale)];
  const pathname = windowRef.location.pathname || "/";
  const root = createElement(documentRef, "div");
  root.id = "kastir-admin-bar";
  root.dataset.theme = "light";

  const style = createElement(documentRef, "style");
  style.textContent = BAR_CSS;
  root.append(style);

  const shell = createElement(documentRef, "div", "kastir-admin-bar__shell");
  shell.setAttribute("role", "toolbar");
  shell.setAttribute("aria-label", "Kastir");

  // Logo K = BrandRail topo (93×93).
  const brand = createElement(documentRef, "a", "kastir-admin-bar__brand");
  brand.href = "/admin";
  brand.setAttribute("aria-label", copy.panel);
  const brandImg = createElement(
    documentRef,
    "img",
    "kastir-admin-bar__brand-img",
  );
  brandImg.src = SYMBOL_SRC.light;
  brandImg.alt = "";
  brandImg.width = 24;
  brandImg.height = 29;
  brandImg.decoding = "async";
  brand.append(brandImg);
  shell.append(brand);

  const inner = createElement(documentRef, "div", "kastir-admin-bar__inner");

  const nav = createElement(documentRef, "nav", "kastir-admin-bar__nav");
  nav.setAttribute("aria-label", "Kastir");
  for (const item of visibleNavItems(user.role)) {
    appendNavLink(
      documentRef,
      nav,
      item.href,
      copy[item.key],
      item.icon,
      navActive(item.href, pathname),
    );
  }
  if (pageId.trim().length > 0) {
    appendNavLink(
      documentRef,
      nav,
      internalEditPath(pageId),
      copy.editPage,
      ICONS.penLine,
      false,
      true,
    );
  }
  inner.append(nav);

  const actions = createElement(
    documentRef,
    "div",
    "kastir-admin-bar__actions",
  );

  const themeButton = createElement(
    documentRef,
    "button",
    "kastir-admin-bar__icon-btn",
  );
  themeButton.type = "button";
  themeButton.dataset.adminBarAction = "theme";
  actions.append(themeButton);

  const setupLink = createElement(
    documentRef,
    "a",
    "kastir-admin-bar__icon-btn",
  );
  setupLink.href = "/admin/settings";
  setupLink.setAttribute("aria-label", copy.setup);
  setupLink.title = copy.setup;
  setupLink.innerHTML = ICONS.settings;
  actions.append(setupLink);

  // Notificações: só fetch ao abrir (não no load da página publicada).
  const notifWrap = createElement(
    documentRef,
    "div",
    "kastir-admin-bar__notif",
  );
  const notifButton = createElement(
    documentRef,
    "button",
    "kastir-admin-bar__icon-btn",
  );
  notifButton.type = "button";
  notifButton.dataset.adminBarAction = "notifications";
  notifButton.setAttribute("aria-controls", "kastir-admin-bar-notifications");
  notifButton.setAttribute("aria-expanded", "false");
  notifButton.setAttribute("aria-label", copy.notifications);
  notifButton.title = copy.notifications;
  notifButton.innerHTML = ICONS.bell;
  const badge = createElement(documentRef, "span", "kastir-admin-bar__badge");
  badge.dataset.adminBarBadge = "1";
  badge.hidden = true;
  badge.textContent = "0";
  notifButton.append(badge);
  notifWrap.append(notifButton);

  const notifPanel = createElement(
    documentRef,
    "div",
    "kastir-admin-bar__notif-panel",
  );
  notifPanel.id = "kastir-admin-bar-notifications";
  notifPanel.hidden = true;
  const notifHead = createElement(
    documentRef,
    "div",
    "kastir-admin-bar__notif-head",
  );
  const notifTitle = createElement(documentRef, "strong");
  notifTitle.textContent = copy.notificationsTitle;
  const notifClose = createElement(documentRef, "button");
  notifClose.type = "button";
  notifClose.dataset.adminBarAction = "notifications-close";
  notifClose.setAttribute("aria-label", copy.notificationsClose);
  notifClose.textContent = "×";
  notifHead.append(notifTitle, notifClose);
  const notifList = createElement(
    documentRef,
    "div",
    "kastir-admin-bar__notif-list",
  );
  notifList.dataset.adminBarNotifList = "1";
  notifPanel.append(notifHead, notifList);
  notifWrap.append(notifPanel);
  actions.append(notifWrap);

  const profile = createElement(
    documentRef,
    "div",
    "kastir-admin-bar__profile",
  );
  const profileButton = createElement(
    documentRef,
    "button",
    "kastir-admin-bar__icon-btn",
  );
  profileButton.type = "button";
  profileButton.dataset.adminBarAction = "profile";
  profileButton.setAttribute("aria-controls", "kastir-admin-bar-profile");
  profileButton.setAttribute("aria-expanded", "false");
  profileButton.setAttribute("aria-label", copy.profile);
  const avatar = createElement(documentRef, "span", "kastir-admin-bar__avatar");
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = initials(user.name);
  profileButton.append(avatar);
  profile.append(profileButton);

  // Dropdown espelha Topbar: labels nome/role + separator + Profile + Log out.
  const profileMenu = createElement(
    documentRef,
    "div",
    "kastir-admin-bar__menu",
  );
  profileMenu.id = "kastir-admin-bar-profile";
  profileMenu.hidden = true;

  const menuGroup = createElement(
    documentRef,
    "div",
    "kastir-admin-bar__menu-group",
  );
  const menuName = createElement(
    documentRef,
    "div",
    "kastir-admin-bar__menu-label",
  );
  menuName.textContent = user.name;
  const menuRole = createElement(
    documentRef,
    "div",
    "kastir-admin-bar__menu-label kastir-admin-bar__menu-label--soft",
  );
  menuRole.textContent = copy.roles[user.role];
  menuGroup.append(menuName, menuRole);
  profileMenu.append(menuGroup);

  const menuSep = createElement(
    documentRef,
    "div",
    "kastir-admin-bar__menu-sep",
  );
  menuSep.setAttribute("role", "separator");
  profileMenu.append(menuSep);

  const profileLink = createElement(documentRef, "a");
  profileLink.href = "/admin";
  profileLink.textContent = copy.profile;
  profileMenu.append(profileLink);

  const logoutButton = createElement(documentRef, "button");
  logoutButton.type = "button";
  logoutButton.dataset.adminBarAction = "logout";
  logoutButton.textContent = copy.logout;
  profileMenu.append(logoutButton);
  profile.append(profileMenu);
  actions.append(profile);
  inner.append(actions);
  shell.append(inner);
  root.append(shell);

  documentRef.body.prepend(root);
  applyBarOffset(root, documentRef, windowRef);

  let currentTheme: "light" | "dark" = "light";
  try {
    const savedTheme = windowRef.localStorage.getItem(STORAGE_KEY);
    if (savedTheme === "dark" || savedTheme === "light")
      currentTheme = savedTheme;
  } catch {
    // light default
  }
  setTheme(root, themeButton, currentTheme, copy, windowRef);

  const closeProfile = () => {
    profileButton.setAttribute("aria-expanded", "false");
    profileMenu.hidden = true;
  };
  const closeNotif = () => {
    notifButton.setAttribute("aria-expanded", "false");
    notifPanel.hidden = true;
  };

  const setBadge = (count: number) => {
    if (count > 0) {
      badge.hidden = false;
      badge.textContent = count > 99 ? "99+" : String(count);
    } else {
      badge.hidden = true;
      badge.textContent = "0";
    }
  };

  const renderNotifStatus = (text: string, retry = false) => {
    notifList.replaceChildren();
    const status = createElement(
      documentRef,
      "div",
      "kastir-admin-bar__notif-status",
    );
    status.textContent = text;
    notifList.append(status);
    if (retry) {
      const retryBtn = createElement(documentRef, "button");
      retryBtn.type = "button";
      retryBtn.textContent = copy.notificationsRetry;
      retryBtn.addEventListener("click", () => void loadNotifications());
      notifList.append(retryBtn);
    }
  };

  const renderNotifItems = (items: NotifItem[]) => {
    notifList.replaceChildren();
    if (items.length === 0) {
      renderNotifStatus(copy.notificationsEmpty);
      return;
    }
    for (const item of items) {
      const row = createElement(
        documentRef,
        "button",
        "kastir-admin-bar__notif-item",
      );
      row.type = "button";
      row.dataset.unread = item.readAt ? "false" : "true";
      row.textContent = item.message;
      row.addEventListener("click", () => {
        void (async () => {
          if (!item.readAt) {
            try {
              const response = await windowRef.fetch(
                `/api/admin/notifications/${encodeURIComponent(item.id)}/read`,
                { method: "POST", credentials: "include", cache: "no-store" },
              );
              if (response.ok) {
                const payload = (await response.json()) as {
                  unreadCount?: number;
                };
                item.readAt = new Date().toISOString();
                row.dataset.unread = "false";
                if (typeof payload.unreadCount === "number")
                  setBadge(payload.unreadCount);
              }
            } catch {
              // ignore mark-read failure
            }
          }
          if (
            item.link &&
            item.link.startsWith("/") &&
            !item.link.startsWith("//")
          ) {
            windowRef.location.assign(item.link);
          }
        })();
      });
      notifList.append(row);
    }
  };

  async function loadNotifications(): Promise<void> {
    renderNotifStatus(copy.notificationsLoading);
    try {
      const response = await windowRef.fetch(
        "/api/admin/notifications?page=1&pageSize=20",
        { credentials: "include", cache: "no-store" },
      );
      if (!response.ok) throw new Error("fail");
      const payload = (await response.json()) as {
        items?: NotifItem[];
        unreadCount?: number;
      };
      const items = Array.isArray(payload.items) ? payload.items : [];
      if (typeof payload.unreadCount === "number")
        setBadge(payload.unreadCount);
      renderNotifItems(items);
    } catch {
      renderNotifStatus(copy.notificationsError, true);
    }
  }

  themeButton.addEventListener("click", () => {
    setTheme(
      root,
      themeButton,
      root.dataset.theme === "dark" ? "light" : "dark",
      copy,
      windowRef,
    );
  });

  profileButton.addEventListener("click", () => {
    const expanded = profileButton.getAttribute("aria-expanded") === "true";
    closeNotif();
    profileButton.setAttribute("aria-expanded", String(!expanded));
    profileMenu.hidden = expanded;
  });

  notifButton.addEventListener("click", () => {
    const expanded = notifButton.getAttribute("aria-expanded") === "true";
    closeProfile();
    if (expanded) {
      closeNotif();
      return;
    }
    notifButton.setAttribute("aria-expanded", "true");
    notifPanel.hidden = false;
    void loadNotifications();
  });

  notifClose.addEventListener("click", () => {
    closeNotif();
    notifButton.focus();
  });

  root.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!profileMenu.hidden) {
      closeProfile();
      profileButton.focus();
      return;
    }
    if (!notifPanel.hidden) {
      closeNotif();
      notifButton.focus();
    }
  });

  logoutButton.addEventListener("click", () => {
    logoutButton.disabled = true;
    void signOutAndReload(windowRef);
  });

  return root;
}

async function signOutAndReload(windowRef: Window): Promise<void> {
  try {
    await windowRef.fetch("/api/auth/sign-out", {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: "{}",
    });
  } catch {
    // Reload even if the network failed so the stale overlay cannot persist.
  } finally {
    windowRef.location.reload();
  }
}

async function loadSession(pageId: string): Promise<void> {
  try {
    const response = await window.fetch("/api/admin-bar/session", {
      credentials: "include",
      headers: { accept: "application/json" },
    });
    if (!response.ok) return;

    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object") return;
    const sessionPayload = payload as {
      user?: unknown;
      locale?: unknown;
    };
    if (!isPublicBarUser(sessionPayload.user)) return;

    mountAdminBar(
      sessionPayload.user,
      pageId,
      localeFor(sessionPayload.locale),
      document,
      window,
    );
  } catch {
    // Anonymous visitors and unavailable APIs must leave the page untouched.
  }
}

const scriptElement =
  typeof document === "undefined" ? null : document.currentScript;
const hasAdminBarMarker =
  scriptElement?.getAttribute("data-kastir-admin-bar") === "1" ||
  scriptElement?.hasAttribute("data-kastir-admin-bar") === true;
const compiledPageId = scriptElement?.getAttribute("data-page-id") ?? "";

if (typeof window !== "undefined" && (hasAdminBarMarker || compiledPageId)) {
  window.addEventListener("load", () => void loadSession(compiledPageId), {
    once: true,
  });
}
