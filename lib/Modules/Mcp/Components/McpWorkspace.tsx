"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Trash2 } from "lucide-react";

import { ConfirmDialog } from "@/components/Shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import type { PanelDictionary } from "@/lib/i18n/panel";

type McpConnectionsCopy = PanelDictionary["mcpConnections"];

type Connection = {
  id: string;
  clientId: string;
  clientName: string;
  clientUri: string | null;
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
  };
  scopes: string[];
  createdAt: string;
  updatedAt: string;
  lastTokenIssuedAt: string | null;
  active: boolean;
};

function formatDate(value: string | null, fallback: string): string {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? fallback
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

/**
 * Aba Connections do Setup — lista OAuth MCP (Figma Setup CONNECTIONS.png).
 * Revoke usa ConfirmDialog (fecha o último window.confirm do painel).
 */
export function McpWorkspace({
  dictionary,
  endpoint,
}: {
  dictionary: McpConnectionsCopy;
  endpoint: string;
}) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<Connection | null>(null);
  const [copied, setCopied] = useState(false);

  const loadConnections = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/mcp/connections", {
        cache: "no-store",
        credentials: "include",
      });
      if (!response.ok) throw new Error("load_failed");
      const payload = (await response.json()) as unknown;
      if (!Array.isArray(payload)) throw new Error("invalid_payload");
      setConnections(payload as Connection[]);
    } catch {
      setError(dictionary.error);
    } finally {
      setIsLoading(false);
    }
  }, [dictionary.error]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadConnections();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadConnections]);

  async function confirmRevoke() {
    if (!pendingRevoke) return;
    const connection = pendingRevoke;
    setRevokingId(connection.id);
    setError(null);
    try {
      const response = await fetch(
        "/api/admin/mcp/connections/" + encodeURIComponent(connection.id),
        {
          method: "DELETE",
          credentials: "include",
        },
      );
      if (!response.ok) throw new Error("revoke_failed");
      setConnections((current) =>
        current.filter((item) => item.id !== connection.id),
      );
      setPendingRevoke(null);
    } catch {
      setError(dictionary.error);
    } finally {
      setRevokingId(null);
    }
  }

  async function copyEndpoint() {
    try {
      await navigator.clipboard.writeText(endpoint);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError(dictionary.error);
    }
  }

  return (
    <section
      className="flex w-full flex-1 flex-col gap-6 px-4 py-6 md:px-8 md:py-8 xl:px-10"
      data-testid="setup-connections"
    >
      <header className="max-w-3xl">
        <h1 className="text-foreground text-4xl font-semibold tracking-tight md:text-5xl">
          {dictionary.title}
        </h1>
        <p className="text-muted-foreground mt-2 text-base">
          {dictionary.description}
        </p>
      </header>

      {/* Endpoint + copiar (Figma). */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-muted-foreground text-sm">
          {dictionary.endpoint}
        </span>
        <Button
          aria-label={dictionary.endpoint}
          className="h-8 rounded-full px-2"
          size="sm"
          type="button"
          variant="ghost"
          onClick={() => void copyEndpoint()}
        >
          <Copy className="size-4" />
        </Button>
        <code className="text-foreground text-sm break-all">{endpoint}</code>
        {copied ? (
          <span className="text-muted-foreground text-xs" role="status">
            ✓
          </span>
        ) : null}
      </div>

      {error ? (
        <div
          className="flex max-w-3xl items-center justify-between gap-4"
          role="alert"
        >
          <p className="text-destructive text-sm">{error}</p>
          <Button onClick={() => void loadConnections()} variant="outline">
            {dictionary.retry}
          </Button>
        </div>
      ) : null}

      {isLoading ? (
        <p className="text-muted-foreground text-sm">{dictionary.loading}</p>
      ) : connections.length === 0 ? (
        <p className="text-muted-foreground text-sm">{dictionary.empty}</p>
      ) : (
        <div className="grid max-w-3xl gap-4">
          {connections.map((connection) => (
            <article
              key={connection.id}
              className="bg-muted/30 border-border rounded-xl border p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold">
                    {connection.clientName}
                  </h2>
                  <code className="text-muted-foreground block truncate text-xs">
                    {connection.clientId}
                  </code>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {dictionary.lastTokenIssued}{" "}
                    {formatDate(
                      connection.lastTokenIssuedAt,
                      dictionary.noTokenIssued,
                    )}
                  </p>
                </div>
                <Button
                  className="rounded-full"
                  disabled={revokingId === connection.id}
                  size="sm"
                  type="button"
                  variant="destructive"
                  onClick={() => setPendingRevoke(connection)}
                >
                  <Trash2 className="size-3.5" />
                  {revokingId === connection.id
                    ? dictionary.revoking
                    : dictionary.revoke}
                </Button>
              </div>

              <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-muted-foreground">{dictionary.user}</dt>
                  <dd className="font-medium">{connection.user.name}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">e-Mail</dt>
                  <dd className="break-all">{connection.user.email}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    {dictionary.created}
                  </dt>
                  <dd>{formatDate(connection.createdAt, "—")}</dd>
                </div>
              </dl>

              <div className="mt-3">
                <p className="text-muted-foreground text-sm">
                  {dictionary.scopes}
                </p>
                <p className="mt-1 text-xs break-all">
                  {connection.scopes.join(", ")}
                </p>
              </div>

              <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">
                    {dictionary.updated}
                  </dt>
                  <dd>{formatDate(connection.updatedAt, "—")}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">{dictionary.active}</dt>
                  <dd>
                    {connection.active
                      ? dictionary.active
                      : dictionary.inactive}
                  </dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      )}

      <ConfirmDialog
        busy={revokingId !== null}
        busyLabel={dictionary.revoking}
        cancelLabel={dictionary.cancel}
        closeLabel={dictionary.close}
        confirmLabel={dictionary.revoke}
        description={
          pendingRevoke
            ? `${dictionary.revoke} ${pendingRevoke.clientName}?`
            : ""
        }
        destructive
        open={pendingRevoke !== null}
        title={dictionary.revoke}
        onConfirm={() => void confirmRevoke()}
        onOpenChange={(open) => {
          if (!open && revokingId === null) setPendingRevoke(null);
        }}
      />
    </section>
  );
}
