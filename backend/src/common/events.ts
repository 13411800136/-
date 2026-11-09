import { newId } from './crypto.js';
import { nowIso } from './time.js';
import type { AppDatabase } from '../db/database.js';
import type { AuthUser } from './types.js';

export type TimelineEventType =
  | 'ORDER_CREATED'
  | 'PURCHASE_CREATED'
  | 'ARRIVAL_RECORDED'
  | 'PRODUCTION_DISPATCHED'
  | 'PRODUCTION_FEEDBACK'
  | 'QC_DISPATCHED'
  | 'QC_RECORDED'
  | 'QC_PASSED'
  | 'PACKING_DISPATCHED'
  | 'PACKING_RECORDED'
  | 'SHIPMENT_TRIGGERED'
  | 'SHIPMENT_RECORDED'
  | 'ORDER_COMPLETED'
  | 'ORDER_CANCELLED'
  | 'EXCEPTION_REPORTED'
  | 'PRICE_VISIBILITY_CHANGED';

export function addTimeline(
  db: AppDatabase,
  input: {
    orderId: string;
    eventType: TimelineEventType;
    actor: Pick<AuthUser, 'id' | 'displayName'>;
    resourceType: string;
    resourceId: string;
    quantity?: number;
    payload?: unknown;
    at?: string;
  }
): void {
  db.run(
    `INSERT INTO order_timeline(id, order_id, event_type, actor_id, actor_name, resource_type,
                                resource_id, quantity, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    newId(),
    input.orderId,
    input.eventType,
    input.actor.id,
    input.actor.displayName,
    input.resourceType,
    input.resourceId,
    input.quantity ?? null,
    input.payload === undefined ? null : JSON.stringify(input.payload),
    input.at ?? nowIso()
  );
}

export interface NotifyInput {
  eventType: string;
  title: string;
  body: string;
  resourceType: string;
  resourceId: string;
  dedupeKey: string;
}

/**
 * 关键事件通知所有启用中的管理员。
 * dedupe_key 带上接收人，保证同一事件对每个接收人只生成一次。
 */
export function notifyAdmins(db: AppDatabase, input: NotifyInput): void {
  const admins = db.all<{ id: string }>(
    "SELECT id FROM users WHERE role = 'ADMIN' AND active = 1 ORDER BY created_at"
  );
  const now = nowIso();
  for (const admin of admins) {
    db.run(
      `INSERT INTO notifications(id, recipient_id, event_type, title, body, resource_type, resource_id,
                                dedupe_key, read_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
       ON CONFLICT(dedupe_key) DO NOTHING`,
      newId(),
      admin.id,
      input.eventType,
      input.title,
      input.body,
      input.resourceType,
      input.resourceId,
      `${input.dedupeKey}:${admin.id}`,
      now
    );
  }
}
