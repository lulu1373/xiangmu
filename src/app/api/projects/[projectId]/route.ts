import { handleApiError, jsonError, jsonOk, parseJson } from "@/lib/api";
import { requireCurrentUser } from "@/lib/auth";
import { getProjectById, updateProject } from "@/lib/repository";
import { projectInputSchema } from "@/lib/schemas";

type Context = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    await requireCurrentUser();
    const { projectId } = await context.params;
    const project = getProjectById(projectId);
    if (!project) return jsonError("project_not_found", 404);
    return jsonOk({ project });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const actor = await requireCurrentUser();
    const { projectId } = await context.params;
    const input = projectInputSchema.parse(await parseJson(request));
    const project = updateProject(projectId, input, actor.id);
    if (!project) return jsonError("project_not_found", 404);
    return jsonOk({ project });
  } catch (error) {
    return handleApiError(error);
  }
}
