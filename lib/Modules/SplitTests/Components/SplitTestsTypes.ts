import type { PanelDictionary } from "@/lib/i18n/panel";

/** Textos localizados compartilhados pela lista e pelo editor de Split Tests. */
export type SplitTestsCopy = PanelDictionary["splitTests"];

/** Destino retornado pela API com métricas calculadas para exibição. */
export type DestinationDto = {
  id: string;
  url: string;
  label: string | null;
  status: "ACTIVE" | "PAUSED";
  sortOrder: number;
  hitCount: number;
  theoreticalWeight: number;
  realPercent: number | null;
};

export type CampaignAuthor = { id: string; name: string } | null;

/** Resumo de campanha usado pela listagem e pela lixeira. */
export type CampaignListItem = {
  id: string;
  name: string;
  slug: string;
  status: "ACTIVE" | "PAUSED";
  author: CampaignAuthor;
  activeDestinationCount: number;
  totalHits: number;
  deletedAt?: string | null;
  deletedBy?: CampaignAuthor;
  createdAt: string;
  updatedAt: string;
};

/** Campanha completa usada pelo editor e pelas mutações de destino. */
export type CampaignDetail = {
  id: string;
  name: string;
  slug: string;
  status: "ACTIVE" | "PAUSED";
  author: CampaignAuthor;
  totalHits: number;
  destinations: DestinationDto[];
  createdAt: string;
  updatedAt: string;
};
