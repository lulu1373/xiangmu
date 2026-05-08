import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DEFAULT_PROJECTS, PROJECT_TRACKS } from "@/lib/constants";
import { newId, nowIso } from "@/lib/ids";

let cachedDb: Database.Database | null = null;
let cachedPath = "";

export function getDatabasePath() {
  return process.env.TEAM_PROGRESS_DB_PATH ?? path.join(process.cwd(), "data", "team-progress.sqlite");
}

export function getDb() {
  const dbPath = getDatabasePath();
  if (cachedDb && cachedPath === dbPath) return cachedDb;

  cachedDb?.close();
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  cachedDb = db;
  cachedPath = dbPath;
  return db;
}

export function closeDbForTests() {
  cachedDb?.close();
  cachedDb = null;
  cachedPath = "";
}

export function migrate(db = getDb()) {
  const defaultTrackSummariesJson = JSON.stringify(
    Object.fromEntries(
      PROJECT_TRACKS.map((track) => [track, { progress: 0, summary: "", completed: "", pending: "" }]),
    ),
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      login_code TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL CHECK (role IN ('运营', '产品', '技术')),
      permission TEXT NOT NULL CHECK (permission IN ('admin', 'member')),
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      project_type TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
      summary_status TEXT NOT NULL DEFAULT '进行中',
      owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      priority TEXT NOT NULL DEFAULT '中',
      start_date TEXT,
      target_date TEXT,
      completed_date TEXT,
      overall_progress INTEGER NOT NULL DEFAULT 0,
      department TEXT NOT NULL DEFAULT '',
      budget REAL,
      actual_spend REAL,
      risk_level TEXT NOT NULL DEFAULT '中',
      milestone TEXT NOT NULL DEFAULT '',
      document_link TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      track_summaries_json TEXT NOT NULL DEFAULT '${defaultTrackSummariesJson.replace(/'/g, "''")}',
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS requirements (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      title TEXT NOT NULL,
      book_name TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL,
      background TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      acceptance_criteria TEXT NOT NULL DEFAULT '',
      version TEXT NOT NULL DEFAULT '',
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      participant_roles_json TEXT NOT NULL,
      priority TEXT NOT NULL,
      status TEXT NOT NULL,
      start_date TEXT,
      due_date TEXT,
      estimated_hours REAL,
      actual_hours REAL,
      latest_progress TEXT NOT NULL DEFAULT '',
      next_step TEXT NOT NULL DEFAULT '',
      blocker TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      updated_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, code)
    );

    CREATE TABLE IF NOT EXISTS progress_updates (
      id TEXT PRIMARY KEY,
      requirement_id TEXT NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      progress TEXT NOT NULL,
      next_step TEXT NOT NULL DEFAULT '',
      blocker TEXT NOT NULL DEFAULT '',
      previous_status TEXT NOT NULL,
      new_status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS import_batches (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      file_name TEXT NOT NULL,
      file_type TEXT NOT NULL,
      row_count INTEGER NOT NULL,
      created_count INTEGER NOT NULL,
      updated_count INTEGER NOT NULL,
      error_count INTEGER NOT NULL,
      errors_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_requirements_project_status ON requirements(project_id, status);
    CREATE INDEX IF NOT EXISTS idx_requirements_owner ON requirements(owner_id);
    CREATE INDEX IF NOT EXISTS idx_progress_requirement ON progress_updates(requirement_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  `);

  const columns = db.prepare("PRAGMA table_info(requirements)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "book_name")) {
    db.exec("ALTER TABLE requirements ADD COLUMN book_name TEXT NOT NULL DEFAULT ''");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_requirements_book ON requirements(book_name)");

  const projectColumns = db.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>;
  const projectAlterStatements = [
    ["project_type", "ALTER TABLE projects ADD COLUMN project_type TEXT NOT NULL DEFAULT ''"],
    ["summary_status", "ALTER TABLE projects ADD COLUMN summary_status TEXT NOT NULL DEFAULT '进行中'"],
    ["priority", "ALTER TABLE projects ADD COLUMN priority TEXT NOT NULL DEFAULT '中'"],
    ["start_date", "ALTER TABLE projects ADD COLUMN start_date TEXT"],
    ["target_date", "ALTER TABLE projects ADD COLUMN target_date TEXT"],
    ["completed_date", "ALTER TABLE projects ADD COLUMN completed_date TEXT"],
    ["overall_progress", "ALTER TABLE projects ADD COLUMN overall_progress INTEGER NOT NULL DEFAULT 0"],
    ["department", "ALTER TABLE projects ADD COLUMN department TEXT NOT NULL DEFAULT ''"],
    ["budget", "ALTER TABLE projects ADD COLUMN budget REAL"],
    ["actual_spend", "ALTER TABLE projects ADD COLUMN actual_spend REAL"],
    ["risk_level", "ALTER TABLE projects ADD COLUMN risk_level TEXT NOT NULL DEFAULT '中'"],
    ["milestone", "ALTER TABLE projects ADD COLUMN milestone TEXT NOT NULL DEFAULT ''"],
    ["document_link", "ALTER TABLE projects ADD COLUMN document_link TEXT NOT NULL DEFAULT ''"],
    ["note", "ALTER TABLE projects ADD COLUMN note TEXT NOT NULL DEFAULT ''"],
    [
      "track_summaries_json",
      `ALTER TABLE projects ADD COLUMN track_summaries_json TEXT NOT NULL DEFAULT '${defaultTrackSummariesJson.replace(/'/g, "''")}'`,
    ],
  ] as const;

  for (const [columnName, statement] of projectAlterStatements) {
    if (!projectColumns.some((column) => column.name === columnName)) {
      db.exec(statement);
    }
  }

  db.prepare(
    `UPDATE projects
     SET track_summaries_json = ?
     WHERE track_summaries_json IS NULL OR trim(track_summaries_json) = ''`,
  ).run(defaultTrackSummariesJson);

  const userColumns = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
  if (!userColumns.some((column) => column.name === "login_code")) {
    db.exec("ALTER TABLE users ADD COLUMN login_code TEXT NOT NULL DEFAULT ''");
  }
  db.exec(`
    UPDATE users
    SET login_code = upper(substr(replace(id, 'user_', ''), 1, 6))
    WHERE login_code = '';

    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_login_code
    ON users(login_code)
    WHERE login_code <> '';
  `);

  const userCount = (db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number }).count;
  if (userCount > 0) {
    const timestamp = nowIso();
    const insertProject = db.prepare(
      `INSERT INTO projects (
        id, name, project_type, description, status, summary_status, owner_id, priority, start_date, target_date,
        completed_date, overall_progress, department, budget, actual_spend, risk_level,
        milestone, document_link, note, track_summaries_json, created_by, created_at, updated_at
      ) VALUES (
        ?, ?, '', '', 'active', '进行中', NULL, '中', NULL, NULL,
        NULL, 0, '', NULL, NULL, '中',
        '', '', '', ?, NULL, ?, ?
      )`,
    );

    for (const projectName of DEFAULT_PROJECTS) {
      const exists = db.prepare("SELECT id FROM projects WHERE name = ?").get(projectName);
      if (!exists) {
        insertProject.run(newId("project"), projectName, defaultTrackSummariesJson, timestamp, timestamp);
      }
    }
  }
}
