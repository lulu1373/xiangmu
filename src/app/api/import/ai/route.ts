import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { requireCurrentUser } from "@/lib/auth";
import { importTasksFromDocuments } from "@/lib/ai-import";

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
    const bookName = form.get("bookName");
    const fileValues = form.getAll("file");
    const rightCodeToken = form.get("rightCodeToken");

    if (typeof projectId !== "string" || !projectId) return jsonError("project_required", 400);
    const files = fileValues.filter(isUploadedFile);
    if (files.length === 0) return jsonError("file_required", 400);
    if (files.some((file) => file.size > 5_000_000)) return jsonError("file_too_large", 400);

    const unsupportedFile = files.find((file) => {
      const lowerName = file.name.toLowerCase();
      return !(
        lowerName.endsWith(".md") ||
        lowerName.endsWith(".markdown") ||
        lowerName.endsWith(".txt") ||
        lowerName.endsWith(".docx")
      );
    });
    if (unsupportedFile) return jsonError("unsupported_document_type", 400);

    const result = await importTasksFromDocuments({
      projectId,
      actor,
      files: await Promise.all(
        files.map(async (file) => ({
          fileName: file.name,
          fileBuffer: Buffer.from(await file.arrayBuffer()),
        })),
      ),
      bookName: typeof bookName === "string" ? bookName : undefined,
      rightCodeToken: typeof rightCodeToken === "string" ? rightCodeToken : undefined,
    });

    return jsonOk({ result });
  } catch (error) {
    return handleApiError(error);
  }
}
