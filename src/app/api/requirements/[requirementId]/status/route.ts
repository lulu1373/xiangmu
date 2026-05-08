import { handleApiError, jsonError, jsonOk, parseJson } from "@/lib/api";
import { requireCurrentUser } from "@/lib/auth";
import { updateRequirementStatus } from "@/lib/repository";
import { statusInputSchema } from "@/lib/schemas";

type Context = { params: Promise<{ requirementId: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const actor = await requireCurrentUser();
    const { requirementId } = await context.params;
    const input = statusInputSchema.parse(await parseJson(request));
    const requirement = updateRequirementStatus(requirementId, input.status, actor.id);
    if (!requirement) return jsonError("requirement_not_found", 404);
    return jsonOk({ requirement });
  } catch (error) {
    return handleApiError(error);
  }
}
