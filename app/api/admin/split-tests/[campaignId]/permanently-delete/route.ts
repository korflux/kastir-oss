import { splitTestsApiError } from "@/lib/Modules/SplitTests/Api";
import {
  getTrustedPanelMutationAuth,
  panelMutationAuthErrorResponse,
  panelMutationBodyErrorResponse,
  panelMutationForbiddenResponse,
  readConfirmedPanelMutation,
} from "@/lib/Modules/Panel/MutationSecurity";
import { canPermanentlyDelete } from "@/lib/Modules/Panel/Policy";
import { splitTestsService } from "@/lib/Modules/SplitTests/Service";

export async function POST(
  request: Request,
  context: { params: Promise<{ campaignId: string }> },
) {
  const api = await getTrustedPanelMutationAuth(request);
  if (api.status !== "authenticated")
    return panelMutationAuthErrorResponse(api);
  if (!canPermanentlyDelete(api.role)) return panelMutationForbiddenResponse();

  try {
    await readConfirmedPanelMutation(request);
  } catch (error) {
    return panelMutationBodyErrorResponse(error);
  }

  try {
    const { campaignId } = await context.params;
    await splitTestsService.permanentlyDeleteCampaign(
      api.userId,
      campaignId,
      api.role,
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    return splitTestsApiError(error);
  }
}
