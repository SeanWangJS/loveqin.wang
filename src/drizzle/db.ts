import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import path from 'path';
import fs from 'fs';

let localSqliteDb: Database.Database | null = null;

export function getDatabase(dbPath?: string) {
  if (!localSqliteDb) {
    const defaultPath = path.resolve(process.cwd(), '.local-d1.sqlite');
    const targetPath = dbPath || defaultPath;
    
    // 确保数据目录存在
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    localSqliteDb = new Database(targetPath);
    // 开启 SQLite WAL 模式与外键约束
    localSqliteDb.pragma('journal_mode = WAL');
    localSqliteDb.pragma('foreign_keys = ON');
  }

  return drizzle(localSqliteDb, { schema });
}

export type AppDatabase = ReturnType<typeof getDatabase>;
