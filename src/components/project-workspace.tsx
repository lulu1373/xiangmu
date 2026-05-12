"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  Download,
  FileSpreadsheet,
  Link2,
  LayoutGrid,
  ListFilter,
  Plus,
  Save,
  Sparkles,
  Upload,
} from "lucide-react";
import {
  BOOK_GROUPED_PROJECTS,
  PROJECT_RISK_LEVELS,
  PROJECT_SUMMARY_STATUSES,
  PROJECT_TRACKS,
  PROJECT_TYPES,
  REQUIREMENT_PRIORITIES,
  REQUIREMENT_STATUSES,
  REQUIREMENT_TYPES,
  TEAM_ROLES,
  type RequirementStatus,
} from "@/lib/constants";
import { apiPath } from "@/lib/paths";
import type { ProgressUpdate, Project, Requirement, User } from "@/lib/types";

type ViewMode = "table" | "kanban";

type LocalFilters = {
  status: string;
  ownerId: string;
  role: string;
  search: string;
};

type BookSummary = {
  name: string;
  ownerNames: string;
  taskCount: number;
  blockedCount: number;
  reviewCount: number;
  latestUpdatedAt: string;
};

function trimFormValue(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function formatTaskNextStep(pending: string, expectedTime: string) {
  return [
    pending ? `待完成：${pending}` : "",
    expectedTime ? `预期时间：${expectedTime}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function getStructuredLineValue(value: string, label: string) {
  const line = value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${label}：`) || item.startsWith(`${label}:`));
  return line?.replace(new RegExp(`^${label}[：:]\\s*`), "").trim() ?? "";
}

function resolveTaskUpdateParts(item: Pick<ProgressUpdate, "progress" | "nextStep" | "blocker">) {
  const completed = getStructuredLineValue(item.progress, "已完成") || item.progress.trim();
  const pending = getStructuredLineValue(item.nextStep, "待完成") || item.nextStep.trim();
  const expectedTime = getStructuredLineValue(item.nextStep, "预期时间");
  return {
    completed,
    pending,
    expectedTime,
    blocker: item.blocker.trim(),
  };
}

