import { handleApiError, jsonOk, parseJson } from "@/lib/api";
import { requireCurrentUser } from "@/lib/auth";
import { createProject, listProjects } from "@/lib/repository";
import { projectInputSchema } from "@/lib/schemas";

export async function GET() {
  try {
    await requireCurrentUser();
    return jsonOk({ projects: await listProjects() });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireCurrentUser();
    const input = projectInputSchema.parse(await parseJson(request));
    const project = await createProject({ ...input, actorId: actor.id });
    return jsonOk({ project }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
