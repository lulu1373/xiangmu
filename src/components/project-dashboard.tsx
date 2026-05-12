"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  ClipboardList,
  FolderKanban,
  Plus,
  TrendingUp,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PROJECT_SUMMARY_STATUSES, PROJECT_TYPES, PROJECT_TRACKS } from "@/lib/constants";
import { apiPath } from "@/lib/paths";
import type { Project, User } from "@/lib/types";

function formatDate(value: string | null) {
  if (!value) return "未设定";
  return value;
}

function clampProgress(value: number) {
  return Math.min(100, Math.max(0, value));
}

function statusTone(status: Project["summaryStatus"]) {
  if (status === "已完成") return "bg-[#e8f5ee] text-[#147a3d]";
  if (status === "待验收") return "bg-[#fff4d7] text-[#946300]";
  if (status === "暂停") return "bg-[#fde8e8] text-[#b42318]";
  if (status === "规划中") return "bg-[#eceff3] text-[#475467]";
  return "bg-[#e8f1ff] text-[#175cd3]";
}

function riskTone(risk: Project["riskLevel"]) {
  if (risk === "紧急" || risk === "高") return "bg-[#fff1f0] text-[#b42318]";
  if (risk === "中") return "bg-[#fff8e5] text-[#946300]";
  return "bg-[#ecfdf3] text-[#027a48]";
}

