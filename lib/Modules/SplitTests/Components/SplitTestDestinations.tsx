"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from "lucide-react";

import { ConfirmDialog } from "@/components/Shared/ConfirmDialog";
import { StatusToggle } from "@/components/Shared/StatusToggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  CampaignDetail,
  DestinationDto,
  SplitTestsCopy,
} from "@/lib/Modules/SplitTests/Components/SplitTestsTypes";
import { requestJson, type ApiError } from "@/lib/requestJson";
import { cn } from "@/lib/utils";

/** Chrome compartilhado pelas ações compactas de destino. */
const iconBtn =
  "inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground disabled:opacity-40";

/**
 * Grades das linhas da tabela de destinos (cabeçalho, destinos e "adicionar"), uma única fonte
 * para as linhas manterem as mesmas colunas. O ponto de corte é `xl` (1280px): abaixo dele a
 * coluna de destinos tem ~540px em 1024px (com o Details ao lado) e menos nas larguras menores,
 * pouco para a tabela de 7 colunas, então vale o layout compacto/empilhado do mobile (fase 4,
 * spec decisão 11); em 1280px sobram ~783px.
 * - `rowGridCompact`: 4 colunas abaixo de `xl` (ações | nome | URL | lixeira), para linhas só de
 *   leitura.
 * - `rowGridStacked`: 1 coluna abaixo de `xl`, para a linha de adicionar: em 375px quatro
 *   colunas deixavam os inputs com ~22-31px ao lado dos botões, então inputs e botão empilham em
 *   largura útil.
 * - `rowGridWide`: 7 colunas de `xl` em diante, iguais para cabeçalho, leitura e adicionar. Sem
 *   `min-w`: as trilhas mínimas somam ~640px e cabem nos ~783px úteis de 1280px, então a tabela
 *   nunca precisa de rolagem horizontal.
 * - `rowGridEditing`: a linha em edição não participa das 7 colunas (a última tinha 2.5rem e
 *   espremia Salvar/Cancelar). É um formulário de largura total: 1 coluna abaixo de `xl`;
 *   de `xl` em diante, interruptor | Nome | URL na primeira linha (as ações ocupam a linha
 *   inteira, à direita, embaixo).
 */
const rowGridCompact =
  "grid-cols-[minmax(5rem,auto)_minmax(0,1fr)_minmax(0,1fr)_auto]";
const rowGridStacked = "grid-cols-1";
const rowGridWide =
  "xl:grid-cols-[minmax(6.5rem,8rem)_minmax(6rem,1fr)_minmax(8rem,1.3fr)_5.5rem_4.5rem_4rem_2.5rem]";
const rowGridEditing =
  "grid-cols-1 xl:grid-cols-[minmax(6.5rem,8rem)_minmax(0,1fr)_minmax(0,1.3fr)]";

/**
 * Concentra CRUD, status e reordenação dos destinos sem conhecer a rota selecionada.
 *
 * Layout: vive dentro de `DetailsPanel flowOnMobile` (ver `SplitTestEditor`). Duas fronteiras
 * independentes:
 * - altura (`lg`, o ponto em que o Details vira coluna): abaixo de `lg` o bloco declara a própria
 *   altura (a do conteúdo) e deixa o editor rolar; de `lg` em diante preenche a coluna e rola a
 *   lista internamente.
 * - colunas (`xl`): abaixo de `xl` as linhas de leitura são compactas (4 colunas) e as de
 *   adicionar e editar empilham, sem cabeçalho de colunas; de `xl` em diante a tabela tem 7
 *   colunas com cabeçalho (ver as grades acima). A linha em edição é sempre um formulário de
 *   largura total, em qualquer largura.
 */
