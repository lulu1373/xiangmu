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
import { getDb } from "@/lib/db";
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
  overall_progress: number;
  department: string;
  budget: number | null;
  actual_spend: number | null;
  risk_level: ProjectRiskLevel;
  milestone: string;
  document_link: string;
  note: string;
  track_summaries_json: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  requirement_count?: number;
  blocked_count?: number;
  done_count?: number;
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
  estimated_hours: number | null;
  actual_hours: number | null;
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
    overallProgress: row.overall_progress ?? resolveOverallProgress(undefined, trackSummaries),
    department: row.department,
    budget: row.budget,
    actualSpend: row.actual_spend,
    riskLevel: row.risk_level,
    milestone: row.milestone,
    documentLink: row.document_link,
    note: row.note,
    trackSummaries,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    requirementCount: row.requirement_count ?? 0,
    blockedCount: row.blocked_count ?? 0,
    doneCount: row.done_count ?? 0,
  };
}

function parseRoles(value: string): TeamRole[] {
  try {
    const roles = JSON.parse(value);
    return Array.isArray(roles) ? roles : [];
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
    estimatedHours: row.estimated_hours,
    actualHours: row.actual_hours,
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

function generateLoginCode() {
  const db = getDb();
  for (let index = 0; index < 20; index += 1) {
    const loginCode = randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
    const existing = db.prepare("SELECT id FROM users WHERE login_code = ?").get(loginCode);
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

export function hasUsers() {
  const row = getDb().prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
  return row.count > 0;
}

export function getUserByEmail(email: string) {
  const row = getDb()
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(email.toLowerCase()) as UserRow | undefined;
  return row ? mapUser(row) : null;
}

export function getUserByLoginCode(loginCode: string) {
  const row = getDb()
    .prepare("SELECT * FROM users WHERE login_code = ?")
    .get(normalizeLoginCode(loginCode)) as UserRow | undefined;
  return row ? mapUser(row) : null;
}

export function getUserById(id: string) {
  const row = getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
  return row ? mapUser(row) : null;
}

export function listUsers() {
  const rows = getDb()
    .prepare("SELECT * FROM users ORDER BY permission = 'admin' DESC, role, name")
    .all() as UserRow[];
  return rows.map(mapUser).map(publicUser);
}

export async function createUser(input: {
  name: string;
  email: string;
  loginCode?: string;
  password: string;
  role: TeamRole;
  permission: "admin" | "member";
}) {
  const timestamp = nowIso();
  const user: UserRow = {
    id: newId("user"),
    name: input.name,
    email: input.email.toLowerCase(),
    login_code: input.loginCode ? normalizeLoginCode(input.loginCode) : generateLoginCode(),
    role: input.role,
    permission: input.permission,
    password_hash: await hashPassword(input.password),
    created_at: timestamp,
    updated_at: timestamp,
  };

  getDb()
    .prepare(
      `INSERT INTO users (id, name, email, login_code, role, permission, password_hash, created_at, updated_at)
       VALUES (@id, @name, @email, @login_code, @role, @permission, @password_hash, @created_at, @updated_at)`,
    )
    .run(user);

  return publicUser(mapUser(user));
}

export async function createInitialAdmin(input: { name: string; email: string; password: string }) {
  if (hasUsers()) throw new Error("setup_already_completed");
  const db = getDb();
  const created = await createUser({
    name: input.name,
    email: input.email,
    loginCode: "ADMIN1",
    password: input.password,
    role: "产品",
    permission: "admin",
  });

  const timestamp = nowIso();
  const insertProject = db.prepare(
    `INSERT INTO projects (
      id, name, project_type, description, status, summary_status, owner_id, priority, start_date, target_date,
      completed_date, overall_progress, department, budget, actual_spend, risk_level,
      milestone, document_link, note, track_summaries_json, created_by, created_at, updated_at
    ) VALUES (
      ?, ?, '', '', 'active', '进行中', ?, '中', NULL, NULL,
      NULL, 0, '', NULL, NULL, '中',
      '', '', '', ?, ?, ?, ?
    )`,
  );

  const transaction = db.transaction(() => {
    for (const projectName of DEFAULT_PROJECTS) {
      insertProject.run(
        newId("project"),
        projectName,
        created.id,
        stringifyTrackSummaries(),
        created.id,
        timestamp,
        timestamp,
      );
    }
  });
  transaction();

  return created;
}

export function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const timestamp = nowIso();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString();
  getDb()
    .prepare(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(newId("session"), userId, tokenHash(token), expiresAt, timestamp);
  return { token, expiresAt };
}

export function deleteSession(token: string) {
  getDb().prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token));
}

export function getUserBySessionToken(token: string) {
  const row = getDb()
    .prepare(
      `SELECT users.*
       FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
    )
    .get(tokenHash(token), nowIso()) as UserRow | undefined;
  return row ? mapUser(row) : null;
}

export function listProjects() {
  const rows = getDb()
    .prepare(
      `SELECT p.*,
        u.name AS owner_name,
        COUNT(r.id) AS requirement_count,
        SUM(CASE WHEN r.status = '阻塞' THEN 1 ELSE 0 END) AS blocked_count,
        SUM(CASE WHEN r.status = '已完成' THEN 1 ELSE 0 END) AS done_count
       FROM projects p
       LEFT JOIN users u ON u.id = p.owner_id
       LEFT JOIN requirements r ON r.project_id = p.id
       GROUP BY p.id
       ORDER BY p.updated_at DESC`,
    )
    .all() as ProjectRow[];
  return rows.map(mapProject);
}

export function getProjectById(projectId: string) {
  const row = getDb()
    .prepare(
      `SELECT p.*, u.name AS owner_name
       FROM projects p
       LEFT JOIN users u ON u.id = p.owner_id
       WHERE p.id = ?`,
    )
    .get(projectId) as ProjectRow | undefined;
  return row ? mapProject(row) : null;
}

export function createProject(input: ProjectInput & { actorId: string }) {
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
  getDb()
    .prepare(
      `INSERT INTO projects (
        id, name, project_type, description, status, summary_status, owner_id, priority, start_date, target_date,
        completed_date, overall_progress, department, budget, actual_spend, risk_level,
        milestone, document_link, note, track_summaries_json, created_by, created_at, updated_at
      ) VALUES (
        @id, @name, @project_type, @description, @status, @summary_status, @owner_id, @priority, @start_date, @target_date,
        @completed_date, @overall_progress, @department, @budget, @actual_spend, @risk_level,
        @milestone, @document_link, @note, @track_summaries_json, @created_by, @created_at, @updated_at
      )`,
    )
    .run(row);
  writeAudit(input.actorId, "create_project", "project", row.id, { name: input.name });
  return getProjectById(row.id);
}

export function updateProject(projectId: string, input: ProjectInput, actorId: string) {
  const current = getProjectById(projectId);
  if (!current) return null;
  const timestamp = nowIso();
  const trackSummaries = parseTrackSummaries(
    stringifyTrackSummaries(
      Object.fromEntries(
        PROJECT_TRACKS.map((track) => [track, { ...current.trackSummaries[track], ...input.trackSummaries?.[track] }]),
      ) as Partial<Record<ProjectTrack, Partial<ProjectTrackSummary>>>,
    ),
  );
  getDb()
    .prepare(
      `UPDATE projects
       SET name = ?, project_type = ?, description = ?, status = ?, summary_status = ?, owner_id = ?, priority = ?, start_date = ?,
        target_date = ?, completed_date = ?, overall_progress = ?, department = ?, budget = ?, actual_spend = ?,
        risk_level = ?, milestone = ?, document_link = ?, note = ?, track_summaries_json = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
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
      input.budget ?? null,
      input.actualSpend ?? null,
      input.riskLevel ?? "中",
      input.milestone?.trim() ?? "",
      input.documentLink?.trim() ?? "",
      input.note?.trim() ?? "",
      JSON.stringify(trackSummaries),
      timestamp,
      projectId,
    );
  writeAudit(actorId, "update_project", "project", projectId, input);
  return getProjectById(projectId);
}

export function nextRequirementCode(projectId: string) {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS count FROM requirements WHERE project_id = ?")
    .get(projectId) as { count: number };
  return `REQ-${String(row.count + 1).padStart(4, "0")}`;
}

function ensureOwnerExists(ownerId: string) {
  if (!getUserById(ownerId)) throw new Error("owner_not_found");
}

export function listRequirements(
  projectId: string,
  filters: { status?: string; ownerId?: string; role?: string; bookName?: string; search?: string } = {},
) {
  const where = ["r.project_id = ?"];
  const params: Array<string> = [projectId];
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
  const rows = getDb()
    .prepare(
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
    )
    .all(...params) as RequirementRow[];
  return rows.map(mapRequirement);
}

export function getRequirementById(requirementId: string) {
  const row = getDb()
    .prepare(
      `SELECT r.*, u.name AS owner_name
       FROM requirements r
       JOIN users u ON u.id = r.owner_id
       WHERE r.id = ?`,
    )
    .get(requirementId) as RequirementRow | undefined;
  return row ? mapRequirement(row) : null;
}

export function getRequirementByProjectAndCode(projectId: string, code: string) {
  const row = getDb()
    .prepare(
      `SELECT r.*, u.name AS owner_name
       FROM requirements r
       JOIN users u ON u.id = r.owner_id
       WHERE r.project_id = ? AND r.code = ?`,
    )
    .get(projectId, code) as RequirementRow | undefined;
  return row ? mapRequirement(row) : null;
}

export function createRequirement(projectId: string, input: RequirementInput, actorId: string) {
  ensureOwnerExists(input.ownerId);
  const timestamp = nowIso();
  const row = {
    id: newId("req"),
    project_id: projectId,
    code: input.code?.trim() || nextRequirementCode(projectId),
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
  getDb()
    .prepare(
      `INSERT INTO requirements (
        id, project_id, code, title, book_name, type, background, source, acceptance_criteria,
        version, owner_id, participant_roles_json, priority, status, start_date, due_date,
        estimated_hours, actual_hours, latest_progress, next_step, blocker,
        created_by, updated_by, created_at, updated_at
      ) VALUES (
        @id, @project_id, @code, @title, @book_name, @type, @background, @source, @acceptance_criteria,
        @version, @owner_id, @participant_roles_json, @priority, @status, @start_date, @due_date,
        @estimated_hours, @actual_hours, @latest_progress, @next_step, @blocker,
        @created_by, @updated_by, @created_at, @updated_at
      )`,
    )
    .run(row);
  touchProject(projectId);
  writeAudit(actorId, "create_requirement", "requirement", row.id, { projectId, code: row.code });
  return getRequirementById(row.id);
}

export function updateRequirement(requirementId: string, input: RequirementInput, actorId: string) {
  ensureOwnerExists(input.ownerId);
  const current = getRequirementById(requirementId);
  if (!current) return null;
  const timestamp = nowIso();
  getDb()
    .prepare(
      `UPDATE requirements
       SET code = ?, title = ?, book_name = ?, type = ?, background = ?, source = ?, acceptance_criteria = ?,
        version = ?, owner_id = ?, participant_roles_json = ?, priority = ?, status = ?,
        start_date = ?, due_date = ?, estimated_hours = ?, actual_hours = ?,
        latest_progress = ?, next_step = ?, blocker = ?, updated_by = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
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
    );
  touchProject(current.projectId);
  writeAudit(actorId, "update_requirement", "requirement", requirementId, { status: input.status });
  return getRequirementById(requirementId);
}

export function addProgressUpdate(
  requirementId: string,
  input: { progress: string; nextStep: string; blocker: string; status?: RequirementStatus },
  actorId: string,
) {
  const current = getRequirementById(requirementId);
  if (!current) return null;
  const timestamp = nowIso();
  const nextStatus = input.status ?? current.status;
  const progressId = newId("progress");
  const db = getDb();
  const transaction = db.transaction(() => {
    db.prepare(
      `INSERT INTO progress_updates (
        id, requirement_id, user_id, progress, next_step, blocker,
        previous_status, new_status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      progressId,
      requirementId,
      actorId,
      input.progress,
      input.nextStep,
      input.blocker,
      current.status,
      nextStatus,
      timestamp,
    );
    db.prepare(
      `UPDATE requirements
       SET latest_progress = ?, next_step = ?, blocker = ?, status = ?, updated_by = ?, updated_at = ?
       WHERE id = ?`,
    ).run(input.progress, input.nextStep, input.blocker, nextStatus, actorId, timestamp, requirementId);
    touchProject(current.projectId);
    writeAudit(actorId, "add_progress", "requirement", requirementId, {
      previousStatus: current.status,
      newStatus: nextStatus,
    });
  });
  transaction();
  return getProgressUpdateById(progressId);
}

export function updateRequirementStatus(requirementId: string, status: RequirementStatus, actorId: string) {
  const current = getRequirementById(requirementId);
  if (!current) return null;
  if (current.status === status) return current;
  addProgressUpdate(
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

export function listProgressUpdates(requirementId: string) {
  const rows = getDb()
    .prepare(
      `SELECT p.*, u.name AS user_name
       FROM progress_updates p
       JOIN users u ON u.id = p.user_id
       WHERE p.requirement_id = ?
       ORDER BY p.created_at DESC`,
    )
    .all(requirementId) as ProgressRow[];
  return rows.map(mapProgress);
}

function getProgressUpdateById(id: string) {
  const row = getDb()
    .prepare(
      `SELECT p.*, u.name AS user_name
       FROM progress_updates p
       JOIN users u ON u.id = p.user_id
       WHERE p.id = ?`,
    )
    .get(id) as ProgressRow | undefined;
  return row ? mapProgress(row) : null;
}

export function findUserByName(name: string) {
  const row = getDb().prepare("SELECT * FROM users WHERE name = ?").get(name) as UserRow | undefined;
  return row ? mapUser(row) : null;
}

export function touchProject(projectId: string) {
  getDb().prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(nowIso(), projectId);
}

export function writeAudit(
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  details: Record<string, unknown>,
) {
  getDb()
    .prepare(
      `INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(newId("audit"), actorId, action, entityType, entityId, JSON.stringify(details), nowIso());
}

export function recordImportBatch(input: {
  projectId: string;
  userId: string;
  fileName: string;
  fileType: string;
  rowCount: number;
  created: number;
  updated: number;
  errors: Array<unknown>;
}) {
  getDb()
    .prepare(
      `INSERT INTO import_batches (
        id, project_id, user_id, file_name, file_type, row_count,
        created_count, updated_count, error_count, errors_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
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
    );
}
