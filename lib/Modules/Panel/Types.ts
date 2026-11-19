export type EffectiveRole = "MASTER" | "ADMIN" | "EDITOR";

// Fase 31: Home (site público) + 6 áreas de topo (+ Setup via engrenagem).
export type PanelMenuKey =
  "home" | "panel" | "pages" | "media" | "scripts" | "splitTests" | "users";

export type PanelMenuItem = {
  key: PanelMenuKey;
  href: string;
  labelKey: PanelMenuKey;
  iconKey: string;
  roles: readonly EffectiveRole[];
};
