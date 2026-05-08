import { clearSessionResponse } from "@/lib/auth";
import { handleApiError } from "@/lib/api";

export async function POST() {
  try {
    return await clearSessionResponse();
  } catch (error) {
    return handleApiError(error);
  }
}
