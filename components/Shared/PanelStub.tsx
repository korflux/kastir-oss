import Link from "next/link";

import type { PanelDictionary } from "@/lib/i18n/panel";

export function PanelStub({
  copy,
}: {
  copy: PanelDictionary["stubs"][keyof PanelDictionary["stubs"]];
}) {
  return (
    <section className="flex w-full flex-1 flex-col justify-center px-4 py-12 md:px-8">
      <h1 className="text-heading text-3xl font-semibold tracking-tight">
        {copy.title}
      </h1>
      <p className="text-muted-foreground mt-3 max-w-xl text-base">
        {copy.description}
      </p>
    </section>
  );
}

export function ForbiddenView({ dictionary }: { dictionary: PanelDictionary }) {
  return (
    <section className="flex w-full flex-1 flex-col justify-center px-4 py-12 md:px-8">
      <p className="text-muted-foreground mb-3 text-xs font-semibold tracking-[0.14em] uppercase">
        {dictionary.forbidden.eyebrow}
      </p>
      <h1 className="text-heading text-3xl font-semibold tracking-tight">
        {dictionary.forbidden.title}
      </h1>
      <p className="text-muted-foreground mt-3 max-w-xl text-base">
        {dictionary.forbidden.description}
      </p>
      <Link
        className="text-foreground mt-6 w-fit text-sm font-medium underline-offset-4 hover:underline"
        href="/admin"
      >
        {dictionary.forbidden.backToPanel}
      </Link>
    </section>
  );
}
