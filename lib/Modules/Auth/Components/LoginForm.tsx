"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import packageJson from "@/package.json";
import { BrandLogo } from "@/components/Shared/BrandLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { sanitizeLoginNext } from "@/lib/Modules/Auth/safeNext";
import { loginSchema } from "@/lib/Modules/Auth/Schema";
import type { PanelDictionary } from "@/lib/i18n/panel";

/**
 * Login no visual do painel (Fase 31): marca Kastir + version + form limpo.
 * Assets e tipografia da version iguais ao BrandRail.
 */
export function LoginForm({
  dictionary,
  nextPath = null,
}: {
  dictionary: PanelDictionary;
  nextPath?: string | null;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const safeNext = sanitizeLoginNext(nextPath);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const result = loginSchema.safeParse({ email, password });
    if (!result.success) {
      setError(dictionary.login.invalidForm);
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await authClient.signIn.email({
        email: result.data.email,
        password: result.data.password,
      });

      if (response.error) {
        const status = response.error.status;
        setError(
          status === 429
            ? dictionary.login.tooManyAttempts
            : dictionary.login.invalidCredentials,
        );
        return;
      }

      router.replace(safeNext ?? "/admin");
      router.refresh();
    } catch {
      setError(dictionary.login.unavailable);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main
      className="bg-canvas text-ink flex min-h-svh items-center justify-center px-6 py-16"
      data-testid="login-page"
    >
      <div className="border-border bg-background/60 w-full max-w-md rounded-2xl border p-6 shadow-sm md:p-8">
        {/* Marca: logo K + wordmark + version (mesmo assets do BrandRail). */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <BrandLogo className="h-[29px] w-6" kind="symbol" priority />
          <BrandLogo
            className="h-5 w-[75px]"
            kind="logo"
            label={dictionary.shell.brand}
            priority
          />
          <p className="text-[11px] leading-none">
            <span className="text-brand font-medium">version</span>{" "}
            <span
              className="text-foreground font-extralight"
              data-testid="panel-version"
            >
              {packageJson.version}
            </span>
          </p>
        </div>

        <header className="mb-6 text-center">
          <h1 className="text-foreground text-3xl font-semibold tracking-tight md:text-4xl">
            {dictionary.login.title}
          </h1>
          <p className="text-muted-foreground mt-2 text-sm md:text-base">
            {dictionary.login.description}
          </p>
        </header>

        {/* Antes da hidratação, POST impede que o navegador exponha a senha
            na URL caso o usuário envie o formulário imediatamente. */}
        <form
          action="/api/auth/sign-in/email"
          aria-busy={isSubmitting}
          className="grid gap-4"
          method="post"
          onSubmit={handleSubmit}
        >
          <label className="grid gap-1.5 text-sm" htmlFor="email">
            <span className="text-muted-foreground">
              {dictionary.login.email}
            </span>
            <Input
              autoComplete="email"
              className="h-9 rounded-lg"
              id="email"
              name="email"
              required
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="grid gap-1.5 text-sm" htmlFor="password">
            <span className="text-muted-foreground">
              {dictionary.login.password}
            </span>
            <Input
              autoComplete="current-password"
              className="h-9 rounded-lg"
              id="password"
              name="password"
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}
          <Button
            className="mt-1 h-10 w-full rounded-full"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting
              ? dictionary.login.submitting
              : dictionary.login.submit}
          </Button>
        </form>
      </div>
    </main>
  );
}
