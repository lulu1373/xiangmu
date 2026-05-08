import { createLoginResponse } from "@/lib/auth";
import { handleApiError, jsonOk, parseJson } from "@/lib/api";
import { createInitialAdmin, hasUsers } from "@/lib/repository";
import { setupSchema } from "@/lib/schemas";

export async function GET() {
  return jsonOk({ needsSetup: !hasUsers() });
}

export async function POST(request: Request) {
  try {
    const input = setupSchema.parse(await parseJson(request));
    const user = await createInitialAdmin(input);
    const response = await createLoginResponse(user.id);
    return response;
  } catch (error) {
    return handleApiError(error);
  }
}
