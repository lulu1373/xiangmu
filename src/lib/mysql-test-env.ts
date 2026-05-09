import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

const MYSQL_TEST_ENV_KEYS = [
  "TEAM_PROGRESS_TEST_DATABASE_URL",
  "TEAM_PROGRESS_DATABASE_URL",
  "DATABASE_URL",
  "MYSQL_URL",
] as const;

function getBaseMysqlTestUrl() {
  for (const key of MYSQL_TEST_ENV_KEYS) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return "";
}

function escapeMysqlIdentifier(value: string) {
  return `\`${value.replace(/`/g, "``")}\``;
}

function createDatabaseName(prefix: string) {
  const suffix = randomUUID().replace(/-/g, "").slice(0, 20);
  return `${prefix}_${suffix}`.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 48);
}

function createAdminPool(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  return mysql.createPool({
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    waitForConnections: true,
    connectionLimit: 1,
    charset: "utf8mb4",
  });
}

export function hasMysqlTestDatabaseConfig() {
  return Boolean(getBaseMysqlTestUrl());
}

export function createMysqlTestDatabaseUrl(prefix: string) {
  const baseUrl = getBaseMysqlTestUrl();
  if (!baseUrl) {
    throw new Error("mysql_test_config_missing");
  }

  const database = createDatabaseName(prefix);
  const parsed = new URL(baseUrl);
  parsed.pathname = `/${database}`;
  parsed.search = "";
  parsed.hash = "";

  return { database, databaseUrl: parsed.toString() };
}

export async function dropMysqlTestDatabase(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  const pool = createAdminPool(databaseUrl);

  try {
    await pool.query(`DROP DATABASE IF EXISTS ${escapeMysqlIdentifier(database)}`);
  } finally {
    await pool.end();
  }
}
