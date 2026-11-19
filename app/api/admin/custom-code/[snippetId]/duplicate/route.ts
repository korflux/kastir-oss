import { NextResponse } from "next/server";

import { customCodeApiError } from "@/lib/Modules/CustomCode/Api";
import { requireTrustedPanelMutation } from "@/lib/Modules/Panel/MutationSecurity";
import { customCodeService } from "@/lib/Modules/CustomCode/Service";

export async function POST(
  request: Request,
  context: { params: Promise<{ snippetId: string }> },
) {
  const gate = await requireTrustedPanelMutation(request);
  if (!gate.ok) return gate.response;

  try {
    const { snippetId } = await context.params;
    const snippet = await customCodeService.duplicateSnippet(
      gate.userId,
      snippetId,
    );
    return NextResponse.json({ snippet }, { status: 201 });
  } catch (error) {
    return customCodeApiError(error);
  }
}
