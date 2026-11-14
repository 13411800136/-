import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { newId } from '../../common/crypto.js';
import { errors } from '../../common/errors.js';
import { addTimeline, notifyAdmins } from '../../common/events.js';
import { writeAudit } from '../../common/audit.js';
import { createAuthenticate, requireAdmin, requireRole } from '../../common/auth.js';
import { ok } from '../../common/http.js';
import { requireIdempotencyKey, runIdempotent } from '../../common/idempotency.js';
import { formatCents } from '../../common/money.js';
import { businessDate, nowIso } from '../../common/time.js';
import {
  dateInput,
  idParam,
  moneyInput,
  positiveInt,
  requiredText,
  shortText,
  validate
} from '../../common/validation.js';
import type { AppContext, AuthUser } from '../../common/types.js';
import {
  assertOrderStatus,
  getOrderOrThrow,
  getProductions,
  getPurchase,
  getSingleItemOrThrow,
  ORDER_STATUS_LABELS,
  type ProductionRow
} from '../orders/service.js';

const dispatchSchema = z.object({
  orderItemId: z.string().min(1, '请选择产品明细'),
  departmentId: z.string().min(1, '请选择生产部门'),
  assigneeId: z.string().min(1).nullable().optional(),
  processName: requiredText(50, '工艺名称'),
  quantity: positiveInt,
  unitPrice: moneyInput,
  dueDate: dateInput,
  priceVisible: z.boolean().default(false)
});

const feedbackSchema = z.object({
  quantity: positiveInt,
  note: shortText(200, '备注').default('')
});

const visibilitySchema = z.object({
  priceVisible: z.boolean()
});

interface TaskRow extends ProductionRow {
  order_no: string;
  order_status: string;
  order_due_date: string;
  product_name: string;
  product_spec: string;
  order_quantity: number;
  produced_qty: number;
}

function loadTask(db: AppContext['db'], taskId: string): TaskRow {
  const row = db.get<TaskRow>(
    `SELECT p.*, o.order_no, o.status AS order_status, o.due_date AS order_due_date,
            oi.product_name, oi.spec AS product_spec, oi.quantity AS order_quantity,
            d.name AS department_name, u.display_name AS assignee_name,
            (SELECT COALESCE(SUM(f.quantity), 0) FROM production_feedbacks f
             WHERE f.production_order_id = p.id) AS produced_qty
     FROM production_orders p
     JOIN orders o ON o.id = p.order_id
     JOIN order_items oi ON oi.id = p.order_item_id
     JOIN departments d ON d.id = p.department_id
     LEFT JOIN users u ON u.id = p.assignee_id
     WHERE p.id = ?`,
    taskId
  );
  if (!row) throw errors.notFound('生产任务不存在');
  return row;
}

function serializeTask(row: TaskRow, actor: AuthUser) {
  const includePrice = row.price_visible === 1 && actor.role === 'PRODUCTION';
  return {
    id: row.id,
    orderId: row.order_id,
    orderNo: row.order_no,
    orderStatus: row.order_status,
    orderStatusLabel: ORDER_STATUS_LABELS[row.order_status as keyof typeof ORDER_STATUS_LABELS] ?? row.order_status,
    productName: row.product_name,
    spec: row.product_spec,
    orderQuantity: row.order_quantity,
    processName: row.process_name,
    quantity: row.quantity,
    producedQty: row.produced_qty,
    remainingQty: Math.max(0, row.quantity - row.produced_qty),
    departmentId: row.department_id,
    departmentName: row.department_name,
    assigneeName: row.assignee_name,
    dueDate: row.due_date,
    priceVisible: row.price_visible === 1,
    ...(includePrice ? { unitPrice: formatCents(row.unit_price_cents) } : {}),
    createdAt: row.created_at
  };
}

