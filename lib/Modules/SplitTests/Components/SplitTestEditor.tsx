"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Copy, Trash2 } from "lucide-react";

import { ConfirmDialog } from "@/components/Shared/ConfirmDialog";
import { SplitTestDestinations } from "@/lib/Modules/SplitTests/Components/SplitTestDestinations";
import { DetailsPanel } from "@/components/Shared/DetailsPanel";
import { RequiredMark } from "@/components/Shared/RequiredMark";
import { StatusToggle } from "@/components/Shared/StatusToggle";
import { useDismissibleNotice } from "@/components/Shared/useDismissibleNotice";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  CampaignDetail,
  SplitTestsCopy,
} from "@/lib/Modules/SplitTests/Components/SplitTestsTypes";
import { campaignPublicPath } from "@/lib/Modules/SplitTests/constants";
import { normalizeSlug } from "@/lib/Modules/SplitTests/slug";
import { requestJson, type ApiError } from "@/lib/requestJson";
import { cn } from "@/lib/utils";

/** Chrome compartilhado pela ação compacta de copiar a URL pública. */
const iconBtn =
  "inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground disabled:opacity-40";

/** Formata metadados da campanha e mantém uma saída neutra para valores inválidos. */
function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

/** Mantém o formulário e o ciclo de vida de uma campanha sem assumir a seleção de rota. */
export function SplitTestEditor({
  dictionary,
  campaignId,
  justCreated = false,
  publicOrigin,
}: {
  dictionary: SplitTestsCopy;
  campaignId: string;
  justCreated?: boolean;
  publicOrigin: string;
}) {
  const router = useRouter();
  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugDirty, setSlugDirty] = useState(false);
  const [status, setStatus] = useState<"ACTIVE" | "PAUSED">("ACTIVE");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Sucesso some sozinho; erro fica fixo.
  const {
    notice: message,
    show: showMessage,
    clear: clearMessage,
  } = useDismissibleNotice();
  const [deleteCampaignOpen, setDeleteCampaignOpen] = useState(false);
  // O parâmetro só sinaliza a primeira chegada; a URL é limpa para o refresh não repetir o diálogo.
  const [activationPromptOpen, setActivationPromptOpen] = useState(justCreated);

  /**
   * Única carga da campanha (GET `/api/admin/split-tests/<id>`): serve à montagem do editor e ao
   * "Tentar de novo" e hidrata campanha e formulário a partir do snapshot atual da API.
   * `isCurrent` descarta a resposta de um chamador que já não vale; o padrão (sempre vale) é o do
   * retry, que só existe com a tela de erro aberta, sem outra carga em voo. Mesmo padrão do
   * `CustomCodeEditor`.
   */
  const load = useCallback(
    async (isCurrent: () => boolean = () => true) => {
      setLoading(true);
      setError(null);
      try {
        const result = await requestJson<{ campaign: CampaignDetail }>(
          `/api/admin/split-tests/${campaignId}`,
        );
        if (!isCurrent()) return;
        setCampaign(result.campaign);
        setName(result.campaign.name);
        setSlug(result.campaign.slug);
        setStatus(result.campaign.status);
        setSlugDirty(true);
      } catch (loadError) {
        if (!isCurrent()) return;
        setError((loadError as ApiError).message || dictionary.error);
      } finally {
        if (isCurrent()) setLoading(false);
      }
    },
    [campaignId, dictionary.error],
  );

  // Carga inicial. Strict Mode monta, desmonta e remonta o effect: a chamada fica num microtask
  // e só sai se o cleanup ainda não rodou, então a rede vê um único pedido, e `active` descarta
  // a resposta de uma montagem antiga (ou de outra campanha) pra não sobrescrever o form. A
  // chamada fora do corpo síncrono do effect também atende o eslint (sem setState síncrono no
  // body do effect).
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void load(() => active);
    });
    return () => {
      active = false;
    };
  }, [load]);

  useEffect(() => {
    if (!justCreated) return;
    router.replace(`/admin/split-tests/${campaignId}`);
  }, [campaignId, justCreated, router]);

  const publicUrl = campaign
    ? `${publicOrigin.replace(/\/$/, "")}${campaignPublicPath(campaign.slug)}`
    : "";

  /** Persiste campos e, quando solicitado, a transição de status no mesmo PATCH. */
  const saveCampaign = async (nextStatus?: "ACTIVE" | "PAUSED") => {
    setSaving(true);
    setError(null);
    clearMessage();
    try {
      const result = await requestJson<{ campaign: CampaignDetail }>(
        `/api/admin/split-tests/${campaignId}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            name,
            slug,
            status: nextStatus ?? status,
          }),
        },
      );
      setCampaign(result.campaign);
      setName(result.campaign.name);
      setSlug(result.campaign.slug);
      setStatus(result.campaign.status);
      showMessage(dictionary.saved);
      if (nextStatus === "ACTIVE") setActivationPromptOpen(false);
    } catch (saveError) {
      setError((saveError as ApiError).message || dictionary.error);
    } finally {
      setSaving(false);
    }
  };

  /** Copia a URL pública e mantém falhas de clipboard visíveis no editor. */
  const copyEditorUrl = async () => {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      showMessage(dictionary.copied);
    } catch {
      setError(dictionary.error);
    }
  };

  /** Persiste o próximo status; a UI só muda após a confirmação do servidor. */
  const toggleCampaignStatus = async () => {
    const next = status === "ACTIVE" ? "PAUSED" : "ACTIVE";
    await saveCampaign(next);
  };

  if (loading) {
    return (
      <p className="text-muted-foreground p-6 text-sm">{dictionary.loading}</p>
    );
  }

  if (!campaign) {
    return (
      // Falha da carga: erro + "Tentar de novo" (refaz a carga única) + volta para a lista.
      <div className="space-y-3 p-6">
        <p className="text-destructive text-sm" role="alert">
          {error ?? dictionary.error}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => void load()}>
            {dictionary.retry}
          </Button>
          <Link
            className={buttonVariants({ variant: "outline" })}
            href="/admin/split-tests"
          >
            {dictionary.back}
          </Link>
        </div>
      </div>
    );
  }

  // Coluna Details: só Name/Slug + meta — New Destination foi pra linha final da lista.
  const details = (
    <>
      <label className="block space-y-1 text-sm" htmlFor="split-campaign-name">
        <span className="flex items-center gap-0.5">
          {dictionary.name}
          <RequiredMark />
        </span>
        <Input
          className="h-9 rounded-lg"
          id="split-campaign-name"
          value={name}
          onChange={(event) => {
            const value = event.target.value;
            setName(value);
            if (!slugDirty) setSlug(normalizeSlug(value));
          }}
        />
      </label>

      <label className="block space-y-1 text-sm" htmlFor="split-campaign-slug">
        <span className="flex items-center gap-0.5">
          {dictionary.slug}
          <RequiredMark />
        </span>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground shrink-0 font-mono text-xs">
            /s/
          </span>
          <Input
            className="h-9 rounded-lg"
            id="split-campaign-slug"
            value={slug}
            onChange={(event) => {
              setSlugDirty(true);
              setSlug(event.target.value);
            }}
          />
        </div>
      </label>

      <dl className="text-muted-foreground border-border mt-auto space-y-1.5 border-t pt-4 text-xs">
        <div className="flex justify-between gap-2">
          <dt>{dictionary.createdAtLabel}:</dt>
          <dd className="text-foreground tabular-nums">
            {formatDate(campaign.createdAt)}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>{dictionary.updatedAtLabel}:</dt>
          <dd className="text-foreground tabular-nums">
            {formatDate(campaign.updatedAt)}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>{dictionary.author}:</dt>
          <dd className="text-foreground">{campaign.author?.name ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>{dictionary.totalHits}:</dt>
          <dd className="text-foreground tabular-nums">
            {campaign.totalHits.toLocaleString()}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt>{dictionary.publicUrl}:</dt>
          <dd className="text-foreground flex max-w-[12rem] min-w-0 items-center gap-1">
            <span className="truncate font-mono text-[10px]" title={publicUrl}>
              {campaignPublicPath(campaign.slug)}
            </span>
            <button
              aria-label={dictionary.copyUrl}
              className={cn(iconBtn, "size-6 shrink-0")}
              type="button"
              onClick={() => void copyEditorUrl()}
            >
              <Copy className="size-3.5" />
            </button>
          </dd>
        </div>
      </dl>
    </>
  );

  return (
    // Layout Figma SplitTests EDIT: header + DetailsPanel + tabela de destinos. Abaixo de lg a
    // seção inteira rola (Details em faixa + destinos, uma rolagem natural, ver `DetailsPanel
    // flowOnMobile`); de lg em diante ocupa a altura e só as colunas rolam. Mesmo contrato dos
    // editores de Pages e Scripts.
    <section className="flex h-full min-h-0 w-full flex-1 flex-col gap-3 overflow-y-auto px-4 py-4 md:px-8 md:py-5 lg:overflow-hidden xl:px-10">
      <div className="flex shrink-0 flex-col gap-2">
        <Link
          className="text-muted-foreground w-fit text-xs hover:underline"
          href="/admin/split-tests"
        >
          ← {dictionary.back}
        </Link>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2.5 sm:gap-3">
            <Button
              disabled={saving}
              size="sm"
              type="button"
              variant="outline"
              onClick={() => void saveCampaign()}
            >
              {saving ? dictionary.working : dictionary.save}
            </Button>

            <h1 className="text-foreground min-w-0 truncate text-xl font-medium tracking-tight md:text-2xl">
              {name || campaign.name}
            </h1>

            <StatusToggle
              appearance="switch"
              busy={saving}
              draftLabel={dictionary.draft}
              published={status === "ACTIVE"}
              publishedLabel={dictionary.published}
              publishLabel={dictionary.publish}
              unpublishLabel={dictionary.unpublish}
              onToggle={() => void toggleCampaignStatus()}
            />
          </div>

          <Button
            className="bg-destructive hover:bg-destructive/90 text-white"
            disabled={saving}
            size="sm"
            type="button"
            variant="destructive"
            onClick={() => setDeleteCampaignOpen(true)}
          >
            <Trash2 className="size-3.5" />
            {dictionary.delete}
          </Button>
        </div>
      </div>

      {error ? (
        <div
          className="border-destructive/40 bg-destructive/10 text-destructive shrink-0 rounded-lg border px-3 py-2 text-sm"
          role="alert"
        >
          {error}
        </div>
      ) : null}
      {message ? (
        <div
          className="border-primary/30 bg-primary/5 text-primary shrink-0 rounded-lg border px-3 py-2 text-sm"
          role="status"
        >
          {message}
        </div>
      ) : null}

      {/* Sem `className`: `flowOnMobile` já devolve `lg:h-full lg:min-h-0 lg:flex-1` e, abaixo de
          lg, o painel cresce com o conteúdo (um `flex-1` aqui disputaria a altura com ele). */}
      <DetailsPanel details={details} flowOnMobile>
        <SplitTestDestinations
          busy={saving}
          campaign={campaign}
          campaignId={campaignId}
          dictionary={dictionary}
          onBusyChange={setSaving}
          onCampaignChange={setCampaign}
          onError={setError}
          onSaved={() => showMessage(dictionary.saved)}
        />
      </DetailsPanel>

      <ConfirmDialog
        open={activationPromptOpen}
        title={dictionary.activationPrompt.title}
        description={dictionary.activationPrompt.description}
        confirmLabel={dictionary.publish}
        cancelLabel={dictionary.activationPrompt.keepDraft}
        closeLabel={dictionary.close}
        busy={saving}
        onOpenChange={(open) => {
          if (!open && !saving) setActivationPromptOpen(false);
        }}
        onConfirm={() => void saveCampaign("ACTIVE")}
      />

      <ConfirmDialog
        open={deleteCampaignOpen}
        title={dictionary.confirmTrashTitle}
        description={dictionary.confirmTrashDescription}
        confirmLabel={dictionary.moveToTrash}
        cancelLabel={dictionary.cancel}
        closeLabel={dictionary.close}
        destructive
        busy={saving}
        onOpenChange={(open) => {
          if (!open) setDeleteCampaignOpen(false);
        }}
        onConfirm={async () => {
          setSaving(true);
          try {
            await requestJson(`/api/admin/split-tests/${campaignId}`, {
              method: "DELETE",
            });
            router.push("/admin/split-tests");
          } catch (deleteError) {
            setError((deleteError as ApiError).message || dictionary.error);
            setSaving(false);
          }
        }}
      />
    </section>
  );
}
