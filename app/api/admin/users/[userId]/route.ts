import { NextResponse } from "next/server";

import {
  readJson,
  usersApiError,
  usersApiForbidden,
} from "@/lib/Modules/Users/Api";
import { requireTrustedPanelMutation } from "@/lib/Modules/Panel/MutationSecurity";
import { usersService } from "@/lib/Modules/Users/Service";

type RouteContext = { params: Promise<{ userId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const gate = await requireTrustedPanelMutation(request);
  if (!gate.ok) return gate.response;
  if (gate.role === "EDITOR") return usersApiForbidden();

  try {
    const { userId } = await context.params;
    const payload = await readJson(request);
    return NextResponse.json({
      user: await usersService.changeRole(gate.userId, userId, payload),
    });
  } catch (error) {
    return usersApiError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const gate = await requireTrustedPanelMutation(request);
  if (!gate.ok) return gate.response;
  if (gate.role === "EDITOR") return usersApiForbidden();

  try {
    const { userId } = await context.params;
    await usersService.removeUser(gate.userId, userId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return usersApiError(error);
  }
}
