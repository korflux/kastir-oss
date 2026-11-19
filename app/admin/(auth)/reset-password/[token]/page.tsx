import type { Metadata } from "next";

import { ResetPasswordForm } from "@/lib/Modules/Users/Components/ResetPasswordForm";
import { headers } from "next/headers";

import { usersService } from "@/lib/Modules/Users/Service";
import { isUserTokenRequestAllowed } from "@/lib/Modules/Users/RateLimit";
import { env } from "@/lib/env";
import { getPublicAuthCopy } from "@/lib/i18n/users";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  let valid = false;
  try {
    const request = new Request(
      `https://token.invalid/admin/reset-password/${token}`,
      {
        headers: await headers(),
      },
    );
    if (await isUserTokenRequestAllowed(request, token)) {
      await usersService.getPasswordResetMeta(token);
      valid = true;
    }
  } catch {
    // Keep invalid, expired and used links indistinguishable in the UI.
  }

  return (
    <ResetPasswordForm
      copy={getPublicAuthCopy(env.PANEL_LANGUAGE)}
      token={token}
      valid={valid}
    />
  );
}
