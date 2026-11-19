import type { PanelDictionary } from "@/lib/i18n/panel";

/** Contratos locais compartilhados entre lista, seletores e editor. */
export type CustomCodeCopy = PanelDictionary["customCode"];
export type TriggerType =
  "SELECTOR_EVENT" | "PAGE_LOAD" | "SCROLL" | "REFERRER";
export type TriggerConfig =
  | { selector: string; event: "click" | "submit" }
  | { delaySeconds: number }
  | { percentage: number }
  | { matches: string };
export type SnippetDto = {
  id: string;
  name: string;
  location: "HEADER" | "BODY_START" | "BODY_END";
  content: string;
  status: "DRAFT" | "PUBLISHED";
  priority: number | null;
  scopeType: "ALL_PAGES" | "SPECIFIC_PAGES";
  scopedPages?: Array<{ pageId: string }>;
  triggerType: TriggerType | null;
  triggerConfig: TriggerConfig | null;
  maxDisplays: number | null;
  displayResetDays: number | null;
  publishedRevisionId?: string | null;
  hasUnpublishedChanges?: boolean;
  draftFingerprint?: string;
  activated?: boolean;
  activatedDuringPublish?: boolean;
  deletedAt?: string | null;
  deletedBy?: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
};
export type PageDto = { id: string; title: string; slug: string };
