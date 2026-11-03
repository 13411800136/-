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
import {
  buildOperationSummary,
  buildProfit,
  buildStages,
  getOrderDetail,
  getOrderOrThrow,
  getTimeline,
  ORDER_STATUS_LABELS,
  type OrderStatus
} from './service.js';

const createOrderSchema = z.object({
  customerId: z.string().min(1, '请选择客户'),
  dueDate: dateInput,
  note: shortText(300, '备注').default(''),
  item: z.object({
    partId: z.string().min(1).optional(),
    productName: requiredText(80, '产品名称'),
    spec: shortText(120, '规格').default(''),
    quantity: positiveInt,
    unitPrice: moneyInput
  })
});

const listQuery = pageQuery.extend({
  status: z
    .enum(['PENDING_PURCHASE', 'PURCHASING', 'IN_PRODUCTION', 'PENDING_QC', 'QC_DONE', 'PACKING', 'SHIPPING', 'COMPLETED'])
    .optional(),
  keyword: z.string().trim().max(80).optional()
});

export async function registerOrderRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { db, config } = ctx;
  const authenticate = createAuthenticate(db, config);
  const admin = { preHandler: [authenticate, requireAdmin] };

  app.get('/orders', admin, async (request, reply) => {
    const query = validate(listQuery, request.query);
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (query.status) {
      where.push('o.status = ?');
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
      item_id: string;
      product_name: string;
      spec: string;
      quantity: number;
      unit_price_cents: number;
    }>(
      `SELECT o.id, o.order_no, o.customer_name, o.due_date, o.status, o.note, o.created_at,
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
      items: rows.map((row) => ({
        id: row.id,
        orderNo: row.order_no,
        customerName: row.customer_name,
        productName: row.product_name,
        spec: row.spec,
        quantity: row.quantity,
        unitPrice: formatCents(row.unit_price_cents),
        amount: formatCents(row.quantity * row.unit_price_cents),
        dueDate: row.due_date,
        status: row.status,
        statusLabel: ORDER_STATUS_LABELS[row.status],
        note: row.note,
        createdAt: row.created_at
      })),
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
        const customer = db.get<{ id: string; name: string; active: number }>(
          'SELECT id, name, active FROM customers WHERE id = ?',
          input.customerId
        );
        if (!customer) throw errors.validation('客户不存在', [{ path: 'customerId', message: '请选择有效客户' }]);
        if (customer.active !== 1) throw errors.validation('客户已停用，不能新建订单', [{ path: 'customerId', message: '客户已停用' }]);
        if (input.item.partId) {
          const part = db.get<{ active: number }>('SELECT active FROM parts WHERE id = ?', input.item.partId);
          if (!part) throw errors.validation('配件不存在', [{ path: 'item.partId', message: '请选择有效配件' }]);
          if (part.active !== 1) throw errors.validation('配件已停用', [{ path: 'item.partId', message: '配件已停用' }]);
        }
        const orderId = newId();
        const itemId = newId();
        const now = nowIso();
        const orderNo = documentNo(db, 'SO');
        db.run(
          `INSERT INTO orders(id, order_no, customer_id, customer_name, due_date, status, note, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'PENDING_PURCHASE', ?, ?, ?, ?)`,
          orderId,
          orderNo,
          customer.id,
          customer.name,
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
          input.item.partId ?? null,
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
            customer: customer.name,
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
