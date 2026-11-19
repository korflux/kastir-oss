/**
 * Runtime for Custom Code snippets configured with a display trigger
 * (popups). No imports from lib/app — this is a standalone browser bundle,
 * same constraint as admin-bar.ts; parity with lib/Modules/CustomCode/Types.ts
 * is manual, not enforced by a shared import.
 */

type TriggerType = "SELECTOR_EVENT" | "PAGE_LOAD" | "SCROLL" | "REFERRER";

type SelectorEventTriggerConfig = {
  selector: string;
  event: "click" | "submit";
};
type PageLoadTriggerConfig = { delaySeconds: number };
type ScrollTriggerConfig = { percentage: number };
type ReferrerTriggerConfig = { matches: string };

type PopupTriggerEntry = {
  triggerType: TriggerType;
  triggerConfig:
    | SelectorEventTriggerConfig
    | PageLoadTriggerConfig
    | ScrollTriggerConfig
    | ReferrerTriggerConfig;
  maxDisplays: number | null;
  displayResetDays: number | null;
};

type PopupConfig = Record<string, PopupTriggerEntry>;

export type StoredDisplayState = { count: number; windowStart: number };

const DEFAULT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Pure — the wiring below always passes windowMs from displayResetDays; the
 * default here is only a defensive fallback for a generic caller. */
export function nextDisplayState(
  now: number,
  stored: StoredDisplayState | null,
  windowMs = DEFAULT_WINDOW_MS,
): StoredDisplayState {
  if (!stored || now - stored.windowStart >= windowMs) {
    return { count: 1, windowStart: now };
  }
  return { count: stored.count + 1, windowStart: stored.windowStart };
}

export function canDisplay(
  now: number,
  stored: StoredDisplayState | null,
  maxDisplays: number | null,
  windowMs = DEFAULT_WINDOW_MS,
): boolean {
  if (maxDisplays == null) return true;
  if (!stored || now - stored.windowStart >= windowMs) return true;
  return stored.count < maxDisplays;
}

export function referrerMatches(referrer: string, matches: string): boolean {
  return referrer.includes(matches);
}

function storageKey(snippetId: string): string {
  return `kastir_popup_${snippetId}`;
}

