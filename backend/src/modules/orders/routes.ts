import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { newId } from '../../common/crypto.js';
import { errors } from '../../common/errors.js';
import { addTimeline } from '../../common/events.js';
import { writeAudit } from '../../common/audit.js';
import { createAuthenticate, requireAdmin } from '../../common/auth.js';
import { ok, pageMeta } from '../../common/http.js';
import { runIdempotent, requireIdempotencyKey } from '../../common/idempotency.js';
import { formatCents } from '../../common/money.js';
import { businessDate, nowIso } from '../../common/time.js';
import { documentNo } from '../../common/sequence.js';
import {
  dateInput,
  idParam,
  moneyInput,
  pageQuery,
  positiveInt,
  requiredText,
  shortText,
  validate
} from '../../common/validation.js';
import type { AppContext } from '../../common/types.js';
import { ensureCustomer, ensurePart } from '../master/auto-create.js';
import {
  buildOperationSummary,
  buildProfit,
  buildStages,
  getOrderDetail,
  getOrderOrThrow,
  getTimeline,
  ORDER_STATUS_LABELS,
  effectiveStatus,
  cancelDeadline,
  getProductions,
  getPacking,
  getSingleItemOrThrow,
  type OrderStatus
} from './service.js';

const createOrderSchema = z
  .object({
    customerId: z.string().min(1).optional(),
    customerName: shortText(80, '客户名称').optional(),
    dueDate: dateInput,
    note: shortText(300, '备注').default(''),
    item: z.object({
      partId: z.string().min(1).optional(),
      partName: shortText(80, '配件名称').optional(),
      productName: requiredText(80, '产品名称'),
      spec: shortText(120, '规格').default(''),
      quantity: positiveInt,
      unitPrice: moneyInput
    })
  })
  .refine((value) => Boolean(value.customerId) || Boolean(value.customerName?.trim()), {
    message: '请选择客户，或填写新客户名称',
    path: ['customerName']
  });

const listQuery = pageQuery.extend({
  status: z
    .enum([
      'PENDING_PURCHASE',
      'PURCHASING',
      'IN_PRODUCTION',
      'PENDING_QC',
      'QC_DONE',
      'PACKING',
      'SHIPPING',
      'COMPLETED',
      'CANCELLED'
    ])
    .optional(),
  keyword: z.string().trim().max(80).optional()
});

const cancelSchema = z.object({
  reason: requiredText(200, '撤销原因')
});

const batchConfirmSchema = z.object({
  orderIds: z
    .array(z.string().min(1))
    .min(1, '请至少选择一张订单')
    .max(50, '单次最多处理 50 张订单')
    .refine((ids) => new Set(ids).size === ids.length, '订单不能重复选择')
});

