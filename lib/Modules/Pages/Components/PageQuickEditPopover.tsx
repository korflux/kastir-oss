"use client";

import { useState, type FormEvent } from "react";
import { Zap } from "lucide-react";

import { SelectChevron } from "@/components/Shared/SelectChevron";
import { SlugField } from "@/components/Shared/SlugField";
import { canChangeQuickEditOpen } from "@/components/Shared/quickEdit";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normalizeSlug } from "@/lib/Modules/Pages/slug";
import type { PanelDictionary } from "@/lib/i18n/panel";
import type { ApiError } from "@/lib/requestJson";
import { cn } from "@/lib/utils";

export type PageQuickEditInput = {
  title: string;
  slug: string;
  folderId: string;
};

type PageQuickEditPage = PageQuickEditInput & { id: string };

type PageQuickEditFolder = {
  id: string;
  name: string;
  parentId: string | null;
};

/** Evita enviar uma edição rápida que o schema de Página rejeitaria imediatamente. */
export function canSubmitPageQuickEdit(
  input: Pick<PageQuickEditInput, "title" | "folderId">,
): boolean {
  return Boolean(input.title.trim() && input.folderId);
}

function folderPath(folderId: string, folders: PageQuickEditFolder[]): string {
  const parts: string[] = [];
  let current = folders.find((folder) => folder.id === folderId);
  while (current) {
    parts.unshift(current.name);
    current = current.parentId
      ? folders.find((folder) => folder.id === current?.parentId)
      : undefined;
  }
  return parts.join(" / ");
}

/** Popover de Pages: mantém o contexto da lista e fecha somente após PUT aceito. */
export function PageQuickEditPopover({
  disabled = false,
  dictionary,
  folders,
  onSave,
  page,
}: {
  disabled?: boolean;
  dictionary: PanelDictionary["pages"];
  folders: PageQuickEditFolder[];
  onSave: (input: PageQuickEditInput) => Promise<void>;
  page: PageQuickEditPage;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(page.title);
  const [slug, setSlug] = useState(page.slug);
  const [folderId, setFolderId] = useState(page.folderId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleOpenChange(nextOpen: boolean) {
    if (!canChangeQuickEditOpen(nextOpen, saving || disabled)) return;
    setOpen(nextOpen);
    if (!nextOpen) return;

    // Reabre sempre com o DTO atual, nunca com um rascunho de tentativa anterior.
    setTitle(page.title);
    setSlug(page.slug);
    setFolderId(page.folderId);
    setError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    const input = { title, slug, folderId };
    if (!canSubmitPageQuickEdit(input)) {
      setError(dictionary.invalidForm);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSave({
        title: title.trim(),
        slug: slug.trim(),
        folderId,
      });
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
        aria-label={`${dictionary.quickEdit}: ${page.title}`}
        className={cn(
          "text-muted-foreground hover:text-foreground inline-flex size-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-white/10",
          "focus-visible:ring-ring outline-none focus-visible:ring-2",
        )}
        disabled={saving || disabled}
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
              {page.title}
            </p>
          </div>

          <form
            className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-1"
            onSubmit={handleSubmit}
          >
            <label
              className="block space-y-1 text-sm"
              htmlFor={`quick-page-title-${page.id}`}
            >
              <span>{dictionary.nameLabel}</span>
              <Input
                autoComplete="off"
                disabled={saving || disabled}
                id={`quick-page-title-${page.id}`}
                maxLength={200}
                required
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>

            <SlugField
              autoValue={normalizeSlug(title)}
              hideHint
              inputId={`quick-page-slug-${page.id}`}
              disabled={saving || disabled}
              value={slug}
              onChange={setSlug}
            />

            <label
              className="block space-y-1 text-sm"
              htmlFor={`quick-page-folder-${page.id}`}
            >
              <span>{dictionary.folderLabel}</span>
              <div className="relative">
                <select
                  className="border-input bg-card text-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full appearance-none rounded-lg border py-1 pr-8 pl-3 text-sm outline-none focus-visible:ring-3"
                  disabled={saving || disabled}
                  id={`quick-page-folder-${page.id}`}
                  required
                  value={folderId}
                  onChange={(event) => setFolderId(event.target.value)}
                >
                  <option value="">{dictionary.selectFolder}</option>
                  {folders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folderPath(folder.id, folders) || folder.name}
                    </option>
                  ))}
                </select>
                <SelectChevron />
              </div>
            </label>

            {error ? (
              <p className="text-destructive text-xs" role="alert">
                {error}
              </p>
            ) : null}

            <div className="border-border bg-popover sticky bottom-0 flex justify-end gap-2 border-t pt-3">
              <Button
                disabled={saving || disabled}
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                {dictionary.cancel}
              </Button>
              <Button disabled={saving || disabled} type="submit">
                {saving ? dictionary.working : dictionary.save}
              </Button>
            </div>
          </form>
        </PopoverContent>
      ) : null}
    </Popover>
  );
}