export function ProjectDashboard({
  initialProjects,
  users,
}: {
  initialProjects: Project[];
  users: User[];
}) {
  const router = useRouter();
  const [projects, setProjects] = useState(initialProjects);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  async function createProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch(apiPath("/api/projects"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: String(form.get("name") ?? ""),
        projectType: String(form.get("projectType") ?? ""),
        description: String(form.get("description") ?? ""),
        status: "active",
        summaryStatus: String(form.get("summaryStatus") ?? "规划中"),
        ownerId: String(form.get("ownerId") ?? "") || null,
        priority: String(form.get("priority") ?? "中"),
        department: String(form.get("department") ?? ""),
      }),
    });
    const data = await response.json().catch(() => null);
    setCreating(false);
    if (!response.ok) {
      setError(data?.error === "duplicate_record" ? "项目名称已存在。" : "创建项目失败。");
      return;
    }
    event.currentTarget.reset();
    setProjects((current) => [data.data.project, ...current]);
    router.refresh();
  }

  const activeCount = projects.filter((project) => project.status === "active").length;
  const blockedCount = projects.reduce((sum, project) => sum + (project.blockedCount ?? 0), 0);
  const highRiskCount = projects.filter((project) => project.riskLevel === "高" || project.riskLevel === "紧急").length;
  const averageProgress =
    projects.length === 0
      ? 0
      : Math.round(projects.reduce((sum, project) => sum + project.overallProgress, 0) / projects.length);
  const attentionProjects = projects
    .filter((project) => (project.blockedCount ?? 0) > 0 || project.riskLevel === "高" || project.riskLevel === "紧急")
    .slice(0, 4);

  return (
    <main className="mx-auto w-[min(1120px,calc(100vw-32px))] page-enter pb-10">
      <section className="grid gap-3 lg:grid-cols-[280px_1fr] lg:items-end">
        <div className="px-1 py-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#86868b]">Team Console</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-[#1d1d1f] md:text-3xl">
            多项目总览
          </h1>
          <p className="mt-1 text-sm leading-6 text-[#6e6e73]">
            先看风险，再进项目。
          </p>
        </div>
        <div className="rounded-[22px] border border-[#e5e5ea] bg-white/82 p-3 shadow-[0_10px_34px_rgba(15,23,42,0.05)] backdrop-blur-xl">
          <div className="grid gap-2 sm:grid-cols-4">
            <Metric icon={FolderKanban} label="活跃" value={activeCount} />
            <Metric icon={ClipboardList} label="阻塞" value={blockedCount} alert={blockedCount > 0} />
            <Metric icon={AlertTriangle} label="高风险" value={highRiskCount} alert={highRiskCount > 0} />
            <Metric icon={TrendingUp} label="均进度" value={`${averageProgress}%`} />
          </div>
        </div>
      </section>

      <section className="mt-3 grid gap-3 lg:grid-cols-[360px_1fr]">
        <Panel title="状态分区" subtitle={`共 ${projects.length} 个项目`}>
          <div className="grid gap-2">
            {PROJECT_SUMMARY_STATUSES.map((status) => (
              <StatusBucket
                key={status}
                status={status}
                count={projects.filter((project) => project.summaryStatus === status).length}
              />
            ))}
          </div>
        </Panel>

        <Panel title="需要关注" subtitle="风险和阻塞优先看">
          {attentionProjects.length === 0 ? (
            <p className="rounded-[16px] bg-[#f5f5f7] px-3 py-3 text-sm text-[#6e6e73]">
              当前没有高风险或阻塞项目。
            </p>
          ) : (
            <div className="grid gap-2">
              {attentionProjects.map((project) => (
                <Link
                  key={project.id}
                  href={`/${project.id}`}
                  className="grid gap-2 rounded-[16px] bg-[#f5f5f7] px-3 py-2.5 transition hover:bg-[#eceff3] md:grid-cols-[1fr_auto]"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[#1d1d1f]">{project.name}</div>
                    <div className="mt-1 text-xs text-[#86868b]">
                      阻塞 {project.blockedCount ?? 0} · {project.riskLevel}风险 · {project.ownerName || "未指定负责人"}
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#1d1d1f]">
                    进入 <ArrowRight size={14} />
                  </span>
                </Link>
              ))}
            </div>
          )}
        </Panel>
      </section>

      <section className="mt-3 rounded-[24px] border border-[#e5e5ea] bg-white/86 shadow-[0_12px_42px_rgba(15,23,42,0.055)] backdrop-blur-xl">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[#f0f0f2] px-4 py-3">
          <div>
            <h2 className="text-xl font-semibold tracking-[-0.03em] text-[#1d1d1f]">项目明细</h2>
            <p className="mt-1 text-sm text-[#86868b]">一行一个项目，保留四条线同步摘要。</p>
          </div>
          <Link href="#create-project" className="btn-secondary min-h-9 px-4 text-sm">
            <Plus size={16} /> 新增项目
          </Link>
        </div>

        {projects.length === 0 ? (
          <div className="p-8 text-center text-sm text-[#6e6e73]">暂无项目。先在下方新增一个项目。</div>
        ) : (
          <div className="divide-y divide-[#f0f0f2]">
            {projects.map((project) => (
              <ProjectRow key={project.id} project={project} />
            ))}
          </div>
        )}
      </section>

      <section id="create-project" className="mt-3">
        <details className="group rounded-[24px] border border-[#e5e5ea] bg-white/82 shadow-[0_10px_34px_rgba(15,23,42,0.045)] backdrop-blur-xl">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 marker:hidden">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#86868b]">Create</p>
              <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-[#1d1d1f]">新增项目</h2>
            </div>
            <span className="inline-flex size-9 items-center justify-center rounded-full bg-[#1d1d1f] text-white transition group-open:rotate-45">
              <Plus size={17} />
            </span>
          </summary>
          <form onSubmit={createProject} className="grid gap-3 border-t border-[#f0f0f2] px-4 pb-4 pt-3 lg:grid-cols-[1.4fr_1fr_1fr_1fr_1fr_auto]">
            <label className="field">
              <span>项目名称</span>
              <input className="input" name="name" required placeholder="例如：《最好的孩子在我家》书籍编辑运营项目" />
            </label>
            <label className="field">
              <span>项目类型</span>
              <select className="input" name="projectType" defaultValue="">
                <option value="">未分类</option>
                {PROJECT_TYPES.map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>项目状态</span>
              <select className="input" name="summaryStatus" defaultValue="规划中">
                {PROJECT_SUMMARY_STATUSES.map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>负责人</span>
              <select className="input" name="ownerId">
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
              <select className="input" name="priority" defaultValue="中">
                <option value="低">低</option>
                <option value="中">中</option>
                <option value="高">高</option>
                <option value="紧急">紧急</option>
              </select>
            </label>
            <label className="field">
              <span>所属部门</span>
              <input className="input" name="department" placeholder="例如：产品研发部" />
            </label>
            <button className="btn-primary self-end" disabled={creating}>
              <Plus size={18} /> {creating ? "创建中..." : "创建"}
            </button>
            <label className="field lg:col-span-5">
              <span>项目说明</span>
              <textarea className="input textarea" name="description" placeholder="项目目标、阶段和核心产出..." />
            </label>
            {error ? <p className="rounded-2xl bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 lg:col-span-6">{error}</p> : null}
          </form>
        </details>
      </section>
    </main>
  );
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[22px] border border-[#e5e5ea] bg-white/84 p-4 shadow-[0_10px_34px_rgba(15,23,42,0.045)] backdrop-blur-xl">
      <div className="mb-3 flex items-end justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-[-0.025em] text-[#1d1d1f]">{title}</h2>
        <span className="text-xs font-medium text-[#86868b]">{subtitle}</span>
      </div>
      {children}
    </section>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  alert = false,
}: {
  icon: LucideIcon;
  label: string;
  value: number | string;
  alert?: boolean;
}) {
  return (
    <div className={`rounded-[16px] border px-3 py-2 text-left ${
      alert ? "border-[#ffd8d5] bg-[#fff5f5] text-[#b42318]" : "border-[#f0f0f2] bg-[#f5f5f7] text-[#1d1d1f]"
    }`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-[#86868b]">{label}</span>
        <Icon size={14} />
      </div>
      <div className="mt-0.5 text-xl font-semibold tracking-[-0.035em]">{value}</div>
    </div>
  );
}

function StatusBucket({
  status,
  count,
}: {
  status: Project["summaryStatus"];
  count: number;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[16px] bg-[#f5f5f7] px-3 py-2">
      <div className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone(status)}`}>
        {status}
      </div>
      <div className="text-lg font-semibold tracking-[-0.03em] text-[#1d1d1f]">{count}</div>
    </div>
  );
}

function ProjectRow({ project }: { project: Project }) {
  const progress = clampProgress(project.overallProgress);

  return (
    <article className="grid gap-3 px-4 py-3 transition hover:bg-[#fbfbfd] xl:grid-cols-[1.15fr_160px_1.55fr_96px] xl:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone(project.summaryStatus)}`}>
            {project.summaryStatus}
          </span>
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${riskTone(project.riskLevel)}`}>
            {project.riskLevel}风险
          </span>
          <span className="rounded-full bg-[#f5f5f7] px-2.5 py-1 text-xs font-semibold text-[#6e6e73]">
            {project.priority}优先
          </span>
        </div>
        <h3 className="mt-2 truncate text-base font-semibold tracking-[-0.025em] text-[#1d1d1f]">
          {project.name}
        </h3>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#86868b]">
          <span className="inline-flex items-center gap-1">
            <UserRound size={13} /> {project.ownerName || "未指定负责人"}
          </span>
          <span className="inline-flex items-center gap-1">
            <CalendarDays size={13} /> {formatDate(project.targetDate)}
          </span>
          <span>{project.projectType || "未分类"}</span>
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between text-xs font-semibold text-[#6e6e73]">
          <span>总体进度</span>
          <span className="text-[#1d1d1f]">{progress}%</span>
        </div>
        <div className="h-2 rounded-full bg-[#e5e5ea]">
          <div className="h-2 rounded-full bg-[#0071e3]" style={{ width: `${progress}%` }} />
        </div>
        <div className="mt-2 text-xs text-[#86868b]">
          任务 {project.requirementCount ?? 0} · 阻塞 {project.blockedCount ?? 0} · 完成 {project.doneCount ?? 0}
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        {PROJECT_TRACKS.map((track) => (
          <TrackLine
            key={track}
            name={track}
            progress={project.trackSummaries[track].progress}
            completed={project.trackSummaries[track].completed}
            pending={project.trackSummaries[track].pending}
          />
        ))}
      </div>

      <Link
        href={`/${project.id}`}
        className="inline-flex items-center justify-center gap-2 rounded-full bg-[#1d1d1f] px-3 py-2 text-sm font-semibold text-white transition hover:bg-black"
      >
        进入 <ArrowRight size={15} />
      </Link>
    </article>
  );
}

function TrackLine({
  name,
  progress,
  completed,
  pending,
}: {
  name: string;
  progress: number;
  completed: string;
  pending: string;
}) {
  const normalizedProgress = clampProgress(progress);

  return (
    <div className="rounded-2xl border border-[#f0f0f2] bg-[#fbfbfd] px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-[#1d1d1f]">{name}</span>
        <span className="text-xs font-semibold text-[#86868b]">{normalizedProgress}%</span>
      </div>
      <p className="mt-1 line-clamp-1 text-xs leading-5 text-[#6e6e73]">
        完成：{completed || "-"}
      </p>
      <p className="line-clamp-1 text-xs leading-5 text-[#86868b]">
        待办：{pending || "-"}
      </p>
    </div>
  );
}
