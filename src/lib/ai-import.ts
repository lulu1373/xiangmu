import mammoth from "mammoth";
import { z } from "zod";
import { normalizeBookName, resolveBookOwnerName } from "@/lib/book-catalog";
import { REQUIREMENT_PRIORITIES, REQUIREMENT_STATUSES, TEAM_ROLES, type TeamRole } from "@/lib/constants";
import { applyImportRows } from "@/lib/import-export";
import { getProjectById, listRequirements, listUsers } from "@/lib/repository";
import type { ImportPreviewRow, ImportResult, Requirement, User } from "@/lib/types";

const AI_TASK_SCHEMA = z.object({
  code: z.string().trim().max(40).optional().default(""),
  title: z.string().trim().min(1).max(140),
  bookName: z.string().trim().max(80).optional().default(""),
  ownerName: z.string().trim().max(60).optional().default(""),
  participantRoles: z.array(z.string().trim()).max(5).optional().default([]),
  priority: z.enum(REQUIREMENT_PRIORITIES).optional().default("中"),
  status: z.enum(REQUIREMENT_STATUSES).optional().default("待开始"),
  latestProgress: z.string().trim().max(2000).optional().default(""),
  nextStep: z.string().trim().max(2000).optional().default(""),
  blocker: z.string().trim().max(2000).optional().default(""),
  background: z.string().trim().max(3000).optional().default(""),
  needsHelpFrom: z.array(z.string().trim()).max(5).optional().default([]),
});

const AI_RESPONSE_SCHEMA = z.object({
  summary: z.string().trim().max(2000).optional().default(""),
  tasks: z.array(AI_TASK_SCHEMA).min(1).max(50),
});

type AiTask = z.infer<typeof AI_TASK_SCHEMA>;
type AiResponse = z.infer<typeof AI_RESPONSE_SCHEMA>;

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

type ParsedJsonCandidate = {
  parsed: unknown;
  source: "raw" | "fenced" | "object_slice";
};

type StructuredBookAssessmentInfo = {
  chapterLabel: string;
  chapterTitle: string;
  readyForReview: boolean;
};

function clipText(text: string, maxLength: number) {
  return text.replace(/\0/g, "").trim().slice(0, maxLength);
}

function tryParseJsonCandidate(candidate: string): unknown | null {
  const normalized = candidate.trim().replace(/^\uFEFF/, "");
  if (!normalized) return null;
  try {
    return JSON.parse(normalized);
  } catch {
    return null;
  }
}

export function parseJsonFromModelText(text: string): ParsedJsonCandidate {
  const rawParsed = tryParseJsonCandidate(text);
  if (rawParsed) return { parsed: rawParsed, source: "raw" };

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const fencedParsed = fenced ? tryParseJsonCandidate(fenced) : null;
  if (fencedParsed) return { parsed: fencedParsed, source: "fenced" };

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  const sliced =
    firstBrace >= 0 && lastBrace > firstBrace ? text.slice(firstBrace, lastBrace + 1) : "";
  const slicedParsed = sliced ? tryParseJsonCandidate(sliced) : null;
  if (slicedParsed) return { parsed: slicedParsed, source: "object_slice" };

  throw new Error("right_code_invalid_json");
}

