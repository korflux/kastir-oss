export const SYSTEM_PAGE_RETENTION_ACTOR_ID = "system:expire-trashed-pages";
export const SYSTEM_REVISION_RETENTION_ACTOR_ID =
  "system:expire-revision-history";
export const SYSTEM_MEDIA_STUCK_RECONCILE_ACTOR_ID =
  "system:media-stuck-processing";

export type PageRemovalContext = {
  pageId: string;
  title: string;
  slug: string;
  snippetIds: string[];
  isHome: boolean;
  /** Quem disparou trash/delete — ator do log das transições derivadas. */
  actorId: string;
};

export type AutomaticNotificationDatabase = {
  user: {
    findMany(args: {
      where: unknown;
      select: { id: true };
    }): Promise<Array<{ id: string }>>;
  };
};

export type AutomaticNotificationEmitter = (
  userId: string,
  message: string,
  link: string,
) => Promise<unknown>;
