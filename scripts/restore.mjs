#!/usr/bin/env node
/**
 * 将备份恢复到新的隔离目录，不覆盖现有运行库。
 * 用法：node scripts/restore.mjs --backup backups/backup-xxx --to backups/restore-check
 * 校验：manifest、数据库 integrity_check、订单/附件数量、附件 SHA-256。
 */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const backupIndex = args.indexOf('--backup');
const toIndex = args.indexOf('--to');
if (backupIndex < 0 || toIndex < 0) {
  console.error('用法：node scripts/restore.mjs --backup <备份目录> --to <新隔离目录>');
  process.exit(1);
}
const backupDir = resolve(ROOT, args[backupIndex + 1] ?? '');
const targetDir = resolve(ROOT, args[toIndex + 1] ?? '');
if (!existsSync(backupDir)) {
  console.error(`备份目录不存在：${backupDir}`);
  process.exit(1);
}
const manifestPath = join(backupDir, 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error('备份缺少 manifest.json');
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.format !== 'factoryflow-backup-v1') {
  console.error(`不支持的备份格式：${manifest.format}`);
  process.exit(1);
}
if (existsSync(targetDir) && readdirSync(targetDir).length > 0) {
  console.error(`目标目录非空，拒绝覆盖：${targetDir}`);
  process.exit(1);
}
mkdirSync(targetDir, { recursive: true });

const sourceDb = join(backupDir, 'factory.db');
const targetDb = join(targetDir, 'factory.db');
if (!existsSync(sourceDb)) {
  console.error('备份缺少 factory.db');
  process.exit(1);
}
const expectedHash = createHash('sha256').update(readFileSync(sourceDb)).digest('hex');
if (expectedHash !== manifest.database.sha256) {
  console.error('数据库快照 SHA-256 与 manifest 不一致，拒绝恢复');
  process.exit(1);
}
cpSync(sourceDb, targetDb);
if (existsSync(join(backupDir, 'uploads'))) {
  cpSync(join(backupDir, 'uploads'), join(targetDir, 'uploads'), { recursive: true });
} else {
  mkdirSync(join(targetDir, 'uploads'), { recursive: true });
}

const db = new DatabaseSync(targetDb, { readOnly: true });
const integrity = db.prepare('PRAGMA integrity_check').get();
if (integrity.integrity_check !== 'ok') {
  console.error(`数据库完整性检查失败：${integrity.integrity_check}`);
  process.exit(1);
}
const counts = {
  users: db.prepare('SELECT COUNT(*) AS c FROM users').get().c,
  orders: db.prepare('SELECT COUNT(*) AS c FROM orders').get().c,
  orderItems: db.prepare('SELECT COUNT(*) AS c FROM order_items').get().c,
  attachments: db.prepare('SELECT COUNT(*) AS c FROM attachments').get().c
};
const migrations = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
db.close();

for (const item of manifest.attachments) {
  const file = join(targetDir, 'uploads', item.name);
  if (!existsSync(file)) {
    console.error(`附件缺失：${item.name}`);
    process.exit(1);
  }
  const hash = createHash('sha256').update(readFileSync(file)).digest('hex');
  if (hash !== item.sha256 || statSync(file).size !== item.size) {
    console.error(`附件校验失败：${item.name}`);
    process.exit(1);
  }
}
if (counts.orders !== manifest.counts.orders || counts.attachments !== manifest.counts.attachments) {
  console.error(`数量不一致：恢复 ${JSON.stringify(counts)}，manifest ${JSON.stringify(manifest.counts)}`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      targetDir,
      database: targetDb,
      uploads: join(targetDir, 'uploads'),
      integrity: 'ok',
      counts,
      migrations: migrations.map((row) => row.version),
      attachmentsVerified: manifest.attachments.length
    },
    null,
    2
  )
);
