"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

/** Preferência de menu oculto — só UI, não permissão (localStorage por navegador). */
export const MENU_VISIBILITY_STORAGE_KEY = "kastir-menu-visibility";
const CHANGE_EVENT = "kastir-menu-visibility-change";

function readRaw(): string {
  try {
    return window.localStorage.getItem(MENU_VISIBILITY_STORAGE_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

function parseHiddenKeys(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((key): key is string => typeof key === "string");
  } catch {
    return [];
  }
}

function subscribe(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(CHANGE_EVENT, onStoreChange);
  };
}

/** Lê/escreve keys ocultas de MENU_ITEMS em localStorage. */
export function useMenuVisibility() {
  // Snapshot string estável — array novo a cada read quebraria useSyncExternalStore.
  const raw = useSyncExternalStore(subscribe, readRaw, () => "[]");
  const hiddenKeys = useMemo(() => parseHiddenKeys(raw), [raw]);

  const toggleKey = useCallback((key: string) => {
    const next = new Set(parseHiddenKeys(readRaw()));
    if (next.has(key)) next.delete(key);
    else next.add(key);
    window.localStorage.setItem(
      MENU_VISIBILITY_STORAGE_KEY,
      JSON.stringify([...next]),
    );
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return { hiddenKeys, toggleKey };
}
