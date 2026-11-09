import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { errors } from '../../common/errors.js';
import { createAuthenticate, requireAdmin } from '../../common/auth.js';
import { ok } from '../../common/http.js';
import { nowIso } from '../../common/time.js';
import { idParam, validate } from '../../common/validation.js';
import type { AppContext } from '../../common/types.js';
import { generateDueSoonNotifications } from './reminders.js';

export async function registerNotificationRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { db, config } = ctx;
  const authenticate = createAuthenticate(db, config);
  const admin = { preHandler: [authenticate, requireAdmin] };

  app.get('/notifications', admin, async (request, reply) => {
    const query = validate(
      z.object({
        unreadOnly: z.enum(['0', '1']).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50)
      }),
      request.query
    );
    const actor = request.auth!.user;
    generateDueSoonNotifications(db);
    const rows = db.all<{
      id: string;
      event_type: string;
      title: string;
      body: string;
      resource_type: string;
      resource_id: string;
      read_at: string | null;
      created_at: string;
    }>(
      `SELECT id, event_type, title, body, resource_type, resource_id, read_at, created_at
       FROM notifications WHERE recipient_id = ? ${query.unreadOnly === '1' ? 'AND read_at IS NULL' : ''}
       ORDER BY created_at DESC LIMIT ?`,
      actor.id,
      query.limit
    );
    const unread = db.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM notifications WHERE recipient_id = ? AND read_at IS NULL',
      actor.id
    );
    return ok(reply, request, {
      items: rows.map((row) => ({
        id: row.id,
        eventType: row.event_type,
        title: row.title,
        body: row.body,
        resourceType: row.resource_type,
        resourceId: row.resource_id,
        read: row.read_at !== null,
        readAt: row.read_at,
        createdAt: row.created_at
      })),
      unreadCount: unread?.count ?? 0
    });
  });

  app.get('/notifications/unread-count', admin, async (request, reply) => {
    generateDueSoonNotifications(db);
    const row = db.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM notifications WHERE recipient_id = ? AND read_at IS NULL',
      request.auth!.user.id
    );
    return ok(reply, request, { unreadCount: row?.count ?? 0 });
  });

  app.post('/notifications/:id/read', admin, async (request, reply) => {
    const { id } = validate(idParam, request.params);
    const actor = request.auth!.user;
    const notification = db.get<{ id: string; recipient_id: string; read_at: string | null }>(
      'SELECT id, recipient_id, read_at FROM notifications WHERE id = ?',
      id
    );
    if (!notification) throw errors.notFound('通知不存在');
    if (notification.recipient_id !== actor.id) throw errors.forbidden('不能操作其他人的通知');
    if (!notification.read_at) {
      db.run('UPDATE notifications SET read_at = ? WHERE id = ? AND recipient_id = ?', nowIso(), id, actor.id);
    }
    const unread = db.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM notifications WHERE recipient_id = ? AND read_at IS NULL',
      actor.id
    );
    return ok(reply, request, { id, read: true, unreadCount: unread?.count ?? 0 });
  });

  app.post('/notifications/mark-all-read', admin, async (request, reply) => {
    const actor = request.auth!.user;
    const updated = db.run(
      'UPDATE notifications SET read_at = ? WHERE recipient_id = ? AND read_at IS NULL',
      nowIso(),
      actor.id
    );
    return ok(reply, request, {
      updated: Number(updated.changes),
      unreadCount: 0
    });
  });
}