export function ProjectWorkspace({
  project,
  initialRequirements,
  users,
}: {
  project: Project;
  initialRequirements: Requirement[];
  users: User[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [projectState, setProjectState] = useState(project);
  const [requirements, setRequirements] = useState(initialRequirements);
  const [selectedId, setSelectedId] = useState(initialRequirements[0]?.id ?? "");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [editingOverview, setEditingOverview] = useState(false);
  const [filters, setFilters] = useState<LocalFilters>({
    status: "",
    ownerId: "",
    role: "",
    search: "",
  });
  const [message, setMessage] = useState("");
  const [projectMessage, setProjectMessage] = useState("");
  const [aiMessage, setAiMessage] = useState("");
  const [progressUpdates, setProgressUpdates] = useState<ProgressUpdate[]>([]);
  const supportsBookGrouping = BOOK_GROUPED_PROJECTS.includes(
    projectState.name as (typeof BOOK_GROUPED_PROJECTS)[number],
  );

  const bookNames = Array.from(
    new Set(requirements.map((item) => item.bookName.trim()).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b, "zh-CN"));

  const requestedBookName = searchParams.get("bookName")?.trim() ?? "";
  const activeBook =
    supportsBookGrouping && requestedBookName && bookNames.includes(requestedBookName) ? requestedBookName : null;
  const isOverviewMode = supportsBookGrouping && !activeBook;

  const visibleRequirements = requirements.filter((item) => {
    if (activeBook && item.bookName !== activeBook) return false;
    if (filters.status && item.status !== filters.status) return false;
    if (filters.ownerId && item.ownerId !== filters.ownerId) return false;
    if (filters.role && !item.participantRoles.some((role) => role === filters.role)) return false;

    const search = filters.search.trim().toLowerCase();
    if (!search) return true;

    return [item.title, item.code, item.bookName, item.latestProgress]
      .filter(Boolean)
      .some((field) => field.toLowerCase().includes(search));
  });

  const resolvedSelectedId = !isOverviewMode
    ? visibleRequirements.some((item) => item.id === selectedId)
      ? selectedId
      : (visibleRequirements[0]?.id ?? "")
    : "";

  const selected = !isOverviewMode
    ? visibleRequirements.find((item) => item.id === resolvedSelectedId) ?? null
    : null;
  const editing = supportsBookGrouping && activeBook
    ? requirements.find((item) => item.id === editingId && item.bookName === activeBook) ?? null
    : !isOverviewMode
      ? requirements.find((item) => item.id === editingId) ?? null
    : null;

  const bookSummaries: BookSummary[] = bookNames
    .map((bookName) => {
      const items = requirements.filter((item) => item.bookName === bookName);
      const latestUpdatedAt = items
        .map((item) => item.updatedAt)
        .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];

      return {
        name: bookName,
        ownerNames: Array.from(new Set(items.map((item) => item.ownerName))).join("、"),
        taskCount: items.length,
        blockedCount: items.filter((item) => item.status === "阻塞").length,
        reviewCount: items.filter((item) => item.status === "待验收").length,
        latestUpdatedAt,
      };
    })
    .sort((a, b) => new Date(b.latestUpdatedAt).getTime() - new Date(a.latestUpdatedAt).getTime());

  const uncategorizedCount = requirements.filter((item) => !item.bookName).length;

  async function reloadRequirements() {
    const response = await fetch(apiPath(`/api/projects/${projectState.id}/requirements`));
    const data = await response.json().catch(() => null);
    if (response.ok && data?.success) {
      setRequirements(data.data.requirements);
    }
  }

  function setBookView(bookName: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (bookName) {
      params.set("bookName", bookName);
    } else {
      params.delete("bookName");
    }
    setEditingId(null);
    setMessage("");
    setAiMessage("");
    const nextUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    router.replace(nextUrl, { scroll: false });
  }

  useEffect(() => {
    if (!selected?.id) {
      return;
    }
    let cancelled = false;
    fetch(apiPath(`/api/requirements/${selected.id}/progress`))
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled && data.success) setProgressUpdates(data.data.progressUpdates);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [selected?.id]);

  async function saveRequirement(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const form = new FormData(event.currentTarget);
    const completed = trimFormValue(form.get("completed"));
    const pending = trimFormValue(form.get("pending"));
    const expectedTime = trimFormValue(form.get("expectedTime"));
    const blocker = trimFormValue(form.get("blocker"));
    const payload = {
      code: String(form.get("code") ?? ""),
      title: String(form.get("title") ?? ""),
      bookName: String(form.get("bookName") ?? ""),
      type: String(form.get("type") ?? "需求"),
      background: String(form.get("background") ?? ""),
      source: String(form.get("source") ?? ""),
      acceptanceCriteria: String(form.get("acceptanceCriteria") ?? ""),
      version: String(form.get("version") ?? ""),
      ownerId: String(form.get("ownerId") ?? ""),
      participantRoles: form.getAll("participantRoles").map(String),
      priority: String(form.get("priority") ?? "中"),
      status: String(form.get("status") ?? "待开始"),
      startDate: String(form.get("startDate") ?? ""),
      dueDate: String(form.get("dueDate") ?? ""),
      estimatedHours: String(form.get("estimatedHours") ?? ""),
      actualHours: String(form.get("actualHours") ?? ""),
      latestProgress: completed,
      nextStep: formatTaskNextStep(pending, expectedTime),
      blocker,
    };

    const target = editing ? apiPath(`/api/requirements/${editing.id}`) : apiPath(`/api/projects/${projectState.id}/requirements`);
    const response = await fetch(target, {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      setMessage(data?.error === "duplicate_record" ? "编号已存在。" : "保存失败，请检查必填项。");
      return;
    }

    await reloadRequirements();
    setEditingId(null);
    setSelectedId(data.data.requirement.id);
    if (supportsBookGrouping && data.data.requirement.bookName) {
      setBookView(data.data.requirement.bookName);
    }
    event.currentTarget.reset();
    setMessage("需求/任务已保存。");
  }

  async function updateStatus(requirementId: string, status: RequirementStatus) {
    const response = await fetch(apiPath(`/api/requirements/${requirementId}/status`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const data = await response.json().catch(() => null);
    if (response.ok) {
      setRequirements((current) =>
        current.map((item) => (item.id === requirementId ? data.data.requirement : item)),
      );
      setSelectedId(requirementId);
    } else {
      setMessage("状态更新失败。");
    }
  }

  async function submitProgress(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    const completed = trimFormValue(form.get("completed"));
    const pending = trimFormValue(form.get("pending"));
    const expectedTime = trimFormValue(form.get("expectedTime"));
    const blocker = trimFormValue(form.get("blocker"));

    if (!completed && !pending && !expectedTime && !blocker) {
      setMessage("至少填写一项任务更新。");
      return;
    }

    const payload = {
      progress: completed,
      nextStep: formatTaskNextStep(pending, expectedTime),
      blocker,
      status: selected.status,
    };
    const response = await fetch(apiPath(`/api/requirements/${selected.id}/progress`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      setMessage("进度提交失败。");
      return;
    }
    setRequirements((current) =>
      current.map((item) =>
        item.id === selected.id
          ? {
              ...item,
              latestProgress: payload.progress,
              nextStep: payload.nextStep,
              blocker: payload.blocker,
              status: payload.status as RequirementStatus,
              updatedAt: data.data.progressUpdate.createdAt,
            }
          : item,
      ),
    );
    setProgressUpdates((current) => [data.data.progressUpdate, ...current]);
    event.currentTarget.reset();
    setMessage("进度已提交。");
  }

  async function importFile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const form = new FormData(event.currentTarget);
    form.set("projectId", projectState.id);
    const response = await fetch(apiPath("/api/import"), { method: "POST", body: form });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      setMessage("导入失败，请确认文件格式为 CSV 或 xlsx。");
      return;
    }
    const result = data.data.result;
    if (!result.success) {
      setMessage(
        `导入校验失败：${result.errors
          .map((item: { row: number; message: string }) => `第${item.row}行 ${item.message}`)
          .join("；")}`,
      );
      return;
    }
    await reloadRequirements();
    setMessage(`导入完成：新增 ${result.created} 条，更新 ${result.updated} 条。`);
  }

  async function importAiFile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAiMessage("");
    const form = new FormData(event.currentTarget);
    form.set("projectId", projectState.id);
    const response = await fetch(apiPath("/api/import/ai"), { method: "POST", body: form });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      setAiMessage(
        data?.error === "right_code_token_missing"
          ? "请填写 Right Code 令牌，或在服务器环境变量里配置 `RIGHT_CODE_GPT_API_KEY`。"
          : data?.error === "right_code_upstream_failed"
            ? "Right Code 调用失败，请检查令牌是否有效。"
            : "AI 导入失败，请确认文件是 md / txt / docx。",
      );
      return;
    }

    const result = data.data.result;
    if (!result.result.success) {
      setAiMessage(
        `AI 解析成功，但导入校验失败：${result.result.errors
          .map((item: { row: number; message: string }) => `第${item.row}行 ${item.message}`)
          .join("；")}`,
      );
      return;
    }

    await reloadRequirements();
    const filesProcessed = result.filesProcessed ?? 1;
    const importedBookName = String(form.get("bookName") ?? "").trim() || activeBook || "";
    if (supportsBookGrouping && importedBookName) setBookView(importedBookName);
    setAiMessage(
      `AI 已处理 ${filesProcessed} 个文件，识别 ${result.extractedTasks} 条任务，新增 ${result.result.created} 条，更新 ${result.result.updated} 条。${result.summary ? ` 摘要：${result.summary}` : ""}`,
    );
    event.currentTarget.reset();
  }

  function applyFilters(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setFilters({
      status: String(form.get("status") ?? ""),
      ownerId: String(form.get("ownerId") ?? ""),
      role: String(form.get("role") ?? ""),
      search: String(form.get("search") ?? ""),
    });
  }

  async function saveProjectOverview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProjectMessage("");
    const form = new FormData(event.currentTarget);
    const trackSummaries = Object.fromEntries(
      PROJECT_TRACKS.map((track) => [
        track,
        {
          progress: String(form.get(`${track}-progress`) ?? ""),
          summary: String(form.get(`${track}-summary`) ?? ""),
          completed: String(form.get(`${track}-completed`) ?? ""),
          pending: String(form.get(`${track}-pending`) ?? ""),
        },
      ]),
    );
    const payload = {
      name: String(form.get("name") ?? projectState.name),
      projectType: String(form.get("projectType") ?? ""),
      description: String(form.get("description") ?? ""),
      status: String(form.get("status") ?? projectState.status),
      summaryStatus: String(form.get("summaryStatus") ?? projectState.summaryStatus),
      ownerId: String(form.get("ownerId") ?? "") || null,
      priority: String(form.get("priority") ?? projectState.priority),
      startDate: String(form.get("startDate") ?? ""),
      targetDate: String(form.get("targetDate") ?? ""),
      completedDate: String(form.get("completedDate") ?? ""),
      overallProgress: String(form.get("overallProgress") ?? ""),
      department: String(form.get("department") ?? ""),
      budget: String(form.get("budget") ?? ""),
      actualSpend: String(form.get("actualSpend") ?? ""),
      riskLevel: String(form.get("riskLevel") ?? projectState.riskLevel),
      milestone: String(form.get("milestone") ?? ""),
      documentLink: String(form.get("documentLink") ?? ""),
      note: String(form.get("note") ?? ""),
      trackSummaries,
    };
    const response = await fetch(apiPath(`/api/projects/${projectState.id}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      setProjectMessage("项目总览保存失败。");
      return;
    }
    setProjectState(data.data.project);
    setProjectMessage("项目总览已保存。");
    setEditingOverview(false);
  }

  const exportQuery = new URLSearchParams({ projectId: projectState.id });
  if (supportsBookGrouping && activeBook) exportQuery.set("bookName", activeBook);
  if (filters.status) exportQuery.set("status", filters.status);
  if (filters.ownerId) exportQuery.set("ownerId", filters.ownerId);
  if (filters.role) exportQuery.set("role", filters.role);
  if (filters.search) exportQuery.set("search", filters.search);

  const activeBlockedCount = visibleRequirements.filter((item) => item.status === "阻塞").length;
  const activeReviewCount = visibleRequirements.filter((item) => item.status === "待验收").length;
  const workspaceSummary = isOverviewMode
    ? `${bookSummaries.length} 本书 · ${requirements.length} 个章节任务 · ${uncategorizedCount} 个未分类`
    : supportsBookGrouping && activeBook
      ? `${visibleRequirements.length} 个章节任务 · ${activeReviewCount} 个待验收 · ${activeBlockedCount} 个阻塞`
      : `${visibleRequirements.length} 个任务 · ${activeReviewCount} 个待验收 · ${activeBlockedCount} 个阻塞`;

  return (
    <main className="shell page-enter pb-14">
      <section className="glass-panel rounded-2xl px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-black text-[var(--copper)]">项目工作台</p>
            <h1 className="mt-1 text-2xl font-black leading-tight tracking-normal md:text-3xl">
              {activeBook ? `${projectState.name} / ${activeBook}` : projectState.name}
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">{workspaceSummary}</p>
          </div>
          {!isOverviewMode ? (
            <div className="flex flex-wrap gap-2">
              {supportsBookGrouping && activeBook ? (
                <button className="btn-secondary" onClick={() => setBookView(null)}>
                  <ArrowLeft size={18} /> 返回书籍总览
                </button>
              ) : null}
              <button
                className={viewMode === "table" ? "btn-primary" : "btn-secondary"}
                onClick={() => setViewMode("table")}
              >
                <ListFilter size={18} /> 表格
              </button>
              <button
                className={viewMode === "kanban" ? "btn-primary" : "btn-secondary"}
                onClick={() => setViewMode("kanban")}
              >
                <LayoutGrid size={18} /> 看板
              </button>
            </div>
          ) : null}
        </div>
      </section>

      <ProjectOverviewSection
        project={projectState}
        users={users}
        editing={editingOverview}
        message={projectMessage}
        onToggleEditing={() => setEditingOverview((current) => !current)}
        onSave={saveProjectOverview}
      />

      <section className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid min-w-0 content-start gap-4">
          {isOverviewMode ? (
            <BooksOverview
              books={bookSummaries}
              uncategorizedCount={uncategorizedCount}
              onOpenBook={setBookView}
            />
          ) : (
            <>
              <div className="glass-panel rounded-2xl p-4">
                <form onSubmit={applyFilters} className="grid gap-3 lg:grid-cols-[1fr_150px_150px_140px_auto]">
                  <input className="input" name="search" placeholder="搜索标题、编号、进展" />
                  <select className="input" name="status" defaultValue="">
                    <option value="">全部状态</option>
                    {REQUIREMENT_STATUSES.map((status) => (
                      <option key={status}>{status}</option>
                    ))}
                  </select>
                  <select className="input" name="ownerId" defaultValue="">
                    <option value="">全部负责人</option>
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name}
                      </option>
                    ))}
                  </select>
                  <select className="input" name="role" defaultValue="">
                    <option value="">全部角色</option>
                    {TEAM_ROLES.map((role) => (
                      <option key={role}>{role}</option>
                    ))}
                  </select>
                  <button className="btn-primary">筛选</button>
                </form>
                <div className="mt-3 flex flex-wrap gap-2">
                  <a className="btn-secondary" href={apiPath(`/api/export?${exportQuery.toString()}&format=xlsx`)}>
                    <Download size={16} /> 导出 xlsx
                  </a>
                  <a className="btn-secondary" href={apiPath(`/api/export?${exportQuery.toString()}&format=csv`)}>
                    <Download size={16} /> 导出 CSV
                  </a>
                </div>
              </div>

              {viewMode === "table" ? (
                <RequirementsTable
                  requirements={visibleRequirements}
                  selectedId={resolvedSelectedId}
                  showBookName={supportsBookGrouping}
                  onSelect={setSelectedId}
                  onEdit={setEditingId}
                />
              ) : (
                <RequirementsKanban
                  requirements={visibleRequirements}
                  selectedId={resolvedSelectedId}
                  onSelect={setSelectedId}
                  onDropStatus={updateStatus}
                />
              )}

              <RequirementEditor
                key={editing?.id ?? `new-${activeBook}`}
                users={users}
                editing={editing}
                bookNames={bookNames}
                defaultBookName={activeBook ?? ""}
                showBookName={supportsBookGrouping}
                onCancel={() => setEditingId(null)}
                onSave={saveRequirement}
                message={message}
              />
            </>
          )}
        </div>

        <aside className="grid min-w-0 content-start gap-4">
          {isOverviewMode ? (
            <OverviewPanel
              bookCount={bookSummaries.length}
              totalTaskCount={requirements.length}
              uncategorizedCount={uncategorizedCount}
            />
          ) : (
            <ProgressPanel
              selected={selected}
              progressUpdates={progressUpdates}
              onSubmit={submitProgress}
            />
          )}

          <form onSubmit={importAiFile} className="glass-panel grid gap-3 rounded-2xl p-4">
            <h2 className="flex items-center gap-2 text-lg font-black">
              <Sparkles size={19} /> AI 自动导入
            </h2>
            <p className="text-xs leading-5 text-[var(--muted)]">
              可多选上传 `md`、`txt` 或 `docx`。系统会自动识别任务、进度、卡点和需要谁配合。Word 仅支持 `docx`；书包测评章节成品文档可直接结构化识别。
            </p>
            <input className="input" name="file" type="file" accept=".md,.markdown,.txt,.docx" multiple required />
            {supportsBookGrouping ? (
              <label className="field">
                <span>所属书籍{activeBook ? "（当前书）" : "（可选）"}</span>
                <input
                  className="input"
                  name="bookName"
                  defaultValue={activeBook ?? ""}
                  placeholder="例如：亲子关系全面技巧"
                  readOnly={Boolean(activeBook)}
                />
              </label>
            ) : null}
            <label className="field">
              <span>Right Code 令牌（可选）</span>
              <input className="input" name="rightCodeToken" type="password" placeholder="留空则读服务器环境变量" />
            </label>
            <button className="btn-primary">
              <Sparkles size={16} /> 智能导入
            </button>
            {aiMessage ? <p className="rounded-2xl bg-white/70 px-4 py-3 text-sm font-bold">{aiMessage}</p> : null}
          </form>

          <form onSubmit={importFile} className="glass-panel grid gap-3 rounded-2xl p-4">
            <h2 className="flex items-center gap-2 text-lg font-black">
              <Upload size={19} /> 导入需求
            </h2>
            <input className="input" name="file" type="file" accept=".csv,.xlsx" required />
            <p className="text-xs leading-5 text-[var(--muted)]">
              支持固定模板 CSV/xlsx。校验失败时不会写入任何需求变更。
            </p>
            <button className="btn-primary">
              <FileSpreadsheet size={16} /> 上传并校验
            </button>
          </form>

          {isOverviewMode ? (
            <RequirementEditor
              key="overview-new"
              users={users}
              editing={null}
              bookNames={bookNames}
              defaultBookName=""
              showBookName
              onCancel={() => undefined}
              onSave={saveRequirement}
              message={message}
            />
          ) : null}
        </aside>
      </section>
    </main>
  );
}

function ProjectOverviewSection({
  project,
  users,
  editing,
  message,
  onToggleEditing,
  onSave,
}: {
  project: Project;
  users: User[];
  editing: boolean;
  message: string;
  onToggleEditing: () => void;
  onSave: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <section className="mt-4 grid gap-4">
      <div className="glass-panel rounded-2xl p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[var(--copper)]">Project Summary</p>
            <h2 className="mt-2 text-2xl font-black tracking-[-0.04em]">总览层</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
              这里不看任务细节，只看项目状态、时间、风险，以及研发、产品、技术、运营四条线的进度摘要。
            </p>
          </div>
          <button className={editing ? "btn-primary" : "btn-secondary"} onClick={onToggleEditing}>
            <Save size={16} /> {editing ? "收起总览编辑" : "编辑项目总览"}
          </button>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <OverviewMetric label="项目类型" value={project.projectType || "未分类"} />
          <OverviewMetric label="项目负责人" value={project.ownerName || "未指定"} />
          <OverviewMetric label="优先级 / 风险" value={`${project.priority} / ${project.riskLevel}`} />
          <OverviewMetric label="总体进度" value={`${project.overallProgress}%`} />
          <OverviewMetric label="所属部门" value={project.department || "未填写"} />
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <OverviewMetric label="开始日期" value={project.startDate || "-"} />
          <OverviewMetric label="预计完成" value={project.targetDate || "-"} />
          <OverviewMetric label="实际完成" value={project.completedDate || "-"} />
          <OverviewMetric label="项目预算" value={project.budget === null ? "-" : String(project.budget)} />
          <OverviewMetric label="实际花费" value={project.actualSpend === null ? "-" : String(project.actualSpend)} />
          <OverviewMetric label="项目状态" value={project.summaryStatus} />
        </div>
        <div className="mt-4 grid gap-3 xl:grid-cols-2">
          <article className="rounded-2xl bg-white/55 p-4">
            <div className="text-xs font-black text-[var(--muted)]">关键里程碑</div>
            <p className="mt-2 text-sm leading-6">{project.milestone || "暂未填写关键里程碑。"}</p>
          </article>
          <article className="rounded-2xl bg-white/55 p-4">
            <div className="flex items-center gap-2 text-xs font-black text-[var(--muted)]">
              <Link2 size={14} /> 相关文档
            </div>
            {project.documentLink ? (
              <a
                href={project.documentLink}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex break-all text-sm font-bold text-[var(--copper)] underline"
              >
                {project.documentLink}
              </a>
            ) : (
              <p className="mt-2 text-sm text-[var(--muted)]">暂未填写文档链接。</p>
            )}
          </article>
        </div>
        <div className="mt-4 grid gap-3 xl:grid-cols-4">
          {PROJECT_TRACKS.map((track) => (
            <ProjectTrackCard
              key={track}
              name={track}
              progress={project.trackSummaries[track].progress}
              summary={project.trackSummaries[track].summary}
              completed={project.trackSummaries[track].completed}
              pending={project.trackSummaries[track].pending}
            />
          ))}
        </div>
        {project.note ? (
          <article className="mt-4 rounded-2xl bg-white/55 p-4">
            <div className="text-xs font-black text-[var(--muted)]">备注</div>
            <p className="mt-2 text-sm leading-6">{project.note}</p>
          </article>
        ) : null}
      </div>

      {editing ? (
        <form onSubmit={onSave} className="glass-panel grid gap-4 rounded-2xl p-5">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <label className="field">
              <span>项目名称</span>
              <input className="input" name="name" defaultValue={project.name} required />
            </label>
            <label className="field">
              <span>项目类型</span>
              <select className="input" name="projectType" defaultValue={project.projectType}>
                <option value="">未分类</option>
                {PROJECT_TYPES.map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>项目负责人</span>
              <select className="input" name="ownerId" defaultValue={project.ownerId ?? ""}>
                <option value="">暂不指定</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name} · {user.role}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>优先级</span>
              <select className="input" name="priority" defaultValue={project.priority}>
                {REQUIREMENT_PRIORITIES.map((priority) => (
                  <option key={priority}>{priority}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>风险等级</span>
              <select className="input" name="riskLevel" defaultValue={project.riskLevel}>
                {PROJECT_RISK_LEVELS.map((level) => (
                  <option key={level}>{level}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>项目状态</span>
              <select className="input" name="summaryStatus" defaultValue={project.summaryStatus}>
                {PROJECT_SUMMARY_STATUSES.map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            <label className="field">
              <span>开始日期</span>
              <input className="input" name="startDate" type="date" defaultValue={project.startDate ?? ""} />
            </label>
            <label className="field">
              <span>预计完成日期</span>
              <input className="input" name="targetDate" type="date" defaultValue={project.targetDate ?? ""} />
            </label>
            <label className="field">
              <span>实际完成日期</span>
              <input className="input" name="completedDate" type="date" defaultValue={project.completedDate ?? ""} />
            </label>
            <label className="field">
              <span>总体进度</span>
              <input className="input" name="overallProgress" type="number" min="0" max="100" defaultValue={project.overallProgress} />
            </label>
            <label className="field">
              <span>所属部门</span>
              <input className="input" name="department" defaultValue={project.department} />
            </label>
            <label className="field">
              <span>系统归档状态</span>
              <select className="input" name="status" defaultValue={project.status}>
                <option value="active">active</option>
                <option value="archived">archived</option>
              </select>
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="field">
              <span>项目预算</span>
              <input className="input" name="budget" type="number" min="0" step="1" defaultValue={project.budget ?? ""} />
            </label>
            <label className="field">
              <span>实际花费</span>
              <input className="input" name="actualSpend" type="number" min="0" step="1" defaultValue={project.actualSpend ?? ""} />
            </label>
            <label className="field md:col-span-2 xl:col-span-2">
              <span>相关文档</span>
              <input className="input" name="documentLink" defaultValue={project.documentLink} placeholder="https://..." />
            </label>
          </div>

          <div className="grid gap-3 xl:grid-cols-2">
            <label className="field">
              <span>项目说明</span>
              <textarea className="input textarea" name="description" defaultValue={project.description} />
            </label>
            <label className="field">
              <span>关键里程碑</span>
              <textarea className="input textarea" name="milestone" defaultValue={project.milestone} />
            </label>
          </div>

          <label className="field">
            <span>备注</span>
            <textarea className="input textarea" name="note" defaultValue={project.note} />
          </label>

          <div className="grid gap-3 xl:grid-cols-2">
            {PROJECT_TRACKS.map((track) => (
              <article key={track} className="rounded-2xl bg-white/55 p-4">
                <h3 className="text-lg font-black">{track}</h3>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <label className="field">
                    <span>{track}进度</span>
                    <input
                      className="input"
                      name={`${track}-progress`}
                      type="number"
                      min="0"
                      max="100"
                      defaultValue={project.trackSummaries[track].progress}
                    />
                  </label>
                  <label className="field">
                    <span>{track}事项汇总</span>
                    <input className="input" name={`${track}-summary`} defaultValue={project.trackSummaries[track].summary} />
                  </label>
                  <label className="field md:col-span-2">
                    <span>{track}已完成事项</span>
                    <textarea
                      className="input textarea"
                      name={`${track}-completed`}
                      defaultValue={project.trackSummaries[track].completed}
                    />
                  </label>
                  <label className="field md:col-span-2">
                    <span>{track}待完成事项及预期时间</span>
                    <textarea
                      className="input textarea"
                      name={`${track}-pending`}
                      defaultValue={project.trackSummaries[track].pending}
                    />
                  </label>
                </div>
              </article>
            ))}
          </div>

          {message ? <p className="rounded-2xl bg-white/70 px-4 py-3 text-sm font-bold">{message}</p> : null}
          <button className="btn-primary justify-self-start">
            <Save size={16} /> 保存项目总览
          </button>
        </form>
      ) : null}
    </section>
  );
}

function OverviewMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white/55 px-4 py-4">
      <div className="text-xs font-black text-[var(--muted)]">{label}</div>
      <div className="mt-2 text-lg font-black">{value}</div>
    </div>
  );
}

function ProjectTrackCard({
  name,
  progress,
  summary,
  completed,
  pending,
}: {
  name: string;
  progress: number;
  summary: string;
  completed: string;
  pending: string;
}) {
  return (
    <article className="rounded-2xl bg-white/55 p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-black">{name}</h3>
        <span className="text-sm font-black">{progress}%</span>
      </div>
      <div className="mt-2 h-2 rounded-full bg-white">
        <div
          className="h-2 rounded-full bg-[linear-gradient(90deg,var(--gold),var(--moss))]"
          style={{ width: `${progress}%` }}
        />
      </div>
      <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{summary || "暂未汇总事项。"}</p>
      <p className="mt-3 text-xs leading-5">
        <span className="font-black">已完成：</span>
        <span className="text-[var(--muted)]">{completed || "-"}</span>
      </p>
      <p className="mt-2 text-xs leading-5">
        <span className="font-black">待完成：</span>
        <span className="text-[var(--muted)]">{pending || "-"}</span>
      </p>
    </article>
  );
}

function BooksOverview({
  books,
  uncategorizedCount,
  onOpenBook,
}: {
  books: BookSummary[];
  uncategorizedCount: number;
  onOpenBook: (bookName: string) => void;
}) {
  return (
    <section className="grid items-start gap-4 md:grid-cols-2">
      {books.map((book) => (
        <button
          key={book.name}
          type="button"
          onClick={() => onOpenBook(book.name)}
          className="glass-panel group grid self-start rounded-2xl p-5 text-left transition hover:-translate-y-1 hover:shadow-2xl"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-xs font-black text-[var(--muted)]">
                <BookOpen size={15} /> 书籍
              </div>
              <h2 className="mt-2 text-xl font-black leading-tight tracking-normal">{book.name}</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                负责人：{book.ownerNames || "暂未指定"}
              </p>
            </div>
            <div className="rounded-xl bg-white/60 px-4 py-3 text-right">
              <div className="text-xl font-black">{book.taskCount}</div>
              <div className="text-xs font-bold text-[var(--muted)]">章节任务</div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <SummaryCell label="待验收" value={book.reviewCount} />
            <SummaryCell label="阻塞" value={book.blockedCount} />
            <SummaryCell
              label="最近更新"
              valueText={book.latestUpdatedAt ? new Date(book.latestUpdatedAt).toLocaleDateString("zh-CN") : "-"}
            />
          </div>
        </button>
      ))}

      {uncategorizedCount > 0 ? (
        <article className="glass-panel self-start rounded-2xl border border-dashed border-[var(--line)] p-5">
          <div className="text-xs font-black text-[var(--muted)]">未分类</div>
          <h2 className="mt-2 text-xl font-black leading-tight tracking-normal">未归书籍的内容</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            当前还有 {uncategorizedCount} 条任务没有挂到具体书籍下，可以在右侧编辑器里补书名。
          </p>
        </article>
      ) : null}
    </section>
  );
}

function RequirementsTable({
  requirements,
  selectedId,
  showBookName,
  onSelect,
  onEdit,
}: {
  requirements: Requirement[];
  selectedId: string;
  showBookName: boolean;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
}) {
  return (
    <section className="glass-panel overflow-hidden rounded-2xl">
      <div className="overflow-auto">
        <table className="w-full min-w-[1180px] border-collapse text-left text-sm">
          <thead className="bg-white/50 text-xs text-[var(--muted)]">
            <tr>
              <th className="px-4 py-4">编号</th>
              <th className="px-4 py-4">标题</th>
              {showBookName ? <th className="px-4 py-4">书籍</th> : null}
              <th className="px-4 py-4">负责人</th>
              <th className="px-4 py-4">角色</th>
              <th className="px-4 py-4">优先级</th>
              <th className="px-4 py-4">状态</th>
              <th className="px-4 py-4">截止</th>
              <th className="px-4 py-4">最近进展</th>
              <th className="px-4 py-4">操作</th>
            </tr>
          </thead>
          <tbody>
            {requirements.map((item) => (
              <tr
                key={item.id}
                onClick={() => onSelect(item.id)}
                className={`border-t border-[var(--line)] ${selectedId === item.id ? "bg-[#f2e4c6]/70" : "bg-white/20 hover:bg-white/40"}`}
              >
                <td className="px-4 py-4 font-black">{item.code}</td>
                <td className="max-w-[240px] px-4 py-4 font-black">{item.title}</td>
                {showBookName ? <td className="px-4 py-4 text-[var(--muted)]">{item.bookName || "-"}</td> : null}
                <td className="px-4 py-4">{item.ownerName}</td>
                <td className="px-4 py-4 text-[var(--muted)]">{item.participantRoles.join("、")}</td>
                <td className="px-4 py-4">{item.priority}</td>
                <td className="px-4 py-4">
                  <span className={`status-pill status-${item.status}`}>{item.status}</span>
                </td>
                <td className="px-4 py-4 text-[var(--muted)]">{item.dueDate ?? "-"}</td>
                <td className="max-w-[280px] px-4 py-4 text-[var(--muted)]">{item.latestProgress || "-"}</td>
                <td className="px-4 py-4">
                  <button
                    className="btn-secondary min-h-9 px-3"
                    onClick={(event) => {
                      event.stopPropagation();
                      onEdit(item.id);
                    }}
                  >
                    编辑
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RequirementsKanban({
  requirements,
  selectedId,
  onSelect,
  onDropStatus,
}: {
  requirements: Requirement[];
  selectedId: string;
  onSelect: (id: string) => void;
  onDropStatus: (id: string, status: RequirementStatus) => void;
}) {
  return (
    <section className="grid items-start gap-3 overflow-auto xl:grid-cols-5">
      {REQUIREMENT_STATUSES.map((status) => (
        <div
          key={status}
          className="glass-panel min-h-[420px] rounded-2xl p-4"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const id = event.dataTransfer.getData("text/plain");
            if (id) void onDropStatus(id, status);
          }}
        >
          <div className="mb-4 flex items-center justify-between">
            <span className={`status-pill status-${status}`}>{status}</span>
            <span className="text-sm font-black text-[var(--muted)]">
              {requirements.filter((item) => item.status === status).length}
            </span>
          </div>
          <div className="grid gap-3">
            {requirements
              .filter((item) => item.status === status)
              .map((item) => (
                <article
                  key={item.id}
                  draggable
                  onDragStart={(event) => event.dataTransfer.setData("text/plain", item.id)}
                  onClick={() => onSelect(item.id)}
                  className={`rounded-2xl border p-4 shadow-sm transition hover:-translate-y-0.5 ${
                    selectedId === item.id
                      ? "border-[var(--moss)] bg-[#edf3e7]"
                      : "border-[var(--line)] bg-white/68"
                  }`}
                >
                  <div className="text-xs font-black text-[var(--muted)]">{item.code}</div>
                  <h3 className="mt-2 font-black leading-6">{item.title}</h3>
                  {item.bookName ? (
                    <p className="mt-2 text-[11px] font-black uppercase tracking-[0.12em] text-[var(--copper)]">
                      {item.bookName}
                    </p>
                  ) : null}
                  <p className="mt-3 line-clamp-3 text-xs leading-5 text-[var(--muted)]">
                    {item.latestProgress || "暂无进展。"}
                  </p>
                  <div className="mt-4 flex items-center justify-between text-xs font-bold">
                    <span>{item.ownerName}</span>
                    <span>{item.priority}</span>
                  </div>
                </article>
              ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function RequirementEditor({
  users,
  editing,
  bookNames,
  defaultBookName,
  showBookName,
  message,
  onCancel,
  onSave,
}: {
  users: User[];
  editing: Requirement | null;
  bookNames: string[];
  defaultBookName: string;
  showBookName: boolean;
  message: string;
  onCancel: () => void;
  onSave: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  const defaultOwner = editing?.ownerId ?? users[0]?.id ?? "";
  const defaultRoles = editing?.participantRoles ?? ["产品"];
  const progressDefaults = resolveTaskUpdateParts({
    progress: editing?.latestProgress ?? "",
    nextStep: editing?.nextStep ?? "",
    blocker: editing?.blocker ?? "",
  });

  return (
    <form onSubmit={onSave} className="glass-panel grid gap-4 rounded-2xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-xl font-black">
          <Plus size={19} /> {editing ? "编辑需求/任务" : "新增需求/任务"}
        </h2>
        {editing ? (
          <button type="button" onClick={onCancel} className="btn-secondary">
            取消编辑
          </button>
        ) : null}
      </div>
      <div className="grid gap-3 md:grid-cols-[120px_1fr_180px_140px]">
        <label className="field">
          <span>编号</span>
          <input className="input" name="code" defaultValue={editing?.code ?? ""} placeholder="自动生成" />
        </label>
        <label className="field">
          <span>标题</span>
          <input className="input" name="title" required defaultValue={editing?.title ?? ""} />
        </label>
        {showBookName ? (
          <label className="field">
            <span>所属书籍</span>
            <input
              className="input"
              name="bookName"
              list="book-name-options"
              defaultValue={editing?.bookName ?? defaultBookName}
              placeholder="例如：亲子关系全面技巧"
            />
          </label>
        ) : null}
        <label className="field">
          <span>类型</span>
          <select className="input" name="type" defaultValue={editing?.type ?? "需求"}>
            {REQUIREMENT_TYPES.map((type) => (
              <option key={type}>{type}</option>
            ))}
          </select>
        </label>
      </div>
      {showBookName ? (
        <datalist id="book-name-options">
          {bookNames.map((bookName) => (
            <option key={bookName} value={bookName} />
          ))}
        </datalist>
      ) : null}
      <div className="grid gap-3 md:grid-cols-5">
        <label className="field">
          <span>版本</span>
          <input className="input" name="version" defaultValue={editing?.version ?? ""} placeholder="v1.0" />
        </label>
        <label className="field">
          <span>负责人</span>
          <select className="input" name="ownerId" defaultValue={defaultOwner} required>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name} · {user.role}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>优先级</span>
          <select className="input" name="priority" defaultValue={editing?.priority ?? "中"}>
            {REQUIREMENT_PRIORITIES.map((priority) => (
              <option key={priority}>{priority}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>状态</span>
          <select className="input" name="status" defaultValue={editing?.status ?? "待开始"}>
            {REQUIREMENT_STATUSES.map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>来源</span>
          <input className="input" name="source" defaultValue={editing?.source ?? ""} />
        </label>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <label className="field">
          <span>开始日期</span>
          <input className="input" name="startDate" type="date" defaultValue={editing?.startDate ?? ""} />
        </label>
        <label className="field">
          <span>截止日期</span>
          <input className="input" name="dueDate" type="date" defaultValue={editing?.dueDate ?? ""} />
        </label>
        <label className="field">
          <span>预估工时</span>
          <input
            className="input"
            name="estimatedHours"
            type="number"
            min="0"
            step="0.5"
            defaultValue={editing?.estimatedHours ?? ""}
          />
        </label>
        <label className="field">
          <span>实际工时</span>
          <input
            className="input"
            name="actualHours"
            type="number"
            min="0"
            step="0.5"
            defaultValue={editing?.actualHours ?? ""}
          />
        </label>
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-xs font-black text-[var(--muted)]">参与角色</legend>
        <div className="flex flex-wrap gap-2">
          {TEAM_ROLES.map((role) => (
            <label key={role} className="rounded-full border border-[var(--line)] bg-white/60 px-4 py-2 text-sm font-bold">
              <input
                className="mr-2"
                type="checkbox"
                name="participantRoles"
                value={role}
                defaultChecked={defaultRoles.includes(role)}
              />
              {role}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="field">
          <span>背景</span>
          <textarea className="input textarea" name="background" defaultValue={editing?.background ?? ""} />
        </label>
        <label className="field">
          <span>验收标准</span>
          <textarea className="input textarea" name="acceptanceCriteria" defaultValue={editing?.acceptanceCriteria ?? ""} />
        </label>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="field">
          <span>已完成</span>
          <textarea
            className="input textarea"
            name="completed"
            defaultValue={progressDefaults.completed}
            placeholder="已经交付、已同步、已处理的内容"
          />
        </label>
        <label className="field">
          <span>待完成</span>
          <textarea
            className="input textarea"
            name="pending"
            defaultValue={progressDefaults.pending}
            placeholder="还剩什么没做，需要继续推进什么"
          />
        </label>
        <label className="field">
          <span>预期时间</span>
          <input
            className="input"
            name="expectedTime"
            defaultValue={progressDefaults.expectedTime}
            placeholder="例如：本周五 / 5月10日前 / 明天下午"
          />
        </label>
        <label className="field">
          <span>卡点</span>
          <textarea
            className="input textarea"
            name="blocker"
            defaultValue={progressDefaults.blocker}
            placeholder="需要谁配合、缺什么资料；没有可留空"
          />
        </label>
      </div>
      {message ? <p className="rounded-2xl bg-white/70 px-4 py-2 text-sm font-bold">{message}</p> : null}
      <button className="btn-primary justify-self-start">
        <Save size={16} /> 保存需求/任务
      </button>
    </form>
  );
}

function OverviewPanel({
  bookCount,
  totalTaskCount,
  uncategorizedCount,
}: {
  bookCount: number;
  totalTaskCount: number;
  uncategorizedCount: number;
}) {
  return (
    <section className="glass-panel rounded-2xl p-4">
      <h2 className="text-lg font-black">书籍总览</h2>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <SummaryCell label="已入库书籍" value={bookCount} />
        <SummaryCell label="总任务数" value={totalTaskCount} />
        <SummaryCell label="未分类" value={uncategorizedCount} />
      </div>
    </section>
  );
}

function ProgressPanel({
  selected,
  progressUpdates,
  onSubmit,
}: {
  selected: Requirement | null;
  progressUpdates: ProgressUpdate[];
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <section className="glass-panel rounded-2xl p-4">
      <h2 className="text-lg font-black">任务层录入</h2>
      {selected ? (
        <>
          <div className="mt-4 rounded-xl bg-white/60 p-4">
            <div className="text-xs font-black text-[var(--muted)]">{selected.code}</div>
            <h3 className="mt-1 font-black">{selected.title}</h3>
            {selected.bookName ? (
              <p className="mt-2 text-xs font-black text-[var(--copper)]">
                {selected.bookName}
              </p>
            ) : null}
            <span className={`status-pill status-${selected.status} mt-3`}>{selected.status}</span>
          </div>
          <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
            每个角色只填四项；任务状态用表格或看板调整。
          </p>
          <form onSubmit={onSubmit} className="mt-4 grid gap-3">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="field">
                <span>已完成</span>
                <textarea className="input textarea" name="completed" placeholder="已经交付、已同步、已处理的内容" />
              </label>
              <label className="field">
                <span>待完成</span>
                <textarea className="input textarea" name="pending" placeholder="还剩什么没做，需要继续推进什么" />
              </label>
              <label className="field">
                <span>预期时间</span>
                <input className="input" name="expectedTime" placeholder="例如：本周五 / 5月10日前 / 明天下午" />
              </label>
              <label className="field">
                <span>卡点</span>
                <textarea className="input textarea" name="blocker" placeholder="需要谁配合、缺什么资料；没有可留空" />
              </label>
            </div>
            <button className="btn-primary">提交任务更新</button>
          </form>
          <div className="mt-5 grid gap-3">
            {progressUpdates.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">暂无进度记录。</p>
            ) : (
              progressUpdates.map((item) => {
                const update = resolveTaskUpdateParts(item);
                return (
                  <article key={item.id} className="rounded-xl border border-[var(--line)] bg-white/58 p-4">
                    <div className="flex items-center justify-between gap-2 text-xs font-bold text-[var(--muted)]">
                      <span>{item.userName}</span>
                      <span>{new Date(item.createdAt).toLocaleString("zh-CN")}</span>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs leading-5">
                      <p>
                        <span className="font-black">已完成：</span>
                        <span className="text-[var(--muted)]">{update.completed || "-"}</span>
                      </p>
                      <p>
                        <span className="font-black">待完成：</span>
                        <span className="text-[var(--muted)]">{update.pending || "-"}</span>
                      </p>
                      <p>
                        <span className="font-black">预期时间：</span>
                        <span className="text-[var(--muted)]">{update.expectedTime || "-"}</span>
                      </p>
                      <p>
                        <span className="font-black">卡点：</span>
                        <span className="text-[var(--muted)]">{update.blocker || "-"}</span>
                      </p>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </>
      ) : (
        <p className="mt-4 text-sm text-[var(--muted)]">先在表格或看板里选择一个需求。</p>
      )}
    </section>
  );
}

function SummaryCell({
  label,
  value,
  valueText,
}: {
  label: string;
  value?: number;
  valueText?: string;
}) {
  return (
    <div className="rounded-xl bg-white/55 px-3 py-3">
      <div className="text-lg font-black">{valueText ?? value ?? 0}</div>
      <div className="text-xs font-bold text-[var(--muted)]">{label}</div>
    </div>
  );
}
