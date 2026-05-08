import { handleApiError, jsonError, jsonOk, parseJson } from "@/lib/api";
import { requireCurrentUser } from "@/lib/auth";
import { getRequirementById, updateRequirement } from "@/lib/repository";
import { requirementInputSchema } from "@/lib/schemas";

type Context = { params: Promise<{ requirementId: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    await requireCurrentUser();
    const { requirementId } = await context.params;
    const requirement = getRequirementById(requirementId);
    if (!requirement) return jsonError("requirement_not_found", 404);
    return jsonOk({ requirement });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const actor = await requireCurrentUser();
    const { requirementId } = await context.params;
    const input = requirementInputSchema.parse(await parseJson(request));
    const requirement = updateRequirement(requirementId, input, actor.id);
    if (!requirement) return jsonError("requirement_not_found", 404);
    return jsonOk({ requirement });
  } catch (error) {
    return handleApiError(error);
  }
}
