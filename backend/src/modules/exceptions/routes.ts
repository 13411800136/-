import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { newId } from '../../common/crypto.js';
import { errors } from '../../common/errors.js';
import { addTimeline, notifyAdmins, notifyUser } from '../../common/events.js';
import { writeAudit } from '../../common/audit.js';
import { createAuthenticate, requireAdmin } from '../../common/auth.js';
import { ok } from '../../common/http.js';
import { nowIso } from '../../common/time.js';
import { requireIdempotencyKey, runIdempotent } from '../../common/idempotency.js';
import { idParam, requiredText, shortText, validate } from '../../common/validation.js';
import type { AppContext } from '../../common/types.js';
import { getOrderOrThrow } from '../orders/service.js';

const exceptionSchema = z.object({
  orderId: z.string().min(1, '请选择订单'),
  productionOrderId: z.string().min(1).nullable().optional(),
  category: z.enum(['MATERIAL', 'EQUIPMENT', 'QUALITY', 'PROCESS', 'OTHER']),
  description: requiredText(500, '问题描述')
});

function deriveStatus(row: { status: string; acknowledged_at: string | null }): string {
  if (row.status === 'RESOLVED') return 'RESOLVED';
  return row.acknowledged_at ? 'ACKNOWLEDGED' : 'OPEN';
}

const STATUS_LABELS: Record<string, string> = {
  OPEN: '待处理',
  ACKNOWLEDGED: '处理中',
  RESOLVED: '已解决'
};

const CATEGORY_LABELS: Record<string, string> = {
  MATERIAL: '物料',
  EQUIPMENT: '设备',
  QUALITY: '质量',
  PROCESS: '工艺',
  OTHER: '其他'
};

