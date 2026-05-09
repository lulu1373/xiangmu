import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { requireCurrentUser } from "@/lib/auth";
import { applyImportRows, parseImportFile } from "@/lib/import-export";

function isUploadedFile(value: FormDataEntryValue | null): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof value.arrayBuffer === "function" &&
    typeof value.name === "string"
  );
}

export async function POST(request: Request) {
  try {
    const actor = await requireCurrentUser();
    const form = await request.formData();
    const projectId = form.get("projectId");
    const file = form.get("file");
    if (typeof projectId !== "string" || !projectId) return jsonError("project_required", 400);
    if (!isUploadedFile(file)) return jsonError("file_required", 400);
    if (file.size > 5_000_000) return jsonError("file_too_large", 400);
    const lowerName = file.name.toLowerCase();
    if (!lowerName.endsWith(".csv") && !lowerName.endsWith(".xlsx")) {
      return jsonError("unsupported_file_type", 400);
    }

    const parsed = await parseImportFile(Buffer.from(await file.arrayBuffer()), file.name);
    if (parsed.errors.length > 0) {
      return jsonOk({ result: { success: false, created: 0, updated: 0, errors: parsed.errors } });
    }
    const result = await applyImportRows(projectId, parsed.normalizedRows, actor.id, {
      fileName: file.name,
      fileType: lowerName.endsWith(".csv") ? "csv" : "xlsx",
    });
    return jsonOk({ result });
  } catch (error) {
    return handleApiError(error);
  }
}
