import { DatabaseSync } from 'node:sqlite';

export type SqlParam = string | number | null | Uint8Array;

function isBusy(error: unknown): boolean {
  return error instanceof Error && /SQLITE_BUSY|database is locked/i.test(error.message);
}

function sleepSync(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

/**
 * node:sqlite 的轻量封装：统一 PRAGMA、事务与类型化查询。
 * 写事务使用 BEGIN IMMEDIATE，确保读-改-写期间持有写锁，避免丢更新。
 */
export class AppDatabase {
  readonly raw: DatabaseSync;
  private depth = 0;

  constructor(filename: string) {
    this.raw = new DatabaseSync(filename);
    this.raw.exec('PRAGMA foreign_keys = ON;');
    this.raw.exec('PRAGMA busy_timeout = 5000;');
    if (filename !== ':memory:') {
      this.raw.exec('PRAGMA journal_mode = WAL;');
      this.raw.exec('PRAGMA synchronous = NORMAL;');
    }
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  get<T>(sql: string, ...params: SqlParam[]): T | undefined {
    return this.raw.prepare(sql).get(...params) as T | undefined;
  }

  all<T>(sql: string, ...params: SqlParam[]): T[] {
    return this.raw.prepare(sql).all(...params) as T[];
  }

  run(sql: string, ...params: SqlParam[]): { changes: number | bigint; lastInsertRowid: number | bigint } {
    return this.raw.prepare(sql).run(...params);
  }

  tx<T>(work: () => T): T {
    if (this.depth > 0) return work();
    let started = false;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        this.raw.exec('BEGIN IMMEDIATE;');
        started = true;
        break;
      } catch (error) {
        if (!isBusy(error) || attempt === 4) throw error;
        sleepSync(40 * (attempt + 1));
      }
    }
    if (!started) throw new Error('无法开始数据库事务');
    this.depth += 1;
    try {
      const result = work();
      this.raw.exec('COMMIT;');
      return result;
    } catch (error) {
      try {
        this.raw.exec('ROLLBACK;');
      } catch {
        // 回滚失败时保留原始错误，交给上层记录。
      }
      throw error;
    } finally {
      this.depth -= 1;
    }
  }

  close(): void {
    this.raw.close();
  }
}
