import { createLoginResponse } from "@/lib/auth";
import { handleApiError, jsonError, parseJson } from "@/lib/api";
import { getUserByEmail, getUserByLoginCode, verifyPassword } from "@/lib/repository";
import { loginSchema } from "@/lib/schemas";

export async function POST(request: Request) {
  try {
    const input = loginSchema.parse(await parseJson(request));
    const user = input.loginCode ? getUserByLoginCode(input.loginCode) : getUserByEmail(input.email ?? "");
    if (!user) return jsonError("invalid_credentials", 401);
    const valid = await verifyPassword(input.password, user.passwordHash);
    if (!valid) return jsonError("invalid_credentials", 401);
    return createLoginResponse(user.id);
  } catch (error) {
    return handleApiError(error);
  }
}
