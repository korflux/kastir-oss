/**
 * Stable tour anchor ids. Menu keys (panel/scripts) map to anchors that
 * page wrappers already expose (`tour-custom-code` still on the Scripts route).
 */
export function tourAnchorId(menuKey: string): string {
  if (menuKey === "scripts") return "tour-custom-code";
  if (menuKey === "panel") return "tour-panel";
  return `tour-${menuKey}`;
}
