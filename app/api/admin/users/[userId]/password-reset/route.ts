import { NextResponse } from "next/server";

import { usersApiError, usersApiForbidden } from "@/lib/Modules/Users/Api";
import { requireTrustedPanelMutation } from "@/lib/Modules/Panel/MutationSecurity";
import { usersService } from "@/lib/Modules/Users/Service";
import { env } from "@/lib/env";

type RouteContext = { params: Promise<{ userId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const gate = await requireTrustedPanelMutation(request);
  if (!gate.ok) return gate.response;
  if (gate.role === "EDITOR") return usersApiForbidden();

  try {
    const { userId } = await context.params;
    const reset = await usersService.createPasswordReset(
      gate.userId,
      userId,
      env.BETTER_AUTH_URL,
    );
    return NextResponse.json({ reset }, { status: 201 });
  } catch (error) {
    return usersApiError(error);
  }
}
