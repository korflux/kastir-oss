"use client";

import { useState, type FormEvent } from "react";
import { Zap } from "lucide-react";

import { canChangeQuickEditOpen } from "@/components/Shared/quickEdit";
import { SlugField } from "@/components/Shared/SlugField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { normalizeSlug } from "@/lib/Modules/SplitTests/slug";
import type { SplitTestsCopy } from "@/lib/Modules/SplitTests/Components/SplitTestsTypes";
import type { ApiError } from "@/lib/requestJson";
import { cn } from "@/lib/utils";

export type SplitTestQuickEditInput = {
  name: string;
  slug: string;
};

type SplitTestQuickEditCampaign = SplitTestQuickEditInput & { id: string };

/** Valida o contrato estreito antes do PATCH; status e destinos pertencem ao editor completo. */
export function canSubmitSplitTestQuickEdit(
  input: SplitTestQuickEditInput,
): boolean {
  return Boolean(input.name.trim() && input.slug.trim());
}

/** Popover de campanha que só edita identidade, preservando o editor de destinos. */
export function SplitTestQuickEditPopover({
  campaign,
  dictionary,
  onSave,
}: {
  campaign: SplitTestQuickEditCampaign;
  dictionary: SplitTestsCopy;
  onSave: (input: SplitTestQuickEditInput) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(campaign.name);
  const [slug, setSlug] = useState(campaign.slug);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleOpenChange(nextOpen: boolean) {
    if (!canChangeQuickEditOpen(nextOpen, saving)) return;
    setOpen(nextOpen);
    if (!nextOpen) return;

    // Reabre com a versão confirmada pela API e descarta somente tentativas antigas.
    setName(campaign.name);
    setSlug(campaign.slug);
    setError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmitSplitTestQuickEdit({ name, slug })) {
      setError(dictionary.quickEditValidationError);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSave({ name: name.trim(), slug: normalizeSlug(slug) });
      setOpen(false);
    } catch (saveError) {
      setError((saveError as ApiError).message || dictionary.error);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        aria-label={`${dictionary.quickEdit}: ${campaign.name}`}
        className={cn(
          "text-muted-foreground hover:text-foreground inline-flex size-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-white/10",
          "focus-visible:ring-ring outline-none focus-visible:ring-2",
        )}
        disabled={saving}
        type="button"
      >
        <Zap aria-hidden className="size-3.5" />
      </PopoverTrigger>
      {open ? (
        <PopoverContent className="flex min-h-0 flex-col gap-3 overflow-hidden">
          <div>
            <h3 className="text-foreground text-sm font-semibold">
              {dictionary.quickEdit}
            </h3>
            <p className="text-muted-foreground mt-1 truncate text-xs">
              {campaign.name}
            </p>
          </div>

          <form
            className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-1"
            onSubmit={handleSubmit}
          >
            <label
              className="block space-y-1 text-sm"
              htmlFor={`quick-split-name-${campaign.id}`}
            >
              <span>{dictionary.name}</span>
              <Input
                autoComplete="off"
                disabled={saving}
                id={`quick-split-name-${campaign.id}`}
                maxLength={200}
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>

            <SlugField
              autoValue={normalizeSlug(name)}
              hideHint
              inputId={`quick-split-slug-${campaign.id}`}
              disabled={saving}
              value={slug}
              onChange={setSlug}
            />

            {error ? (
              <p className="text-destructive text-xs" role="alert">
                {error}
              </p>
            ) : null}

            <div className="border-border bg-popover sticky bottom-0 flex justify-end gap-2 border-t pt-3">
              <Button
                disabled={saving}
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                {dictionary.cancel}
              </Button>
              <Button disabled={saving} type="submit">
                {saving ? dictionary.working : dictionary.save}
              </Button>
            </div>
          </form>
        </PopoverContent>
      ) : null}
    </Popover>
  );
}
