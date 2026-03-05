import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as authSchema from "../auth/schema.js";

export type ApiDatabase = BetterSQLite3Database<typeof authSchema>;

export interface DatabaseClient {
  sqlite: Database.Database;
  db: ApiDatabase;
  close: () => void;
}

export function createDatabaseClient(databasePath: string): DatabaseClient {
  const resolvedPath = databasePath === ":memory:" ? ":memory:" : resolve(databasePath);
  if (resolvedPath !== ":memory:") {
    mkdirSync(dirname(resolvedPath), { recursive: true });
  }

  const sqlite = new Database(resolvedPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite, { schema: authSchema });

  return {
    sqlite,
    db,
    close: () => sqlite.close()
  };
}
