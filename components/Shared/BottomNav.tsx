"use client";

import Link from "next/link";
import { MoreHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { usePathname } from "next/navigation";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PanelIcon } from "@/components/Shared/PanelIcons";
import { useMenuVisibility } from "@/components/Shared/useMenuVisibility";
import { cn } from "@/lib/utils";
import {
  findMenuItemForPath,
  partitionBottomNav,
  visibleMenuItems,
} from "@/lib/Modules/Panel/Permissions";
import type { EffectiveRole } from "@/lib/Modules/Panel/Types";
import { tourAnchorId } from "@/lib/Modules/Onboarding/tourAnchors";
import type { PanelDictionary } from "@/lib/i18n/panel";

/**
 * Navegação fixa na base do painel para tablet e mobile (abaixo de `lg`, 1024px). De `lg` em
 * diante a nav da Topbar a substitui. Breakpoint compartilhado com o `pb-16` do `main`
 * (reserva a altura desta barra) e com o cartão do tour guiado: ver PanelLayout.
 * Itens fora de `PRIMARY_BOTTOM_NAV_KEYS` ficam no diálogo "Mais".
 *
 * Tour guiado: o diálogo só monta os itens de overflow quando aberto, então o passo de um desses
 * itens não teria elemento visível para destacar. O botão "Mais" declara em
 * `data-tour-anchor-proxy` os anchors que abriga (a mesma lista `overflow` que renderiza o
 * diálogo) e o `GuidedTour` o destaca no lugar. Atributo próprio: nenhum `data-tour-anchor` é
 * duplicado no DOM.
 */
export function BottomNav({
  role,
  dictionary,
}: {
  role: EffectiveRole;
  dictionary: PanelDictionary;
}) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const { hiddenKeys } = useMenuVisibility();
  // Mesma preferência do Topbar — esconde da nav mobile sem mexer em RBAC.
  const items = useMemo(
    () =>
      visibleMenuItems(role).filter((item) => !hiddenKeys.includes(item.key)),
    [hiddenKeys, role],
  );
  const { primary, overflow } = partitionBottomNav(items);
  const activeKey = findMenuItemForPath(pathname)?.key;

  return (
    <>
      <nav
        aria-label={dictionary.shell.brand}
        className="bg-paper/95 fixed inset-x-0 bottom-0 z-40 flex h-16 items-center justify-around border-t px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
        data-testid="panel-bottom-nav"
      >
        {primary.map((item) => (
          <BottomNavLink
            activeKey={activeKey}
            item={item}
            key={item.key}
            label={dictionary.menu[item.labelKey]}
            tourAnchor={tourAnchorId(item.key)}
          />
        ))}
        {overflow.length > 0 ? (
          <Button
            aria-expanded={moreOpen}
            aria-haspopup="dialog"
            className={cn(
              "text-muted-foreground flex h-12 min-w-14 flex-col gap-0.5 rounded-md px-2 text-[11px]",
              moreOpen && "bg-muted text-foreground",
            )}
            data-tour-anchor-proxy={overflow
              .map((item) => tourAnchorId(item.key))
              .join(" ")}
            onClick={() => setMoreOpen(true)}
            variant="ghost"
          >
            <MoreHorizontal className="size-4" />
            <span>{dictionary.shell.more}</span>
          </Button>
        ) : null}
      </nav>

      <Dialog onOpenChange={setMoreOpen} open={moreOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{dictionary.shell.more}</DialogTitle>
            <DialogDescription>{dictionary.shell.brand}</DialogDescription>
          </DialogHeader>
          <DialogClose
            aria-label={dictionary.shell.closeMore}
            render={
              <Button
                className="absolute top-2 right-2"
                size="icon-sm"
                variant="ghost"
              />
            }
          >
            <span aria-hidden="true">×</span>
          </DialogClose>
          <div className="grid gap-1">
            {overflow.map((item) => (
              <Link
                aria-current={activeKey === item.key ? "page" : undefined}
                className={cn(
                  "text-muted-foreground hover:bg-muted hover:text-foreground flex items-center gap-3 rounded-md px-3 py-2.5 text-sm",
                  activeKey === item.key && "bg-muted text-foreground",
                )}
                href={item.href}
                key={item.key}
                onClick={() => setMoreOpen(false)}
                data-tour-anchor={tourAnchorId(item.key)}
              >
                <PanelIcon className="size-4" iconKey={item.iconKey} />
                {dictionary.menu[item.labelKey]}
              </Link>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function BottomNavLink({
  activeKey,
  item,
  label,
  tourAnchor,
}: {
  activeKey?: string;
  item: { key: string; href: string; iconKey: string };
  label: string;
  tourAnchor: string;
}) {
  const active = activeKey === item.key;

  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={cn(
        "text-muted-foreground hover:text-foreground flex h-12 min-w-14 flex-col items-center justify-center gap-0.5 rounded-md px-2 text-[11px]",
        active && "bg-muted text-foreground",
      )}
      data-tour-anchor={tourAnchor}
      href={item.href}
    >
      <PanelIcon className="size-4" iconKey={item.iconKey} />
      <span>{label}</span>
    </Link>
  );
}
