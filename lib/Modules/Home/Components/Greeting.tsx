import Link from "next/link";
import { Plus } from "lucide-react";

import { PanelIcon } from "@/components/Shared/PanelIcons";
import { buttonVariants } from "@/components/ui/button";
import type { PanelDictionary } from "@/lib/i18n/panel";
import {
  fillTemplate,
  formatGreeting,
  formatSizeMb,
  timeOfDayKey,
} from "@/lib/Modules/Home/format";
import type { PanelOverview } from "@/lib/Modules/Home/Types";
import { visibleMenuItems } from "@/lib/Modules/Panel/Permissions";
import type { EffectiveRole } from "@/lib/Modules/Panel/Types";
import { cn } from "@/lib/utils";

export type GreetingProps = {
  name: string;
  dictionary: PanelDictionary["home"];
  menu: PanelDictionary["menu"];
  overview: PanelOverview;
  role: EffectiveRole;
};

export { formatGreeting } from "@/lib/Modules/Home/format";

export function Greeting({
  name,
  dictionary,
  menu,
  overview,
  role,
}: GreetingProps) {
  const greetingTemplate =
    dictionary[
      (
        {
          morning: "greetingMorning",
          afternoon: "greetingAfternoon",
          evening: "greetingEvening",
        } as const
      )[timeOfDayKey()]
    ];

  const allCards = [
    {
      key: "pages",
      href: "/admin/pages",
      iconKey: "fileText",
      label: menu.pages,
      total: overview.pages.total,
      unit: dictionary.pagesUnit,
      detail: fillTemplate(dictionary.pagesDetail, {
        count: overview.pages.publishedThisWeek,
      }),
    },
    {
      key: "media",
      href: "/admin/media",
      iconKey: "image",
      label: menu.media,
      total: overview.media.total,
      unit: dictionary.mediasUnit,
      detail: fillTemplate(dictionary.mediasDetail, {
        size: formatSizeMb(overview.media.totalSizeBytes),
      }),
    },
    {
      key: "scripts",
      href: "/admin/custom-code",
      iconKey: "code2",
      label: menu.scripts,
      total: overview.scripts.total,
      unit: dictionary.scriptsUnit,
      detail: fillTemplate(dictionary.scriptsDetail, {
        count: overview.scripts.draftCount,
      }),
    },
    {
      key: "splitTests",
      href: "/admin/split-tests",
      iconKey: "gitBranch",
      label: menu.splitTests,
      total: overview.splitTests.total,
      unit: dictionary.splitTestsUnit,
      detail: fillTemplate(dictionary.splitTestsDetail, {
        count: overview.splitTests.inactiveCount,
      }),
    },
    {
      key: "users",
      href: "/admin/users",
      iconKey: "users",
      label: menu.users,
      total: overview.users.total,
      unit: dictionary.usersUnit,
      detail: fillTemplate(dictionary.usersDetail, {
        count: overview.users.adminCount,
      }),
    },
  ] as const;
  const cards = visibleMenuItems(role).some((item) => item.key === "users")
    ? allCards
    : allCards.filter((card) => card.key !== "users");

  return (
    <section
      // Padding/título alinhados ao ListHeader das listagens (Pages/Medias/…).
      className="flex w-full flex-1 flex-col gap-8 px-4 py-6 md:px-8 md:py-8 xl:px-10"
      data-testid="panel-home"
    >
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1
            className="text-foreground text-4xl font-semibold tracking-tight md:text-5xl"
            data-testid="panel-greeting"
          >
            {formatGreeting(greetingTemplate, name)}
          </h1>
          <p className="text-muted-foreground mt-2 text-base md:text-lg">
            {dictionary.subtitle}
          </p>
        </div>
        <Link
          className={cn(
            buttonVariants({ size: "lg" }),
            "bg-foreground text-background hover:bg-foreground/90 shrink-0 rounded-full",
          )}
          href="/admin/pages"
        >
          <Plus className="size-4" />
          {dictionary.newPage}
        </Link>
      </header>

      <div className="border-border border-t" />

      <div>
        <h2 className="text-foreground mb-4 text-2xl font-semibold md:text-3xl">
          {dictionary.overview}
        </h2>
        <div
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5"
          data-testid="panel-overview"
        >
          {cards.map((card) => (
            <Link
              className="bg-surface-alt border-border hover:border-foreground/20 flex flex-col gap-3 rounded-2xl border p-5 transition-colors"
              data-testid={`overview-card-${card.key}`}
              href={card.href}
              key={card.key}
            >
              <div className="text-muted-foreground flex items-center gap-2 text-sm">
                <PanelIcon className="size-4" iconKey={card.iconKey} />
                <span>{card.label}</span>
              </div>
              <div className="flex items-end gap-2">
                <span className="text-foreground text-5xl font-semibold tracking-tight tabular-nums">
                  {card.total}
                </span>
                <span className="text-muted-foreground pb-1 text-sm">
                  {card.unit}
                </span>
              </div>
              <p className="text-muted-foreground mt-auto text-sm">
                {card.detail}
              </p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
