import { handleApiError, jsonError } from "@/lib/api";
import { requireCurrentUser } from "@/lib/auth";
import { exportRequirementsWorkbook, exportWorkbookToBuffer } from "@/lib/import-export";
import { listRequirements } from "@/lib/repository";
import { listQuerySchema } from "@/lib/schemas";

export async function GET(request: Request) {
  try {
    await requireCurrentUser();
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    const format = url.searchParams.get("format") === "csv" ? "csv" : "xlsx";
    if (!projectId) return jsonError("project_required", 400);
    const filters = listQuerySchema.parse(Object.fromEntries(url.searchParams.entries()));
    const workbook = exportRequirementsWorkbook(await listRequirements(projectId, filters));
    const buffer = await exportWorkbookToBuffer(workbook, format);
    return new Response(buffer, {
      headers: {
        "Content-Type":
          format === "csv"
            ? "text/csv; charset=utf-8"
            : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="requirements.${format}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
