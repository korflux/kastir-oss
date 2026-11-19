import { NextResponse } from "next/server";

import { profileUpdateSchema } from "@/lib/Modules/Panel/ProfileSchema";
import { requireTrustedPanelMutation } from "@/lib/Modules/Panel/MutationSecurity";
import { prisma } from "@/lib/prisma";

export async function PUT(request: Request) {
  const gate = await requireTrustedPanelMutation(request);
  if (!gate.ok) return gate.response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = profileUpdateSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid profile" }, { status: 400 });
  }

  const user = await prisma.user.update({
    where: { id: gate.userId },
    data: { name: parsed.data.name },
    select: { name: true },
  });

  return NextResponse.json({ user });
}
