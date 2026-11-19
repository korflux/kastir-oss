import { customCodeApiError } from "@/lib/Modules/CustomCode/Api";
import {
  getTrustedPanelMutationAuth,
  panelMutationAuthErrorResponse,
  panelMutationBodyErrorResponse,
  panelMutationForbiddenResponse,
  readConfirmedPanelMutation,
} from "@/lib/Modules/Panel/MutationSecurity";
import { canPermanentlyDelete } from "@/lib/Modules/Panel/Policy";
import { customCodeService } from "@/lib/Modules/CustomCode/Service";

export async function POST(
  request: Request,
  context: { params: Promise<{ snippetId: string }> },
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
    const { snippetId } = await context.params;
    await customCodeService.permanentlyDeleteSnippet(
      apiContext.userId,
      snippetId,
      apiContext.role,
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    return customCodeApiError(error);
  }
}
