import ExcelJS from "exceljs";
import {
  IMPORT_HEADERS,
  REQUIREMENT_PRIORITIES,
  REQUIREMENT_STATUSES,
  REQUIREMENT_TYPES,
  TEAM_ROLES,
  type RequirementPriority,
  type RequirementStatus,
  type RequirementType,
  type TeamRole,
} from "@/lib/constants";
import { withTransaction } from "@/lib/db";
import {
  createRequirement,
  findUserByName,
  getProjectById,
  getRequirementByProjectAndCode,
  recordImportBatch,
  updateRequirement,
} from "@/lib/repository";
import type { ImportErrorDetail, ImportPreviewRow, ImportResult, Requirement } from "@/lib/types";

type RawRow = Record<string, unknown>;

function normalizeCell(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

function parseOptionalDate(value: string) {
  if (!value) return null;
  const normalized = value.replace(/\//g, "-");
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function parseOptionalNumber(value: string) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseRoles(value: string) {
  if (!value) return [] as TeamRole[];
  const roles = value
    .split(/[、,，/|]/)
    .map((role) => role.trim())
    .filter(Boolean) as TeamRole[];
  return Array.from(new Set(roles));
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let insideQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (insideQuotes) {
      if (char === '"' && nextChar === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        insideQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      insideQuotes = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }

  row.push(cell);
  rows.push(row);
  return rows.filter((cells) => cells.some((value) => value.trim() !== ""));
}

function rowsToObjects(rows: string[][]) {
  const headers = rows[0]?.map((value) => value.trim()) ?? [];
  return rows.slice(1).map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])),
  );
}

function cellText(cell: ExcelJS.Cell) {
  const value = cell.value;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object" && value !== null && "text" in value) {
    return normalizeCell((value as { text?: unknown }).text);
  }
  if (typeof value === "object" && value !== null && "result" in value) {
    return normalizeCell((value as { result?: unknown }).result);
  }
  return normalizeCell(value);
}

async function readSheetRows(buffer: Buffer, fileName: string) {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (ext === "csv") return rowsToObjects(parseCsv(buffer.toString("utf8")));

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];
  const headers = worksheet.getRow(1).values;
  const headerValues = Array.isArray(headers) ? headers.slice(1).map(normalizeCell) : [];
  const rows: RawRow[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const values = row.values;
    const cellValues = Array.isArray(values) ? values.slice(1) : [];
    const record = Object.fromEntries(
      headerValues.map((header, index) => {
        const cell = row.getCell(index + 1);
        return [header, cellText(cell) || normalizeCell(cellValues[index])];
      }),
    );
    if (Object.values(record).some((value) => normalizeCell(value) !== "")) rows.push(record);
  });
  return rows;
}

export function buildImportTemplate() {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("template");
  worksheet.addRow(Array.from(IMPORT_HEADERS));
  worksheet.getRow(1).font = { bold: true };
  worksheet.columns = IMPORT_HEADERS.map((header) => ({ header, key: header, width: 18 }));
  return workbook;
}

export function exportRequirementsWorkbook(requirements: Requirement[]) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("requirements");
  worksheet.columns = IMPORT_HEADERS.map((header) => ({ header, key: header, width: 18 }));
  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).alignment = { vertical: "middle" };
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  for (const item of requirements) {
    worksheet.addRow({
      编号: item.code,
      标题: item.title,
      所属书籍: item.bookName,
      类型: item.type,
      背景: item.background,
      来源: item.source,
      验收标准: item.acceptanceCriteria,
      版本: item.version,
      负责人: item.ownerName,
      参与角色: item.participantRoles.join("、"),
      优先级: item.priority,
      状态: item.status,
      开始日期: item.startDate ?? "",
      截止日期: item.dueDate ?? "",
      预估工时: item.estimatedHours ?? "",
      实际工时: item.actualHours ?? "",
      最近进展: item.latestProgress,
      下一步: item.nextStep,
      阻塞问题: item.blocker,
    });
  }
  return workbook;
}

