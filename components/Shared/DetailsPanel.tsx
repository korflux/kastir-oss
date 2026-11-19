import type { ReactNode } from "react";
import { FileText } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Layout Figma Pages EDIT / Scripts EDIT / SplitTests EDIT:
 * coluna esquerda Details (fixa) + conteúdo full à direita.
 *
 * De `lg` em diante a coluna Details tem 15 a 17,5rem (`wide`: até 20rem).
 *
 * Abaixo de `lg` o Details vira uma faixa (`max-h-64`, com rolagem própria) acima do conteúdo.
 * Dois modos para essa faixa:
 *   - padrão: a altura da tela é repartida entre a faixa e o conteúdo (o conteúdo ocupa o que
 *     sobra). Serve a conteúdos que se adaptam a uma área curta (ex.: tabela de Split tests).
 *   - `flowOnMobile`: o painel cresce com o conteúdo e QUEM O CONTÉM rola (uma rolagem única,
 *     natural). Serve aos editores de Pages e Scripts, cujo modo de comparação precisa de
 *     barra, campos, ações e diff legíveis juntos. O contêiner pai precisa ter
 *     `overflow-y-auto` abaixo de `lg` e o conteúdo precisa declarar a própria altura nesse
 *     intervalo (o painel não a impõe). De `lg` em diante os dois modos são idênticos.
 */
export function DetailsPanel({
  details,
  detailsNotice,
  children,
  detailsTitle = "Details",
  className,
  showIcon = true,
  flowOnMobile = false,
  wide = false,
}: {
  details: ReactNode;
  /**
   * Nota fixa entre o título e a área rolável do Details (ex.: "Edição pausada enquanto você
   * compara"). Fica FORA da rolagem de propósito: dentro dela, colada ao topo, cobria o rótulo
   * dos campos assim que o Details estivesse rolado.
   */
  detailsNotice?: ReactNode;
  children: ReactNode;
  detailsTitle?: string;
  className?: string;
  showIcon?: boolean;
  /** Abaixo de `lg`, o painel cresce com o conteúdo e o contêiner pai rola (ver acima). */
  flowOnMobile?: boolean;
  /**
   * Coluna Details até 20rem (padrão 17,5rem). Para Details com linhas que não cabem em 17,5rem,
   * como o bloco Versões (data inteira + selo na mesma linha); alinha com os ~330px da proposta
   * aprovada.
   */
  wide?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-3 lg:grid-rows-1",
        wide
          ? "lg:grid-cols-[minmax(15rem,20rem)_minmax(0,1fr)]"
          : "lg:grid-cols-[minmax(15rem,17.5rem)_minmax(0,1fr)]",
        flowOnMobile
          ? // Linhas automáticas e sem corte: a altura vem do conteúdo; de lg em diante o painel
            // volta a ocupar a altura do contêiner pai.
            "shrink-0 lg:h-full lg:min-h-0 lg:flex-1 lg:shrink lg:overflow-hidden"
          : // No mobile o Details vira uma faixa rolável; a segunda linha recebe
            // o espaço restante. A grade de uma única linha cortava o conteúdo.
            "h-full min-h-0 flex-1 grid-rows-[minmax(0,auto)_minmax(0,1fr)] overflow-hidden",
        className,
      )}
      data-testid="details-panel"
    >
      <aside className="bg-card/80 border-border flex h-auto max-h-64 min-h-0 flex-col overflow-hidden rounded-2xl border p-3 lg:h-full lg:max-h-none">
        <h2 className="text-foreground mb-2 flex shrink-0 items-center gap-2 text-sm font-medium">
          {showIcon ? (
            <FileText aria-hidden className="size-4 opacity-80" />
          ) : null}
          {detailsTitle}
        </h2>
        {detailsNotice ? (
          <div className="mb-2 shrink-0" data-testid="details-notice">
            {detailsNotice}
          </div>
        ) : null}
        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto">
          {details}
        </div>
      </aside>
      <section
        className={cn(
          "bg-card/80 border-border flex min-w-0 flex-col overflow-hidden rounded-2xl border p-0",
          flowOnMobile ? "lg:h-full lg:min-h-0" : "h-full min-h-0",
        )}
      >
        {children}
      </section>
    </div>
  );
}
