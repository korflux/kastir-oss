import { forwardRef, type HTMLAttributes, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Viewport visual da lista: mantém o eixo X contido no módulo e reserva o
 * scroll vertical para a própria lista, sem conhecer dados ou mutações.
 */
export const ListViewport = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(function ListViewport({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn(
        "min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain",
        className,
      )}
      {...props}
    />
  );
});

ListViewport.displayName = "ListViewport";

/** Estado vazio visual compartilhado; o texto continua sendo responsabilidade do módulo. */
export function ListEmptyState({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "text-muted-foreground border-border border border-dashed px-4 py-12 text-center text-sm",
        className,
      )}
      role="status"
    >
      {children}
    </div>
  );
}
