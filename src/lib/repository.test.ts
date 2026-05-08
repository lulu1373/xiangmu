import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_PROJECTS, PROJECT_TRACKS } from "@/lib/constants";
import { closeDbForTests } from "@/lib/db";
import {
  addProgressUpdate,
  createInitialAdmin,
  createProject,
  createRequirement,
  createUser,
  getUserByEmail,
  getUserByLoginCode,
  listProgressUpdates,
  listProjects,
  listRequirements,
  updateRequirementStatus,
  verifyPassword,
} from "@/lib/repository";

let tempDir = "";

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "team-progress-test-"));
  process.env.TEAM_PROGRESS_DB_PATH = join(tempDir, "test.sqlite");
});

afterEach(async () => {
  closeDbForTests();
  delete process.env.TEAM_PROGRESS_DB_PATH;
  await rm(tempDir, { recursive: true, force: true });
});

describe("repository", () => {
  it("creates the initial admin and the five default projects", async () => {
    const admin = await createInitialAdmin({
      name: "负责人",
      email: "lead@example.com",
      password: "StrongPass123",
    });

    const stored = getUserByEmail("lead@example.com");
    const storedByLoginCode = getUserByLoginCode("ADMIN1");
    const projects = listProjects();

    expect(admin.permission).toBe("admin");
    expect(admin.loginCode).toBe("ADMIN1");
    expect(stored).not.toBeNull();
    expect(storedByLoginCode?.id).toBe(admin.id);
    expect(await verifyPassword("StrongPass123", stored!.passwordHash)).toBe(true);
    expect(projects.map((project) => project.name)).toEqual(expect.arrayContaining(Array.from(DEFAULT_PROJECTS)));
    expect(projects).toHaveLength(6);
    const addedProject = projects.find((item) => item.name === "《最好的孩子在我家》书籍编辑运营项目");
    expect(addedProject).toBeDefined();
    expect(addedProject?.overallProgress).toBe(0);
    expect(addedProject?.riskLevel).toBe("中");
    expect(PROJECT_TRACKS.every((track) => addedProject?.trackSummaries[track].progress === 0)).toBe(true);
  });

  it("stores progress updates and writes a status change history", async () => {
    const admin = await createInitialAdmin({
      name: "产品负责人",
      email: "pm@example.com",
      password: "StrongPass123",
    });
    const engineer = await createUser({
      name: "技术同学",
      email: "dev@example.com",
      password: "StrongPass123",
      role: "技术",
      permission: "member",
    });
    const project = listProjects()[0];
    const requirement = createRequirement(
      project.id,
      {
        title: "完成需求表 MVP",
        bookName: "亲子关系全面技巧",
        type: "需求",
        background: "同步跨角色进展",
        source: "内部",
        acceptanceCriteria: "可以更新进度和状态",
        version: "v1",
        ownerId: engineer.id,
        participantRoles: ["产品", "技术"],
        priority: "高",
        status: "待开始",
        startDate: null,
        dueDate: null,
        estimatedHours: 8,
        actualHours: null,
        latestProgress: "",
        nextStep: "",
        blocker: "",
      },
      admin.id,
    );

    expect(requirement?.code).toBe("REQ-0001");

    const statusResult = updateRequirementStatus(requirement!.id, "进行中", engineer.id);
    addProgressUpdate(
      requirement!.id,
      {
        progress: "已完成表格和看板主流程。",
        nextStep: "补导入导出。",
        blocker: "",
        status: "待验收",
      },
      engineer.id,
    );

    const stored = listRequirements(project.id)[0];
    const filtered = listRequirements(project.id, { bookName: "亲子关系全面技巧" });
    const updates = listProgressUpdates(requirement!.id);

    expect(statusResult?.status).toBe("进行中");
    expect(stored.status).toBe("待验收");
    expect(stored.bookName).toBe("亲子关系全面技巧");
    expect(filtered).toHaveLength(1);
    expect(stored.latestProgress).toBe("已完成表格和看板主流程。");
    expect(updates).toHaveLength(2);
    expect(updates.map((update) => update.newStatus)).toEqual(["待验收", "进行中"]);
  });

  it("stores project overview fields and track summaries", async () => {
    const admin = await createInitialAdmin({
      name: "总负责人",
      email: "owner@example.com",
      password: "StrongPass123",
    });

    const project = createProject({
      actorId: admin.id,
      name: "新项目总览测试",
      projectType: "其他",
      description: "用于验证老板总览层字段。",
      status: "active",
      ownerId: admin.id,
      priority: "高",
      startDate: "2026-05-01",
      targetDate: "2026-06-01",
      completedDate: null,
      overallProgress: 68,
      department: "产品研发部",
      budget: 20000,
      actualSpend: 5600,
      riskLevel: "高",
      milestone: "完成首页总览和项目详情改版",
      documentLink: "https://example.com/doc",
      note: "需要老板确认展示字段",
      trackSummaries: {
        研发: { progress: 60, summary: "结构搭建", completed: "数据层改造", pending: "联调" },
        产品: { progress: 80, summary: "需求收敛", completed: "字段定义", pending: "验收文案" },
      },
    });

    expect(project?.projectType).toBe("其他");
    expect(project?.ownerName).toBe("总负责人");
    expect(project?.overallProgress).toBe(68);
    expect(project?.department).toBe("产品研发部");
    expect(project?.riskLevel).toBe("高");
    expect(project?.trackSummaries.研发.completed).toBe("数据层改造");
    expect(project?.trackSummaries.运营.progress).toBe(0);
  });
});
