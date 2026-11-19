/**
 * Campos fora do código que o Restaurar troca (spec F6/F7, critério C3).
 *
 * O diff de código cobre `content`; todo OUTRO campo do snapshot que difere entre o estado
 * atual do editor e a versão selecionada aparece aqui como "valor atual → valor da versão",
 * com texto legível. A mesma lista alimenta a barra de comparação ("Outros campos que mudam")
 * e a confirmação de restaurar, então o usuário nunca confirma um campo que não viu.
 *
 * Seções deste arquivo:
 *   1. Tipos públicos (`RevisionFieldChange`, entradas de Pages e de Scripts).
 *   2. Apoios de normalização e formatação.
 *   3. `pageFieldChanges`: nome, slug, pasta, SEO.
 *   4. `scriptFieldChanges`: nome, local, prioridade, escopo, páginas, gatilho e limites.
 *
 * Pura (sem React nem rede): dados que dependem do editor (pasta por caminho, páginas por
 * nome) entram por resolvers. O comparador usa chaves canônicas (não o texto exibido), então
 * duas versões diferentes nunca somem por serem exibidas igual.
 */

import type { PanelDictionary } from "@/lib/i18n/panel";
import type {
  PageSnapshot,
  SnippetSnapshot,
} from "@/lib/Modules/Revisions/Types";

/* -------------------------------------------------------------------------- */
/* 1. Tipos públicos                                                           */
/* -------------------------------------------------------------------------- */

type RevisionsCopy = PanelDictionary["revisions"];

/** Chave do campo = chave de `revisions.fields` (rótulo no dicionário). */
export type RevisionFieldKey = keyof RevisionsCopy["fields"];

/** Textos que o comparador usa: rótulos dos campos e o valor "(vazio)". */
export type RevisionFieldCopy = Pick<RevisionsCopy, "fields" | "fieldEmpty">;

/** Um campo que muda ao restaurar; `current` e `next` já são texto pronto para exibir. */
export type RevisionFieldChange = {
  field: RevisionFieldKey;
  label: string;
  /** Valor no editor agora. */
  current: string;
  /** Valor na versão selecionada (o que passa a valer ao restaurar). */
  next: string;
};

/** Campos de Pages fora do código. O editor monta `current` com o que está na tela. */
export type PageFieldValues = Omit<PageSnapshot, "content">;

/** Campos de Scripts fora do código. O editor monta `current` com o que está na tela. */
export type ScriptFieldValues = Omit<SnippetSnapshot, "content">;

/** Rótulos de enum de Scripts, reaproveitados de `customCode.*` (sem duplicar texto). */
export type ScriptEnumLabels = Pick<
  PanelDictionary["customCode"],
  | "header"
  | "bodyStart"
  | "bodyEnd"
  | "allPages"
  | "specificPages"
  | "triggerNone"
  | "triggerSelectorEvent"
  | "triggerPageLoad"
  | "triggerScroll"
  | "triggerReferrer"
  | "triggerEventClick"
  | "triggerEventSubmit"
  | "triggerDelayLabel"
  | "triggerPercentageLabel"
  | "triggerReferrerLabel"
>;

/* -------------------------------------------------------------------------- */
/* 2. Normalização e formatação                                                */
/* -------------------------------------------------------------------------- */

/** Valor comparável: `key` decide se mudou, `text` é o que o usuário lê ("" = vazio). */
type FieldValue = { key: string; text: string };

/** Texto livre: o servidor guarda aparado e sem diferenciar "" de null (SEO opcional). */
function plainText(value: string | null | undefined): FieldValue {
  const text = (value ?? "").trim();
  return { key: text, text };
}

function plainNumber(value: number | null | undefined): FieldValue {
  const text = value === null || value === undefined ? "" : String(value);
  return { key: text, text };
}

/** JSON com chaves ordenadas: o mesmo objeto em outra ordem de chaves não conta como mudança. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => left.localeCompare(right),
    );
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Monta a mudança só quando as chaves diferem; vazio vira o texto "(vazio)". */
function diffField(
  copy: RevisionFieldCopy,
  field: RevisionFieldKey,
  current: FieldValue,
  next: FieldValue,
): RevisionFieldChange | null {
  if (current.key === next.key) return null;
  return {
    field,
    label: copy.fields[field],
    current: current.text || copy.fieldEmpty,
    next: next.text || copy.fieldEmpty,
  };
}

/** Descarta os campos que não mudaram, preservando a ordem da spec. */
function collect(
  changes: Array<RevisionFieldChange | null>,
): RevisionFieldChange[] {
  return changes.filter((change): change is RevisionFieldChange => !!change);
}

/* -------------------------------------------------------------------------- */
/* 3. Pages                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Campos de Pages que mudam ao restaurar `version` sobre `current` (sem o código).
 * Ordem da spec: nome, slug, pasta, título, descrição e palavra-chave de SEO.
 *
 * `folderLabel` devolve o caminho legível da pasta (o editor já tem `folders`). Pasta que
 * não resolve (excluída depois da versão) aparece pelo próprio id: é a única informação
 * honesta que sobra, e o servidor recusa o restaurar nesse caso.
 */
