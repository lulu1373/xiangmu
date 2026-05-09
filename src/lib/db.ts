import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import mysql, { type Pool, type PoolConnection, type ResultSetHeader } from "mysql2/promise";
import { DEFAULT_PROJECTS, PROJECT_TRACKS } from "@/lib/constants";
import { newId, nowIso } from "@/lib/ids";

export type DbMode = "sqlite" | "mysql";

export type DbRunResult = {
  affectedRows: number;
  insertId?: number | null;
};

export type DbExecutor = {
  all<T>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T>(sql: string, params?: unknown[]): Promise<T | null>;
  run(sql: string, params?: unknown[]): Promise<DbRunResult>;
};

type DbDriver = {
  mode: DbMode;
  key: string;
  executor: DbExecutor;
  withTransaction<T>(fn: (executor: DbExecutor) => Promise<T>): Promise<T>;
  migrate(): Promise<void>;
  close(): Promise<void>;
};

let cachedDriver: DbDriver | null = null;
let cachedDriverKey = "";
let initializedKey = "";
let initPromise: Promise<void> | null = null;

function defaultTrackSummariesJson() {
  return JSON.stringify(
    Object.fromEntries(
      PROJECT_TRACKS.map((track) => [track, { progress: 0, summary: "", completed: "", pending: "" }]),
    ),
  );
}

function quoteSqlString(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function escapeMysqlIdentifier(value: string) {
  if (!/^[A-Za-z0-9_$-]+$/.test(value)) {
    throw new Error("invalid_mysql_database_name");
  }
  return `\`${value.replace(/`/g, "``")}\``;
}

function createSqliteExecutor(db: Database.Database): DbExecutor {
  return {
    async all<T>(sql: string, params: unknown[] = []) {
      return db.prepare(sql).all(...params) as T[];
    },
    async one<T>(sql: string, params: unknown[] = []) {
      return (db.prepare(sql).get(...params) as T | undefined) ?? null;
    },
    async run(sql: string, params: unknown[] = []) {
      const result = db.prepare(sql).run(...params);
      return {
        affectedRows: result.changes,
        insertId: Number(result.lastInsertRowid || 0) || null,
      };
    },
  };
}

function getDatabaseMode(): DbMode {
  const explicit = process.env.TEAM_PROGRESS_DB_CLIENT?.trim().toLowerCase();
  if (explicit === "mysql") return "mysql";
  if (explicit === "sqlite") return "sqlite";
  if (process.env.TEAM_PROGRESS_DATABASE_URL || process.env.MYSQL_HOST) return "mysql";
  return "sqlite";
}

export function getDatabasePath() {
  return process.env.TEAM_PROGRESS_DB_PATH ?? path.join(process.cwd(), "data", "team-progress.sqlite");
}

function getMysqlDatabaseUrl() {
  return (
    process.env.TEAM_PROGRESS_DATABASE_URL ??
    process.env.DATABASE_URL ??
    process.env.MYSQL_URL ??
    ""
  ).trim();
}

function getDriverKey() {
  if (getDatabaseMode() === "mysql") {
    return `mysql:${getMysqlDatabaseUrl() || process.env.MYSQL_HOST || ""}`;
  }
  return `sqlite:${getDatabasePath()}`;
}

function migrateSqlite(db: Database.Database) {
  const trackSummariesJson = defaultTrackSummariesJson();
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
      track_summaries_json TEXT NOT NULL DEFAULT ${quoteSqlString(trackSummariesJson)},
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

  const requirementColumns = db.prepare("PRAGMA table_info(requirements)").all() as Array<{ name: string }>;
  if (!requirementColumns.some((column) => column.name === "book_name")) {
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
      `ALTER TABLE projects ADD COLUMN track_summaries_json TEXT NOT NULL DEFAULT ${quoteSqlString(trackSummariesJson)}`,
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
  ).run(trackSummariesJson);

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
        insertProject.run(newId("project"), projectName, trackSummariesJson, timestamp, timestamp);
      }
    }
  }
}

