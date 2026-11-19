"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export type PublicAuthCopy = {
  inviteTitle: string;
  inviteDescription: string;
  invalidInvite: string;
  name: string;
  role: string;
  email: string;
  password: string;
  passwordHint: string;
  accept: string;
  accepting: string;
  failed: string;
  sessionBridgeFailed: string;
  login: string;
  resetTitle: string;
  resetDescription: string;
  invalidReset: string;
  resetSubmit: string;
  resetDone: string;
};

type InviteMeta = { name: string; role: "ADMIN" | "EDITOR" };

export function InviteAcceptForm({
  token,
  invite,
  copy,
}: {
  token: string;
  invite: InviteMeta | null;
  copy: PublicAuthCopy;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bridgeFailed, setBridgeFailed] = useState(false);

  useEffect(() => {
    if (!bridgeFailed) return;
    const timer = window.setTimeout(() => {
      window.location.assign("/admin/login");
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [bridgeFailed]);

  if (!invite) {
    return (
      <PublicCard title={copy.inviteTitle} description={copy.invalidInvite}>
        <Link
          className="text-sm underline underline-offset-4"
          href="/admin/login"
        >
          {copy.login}
        </Link>
      </PublicCard>
    );
  }

  if (bridgeFailed) {
    return (
      <PublicCard
        title={copy.inviteTitle}
        description={copy.sessionBridgeFailed}
      >
        <p className="text-sm" role="status">
          {copy.sessionBridgeFailed}
        </p>
        <Link
          className="mt-4 inline-block text-sm underline underline-offset-4"
          href="/admin/login"
        >
          {copy.login}
        </Link>
      </PublicCard>
    );
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/invite/${encodeURIComponent(token)}/accept`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, password }),
        },
      );
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        code?: string;
      } | null;
      if (
        response.status === 503 &&
        payload?.code === "SESSION_BRIDGE_FAILED"
      ) {
        setBridgeFailed(true);
        return;
      }
      if (!response.ok) throw new Error(payload?.error ?? copy.failed);
      window.location.assign("/admin");
    } catch (submitError) {
      setError((submitError as Error).message || copy.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <PublicCard title={copy.inviteTitle} description={copy.inviteDescription}>
      <div className="border-border bg-muted/30 rounded-lg border p-3 text-sm">
        <p className="font-medium">{invite.name}</p>
        <p className="text-muted-foreground mt-1">
          {copy.role}: {invite.role}
        </p>
      </div>
      <form className="mt-5 space-y-4" onSubmit={(event) => void submit(event)}>
        <label className="block space-y-1 text-sm" htmlFor="invite-email">
          <span>{copy.email}</span>
          <Input
            id="invite-email"
            required
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className="block space-y-1 text-sm" htmlFor="invite-password">
          <span>{copy.password}</span>
          <Input
            id="invite-password"
            minLength={8}
            required
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <span className="text-muted-foreground block text-xs">
            {copy.passwordHint}
          </span>
        </label>
        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
        <Button className="w-full" disabled={busy} type="submit">
          {busy ? copy.accepting : copy.accept}
        </Button>
      </form>
    </PublicCard>
  );
}

function PublicCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <main className="bg-background text-foreground flex min-h-screen items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </main>
  );
}
