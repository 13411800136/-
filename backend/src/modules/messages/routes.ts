import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { newId } from '../../common/crypto.js';
import { errors } from '../../common/errors.js';
import { writeAudit } from '../../common/audit.js';
import { createAuthenticate } from '../../common/auth.js';
import { ok } from '../../common/http.js';
import { requireIdempotencyKey, runIdempotent } from '../../common/idempotency.js';
import { nowIso } from '../../common/time.js';
import { idParam, requiredText, validate } from '../../common/validation.js';
import type { AppContext, AuthUser, Role } from '../../common/types.js';

const sendSchema = z.object({
  recipientId: z.string().min(1, '请选择接收人'),
  body: requiredText(1000, '消息内容'),
  orderId: z.string().min(1).nullable().optional()
});

interface MessageRow {
  id: string;
  sender_id: string;
  sender_name: string;
  sender_role: Role;
  recipient_id: string;
  recipient_name: string;
  recipient_role: Role;
  order_id: string | null;
  order_no: string | null;
  body: string;
  read_at: string | null;
  created_at: string;
}

function serializeMessage(row: MessageRow) {
  return {
    id: row.id,
    sender: { id: row.sender_id, name: row.sender_name, role: row.sender_role },
    recipient: { id: row.recipient_id, name: row.recipient_name, role: row.recipient_role },
    order: row.order_id ? { id: row.order_id, orderNo: row.order_no } : null,
    body: row.body,
    read: row.read_at !== null,
    readAt: row.read_at,
    createdAt: row.created_at
  };
}

/** 现场角色只能把消息关联到自己职责范围内的订单；管理员不限制。 */
function canReferenceOrder(db: AppContext['db'], user: AuthUser, orderId: string): boolean {
  if (user.role === 'ADMIN') return true;
  const order = db.get<{ status: string }>('SELECT status FROM orders WHERE id = ?', orderId);
  if (!order) return false;
  if (user.role === 'PRODUCTION') {
    const task = db.get<{ id: string }>(
      'SELECT id FROM production_orders WHERE order_id = ? AND department_id = ? LIMIT 1',
      orderId,
      user.departmentId
    );
    return Boolean(task);
  }
  if (user.role === 'LOGISTICS') {
    return ['PURCHASING', 'SHIPPING', 'COMPLETED'].includes(order.status);
  }
  if (user.role === 'QC') {
    return ['PENDING_QC', 'QC_DONE', 'PACKING', 'SHIPPING', 'COMPLETED'].includes(order.status);
  }
  if (user.role === 'PACKING') {
    return ['PACKING', 'SHIPPING', 'COMPLETED'].includes(order.status);
  }
  return false;
}