export function SplitTestDestinations({
  campaign,
  campaignId,
  dictionary,
  busy: saving,
  onBusyChange: setSaving,
  onCampaignChange: setCampaign,
  onError: setError,
  onSaved,
}: {
  campaign: CampaignDetail;
  campaignId: string;
  dictionary: SplitTestsCopy;
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
  onCampaignChange: (campaign: CampaignDetail) => void;
  onError: (message: string | null) => void;
  onSaved: () => void;
}) {
  const [draftUrl, setDraftUrl] = useState("");
  const [draftLabel, setDraftLabel] = useState("");
  const [deleteDestinationId, setDeleteDestinationId] = useState<string | null>(
    null,
  );
  const [editingDestinationId, setEditingDestinationId] = useState<
    string | null
  >(null);
  const [editUrl, setEditUrl] = useState("");
  const [editLabel, setEditLabel] = useState("");
  /** Valida e cria um destino, mantendo a campanha retornada pela API como fonte de verdade. */
  const addDestination = async () => {
    if (!draftLabel.trim() || !draftUrl.trim()) {
      setError(dictionary.destinationRequired);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await requestJson<{ campaign: CampaignDetail }>(
        `/api/admin/split-tests/${campaignId}/destinations`,
        {
          method: "POST",
          body: JSON.stringify({
            url: draftUrl.trim(),
            label: draftLabel.trim(),
          }),
        },
      );
      setCampaign(result.campaign);
      setDraftUrl("");
      setDraftLabel("");
    } catch (addError) {
      setError((addError as ApiError).message || dictionary.error);
    } finally {
      setSaving(false);
    }
  };

  /** Reordena destinos usando os IDs atuais para preservar a concorrência otimista do serviço. */
  const moveDestination = async (destinationId: string, direction: -1 | 1) => {
    if (!campaign) return;
    const ordered = [...campaign.destinations].sort(
      (a, b) => a.sortOrder - b.sortOrder,
    );
    const index = ordered.findIndex((d) => d.id === destinationId);
    const swap = index + direction;
    if (index < 0 || swap < 0 || swap >= ordered.length) return;
    const ids = ordered.map((d) => d.id);
    [ids[index], ids[swap]] = [ids[swap], ids[index]];
    setSaving(true);
    try {
      const result = await requestJson<{ campaign: CampaignDetail }>(
        `/api/admin/split-tests/${campaignId}/destinations`,
        {
          method: "POST",
          body: JSON.stringify({ orderedIds: ids }),
        },
      );
      setCampaign(result.campaign);
    } catch (moveError) {
      setError((moveError as ApiError).message || dictionary.error);
    } finally {
      setSaving(false);
    }
  };

  /** Preenche o formulário inline com os valores atuais do destino escolhido. */
  const startEditDestination = (destination: DestinationDto) => {
    setEditingDestinationId(destination.id);
    setEditUrl(destination.url);
    setEditLabel(destination.label ?? "");
    setError(null);
  };

  /** Persiste a edição inline somente quando URL e rótulo estão preenchidos. */
  const saveDestinationEdit = async () => {
    if (!editingDestinationId || !editUrl.trim() || !editLabel.trim()) {
      setError(dictionary.destinationRequired);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await requestJson<{ campaign: CampaignDetail }>(
        `/api/admin/split-tests/${campaignId}/destinations/${editingDestinationId}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            url: editUrl.trim(),
            label: editLabel.trim(),
          }),
        },
      );
      setCampaign(result.campaign);
      setEditingDestinationId(null);
      onSaved();
    } catch (editError) {
      setError((editError as ApiError).message || dictionary.error);
    } finally {
      setSaving(false);
    }
  };

  /** Alterna o destino sem permitir que a campanha fique sem destino ativo. */
  const toggleDestinationStatus = async (destination: DestinationDto) => {
    const isLastActive =
      destination.status === "ACTIVE" &&
      (campaign?.destinations.filter((d) => d.status === "ACTIVE").length ??
        0) <= 1;
    if (isLastActive) return;

    setSaving(true);
    setError(null);
    try {
      const result = await requestJson<{ campaign: CampaignDetail }>(
        `/api/admin/split-tests/${campaignId}/destinations/${destination.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            status: destination.status === "ACTIVE" ? "PAUSED" : "ACTIVE",
          }),
        },
      );
      setCampaign(result.campaign);
    } catch (toggleError) {
      setError((toggleError as ApiError).message || dictionary.error);
    } finally {
      setSaving(false);
    }
  };

  const activeDestinationCount =
    campaign?.destinations.filter((d) => d.status === "ACTIVE").length ?? 0;

  const orderedDestinations = [...campaign.destinations].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );

  return (
    <>
      {/* Altura própria só de lg em diante (o `DetailsPanel flowOnMobile` não a impõe): abaixo de
          lg a raiz e a rolagem vertical ficam sem limite e quem rola é o editor, sem rolagem
          aninhada nem corte da lista; de lg em diante a lista rola dentro da coluna. */}
      <div className="flex min-w-0 flex-col p-3 md:p-4 lg:h-full lg:min-h-0 lg:flex-1 lg:overflow-hidden">
        <div className="min-w-0 overflow-x-hidden lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          {/* Sem wrapper de rolagem horizontal: as trilhas de `xl` cabem na coluna (ver as grades).
              Cabeçalho só onde a tabela de 7 colunas existe (`xl`); abaixo dele as linhas são
              compactas ou empilhadas e as colunas dispensam rótulo. Colunas Figma: toggle/edit/
              reorder | Page | URL | Theoretical | Real | Hits | lixeira. */}
          <div
            className={cn(
              "text-muted-foreground mb-1 hidden gap-2 px-1 text-sm xl:grid",
              rowGridWide,
            )}
            role="row"
          >
            <div role="columnheader" />
            <div role="columnheader">{dictionary.pageColumn}</div>
            <div role="columnheader">{dictionary.urlColumn}</div>
            <div role="columnheader">{dictionary.theoretical}</div>
            <div role="columnheader">{dictionary.real}</div>
            <div role="columnheader">{dictionary.hits}</div>
            <div role="columnheader" />
          </div>
          <div className="divide-border divide-y" role="rowgroup">
            {orderedDestinations.map((destination, index) => {
              const isEditing = editingDestinationId === destination.id;
              const isLastActive =
                destination.status === "ACTIVE" && activeDestinationCount <= 1;
              const active = destination.status === "ACTIVE";
              return (
                <div
                  className={cn(
                    "grid items-center gap-2 py-3",
                    // Editando, em qualquer largura: formulário de largura total (inputs em
                    // largura útil e Salvar/Cancelar embaixo). Leitura: 4 colunas, 7 de `xl`.
                    isEditing
                      ? rowGridEditing
                      : cn(rowGridCompact, rowGridWide),
                  )}
                  key={destination.id}
                  role="row"
                >
                  <div
                    className="flex min-w-0 flex-wrap items-center gap-0.5"
                    role="cell"
                  >
                    <StatusToggle
                      appearance="switch"
                      busy={saving}
                      draftLabel=""
                      published={active}
                      publishedLabel=""
                      publishLabel={dictionary.activateDestination}
                      unpublishLabel={
                        isLastActive
                          ? dictionary.cannotPauseLastActive
                          : dictionary.pauseDestination
                      }
                      onToggle={() => {
                        // Regra: não pausar o último destino ativo (só no-op + aria).
                        if (!isLastActive)
                          void toggleDestinationStatus(destination);
                      }}
                    />
                    {isEditing ? null : (
                      <>
                        <button
                          aria-label={dictionary.editDestination}
                          className={iconBtn}
                          disabled={saving}
                          type="button"
                          onClick={() => startEditDestination(destination)}
                        >
                          <Pencil className="size-4" />
                        </button>
                        <div className="flex flex-col">
                          <button
                            aria-label={dictionary.moveUp}
                            className={cn(iconBtn, "size-6")}
                            disabled={saving || index === 0}
                            type="button"
                            onClick={() =>
                              void moveDestination(destination.id, -1)
                            }
                          >
                            <ChevronUp className="size-3.5" />
                          </button>
                          <button
                            aria-label={dictionary.moveDown}
                            className={cn(iconBtn, "size-6")}
                            disabled={
                              saving || index >= orderedDestinations.length - 1
                            }
                            type="button"
                            onClick={() =>
                              void moveDestination(destination.id, 1)
                            }
                          >
                            <ChevronDown className="size-3.5" />
                          </button>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="min-w-0" role="cell">
                    {isEditing ? (
                      <Input
                        aria-label={dictionary.destinationLabel}
                        className="h-8 rounded-lg"
                        value={editLabel}
                        onChange={(event) => setEditLabel(event.target.value)}
                      />
                    ) : (
                      <span className="block truncate font-medium">
                        {destination.label || "—"}
                      </span>
                    )}
                  </div>

                  <div className="min-w-0" role="cell">
                    {isEditing ? (
                      <Input
                        aria-label={dictionary.destinationUrl}
                        className="h-8 rounded-lg"
                        value={editUrl}
                        onChange={(event) => setEditUrl(event.target.value)}
                      />
                    ) : (
                      <span className="text-muted-foreground block truncate text-sm">
                        {destination.url}
                      </span>
                    )}
                  </div>

                  {/* Métricas só existem na leitura de `xl` em diante; na edição a linha
                        é formulário e não tem essas colunas. */}
                  {isEditing ? null : (
                    <>
                      <div
                        className="text-muted-foreground hidden text-sm tabular-nums xl:block"
                        role="cell"
                      >
                        {destination.theoreticalWeight}%
                      </div>
                      <div
                        className="text-muted-foreground hidden text-sm tabular-nums xl:block"
                        role="cell"
                      >
                        {destination.realPercent === null
                          ? "—"
                          : `${destination.realPercent.toFixed(0)}%`}
                      </div>
                      <div
                        className="text-muted-foreground hidden text-sm tabular-nums xl:block"
                        role="cell"
                      >
                        {destination.hitCount.toLocaleString()}
                      </div>
                    </>
                  )}

                  <div
                    className={cn(
                      "flex min-w-0 flex-wrap justify-end",
                      // Editando: ocupa a linha inteira (embaixo, à direita), nunca a última
                      // trilha de 2.5rem da tabela.
                      isEditing ? "col-span-full gap-2" : "gap-0.5",
                    )}
                    role="cell"
                  >
                    {isEditing ? (
                      <>
                        <Button
                          disabled={saving}
                          size="sm"
                          type="button"
                          onClick={() => void saveDestinationEdit()}
                        >
                          {dictionary.saveDestination}
                        </Button>
                        <Button
                          disabled={saving}
                          size="sm"
                          type="button"
                          variant="outline"
                          onClick={() => setEditingDestinationId(null)}
                        >
                          {dictionary.cancel}
                        </Button>
                      </>
                    ) : (
                      <button
                        aria-label={dictionary.removeDestination}
                        className={cn(
                          iconBtn,
                          "text-destructive hover:text-destructive",
                        )}
                        disabled={saving || campaign.destinations.length <= 1}
                        type="button"
                        onClick={() => setDeleteDestinationId(destination.id)}
                      >
                        <Trash2 className="size-[18px]" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Linha final: adicionar destino (substitui o bloco do Details). */}
            <div
              className={cn(
                "grid items-center gap-2 py-3",
                // Abaixo de xl: nome, URL e botão em coluna (a célula vazia só ocupa a 1ª coluna da tabela).
                rowGridStacked,
                rowGridWide,
              )}
              role="row"
            >
              <div className="hidden xl:block" role="cell" />
              <div className="min-w-0" role="cell">
                <Input
                  aria-label={dictionary.destinationLabel}
                  className="h-8 rounded-lg"
                  id="split-dest-name"
                  placeholder={dictionary.destinationLabel}
                  value={draftLabel}
                  onChange={(event) => setDraftLabel(event.target.value)}
                />
              </div>
              <div className="min-w-0" role="cell">
                <Input
                  aria-label={dictionary.destinationUrl}
                  className="h-8 rounded-lg"
                  id="split-dest-url"
                  placeholder={dictionary.destinationUrl}
                  value={draftUrl}
                  onChange={(event) => setDraftUrl(event.target.value)}
                />
              </div>
              <div className="hidden xl:block" role="cell" />
              <div className="hidden xl:block" role="cell" />
              <div className="hidden xl:block" role="cell" />
              <div className="flex justify-end" role="cell">
                <Button
                  disabled={saving}
                  size="sm"
                  type="button"
                  variant="outline"
                  onClick={() => void addDestination()}
                >
                  <Plus className="text-brand size-3.5" />
                  {dictionary.addDestination}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={deleteDestinationId !== null}
        title={dictionary.confirmDeleteDestinationTitle}
        description={dictionary.confirmDeleteDestinationDescription}
        confirmLabel={dictionary.confirm}
        cancelLabel={dictionary.cancel}
        closeLabel={dictionary.close}
        destructive
        busy={saving}
        onOpenChange={(open) => {
          if (!open) setDeleteDestinationId(null);
        }}
        onConfirm={async () => {
          if (!deleteDestinationId) return;
          setSaving(true);
          try {
            const result = await requestJson<{ campaign: CampaignDetail }>(
              `/api/admin/split-tests/${campaignId}/destinations/${deleteDestinationId}`,
              { method: "DELETE" },
            );
            setCampaign(result.campaign);
            setDeleteDestinationId(null);
          } catch (deleteError) {
            setError((deleteError as ApiError).message || dictionary.error);
          } finally {
            setSaving(false);
          }
        }}
      />
    </>
  );
}
