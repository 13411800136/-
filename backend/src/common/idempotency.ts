import type { FastifyRequest } from 'fastify';
import { newId, requestHash } from './crypto.js';
import { errors } from './errors.js';
import { nowIso } from './time.js';
import type { AppDatabase } from '../db/database.js';

const KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;
const DEFAULT_TTL_HOURS = 72;

export function requireIdempotencyKey(request: FastifyRequest): string {
  const raw = request.headers['idempotency-key'];
  const key = Array.isArray(raw) ? raw[0] : raw;
  if (!key) {
    throw errors.validation('缺少 Idempotency-Key 请求头', [
      { path: 'header.Idempotency-Key', message: '同一业务意图必须使用稳定随机键' }
    ]);
  }
  if (!KEY_RE.test(key)) {
    throw errors.validation('Idempotency-Key 格式不合法', [
      { path: 'header.Idempotency-Key', message: '仅允许 8-128 位字母、数字、下划线或短横线' }
    ]);
  }
  return key;
}

interface IdempotencyRow {
  request_hash: string;
  status: 'IN_PROGRESS' | 'COMPLETED';
  response_status: number | null;
  response_json: string | null;
  business_id: string | null;
  expires_at: string;
}

export interface IdempotentResult<T> {
  data: T;
  replayed: boolean;
  status: number;
  businessId: string | null;
}

/**
 * 在同一事务内完成“保留意图 → 业务写入 → 保存结果”。
 * 同键同输入返回原结果；同键异输入返回 409；进行中返回 409，客户端应查询/重试而不是换键。
 */
export function runIdempotent<T>(
  db: AppDatabase,
  input: {
    actorId: string;
    operation: string;
    key: string;
    payload: unknown;
    ttlHours?: number;
  },
  work: () => { data: T; status?: number; businessId?: string | null }
): IdempotentResult<T> {
  const operation = input.operation;
  const hash = requestHash({ operation, payload: input.payload });
  const now = nowIso();
  const expiresAt = new Date(Date.now() + (input.ttlHours ?? DEFAULT_TTL_HOURS) * 3_600_000).toISOString();

  return db.tx(() => {
    const existing = db.get<IdempotencyRow>(
      `SELECT request_hash, status, response_status, response_json, business_id, expires_at
       FROM idempotency_requests WHERE actor_id = ? AND operation = ? AND key = ?`,
      input.actorId,
      operation,
      input.key
    );
    if (existing) {
      if (existing.request_hash !== hash) {
        throw errors.conflict('该幂等键已用于不同的请求内容', { code: 'IDEMPOTENCY_CONFLICT' });
      }
      if (existing.expires_at <= now) {
        throw errors.conflict('幂等键已过期，请刷新页面确认当前状态后重新发起', {
          code: 'IDEMPOTENCY_EXPIRED'
        });
      }
      if (existing.status !== 'COMPLETED' || !existing.response_json) {
        throw errors.conflict('相同幂等键的请求正在处理中，请稍后查询结果', {
          code: 'IDEMPOTENCY_IN_PROGRESS'
        });
      }
      return {
        data: JSON.parse(existing.response_json) as T,
        replayed: true,
        status: existing.response_status ?? 200,
        businessId: existing.business_id
      };
    }

    db.run(
      `INSERT INTO idempotency_requests(id, actor_id, operation, key, request_hash, status,
                                        response_status, response_json, business_id, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, 'IN_PROGRESS', NULL, NULL, NULL, ?, ?)`,
      newId(),
      input.actorId,
      operation,
      input.key,
      hash,
      now,
      expiresAt
    );

    const result = work();
    const status = result.status ?? 200;
    db.run(
      `UPDATE idempotency_requests
       SET status = 'COMPLETED', response_status = ?, response_json = ?, business_id = ?
       WHERE actor_id = ? AND operation = ? AND key = ?`,
      status,
      JSON.stringify(result.data),
      result.businessId ?? null,
      input.actorId,
      operation,
      input.key
    );
    return {
      data: result.data,
      replayed: false,
      status,
      businessId: result.businessId ?? null
    };
  });
}