export function pageFieldChanges({
  copy,
  current,
  version,
  folderLabel,
}: {
  copy: RevisionFieldCopy;
  current: PageFieldValues;
  version: PageFieldValues;
  folderLabel?: (folderId: string) => string | undefined;
}): RevisionFieldChange[] {
  const folder = (folderId: string): FieldValue => ({
    key: folderId,
    text: folderId ? (folderLabel?.(folderId) ?? folderId) : "",
  });

  return collect([
    diffField(copy, "name", plainText(current.title), plainText(version.title)),
    diffField(copy, "slug", plainText(current.slug), plainText(version.slug)),
    diffField(
      copy,
      "folder",
      folder(current.folderId),
      folder(version.folderId),
    ),
    diffField(
      copy,
      "seoTitle",
      plainText(current.seoTitle),
      plainText(version.seoTitle),
    ),
    diffField(
      copy,
      "seoDescription",
      plainText(current.seoDescription),
      plainText(version.seoDescription),
    ),
    diffField(
      copy,
      "seoKeyword",
      plainText(current.seoKeyword),
      plainText(version.seoKeyword),
    ),
  ]);
}

/* -------------------------------------------------------------------------- */
/* 4. Scripts                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Campos de Scripts que mudam ao restaurar `version` sobre `current` (sem o código).
 * Ordem da spec: nome, local de injeção, prioridade, escopo, páginas do escopo, gatilho,
 * configuração do gatilho, máximo de exibições e dias para reiniciar a contagem.
 *
 * `pageName` devolve o nome da página do escopo (T4 resolve por `?ids=`); sem resolução
 * aparece o id. Páginas são comparadas como conjunto e exibidas em ordem alfabética.
 */
export function scriptFieldChanges({
  copy,
  labels,
  current,
  version,
  pageName,
}: {
  copy: RevisionFieldCopy;
  labels: ScriptEnumLabels;
  current: ScriptFieldValues;
  version: ScriptFieldValues;
  pageName?: (pageId: string) => string | undefined;
}): RevisionFieldChange[] {
  const location = (value: ScriptFieldValues["location"]): FieldValue => ({
    key: value,
    text:
      value === "HEADER"
        ? labels.header
        : value === "BODY_START"
          ? labels.bodyStart
          : labels.bodyEnd,
  });

  const scope = (value: ScriptFieldValues["scopeType"]): FieldValue => ({
    key: value,
    text: value === "ALL_PAGES" ? labels.allPages : labels.specificPages,
  });

  const pages = (pageIds: readonly string[]): FieldValue => {
    const unique = [...new Set(pageIds)];
    return {
      key: canonicalJson([...unique].sort()),
      text: unique
        .map((id) => pageName?.(id) ?? id)
        .sort((left, right) => left.localeCompare(right))
        .join(", "),
    };
  };

  const trigger = (value: ScriptFieldValues["triggerType"]): FieldValue => {
    if (value === null) return { key: "", text: labels.triggerNone };
    return {
      key: value,
      text:
        value === "SELECTOR_EVENT"
          ? labels.triggerSelectorEvent
          : value === "PAGE_LOAD"
            ? labels.triggerPageLoad
            : value === "SCROLL"
              ? labels.triggerScroll
              : labels.triggerReferrer,
    };
  };

  const triggerConfig = (
    value: ScriptFieldValues["triggerConfig"],
  ): FieldValue => {
    if (!value) return { key: "", text: "" };
    // O formato do objeto já diz qual gatilho é; não depende do `triggerType` ao lado.
    const text =
      "selector" in value
        ? `${value.selector} · ${
            value.event === "submit"
              ? labels.triggerEventSubmit
              : labels.triggerEventClick
          }`
        : "delaySeconds" in value
          ? `${labels.triggerDelayLabel}: ${value.delaySeconds}`
          : "percentage" in value
            ? `${labels.triggerPercentageLabel}: ${value.percentage}`
            : `${labels.triggerReferrerLabel}: ${value.matches}`;
    return { key: canonicalJson(value), text };
  };

  return collect([
    diffField(copy, "name", plainText(current.name), plainText(version.name)),
    diffField(
      copy,
      "location",
      location(current.location),
      location(version.location),
    ),
    diffField(
      copy,
      "priority",
      plainNumber(current.priority),
      plainNumber(version.priority),
    ),
    diffField(
      copy,
      "scope",
      scope(current.scopeType),
      scope(version.scopeType),
    ),
    diffField(
      copy,
      "scopedPages",
      pages(current.pageIds),
      pages(version.pageIds),
    ),
    diffField(
      copy,
      "trigger",
      trigger(current.triggerType),
      trigger(version.triggerType),
    ),
    diffField(
      copy,
      "triggerConfig",
      triggerConfig(current.triggerConfig),
      triggerConfig(version.triggerConfig),
    ),
    diffField(
      copy,
      "maxDisplays",
      plainNumber(current.maxDisplays),
      plainNumber(version.maxDisplays),
    ),
    diffField(
      copy,
      "displayResetDays",
      plainNumber(current.displayResetDays),
      plainNumber(version.displayResetDays),
    ),
  ]);
}
