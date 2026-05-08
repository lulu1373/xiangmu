import { handleApiError, jsonOk, parseJson } from "@/lib/api";
import { requireAdminUser, requireCurrentUser } from "@/lib/auth";
import { createUser, listUsers } from "@/lib/repository";
import { userInputSchema } from "@/lib/schemas";

export async function GET() {
  try {
    await requireCurrentUser();
    return jsonOk({ users: listUsers() });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireAdminUser();
    const input = userInputSchema.parse(await parseJson(request));
    const password = input.password || "ChangeMe123";
    const email = input.email || `${input.loginCode.toLowerCase()}@team.local`;
    const user = await createUser({
      name: input.name,
      email,
      loginCode: input.loginCode,
      password,
      role: input.role,
      permission: input.permission,
    });
    return jsonOk({ user }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