function csvEscape(value: unknown) {
  const text = normalizeCell(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export async function exportWorkbookToBuffer(workbook: ExcelJS.Workbook, format: "xlsx" | "csv") {
  if (format === "csv") {
    const worksheet = workbook.worksheets[0];
    const lines: string[] = [];
    worksheet.eachRow((row) => {
      const values = row.values;
      const cells = Array.isArray(values) ? values.slice(1) : [];
      lines.push(cells.map(csvEscape).join(","));
    });
    return Buffer.from(lines.join("\n"), "utf8");
  }
  const output = await workbook.xlsx.writeBuffer();
  return Buffer.from(output);
}

export function validateImportRows(rows: RawRow[]) {
  const errors: ImportErrorDetail[] = [];
  const normalizedRows: ImportPreviewRow[] = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const record = Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key.trim(), normalizeCell(value)]),
    );

    const title = record.标题 || record.title || "";
    const code = record.编号 || record.code || "";
    const bookName = record.所属书籍 || record.bookName || "";
    const ownerName = record.负责人 || record.ownerName || "";
    const status = record.状态 || record.status || "待开始";
    const priority = record.优先级 || record.priority || "中";
    const type = record.类型 || record.type || "需求";
    const roleText = record.参与角色 || record.participantRoles || "";

    if (!title) errors.push({ row: rowNumber, field: "标题", message: "标题不能为空" });
    if (!ownerName) errors.push({ row: rowNumber, field: "负责人", message: "负责人不能为空" });
    if (!REQUIREMENT_STATUSES.includes(status as (typeof REQUIREMENT_STATUSES)[number])) {
      errors.push({ row: rowNumber, field: "状态", message: "状态不合法" });
    }
    if (!REQUIREMENT_PRIORITIES.includes(priority as (typeof REQUIREMENT_PRIORITIES)[number])) {
      errors.push({ row: rowNumber, field: "优先级", message: "优先级不合法" });
    }
    if (!REQUIREMENT_TYPES.includes(type as (typeof REQUIREMENT_TYPES)[number])) {
      errors.push({ row: rowNumber, field: "类型", message: "类型不合法" });
    }

    const participantRoles = parseRoles(roleText);
    if (participantRoles.length === 0) {
      errors.push({ row: rowNumber, field: "参与角色", message: "至少选择一个参与角色" });
    }
    for (const role of participantRoles) {
      if (!TEAM_ROLES.includes(role)) {
        errors.push({ row: rowNumber, field: "参与角色", message: `角色不合法：${role}` });
      }
    }

    normalizedRows.push({
      code,
      title,
      bookName,
      type,
      background: record.背景 || record.background || "",
      source: record.来源 || record.source || "",
      acceptanceCriteria: record.验收标准 || record.acceptanceCriteria || "",
      version: record.版本 || record.version || "",
      ownerName,
      participantRoles,
      priority,
      status,
      startDate: parseOptionalDate(record.开始日期 || record.startDate || ""),
      dueDate: parseOptionalDate(record.截止日期 || record.dueDate || ""),
      estimatedHours: parseOptionalNumber(record.预估工时 || record.estimatedHours || ""),
      actualHours: parseOptionalNumber(record.实际工时 || record.actualHours || ""),
      latestProgress: record.最近进展 || record.latestProgress || "",
      nextStep: record.下一步 || record.nextStep || "",
      blocker: record.阻塞问题 || record.blocker || "",
    });
  });

  return { normalizedRows, errors };
}

export async function parseImportFile(buffer: Buffer, fileName: string) {
  const rows = await readSheetRows(buffer, fileName);
  return validateImportRows(rows);
}

export async function applyImportRows(
  projectId: string,
  rows: ImportPreviewRow[],
  actorId: string,
  meta?: { fileName?: string; fileType?: string },
): Promise<ImportResult> {
  const existingProject = await getProjectById(projectId);
  if (!existingProject) {
    throw new Error("project_not_found");
  }

  const errors: ImportErrorDetail[] = [];
  const seenCodes = new Set<string>();
  const operations: Array<{
    existingId: string | null;
    payload: Parameters<typeof createRequirement>[1];
  }> = [];
  let created = 0;
  let updated = 0;

  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 2;
    const owner = await findUserByName(row.ownerName);
    if (!owner) {
      errors.push({ row: rowNumber, field: "负责人", message: `未找到成员：${row.ownerName}` });
      continue;
    }

    if (!row.title) {
      errors.push({ row: rowNumber, field: "标题", message: "标题不能为空" });
      continue;
    }
    if (row.code) {
      const codeKey = row.code.toLowerCase();
      if (seenCodes.has(codeKey)) {
        errors.push({ row: rowNumber, field: "编号", message: `导入文件内编号重复：${row.code}` });
        continue;
      }
      seenCodes.add(codeKey);
    }

    const existing = row.code ? await getRequirementByProjectAndCode(projectId, row.code) : null;
    const payload = {
      code: row.code || undefined,
      title: row.title,
      bookName: row.bookName,
      type: row.type as RequirementType,
      background: row.background,
      source: row.source,
      acceptanceCriteria: row.acceptanceCriteria,
      version: row.version,
      ownerId: owner.id,
      participantRoles: row.participantRoles,
      priority: row.priority as RequirementPriority,
      status: row.status as RequirementStatus,
      startDate: row.startDate,
      dueDate: row.dueDate,
      estimatedHours: row.estimatedHours,
      actualHours: row.actualHours,
      latestProgress: row.latestProgress,
      nextStep: row.nextStep,
      blocker: row.blocker,
    };

    operations.push({ existingId: existing?.id ?? null, payload });
  }

  if (errors.length === 0) {
    await withTransaction(async (tx) => {
      for (const operation of operations) {
        if (operation.existingId) {
          await updateRequirement(operation.existingId, operation.payload, actorId, tx);
          updated += 1;
        } else {
          await createRequirement(projectId, operation.payload, actorId, tx);
          created += 1;
        }
      }
    });
  }

  const result = {
    success: errors.length === 0,
    created,
    updated,
    errors,
  };

  await recordImportBatch({
    projectId,
    userId: actorId,
    fileName: meta?.fileName ?? existingProject.name,
    fileType: meta?.fileType ?? "import",
    rowCount: rows.length,
    created,
    updated,
    errors,
  });

  return result;
}
