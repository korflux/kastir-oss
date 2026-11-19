"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Toggle de disponibilidade (No ar / Fora do ar, Published/Draft).
 * - `button` (default): botão de texto.
 * - `switch`: pista + knob (listagens e editores de Pages, Scripts e Split tests).
 *
 * É um componente compartilhado: todo recurso novo é prop opcional aditiva, e sem ela a
 * saída é exatamente a anterior (Split tests e editores não mudam de comportamento).
 * Quem decide rótulos, confirmação e a chamada ao servidor é o chamador; aqui só se
 * renderiza o estado recebido.
 */
export function StatusToggle({
  published,
  busy = false,
  disabled = false,
  publishedLabel = "Published",
  draftLabel = "Draft",
  draftShortLabel,
  publishLabel = "Publish page",
  unpublishLabel = "Unpublish page",
  busyLabel = "Saving…",
  appearance = "button",
  onToggle,
}: {
  published: boolean;
  busy?: boolean;
  /** Sem ponteiro publicado (ou form sujo): visível e inerte. */
  disabled?: boolean;
  publishedLabel?: string;
  draftLabel?: string;
  /**
   * Rótulo curto do estado "fora do ar" para telas estreitas (`switch` apenas): abaixo do
   * breakpoint `sm` mostra este texto no lugar de `draftLabel`. O nome acessível do
   * controle é `publishLabel`/`unpublishLabel` (aria-label) e não muda com a largura.
   */
  draftShortLabel?: string;
  publishLabel?: string;
  unpublishLabel?: string;
  busyLabel?: string;
  appearance?: "button" | "switch";
  onToggle: () => void | Promise<void>;
}) {
  const inert = busy || disabled;
  if (appearance === "switch") {
    return (
      <button
        aria-checked={published}
        aria-disabled={inert}
        aria-label={published ? unpublishLabel : publishLabel}
        className={cn(
          "focus-visible:ring-ring/50 inline-flex items-center gap-2 rounded-md text-sm outline-none focus-visible:ring-2",
          inert && "opacity-60",
        )}
        disabled={inert}
        role="switch"
        type="button"
        onClick={() => void onToggle()}
      >
        <span
          aria-hidden="true"
          className={cn(
            "relative inline-flex h-[19px] w-10 shrink-0 items-center rounded-full transition-colors",
            published ? "bg-brand" : "bg-muted",
          )}
        >
          <span
            className={cn(
              "absolute top-1/2 size-[17px] -translate-y-1/2 rounded-full bg-white shadow transition-all",
              published ? "left-[21px]" : "left-0.5",
            )}
          />
        </span>
        <span
          className={cn(
            "text-sm",
            published ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {busy ? (
            busyLabel
          ) : published ? (
            publishedLabel
          ) : draftShortLabel ? (
            <>
              <span className="hidden sm:inline">{draftLabel}</span>
              <span className="sm:hidden">{draftShortLabel}</span>
            </>
          ) : (
            draftLabel
          )}
        </span>
      </button>
    );
  }

  return (
    <Button
      aria-disabled={inert}
      aria-label={published ? unpublishLabel : publishLabel}
      aria-pressed={published}
      disabled={inert}
      size="sm"
      variant={published ? "secondary" : "outline"}
      onClick={() => void onToggle()}
    >
      {busy ? busyLabel : published ? publishedLabel : draftLabel}
    </Button>
  );
}