export async function registerMessageRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { db, config } = ctx;
  const authenticate = createAuthenticate(db, config);
  const auth = { preHandler: [authenticate] };

  app.get('/messages/recipients', auth, async (request, reply) => {
    const actor = request.auth!.user;
    const rows = db.all<{
      id: string;
      display_name: string;
      role: Role;
      department_name: string | null;
    }>(
      `SELECT u.id, u.display_name, u.role, d.name AS department_name
       FROM users u LEFT JOIN departments d ON d.id = u.department_id
       WHERE u.active = 1 AND u.id <> ?
       ORDER BY CASE u.role WHEN 'ADMIN' THEN 0 WHEN 'LOGISTICS' THEN 1 WHEN 'PRODUCTION' THEN 2 WHEN 'QC' THEN 3 ELSE 4 END,
                u.display_name`,
      actor.id
    );
    return ok(reply, request, {
      items: rows.map((row) => ({
        id: row.id,
        displayName: row.display_name,
        role: row.role,
        departmentName: row.department_name
      }))
    });
  });

  app.get('/messages/unread-count', auth, async (request, reply) => {
    const row = db.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM internal_messages WHERE recipient_id = ? AND read_at IS NULL',
      request.auth!.user.id
    );
    return ok(reply, request, { unreadCount: row?.count ?? 0 });
  });

  app.get('/messages/inbox', auth, async (request, reply) => {
    const actor = request.auth!.user;
    const rows = db.all<MessageRow>(
      `SELECT m.id, m.sender_id, s.display_name AS sender_name, s.role AS sender_role,
              m.recipient_id, r.display_name AS recipient_name, r.role AS recipient_role,
              m.order_id, o.order_no, m.body, m.read_at, m.created_at
       FROM internal_messages m
       JOIN users s ON s.id = m.sender_id
       JOIN users r ON r.id = m.recipient_id
       LEFT JOIN orders o ON o.id = m.order_id
       WHERE m.recipient_id = ?
       ORDER BY m.created_at DESC, m.id DESC LIMIT 100`,
      actor.id
    );
    const unread = db.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM internal_messages WHERE recipient_id = ? AND read_at IS NULL',
      actor.id
    );
    return ok(reply, request, {
      items: rows.map(serializeMessage),
      unreadCount: unread?.count ?? 0
    });
  });

  app.get('/messages/sent', auth, async (request, reply) => {
    const actor = request.auth!.user;
    const rows = db.all<MessageRow>(
      `SELECT m.id, m.sender_id, s.display_name AS sender_name, s.role AS sender_role,
              m.recipient_id, r.display_name AS recipient_name, r.role AS recipient_role,
              m.order_id, o.order_no, m.body, m.read_at, m.created_at
       FROM internal_messages m
       JOIN users s ON s.id = m.sender_id
       JOIN users r ON r.id = m.recipient_id
       LEFT JOIN orders o ON o.id = m.order_id
       WHERE m.sender_id = ?
       ORDER BY m.created_at DESC, m.id DESC LIMIT 100`,
      actor.id
    );
    return ok(reply, request, { items: rows.map(serializeMessage) });
  });

  app.post('/messages', auth, async (request, reply) => {
    const key = requireIdempotencyKey(request);
    const input = validate(sendSchema, request.body);
    const actor = request.auth!.user;
    const recipient = db.get<{ id: string; display_name: string; active: number }>(
      'SELECT id, display_name, active FROM users WHERE id = ?',
      input.recipientId
    );
    if (!recipient || recipient.active !== 1) {
      throw errors.validation('接收人不存在或已停用', [{ path: 'recipientId', message: '请选择启用中的接收人' }]);
    }
    if (recipient.id === actor.id) throw errors.validation('不能给自己发消息');
    if (input.orderId && !canReferenceOrder(db, actor, input.orderId)) {
      throw errors.notFoundOrForbidden('关联订单不存在或不在当前职责范围');
    }

    const result = runIdempotent(
      db,
      {
        actorId: actor.id,
        operation: 'message.send',
        key,
        payload: { recipientId: input.recipientId, body: input.body, orderId: input.orderId ?? null }
      },
      () => {
        const id = newId();
        db.run(
          `INSERT INTO internal_messages(id, sender_id, recipient_id, order_id, body, read_at, created_at)
           VALUES (?, ?, ?, ?, ?, NULL, ?)`,
          id,
          actor.id,
          input.recipientId,
          input.orderId ?? null,
          input.body,
          nowIso()
        );
        writeAudit(db, {
          requestId: request.id,
          actor,
          action: 'MESSAGE_SEND',
          resourceType: 'INTERNAL_MESSAGE',
          resourceId: id,
          result: 'SUCCESS',
          after: { recipientId: input.recipientId, orderId: input.orderId ?? null }
        });
        return { data: { id, recipientName: recipient.display_name }, status: 201, businessId: id };
      }
    );
    reply.header('Idempotent-Replayed', String(result.replayed));
    return ok(reply, request, result.data, result.replayed ? 200 : result.status);
  });

  app.post('/messages/:id/read', auth, async (request, reply) => {
    const { id } = validate(idParam, request.params);
    const actor = request.auth!.user;
    const message = db.get<{ id: string; recipient_id: string; read_at: string | null }>(
      'SELECT id, recipient_id, read_at FROM internal_messages WHERE id = ?',
      id
    );
    if (!message) throw errors.notFound('消息不存在');
    if (message.recipient_id !== actor.id) throw errors.forbidden('只能操作发给自己的消息');
    if (!message.read_at) {
      db.run('UPDATE internal_messages SET read_at = ? WHERE id = ? AND recipient_id = ?', nowIso(), id, actor.id);
    }
    const unread = db.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM internal_messages WHERE recipient_id = ? AND read_at IS NULL',
      actor.id
    );
    return ok(reply, request, { id, read: true, unreadCount: unread?.count ?? 0 });
  });
}
