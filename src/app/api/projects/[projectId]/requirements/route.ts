import { handleApiError, jsonOk, parseJson } from "@/lib/api";
import { requireCurrentUser } from "@/lib/auth";
import { createRequirement, listRequirements } from "@/lib/repository";
import { listQuerySchema, requirementInputSchema } from "@/lib/schemas";

type Context = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, context: Context) {
  try {
    await requireCurrentUser();
    const { projectId } = await context.params;
    const url = new URL(request.url);
    const filters = listQuerySchema.parse(Object.fromEntries(url.searchParams.entries()));
    return jsonOk({ requirements: await listRequirements(projectId, filters) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const actor = await requireCurrentUser();
    const { projectId } = await context.params;
    const input = requirementInputSchema.parse(await parseJson(request));
    const requirement = await createRequirement(projectId, input, actor.id);
    return jsonOk({ requirement }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
