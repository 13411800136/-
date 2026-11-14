import { newId } from '../../common/crypto.js';
import { errors } from '../../common/errors.js';
import { nowIso } from '../../common/time.js';
import type { AppDatabase } from '../../db/database.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomSuffix(length: number): string {
  const bytes = newId().replace(/-/g, '').toUpperCase();
  let out = '';
  for (let index = 0; index < length; index += 1) {
    out += ALPHABET[Number.parseInt(bytes.slice(index * 2, index * 2 + 2), 16) % ALPHABET.length];
  }
  return out;
}

function uniqueCode(db: AppDatabase, table: string, prefix: string): string {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const code = `${prefix}-${randomSuffix(6)}`;
    const existing = db.get<{ id: string }>(`SELECT id FROM ${table} WHERE code = ?`, code);
    if (!existing) return code;
  }
  return `${prefix}-${randomSuffix(10)}`;
}

/**
 * 建单/采购时现场新建基础数据。
 * 只填名称，编码自动生成；与调用方处于同一事务，失败一起回滚。
 */
export function ensureCustomer(
  db: AppDatabase,
  name: string
): { id: string; name: string; active: number; created: boolean } {
  const trimmed = name.trim();
  const existing = db.get<{ id: string; name: string; active: number }>(
    'SELECT id, name, active FROM customers WHERE name = ? COLLATE NOCASE ORDER BY active DESC, created_at LIMIT 1',
    trimmed
  );
  if (existing) {
    if (existing.active !== 1) {
      throw errors.validation('该客户已停用，请先在基础数据中启用或换一个名称', [
        { path: 'customerName', message: '客户已停用' }
      ]);
    }
    return { id: existing.id, name: existing.name, active: 1, created: false };
  }
  const id = newId();
  const now = nowIso();
  db.run(
    `INSERT INTO customers(id, code, name, contact, tax_no, address, active, created_at, updated_at)
     VALUES (?, ?, ?, '', '', '', 1, ?, ?)`,
    id,
    uniqueCode(db, 'customers', 'CUS'),
    trimmed,
    now,
    now
  );
  return { id, name: trimmed, active: 1, created: true };
}

export function ensureSupplier(
  db: AppDatabase,
  name: string
): { id: string; name: string; active: number; created: boolean } {
  const trimmed = name.trim();
  const existing = db.get<{ id: string; name: string; active: number }>(
    'SELECT id, name, active FROM suppliers WHERE name = ? COLLATE NOCASE ORDER BY active DESC, created_at LIMIT 1',
    trimmed
  );
  if (existing) {
    if (existing.active !== 1) {
      throw errors.validation('该供应商已停用，请先在基础数据中启用或换一个名称', [
        { path: 'supplierName', message: '供应商已停用' }
      ]);
    }
    return { id: existing.id, name: existing.name, active: 1, created: false };
  }
  const id = newId();
  const now = nowIso();
  db.run(
    `INSERT INTO suppliers(id, code, name, contact, active, created_at, updated_at)
     VALUES (?, ?, ?, '', 1, ?, ?)`,
    id,
    uniqueCode(db, 'suppliers', 'SUP'),
    trimmed,
    now,
    now
  );
  return { id, name: trimmed, active: 1, created: true };
}

export function ensurePart(
  db: AppDatabase,
  name: string,
  spec = ''
): { id: string; name: string; spec: string; active: number; created: boolean } {
  const trimmed = name.trim();
  const trimmedSpec = spec.trim();
  const existing = db.get<{ id: string; name: string; spec: string; active: number }>(
    `SELECT id, name, spec, active FROM parts
     WHERE name = ? COLLATE NOCASE AND spec = ? COLLATE NOCASE
     ORDER BY active DESC, created_at LIMIT 1`,
    trimmed,
    trimmedSpec
  );
  if (existing) {
    if (existing.active !== 1) {
      throw errors.validation('该配件已停用，请先在基础数据中启用或换一个名称', [
        { path: 'partName', message: '配件已停用' }
      ]);
    }
    return { id: existing.id, name: existing.name, spec: existing.spec, active: 1, created: false };
  }
  const id = newId();
  const now = nowIso();
  db.run(
    `INSERT INTO parts(id, code, name, spec, unit, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, '件', 1, ?, ?)`,
    id,
    uniqueCode(db, 'parts', 'PART'),
    trimmed,
    trimmedSpec,
    now,
    now
  );
  return { id, name: trimmed, spec: trimmedSpec, active: 1, created: true };
}