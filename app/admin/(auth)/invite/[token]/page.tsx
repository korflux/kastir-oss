import type { Metadata } from "next";

import { headers } from "next/headers";

import { InviteAcceptForm } from "@/lib/Modules/Users/Components/InviteAcceptForm";
import { usersService } from "@/lib/Modules/Users/Service";
import { isUserTokenRequestAllowed } from "@/lib/Modules/Users/RateLimit";
import { env } from "@/lib/env";
import { getPublicAuthCopy } from "@/lib/i18n/users";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  let invite = null;
  try {
    const request = new Request(`https://token.invalid/admin/invite/${token}`, {
      headers: await headers(),
    });
    if (await isUserTokenRequestAllowed(request, token)) {
      invite = await usersService.getInviteMeta(token);
    }
  } catch {
    // Keep invalid, expired and used links indistinguishable in the UI.
  }

  return (
    <InviteAcceptForm
      copy={getPublicAuthCopy(env.PANEL_LANGUAGE)}
      invite={invite}
      token={token}
    />
  );
}
