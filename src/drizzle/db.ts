import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import path from 'path';
import fs from 'fs';

type SchemaType = typeof schema;
type DrizzleDB = ReturnType<typeof drizzle<SchemaType>>;

let localSqliteDb: Database.Database | null = null;
let drizzleDb: DrizzleDB | null = null;

export function getDatabase(dbPath?: string): DrizzleDB {
  if (!drizzleDb || dbPath) {
    const defaultPath = path.resolve(process.cwd(), '.local-d1.sqlite');
    const targetPath = dbPath || defaultPath;
    
    // 确保数据目录存在
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (!localSqliteDb || dbPath) {
      const dbInstance = new Database(targetPath);
      // 开启 SQLite WAL 模式与外键约束
      dbInstance.pragma('journal_mode = WAL');
      dbInstance.pragma('foreign_keys = ON');

      // 防止 Node 24 GC 触发 better-sqlite3 Statement 析构断言异常
      const statementCache = new Map<string, any>();
      const origPrepare = dbInstance.prepare.bind(dbInstance);
      (dbInstance as any).prepare = function (sql: string) {
        let stmt = statementCache.get(sql);
        if (!stmt) {
          stmt = origPrepare(sql);
          statementCache.set(sql, stmt);
        }
        return stmt;
      };

      localSqliteDb = dbInstance;
    }

    const instance = drizzle(localSqliteDb, { schema });
    if (!dbPath) {
      drizzleDb = instance;
    }
    return instance;
  }

  return drizzleDb;
}

export type AppDatabase = ReturnType<typeof getDatabase>;
