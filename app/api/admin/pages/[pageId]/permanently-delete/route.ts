import { pageApiError } from "@/lib/Modules/Pages/Api";
import {
  getTrustedPanelMutationAuth,
  panelMutationAuthErrorResponse,
  panelMutationBodyErrorResponse,
  panelMutationForbiddenResponse,
  readConfirmedPanelMutation,
} from "@/lib/Modules/Panel/MutationSecurity";
import { canPermanentlyDelete } from "@/lib/Modules/Panel/Policy";
import { pageService } from "@/lib/Modules/Pages/Service";

export async function POST(
  request: Request,
  context: { params: Promise<{ pageId: string }> },
) {
  const apiContext = await getTrustedPanelMutationAuth(request);
  if (apiContext.status !== "authenticated")
    return panelMutationAuthErrorResponse(apiContext);
  if (!canPermanentlyDelete(apiContext.role))
    return panelMutationForbiddenResponse();

  try {
    await readConfirmedPanelMutation(request);
  } catch (error) {
    return panelMutationBodyErrorResponse(error);
  }

  try {
    const { pageId } = await context.params;
    await pageService.permanentlyDeletePage(
      apiContext.userId,
      pageId,
      apiContext.role,
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    return pageApiError(error);
  }
}