export function detectBookAssessmentDeliverable(input: {
  projectName: string;
  fileName: string;
  documentText: string;
}): StructuredBookAssessmentInfo | null {
  if (!input.projectName.includes("书包测评")) return null;

  const titleMatch = input.documentText.match(/^#\s*(第[^\s｜|]+章)测评[｜|]\s*(.+)$/m);
  if (!titleMatch) return null;

  const hasRoleMarkers =
    input.documentText.includes("Role 1") &&
    input.documentText.includes("Role 2") &&
    (input.documentText.includes("Role 3") || input.documentText.includes("章节提炼"));
  if (!hasRoleMarkers) return null;

  return {
    chapterLabel: titleMatch[1].trim(),
    chapterTitle: clipText(titleMatch[2], 80),
    readyForReview:
      /complete/i.test(input.fileName) ||
      /\[[xX]\]/.test(input.documentText) ||
      input.documentText.includes("已完成"),
  };
}

function normalizeRoles(roles: string[], fallbackRole: TeamRole) {
  const matched = roles
    .map((role) => TEAM_ROLES.find((candidate) => role.includes(candidate) || candidate.includes(role)))
    .filter(Boolean) as TeamRole[];
  return Array.from(new Set(matched.length > 0 ? matched : [fallbackRole]));
}

function resolveOwnerName(
  ownerName: string,
  participantRoles: TeamRole[],
  users: User[],
  fallbackUser: User,
) {
  const normalizedName = ownerName.trim();
  if (normalizedName) {
    const exact = users.find((user) => user.name === normalizedName);
    if (exact) return exact.name;

    const fuzzy = users.find(
      (user) => normalizedName.includes(user.name) || user.name.includes(normalizedName),
    );
    if (fuzzy) return fuzzy.name;
  }

  for (const role of participantRoles) {
    const matches = users.filter((user) => user.role === role);
    if (matches.length === 1) return matches[0].name;
  }

  return fallbackUser.name;
}

function findExistingCode(task: AiTask, existingRequirements: Requirement[]) {
  if (task.code) {
    const codeMatch = existingRequirements.find(
      (requirement) => requirement.code.toLowerCase() === task.code.toLowerCase(),
    );
    if (codeMatch) return codeMatch.code;
  }

  const titleMatch = existingRequirements.find(
    (requirement) => requirement.title.trim() === task.title.trim(),
  );
  return titleMatch?.code ?? task.code;
}

export function buildBookAssessmentImportResponse(
  info: StructuredBookAssessmentInfo,
  options?: { bookName?: string },
): AiResponse {
  const status = info.readyForReview ? "待验收" : "进行中";
  const bookName = normalizeBookName(options?.bookName);
  const ownerName = resolveBookOwnerName(bookName);
  const progress = info.readyForReview
    ? `已完成${info.chapterLabel}《${info.chapterTitle}》章节测评成品文档，包含章节提炼、理论框架、题目与结果文案。`
    : `已产出${info.chapterLabel}《${info.chapterTitle}》章节测评内容草稿，正在补齐完整交付。`;
  const nextStep = info.readyForReview
    ? "安排内容复核，并接入亲智聊小程序的章节测评、结果页、5道标签题和转化链路。"
    : "补齐章节测评内容并准备后续接入亲智聊小程序。";
  const backgroundPrefix = bookName ? `《${bookName}》的` : "";

  return {
    summary: `${info.chapterLabel}测评内容已识别为书包测评项目章节任务`,
    tasks: [
      {
        code: "",
        title: `${info.chapterLabel}测评内容产出`,
        bookName,
        ownerName,
        participantRoles: ["产品", "技术"],
        priority: "高",
        status,
        latestProgress: progress,
        nextStep,
        blocker: "",
        background: `${backgroundPrefix}${info.chapterLabel}《${info.chapterTitle}》属于书包测评项目章节测评内容，最终将上线到亲智聊小程序。`,
        needsHelpFrom: ["技术"],
      },
    ],
  };
}

export function buildPrompt(
  projectName: string,
  documentText: string,
  users: User[],
  existingRequirements: Requirement[],
  fileName: string,
  bookName?: string,
) {
  const memberContext = users.map((user) => `${user.name}｜${user.role}｜${user.permission}`).join("\n");
  const requirementContext =
    existingRequirements.length === 0
      ? "当前项目还没有任务。"
      : existingRequirements
          .slice(0, 80)
          .map(
            (item) =>
              `${item.code}｜${item.title}｜负责人:${item.ownerName}｜状态:${item.status}｜最近进展:${item.latestProgress || "-"}`,
          )
          .join("\n");
  const projectContext =
    projectName.includes("书包测评") || projectName.includes("亲子关系")
      ? [
          "这个项目是书包测评项目，不是亲智聊项目。",
          "亲智聊小程序是最终承载入口，但导入结果仍然归到书包测评项目。",
          "典型链路：书页插码 → 章节测评 → 结果页 → 5道标签题 → 三档转化入口 → 付费页。",
          "如果文档讲的是小程序接入、结果页、标签题、转化页联调，也算这个项目下的任务。",
        ].join("\n")
      : "";

  return [
    `你是团队项目管理助手。你的任务是把一份工作文档整理成 ${projectName} 项目的结构化任务导入 JSON。`,
    "你只允许输出 JSON，不要输出解释，不要 markdown 代码块，不要多余文字。",
    `当前上传文件名：${fileName}。`,
    bookName ? `当前资料所属书籍：${bookName}。若任务属于这本书，请在 bookName 中保持一致。` : "",
    "这份文档大概率是“工作产出/交付物”而不是原始需求列表。",
    "如果文档本身已经是一份成品内容、报告、章节测评、稿件、方案，请不要把文档内部的观点/章节/题目逐条拆成任务。",
    "面对成品型文档时，你应该抽取“这份产出代表了哪些工作任务和当前进度”，通常是 1 到 3 条任务，例如“第1章测评内容产出完成”“待接入小程序”“待复核上线”。",
    "如果文档描述的是已有任务的进度更新，且下方“当前已有任务”能明确对应，请把 code 填成那个任务的准确编号；否则 code 留空。",
    "ownerName 优先使用下方成员名单里的真实姓名。识别不准可以留空，系统会回退到上传人。",
    `participantRoles 只能使用：${TEAM_ROLES.join("、")}。`,
    `priority 只能使用：${REQUIREMENT_PRIORITIES.join("、")}。`,
    `status 只能使用：${REQUIREMENT_STATUSES.join("、")}。`,
    "needsHelpFrom 填需要谁配合，可以是姓名或角色；如果没有则留空数组。",
    "拆分粒度：一条任务对应一个明确工作项。不要把整篇文档拆成几十条，也不要把文档中的章节标题、问卷题目、画像段落本身当成任务。",
    "输出格式：",
    JSON.stringify(
      {
        summary: "一句中文总结",
        tasks: [
          {
            code: "",
            title: "任务标题",
            bookName: "所属书籍，可留空",
            ownerName: "负责人姓名",
            participantRoles: ["产品", "技术"],
            priority: "中",
            status: "进行中",
            latestProgress: "当前已完成什么",
            nextStep: "下一步具体要做什么",
            blocker: "当前卡点，没有就留空字符串",
            background: "任务背景，可简短",
            needsHelpFrom: ["运营"],
          },
        ],
      },
      null,
      2,
    ),
    projectContext ? ["", "项目背景：", projectContext].join("\n") : "",
    "",
    "成员名单：",
    memberContext,
    "",
    "当前已有任务：",
    requirementContext,
    "",
    "待解析文档：",
    documentText,
  ].join("\n");
}

export async function extractTextFromDocument(fileName: string, buffer: Buffer) {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (ext === "md" || ext === "markdown" || ext === "txt") {
    return clipText(buffer.toString("utf8"), 18000);
  }
  if (ext === "docx") {
    const result = await mammoth.extractRawText({ buffer });
    return clipText(result.value, 18000);
  }
  throw new Error("unsupported_document_type");
}

export async function callRightCodeTaskParser(input: {
  projectName: string;
  documentText: string;
  fileName: string;
  bookName?: string;
  rightCodeToken?: string;
  users: User[];
  existingRequirements: Requirement[];
}) {
  const apiKey = input.rightCodeToken?.trim() || process.env.RIGHT_CODE_GPT_API_KEY;
  if (!apiKey) throw new Error("right_code_token_missing");

  const baseUrl =
    process.env.RIGHT_CODE_GPT_BASE_URL?.replace(/\/$/, "") ?? "https://www.right.codes/codex/v1";
  const model = process.env.RIGHT_CODE_GPT_MODEL ?? "gpt-5.2";
  const timeoutMs = Number(process.env.RIGHT_CODE_GPT_TIMEOUT_MS ?? "20000");

  const prompt = buildPrompt(
    input.projectName,
    input.documentText,
    input.users,
    input.existingRequirements,
    input.fileName,
    input.bookName,
  );

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "你是企业项目进度抽取助手。你只能输出严格 JSON。",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.1,
      max_tokens: 2400,
    }),
  });

  if (!response.ok) {
    throw new Error(`Right Code GPT request failed: ${response.status}`);
  }

  const data = (await response.json()) as ChatCompletionResponse;
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("right_code_empty_response");
  try {
    return AI_RESPONSE_SCHEMA.parse(parseJsonFromModelText(text).parsed);
  } catch (error) {
    console.error("[right-code-task-parser] invalid model output", {
      model,
      preview: text.slice(0, 1200),
    });
    throw error;
  }
}