function readStoredState(
  windowRef: Window,
  snippetId: string,
): StoredDisplayState | null {
  try {
    const raw = windowRef.localStorage.getItem(storageKey(snippetId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredDisplayState>;
    if (
      typeof parsed.count !== "number" ||
      typeof parsed.windowStart !== "number"
    )
      return null;
    return { count: parsed.count, windowStart: parsed.windowStart };
  } catch {
    return null;
  }
}

function writeStoredState(
  windowRef: Window,
  snippetId: string,
  state: StoredDisplayState,
): void {
  try {
    windowRef.localStorage.setItem(
      storageKey(snippetId),
      JSON.stringify(state),
    );
  } catch {
    // Private browsing and blocked storage must not disable the trigger.
  }
}

function activate(
  documentRef: Document,
  windowRef: Window,
  snippetId: string,
  entry: PopupTriggerEntry,
  cleanup: () => void,
): void {
  const now = Date.now();
  const windowMs = (entry.displayResetDays ?? 30) * 24 * 60 * 60 * 1000;
  const stored = readStoredState(windowRef, snippetId);
  // The trigger event already fired once this page load — remove listeners
  // even when capped, so a SELECTOR_EVENT popup doesn't keep re-checking
  // canDisplay on every subsequent click/submit for the rest of the load.
  cleanup();
  if (!canDisplay(now, stored, entry.maxDisplays, windowMs)) return;

  const wrapper = documentRef.querySelector(
    `[data-kastir-trigger="${CSS.escape(snippetId)}"]`,
  );
  if (wrapper instanceof HTMLElement) wrapper.style.display = "";

  if (entry.maxDisplays != null) {
    writeStoredState(
      windowRef,
      snippetId,
      nextDisplayState(now, stored, windowMs),
    );
  }
}

function wireSelectorEvent(
  documentRef: Document,
  windowRef: Window,
  snippetId: string,
  entry: PopupTriggerEntry,
  config: SelectorEventTriggerConfig,
): void {
  const elements = documentRef.querySelectorAll(config.selector);
  const handler = () =>
    activate(documentRef, windowRef, snippetId, entry, () => {
      elements.forEach((element) =>
        element.removeEventListener(config.event, handler),
      );
    });
  elements.forEach((element) =>
    element.addEventListener(config.event, handler),
  );
}

function wirePageLoad(
  documentRef: Document,
  windowRef: Window,
  snippetId: string,
  entry: PopupTriggerEntry,
  config: PageLoadTriggerConfig,
): void {
  windowRef.setTimeout(() => {
    activate(documentRef, windowRef, snippetId, entry, () => {});
  }, config.delaySeconds * 1000);
}

function wireScroll(
  documentRef: Document,
  windowRef: Window,
  snippetId: string,
  entry: PopupTriggerEntry,
  config: ScrollTriggerConfig,
): void {
  let ticking = false;
  const handler = () => {
    if (ticking) return;
    ticking = true;
    windowRef.requestAnimationFrame(() => {
      ticking = false;
      const doc = documentRef.documentElement;
      const scrolled = windowRef.scrollY + windowRef.innerHeight;
      const percentage =
        doc.scrollHeight > 0 ? (scrolled / doc.scrollHeight) * 100 : 0;
      if (percentage < config.percentage) return;
      windowRef.removeEventListener("scroll", handler);
      activate(documentRef, windowRef, snippetId, entry, () => {});
    });
  };
  windowRef.addEventListener("scroll", handler, { passive: true });
}

function wireReferrer(
  documentRef: Document,
  windowRef: Window,
  snippetId: string,
  entry: PopupTriggerEntry,
  config: ReferrerTriggerConfig,
): void {
  if (!referrerMatches(documentRef.referrer, config.matches)) return;
  activate(documentRef, windowRef, snippetId, entry, () => {});
}

function wireTrigger(
  documentRef: Document,
  windowRef: Window,
  snippetId: string,
  entry: PopupTriggerEntry,
): void {
  switch (entry.triggerType) {
    case "SELECTOR_EVENT":
      wireSelectorEvent(
        documentRef,
        windowRef,
        snippetId,
        entry,
        entry.triggerConfig as SelectorEventTriggerConfig,
      );
      return;
    case "PAGE_LOAD":
      wirePageLoad(
        documentRef,
        windowRef,
        snippetId,
        entry,
        entry.triggerConfig as PageLoadTriggerConfig,
      );
      return;
    case "SCROLL":
      wireScroll(
        documentRef,
        windowRef,
        snippetId,
        entry,
        entry.triggerConfig as ScrollTriggerConfig,
      );
      return;
    case "REFERRER":
      wireReferrer(
        documentRef,
        windowRef,
        snippetId,
        entry,
        entry.triggerConfig as ReferrerTriggerConfig,
      );
      return;
  }
}

function readConfig(documentRef: Document): PopupConfig | null {
  const element = documentRef.getElementById("kastir-popup-config");
  if (!element?.textContent) return null;
  try {
    return JSON.parse(element.textContent) as PopupConfig;
  } catch {
    return null;
  }
}

function init(documentRef: Document, windowRef: Window): void {
  const config = readConfig(documentRef);
  if (!config) return;
  for (const [snippetId, entry] of Object.entries(config)) {
    // Isolated per snippet: an invalid selector on one popup must not stop
    // the rest of the page's popups from wiring up.
    try {
      wireTrigger(documentRef, windowRef, snippetId, entry);
    } catch (error) {
      console.error(
        `[kastir] popup trigger "${snippetId}" failed to wire`,
        error,
      );
    }
  }
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  init(document, window);
}
