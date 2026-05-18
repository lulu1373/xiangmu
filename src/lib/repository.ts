import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import {
  DEFAULT_PROJECTS,
  PROJECT_TRACKS,
  type ProjectRiskLevel,
  type ProjectSummaryStatus,
  type ProjectTrack,
  type ProjectType,
  type RequirementPriority,
  type RequirementStatus,
  type TeamRole,
} from "@/lib/constants";
import { type DbExecutor, getDbExecutor, withTransaction } from "@/lib/db";
import { newId, nowIso } from "@/lib/ids";
import type {
  ProgressUpdate,
  Project,
  ProjectTrackSummary,
  Requirement,
  User,
  UserWithPassword,
} from "@/lib/types";

type UserRow = {
  id: string;
  name: string;
  email: string;
  login_code: string;
  role: TeamRole;
  permission: "admin" | "member";
  password_hash: string;
  created_at: string;
  updated_at: string;
};

type ProjectRow = {
  id: string;
  name: string;
  project_type: ProjectType | "";
  description: string;
  status: "active" | "archived";
  summary_status: ProjectSummaryStatus;
  owner_id: string | null;
  owner_name?: string | null;
  priority: RequirementPriority;
  start_date: string | null;
  target_date: string | null;
  completed_date: string | null;
  overall_progress: number | string;
  department: string;
  budget: number | string | null;
  actual_spend: number | string | null;
  risk_level: ProjectRiskLevel;
  milestone: string;
  document_link: string;
  note: string;
  track_summaries_json: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  requirement_count?: number | string | null;
  blocked_count?: number | string | null;
  done_count?: number | string | null;
};

type RequirementRow = {
  id: string;
  project_id: string;
  code: string;
  title: string;
  book_name: string;
  type: Requirement["type"];
  background: string;
  source: string;
  acceptance_criteria: string;
  version: string;
  owner_id: string;
  owner_name: string;
  participant_roles_json: string;
  priority: Requirement["priority"];
  status: RequirementStatus;
  start_date: string | null;
  due_date: string | null;
  estimated_hours: number | string | null;
  actual_hours: number | string | null;
  latest_progress: string;
  next_step: string;
  blocker: string;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
};

type ProgressRow = {
  id: string;
  requirement_id: string;
  user_id: string;
  user_name: string;
  progress: string;
  next_step: string;
  blocker: string;
  previous_status: RequirementStatus;
  new_status: RequirementStatus;
  created_at: string;
};

export type RequirementInput = {
  code?: string | null;
  title: string;
  bookName: string;
  type: Requirement["type"];
  background: string;
  source: string;
  acceptanceCriteria: string;
  version: string;
  ownerId: string;
  participantRoles: TeamRole[];
  priority: Requirement["priority"];
  status: RequirementStatus;
  startDate?: string | null;
  dueDate?: string | null;
  estimatedHours?: number | null;
  actualHours?: number | null;
  latestProgress: string;
  nextStep: string;
  blocker: string;
};

export type ProjectInput = {
  name: string;
  projectType?: ProjectType | "";
  description: string;
  status: "active" | "archived";
  summaryStatus?: ProjectSummaryStatus;
  ownerId?: string | null;
  priority?: RequirementPriority;
  startDate?: string | null;
  targetDate?: string | null;
  completedDate?: string | null;
  overallProgress?: number | null;
  department?: string;
  budget?: number | null;
  actualSpend?: number | null;
  riskLevel?: ProjectRiskLevel;
  milestone?: string;
  documentLink?: string;
  note?: string;
  trackSummaries?: Partial<Record<ProjectTrack, Partial<ProjectTrackSummary>>>;
};

