"use client";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type SeoValues = {
  seoTitle: string;
  seoDescription: string;
  seoKeyword: string;
};

/** Bolinha SEO ao lado do rótulo (Figma). Neutra até a Fase 32 pintar por regra. */
export function SeoDot({ tone = "neutral" }: { tone?: "neutral" | "alert" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        tone === "alert"
          ? "bg-destructive"
          : // Claro e escuro: branco some no light; foreground some no dark puro.
            "bg-foreground/55 ring-foreground/20 ring-1 dark:bg-white/90 dark:ring-white/30",
      )}
      data-testid="seo-indicator"
    />
  );
}

export function SeoFields({
  values,
  labels = {
    legend: "SEO metadata",
    title: "SEO title",
    description: "SEO description",
    keyword: "SEO keyword",
  },
  /** Figma Pages EDIT: só Keyword + Description, sem legenda/título SEO. */
  compact = false,
  disabled = false,
  onChange,
}: {
  values: SeoValues;
  labels?: {
    legend?: string;
    title?: string;
    description?: string;
    keyword?: string;
  };
  compact?: boolean;
  disabled?: boolean;
  onChange: (values: SeoValues) => void;
}) {
  return (
    <fieldset className="space-y-3">
      {!compact && labels.legend ? (
        <legend className="text-sm font-medium">{labels.legend}</legend>
      ) : null}
      {!compact ? (
        <label className="block space-y-1 text-sm" htmlFor="seo-title">
          <span className="flex items-center gap-1.5">
            {labels.title}
            <SeoDot />
          </span>
          <Input
            disabled={disabled}
            id="seo-title"
            maxLength={255}
            value={values.seoTitle}
            onChange={(event) =>
              onChange({ ...values, seoTitle: event.target.value })
            }
          />
        </label>
      ) : null}
      <label className="block space-y-1 text-sm" htmlFor="seo-keyword">
        <span className="flex items-center gap-1.5">
          {labels.keyword}
          <SeoDot />
        </span>
        <Input
          className="h-9 rounded-lg"
          disabled={disabled}
          id="seo-keyword"
          maxLength={255}
          value={values.seoKeyword}
          onChange={(event) =>
            onChange({ ...values, seoKeyword: event.target.value })
          }
        />
      </label>
      <label className="block space-y-1 text-sm" htmlFor="seo-description">
        <span className="flex items-center gap-1.5">
          {labels.description}
          <SeoDot />
        </span>
        <textarea
          className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 min-h-[5.5rem] w-full rounded-lg border bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
          id="seo-description"
          maxLength={255}
          value={values.seoDescription}
          onChange={(event) =>
            onChange({ ...values, seoDescription: event.target.value })
          }
        />
      </label>
    </fieldset>
  );
}