async function createMysqlPoolFromUrl(url: string) {
  const parsed = new URL(url);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!database) throw new Error("mysql_database_missing");

  const baseOptions = {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    waitForConnections: true,
    connectionLimit: Number(process.env.TEAM_PROGRESS_DB_POOL_SIZE ?? "10"),
    decimalNumbers: true,
    charset: "utf8mb4",
  };

  const bootstrapPool = mysql.createPool(baseOptions);
  try {
    await bootstrapPool.query(
      `CREATE DATABASE IF NOT EXISTS ${escapeMysqlIdentifier(database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
  } finally {
    await bootstrapPool.end();
  }

  return mysql.createPool({
    ...baseOptions,
    database,
  });
}

async function createMysqlPoolFromEnv() {
  const host = process.env.MYSQL_HOST?.trim();
  const database = process.env.MYSQL_DATABASE?.trim();
  if (!host || !database) throw new Error("mysql_config_missing");

  const baseOptions = {
    host,
    port: Number(process.env.MYSQL_PORT ?? "3306"),
    user: process.env.MYSQL_USER?.trim() || "root",
    password: process.env.MYSQL_PASSWORD ?? "",
    waitForConnections: true,
    connectionLimit: Number(process.env.TEAM_PROGRESS_DB_POOL_SIZE ?? "10"),
    decimalNumbers: true,
    charset: "utf8mb4",
  };

  const bootstrapPool = mysql.createPool(baseOptions);
  try {
    await bootstrapPool.query(
      `CREATE DATABASE IF NOT EXISTS ${escapeMysqlIdentifier(database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
  } finally {
    await bootstrapPool.end();
  }

  return mysql.createPool({
    ...baseOptions,
    database,
  });
}

function createMysqlExecutor(connection: Pool | PoolConnection): DbExecutor {
  return {
    async all<T>(sql: string, params: unknown[] = []) {
      const [rows] = await connection.query(sql, params as never[]);
      return rows as T[];
    },
    async one<T>(sql: string, params: unknown[] = []) {
      const [rows] = await connection.query(sql, params as never[]);
      return ((rows as T[])[0] ?? null) as T | null;
    },
    async run(sql: string, params: unknown[] = []) {
      const [result] = await connection.execute(sql, params as never[]);
      const header = result as ResultSetHeader;
      return {
        affectedRows: header.affectedRows ?? 0,
        insertId: header.insertId ?? null,
      };
    },
  };
}

async function migrateMysqlPool(pool: Pool) {
  const executor = createMysqlExecutor(pool);
  const trackSummariesJson = defaultTrackSummariesJson();
  const tableStatements = [
    `
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(64) PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        email VARCHAR(190) NOT NULL UNIQUE,
        login_code VARCHAR(32) NOT NULL UNIQUE,
        role VARCHAR(16) NOT NULL,
        permission VARCHAR(16) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at VARCHAR(40) NOT NULL,
        updated_at VARCHAR(40) NOT NULL,
        INDEX idx_users_permission_role_name (permission, role, name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `,
    `
      CREATE TABLE IF NOT EXISTS projects (
        id VARCHAR(64) PRIMARY KEY,
        name VARCHAR(190) NOT NULL UNIQUE,
        project_type VARCHAR(64) NOT NULL DEFAULT '',
        description LONGTEXT NOT NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'active',
        summary_status VARCHAR(32) NOT NULL DEFAULT '进行中',
        owner_id VARCHAR(64) NULL,
        priority VARCHAR(16) NOT NULL DEFAULT '中',
        start_date VARCHAR(10) NULL,
        target_date VARCHAR(10) NULL,
        completed_date VARCHAR(10) NULL,
        overall_progress INT NOT NULL DEFAULT 0,
        department VARCHAR(120) NOT NULL DEFAULT '',
        budget DECIMAL(12,2) NULL,
        actual_spend DECIMAL(12,2) NULL,
        risk_level VARCHAR(16) NOT NULL DEFAULT '中',
        milestone LONGTEXT NOT NULL,
        document_link LONGTEXT NOT NULL,
        note LONGTEXT NOT NULL,
        track_summaries_json LONGTEXT NOT NULL,
        created_by VARCHAR(64) NULL,
        created_at VARCHAR(40) NOT NULL,
        updated_at VARCHAR(40) NOT NULL,
        INDEX idx_projects_owner (owner_id),
        INDEX idx_projects_updated_at (updated_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `,
    `
      CREATE TABLE IF NOT EXISTS requirements (
        id VARCHAR(64) PRIMARY KEY,
        project_id VARCHAR(64) NOT NULL,
        code VARCHAR(64) NOT NULL,
        title VARCHAR(255) NOT NULL,
        book_name VARCHAR(120) NOT NULL DEFAULT '',
        type VARCHAR(32) NOT NULL,
        background LONGTEXT NOT NULL,
        source LONGTEXT NOT NULL,
        acceptance_criteria LONGTEXT NOT NULL,
        version VARCHAR(64) NOT NULL DEFAULT '',
        owner_id VARCHAR(64) NOT NULL,
        participant_roles_json LONGTEXT NOT NULL,
        priority VARCHAR(16) NOT NULL,
        status VARCHAR(16) NOT NULL,
        start_date VARCHAR(10) NULL,
        due_date VARCHAR(10) NULL,
        estimated_hours DECIMAL(10,2) NULL,
        actual_hours DECIMAL(10,2) NULL,
        latest_progress LONGTEXT NOT NULL,
        next_step LONGTEXT NOT NULL,
        blocker LONGTEXT NOT NULL,
        created_by VARCHAR(64) NOT NULL,
        updated_by VARCHAR(64) NOT NULL,
        created_at VARCHAR(40) NOT NULL,
        updated_at VARCHAR(40) NOT NULL,
        UNIQUE KEY idx_requirements_project_code (project_id, code),
        INDEX idx_requirements_project_status (project_id, status),
        INDEX idx_requirements_owner (owner_id),
        INDEX idx_requirements_book (book_name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `,
    `
      CREATE TABLE IF NOT EXISTS progress_updates (
        id VARCHAR(64) PRIMARY KEY,
        requirement_id VARCHAR(64) NOT NULL,
        user_id VARCHAR(64) NOT NULL,
        progress LONGTEXT NOT NULL,
        next_step LONGTEXT NOT NULL,
        blocker LONGTEXT NOT NULL,
        previous_status VARCHAR(16) NOT NULL,
        new_status VARCHAR(16) NOT NULL,
        created_at VARCHAR(40) NOT NULL,
        INDEX idx_progress_requirement_created_at (requirement_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `,
    `
      CREATE TABLE IF NOT EXISTS sessions (
        id VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(64) NOT NULL,
        token_hash VARCHAR(64) NOT NULL UNIQUE,
        expires_at VARCHAR(40) NOT NULL,
        created_at VARCHAR(40) NOT NULL,
        INDEX idx_sessions_token (token_hash),
        INDEX idx_sessions_user (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `,
    `
      CREATE TABLE IF NOT EXISTS audit_logs (
        id VARCHAR(64) PRIMARY KEY,
        actor_id VARCHAR(64) NULL,
        action VARCHAR(64) NOT NULL,
        entity_type VARCHAR(32) NOT NULL,
        entity_id VARCHAR(64) NOT NULL,
        details LONGTEXT NOT NULL,
        created_at VARCHAR(40) NOT NULL,
        INDEX idx_audit_entity_created_at (entity_type, entity_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `,
    `
      CREATE TABLE IF NOT EXISTS import_batches (
        id VARCHAR(64) PRIMARY KEY,
        project_id VARCHAR(64) NOT NULL,
        user_id VARCHAR(64) NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        file_type VARCHAR(64) NOT NULL,
        row_count INT NOT NULL,
        created_count INT NOT NULL,
        updated_count INT NOT NULL,
        error_count INT NOT NULL,
        errors_json LONGTEXT NOT NULL,
        created_at VARCHAR(40) NOT NULL,
        INDEX idx_import_batches_project (project_id),
        INDEX idx_import_batches_user (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `,
  ];

  for (const statement of tableStatements) {
    await executor.run(statement);
  }

  await executor.run(
    `UPDATE projects
     SET track_summaries_json = ?
     WHERE track_summaries_json IS NULL OR TRIM(track_summaries_json) = ''`,
    [trackSummariesJson],
  );

  await executor.run(
    `UPDATE users
     SET login_code = UPPER(SUBSTRING(REPLACE(id, 'user_', ''), 1, 6))
     WHERE login_code = ''`,
  );

  const countRow = await executor.one<{ count: number }>("SELECT COUNT(*) AS count FROM users");
  if ((countRow?.count ?? 0) > 0) {
    const timestamp = nowIso();
    for (const projectName of DEFAULT_PROJECTS) {
      const exists = await executor.one<{ id: string }>("SELECT id FROM projects WHERE name = ?", [projectName]);
      if (!exists) {
        await executor.run(
          `INSERT INTO projects (
            id, name, project_type, description, status, summary_status, owner_id, priority, start_date, target_date,
            completed_date, overall_progress, department, budget, actual_spend, risk_level,
            milestone, document_link, note, track_summaries_json, created_by, created_at, updated_at
          ) VALUES (?, ?, '', '', 'active', '进行中', NULL, '中', NULL, NULL, NULL, 0, '', NULL, NULL, '中', '', '', '', ?, NULL, ?, ?)`,
          [newId("project"), projectName, trackSummariesJson, timestamp, timestamp],
        );
      }
    }
  }
}

function createSqliteDriver() {
  const dbPath = getDatabasePath();
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const executor = createSqliteExecutor(db);

  const driver: DbDriver = {
    mode: "sqlite",
    key: `sqlite:${dbPath}`,
    executor,
    async withTransaction<T>(fn: (tx: DbExecutor) => Promise<T>) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = await fn(executor);
        db.exec("COMMIT");
        return result;
      } catch (error) {
        try {
          db.exec("ROLLBACK");
        } catch {
          // ignore rollback failures
        }
        throw error;
      }
    },
    async migrate() {
      migrateSqlite(db);
    },
    async close() {
      db.close();
    },
  };

  return driver;
}

