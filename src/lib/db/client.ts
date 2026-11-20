import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";

function resolveDbPath(): string {
  const p = process.env.DB_PATH || "./data/klear.sqlite";
  const dir = path.dirname(p);
  fs.mkdirSync(dir, { recursive: true });
  return p;
}

const globalForDb = globalThis as unknown as {
  __klearSqlite?: Database.Database;
  __klearDrizzle?: ReturnType<typeof drizzle>;
};

export function getSqlite(): Database.Database {
  if (!globalForDb.__klearSqlite) {
    globalForDb.__klearSqlite = new Database(resolveDbPath());
    globalForDb.__klearSqlite.pragma("journal_mode = WAL");
    globalForDb.__klearSqlite.pragma("foreign_keys = ON");
  }
  return globalForDb.__klearSqlite;
}

export function getDb() {
  if (!globalForDb.__klearDrizzle) {
    globalForDb.__klearDrizzle = drizzle(getSqlite(), { schema });
  }
  return globalForDb.__klearDrizzle;
}

export { schema };
