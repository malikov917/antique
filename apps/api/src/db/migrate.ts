import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { loadConfig } from "../config.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const dbPath = resolve(config.dbPath);
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = resolve(moduleDir, "..", "..", "drizzle");
  mkdirSync(dirname(dbPath), { recursive: true });

  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder });

  sqlite.close();
  console.log("[db:migrate] applied migrations");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
