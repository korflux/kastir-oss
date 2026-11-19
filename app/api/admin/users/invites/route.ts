import { NextResponse } from "next/server";

import {
  readJson,
  usersApiError,
  usersApiForbidden,
} from "@/lib/Modules/Users/Api";
import { requireTrustedPanelMutation } from "@/lib/Modules/Panel/MutationSecurity";
import { usersService } from "@/lib/Modules/Users/Service";
import { env } from "@/lib/env";

export async function POST(request: Request) {
  const gate = await requireTrustedPanelMutation(request);
  if (!gate.ok) return gate.response;
  if (gate.role === "EDITOR") return usersApiForbidden();

  try {
    const invite = await usersService.createInvite(
      gate.userId,
      await readJson(request),
      env.BETTER_AUTH_URL,
    );
    return NextResponse.json(
      { inviteUrl: invite.url, expiresAt: invite.expiresAt },
      { status: 201 },
    );
  } catch (error) {
    return usersApiError(error);
  }
}
