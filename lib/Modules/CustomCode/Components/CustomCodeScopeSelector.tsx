"use client";

import { useCallback, useEffect, useId, useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type {
  CustomCodeCopy,
  PageDto,
} from "@/lib/Modules/CustomCode/Components/CustomCodeTypes";
import { BULK_IDS_MAX } from "@/lib/Modules/Shared/BulkConstants";
import { requestJson, type ApiError } from "@/lib/requestJson";
import { cn } from "@/lib/utils";

const SCOPE_PAGE_SIZE = 25;

/**
 * Resolve páginas do escopo por id (`GET /api/admin/custom-code/pages?ids=`), no mesmo DTO da
 * lista. Fonte única para quem precisa do NOME de uma página que não está na lista carregada:
 * este seletor (páginas já selecionadas) e a comparação de versões do editor. Pede em lotes do
 * limite da rota. Página excluída ou na lixeira não volta: o chamador mostra o rótulo
 * `pageUnavailable` para o id sem resultado.
 */
export async function fetchScopePagesByIds(
  ids: readonly string[],
): Promise<Record<string, PageDto>> {
  const unique = [...new Set(ids)];
  const batches: string[][] = [];
  for (let index = 0; index < unique.length; index += BULK_IDS_MAX) {
    batches.push(unique.slice(index, index + BULK_IDS_MAX));
  }
  const results = await Promise.all(
    batches.map((batch) =>
      requestJson<{ items: PageDto[] }>(
        `/api/admin/custom-code/pages?ids=${batch.map(encodeURIComponent).join(",")}`,
      ),
    ),
  );
  const found: Record<string, PageDto> = {};
  for (const result of results) {
    for (const item of result.items) found[item.id] = item;
  }
  return found;
}

/** Picker dos seletores detectados no HTML compilado do snippet. */
export function CustomCodeSelectorPicker({
  dictionary,
  snippetId,
  onSelect,
}: {
  dictionary: CustomCodeCopy;
  snippetId: string;
  onSelect: (selector: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selectors, setSelectors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");

  /** Busca seletores somente ao abrir o picker e limpa o filtro anterior. */
  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) return;
    setQuery("");
    setLoading(true);
    void requestJson<{ selectors: string[] }>(
      `/api/admin/custom-code/${snippetId}/selectors`,
    )
      .then((result) => setSelectors(result.selectors))
      .catch(() => setSelectors([]))
      .finally(() => setLoading(false));
  };

  const filtered = selectors.filter((selector) =>
    selector.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      {/* h-9 + secondary: mesma altura do input, contraste de botão (não de campo). */}
      <PopoverTrigger
        className={cn(
          buttonVariants({ variant: "secondary", size: "sm" }),
          "h-9 shrink-0 rounded-lg px-3",
        )}
        type="button"
      >
        {dictionary.chooseSelector}
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-2 p-2">
        <Input
          aria-label={dictionary.searchSelectors}
          placeholder={dictionary.searchSelectors}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="max-h-56 space-y-0.5 overflow-y-auto">
          {loading ? (
            <p className="text-muted-foreground px-2 py-1.5 text-sm">
              {dictionary.loadingSelectors}
            </p>
          ) : filtered.length ? (
            filtered.map((selector) => (
              <button
                className="hover:bg-muted block w-full truncate rounded-lg px-2 py-1.5 text-left text-sm"
                key={selector}
                type="button"
                onClick={() => {
                  onSelect(selector);
                  setOpen(false);
                }}
              >
                {selector}
              </button>
            ))
          ) : (
            <p className="text-muted-foreground px-2 py-1.5 text-sm">
              {dictionary.noSelectorsFound}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Seletor paginado das páginas usadas pelo escopo específico. */
export function CustomCodeScopeSelector({
  disabled = false,
  dictionary,
  pageIds,
  onChange,
}: {
  disabled?: boolean;
  dictionary: CustomCodeCopy;
  pageIds: string[];
  onChange: (ids: string[]) => void;
}) {
  // Dois quick edits podem coexistir no DOM; o id local evita label apontando
  // para o campo de outro popover.
  const pageSearchId = `custom-code-page-search-${useId().replace(/:/g, "")}`;
  const [pages, setPages] = useState<PageDto[]>([]);
  const [selectedMeta, setSelectedMeta] = useState<Record<string, PageDto>>({});
  // Ids já consultados por `ids` (achados ou não): evita repetir a consulta de página excluída.
  const [resolvedIds, setResolvedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [pageSearch, setPageSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  // Começa carregando: a primeira consulta só sai depois do debounce do effect, e sem isso o
  // primeiro frame mostraria "lista vazia" antes de a resposta existir. Vazio só vale com
  // resposta vazia (`loadPages` baixa a flag em sucesso e em erro).
  const [loading, setLoading] = useState(true);
  // A primeira carga da lista terminou (com ou sem erro): só então vale consultar por `ids` o
  // que ela não trouxe, para não pedir o nome de página que a própria lista já entrega.
  const [listLoaded, setListLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Carrega uma página do catálogo preservando metadados dos itens selecionados. */
  const loadPages = useCallback(
    async (nextPage: number, replace: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          page: String(nextPage),
          pageSize: String(SCOPE_PAGE_SIZE),
        });
        if (pageSearch.trim()) params.set("q", pageSearch.trim());
        const result = await requestJson<{
          items: PageDto[];
          total: number;
          page: number;
        }>(`/api/admin/custom-code/pages?${params.toString()}`);
        setTotal(result.total);
        setPage(result.page);
        setPages((current) =>
          replace ? result.items : [...current, ...result.items],
        );
        setSelectedMeta((current) => {
          const next = { ...current };
          for (const item of result.items) next[item.id] = item;
          return next;
        });
      } catch (loadError) {
        setError((loadError as ApiError).message || dictionary.pagesError);
      } finally {
        setLoading(false);
        setListLoaded(true);
      }
    },
    [dictionary.pagesError, pageSearch],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void loadPages(1, true), 200);
    return () => window.clearTimeout(timer);
  }, [loadPages]);

  // Nomes das páginas já selecionadas que não vieram na lista carregada (escopo salvo, busca
  // que as escondeu): uma consulta por `ids`, uma vez por id. Falha de rede cai no próprio id
  // (a única informação honesta) em vez de repetir a consulta ou chamar a página de excluída.
  useEffect(() => {
    if (!listLoaded) return;
    const missing = pageIds.filter(
      (id) => !selectedMeta[id] && !resolvedIds.has(id),
    );
    if (!missing.length) return;
    let active = true;
    fetchScopePagesByIds(missing)
      .catch(() =>
        Object.fromEntries(
          missing.map((id) => [id, { id, title: id, slug: "" }]),
        ),
      )
      .then((found) => {
        if (!active) return;
        setSelectedMeta((current) => ({ ...current, ...found }));
        setResolvedIds((current) => new Set([...current, ...missing]));
      });
    return () => {
      active = false;
    };
  }, [listLoaded, pageIds, resolvedIds, selectedMeta]);

  // Id ainda sem nome mostra reticências; id que a consulta não achou (página excluída ou na
  // lixeira) mostra o rótulo legível, nunca o id cru.
  const selectedOutsideList = pageIds
    .filter((id) => !pages.some((pageItem) => pageItem.id === id))
    .map(
      (id): PageDto =>
        selectedMeta[id] ?? {
          id,
          title: resolvedIds.has(id) ? dictionary.pageUnavailable : "…",
          slug: "",
        },
    );

  const hasMore = pages.length < total;

  return (
    <div className="space-y-3">
      <label className="space-y-1 text-sm" htmlFor={pageSearchId}>
        <span>{dictionary.searchPages}</span>
        {/* maxLength = SCOPE_PAGES_SEARCH_MAX (CustomCode/Schema.ts): a rota recusa `q` maior com 400.
            Valor repetido aqui porque o Schema puxa o parser de HTML para o bundle do cliente. */}
        <Input
          disabled={disabled}
          id={pageSearchId}
          maxLength={200}
          value={pageSearch}
          onChange={(event) => setPageSearch(event.target.value)}
        />
      </label>
      {error ? (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : null}
      {selectedOutsideList.length ? (
        <div className="border-border space-y-2 rounded-lg border p-3">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {dictionary.selectPages}
          </p>
          {selectedOutsideList.map((pageItem) => (
            <label
              className="flex items-start gap-2 text-sm"
              key={`selected-${pageItem.id}`}
            >
              <input
                checked
                disabled={disabled}
                type="checkbox"
                onChange={() =>
                  onChange(
                    pageIds.filter((candidate) => candidate !== pageItem.id),
                  )
                }
              />
              <span>
                <span className="block font-medium">{pageItem.title}</span>
                {pageItem.slug ? (
                  <span className="text-muted-foreground block text-xs">
                    /{pageItem.slug}
                  </span>
                ) : null}
              </span>
            </label>
          ))}
        </div>
      ) : null}
      <div className="border-border max-h-48 space-y-2 overflow-y-auto rounded-lg border p-3 sm:max-h-[28rem]">
        {pages.map((pageItem) => (
          <label className="flex items-start gap-2 text-sm" key={pageItem.id}>
            <input
              checked={pageIds.includes(pageItem.id)}
              disabled={disabled}
              type="checkbox"
              onChange={(event) => {
                onChange(
                  event.target.checked
                    ? [...new Set([...pageIds, pageItem.id])]
                    : pageIds.filter((id) => id !== pageItem.id),
                );
                if (event.target.checked) {
                  setSelectedMeta((current) => ({
                    ...current,
                    [pageItem.id]: pageItem,
                  }));
                }
              }}
            />
            <span>
              <span className="block font-medium">{pageItem.title}</span>
              <span className="text-muted-foreground block text-xs">
                /{pageItem.slug}
              </span>
            </span>
          </label>
        ))}
        {!pages.length && !loading ? (
          <p className="text-muted-foreground text-sm">
            {dictionary.pagesEmpty}
          </p>
        ) : null}
        {loading ? (
          <p className="text-muted-foreground text-sm" role="status">
            {dictionary.pagesLoading}
          </p>
        ) : null}
      </div>
      {hasMore ? (
        <Button
          disabled={loading || disabled}
          size="sm"
          type="button"
          variant="outline"
          onClick={() => void loadPages(page + 1, false)}
        >
          {dictionary.loadMorePages}
        </Button>
      ) : null}
    </div>
  );
}
