import { describe, expect, it } from "vitest";
import {
  buildBookAssessmentImportResponse,
  buildPrompt,
  detectBookAssessmentDeliverable,
  extractTextFromDocument,
  normalizeAiTasksForImport,
} from "@/lib/ai-import";
import type { Requirement, User } from "@/lib/types";

describe("ai import helpers", () => {
  it("extracts plain text from markdown documents", async () => {
    const text = await extractTextFromDocument(
      "weekly.md",
      Buffer.from("# 周报\n\n- 完成项目同步后台\n- 卡点：需要技术联调", "utf8"),
    );

    expect(text).toContain("完成项目同步后台");
    expect(text).toContain("需要技术联调");
  });

  it("normalizes AI tasks with owner fallback and existing title match", () => {
    const users: User[] = [
      {
        id: "u1",
        name: "小王",
        email: "wang@example.com",
        loginCode: "WANG01",
        role: "产品",
        permission: "admin",
        createdAt: "",
        updatedAt: "",
      },
      {
        id: "u2",
        name: "小李",
        email: "li@example.com",
        loginCode: "LIX001",
        role: "技术",
        permission: "member",
        createdAt: "",
        updatedAt: "",
      },
    ];
    const existingRequirements: Requirement[] = [
      {
        id: "r1",
        projectId: "p1",
        code: "REQ-0012",
        title: "后台自动导入",
        bookName: "",
        type: "任务",
        background: "",
        source: "",
        acceptanceCriteria: "",
        version: "",
        ownerId: "u2",
        ownerName: "小李",
        participantRoles: ["产品", "技术"],
        priority: "中",
        status: "进行中",
        startDate: null,
        dueDate: null,
        estimatedHours: null,
        actualHours: null,
        latestProgress: "",
        nextStep: "",
        blocker: "",
        createdBy: "u1",
        updatedBy: "u1",
        createdAt: "",
        updatedAt: "",
      },
    ];

    const normalized = normalizeAiTasksForImport({
      aiResponse: {
        summary: "整理出 1 条更新任务",
        tasks: [
          {
            code: "",
            title: "后台自动导入",
            ownerName: "",
            participantRoles: ["技术"],
            priority: "高",
            status: "阻塞",
            latestProgress: "上传和抽取已完成",
            nextStep: "接 Right Code",
            blocker: "需要产品确认字段最简方案",
            background: "周报提到自动导入",
            needsHelpFrom: ["产品"],
          },
        ],
      },
      users,
      fallbackUser: users[0],
      existingRequirements,
      fileName: "weekly.md",
      bookName: "亲子关系全面技巧",
    });

    expect(normalized.rows[0].code).toBe("REQ-0012");
    expect(normalized.rows[0].bookName).toBe("亲子关系全面技巧");
    expect(normalized.rows[0].ownerName).toBe("小李");
    expect(normalized.rows[0].nextStep).toContain("需要 产品 配合");
    expect(normalized.rows[0].source).toBe("AI文档导入：weekly.md");
  });

  it("adds book assessment funnel context for the schoolbag assessment project", () => {
    const prompt = buildPrompt(
      "书包测评项目",
      "第 1 章测评内容已产出，待接入亲智聊小程序。",
      [
        {
          id: "u1",
          name: "小王",
          email: "wang@example.com",
          loginCode: "WANG01",
          role: "产品",
          permission: "admin",
          createdAt: "",
          updatedAt: "",
        },
      ],
      [],
      "chapter-1-complete.md",
    );

    expect(prompt).toContain("这个项目是书包测评项目，不是亲智聊项目。");
    expect(prompt).toContain("亲智聊小程序是最终承载入口");
    expect(prompt).toContain("5道标签题");
  });

  it("detects structured book assessment chapter files", () => {
    const text = `# 第一章测评｜做好家长，正确的信念比行动更重要

## 零、 Role 1 · 章节提炼

## 一、 理论框架 (Role 2)

## 二、 问卷题目 (Role 3)

*   [x] 已完成`;

    const info = detectBookAssessmentDeliverable({
      projectName: "书包测评项目",
      fileName: "chapter-1-complete.md",
      documentText: text,
    });

    expect(info).toEqual({
      chapterLabel: "第一章",
      chapterTitle: "做好家长，正确的信念比行动更重要",
      readyForReview: true,
    });

    const response = buildBookAssessmentImportResponse(info!, { bookName: "亲子关系全面技巧" });
    expect(response.summary).toContain("第一章");
    expect(response.tasks[0].title).toBe("第一章测评内容产出");
    expect(response.tasks[0].bookName).toBe("亲子关系全面技巧");
    expect(response.tasks[0].status).toBe("待验收");
    expect(response.tasks[0].nextStep).toContain("亲智聊小程序");
  });
});
