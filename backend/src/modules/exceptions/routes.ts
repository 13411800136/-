import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { newId } from '../../common/crypto.js';
import { errors } from '../../common/errors.js';
import { addTimeline, notifyAdmins } from '../../common/events.js';
import { writeAudit } from '../../common/audit.js';
import { createAuthenticate, requireAdmin } from '../../common/auth.js';
import { ok } from '../../common/http.js';
import { nowIso } from '../../common/time.js';
import { idParam, requiredText, validate } from '../../common/validation.js';
import type { AppContext } from '../../common/types.js';
import { getOrderOrThrow } from '../orders/service.js';

const exceptionSchema = z.object({
  orderId: z.string().min(1, '请选择订单'),
  productionOrderId: z.string().min(1).nullable().optional(),
  category: z.enum(['MATERIAL', 'EQUIPMENT', 'QUALITY', 'PROCESS', 'OTHER']),
  description: requiredText(500, '问题描述')
});

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
         WHERE p.department_id = ? AND o.status <> 'COMPLETED'
         ORDER BY o.created_at DESC`,
        actor.departmentId
      );
    } else if (actor.role === 'LOGISTICS') {
      rows = db.all(
        `SELECT o.id, o.order_no, oi.product_name, o.status
         FROM orders o JOIN order_items oi ON oi.order_id = o.id
         WHERE o.status IN ('PURCHASING', 'SHIPPING')
         ORDER BY o.created_at DESC`
      );
    } else if (actor.role === 'QC') {
      rows = db.all(
        `SELECT o.id, o.order_no, oi.product_name, o.status
         FROM orders o JOIN order_items oi ON oi.order_id = o.id
         WHERE o.status = 'PENDING_QC' ORDER BY o.created_at DESC`
      );
    } else if (actor.role === 'PACKING') {
      rows = db.all(
        `SELECT o.id, o.order_no, oi.product_name, o.status
         FROM orders o JOIN order_items oi ON oi.order_id = o.id
         WHERE o.status = 'PACKING' ORDER BY o.created_at DESC`
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
      created_at: string;
    }>(
      `SELECT e.id, e.order_id, o.order_no, e.production_order_id, e.category, e.description, e.status,
              u.display_name AS reporter_name, e.created_at
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
        status: row.status,
        reporterName: row.reporter_name,
        createdAt: row.created_at
      }))
    });
  });

  app.get('/exceptions', admin, async (request, reply) => {
    const rows = db.all<Record<string, unknown>>(
      `SELECT e.id, e.order_id, o.order_no, e.category, e.description, e.status,
              u.display_name AS reporter_name, e.created_at
       FROM tablet_exceptions e JOIN orders o ON o.id = e.order_id
       JOIN users u ON u.id = e.reporter_id
       ORDER BY e.status, e.created_at DESC LIMIT 200`
    );
    return ok(reply, request, {
      items: rows.map((row) => ({
        id: row.id,
        orderId: row.order_id,
        orderNo: row.order_no,
        category: row.category,
        categoryLabel: CATEGORY_LABELS[String(row.category)] ?? String(row.category),
        description: row.description,
        status: row.status,
        reporterName: row.reporter_name,
        createdAt: row.created_at
      }))
    });
  });

  app.patch('/exceptions/:id', admin, async () => {
    throw errors.feature('异常处理状态与处理人属于 F 能力，当前最低实现仅支持上报与查看');
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
      status: row.status,
      reporterName: row.reporter_name,
      createdAt: row.created_at
    });
  });
}