function mapUser(row: UserRow): UserWithPassword {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    loginCode: row.login_code,
    role: row.role,
    permission: row.permission,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function coerceNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function defaultProjectTrackSummaries(): Record<ProjectTrack, ProjectTrackSummary> {
  return Object.fromEntries(
    PROJECT_TRACKS.map((track) => [track, { progress: 0, summary: "", completed: "", pending: "" }]),
  ) as Record<ProjectTrack, ProjectTrackSummary>;
}

function normalizeTrackSummary(input?: Partial<ProjectTrackSummary>): ProjectTrackSummary {
  return {
    progress:
      typeof input?.progress === "number" && Number.isFinite(input.progress)
        ? Math.max(0, Math.min(100, Math.round(input.progress)))
        : 0,
    summary: input?.summary?.trim() ?? "",
    completed: input?.completed?.trim() ?? "",
    pending: input?.pending?.trim() ?? "",
  };
}

function parseTrackSummaries(value: string | null | undefined) {
  const defaults = defaultProjectTrackSummaries();
  if (!value) return defaults;
  try {
    const parsed = JSON.parse(value) as Partial<Record<ProjectTrack, Partial<ProjectTrackSummary>>>;
    return Object.fromEntries(
      PROJECT_TRACKS.map((track) => [track, normalizeTrackSummary(parsed?.[track])]),
    ) as Record<ProjectTrack, ProjectTrackSummary>;
  } catch {
    return defaults;
  }
}

function stringifyTrackSummaries(input?: Partial<Record<ProjectTrack, Partial<ProjectTrackSummary>>>) {
  return JSON.stringify(
    Object.fromEntries(
      PROJECT_TRACKS.map((track) => [track, normalizeTrackSummary(input?.[track])]),
    ),
  );
}

function resolveOverallProgress(
  explicitProgress: number | null | undefined,
  trackSummaries: Record<ProjectTrack, ProjectTrackSummary>,
) {
  if (typeof explicitProgress === "number" && Number.isFinite(explicitProgress)) {
    return Math.max(0, Math.min(100, Math.round(explicitProgress)));
  }
  const values = PROJECT_TRACKS.map((track) => trackSummaries[track].progress).filter((value) => value > 0);
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function publicUser(user: UserWithPassword): User {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    loginCode: user.loginCode,
    role: user.role,
    permission: user.permission,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function mapProject(row: ProjectRow): Project {
  const trackSummaries = parseTrackSummaries(row.track_summaries_json);
  return {
    id: row.id,
    name: row.name,
    projectType: row.project_type,
    description: row.description,
    status: row.status,
    summaryStatus: row.summary_status,
    ownerId: row.owner_id,
    ownerName: row.owner_name ?? null,
    priority: row.priority,
    startDate: row.start_date,
    targetDate: row.target_date,
    completedDate: row.completed_date,
    overallProgress: coerceNumber(row.overall_progress) ?? resolveOverallProgress(undefined, trackSummaries),
    department: row.department,
    budget: coerceNumber(row.budget),
    actualSpend: coerceNumber(row.actual_spend),
    riskLevel: row.risk_level,
    milestone: row.milestone,
    documentLink: row.document_link,
    note: row.note,
    trackSummaries,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    requirementCount: coerceNumber(row.requirement_count) ?? 0,
    blockedCount: coerceNumber(row.blocked_count) ?? 0,
    doneCount: coerceNumber(row.done_count) ?? 0,
  };
}

function parseRoles(value: string): TeamRole[] {
  try {
    const roles = JSON.parse(value);
    return Array.isArray(roles) ? (roles as TeamRole[]) : [];
  } catch {
    return [];
  }
}

function mapRequirement(row: RequirementRow): Requirement {
  return {
    id: row.id,
    projectId: row.project_id,
    code: row.code,
    title: row.title,
    bookName: row.book_name,
    type: row.type,
    background: row.background,
    source: row.source,
    acceptanceCriteria: row.acceptance_criteria,
    version: row.version,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    participantRoles: parseRoles(row.participant_roles_json),
    priority: row.priority,
    status: row.status,
    startDate: row.start_date,
    dueDate: row.due_date,
    estimatedHours: coerceNumber(row.estimated_hours),
    actualHours: coerceNumber(row.actual_hours),
    latestProgress: row.latest_progress,
    nextStep: row.next_step,
    blocker: row.blocker,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapProgress(row: ProgressRow): ProgressUpdate {
  return {
    id: row.id,
    requirementId: row.requirement_id,
    userId: row.user_id,
    userName: row.user_name,
    progress: row.progress,
    nextStep: row.next_step,
    blocker: row.blocker,
    previousStatus: row.previous_status,
    newStatus: row.new_status,
    createdAt: row.created_at,
  };
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function normalizeLoginCode(loginCode: string) {
  return loginCode.trim().toUpperCase();
}

async function resolveExecutor(executor?: DbExecutor) {
  return executor ?? (await getDbExecutor());
}

async function generateLoginCode(executor?: DbExecutor) {
  const db = await resolveExecutor(executor);
  for (let index = 0; index < 20; index += 1) {
    const loginCode = randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
    const existing = await db.one<{ id: string }>("SELECT id FROM users WHERE login_code = ?", [loginCode]);
    if (!existing) return loginCode;
  }
  throw new Error("login_code_generation_failed");
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, process.env.NODE_ENV === "test" ? 4 : 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function hasUsers(executor?: DbExecutor) {
  const db = await resolveExecutor(executor);
  const row = await db.one<{ count: number }>("SELECT COUNT(*) AS count FROM users");
  return (coerceNumber(row?.count) ?? 0) > 0;
}

export async function getUserByEmail(email: string, executor?: DbExecutor) {
  const db = await resolveExecutor(executor);
  const row = await db.one<UserRow>("SELECT * FROM users WHERE email = ?", [email.toLowerCase()]);
  return row ? mapUser(row) : null;
}

export async function getUserByLoginCode(loginCode: string, executor?: DbExecutor) {
  const db = await resolveExecutor(executor);
  const row = await db.one<UserRow>("SELECT * FROM users WHERE login_code = ?", [normalizeLoginCode(loginCode)]);
  return row ? mapUser(row) : null;
}

export async function getUserById(id: string, executor?: DbExecutor) {
  const db = await resolveExecutor(executor);
  const row = await db.one<UserRow>("SELECT * FROM users WHERE id = ?", [id]);
  return row ? mapUser(row) : null;
}

export async function listUsers(executor?: DbExecutor) {
  const db = await resolveExecutor(executor);
  const rows = await db.all<UserRow>(
    `SELECT * FROM users
     ORDER BY CASE WHEN permission = 'admin' THEN 0 ELSE 1 END, role, name`,
  );
  return rows.map(mapUser).map(publicUser);
}

export async function createUser(
  input: {
    name: string;
    email: string;
    loginCode?: string;
    password: string;
    role: TeamRole;
    permission: "admin" | "member";
  },
  executor?: DbExecutor,
) {
  const db = await resolveExecutor(executor);
  const timestamp = nowIso();
  const user: UserRow = {
    id: newId("user"),
    name: input.name,
    email: input.email.toLowerCase(),
    login_code: input.loginCode ? normalizeLoginCode(input.loginCode) : await generateLoginCode(db),
    role: input.role,
    permission: input.permission,
    password_hash: await hashPassword(input.password),
    created_at: timestamp,
    updated_at: timestamp,
  };

  await db.run(
    `INSERT INTO users (id, name, email, login_code, role, permission, password_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      user.id,
      user.name,
      user.email,
      user.login_code,
      user.role,
      user.permission,
      user.password_hash,
      user.created_at,
      user.updated_at,
    ],
  );

  return publicUser(mapUser(user));
}

export async function createInitialAdmin(input: { name: string; email: string; password: string }) {
  if (await hasUsers()) throw new Error("setup_already_completed");

  return withTransaction(async (tx) => {
    const created = await createUser(
      {
        name: input.name,
        email: input.email,
        loginCode: "ADMIN1",
        password: input.password,
        role: "产品",
        permission: "admin",
      },
      tx,
    );

    const timestamp = nowIso();
    for (const projectName of DEFAULT_PROJECTS) {
      await tx.run(
        `INSERT INTO projects (
          id, name, project_type, description, status, summary_status, owner_id, priority, start_date, target_date,
          completed_date, overall_progress, department, budget, actual_spend, risk_level,
          milestone, document_link, note, track_summaries_json, created_by, created_at, updated_at
        ) VALUES (?, ?, '', '', 'active', '进行中', ?, '中', NULL, NULL, NULL, 0, '', NULL, NULL, '中', '', '', '', ?, ?, ?, ?)`,
        [
          newId("project"),
          projectName,
          created.id,
          stringifyTrackSummaries(),
          created.id,
          timestamp,
          timestamp,
        ],
      );
    }

    return created;
  });
}

export async function createSession(userId: string, executor?: DbExecutor) {
  const db = await resolveExecutor(executor);
  const token = randomBytes(32).toString("base64url");
  const timestamp = nowIso();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString();
  await db.run(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [newId("session"), userId, tokenHash(token), expiresAt, timestamp],
  );
  return { token, expiresAt };
}

export async function deleteSession(token: string, executor?: DbExecutor) {
  const db = await resolveExecutor(executor);
  await db.run("DELETE FROM sessions WHERE token_hash = ?", [tokenHash(token)]);
}

export async function getUserBySessionToken(token: string, executor?: DbExecutor) {
  const db = await resolveExecutor(executor);
  const row = await db.one<UserRow>(
    `SELECT users.*
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
    [tokenHash(token), nowIso()],
  );
  return row ? mapUser(row) : null;
}

export async function listProjects(executor?: DbExecutor) {
  const db = await resolveExecutor(executor);
  const rows = await db.all<ProjectRow>(
    `SELECT p.*,
        u.name AS owner_name,
        COALESCE(rs.requirement_count, 0) AS requirement_count,
        COALESCE(rs.blocked_count, 0) AS blocked_count,
        COALESCE(rs.done_count, 0) AS done_count
     FROM projects p
     LEFT JOIN users u ON u.id = p.owner_id
     LEFT JOIN (
       SELECT
         project_id,
         COUNT(*) AS requirement_count,
         SUM(CASE WHEN status = '阻塞' THEN 1 ELSE 0 END) AS blocked_count,
         SUM(CASE WHEN status = '已完成' THEN 1 ELSE 0 END) AS done_count
       FROM requirements
       GROUP BY project_id
     ) rs ON rs.project_id = p.id
     ORDER BY p.updated_at DESC`,
  );
  return rows.map(mapProject);
}

export async function getProjectById(projectId: string, executor?: DbExecutor) {
  const db = await resolveExecutor(executor);
  const row = await db.one<ProjectRow>(
    `SELECT p.*, u.name AS owner_name
     FROM projects p
     LEFT JOIN users u ON u.id = p.owner_id
     WHERE p.id = ?`,
    [projectId],
  );
  return row ? mapProject(row) : null;
}

export async function createProject(input: ProjectInput & { actorId: string }, executor?: DbExecutor) {
  const db = await resolveExecutor(executor);
  const timestamp = nowIso();
  const trackSummaries = parseTrackSummaries(stringifyTrackSummaries(input.trackSummaries));
  const row: ProjectRow = {
    id: newId("project"),
    name: input.name,
    project_type: input.projectType ?? "",
    description: input.description,
    status: input.status,
    summary_status: input.summaryStatus ?? "进行中",
    owner_id: input.ownerId ?? null,
    priority: input.priority ?? "中",
    start_date: input.startDate ?? null,
    target_date: input.targetDate ?? null,
    completed_date: input.completedDate ?? null,
    overall_progress: resolveOverallProgress(input.overallProgress, trackSummaries),
    department: input.department?.trim() ?? "",
    budget: input.budget ?? null,
    actual_spend: input.actualSpend ?? null,
    risk_level: input.riskLevel ?? "中",
    milestone: input.milestone?.trim() ?? "",
    document_link: input.documentLink?.trim() ?? "",
    note: input.note?.trim() ?? "",
    track_summaries_json: JSON.stringify(trackSummaries),
    created_by: input.actorId,
    created_at: timestamp,
    updated_at: timestamp,
  };

  await db.run(
    `INSERT INTO projects (
      id, name, project_type, description, status, summary_status, owner_id, priority, start_date, target_date,
      completed_date, overall_progress, department, budget, actual_spend, risk_level,
      milestone, document_link, note, track_summaries_json, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.name,
      row.project_type,
      row.description,
      row.status,
      row.summary_status,
      row.owner_id,
      row.priority,
      row.start_date,
      row.target_date,
      row.completed_date,
      row.overall_progress,
      row.department,
      row.budget,
      row.actual_spend,
      row.risk_level,
      row.milestone,
      row.document_link,
      row.note,
      row.track_summaries_json,
      row.created_by,
      row.created_at,
      row.updated_at,
    ],
  );
  await writeAudit(input.actorId, "create_project", "project", row.id, { name: input.name }, db);
  return getProjectById(row.id, db);
}

export async function updateProject(projectId: string, input: ProjectInput, actorId: string, executor?: DbExecutor) {
  const db = await resolveExecutor(executor);
  const current = await getProjectById(projectId, db);
  if (!current) return null;
  const timestamp = nowIso();
  const trackSummaries = parseTrackSummaries(
    stringifyTrackSummaries(
      Object.fromEntries(
        PROJECT_TRACKS.map((track) => [track, { ...current.trackSummaries[track], ...input.trackSummaries?.[track] }]),
      ) as Partial<Record<ProjectTrack, Partial<ProjectTrackSummary>>>,
    ),
  );

  await db.run(
    `UPDATE projects
     SET name = ?, project_type = ?, description = ?, status = ?, summary_status = ?, owner_id = ?, priority = ?, start_date = ?,
      target_date = ?, completed_date = ?, overall_progress = ?, department = ?, budget = ?, actual_spend = ?,
      risk_level = ?, milestone = ?, document_link = ?, note = ?, track_summaries_json = ?, updated_at = ?
     WHERE id = ?`,
    [
      input.name,
      input.projectType ?? "",
      input.description,
      input.status,
      input.summaryStatus ?? "进行中",
      input.ownerId ?? null,
      input.priority ?? "中",
      input.startDate ?? null,
      input.targetDate ?? null,
      input.completedDate ?? null,
      resolveOverallProgress(input.overallProgress, trackSummaries),
      input.department?.trim() ?? "",
      input.budget ?? current.budget,
      input.actualSpend ?? current.actualSpend,
      input.riskLevel ?? "中",
      input.milestone?.trim() ?? "",
      input.documentLink?.trim() ?? "",
      input.note?.trim() ?? "",
      JSON.stringify(trackSummaries),
      timestamp,
      projectId,
    ],
  );
  await writeAudit(actorId, "update_project", "project", projectId, input, db);
  return getProjectById(projectId, db);
}

export async function nextRequirementCode(projectId: string, executor?: DbExecutor) {
  const db = await resolveExecutor(executor);
  const row = await db.one<{ count: number }>("SELECT COUNT(*) AS count FROM requirements WHERE project_id = ?", [
    projectId,
  ]);
  return `REQ-${String((coerceNumber(row?.count) ?? 0) + 1).padStart(4, "0")}`;
}

async function ensureOwnerExists(ownerId: string, executor?: DbExecutor) {
  if (!(await getUserById(ownerId, executor))) throw new Error("owner_not_found");
}

export async function listRequirements(
  projectId: string,
  filters: { status?: string; ownerId?: string; role?: string; bookName?: string; search?: string } = {},
  executor?: DbExecutor,
) {
  const db = await resolveExecutor(executor);
  const where = ["r.project_id = ?"];
  const params: string[] = [projectId];

  if (filters.status) {
    where.push("r.status = ?");
    params.push(filters.status);
  }
  if (filters.ownerId) {
    where.push("r.owner_id = ?");
    params.push(filters.ownerId);
  }
  if (filters.role) {
    where.push("r.participant_roles_json LIKE ?");
    params.push(`%"${filters.role}"%`);
  }
  if (filters.bookName) {
    where.push("r.book_name = ?");
    params.push(filters.bookName);
  }
  if (filters.search) {
    where.push("(r.title LIKE ? OR r.code LIKE ? OR r.book_name LIKE ? OR r.latest_progress LIKE ?)");
    const pattern = `%${filters.search}%`;
    params.push(pattern, pattern, pattern, pattern);
  }

  const rows = await db.all<RequirementRow>(
    `SELECT r.*, u.name AS owner_name
     FROM requirements r
     JOIN users u ON u.id = r.owner_id
     WHERE ${where.join(" AND ")}
     ORDER BY
      CASE r.status
        WHEN '阻塞' THEN 0
        WHEN '进行中' THEN 1
        WHEN '待验收' THEN 2
        WHEN '待开始' THEN 3
        ELSE 4
      END,
      r.updated_at DESC`,
    params,
  );
  return rows.map(mapRequirement);
}

export async function getRequirementById(requirementId: string, executor?: DbExecutor) {
  const db = await resolveExecutor(executor);
  const row = await db.one<RequirementRow>(
    `SELECT r.*, u.name AS owner_name
     FROM requirements r
     JOIN users u ON u.id = r.owner_id
     WHERE r.id = ?`,
    [requirementId],
  );
  return row ? mapRequirement(row) : null;
}

export async function getRequirementByProjectAndCode(projectId: string, code: string, executor?: DbExecutor) {
  const db = await resolveExecutor(executor);
  const row = await db.one<RequirementRow>(
    `SELECT r.*, u.name AS owner_name
     FROM requirements r
     JOIN users u ON u.id = r.owner_id
     WHERE r.project_id = ? AND r.code = ?`,
    [projectId, code],
  );
  return row ? mapRequirement(row) : null;
}

export async function createRequirement(
  projectId: string,
  input: RequirementInput,
  actorId: string,
  executor?: DbExecutor,
) {
  const db = await resolveExecutor(executor);
  await ensureOwnerExists(input.ownerId, db);
  const timestamp = nowIso();
  const row = {
    id: newId("req"),
    project_id: projectId,
    code: input.code?.trim() || (await nextRequirementCode(projectId, db)),
    title: input.title,
    book_name: input.bookName,
    type: input.type,
    background: input.background,
    source: input.source,
    acceptance_criteria: input.acceptanceCriteria,
    version: input.version,
    owner_id: input.ownerId,
    participant_roles_json: JSON.stringify(input.participantRoles),
    priority: input.priority,
    status: input.status,
    start_date: input.startDate ?? null,
    due_date: input.dueDate ?? null,
    estimated_hours: input.estimatedHours ?? null,
    actual_hours: input.actualHours ?? null,
    latest_progress: input.latestProgress,
    next_step: input.nextStep,
    blocker: input.blocker,
    created_by: actorId,
    updated_by: actorId,
    created_at: timestamp,
    updated_at: timestamp,
  };

  await db.run(
    `INSERT INTO requirements (
      id, project_id, code, title, book_name, type, background, source, acceptance_criteria,
      version, owner_id, participant_roles_json, priority, status, start_date, due_date,
      estimated_hours, actual_hours, latest_progress, next_step, blocker,
      created_by, updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.project_id,
      row.code,
      row.title,
      row.book_name,
      row.type,
      row.background,
      row.source,
      row.acceptance_criteria,
      row.version,
      row.owner_id,
      row.participant_roles_json,
      row.priority,
      row.status,
      row.start_date,
      row.due_date,
      row.estimated_hours,
      row.actual_hours,
      row.latest_progress,
      row.next_step,
      row.blocker,
      row.created_by,
      row.updated_by,
      row.created_at,
      row.updated_at,
    ],
  );
  await touchProject(projectId, db);
  await writeAudit(actorId, "create_requirement", "requirement", row.id, { projectId, code: row.code }, db);
  return getRequirementById(row.id, db);
}

export async function updateRequirement(
  requirementId: string,
  input: RequirementInput,
  actorId: string,
  executor?: DbExecutor,
) {
  const db = await resolveExecutor(executor);
  await ensureOwnerExists(input.ownerId, db);
  const current = await getRequirementById(requirementId, db);
  if (!current) return null;
  const timestamp = nowIso();

  await db.run(
    `UPDATE requirements
     SET code = ?, title = ?, book_name = ?, type = ?, background = ?, source = ?, acceptance_criteria = ?,
      version = ?, owner_id = ?, participant_roles_json = ?, priority = ?, status = ?,
      start_date = ?, due_date = ?, estimated_hours = ?, actual_hours = ?,
      latest_progress = ?, next_step = ?, blocker = ?, updated_by = ?, updated_at = ?
     WHERE id = ?`,
    [
      input.code?.trim() || current.code,
      input.title,
      input.bookName,
      input.type,
      input.background,
      input.source,
      input.acceptanceCriteria,
      input.version,
      input.ownerId,
      JSON.stringify(input.participantRoles),
      input.priority,
      input.status,
      input.startDate ?? null,
      input.dueDate ?? null,
      input.estimatedHours ?? null,
      input.actualHours ?? null,
      input.latestProgress,
      input.nextStep,
      input.blocker,
      actorId,
      timestamp,
      requirementId,
    ],
  );
  await touchProject(current.projectId, db);
  await writeAudit(actorId, "update_requirement", "requirement", requirementId, { status: input.status }, db);
  return getRequirementById(requirementId, db);
}

export async function addProgressUpdate(
  requirementId: string,
  input: { progress: string; nextStep: string; blocker: string; status?: RequirementStatus },
  actorId: string,
) {
  return withTransaction(async (tx) => {
    const current = await getRequirementById(requirementId, tx);
    if (!current) return null;
    const timestamp = nowIso();
    const nextStatus = input.status ?? current.status;
    const progressId = newId("progress");

    await tx.run(
      `INSERT INTO progress_updates (
        id, requirement_id, user_id, progress, next_step, blocker,
        previous_status, new_status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        progressId,
        requirementId,
        actorId,
        input.progress,
        input.nextStep,
        input.blocker,
        current.status,
        nextStatus,
        timestamp,
      ],
    );

    await tx.run(
      `UPDATE requirements
       SET latest_progress = ?, next_step = ?, blocker = ?, status = ?, updated_by = ?, updated_at = ?
       WHERE id = ?`,
      [input.progress, input.nextStep, input.blocker, nextStatus, actorId, timestamp, requirementId],
    );

    await touchProject(current.projectId, tx);
    await writeAudit(actorId, "add_progress", "requirement", requirementId, {
      previousStatus: current.status,
      newStatus: nextStatus,
    }, tx);

    return getProgressUpdateById(progressId, tx);
  });
}

export async function updateRequirementStatus(requirementId: string, status: RequirementStatus, actorId: string) {
  const current = await getRequirementById(requirementId);
  if (!current) return null;
  if (current.status === status) return current;

  await addProgressUpdate(
    requirementId,
    {
      progress: `状态从「${current.status}」调整为「${status}」。`,
      nextStep: current.nextStep,
      blocker: current.blocker,
      status,
    },
    actorId,
  );
  return getRequirementById(requirementId);
}

export async function listProgressUpdates(requirementId: string, executor?: DbExecutor) {
  const db = await resolveExecutor(executor);
  const rows = await db.all<ProgressRow>(
    `SELECT p.*, u.name AS user_name
     FROM progress_updates p
     JOIN users u ON u.id = p.user_id
     WHERE p.requirement_id = ?
     ORDER BY p.created_at DESC`,
    [requirementId],
  );
  return rows.map(mapProgress);
}

async function getProgressUpdateById(id: string, executor?: DbExecutor) {
  const db = await resolveExecutor(executor);
  const row = await db.one<ProgressRow>(
    `SELECT p.*, u.name AS user_name
     FROM progress_updates p
     JOIN users u ON u.id = p.user_id
     WHERE p.id = ?`,
    [id],
  );
  return row ? mapProgress(row) : null;
}

export async function findUserByName(name: string, executor?: DbExecutor) {
  const db = await resolveExecutor(executor);
  const row = await db.one<UserRow>("SELECT * FROM users WHERE name = ?", [name]);
  return row ? mapUser(row) : null;
}

export async function touchProject(projectId: string, executor?: DbExecutor) {
  const db = await resolveExecutor(executor);
  await db.run("UPDATE projects SET updated_at = ? WHERE id = ?", [nowIso(), projectId]);
}

export async function writeAudit(
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  details: Record<string, unknown>,
  executor?: DbExecutor,
) {
  const db = await resolveExecutor(executor);
  await db.run(
    `INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [newId("audit"), actorId, action, entityType, entityId, JSON.stringify(details), nowIso()],
  );
}

export async function recordImportBatch(
  input: {
    projectId: string;
    userId: string;
    fileName: string;
    fileType: string;
    rowCount: number;
    created: number;
    updated: number;
    errors: Array<unknown>;
  },
  executor?: DbExecutor,
) {
  const db = await resolveExecutor(executor);
  await db.run(
    `INSERT INTO import_batches (
      id, project_id, user_id, file_name, file_type, row_count,
      created_count, updated_count, error_count, errors_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newId("import"),
      input.projectId,
      input.userId,
      input.fileName,
      input.fileType,
      input.rowCount,
      input.created,
      input.updated,
      input.errors.length,
      JSON.stringify(input.errors),
      nowIso(),
    ],
  );
}
