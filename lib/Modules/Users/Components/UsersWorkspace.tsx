"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";

import { ConfirmDialog } from "@/components/Shared/ConfirmDialog";
import { ListHeader } from "@/components/Shared/ListHeader";
import { RequiredMark } from "@/components/Shared/RequiredMark";
import { SelectChevron } from "@/components/Shared/SelectChevron";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type {
  EffectiveUserRole,
  EditableUserRole,
} from "@/lib/Modules/Users/Types";
import type { PanelDictionary } from "@/lib/i18n/panel";
import { cn } from "@/lib/utils";

type UsersCopy = PanelDictionary["users"];

type UserDto = {
  id: string;
  name: string;
  email: string;
  role: EffectiveUserRole;
  isMaster: boolean;
  createdAt: string;
};

type PendingAction =
  | {
      kind: "save";
      user: UserDto;
      name: string;
      email: string;
      nextRole: EditableUserRole;
      roleChanged: boolean;
    }
  | { kind: "reset"; user: UserDto }
  | { kind: "remove"; user: UserDto };

type ApiError = Error & { code?: string };

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      code?: string;
    } | null;
    const error = new Error(payload?.error ?? "Request failed") as ApiError;
    error.code = payload?.code;
    throw error;
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

function replaceToken(copy: string, token: string, value: string): string {
  return copy.replace(`{${token}}`, value);
}

function roleLabel(user: UserDto, dictionary: UsersCopy): string {
  if (user.isMaster) return dictionary.master;
  return user.role === "ADMIN" ? dictionary.roleAdmin : dictionary.roleEditor;
}

const iconBtn =
  "inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground disabled:opacity-40";

const selectClassName =
  "border-input bg-card text-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full appearance-none rounded-lg border py-1 pr-8 pl-2.5 text-sm outline-none focus-visible:ring-3";