export async function registerOrderRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { db, config } = ctx;
  const authenticate = createAuthenticate(db, config);
  const admin = { preHandler: [authenticate, requireAdmin] };

  app.get('/orders', admin, async (request, reply) => {
    const query = validate(listQuery, request.query);
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (query.status === 'CANCELLED') {
      where.push('o.cancelled_at IS NOT NULL');
    } else if (query.status) {
      where.push('o.cancelled_at IS NULL AND o.status = ?');
      params.push(query.status);
    }
    if (query.keyword) {
      where.push('(o.order_no LIKE ? OR o.customer_name LIKE ? OR oi.product_name LIKE ? OR oi.spec LIKE ?)');
      const like = `%${query.keyword}%`;
      params.push(like, like, like, like);
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const totalRow = db.get<{ total: number }>(
      `SELECT COUNT(*) AS total FROM orders o JOIN order_items oi ON oi.order_id = o.id ${whereSql}`,
      ...params
    );
    const rows = db.all<{
      id: string;
      order_no: string;
      customer_name: string;
      due_date: string;
      status: OrderStatus;
      note: string;
      created_at: string;
      cancelled_at: string | null;
      item_id: string;
      product_name: string;
      spec: string;
      quantity: number;
      unit_price_cents: number;
    }>(
      `SELECT o.id, o.order_no, o.customer_name, o.due_date, o.status, o.note, o.created_at, o.cancelled_at,
              oi.id AS item_id, oi.product_name, oi.spec, oi.quantity, oi.unit_price_cents
       FROM orders o JOIN order_items oi ON oi.order_id = o.id
       ${whereSql}
       ORDER BY o.created_at DESC, o.id DESC
       LIMIT ? OFFSET ?`,
      ...params,
      query.pageSize,
      (query.page - 1) * query.pageSize
    );
    const total = totalRow?.total ?? 0;
    return ok(reply, request, {
      items: rows.map((row) => {
        const status = effectiveStatus(row);
        return {
          id: row.id,
          orderNo: row.order_no,
          customerName: row.customer_name,
          productName: row.product_name,
          spec: row.spec,
          quantity: row.quantity,
          unitPrice: formatCents(row.unit_price_cents),
          amount: formatCents(row.quantity * row.unit_price_cents),
          dueDate: row.due_date,
          status,
          statusLabel: ORDER_STATUS_LABELS[status],
          note: row.note,
          createdAt: row.created_at,
          cancelledAt: row.cancelled_at
        };
      }),
      pagination: pageMeta(total, query.page, query.pageSize)
    });
  });

  app.post('/orders', admin, async (request, reply) => {
    const key = requireIdempotencyKey(request);
    const input = validate(createOrderSchema, request.body);
    const actor = request.auth!.user;

    const result = runIdempotent(
      db,
      { actorId: actor.id, operation: 'order.create', key, payload: input },
      () => {
        if (input.dueDate < businessDate()) {
          throw errors.validation('交期不能早于今天（北京时间）', [
            { path: 'dueDate', message: '请选择今天或之后的日期' }
          ]);
        }
        if (input.item.partId) {
          const part = db.get<{ active: number }>('SELECT active FROM parts WHERE id = ?', input.item.partId);
          if (!part) throw errors.validation('配件不存在', [{ path: 'item.partId', message: '请选择有效配件' }]);
          if (part.active !== 1) throw errors.validation('配件已停用', [{ path: 'item.partId', message: '配件已停用' }]);
        }
        const now = nowIso();
        const customer = input.customerId
          ? (() => {
              const found = db.get<{ id: string; name: string; active: number }>(
                'SELECT id, name, active FROM customers WHERE id = ?',
                input.customerId
              );
              if (!found) throw errors.validation('客户不存在', [{ path: 'customerId', message: '请选择有效客户' }]);
              if (found.active !== 1) {
                throw errors.validation('客户已停用，不能新建订单', [{ path: 'customerId', message: '客户已停用' }]);
              }
              return { id: found.id, name: found.name, auto: false };
            })()
          : (() => {
              const created = ensureCustomer(db, String(input.customerName));
              return { id: created.id, name: created.name, auto: created.created };
            })();
        const autoCustomer = customer.auto;
        const customerId = customer.id;
        const customerName = customer.name;
        if (input.item.partId) {
          const part = db.get<{ active: number }>('SELECT active FROM parts WHERE id = ?', input.item.partId);
          if (!part) throw errors.validation('配件不存在', [{ path: 'item.partId', message: '请选择有效配件' }]);
          if (part.active !== 1) throw errors.validation('配件已停用', [{ path: 'item.partId', message: '配件已停用' }]);
        }
        const partId = input.item.partId ?? (input.item.partName?.trim()
          ? ensurePart(db, input.item.partName, input.item.spec).id
          : null);
        const orderId = newId();
        const itemId = newId();
        const orderNo = documentNo(db, 'SO');
        db.run(
          `INSERT INTO orders(id, order_no, customer_id, customer_name, due_date, status, note, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'PENDING_PURCHASE', ?, ?, ?, ?)`,
          orderId,
          orderNo,
          customerId,
          customerName,
          input.dueDate,
          input.note,
          actor.id,
          now,
          now
        );
        db.run(
          `INSERT INTO order_items(id, order_id, part_id, product_name, spec, quantity, unit_price_cents, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          itemId,
          orderId,
          partId,
          input.item.productName,
          input.item.spec,
          input.item.quantity,
          input.item.unitPrice,
          now
        );
        addTimeline(db, {
          orderId,
          eventType: 'ORDER_CREATED',
          actor,
          resourceType: 'ORDER',
          resourceId: orderId,
          quantity: input.item.quantity,
          payload: { orderNo, productName: input.item.productName }
        });
        writeAudit(db, {
          requestId: request.id,
          actor,
          action: 'ORDER_CREATE',
          resourceType: 'ORDER',
          resourceId: orderId,
          result: 'SUCCESS',
          after: {
            orderNo,
            customer: customerName,
            customerAutoCreated: autoCustomer,
            dueDate: input.dueDate,
            item: { ...input.item, unitPrice: formatCents(input.item.unitPrice) }
          }
        });
        return {
          data: {
            id: orderId,
            orderNo,
            status: 'PENDING_PURCHASE' as const,
            statusLabel: ORDER_STATUS_LABELS.PENDING_PURCHASE
          },
          status: 201,
          businessId: orderId
        };
      }
    );
    reply.header('Idempotent-Replayed', String(result.replayed));
    return ok(reply, request, result.data, result.replayed ? 200 : result.status);
  });

  app.post('/orders/batch/confirm-shipment', admin, async (request, reply) => {
    const key = requireIdempotencyKey(request);
    const input = validate(batchConfirmSchema, request.body);
    const actor = request.auth!.user;

    const result = runIdempotent(
      db,
      { actorId: actor.id, operation: 'order.batch.confirm-shipment', key, payload: input },
      () => {
        const now = nowIso();
        const failures: Array<{ orderId: string; orderNo: string; reason: string }> = [];
        const eligible: Array<{ order: ReturnType<typeof getOrderOrThrow>; packed: number; itemQty: number }> = [];
        for (const orderId of input.orderIds) {
          const order = getOrderOrThrow(db, orderId);
          const status = effectiveStatus(order);
          if (status !== 'PACKING') {
            failures.push({ orderId, orderNo: order.order_no, reason: `当前状态为${ORDER_STATUS_LABELS[status]}` });
            continue;
          }
          const packed = getPacking(db, orderId).reduce((sum, row) => sum + row.quantity, 0);
          const itemQty = getSingleItemOrThrow(db, orderId).quantity;
          if (packed < itemQty) {
            failures.push({ orderId, orderNo: order.order_no, reason: `已包装 ${packed}/${itemQty}，未达到应交量` });
            continue;
          }
          eligible.push({ order, packed, itemQty });
        }
        if (failures.length > 0) {
          throw errors.conflict('批量确认发货失败：存在不满足条件的订单，未执行任何变更', { orders: failures });
        }
        for (const { order } of eligible) {
          db.run('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?', 'SHIPPING', now, order.id);
          addTimeline(db, {
            orderId: order.id,
            eventType: 'SHIPMENT_TRIGGERED',
            actor,
            resourceType: 'ORDER',
            resourceId: order.id
          });
          writeAudit(db, {
            requestId: request.id,
            actor,
            action: 'ORDER_BATCH_CONFIRM_SHIPMENT',
            resourceType: 'ORDER',
            resourceId: order.id,
            result: 'SUCCESS',
            before: { status: order.status },
            after: { status: 'SHIPPING', batchSize: eligible.length }
          });
        }
        return {
          data: {
            count: eligible.length,
            orderIds: eligible.map(({ order }) => order.id),
            message: `已批量确认 ${eligible.length} 张订单发货`
          },
          businessId: null
        };
      }
    );
    reply.header('Idempotent-Replayed', String(result.replayed));
    return ok(reply, request, result.data, result.replayed ? 200 : result.status);
  });

  app.post('/orders/:id/cancel', admin, async (request, reply) => {
    const { id: orderId } = validate(idParam, request.params);
    const key = requireIdempotencyKey(request);
    const input = validate(cancelSchema, request.body);
    const actor = request.auth!.user;

    const result = runIdempotent(
      db,
      { actorId: actor.id, operation: 'order.cancel', key, payload: { orderId, reason: input.reason } },
      () => {
        const order = getOrderOrThrow(db, orderId);
        if (order.cancelled_at) throw errors.conflict('该订单已经撤销，不能重复撤销');
        if (order.status !== 'PENDING_PURCHASE') {
          throw errors.invalidState('只有尚未采购的待采购订单可以撤销', {
            currentStatus: effectiveStatus(order),
            statusLabel: ORDER_STATUS_LABELS[effectiveStatus(order)]
          });
        }
        const purchase = db.get<{ id: string }>('SELECT id FROM purchase_orders WHERE order_id = ?', orderId);
        const production = getProductions(db, orderId);
        if (purchase || production.length > 0) {
          throw errors.conflict('订单已经进入采购或生产，不能撤销；请保留记录并按人工流程处理');
        }
        const deadline = cancelDeadline(order.created_at);
        if (Date.now() > Date.parse(deadline)) {
          throw errors.conflict('订单创建已超过 12 小时，不能撤销', {
            code: 'CANCEL_WINDOW_EXPIRED',
            deadline
          });
        }
        const now = nowIso();
        db.run(
          `UPDATE orders SET cancelled_at = ?, cancelled_by = ?, cancel_reason = ?, updated_at = ?
           WHERE id = ? AND cancelled_at IS NULL`,
          now,
          actor.id,
          input.reason,
          now,
          orderId
        );
        addTimeline(db, {
          orderId,
          eventType: 'ORDER_CANCELLED',
          actor,
          resourceType: 'ORDER',
          resourceId: orderId,
          payload: { reason: input.reason, deadline }
        });
        writeAudit(db, {
          requestId: request.id,
          actor,
          action: 'ORDER_CANCEL',
          resourceType: 'ORDER',
          resourceId: orderId,
          result: 'SUCCESS',
          before: { status: order.status, cancelledAt: null },
          after: { status: 'CANCELLED', cancelledAt: now, reason: input.reason }
        });
        return {
          data: { orderId, status: 'CANCELLED', cancelledAt: now, reason: input.reason },
          businessId: orderId
        };
      }
    );
    reply.header('Idempotent-Replayed', String(result.replayed));
    return ok(reply, request, result.data, result.replayed ? 200 : result.status);
  });

  app.get('/orders/:id', admin, async (request, reply) => {
    const { id } = validate(idParam, request.params);
    const order = getOrderOrThrow(db, id);
    return ok(reply, request, {
      ...getOrderDetail(db, id),
      summary: buildOperationSummary(db, order),
      profit: buildProfit(db, order),
      stages: buildStages(db, order)
    });
  });

  app.get('/orders/:id/timeline', admin, async (request, reply) => {
    const { id } = validate(idParam, request.params);
    return ok(reply, request, { events: getTimeline(db, id) });
  });

  app.get('/orders/:id/profit', admin, async (request, reply) => {
    const { id } = validate(idParam, request.params);
    return ok(reply, request, buildProfit(db, getOrderOrThrow(db, id)));
  });

  app.get('/orders/:id/operation-summary', admin, async (request, reply) => {
    const { id } = validate(idParam, request.params);
    return ok(reply, request, buildOperationSummary(db, getOrderOrThrow(db, id)));
  });

  app.patch('/orders/:id/status', admin, async () => {
    throw errors.feature('不支持通用状态修改接口；请通过采购、到货、生产、质检、包装、发货等受控动作推进状态');
  });

  app.delete('/orders/:id', admin, async () => {
    throw errors.feature('V1 不支持删除业务订单；录入错误请保留记录并按人工流程处理');
  });

  app.get('/order-statuses', admin, async (request, reply) =>
    ok(reply, request, {
      statuses: Object.entries(ORDER_STATUS_LABELS).map(([value, label]) => ({ value, label }))
    })
  );
}