export function normalizeAiTasksForImport(input: {
  aiResponse: AiResponse;
  users: User[];
  fallbackUser: User;
  existingRequirements: Requirement[];
  fileName: string;
  bookName?: string;
}) {
  const normalizedBookName = normalizeBookName(input.bookName);
  const preferredOwnerName = resolveBookOwnerName(normalizedBookName);
  const rows = input.aiResponse.tasks.map((task) => {
    const participantRoles = normalizeRoles(task.participantRoles, input.fallbackUser.role);
    const ownerHint = task.ownerName || preferredOwnerName;
    const ownerName = resolveOwnerName(ownerHint, participantRoles, input.users, input.fallbackUser);
    const helpText =
      task.needsHelpFrom.length > 0 ? `需要 ${task.needsHelpFrom.join("、")} 配合。` : "";
    const nextStep = [task.nextStep, helpText].filter(Boolean).join(" ");
    const code = findExistingCode(task, input.existingRequirements);

    return {
      code,
      title: task.title,
      bookName: normalizedBookName || task.bookName,
      type: "任务",
      background: task.background,
      source: `AI文档导入：${input.fileName}`,
      acceptanceCriteria: "",
      version: "",
      ownerName,
      participantRoles,
      priority: task.priority,
      status: task.status,
      startDate: null,
      dueDate: null,
      estimatedHours: null,
      actualHours: null,
      latestProgress: task.latestProgress,
      nextStep,
      blocker: task.blocker,
    };
  });

  return {
    summary: input.aiResponse.summary,
    rows,
  };
}

