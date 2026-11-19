"use client";

import { ChevronDown, ChevronUp } from "lucide-react";

import { cn } from "@/lib/utils";
import type { NameSortDir } from "@/lib/utils/nameSort";

/**
 * Glifo da direção da ordenação por nome: seta para cima = A-Z, para baixo = Z-A. Fonte única do
 * mapeamento direção → ícone, usada pelo cabeçalho de coluna (`NameSortHeader`) e por controles de
 * ordenação que vivem fora da tabela (ex.: o botão mobile da listagem de Pages).
 */
export function NameSortIcon({
  className,
  sortDir,
}: {
  className?: string;
  sortDir: NameSortDir;
}) {
  const Icon = sortDir === "asc" ? ChevronUp : ChevronDown;
  return <Icon aria-hidden className={cn("size-3.5", className)} />;
}

/**
 * Valor de `aria-sort` para o `role="columnheader"` que envolve o `NameSortHeader`.
 *
 * `aria-sort` só é válido em `columnheader`/`rowheader`, nunca no botão de dentro; por isso quem
 * monta a tabela aplica este valor no cabeçalho da coluna (padrão APG de tabela ordenável), e o
 * leitor de tela anuncia "ordenado de forma crescente/decrescente" ao chegar na coluna.
 */
export function nameSortAriaValue(
  sortDir: NameSortDir,
): "ascending" | "descending" {
  return sortDir === "asc" ? "ascending" : "descending";
}

/**
 * Botão da coluna Nome (A-Z / Z-A). Vai dentro de um `role="columnheader"` com
 * `aria-sort={nameSortAriaValue(sortDir)}`: o estado é anunciado no cabeçalho, o botão só alterna.
 * Quem usa (Pages, Scripts e Split Tests) aplica o atributo no próprio `columnheader`.
 */
export function NameSortHeader({
  label,
  sortDir,
  onToggle,
}: {
  label: string;
  sortDir: NameSortDir;
  onToggle: () => void;
}) {
  return (
    <button
      className="hover:text-foreground inline-flex items-center gap-1"
      type="button"
      onClick={onToggle}
    >
      {label}
      <NameSortIcon sortDir={sortDir} />
    </button>
  );
}
