import {
  getSettingsApiContext,
  settingsApiError,
  settingsResponse,
  stripSettingsClientFields,
} from "@/lib/Modules/Settings/Api";
import { settingsUpdateRequestSchema } from "@/lib/Modules/Settings/Schema";
import { settingsService } from "@/lib/Modules/Settings/Service";
import {
  PanelMutationBodyError,
  panelMutationBodyErrorResponse,
  readPanelMutationJson,
  requireTrustedPanelMutation,
} from "@/lib/Modules/Panel/MutationSecurity";

function unauthorized() {
  return settingsResponse({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
}

function forbidden() {
  return settingsResponse(
    { error: "Settings are restricted to administrators", code: "FORBIDDEN" },
    403,
  );
}

export async function GET(request: Request) {
  const context = await getSettingsApiContext(request);
  if (!context) return unauthorized();
  if (context.role === "EDITOR") return forbidden();

  try {
    const [settings, options] = await Promise.all([
      settingsService.getSettings(),
      settingsService.listOptions(),
    ]);
    return settingsResponse({ settings, options });
  } catch (error) {
    return settingsApiError(error);
  }
}

export async function PUT(request: Request) {
  const gate = await requireTrustedPanelMutation(request);
  if (!gate.ok) return gate.response;
  if (gate.role === "EDITOR") return forbidden();

  try {
    let rawBody: unknown;
    try {
      rawBody = await readPanelMutationJson(request);
    } catch (error) {
      if (error instanceof PanelMutationBodyError) {
        return panelMutationBodyErrorResponse(error);
      }
      return settingsResponse(
        { error: "Invalid JSON", code: "VALIDATION_ERROR" },
        422,
      );
    }
    const body = stripSettingsClientFields(rawBody);
    const parsedRequest = settingsUpdateRequestSchema.parse(body);
    const requestOrigin = new URL(request.url).origin;
    const result = await settingsService.updateSettings(
      gate.userId,
      parsedRequest,
      {
        requestOrigin,
      },
    );
    const status = result.queueStatus === "FAILED" ? 202 : 200;
    return settingsResponse(
      {
        settings: result.settings,
        rebuild: {
          operationId: result.operationId,
          scope: result.scope,
          affectedPageIds: result.affectedPageIds,
          queueStatus: result.queueStatus,
        },
        ...(result.queueStatus === "FAILED" ? { code: "QUEUE_FAILED" } : {}),
      },
      status,
    );
  } catch (error) {
    return settingsApiError(error);
  }
}
