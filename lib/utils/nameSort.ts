/** Compara por nome (pt-BR) — sort de apresentação nas listas do painel. */
export type NameSortDir = "asc" | "desc";

export function compareByName(
  a: string,
  b: string,
  dir: NameSortDir = "asc",
): number {
  const result = a.localeCompare(b, "pt-BR", { sensitivity: "base" });
  return dir === "asc" ? result : -result;
}
