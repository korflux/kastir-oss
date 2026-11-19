"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { PanelDictionary } from "@/lib/i18n/panel";
import { grantedOAuthConsentScopes } from "@/lib/Modules/Mcp/Policy";
import type { EffectiveRole } from "@/lib/Modules/Panel/Types";
import type { McpScope } from "@/lib/Modules/Mcp/Scopes";

type ConsentCopy = PanelDictionary["mcpConsent"];

/** Consentimento OAuth MCP — marca DCR como não verificado e exige checar redirect. */
export function ConsentScreen({
  client,
  dictionary,
  grantedScopes,
  oauthQuery,
  redirectUri,
  requestedScopes,
  resource,
  role,
}: {
  client: {
    clientId: string;
    name: string;
    icon: string | null;
    verified: boolean;
  };
  dictionary: ConsentCopy;
  grantedScopes: McpScope[];
  oauthQuery: string;
  redirectUri: string;
  requestedScopes: string[];
  resource: string;
  role: EffectiveRole;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const grantedOAuthScopes = grantedOAuthConsentScopes(
    role,
    grantedScopes,
    requestedScopes,
  );

  async function submit(accept: boolean) {
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/oauth2/consent", {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          accept,
          oauth_query: oauthQuery,
          ...(accept && grantedOAuthScopes.length
            ? { scope: grantedOAuthScopes.join(" ") }
            : {}),
        }),
      });
      const payload = (await response.json()) as {
        redirect_uri?: unknown;
        url?: unknown;
      };

      const redirectUrl =
        typeof payload.redirect_uri === "string"
          ? payload.redirect_uri
          : typeof payload.url === "string"
            ? payload.url
            : null;

      if (!response.ok || !redirectUrl) {
        throw new Error("consent_failed");
      }

      window.location.assign(redirectUrl);
    } catch {
      setError(dictionary.error);
      setIsSubmitting(false);
    }
  }

  return (
    <main className="bg-canvas text-ink flex min-h-screen items-center justify-center px-6 py-16">
      <Card className="shadow-subtle w-full max-w-xl">
        <CardHeader className="gap-3 border-b">
          <p className="text-muted-foreground text-xs font-semibold tracking-[0.14em] uppercase">
            {dictionary.eyebrow}
          </p>
          <CardTitle>
            <h1>{dictionary.title}</h1>
          </CardTitle>
          <CardDescription>{dictionary.description}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 pt-5">
          <div className="grid gap-1">
            <span className="text-muted-foreground text-xs uppercase">
              {dictionary.client}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <strong>{client.name}</strong>
              {client.verified ? null : (
                <Badge variant="destructive">
                  {dictionary.unverifiedBadge}
                </Badge>
              )}
            </div>
            <code className="text-sm break-all">{client.clientId}</code>
            {client.verified ? null : (
              <p className="text-destructive text-sm" role="status">
                {dictionary.unverifiedWarning}
              </p>
            )}
          </div>
          <div className="grid gap-1">
            <span className="text-muted-foreground text-xs uppercase">
              {dictionary.redirectUri}
            </span>
            <code className="text-xs break-all">{redirectUri}</code>
          </div>
          <div className="grid gap-1">
            <span className="text-muted-foreground text-xs uppercase">
              {dictionary.resource}
            </span>
            <code className="text-xs break-all">{resource}</code>
          </div>
          <div className="grid gap-2">
            <span className="text-sm font-medium">
              {dictionary.scopesTitle}
            </span>
            <ul className="border-border divide-border divide-y rounded-lg border">
              {requestedScopes.map((scope) => {
                const isGranted = grantedOAuthScopes.includes(scope);
                const label =
                  dictionary.scopes[scope as McpScope] ??
                  dictionary.unknownScope;

                return (
                  <li
                    className="flex items-center justify-between gap-4 px-3 py-2 text-sm"
                    key={scope}
                  >
                    <span>
                      {label}
                      <code className="text-muted-foreground ml-2 text-xs">
                        {scope}
                      </code>
                    </span>
                    <span
                      className={
                        isGranted ? "text-success" : "text-destructive"
                      }
                    >
                      {isGranted ? dictionary.allowed : dictionary.notAllowed}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
          {error ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              disabled={isSubmitting}
              onClick={() => submit(false)}
              type="button"
              variant="outline"
            >
              {dictionary.deny}
            </Button>
            <Button
              disabled={isSubmitting || grantedOAuthScopes.length === 0}
              onClick={() => submit(true)}
              type="button"
            >
              {isSubmitting ? dictionary.working : dictionary.allow}
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