export async function registerProductionRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { db, config } = ctx;
  const authenticate = createAuthenticate(db, config);
  const admin = { preHandler: [authenticate, requireAdmin] };
  const production = { preHandler: [authenticate, requireRole('PRODUCTION')] };

  app.post('/orders/:id/production-orders', admin, async (request, reply) => {
    const { id: orderId } = validate(idParam, request.params);
    const key = requireIdempotencyKey(request);
    const input = validate(dispatchSchema, request.body);
    const actor = request.auth!.user;

    const result = runIdempotent(
      db,
      { actorId: actor.id, operation: 'production.dispatch', key, payload: { orderId, ...input } },
      () => {
        const order = getOrderOrThrow(db, orderId);
        assertOrderStatus(
          order,
          ['PURCHASING', 'IN_PRODUCTION'],
          '只有采购中或生产中的订单可以下发生产任务'
        );
        const purchase = getPurchase(db, orderId);
        if (!purchase?.item) throw errors.invalidState('订单尚未建立采购单，不能下发生产');
        if (order.status === 'PURCHASING' && purchase.arrivedQty < purchase.item.quantity) {
          throw errors.invalidState('采购尚未全部到货；请到齐后下发生产', {
            arrived: purchase.arrivedQty,
            purchased: purchase.item.quantity
          });
        }
        const item = getSingleItemOrThrow(db, orderId);
        if (input.orderItemId !== item.id) throw errors.validation('产品明细不属于该订单', [{ path: 'orderItemId', message: '明细不匹配' }]);
        const assigned = getProductions(db, orderId).reduce(
          (sum, production) => sum + production.quantity,
          0
        );
        // 质检判定的不合格（返工/报废）需要等量补产，因此可分配上限 = 订单量 + 已判不合格量
        const rejected = db.get<{ qty: number | null }>(
          `SELECT COALESCE(SUM(q.unqualified_qty), 0) AS qty
           FROM qc_records q
           JOIN production_orders p ON p.id = q.production_order_id
           WHERE p.order_id = ? AND q.decision IN ('REWORK', 'SCRAP')`,
          orderId
        );
        const capacity = item.quantity + (rejected?.qty ?? 0);
        const remainingToAssign = capacity - assigned;
        if (remainingToAssign <= 0) {
          throw errors.conflict('订单数量已全部分配到生产任务，不能继续新增', {
            ordered: item.quantity,
            assigned
          });
        }
        if (input.quantity > remainingToAssign) {
          throw errors.validation('生产任务数量超过订单剩余可分配数量', [
            { path: 'quantity', message: `最多可分配 ${remainingToAssign} 件` }
          ]);
        }
        const department = db.get<{ id: string; name: string; category: string; active: number }>(
          'SELECT id, name, category, active FROM departments WHERE id = ?',
          input.departmentId
        );
        if (!department) throw errors.validation('生产部门不存在', [{ path: 'departmentId', message: '请选择部门' }]);
        if (department.active !== 1 || department.category !== 'PRODUCTION') {
          throw errors.validation('请选择启用中的生产部门', [{ path: 'departmentId', message: '部门不可用' }]);
        }
        if (input.assigneeId) {
          const assignee = db.get<{ id: string; department_id: string | null; active: number; role: string }>(
            'SELECT id, department_id, active, role FROM users WHERE id = ?',
            input.assigneeId
          );
          if (!assignee || assignee.active !== 1 || assignee.role !== 'PRODUCTION') {
            throw errors.validation('指定人员不是启用中的生产人员', [{ path: 'assigneeId', message: '人员不可用' }]);
          }
          if (assignee.department_id !== department.id) {
            throw errors.validation('指定人员不属于该生产部门', [{ path: 'assigneeId', message: '人员部门不匹配' }]);
          }
        }
        if (input.dueDate < businessDate()) {
          throw errors.validation('生产交期不能早于今天', [{ path: 'dueDate', message: '请选择今天或之后的日期' }]);
        }
        const taskId = newId();
        const now = nowIso();
        db.run(
          `INSERT INTO production_orders(id, order_id, order_item_id, department_id, assignee_id, process_name,
                                         quantity, unit_price_cents, price_visible, due_date, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          taskId,
          orderId,
          item.id,
          department.id,
          input.assigneeId ?? null,
          input.processName,
          input.quantity,
          input.unitPrice,
          input.priceVisible ? 1 : 0,
          input.dueDate,
          actor.id,
          now
        );
        db.run('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?', 'IN_PRODUCTION', now, orderId);
        addTimeline(db, {
          orderId,
          eventType: 'PRODUCTION_DISPATCHED',
          actor,
          resourceType: 'PRODUCTION_ORDER',
          resourceId: taskId,
          quantity: input.quantity,
          payload: { department: department.name, processName: input.processName }
        });
        writeAudit(db, {
          requestId: request.id,
          actor,
          action: 'PRODUCTION_DISPATCH',
          resourceType: 'PRODUCTION_ORDER',
          resourceId: taskId,
          result: 'SUCCESS',
          before: { orderStatus: order.status },
          after: {
            orderStatus: 'IN_PRODUCTION',
            department: department.name,
            quantity: input.quantity,
            unitPrice: formatCents(input.unitPrice),
            priceVisible: input.priceVisible
          }
        });
        return { data: { id: taskId, status: 'IN_PRODUCTION' }, status: 201, businessId: taskId };
      }
    );
    reply.header('Idempotent-Replayed', String(result.replayed));
    return ok(reply, request, result.data, result.replayed ? 200 : result.status);
  });

  app.get('/production-orders/:id', admin, async (request, reply) => {
    const { id } = validate(idParam, request.params);
    const row = loadTask(db, id);
    const feedbacks = db.all<{
      id: string;
      quantity: number;
      operator_name: string;
      note: string;
      created_at: string;
    }>(
      `SELECT f.id, f.quantity, f.note, f.created_at, u.display_name AS operator_name
       FROM production_feedbacks f JOIN users u ON u.id = f.operator_id
       WHERE f.production_order_id = ? ORDER BY f.created_at`,
      id
    );
    return ok(reply, request, {
      task: {
        ...serializeTask(row, { ...request.auth!.user, role: 'ADMIN' }),
        unitPrice: formatCents(row.unit_price_cents),
        feedbacks: feedbacks.map((feedback) => ({
          id: feedback.id,
          quantity: feedback.quantity,
          operatorName: feedback.operator_name,
          note: feedback.note,
          createdAt: feedback.created_at
        }))
      }
    });
  });

  app.patch('/production-orders/:id/price-visibility', admin, async (request, reply) => {
    const { id } = validate(idParam, request.params);
    const key = requireIdempotencyKey(request);
    const input = validate(visibilitySchema, request.body);
    const actor = request.auth!.user;
    const task = loadTask(db, id);
    const result = runIdempotent(
      db,
      { actorId: actor.id, operation: 'production.visibility', key, payload: { id, ...input } },
      () => {
        db.run(
          'UPDATE production_orders SET price_visible = ? WHERE id = ?',
          input.priceVisible ? 1 : 0,
          id
        );
        addTimeline(db, {
          orderId: task.order_id,
          eventType: 'PRICE_VISIBILITY_CHANGED',
          actor,
          resourceType: 'PRODUCTION_ORDER',
          resourceId: id,
          payload: { priceVisible: input.priceVisible }
        });
        writeAudit(db, {
          requestId: request.id,
          actor,
          action: 'PRODUCTION_PRICE_VISIBILITY',
          resourceType: 'PRODUCTION_ORDER',
          resourceId: id,
          result: 'SUCCESS',
          before: { priceVisible: task.price_visible === 1 },
          after: { priceVisible: input.priceVisible }
        });
        return { data: { id, priceVisible: input.priceVisible }, businessId: id };
      }
    );
    reply.header('Idempotent-Replayed', String(result.replayed));
    return ok(reply, request, result.data, result.replayed ? 200 : result.status);
  });

  app.get('/tablet/production/my-tasks', production, async (request, reply) => {
    const actor = request.auth!.user;
    const rows = db.all<TaskRow>(
      `SELECT p.*, o.order_no, o.status AS order_status, o.due_date AS order_due_date,
              oi.product_name, oi.spec AS product_spec, oi.quantity AS order_quantity,
              d.name AS department_name, u.display_name AS assignee_name,
              (SELECT COALESCE(SUM(f.quantity), 0) FROM production_feedbacks f
               WHERE f.production_order_id = p.id) AS produced_qty
       FROM production_orders p
       JOIN orders o ON o.id = p.order_id
       JOIN order_items oi ON oi.id = p.order_item_id
       JOIN departments d ON d.id = p.department_id
       LEFT JOIN users u ON u.id = p.assignee_id
       WHERE p.department_id = ? AND o.status = 'IN_PRODUCTION'
         AND (SELECT COALESCE(SUM(f.quantity), 0) FROM production_feedbacks f
              WHERE f.production_order_id = p.id) < p.quantity
       ORDER BY p.due_date, p.created_at`,
      actor.departmentId
    );
    return ok(reply, request, {
      tasks: rows.map((row) => serializeTask(row, actor)),
      department: actor.departmentName
    });
  });

  app.get('/tablet/production/history', production, async (request, reply) => {
    const actor = request.auth!.user;
    const rows = db.all<TaskRow>(
      `SELECT p.*, o.order_no, o.status AS order_status, o.due_date AS order_due_date,
              oi.product_name, oi.spec AS product_spec, oi.quantity AS order_quantity,
              d.name AS department_name, u.display_name AS assignee_name,
              (SELECT COALESCE(SUM(f.quantity), 0) FROM production_feedbacks f
               WHERE f.production_order_id = p.id) AS produced_qty
       FROM production_orders p
       JOIN orders o ON o.id = p.order_id
       JOIN order_items oi ON oi.id = p.order_item_id
       JOIN departments d ON d.id = p.department_id
       LEFT JOIN users u ON u.id = p.assignee_id
       WHERE p.department_id = ?
         AND (o.status <> 'IN_PRODUCTION'
              OR (SELECT COALESCE(SUM(f.quantity), 0) FROM production_feedbacks f
                  WHERE f.production_order_id = p.id) >= p.quantity)
       ORDER BY p.created_at DESC LIMIT 50`,
      actor.departmentId
    );
    return ok(reply, request, {
      tasks: rows.map((row) => ({
        ...serializeTask(row, actor),
        feedbacks: db
          .all<{
            id: string;
            quantity: number;
            note: string;
            operator_name: string;
            created_at: string;
          }>(
            `SELECT f.id, f.quantity, f.note, f.created_at, u.display_name AS operator_name
             FROM production_feedbacks f JOIN users u ON u.id = f.operator_id
             WHERE f.production_order_id = ? ORDER BY f.created_at DESC`,
            row.id
          )
          .map((feedback) => ({
            id: feedback.id,
            quantity: feedback.quantity,
            note: feedback.note,
            operatorName: feedback.operator_name,
            createdAt: feedback.created_at
          }))
      }))
    });
  });

  app.post('/production-orders/:id/feedbacks', production, async (request, reply) => {
    const { id: taskId } = validate(idParam, request.params);
    const key = requireIdempotencyKey(request);
    const input = validate(feedbackSchema, request.body);
    const actor = request.auth!.user;

    const result = runIdempotent(
      db,
      { actorId: actor.id, operation: 'production.feedback', key, payload: { taskId, ...input } },
      () => {
        const task = loadTask(db, taskId);
        if (task.department_id !== actor.departmentId) {
          throw errors.notFoundOrForbidden('任务不存在或不属于当前部门');
        }
        const order = getOrderOrThrow(db, task.order_id);
        if (order.status !== 'IN_PRODUCTION') {
          throw errors.invalidState('订单不在生产中，不能提交生产反馈');
        }
        const next = task.produced_qty + input.quantity;
        if (next > task.quantity) {
          throw errors.quantity('生产反馈超过任务数量', {
            taskQuantity: task.quantity,
            produced: task.produced_qty,
            remaining: task.quantity - task.produced_qty
          });
        }
        const feedbackId = newId();
        const now = nowIso();
        db.run(
          `INSERT INTO production_feedbacks(id, production_order_id, quantity, operator_id, note, request_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          feedbackId,
          taskId,
          input.quantity,
          actor.id,
          input.note,
          request.id,
          now
        );
        addTimeline(db, {
          orderId: task.order_id,
          eventType: 'PRODUCTION_FEEDBACK',
          actor,
          resourceType: 'PRODUCTION_FEEDBACK',
          resourceId: feedbackId,
          quantity: input.quantity,
          payload: { producedQty: next, taskQuantity: task.quantity }
        });
        notifyAdmins(db, {
          eventType: 'PRODUCTION_FEEDBACK',
          title: '生产反馈已提交',
          body: `${task.order_no}：${task.process_name} 本次完成 ${input.quantity}，累计 ${next}/${task.quantity}。`,
          resourceType: 'ORDER',
          resourceId: task.order_id,
          dedupeKey: `feedback:${feedbackId}`
        });
        writeAudit(db, {
          requestId: request.id,
          actor,
          action: 'PRODUCTION_FEEDBACK',
          resourceType: 'PRODUCTION_ORDER',
          resourceId: taskId,
          result: 'SUCCESS',
          after: { quantity: input.quantity, producedQty: next, taskQuantity: task.quantity }
        });
        return {
          data: {
            id: feedbackId,
            producedQty: next,
            taskQuantity: task.quantity,
            remainingQty: task.quantity - next,
            completed: next === task.quantity
          },
          status: 201,
          businessId: feedbackId
        };
      }
    );
    reply.header('Idempotent-Replayed', String(result.replayed));
    return ok(reply, request, result.data, result.replayed ? 200 : result.status);
  });

  app.get('/orders/:id/production', admin, async (request, reply) => {
    const { id } = validate(idParam, request.params);
    getOrderOrThrow(db, id);
    const productions = getProductions(db, id);
    return ok(reply, request, {
      production: productions.map((production) => ({
        id: production.id,
        departmentName: production.department_name,
        processName: production.process_name,
        quantity: production.quantity,
        producedQty: production.producedQty,
        unitPrice: formatCents(production.unit_price_cents),
        priceVisible: production.price_visible === 1
      }))
    });
  });
}