export function UsersWorkspace({
  dictionary,
  actorId,
  actorRole,
}: {
  dictionary: UsersCopy;
  actorId: string;
  actorRole: EffectiveUserRole;
}) {
  const [users, setUsers] = useState<UserDto[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Convite (diálogo New User).
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<EditableUserRole>("EDITOR");
  const [inviteLink, setInviteLink] = useState<{
    url: string;
    expiresAt: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  // Edição de linha (Name/Email/Role + Reset).
  const [editingUser, setEditingUser] = useState<UserDto | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState<EditableUserRole>("EDITOR");
  const [resetLink, setResetLink] = useState<{
    url: string;
    expiresAt: string;
  } | null>(null);

  const [pending, setPending] = useState<PendingAction | null>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: "25",
      });
      if (search.trim()) params.set("q", search.trim());
      const result = await requestJson<{
        users: { items: UserDto[]; total: number; page: number };
      }>(`/api/admin/users?${params.toString()}`);
      setUsers(result.users.items);
      setTotal(result.users.total);
      setPage(result.users.page);
    } catch (loadError) {
      setError((loadError as ApiError).message || dictionary.error);
    } finally {
      setLoading(false);
    }
  }, [dictionary.error, page, search]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadUsers(), 180);
    return () => window.clearTimeout(timer);
  }, [loadUsers]);

  const canMutate = useCallback(
    (user: UserDto): boolean =>
      !user.isMaster &&
      user.id !== actorId &&
      (actorRole === "MASTER" || user.role === "EDITOR"),
    [actorId, actorRole],
  );

  const canReset = useCallback(
    (user: UserDto): boolean =>
      !user.isMaster && (actorRole === "MASTER" || actorRole === "ADMIN"),
    [actorRole],
  );

  const openEdit = (user: UserDto) => {
    setEditingUser(user);
    setEditName(user.name);
    setEditEmail(user.email);
    if (user.role === "ADMIN" || user.role === "EDITOR") {
      setEditRole(user.role);
    } else {
      setEditRole("EDITOR");
    }
    setResetLink(null);
    setError(null);
    setNotice(null);
  };

  const applyUserSave = async (payload: {
    user: UserDto;
    name: string;
    email: string;
    nextRole: EditableUserRole;
    roleChanged: boolean;
  }) => {
    setBusy(payload.user.id);
    setError(null);
    setNotice(null);
    try {
      const body: Record<string, string> = {
        name: payload.name,
        email: payload.email,
      };
      if (payload.roleChanged || canMutate(payload.user)) {
        body.role = payload.nextRole;
      }
      const result = await requestJson<{ user: UserDto }>(
        `/api/admin/users/${payload.user.id}`,
        {
          method: "PATCH",
          body: JSON.stringify(body),
        },
      );
      setNotice(
        payload.roleChanged ? dictionary.changeRole : dictionary.userSaved,
      );
      setEditingUser(result.user);
      setEditName(result.user.name);
      setEditEmail(result.user.email);
      if (result.user.role === "ADMIN" || result.user.role === "EDITOR") {
        setEditRole(result.user.role);
      }
      await loadUsers();
    } catch (actionError) {
      setError((actionError as ApiError).message || dictionary.error);
    } finally {
      setBusy(null);
    }
  };

  const saveEditedUser = () => {
    if (!editingUser || !canMutate(editingUser)) return;
    const name = editName.trim();
    const email = editEmail.trim();
    if (!name || !email) {
      setError(dictionary.error);
      return;
    }
    const roleChanged =
      (editingUser.role === "ADMIN" || editingUser.role === "EDITOR") &&
      editRole !== editingUser.role;
    const payload = {
      user: editingUser,
      name,
      email,
      nextRole: editRole,
      roleChanged,
    };
    // Troca de role revoga sessões — pede confirmação antes.
    if (roleChanged) {
      setPending({ kind: "save", ...payload });
      return;
    }
    void applyUserSave(payload);
  };

  const executeAction = async () => {
    if (!pending) return;
    const action = pending;
    setBusy(action.user.id);
    setError(null);
    setNotice(null);
    try {
      if (action.kind === "save") {
        setPending(null);
        await applyUserSave(action);
        return;
      }
      if (action.kind === "reset") {
        const result = await requestJson<{
          reset: { url: string; expiresAt: string };
        }>(`/api/admin/users/${action.user.id}/password-reset`, {
          method: "POST",
        });
        setResetLink(result.reset);
        setNotice(dictionary.resetPassword);
      } else {
        await requestJson(`/api/admin/users/${action.user.id}`, {
          method: "DELETE",
        });
        setNotice(dictionary.remove);
        if (editingUser?.id === action.user.id) setEditingUser(null);
      }
      setPending(null);
      await loadUsers();
    } catch (actionError) {
      setError((actionError as ApiError).message || dictionary.error);
    } finally {
      setBusy(null);
    }
  };

  const createInvite = async () => {
    setBusy("invite");
    setError(null);
    setNotice(null);
    try {
      const result = await requestJson<{
        inviteUrl: string;
        expiresAt: string;
      }>("/api/admin/users/invites", {
        method: "POST",
        body: JSON.stringify({ name: inviteName, role: inviteRole }),
      });
      setInviteLink({ url: result.inviteUrl, expiresAt: result.expiresAt });
      setInviteName("");
      setNotice(dictionary.inviteCreated);
      await loadUsers();
    } catch (inviteError) {
      setError((inviteError as ApiError).message || dictionary.error);
    } finally {
      setBusy(null);
    }
  };

  const copyText = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError(dictionary.error);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / 25));

  // Shell Figma Users: ListHeader + tabela Role/Name/Email/Created + diálogos.
  return (
    <section className="flex min-h-0 w-full flex-1 flex-col gap-3 overflow-hidden px-4 py-4 md:gap-4 md:px-8 md:py-5 xl:px-10">
      <ListHeader
        className="border-border shrink-0 border-b pb-3"
        searchAriaLabel={dictionary.search}
        searchPlaceholder={dictionary.searchBy}
        searchValue={search}
        subtitle={dictionary.description}
        title={dictionary.title}
        onSearchChange={(value) => {
          setPage(1);
          setSearch(value);
        }}
      >
        <Button
          className="border-border rounded-full bg-transparent px-4 hover:bg-white/5"
          type="button"
          variant="outline"
          onClick={() => {
            setInviteOpen(true);
            setInviteLink(null);
            setInviteName("");
            setInviteRole("EDITOR");
            setError(null);
            setNotice(null);
          }}
        >
          <Plus className="text-brand size-4" />
          {dictionary.newUser}
        </Button>
      </ListHeader>

      {error ? (
        <div
          className="border-destructive/40 bg-destructive/10 text-destructive flex shrink-0 items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
          role="alert"
        >
          <span>{error}</span>
          <Button size="sm" variant="outline" onClick={() => void loadUsers()}>
            {dictionary.retry}
          </Button>
        </div>
      ) : null}
      {notice && !inviteOpen && !editingUser ? (
        <div
          className="border-primary/30 bg-primary/5 text-primary shrink-0 rounded-lg border px-3 py-2 text-sm"
          role="status"
        >
          {notice}
        </div>
      ) : null}

      <div className="bg-card/80 border-border flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border p-3 md:p-4">
        <div className="min-h-0 flex-1 overflow-auto">
          {loading ? (
            <div
              className="text-muted-foreground py-12 text-center text-sm"
              role="status"
            >
              {dictionary.loading}
            </div>
          ) : users.length === 0 ? (
            <div className="border-border border border-dashed px-4 py-12 text-center text-sm">
              {dictionary.empty}
            </div>
          ) : (
            <div className="overflow-x-auto">
              {/* Colunas Figma: Role (+edit) | Name | e-Mail | Created | lixeira. */}
              <div
                className="text-muted-foreground mb-1 grid min-w-[720px] grid-cols-[minmax(10rem,12rem)_minmax(10rem,1.2fr)_minmax(12rem,1.4fr)_7rem_2.5rem] gap-3 px-1 text-sm"
                role="row"
              >
                <div role="columnheader">{dictionary.role}</div>
                <div role="columnheader">{dictionary.name}</div>
                <div role="columnheader">{dictionary.email}</div>
                <div role="columnheader">{dictionary.created}</div>
                <div role="columnheader" />
              </div>
              <div
                className="divide-border min-w-[720px] divide-y"
                role="rowgroup"
              >
                {users.map((user) => {
                  const manage = canMutate(user);
                  const reset = canReset(user);
                  const showEdit = manage || reset;
                  return (
                    <div
                      className="grid grid-cols-[minmax(10rem,12rem)_minmax(10rem,1.2fr)_minmax(12rem,1.4fr)_7rem_2.5rem] items-center gap-3 py-3.5"
                      key={user.id}
                      role="row"
                    >
                      <div
                        className="flex min-w-0 items-center gap-1"
                        role="cell"
                      >
                        {showEdit ? (
                          <button
                            aria-label={`${dictionary.edit}: ${user.name}`}
                            className={iconBtn}
                            type="button"
                            onClick={() => openEdit(user)}
                          >
                            <Pencil className="size-4" />
                          </button>
                        ) : (
                          <span className="size-8 shrink-0" aria-hidden />
                        )}
                        <span className="truncate text-sm">
                          {roleLabel(user, dictionary)}
                        </span>
                      </div>
                      <div className="min-w-0 truncate font-medium" role="cell">
                        {user.name}
                      </div>
                      <div
                        className="text-muted-foreground min-w-0 truncate text-sm"
                        role="cell"
                      >
                        {user.email}
                      </div>
                      <div
                        className="text-muted-foreground text-sm"
                        role="cell"
                      >
                        {formatDate(user.createdAt)}
                      </div>
                      <div className="flex justify-end" role="cell">
                        {manage ? (
                          <button
                            aria-label={`${dictionary.remove}: ${user.name}`}
                            className={cn(
                              iconBtn,
                              "text-destructive hover:text-destructive",
                            )}
                            disabled={busy !== null}
                            type="button"
                            onClick={() => setPending({ kind: "remove", user })}
                          >
                            <Trash2 className="size-[18px]" />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="border-border mt-3 flex shrink-0 items-center justify-between gap-2 border-t pt-3">
          <span className="text-muted-foreground text-xs">
            {replaceToken(dictionary.totalCount, "count", String(total))}
          </span>
          <div className="flex items-center gap-2">
            <Button
              disabled={loading || page <= 1}
              size="sm"
              type="button"
              variant="outline"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              {dictionary.previous}
            </Button>
            <span className="text-muted-foreground text-xs tabular-nums">
              {page} / {totalPages}
            </span>
            <Button
              disabled={loading || page >= totalPages}
              size="sm"
              type="button"
              variant="outline"
              onClick={() =>
                setPage((current) => Math.min(totalPages, current + 1))
              }
            >
              {dictionary.next}
            </Button>
          </div>
        </div>
      </div>

      {/* Diálogo New User — convite por link (fica aberto após gerar o link). */}
      <Dialog
        open={inviteOpen}
        onOpenChange={(open) => {
          // Não fechar sozinho enquanto gera; link já gerado exige fechar manual.
          if (!open && busy === "invite") return;
          setInviteOpen(open);
          if (!open) {
            setInviteLink(null);
            setInviteName("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md" closeLabel={dictionary.close}>
          <DialogHeader>
            <DialogTitle>{dictionary.inviteTitle}</DialogTitle>
            <DialogDescription>
              {dictionary.inviteDescription}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <label className="block space-y-1 text-sm" htmlFor="invite-name">
              <span className="flex items-center gap-0.5">
                {dictionary.name}
                <RequiredMark />
              </span>
              <Input
                className="h-9 rounded-lg"
                id="invite-name"
                value={inviteName}
                onChange={(event) => setInviteName(event.target.value)}
              />
            </label>
            <label className="block space-y-1 text-sm" htmlFor="invite-role">
              <span>{dictionary.role}</span>
              <div className="relative">
                <select
                  className={selectClassName}
                  id="invite-role"
                  value={inviteRole}
                  onChange={(event) =>
                    setInviteRole(event.target.value as EditableUserRole)
                  }
                >
                  <option value="ADMIN">{dictionary.roleAdmin}</option>
                  <option value="EDITOR">{dictionary.roleEditor}</option>
                </select>
                <SelectChevron />
              </div>
            </label>
          </div>

          {inviteLink ? (
            <div className="border-border space-y-2 border-t pt-3">
              <p className="text-sm font-medium">{dictionary.inviteCreated}</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  aria-label={dictionary.inviteCreated}
                  className="h-9 rounded-lg"
                  readOnly
                  value={inviteLink.url}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void copyText(inviteLink.url)}
                >
                  {copied ? dictionary.copied : dictionary.copyLink}
                </Button>
              </div>
              <p className="text-muted-foreground text-xs">
                {replaceToken(
                  dictionary.linkExpires,
                  "date",
                  formatDate(inviteLink.expiresAt),
                )}
              </p>
            </div>
          ) : null}

          <DialogFooter>
            <Button
              disabled={busy !== null || !inviteName.trim()}
              type="button"
              onClick={() => void createInvite()}
            >
              {busy === "invite" ? dictionary.working : dictionary.createInvite}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo editar linha — Role (se canMutate) + Reset Password (se canReset). */}
      <Dialog
        open={editingUser !== null}
        onOpenChange={(open) => {
          if (!open && busy !== null) return;
          if (!open) {
            setEditingUser(null);
            setResetLink(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md" closeLabel={dictionary.close}>
          <DialogHeader>
            <DialogTitle>
              {dictionary.editUser}
              {editingUser ? ` — ${editingUser.name}` : ""}
            </DialogTitle>
            <DialogDescription>{editingUser?.email}</DialogDescription>
          </DialogHeader>

          {editingUser ? (
            <div className="grid gap-4">
              {canMutate(editingUser) ? (
                <div className="grid gap-3">
                  <label
                    className="block space-y-1 text-sm"
                    htmlFor="edit-user-name"
                  >
                    <span className="flex items-center gap-0.5">
                      {dictionary.name}
                      <RequiredMark />
                    </span>
                    <Input
                      className="h-9 rounded-lg"
                      id="edit-user-name"
                      value={editName}
                      onChange={(event) => setEditName(event.target.value)}
                    />
                  </label>
                  <label
                    className="block space-y-1 text-sm"
                    htmlFor="edit-user-email"
                  >
                    <span className="flex items-center gap-0.5">
                      {dictionary.email}
                      <RequiredMark />
                    </span>
                    <Input
                      className="h-9 rounded-lg"
                      id="edit-user-email"
                      type="email"
                      value={editEmail}
                      onChange={(event) => setEditEmail(event.target.value)}
                    />
                  </label>
                  <label
                    className="block space-y-1 text-sm"
                    htmlFor="edit-user-role"
                  >
                    <span>{dictionary.role}</span>
                    <div className="relative">
                      <select
                        aria-label={`${dictionary.changeRole}: ${editingUser.name}`}
                        className={selectClassName}
                        id="edit-user-role"
                        value={editRole}
                        onChange={(event) =>
                          setEditRole(event.target.value as EditableUserRole)
                        }
                      >
                        <option value="ADMIN">{dictionary.roleAdmin}</option>
                        <option value="EDITOR">{dictionary.roleEditor}</option>
                      </select>
                      <SelectChevron />
                    </div>
                  </label>
                  <Button
                    disabled={
                      busy !== null ||
                      !editName.trim() ||
                      !editEmail.trim() ||
                      (editName.trim() === editingUser.name &&
                        editEmail.trim() === editingUser.email &&
                        editRole === editingUser.role)
                    }
                    size="sm"
                    type="button"
                    onClick={() => saveEditedUser()}
                  >
                    {busy === editingUser.id
                      ? dictionary.working
                      : dictionary.saveUser}
                  </Button>
                </div>
              ) : null}

              {canReset(editingUser) ? (
                <div className="space-y-2">
                  <Button
                    disabled={busy !== null}
                    size="sm"
                    type="button"
                    variant="outline"
                    onClick={() =>
                      setPending({ kind: "reset", user: editingUser })
                    }
                  >
                    {dictionary.resetPassword}
                  </Button>
                  {resetLink ? (
                    <div className="border-border space-y-2 border-t pt-3">
                      <p className="text-sm font-medium">
                        {dictionary.resetLinkCreated}
                      </p>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Input
                          aria-label={dictionary.resetLinkCreated}
                          className="h-9 rounded-lg"
                          readOnly
                          value={resetLink.url}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => void copyText(resetLink.url)}
                        >
                          {copied ? dictionary.copied : dictionary.copyLink}
                        </Button>
                      </div>
                      <p className="text-muted-foreground text-xs">
                        {replaceToken(
                          dictionary.linkExpires,
                          "date",
                          formatDate(resetLink.expiresAt),
                        )}
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        busy={busy !== null}
        busyLabel={dictionary.working}
        cancelLabel={dictionary.cancel}
        closeLabel={dictionary.close}
        confirmLabel={dictionary.confirm}
        destructive={pending?.kind === "remove"}
        description={
          pending?.kind === "save"
            ? dictionary.confirmRoleDescription
            : pending?.kind === "reset"
              ? dictionary.confirmResetDescription
              : dictionary.confirmRemoveDescription
        }
        onConfirm={() => void executeAction()}
        onOpenChange={(open) => {
          if (!open && busy === null) setPending(null);
        }}
        open={pending !== null}
        title={
          pending?.kind === "save"
            ? dictionary.confirmRoleTitle
            : pending?.kind === "reset"
              ? dictionary.confirmResetTitle
              : dictionary.confirmRemoveTitle
        }
      />
    </section>
  );
}
