import type { MediaOverview } from "@/lib/Modules/Media/Service";
import type { PagesOverview } from "@/lib/Modules/Pages/Service";
import type { ScriptsOverview } from "@/lib/Modules/CustomCode/Service";
import type { SplitTestsOverview } from "@/lib/Modules/SplitTests/Service";
import type { UsersOverview } from "@/lib/Modules/Users/Service";

/** Payload do overview da Home — um bloco por módulo dono. */
export type PanelOverview = {
  pages: PagesOverview;
  media: MediaOverview;
  scripts: ScriptsOverview;
  splitTests: SplitTestsOverview;
  users: UsersOverview;
};
