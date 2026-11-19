export type SplitCampaignStatus = "ACTIVE" | "PAUSED";
export type SplitDestinationStatus = "ACTIVE" | "PAUSED";

export type SplitTestAction =
  | "SPLIT_CAMPAIGN_CREATED"
  | "SPLIT_CAMPAIGN_UPDATED"
  | "SPLIT_CAMPAIGN_TRASHED"
  | "SPLIT_CAMPAIGN_RESTORED"
  | "SPLIT_CAMPAIGN_PERMANENTLY_DELETED"
  | "SPLIT_CAMPAIGN_DELETED"
  | "SPLIT_DESTINATION_CREATED"
  | "SPLIT_DESTINATION_UPDATED"
  | "SPLIT_DESTINATION_DELETED";

export type SplitTestsDomainErrorCode =
  "VALIDATION_ERROR" | "NOT_FOUND" | "CONFLICT" | "INVALID_STATE" | "FORBIDDEN";

export class SplitTestsDomainError extends Error {
  constructor(
    public readonly code: SplitTestsDomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SplitTestsDomainError";
  }
}

export type SplitDestinationRecord = {
  id: string;
  campaignId: string;
  url: string;
  label: string | null;
  status: SplitDestinationStatus;
  sortOrder: number;
  hitCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export type SplitCampaignAuthor = {
  id: string;
  name: string;
};

export type SplitCampaignRecord = {
  id: string;
  name: string;
  slug: string;
  status: SplitCampaignStatus;
  authorId: string;
  author?: SplitCampaignAuthor | null;
  destinations?: SplitDestinationRecord[];
  deletedAt: Date | null;
  /** Quem moveu pra lixeira (último SPLIT_CAMPAIGN_TRASHED). */
  deletedBy?: SplitCampaignAuthor | null;
  createdAt: Date;
  updatedAt: Date;
};

export type SplitDestinationListItem = SplitDestinationRecord & {
  theoreticalWeight: number;
  realPercent: number | null;
};

export type SplitCampaignListItem = {
  id: string;
  name: string;
  slug: string;
  status: SplitCampaignStatus;
  authorId: string;
  author: SplitCampaignAuthor | null;
  activeDestinationCount: number;
  totalHits: number;
  deletedAt: Date | null;
  deletedBy?: SplitCampaignAuthor | null;
  createdAt: Date;
  updatedAt: Date;
};

export type SplitCampaignDetail = {
  id: string;
  name: string;
  slug: string;
  status: SplitCampaignStatus;
  authorId: string;
  author: SplitCampaignAuthor | null;
  totalHits: number;
  destinations: SplitDestinationListItem[];
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type SplitCampaignListOptions = {
  search?: string;
  status?: SplitCampaignStatus;
  includeDeleted?: boolean;
  page?: number;
  pageSize?: number;
};
