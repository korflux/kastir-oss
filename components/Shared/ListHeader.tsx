import type { ReactNode } from "react";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Header de listagem compartilhado (Figma: Pages/Medias/Scripts/…).
 * Busca controlada pelo consumidor — sem estado próprio.
 */
export function ListHeader({
  title,
  subtitle,
  searchValue,
  onSearchChange,
  searchPlaceholder = "Search by",
  searchAriaLabel,
  children,
  className,
  disabled = false,
}: {
  title: string;
  subtitle?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  searchAriaLabel?: string;
  children?: ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  const showSearch = onSearchChange != null;

  return (
    <div
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
      data-testid="list-header"
    >
      <div className="min-w-0">
        <h1 className="text-foreground text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl">
          {title}
        </h1>
        {subtitle ? (
          <p className="text-muted-foreground mt-2 text-base md:text-lg">
            {subtitle}
          </p>
        ) : null}
      </div>
      <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">
        {showSearch ? (
          <label className="relative min-w-0 flex-1 sm:flex-none">
            <span className="sr-only">
              {searchAriaLabel ?? searchPlaceholder}
            </span>
            <Input
              className="h-9 w-full max-w-[16rem] rounded-full pr-9"
              disabled={disabled}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={searchPlaceholder}
              type="search"
              value={searchValue ?? ""}
            />
            <Search
              aria-hidden="true"
              className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2"
            />
          </label>
        ) : null}
        {children}
      </div>
    </div>
  );
}
