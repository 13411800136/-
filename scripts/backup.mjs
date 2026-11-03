#!/usr/bin/env node
/**
 * 备份数据库与附件到同一个时间点目录。
 * 用法：node scripts/backup.mjs [--out backups/自定义名称]
 * 说明：使用 SQLite VACUUM INTO 生成一致性数据库快照；附件按文件复制并记录 SHA-256。
 */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = resolve(ROOT, process.env.DATABASE_PATH ?? join('data', 'factory.db'));
const uploadDir = resolve(ROOT, process.env.UPLOAD_DIR ?? join('data', 'uploads'));
const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = outIndex >= 0 ? resolve(ROOT, args[outIndex + 1] ?? '') : join(ROOT, 'backups', `backup-${stamp}`);

if (!existsSync(dbPath)) {
  console.error(`数据库不存在：${dbPath}`);
  process.exit(1);
}
if (existsSync(outDir)) {
  console.error(`备份目标已存在，拒绝覆盖：${outDir}`);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
const snapshotPath = join(outDir, 'factory.db');

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA busy_timeout = 5000;');
db.exec(`VACUUM INTO '${snapshotPath.replace(/'/g, "''")}'`);
const migrations = db.prepare('SELECT version, checksum, applied_at FROM schema_migrations ORDER BY version').all();
const counts = {
  users: db.prepare('SELECT COUNT(*) AS c FROM users').get().c,
  orders: db.prepare('SELECT COUNT(*) AS c FROM orders').get().c,
  orderItems: db.prepare('SELECT COUNT(*) AS c FROM order_items').get().c,
  attachments: db.prepare('SELECT COUNT(*) AS c FROM attachments').get().c
};
db.close();

function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

const attachments = [];
if (existsSync(uploadDir)) {
  cpSync(uploadDir, join(outDir, 'uploads'), { recursive: true });
  for (const name of readdirSync(uploadDir)) {
    const file = join(uploadDir, name);
    if (statSync(file).isFile()) {
      attachments.push({
        name,
        size: statSync(file).size,
        sha256: sha256File(file)
      });
    }
  }
} else {
  mkdirSync(join(outDir, 'uploads'), { recursive: true });
}

const manifest = {
  format: 'factoryflow-backup-v1',
  createdAt: new Date().toISOString(),
  businessTimeZone: 'Asia/Shanghai',
  source: {
    database: relative(ROOT, dbPath),
    uploads: relative(ROOT, uploadDir)
  },
  database: {
    file: 'factory.db',
    size: statSync(snapshotPath).size,
    sha256: sha256File(snapshotPath)
  },
  migrations,
  counts,
  attachments
};
writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, outDir, manifest }, null, 2));

// 备份目录按保留策略人工清理；脚本不会自动删除历史备份。
