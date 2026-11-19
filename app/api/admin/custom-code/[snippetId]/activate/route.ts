import { NextResponse } from "next/server";

import { customCodeApiError } from "@/lib/Modules/CustomCode/Api";
import { requireTrustedPanelMutation } from "@/lib/Modules/Panel/MutationSecurity";
import { customCodeService } from "@/lib/Modules/CustomCode/Service";

/** Liga só a revisão publicada — não materializa o rascunho. */
export async function POST(
  request: Request,
  context: { params: Promise<{ snippetId: string }> },
) {
  const gate = await requireTrustedPanelMutation(request);
  if (!gate.ok) return gate.response;

  try {
    const { snippetId } = await context.params;
    const snippet = await customCodeService.activateSnippet(
      gate.userId,
      snippetId,
    );
    return NextResponse.json({ snippet });
  } catch (error) {
    return customCodeApiError(error);
  }
}
