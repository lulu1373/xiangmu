import { getCurrentUser } from "@/lib/auth";
import { jsonOk } from "@/lib/api";

export async function GET() {
  const user = await getCurrentUser();
  return jsonOk({ user });
}
