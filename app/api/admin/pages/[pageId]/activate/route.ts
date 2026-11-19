import { NextResponse } from "next/server";

import { pageApiError } from "@/lib/Modules/Pages/Api";
import { requireTrustedPanelMutation } from "@/lib/Modules/Panel/MutationSecurity";
import { pageService } from "@/lib/Modules/Pages/Service";

/** Liga só a revisão publicada — não materializa o rascunho. */
export async function POST(
  request: Request,
  context: { params: Promise<{ pageId: string }> },
) {
  const gate = await requireTrustedPanelMutation(request);
  if (!gate.ok) return gate.response;

  try {
    const { pageId } = await context.params;
    const page = await pageService.activatePage(gate.userId, pageId);
    return NextResponse.json({ page });
  } catch (error) {
    return pageApiError(error);
  }
}
