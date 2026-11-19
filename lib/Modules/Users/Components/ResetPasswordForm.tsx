"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { PublicAuthCopy } from "@/lib/Modules/Users/Components/InviteAcceptForm";

export function ResetPasswordForm({
  token,
  valid,
  copy,
}: {
  token: string;
  valid: boolean;
  copy: PublicAuthCopy;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/reset-password/${encodeURIComponent(token)}/accept`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ password }),
        },
      );
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) throw new Error(payload?.error ?? copy.failed);
      setDone(true);
    } catch (submitError) {
      setError((submitError as Error).message || copy.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="bg-background text-foreground flex min-h-screen items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{copy.resetTitle}</CardTitle>
          <CardDescription>
            {valid ? copy.resetDescription : copy.invalidReset}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!valid ? (
            <Link
              className="text-sm underline underline-offset-4"
              href="/admin/login"
            >
              {copy.login}
            </Link>
          ) : done ? (
            <div className="space-y-4">
              <p className="text-sm" role="status">
                {copy.resetDone}
              </p>
              <Link
                className="text-sm underline underline-offset-4"
                href="/admin/login"
              >
                {copy.login}
              </Link>
            </div>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(event) => void submit(event)}
            >
              <label
                className="block space-y-1 text-sm"
                htmlFor="reset-password"
              >
                <span>{copy.password}</span>
                <Input
                  id="reset-password"
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
                {busy ? copy.accepting : copy.resetSubmit}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
