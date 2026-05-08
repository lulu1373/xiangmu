import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ success: true, data }, init);
}

export function jsonError(error: string, status = 400, details?: unknown) {
  return NextResponse.json({ success: false, error, details }, { status });
}

export async function parseJson(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new Error("invalid_json");
  }
}

export function handleApiError(error: unknown) {
  if (error instanceof ZodError) {
    return jsonError("invalid_request", 400, error.flatten());
  }
  if (error instanceof Error) {
    if (error.message === "invalid_json") return jsonError("invalid_json", 400);
    if (error.message === "unauthorized") return jsonError("unauthorized", 401);
    if (error.message === "forbidden") return jsonError("forbidden", 403);
    if (error.message.endsWith("_not_found")) return jsonError(error.message, 404);
    if (error.message === "setup_already_completed") return jsonError("setup_already_completed", 409);
    if (error.message.includes("UNIQUE constraint failed")) return jsonError("duplicate_record", 409);
    if (error.message === "owner_not_found") return jsonError("owner_not_found", 400);
    if (error.message === "unsupported_document_type") return jsonError("unsupported_document_type", 400);
    if (error.message === "empty_document") return jsonError("empty_document", 400);
    if (error.message === "right_code_token_missing") return jsonError("right_code_token_missing", 400);
    if (error.message.startsWith("Right Code GPT request failed:")) return jsonError("right_code_upstream_failed", 502);
  }
  return jsonError("internal_error", 500);
}