export async function registerExceptionRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { db, config } = ctx;
  const authenticate = createAuthenticate(db, config);
  const admin = { preHandler: [authenticate, requireAdmin] };

  app.get('/tablet/order-options', { preHandler: [authenticate] }, async (request, reply) => {
    const actor = request.auth!.user;
    let rows: Array<{ id: string; order_no: string; product_name: string; status: string }> = [];
    if (actor.role === 'PRODUCTION') {
      rows = db.all(
        `SELECT DISTINCT o.id, o.order_no, oi.product_name, o.status
         FROM production_orders p
         JOIN orders o ON o.id = p.order_id
         JOIN order_items oi ON oi.id = p.order_item_id
         WHERE p.department_id = ? AND o.status <> 'COMPLETED' AND o.deleted_at IS NULL
         ORDER BY o.created_at DESC`,
        actor.departmentId
      );
    } else if (actor.role === 'LOGISTICS') {
      rows = db.all(
        `SELECT o.id, o.order_no, oi.product_name, o.status
         FROM orders o JOIN order_items oi ON oi.order_id = o.id
         WHERE o.status IN ('PURCHASING', 'SHIPPING') AND o.deleted_at IS NULL
         ORDER BY o.created_at DESC`
      );
    } else if (actor.role === 'QC') {
      rows = db.all(
        `SELECT o.id, o.order_no, oi.product_name, o.status
         FROM orders o JOIN order_items oi ON oi.order_id = o.id
         WHERE o.status = 'PENDING_QC' AND o.deleted_at IS NULL ORDER BY o.created_at DESC`
      );
    } else if (actor.role === 'PACKING') {
      rows = db.all(
        `SELECT o.id, o.order_no, oi.product_name, o.status
         FROM orders o JOIN order_items oi ON oi.order_id = o.id
         WHERE o.status = 'PACKING' AND o.deleted_at IS NULL ORDER BY o.created_at DESC`
      );
    }
    return ok(reply, request, { items: rows });
  });

  app.post('/tablet/exceptions', { preHandler: [authenticate] }, async (request, reply) => {
    const input = validate(exceptionSchema, request.body);
    const actor = request.auth!.user;
    if (actor.role === 'ADMIN') throw errors.forbidden('现场异常由现场角色上报，管理员负责查看');
    const order = getOrderOrThrow(db, input.orderId);
    if (input.productionOrderId) {
      const task = db.get<{ id: string; order_id: string; department_id: string }>(
        'SELECT id, order_id, department_id FROM production_orders WHERE id = ?',
        input.productionOrderId
      );
      if (!task || task.order_id !== order.id) throw errors.validation('生产任务不属于该订单');
      if (actor.role === 'PRODUCTION' && task.department_id !== actor.departmentId) {
        throw errors.notFoundOrForbidden('任务不存在或不属于当前部门');
      }
    }
    const id = newId();
    db.tx(() => {
      db.run(
        `INSERT INTO tablet_exceptions(id, order_id, production_order_id, category, description, status, reporter_id, created_at)
         VALUES (?, ?, ?, ?, ?, 'OPEN', ?, ?)`,
        id,
        order.id,
        input.productionOrderId ?? null,
        input.category,
        input.description,
        actor.id,
        nowIso()
      );
      addTimeline(db, {
        orderId: order.id,
        eventType: 'EXCEPTION_REPORTED',
        actor,
        resourceType: 'TABLET_EXCEPTION',
        resourceId: id,
        payload: { category: input.category, description: input.description }
      });
      notifyAdmins(db, {
        eventType: 'TABLET_EXCEPTION_REPORTED',
        title: '现场异常上报',
        body: `${order.order_no}：${actor.displayName} 上报「${CATEGORY_LABELS[input.category]}」— ${input.description.slice(0, 80)}`,
        resourceType: 'ORDER',
        resourceId: order.id,
        dedupeKey: `exception:${id}`
      });
      writeAudit(db, {
        requestId: request.id,
        actor,
        action: 'TABLET_EXCEPTION_CREATE',
        resourceType: 'TABLET_EXCEPTION',
        resourceId: id,
        result: 'SUCCESS',
        after: { orderId: order.id, category: input.category, description: input.description }
      });
    });
    return ok(reply, request, { id, status: 'OPEN' }, 201);
  });

  app.get('/tablet/exceptions', { preHandler: [authenticate] }, async (request, reply) => {
    const actor = request.auth!.user;
    const rows = db.all<{
      id: string;
      order_id: string;
      order_no: string;
      production_order_id: string | null;
      category: string;
      description: string;
      status: string;
      reporter_name: string;
      resolution_note: string;
      acknowledged_at: string | null;
      resolved_at: string | null;
      created_at: string;
    }>(
      `SELECT e.id, e.order_id, o.order_no, e.production_order_id, e.category, e.description, e.status,
              u.display_name AS reporter_name, e.resolution_note, e.acknowledged_at, e.resolved_at,
              e.created_at
       FROM tablet_exceptions e
       JOIN orders o ON o.id = e.order_id
       JOIN users u ON u.id = e.reporter_id
       WHERE (? = 'ADMIN' OR e.reporter_id = ?)
       ORDER BY e.created_at DESC LIMIT 100`,
      actor.role,
      actor.id
    );
    return ok(reply, request, {
      items: rows.map((row) => ({
        id: row.id,
        orderId: row.order_id,
        orderNo: row.order_no,
        productionOrderId: row.production_order_id,
        category: row.category,
        categoryLabel: CATEGORY_LABELS[row.category] ?? row.category,
        description: row.description,
        status: deriveStatus(row),
        statusLabel: STATUS_LABELS[deriveStatus(row)] ?? deriveStatus(row),
        reporterName: row.reporter_name,
        acknowledgedAt: row.acknowledged_at,
        resolvedAt: row.resolved_at,
        resolutionNote: row.resolution_note,
        createdAt: row.created_at
      }))
    });
  });

  app.get('/exceptions', admin, async (request, reply) => {
    const query = validate(
      z.object({
        status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED']).optional()
      }),
      request.query
    );
    const statusSql =
      query.status === 'OPEN'
        ? "e.status = 'OPEN' AND e.acknowledged_at IS NULL"
        : query.status === 'ACKNOWLEDGED'
          ? "e.status = 'OPEN' AND e.acknowledged_at IS NOT NULL"
          : query.status === 'RESOLVED'
            ? "e.status = 'RESOLVED'"
            : null;
    const where = statusSql ? `WHERE ${statusSql}` : '';
    const params: string[] = [];
    const rows = db.all<Record<string, unknown>>(
      `SELECT e.id, e.order_id, o.order_no, e.production_order_id, e.category, e.description, e.status,
              e.reporter_id, ru.display_name AS reporter_name,
              e.acknowledged_at, au.display_name AS acknowledged_by_name,
              e.resolved_at, rsu.display_name AS resolved_by_name, e.resolution_note,
              e.created_at
       FROM tablet_exceptions e
       JOIN orders o ON o.id = e.order_id
       JOIN users ru ON ru.id = e.reporter_id
       LEFT JOIN users au ON au.id = e.acknowledged_by
       LEFT JOIN users rsu ON rsu.id = e.resolved_by
       ${where}
       ORDER BY CASE e.status WHEN 'OPEN' THEN 0 WHEN 'ACKNOWLEDGED' THEN 1 ELSE 2 END,
                e.created_at DESC
       LIMIT 200`,
      ...params
    );
    const counts = db.get<{ pending: number; handling: number; resolved: number }>(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'OPEN' AND acknowledged_at IS NULL THEN 1 ELSE 0 END), 0) AS pending,
         COALESCE(SUM(CASE WHEN status = 'OPEN' AND acknowledged_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS handling,
         COALESCE(SUM(CASE WHEN status = 'RESOLVED' THEN 1 ELSE 0 END), 0) AS resolved
       FROM tablet_exceptions`
    );
    const summary = {
      OPEN: counts?.pending ?? 0,
      ACKNOWLEDGED: counts?.handling ?? 0,
      RESOLVED: counts?.resolved ?? 0
    };
    return ok(reply, request, {
      summary,
      items: rows.map((row) => ({
        id: row.id,
        orderId: row.order_id,
        orderNo: row.order_no,
        productionOrderId: row.production_order_id,
        category: row.category,
        categoryLabel: CATEGORY_LABELS[String(row.category)] ?? String(row.category),
        description: row.description,
        status: deriveStatus({ status: String(row.status), acknowledged_at: (row.acknowledged_at as string | null) ?? null }),
        statusLabel:
          STATUS_LABELS[deriveStatus({ status: String(row.status), acknowledged_at: (row.acknowledged_at as string | null) ?? null })] ??
          String(row.status),
        reporterName: row.reporter_name,
        acknowledgedAt: row.acknowledged_at,
        acknowledgedByName: row.acknowledged_by_name,
        resolvedAt: row.resolved_at,
        resolvedByName: row.resolved_by_name,
        resolutionNote: row.resolution_note,
        createdAt: row.created_at
      }))
    });
  });

  const handleNote = z.object({
    note: shortText(300, '处理说明').default('')
  });

  app.post('/exceptions/:id/acknowledge', admin, async (request, reply) => {
    const { id } = validate(idParam, request.params);
    const key = requireIdempotencyKey(request);
    const input = validate(handleNote, request.body ?? {});
    const actor = request.auth!.user;

    const result = runIdempotent(
      db,
      { actorId: actor.id, operation: 'exception.acknowledge', key, payload: { id, ...input } },
      () => {
        const row = db.get<{ id: string; status: string; reporter_id: string; order_id: string }>(
          'SELECT id, status, reporter_id, order_id FROM tablet_exceptions WHERE id = ?',
          id
        );
        if (!row) throw errors.notFound('异常记录不存在');
        if (row.status === 'RESOLVED') throw errors.invalidState('异常已解决，不能再次开始处理');
        const acknowledged = db.get<{ ok: number }>(
          'SELECT 1 AS ok FROM tablet_exceptions WHERE id = ? AND acknowledged_at IS NOT NULL',
          id
        );
        if (!acknowledged) {
          const now = nowIso();
          db.run(
            'UPDATE tablet_exceptions SET acknowledged_at = ?, acknowledged_by = ? WHERE id = ?',
            now,
            actor.id,
            id
          );
          addTimeline(db, {
            orderId: row.order_id,
            eventType: 'EXCEPTION_ACKNOWLEDGED',
            actor,
            resourceType: 'TABLET_EXCEPTION',
            resourceId: id,
            payload: { note: input.note }
          });
          notifyUser(db, row.reporter_id, {
            eventType: 'EXCEPTION_ACKNOWLEDGED',
            title: '现场异常已被受理',
            body: `管理员 ${actor.displayName} 已开始处理你上报的异常。${input.note ? '说明：' + input.note : ''}`,
            resourceType: 'ORDER',
            resourceId: row.order_id,
            dedupeKey: `exception-ack:${id}`
          });
          writeAudit(db, {
            requestId: request.id,
            actor,
            action: 'EXCEPTION_ACKNOWLEDGE',
            resourceType: 'TABLET_EXCEPTION',
            resourceId: id,
            result: 'SUCCESS',
            before: { status: 'OPEN' },
            after: { status: 'ACKNOWLEDGED', note: input.note }
          });
        }
        return { data: { id, status: 'ACKNOWLEDGED' }, businessId: id };
      }
    );
    reply.header('Idempotent-Replayed', String(result.replayed));
    return ok(reply, request, result.data, result.replayed ? 200 : result.status);
  });

  app.post('/exceptions/:id/resolve', admin, async (request, reply) => {
    const { id } = validate(idParam, request.params);
    const key = requireIdempotencyKey(request);
    const input = validate(z.object({ note: requiredText(300, '处理结论') }), request.body);
    const actor = request.auth!.user;

    const result = runIdempotent(
      db,
      { actorId: actor.id, operation: 'exception.resolve', key, payload: { id, ...input } },
      () => {
        const row = db.get<{ id: string; status: string; reporter_id: string; order_id: string }>(
          'SELECT id, status, reporter_id, order_id FROM tablet_exceptions WHERE id = ?',
          id
        );
        if (!row) throw errors.notFound('异常记录不存在');
        if (row.status === 'RESOLVED') {
          return { data: { id, status: 'RESOLVED' }, businessId: id };
        }
        const now = nowIso();
        db.run(
          `UPDATE tablet_exceptions
           SET status = 'RESOLVED', resolved_at = ?, resolved_by = ?, resolution_note = ?,
               acknowledged_at = COALESCE(acknowledged_at, ?),
               acknowledged_by = COALESCE(acknowledged_by, ?)
           WHERE id = ?`,
          now,
          actor.id,
          input.note,
          now,
          actor.id,
          id
        );
        addTimeline(db, {
          orderId: row.order_id,
          eventType: 'EXCEPTION_RESOLVED',
          actor,
          resourceType: 'TABLET_EXCEPTION',
          resourceId: id,
          payload: { note: input.note }
        });
        notifyUser(db, row.reporter_id, {
          eventType: 'EXCEPTION_RESOLVED',
          title: '现场异常已处理完成',
          body: `管理员 ${actor.displayName} 已处理：${input.note}`,
          resourceType: 'ORDER',
          resourceId: row.order_id,
          dedupeKey: `exception-resolved:${id}`
        });
        writeAudit(db, {
          requestId: request.id,
          actor,
          action: 'EXCEPTION_RESOLVE',
          resourceType: 'TABLET_EXCEPTION',
          resourceId: id,
          result: 'SUCCESS',
          before: { status: row.status },
          after: { status: 'RESOLVED', note: input.note }
        });
        return { data: { id, status: 'RESOLVED' }, businessId: id };
      }
    );
    reply.header('Idempotent-Replayed', String(result.replayed));
    return ok(reply, request, result.data, result.replayed ? 200 : result.status);
  });

  app.get('/exceptions/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = validate(idParam, request.params);
    const row = db.get<Record<string, unknown>>(
      `SELECT e.*, o.order_no, u.display_name AS reporter_name FROM tablet_exceptions e
       JOIN orders o ON o.id = e.order_id JOIN users u ON u.id = e.reporter_id WHERE e.id = ?`,
      id
    );
    if (!row) throw errors.notFound('异常记录不存在');
    const actor = request.auth!.user;
    if (actor.role !== 'ADMIN' && row.reporter_id !== actor.id) {
      throw errors.notFoundOrForbidden('异常记录不存在或无权查看');
    }
    return ok(reply, request, {
      id: row.id,
      orderId: row.order_id,
      orderNo: row.order_no,
      category: row.category,
      description: row.description,
      status: deriveStatus({ status: String(row.status), acknowledged_at: (row.acknowledged_at as string | null) ?? null }),
      statusLabel:
        STATUS_LABELS[deriveStatus({ status: String(row.status), acknowledged_at: (row.acknowledged_at as string | null) ?? null })] ??
        String(row.status),
      reporterName: row.reporter_name,
      acknowledgedAt: row.acknowledged_at,
      resolvedAt: row.resolved_at,
      resolutionNote: row.resolution_note,
      createdAt: row.created_at
    });
  });
}