async function createMysqlDriver() {
  const url = getMysqlDatabaseUrl();
  const pool = url ? await createMysqlPoolFromUrl(url) : await createMysqlPoolFromEnv();
  const executor = createMysqlExecutor(pool);

  const driver: DbDriver = {
    mode: "mysql",
    key: getDriverKey(),
    executor,
    async withTransaction<T>(fn: (tx: DbExecutor) => Promise<T>) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const tx = createMysqlExecutor(connection);
        const result = await fn(tx);
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    },
    async migrate() {
      await migrateMysqlPool(pool);
    },
    async close() {
      await pool.end();
    },
  };

  return driver;
}

async function getDriver() {
  const nextKey = getDriverKey();
  if (cachedDriver && cachedDriverKey === nextKey) return cachedDriver;

  if (cachedDriver) {
    await cachedDriver.close();
  }

  cachedDriver = getDatabaseMode() === "mysql" ? await createMysqlDriver() : createSqliteDriver();
  cachedDriverKey = nextKey;
  initializedKey = "";
  initPromise = null;
  return cachedDriver;
}

async function ensureInitialized() {
  const driver = await getDriver();
  if (initializedKey === driver.key) return;
  if (!initPromise) {
    initPromise = (async () => {
      await driver.migrate();
      initializedKey = driver.key;
    })();
  }
  await initPromise;
}

export async function getDbExecutor() {
  await ensureInitialized();
  return (await getDriver()).executor;
}

export async function withTransaction<T>(fn: (executor: DbExecutor) => Promise<T>) {
  await ensureInitialized();
  return (await getDriver()).withTransaction(fn);
}

export async function closeDbForTests() {
  initPromise = null;
  initializedKey = "";
  cachedDriverKey = "";
  const current = cachedDriver;
  cachedDriver = null;
  if (current) {
    await current.close();
  }
}

export async function migrate() {
  await ensureInitialized();
}
