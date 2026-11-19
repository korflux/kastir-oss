"use client";

import { CustomCodeEditor } from "@/lib/Modules/CustomCode/Components/CustomCodeEditor";
import { CustomCodeList } from "@/lib/Modules/CustomCode/Components/CustomCodeList";
import type { CustomCodeCopy } from "@/lib/Modules/CustomCode/Components/CustomCodeTypes";
import type { PanelFormatSettings } from "@/lib/Modules/Settings/format";
import type { PanelDictionary } from "@/lib/i18n/panel";

/**
 * Compõe a tela de Código customizado sem misturar a listagem com o fluxo de edição.
 * `revisionRetentionLimit`, `formatSettings` e `locale` só servem ao editor (contador do
 * histórico de versões e formato de data e hora); a listagem ignora.
 */
export function CustomCodeWorkspace({
  canBulk,
  bulkDictionary,
  dictionary,
  revisions,
  snippetId,
  revisionRetentionLimit,
  formatSettings,
  locale,
}: {
  canBulk: boolean;
  bulkDictionary: PanelDictionary["bulk"];
  dictionary: CustomCodeCopy;
  revisions: PanelDictionary["revisions"];
  snippetId?: string;
  revisionRetentionLimit?: number;
  formatSettings?: PanelFormatSettings;
  locale?: string;
}) {
  return snippetId ? (
    <CustomCodeEditor
      dictionary={dictionary}
      formatSettings={formatSettings}
      locale={locale}
      revisionRetentionLimit={revisionRetentionLimit}
      revisions={revisions}
      snippetId={snippetId}
    />
  ) : (
    <CustomCodeList
      bulkDictionary={bulkDictionary}
      canBulk={canBulk}
      dictionary={dictionary}
    />
  );
}
