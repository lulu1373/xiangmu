import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDbForTests } from "@/lib/db";
import { applyImportRows, exportRequirementsWorkbook, exportWorkbookToBuffer, parseImportFile } from "@/lib/import-export";
import { createInitialAdmin, createUser, listProjects, listRequirements } from "@/lib/repository";

let tempDir = "";

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "team-progress-import-test-"));
  process.env.TEAM_PROGRESS_DB_PATH = join(tempDir, "test.sqlite");
});

afterEach(async () => {
  closeDbForTests();
  delete process.env.TEAM_PROGRESS_DB_PATH;
  await rm(tempDir, { recursive: true, force: true });
});

describe("import/export", () => {
  it("imports valid CSV rows and exports an xlsx workbook", async () => {
    const admin = await createInitialAdmin({
      name: "管理员",
      email: "admin@example.com",
      password: "StrongPass123",
    });
    await createUser({
      name: "技术同学",
      email: "dev@example.com",
      password: "StrongPass123",
      role: "技术",
      permission: "member",
    });
    const project = listProjects()[0];
    const csv = [
      "编号,标题,所属书籍,类型,背景,来源,验收标准,版本,负责人,参与角色,优先级,状态,开始日期,截止日期,预估工时,实际工时,最近进展,下一步,阻塞问题",
      "REQ-1001,导入需求,亲子关系全面技巧,需求,背景,会议,验收,v1,技术同学,产品、技术,高,进行中,2026-05-01,2026-05-10,8,2,已启动,继续开发,",
    ].join("\n");

    const parsed = await parseImportFile(Buffer.from(csv, "utf8"), "requirements.csv");
    const result = applyImportRows(project.id, parsed.normalizedRows, admin.id);

    const requirements = listRequirements(project.id);
    const workbook = exportRequirementsWorkbook(requirements);
    const xlsx = await exportWorkbookToBuffer(workbook, "xlsx");

    expect(parsed.errors).toHaveLength(0);
    expect(result).toMatchObject({ success: true, created: 1, updated: 0 });
    expect(requirements[0].code).toBe("REQ-1001");
    expect(requirements[0].bookName).toBe("亲子关系全面技巧");
    expect(requirements[0].ownerName).toBe("技术同学");
    expect(xlsx.byteLength).toBeGreaterThan(1000);
  });

  it("does not create or update requirements when import validation fails", async () => {
    const admin = await createInitialAdmin({
      name: "管理员",
      email: "admin@example.com",
      password: "StrongPass123",
    });
    const project = listProjects()[0];
    const csv = [
      "编号,标题,所属书籍,类型,背景,来源,验收标准,版本,负责人,参与角色,优先级,状态,开始日期,截止日期,预估工时,实际工时,最近进展,下一步,阻塞问题",
      "REQ-1002,坏数据,亲子关系全面技巧,需求,背景,会议,验收,v1,不存在的人,产品、技术,高,进行中,,,,,,",
    ].join("\n");

    const parsed = await parseImportFile(Buffer.from(csv, "utf8"), "requirements.csv");
    const result = applyImportRows(project.id, parsed.normalizedRows, admin.id);

    expect(parsed.errors).toHaveLength(0);
    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatchObject({ field: "负责人" });
    expect(listRequirements(project.id)).toHaveLength(0);
  });
});
