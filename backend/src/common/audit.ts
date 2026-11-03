import { newId } from './crypto.js';
import { nowIso } from './time.js';
import type { AppDatabase } from '../db/database.js';
import type { AuthUser } from './types.js';

const SENSITIVE_KEY = /pass(word)?|token|secret|cookie|authorization|salt|hash/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[DEPTH_LIMIT]';
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1));
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(key)) {
        output[key] = '[REDACTED]';
      } else {
        output[key] = redact(entry, depth + 1);
      }
    }
    return output;
  }
  if (typeof value === 'string' && value.length > 800) return `${value.slice(0, 800)}…`;
  return value;
}

function serialize(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    const text = JSON.stringify(redact(value));
    return text.length > 4000 ? `${text.slice(0, 4000)}…` : text;
  } catch {
    return '"[UNSERIALIZABLE]"';
  }
}

export interface AuditInput {
  requestId: string;
  actor: Pick<AuthUser, 'id' | 'displayName'> | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  result: 'SUCCESS' | 'FAILURE';
  errorCode?: string | null;
  before?: unknown;
  after?: unknown;
  detail?: string | null;
}

/** 审计写入不抛错影响主流程；失败时输出到服务日志。 */
export function writeAudit(db: AppDatabase, input: AuditInput): void {
  try {
    db.run(
      `INSERT INTO audit_logs(id, request_id, actor_id, actor_name, action, resource_type, resource_id,
                              result, error_code, before_json, after_json, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newId(),
      input.requestId,
      input.actor?.id ?? null,
      input.actor?.displayName ?? '未认证',
      input.action,
      input.resourceType,
      input.resourceId ?? null,
      input.result,
      input.errorCode ?? null,
      serialize(input.before),
      serialize(input.after),
      input.detail ? input.detail.slice(0, 500) : null,
      nowIso()
    );
  } catch (error) {
    console.error('[audit] 写入审计失败', error);
  }
}
