import { handleApiError, jsonError, jsonOk, parseJson } from "@/lib/api";
import { requireCurrentUser } from "@/lib/auth";
import { addProgressUpdate, listProgressUpdates } from "@/lib/repository";
import { progressInputSchema } from "@/lib/schemas";

type Context = { params: Promise<{ requirementId: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    await requireCurrentUser();
    const { requirementId } = await context.params;
    return jsonOk({ progressUpdates: await listProgressUpdates(requirementId) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const actor = await requireCurrentUser();
    const { requirementId } = await context.params;
    const input = progressInputSchema.parse(await parseJson(request));
    const progressUpdate = await addProgressUpdate(requirementId, input, actor.id);
    if (!progressUpdate) return jsonError("requirement_not_found", 404);
    return jsonOk({ progressUpdate }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
