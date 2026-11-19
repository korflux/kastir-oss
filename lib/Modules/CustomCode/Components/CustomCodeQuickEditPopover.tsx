"use client";

import { useState, type FormEvent } from "react";
import { Zap } from "lucide-react";

import { SelectChevron } from "@/components/Shared/SelectChevron";
import { canChangeQuickEditOpen } from "@/components/Shared/quickEdit";
import { CustomCodeScopeSelector } from "@/lib/Modules/CustomCode/Components/CustomCodeScopeSelector";
import type {
  CustomCodeCopy,
  SnippetDto,
} from "@/lib/Modules/CustomCode/Components/CustomCodeTypes";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ApiError } from "@/lib/requestJson";
import { cn } from "@/lib/utils";

export type CustomCodeQuickEditDraft = {
  name: string;
  location: SnippetDto["location"];
  priority: string;
  scopeType: SnippetDto["scopeType"];
  pageIds: string[];
};

export type CustomCodeQuickEditInput = Omit<
  CustomCodeQuickEditDraft,
  "priority"
> & {
  priority: number | null;
};

type CustomCodeQuickEditPage = Pick<
  SnippetDto,
  "id" | "name" | "location" | "priority" | "scopeType"
> & {
  scopedPages?: SnippetDto["scopedPages"];
};

/** Valida só os campos editáveis antes de enviar o snapshot ao PUT existente. */
export function canSubmitCustomCodeQuickEdit(
  input: Pick<CustomCodeQuickEditDraft, "name" | "priority">,
): boolean {
  const priority = input.priority.trim();
  return Boolean(
    input.name.trim() &&
    (!priority ||
      (Number.isInteger(Number(priority)) && Number(priority) >= 0)),
  );
}

/** Popover de Scripts: mantém escopo e configuração fora do editor de conteúdo. */
export function CustomCodeQuickEditPopover({
  disabled = false,
  dictionary,
  onSave,
  page,
}: {
  disabled?: boolean;
  dictionary: CustomCodeCopy;
  onSave: (input: CustomCodeQuickEditInput) => Promise<void>;
  page: CustomCodeQuickEditPage;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(page.name);
  const [location, setLocation] = useState<SnippetDto["location"]>(
    page.location,
  );
  const [priority, setPriority] = useState(
    page.priority === null ? "" : String(page.priority),
  );
  const [scopeType, setScopeType] = useState<SnippetDto["scopeType"]>(
    page.scopeType,
  );
  const [pageIds, setPageIds] = useState<string[]>(
    page.scopedPages?.map((scope) => scope.pageId) ?? [],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleOpenChange(nextOpen: boolean) {
    if (!canChangeQuickEditOpen(nextOpen, saving || disabled)) return;
    setOpen(nextOpen);
    if (!nextOpen) return;

    // Descarta tentativas anteriores e relê a normalização exibida pela lista.
    setName(page.name);
    setLocation(page.location);
    setPriority(page.priority === null ? "" : String(page.priority));
    setScopeType(page.scopeType);
    setPageIds(page.scopedPages?.map((scope) => scope.pageId) ?? []);
    setError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    if (!canSubmitCustomCodeQuickEdit({ name, priority })) {
      setError(dictionary.quickEditValidationError);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSave({
        name: name.trim(),
        location,
        priority: priority.trim() ? Number(priority) : null,
        scopeType,
        pageIds: scopeType === "SPECIFIC_PAGES" ? pageIds : [],
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
        aria-label={`${dictionary.quickEdit}: ${page.name}`}
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
              {page.name}
            </p>
          </div>

          <form
            className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-1"
            onSubmit={handleSubmit}
          >
            <label
              className="block space-y-1 text-sm"
              htmlFor={`quick-script-name-${page.id}`}
            >
              <span>{dictionary.name}</span>
              <Input
                autoComplete="off"
                disabled={saving || disabled}
                id={`quick-script-name-${page.id}`}
                maxLength={200}
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>

            <label
              className="block space-y-1 text-sm"
              htmlFor={`quick-script-location-${page.id}`}
            >
              <span>{dictionary.location}</span>
              <div className="relative">
                <select
                  className="border-input bg-card text-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full appearance-none rounded-lg border py-1 pr-8 pl-3 text-sm outline-none focus-visible:ring-3"
                  disabled={saving || disabled}
                  id={`quick-script-location-${page.id}`}
                  required
                  value={location}
                  onChange={(event) =>
                    setLocation(event.target.value as SnippetDto["location"])
                  }
                >
                  <option value="HEADER">{dictionary.header}</option>
                  <option value="BODY_START">{dictionary.bodyStart}</option>
                  <option value="BODY_END">{dictionary.bodyEnd}</option>
                </select>
                <SelectChevron />
              </div>
            </label>

            <label
              className="block space-y-1 text-sm"
              htmlFor={`quick-script-priority-${page.id}`}
            >
              <span>{dictionary.priority}</span>
              <Input
                disabled={saving || disabled}
                id={`quick-script-priority-${page.id}`}
                inputMode="numeric"
                min="0"
                type="number"
                value={priority}
                onChange={(event) => setPriority(event.target.value)}
              />
            </label>

            <fieldset className="space-y-2 text-sm">
              <legend className="text-foreground font-medium">
                {dictionary.scope}
              </legend>
              <label className="flex items-center gap-2">
                <input
                  checked={scopeType === "ALL_PAGES"}
                  disabled={saving || disabled}
                  name={`quick-script-scope-${page.id}`}
                  type="radio"
                  onChange={() => setScopeType("ALL_PAGES")}
                />
                {dictionary.allPages}
              </label>
              <label className="flex items-center gap-2">
                <input
                  checked={scopeType === "SPECIFIC_PAGES"}
                  disabled={saving || disabled}
                  name={`quick-script-scope-${page.id}`}
                  type="radio"
                  onChange={() => setScopeType("SPECIFIC_PAGES")}
                />
                {dictionary.specificPages}
              </label>
            </fieldset>

            {scopeType === "SPECIFIC_PAGES" ? (
              <CustomCodeScopeSelector
                disabled={saving || disabled}
                dictionary={dictionary}
                pageIds={pageIds}
                onChange={setPageIds}
              />
            ) : null}

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
