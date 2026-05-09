import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import mysql from "mysql2/promise";

const SOURCE_SQLITE_PATH = process.argv[2] || process.env.SOURCE_SQLITE_PATH;

if (!SOURCE_SQLITE_PATH) {
  console.error("Missing source sqlite path. Usage: npm run migrate:sqlite-to-mysql -- ./data/team-progress.sqlite");
  process.exit(1);
}

if (!existsSync(SOURCE_SQLITE_PATH)) {
  console.error(`Source sqlite file not found: ${SOURCE_SQLITE_PATH}`);
  process.exit(1);
}

function getMysqlConfig() {
  const url =
    process.env.TEAM_PROGRESS_DATABASE_URL ??
    process.env.DATABASE_URL ??
    process.env.MYSQL_URL ??
    "";

  if (url) {
    const parsed = new URL(url);
    const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
    if (!database) throw new Error("mysql_database_missing");

    return {
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 3306,
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database,
    };
  }

  if (!process.env.MYSQL_HOST || !process.env.MYSQL_DATABASE) {
    throw new Error("mysql_config_missing");
  }

  return {
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT ?? "3306"),
    user: process.env.MYSQL_USER ?? "root",
    password: process.env.MYSQL_PASSWORD ?? "",
    database: process.env.MYSQL_DATABASE,
  };
}

const TABLES = [
  "users",
  "projects",
  "requirements",
  "progress_updates",
  "audit_logs",
  "import_batches",
  "sessions",
];

const CLEAR_ORDER = [...TABLES].reverse();

function quoteId(name) {
  return `\`${String(name).replace(/`/g, "``")}\``;
}

function chunk(array, size) {
  const output = [];
  for (let index = 0; index < array.length; index += size) {
    output.push(array.slice(index, index + size));
  }
  return output;
}

async function ensureTargetSchema(pool) {
  try {
    await pool.query("SELECT 1 FROM users LIMIT 1");
  } catch (error) {
    console.error("Target MySQL schema is missing.");
    console.error("Start the app once with MySQL env vars so it creates the tables, then rerun this migration.");
    throw error;
  }
}

async function migrateTable(pool, sqlite, table) {
  const rows = sqlite.prepare(`SELECT * FROM ${quoteId(table)}`).all();
  if (rows.length === 0) {
    console.log(`${table}: 0 rows`);
    return;
  }

  const columns = Object.keys(rows[0]);
  const columnSql = columns.map((column) => quoteId(column)).join(", ");
  const rowPlaceholder = `(${columns.map(() => "?").join(", ")})`;

  for (const batch of chunk(rows, 200)) {
    const values = [];
    for (const row of batch) {
      for (const column of columns) {
        values.push(row[column] ?? null);
      }
    }
    const valuesSql = batch.map(() => rowPlaceholder).join(", ");
    await pool.query(`INSERT INTO ${quoteId(table)} (${columnSql}) VALUES ${valuesSql}`, values);
  }

  console.log(`${table}: ${rows.length} rows`);
}

async function main() {
  const sqlite = new Database(SOURCE_SQLITE_PATH, { readonly: true });
  const pool = mysql.createPool({
    ...getMysqlConfig(),
    waitForConnections: true,
    connectionLimit: Number(process.env.TEAM_PROGRESS_DB_POOL_SIZE ?? "10"),
    decimalNumbers: true,
    charset: "utf8mb4",
  });

  try {
    await ensureTargetSchema(pool);
    await pool.query("SET FOREIGN_KEY_CHECKS = 0");

    for (const table of CLEAR_ORDER) {
      await pool.query(`DELETE FROM ${quoteId(table)}`);
    }

    for (const table of TABLES) {
      await migrateTable(pool, sqlite, table);
    }
  } finally {
    try {
      await pool.query("SET FOREIGN_KEY_CHECKS = 1");
    } catch {
      // ignore
    }
    await pool.end();
    sqlite.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
