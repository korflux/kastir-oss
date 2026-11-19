"use client";

import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { ChevronDown, Moon, Settings, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PanelIcon } from "@/components/Shared/PanelIcons";
import { useMenuVisibility } from "@/components/Shared/useMenuVisibility";
import { authClient } from "@/lib/auth-client";
import { NotificationBell } from "@/lib/Modules/Notifications/Components/NotificationBell";
import {
  findMenuItemForPath,
  visibleMenuItems,
} from "@/lib/Modules/Panel/Permissions";
import type { EffectiveRole } from "@/lib/Modules/Panel/Types";
import { tourAnchorId } from "@/lib/Modules/Onboarding/tourAnchors";
import type { PanelDictionary } from "@/lib/i18n/panel";
import type { PanelFormatSettings } from "@/lib/Modules/Settings/format";
import { cn } from "@/lib/utils";

export function Topbar({
  dictionary,
  initialUnreadCount,
  locale,
  formatSettings,
  role,
  user,
}: {
  dictionary: PanelDictionary;
  initialUnreadCount: number;
  locale: string;
  formatSettings?: PanelFormatSettings;
  role: EffectiveRole;
  user: { name: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [profileOpen, setProfileOpen] = useState(false);
  const [menuCustomizeOpen, setMenuCustomizeOpen] = useState(false);
  const [name, setName] = useState(user.name);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileStatus, setProfileStatus] = useState<string | null>(null);
  const isDark = mounted && resolvedTheme === "dark";
  const roleItems = useMemo(() => visibleMenuItems(role), [role]);
  const { hiddenKeys, toggleKey } = useMenuVisibility();
  // Preferência local só esconde da nav — URL direta continua ok (sem RBAC).
  const items = useMemo(
    () => roleItems.filter((item) => !hiddenKeys.includes(item.key)),
    [hiddenKeys, roleItems],
  );
  const activeKey = findMenuItemForPath(pathname)?.key;

  async function handleProfileSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProfileError(null);
    setProfileStatus(null);

    const response = await fetch("/api/admin/profile", {
      body: JSON.stringify({ name }),
      headers: { "content-type": "application/json" },
      method: "PUT",
    });

    if (!response.ok) {
      setProfileError(
        response.status === 400
          ? dictionary.profile.invalidName
          : dictionary.profile.updateFailed,
      );
      return;
    }

    const result = (await response.json()) as { user?: { name?: string } };
    if (result.user?.name) {
      setName(result.user.name);
    }
    setProfileStatus(dictionary.profile.saved);
    router.refresh();
  }

  async function handleLogout() {
    await authClient.signOut();
    router.replace("/admin/login");
    router.refresh();
  }

  // Topbar sits on canvas; default ghost hover uses muted, nearly invisible against it.
  // Stronger local hover only for this chrome (does not change global Button ghost).
  const iconHoverClass =
    "hover:bg-foreground/10 hover:text-foreground dark:hover:bg-foreground/15";

  return (
    <>
      <header
        className="bg-canvas/95 sticky top-0 z-30 flex h-[93px] items-center justify-between gap-4 border-b px-4 backdrop-blur md:px-6"
        data-testid="panel-topbar"
      >
        {/* Cluster esquerdo: abas de navegação, só de `lg` (1024px) em diante. Abaixo disso
            a BottomNav assume (em 768px as abas + o chrome `shrink-0` à direita não cabem
            e o chrome cobria os links). Breakpoint compartilhado: ver PanelLayout.
            Espaçamento: em 1024px sobram ~667px para a nav (viewport - BrandRail 93 - padding 48
            - gap 16 - chrome 200) e os 7 links ocupam ~544px, então `gap-4` (6 × 16 = 96px) cabe
            com folga e `gap-8` (192px, total ~736px) não cabe; `gap-8` só de `xl` (1280px). */}
        <nav
          aria-label={dictionary.shell.panel}
          className="hidden min-w-0 items-center gap-4 lg:flex xl:gap-8"
          data-testid="panel-top-nav"
        >
          {items.map((item) => {
            const active = activeKey === item.key;
            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={cn(
                  "text-foreground relative flex items-center gap-2.5 pb-2 text-base whitespace-nowrap",
                  !active && "text-muted-foreground hover:text-foreground",
                )}
                data-tour-anchor={tourAnchorId(item.key)}
                href={item.href}
                key={item.key}
              >
                <PanelIcon
                  className="size-[18px] shrink-0"
                  iconKey={item.iconKey}
                />
                <span>{dictionary.menu[item.labelKey]}</span>
                {/* Indicador ativo do Figma: pílula verde sob a aba. */}
                {active ? (
                  <span
                    aria-hidden="true"
                    className="bg-brand absolute bottom-0 left-1/2 h-[6px] w-[82px] max-w-full -translate-x-1/2 rounded-md"
                  />
                ) : null}
              </Link>
            );
          })}
        </nav>

        {/* Direita: só chrome (tema, setup, notif, perfil) — Home foi pra nav. */}
        <div className="ml-auto flex shrink-0 items-center gap-3 md:gap-4">
          <Button
            aria-label={
              isDark
                ? dictionary.shell.switchToLight
                : dictionary.shell.switchToDark
            }
            className={iconHoverClass}
            disabled={!mounted}
            onClick={() => setTheme(isDark ? "light" : "dark")}
            size="icon"
            title={dictionary.shell.theme}
            variant="ghost"
          >
            {isDark ? <Sun /> : <Moon />}
          </Button>
          {/* Setup: placeholder até Scope 9 consolidar sub-rotas. */}
          <Link
            aria-label={dictionary.shell.setup}
            className={cn(
              buttonVariants({ size: "icon", variant: "ghost" }),
              iconHoverClass,
            )}
            href="/admin/settings"
            title={dictionary.shell.setup}
          >
            <Settings />
          </Link>
          <NotificationBell
            buttonClassName={iconHoverClass}
            copy={dictionary.notifications}
            initialUnreadCount={initialUnreadCount}
            locale={locale}
            formatSettings={formatSettings}
          />
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={dictionary.shell.profile}
              render={
                <Button
                  className={`h-8 gap-1 rounded-full px-1.5 ${iconHoverClass}`}
                  size="sm"
                  variant="ghost"
                />
              }
            >
              <Avatar size="sm">
                <AvatarFallback data-testid="panel-profile-avatar">
                  {initials(name)}
                </AvatarFallback>
              </Avatar>
              {/* Seta do menu de perfil — affordance de dropdown. */}
              <ChevronDown aria-hidden className="size-3.5 opacity-70" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              <DropdownMenuGroup>
                <DropdownMenuLabel data-testid="panel-profile-name">
                  {name}
                </DropdownMenuLabel>
                <DropdownMenuLabel className="font-normal">
                  {dictionary.profile.roles[role]}
                </DropdownMenuLabel>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setProfileOpen(true)}>
                {dictionary.shell.profile}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setMenuCustomizeOpen(true)}>
                {dictionary.shell.customizeMenu}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleLogout}>
                {dictionary.profile.logout}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Toggle de abas do menu — preferência localStorage, não permissão. */}
      <Dialog onOpenChange={setMenuCustomizeOpen} open={menuCustomizeOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{dictionary.shell.customizeMenu}</DialogTitle>
            <DialogDescription>
              {dictionary.shell.customizeMenuDescription}
            </DialogDescription>
          </DialogHeader>
          <DialogClose
            aria-label={dictionary.profile.close}
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
          <ul className="grid gap-1">
            {roleItems.map((item) => {
              const checked = !hiddenKeys.includes(item.key);
              return (
                <li key={item.key}>
                  <label className="hover:bg-muted flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm">
                    <input
                      checked={checked}
                      className="accent-primary size-4"
                      type="checkbox"
                      onChange={() => toggleKey(item.key)}
                    />
                    <PanelIcon
                      className="size-4 shrink-0"
                      iconKey={item.iconKey}
                    />
                    <span>{dictionary.menu[item.labelKey]}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              {dictionary.profile.close}
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setProfileOpen} open={profileOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{dictionary.profile.title}</DialogTitle>
            <DialogDescription>
              {dictionary.profile.description}
            </DialogDescription>
          </DialogHeader>
          <DialogClose
            aria-label={dictionary.profile.close}
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
          <form className="grid gap-4" onSubmit={handleProfileSubmit}>
            <label
              className="grid gap-1.5 text-sm font-medium"
              htmlFor="profile-name"
            >
              {dictionary.profile.name}
              <Input
                id="profile-name"
                maxLength={120}
                name="name"
                onChange={(event) => setName(event.target.value)}
                required
                data-testid="panel-profile-name"
                value={name}
              />
            </label>
            <div className="grid gap-1.5 text-sm">
              <span className="font-medium">{dictionary.profile.role}</span>
              <span className="text-muted-foreground">
                {dictionary.profile.roles[role]}
              </span>
            </div>
            {profileError ? (
              <p className="text-destructive text-sm" role="alert">
                {profileError}
              </p>
            ) : null}
            {profileStatus ? (
              <p className="text-sm" role="status">
                {profileStatus}
              </p>
            ) : null}
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>
                {dictionary.profile.close}
              </DialogClose>
              <Button type="submit">{dictionary.profile.save}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}
