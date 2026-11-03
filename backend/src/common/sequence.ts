import { businessDate } from './time.js';
import type { AppDatabase } from '../db/database.js';

/** 基于计数器的并发安全编号；必须在事务内调用。 */
export function nextSequence(db: AppDatabase, name: string): number {
  const row = db.get<{ value: number }>(
    `INSERT INTO counters(name, value) VALUES (?, 1)
     ON CONFLICT(name) DO UPDATE SET value = value + 1
     RETURNING value`,
    name
  );
  if (!row) throw new Error('编号计数器未返回结果');
  return row.value;
}

export function documentNo(db: AppDatabase, prefix: string, date = businessDate()): string {
  const sequence = nextSequence(db, `${prefix.toLowerCase()}_no:${date}`);
  return `${prefix}-${date.replace(/-/g, '')}-${String(sequence).padStart(4, '0')}`;
}
