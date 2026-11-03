import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppDatabase } from './database.js';
import { loadConfig } from '../config.js';

const BACKEND_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MIGRATIONS_DIR = resolve(BACKEND_ROOT, 'migrations');

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export function migrate(db: AppDatabase, migrationsDir = MIGRATIONS_DIR): MigrationResult {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);
  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  const appliedRows = db.all<{ version: string; checksum: string }>(
    'SELECT version, checksum FROM schema_migrations'
  );
  const appliedMap = new Map(appliedRows.map((row) => [row.version, row.checksum]));
  const applied: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    const sql = readFileSync(resolve(migrationsDir, file), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const existing = appliedMap.get(file);
    if (existing) {
      if (existing !== checksum) {
        throw new Error(`迁移 ${file} 已应用但内容被修改；请新增迁移而不是改写历史迁移`);
      }
      skipped.push(file);
      continue;
    }
    db.tx(() => {
      db.exec(sql);
      db.run(
        'INSERT INTO schema_migrations(version, checksum, applied_at) VALUES (?, ?, ?)',
        file,
        checksum,
        new Date().toISOString()
      );
    });
    applied.push(file);
  }
  return { applied, skipped };
}

export function assertSchemaReady(db: AppDatabase): void {
  const table = db.get<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'"
  );
  if (!table) {
    throw new Error('数据库尚未初始化。请先运行 `npm run migrate`，再运行 `npm run seed -- --yes`。');
  }
  const count = db.get<{ count: number }>('SELECT COUNT(*) AS count FROM schema_migrations');
  if (!count || count.count === 0) {
    throw new Error('数据库没有已应用的迁移。请运行 `npm run migrate`。');
  }
}

function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  return resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  const config = loadConfig();
  if (!existsSync(config.databasePath)) {
    console.log(`将创建数据库：${config.databasePath}`);
  }
  const db = new AppDatabase(config.databasePath);
  try {
    const result = migrate(db);
    if (result.applied.length === 0) {
      console.log(`数据库已是最新（${result.skipped.length} 个迁移已应用）。`);
    } else {
      console.log(`已应用 ${result.applied.length} 个迁移：${result.applied.join(', ')}`);
    }
    console.log(`数据库位置：${config.databasePath}`);
  } finally {
    db.close();
  }
}