async function parseDocumentToImportRows(input: {
  projectName: string;
  fileName: string;
  fileBuffer: Buffer;
  bookName?: string;
  rightCodeToken?: string;
  users: User[];
  existingRequirements: Requirement[];
  fallbackUser: User;
}) {
  const documentText = await extractTextFromDocument(input.fileName, input.fileBuffer);
  if (!documentText) throw new Error("empty_document");

  const structured = detectBookAssessmentDeliverable({
    projectName: input.projectName,
    fileName: input.fileName,
    documentText,
  });
  const aiResponse = structured
    ? buildBookAssessmentImportResponse(structured, { bookName: input.bookName })
    : await callRightCodeTaskParser({
        projectName: input.projectName,
        documentText,
        fileName: input.fileName,
        bookName: input.bookName,
        rightCodeToken: input.rightCodeToken,
        users: input.users,
        existingRequirements: input.existingRequirements,
      });

  const normalized = normalizeAiTasksForImport({
    aiResponse,
    users: input.users,
    fallbackUser: input.fallbackUser,
    existingRequirements: input.existingRequirements,
    fileName: input.fileName,
    bookName: input.bookName,
  });

  return {
    summary: normalized.summary,
    rows: normalized.rows,
  };
}

export async function importTasksFromDocuments(input: {
  projectId: string;
  actor: User;
  files: Array<{
    fileName: string;
    fileBuffer: Buffer;
  }>;
  bookName?: string;
  rightCodeToken?: string;
}) {
  const project = await getProjectById(input.projectId);
  if (!project) throw new Error("project_not_found");

  const users = await listUsers();
  const existingRequirements = await listRequirements(input.projectId);
  const summaries: string[] = [];
  const rows: ImportPreviewRow[] = [];

  for (const file of input.files) {
    const parsed = await parseDocumentToImportRows({
      projectName: project.name,
      fileName: file.fileName,
      fileBuffer: file.fileBuffer,
      bookName: input.bookName,
      rightCodeToken: input.rightCodeToken,
      users,
      existingRequirements,
      fallbackUser: input.actor,
    });
    summaries.push(`${file.fileName}：${parsed.summary}`);
    rows.push(...parsed.rows);
  }

  const result: ImportResult = await applyImportRows(input.projectId, rows, input.actor.id, {
    fileName: clipText(input.files.map((file) => file.fileName).join("、"), 200),
    fileType: "ai_document",
  });

  return {
    summary: clipText(summaries.join("；"), 2000),
    extractedTasks: rows.length,
    filesProcessed: input.files.length,
    result,
  };
}

export async function importTasksFromDocument(input: {
  projectId: string;
  actor: User;
  fileName: string;
  fileBuffer: Buffer;
  bookName?: string;
  rightCodeToken?: string;
}) {
  return importTasksFromDocuments({
    projectId: input.projectId,
    actor: input.actor,
    files: [
      {
        fileName: input.fileName,
        fileBuffer: input.fileBuffer,
      },
    ],
    bookName: input.bookName,
    rightCodeToken: input.rightCodeToken,
  });
}
