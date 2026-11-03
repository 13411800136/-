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
import { documentNo } from '../../common/sequence.js';
import { nowIso } from '../../common/time.js';
import {
  idParam,
  moneyInput,
  positiveInt,
  shortText,
  validate
} from '../../common/validation.js';
import type { AppContext } from '../../common/types.js';
import {
  assertOrderStatus,
  getOrderOrThrow,
  getPurchase,
  type ArrivalRow,
  type OrderRow,
  type PurchaseItemRow,
  type PurchaseOrderRow
} from '../orders/service.js';

const createPurchaseSchema = z.object({
  supplierId: z.string().min(1, '请选择供应商'),
  item: z.object({
    partId: z.string().min(1, '请选择配件'),
    quantity: positiveInt,
    unitPrice: moneyInput
  })
});

const arrivalSchema = z.object({
  quantity: positiveInt,
  note: shortText(200, '备注').default('')
});

interface PurchaseContext {
  purchase: PurchaseOrderRow;
  item: PurchaseItemRow;
  order: OrderRow;
  arrivedQty: number;
}

function loadPurchaseContext(db: AppContext['db'], purchaseItemId: string): PurchaseContext {
  const item = db.get<PurchaseItemRow>('SELECT * FROM purchase_items WHERE id = ?', purchaseItemId);
  if (!item) throw errors.notFound('采购明细不存在');
  const purchase = db.get<PurchaseOrderRow>('SELECT * FROM purchase_orders WHERE id = ?', item.purchase_order_id);
  if (!purchase) throw errors.notFound('采购单不存在');
  const order = getOrderOrThrow(db, purchase.order_id);
  const arrived = db.get<{ qty: number | null }>(
    'SELECT COALESCE(SUM(quantity), 0) AS qty FROM arrival_records WHERE purchase_item_id = ?',
    item.id
  );
  return { purchase, item, order, arrivedQty: arrived?.qty ?? 0 };
}

export async function registerPurchaseRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { db, config } = ctx;
  const authenticate = createAuthenticate(db, config);
  const admin = { preHandler: [authenticate, requireAdmin] };
  const logistics = { preHandler: [authenticate, requireRole('LOGISTICS')] };

  app.post('/orders/:id/purchase-orders', admin, async (request, reply) => {
    const { id: orderId } = validate(idParam, request.params);
    const key = requireIdempotencyKey(request);
    const input = validate(createPurchaseSchema, request.body);
    const actor = request.auth!.user;

    const result = runIdempotent(
      db,
      {
        actorId: actor.id,
        operation: 'purchase.create',
        key,
        payload: { orderId, ...input }
      },
      () => {
        const order = getOrderOrThrow(db, orderId);
        assertOrderStatus(order, ['PENDING_PURCHASE', 'PURCHASING'], '当前订单状态不能创建采购单');
        const existing = db.get<{ id: string }>('SELECT id FROM purchase_orders WHERE order_id = ?', orderId);
        if (existing) throw errors.conflict('该订单已存在采购单；当前最低实现为一单一采购单');
        const supplier = db.get<{ id: string; name: string; active: number }>(
          'SELECT id, name, active FROM suppliers WHERE id = ?',
          input.supplierId
        );
        if (!supplier) throw errors.validation('供应商不存在', [{ path: 'supplierId', message: '请选择有效供应商' }]);
        if (supplier.active !== 1) throw errors.validation('供应商已停用，不能新建采购', [{ path: 'supplierId', message: '供应商已停用' }]);
        const part = db.get<{ id: string; name: string; spec: string; active: number }>(
          'SELECT id, name, spec, active FROM parts WHERE id = ?',
          input.item.partId
        );
        if (!part) throw errors.validation('配件不存在', [{ path: 'item.partId', message: '请选择有效配件' }]);
        if (part.active !== 1) throw errors.validation('配件已停用', [{ path: 'item.partId', message: '配件已停用' }]);
        const purchaseId = newId();
        const itemId = newId();
        const now = nowIso();
        const purchaseNo = documentNo(db, 'PO');
        db.run(
          `INSERT INTO purchase_orders(id, order_id, purchase_no, supplier_id, supplier_name, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          purchaseId,
          orderId,
          purchaseNo,
          supplier.id,
          supplier.name,
          actor.id,
          now
        );
        db.run(
          `INSERT INTO purchase_items(id, purchase_order_id, part_id, part_name, spec, quantity, unit_price_cents, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          itemId,
          purchaseId,
          part.id,
          part.name,
          part.spec,
          input.item.quantity,
          input.item.unitPrice,
          now
        );
        db.run('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?', 'PURCHASING', now, orderId);
        addTimeline(db, {
          orderId,
          eventType: 'PURCHASE_CREATED',
          actor,
          resourceType: 'PURCHASE_ORDER',
          resourceId: purchaseId,
          payload: { purchaseNo, supplier: supplier.name, part: part.name }
        });
        writeAudit(db, {
          requestId: request.id,
          actor,
          action: 'PURCHASE_CREATE',
          resourceType: 'PURCHASE_ORDER',
          resourceId: purchaseId,
          result: 'SUCCESS',
          before: { orderStatus: order.status },
          after: {
            orderStatus: 'PURCHASING',
            purchaseNo,
            supplier: supplier.name,
            part: part.name,
            quantity: input.item.quantity,
            unitPrice: formatCents(input.item.unitPrice)
          }
        });
        return {
          data: { id: purchaseId, purchaseNo, purchaseItemId: itemId, status: 'PURCHASING' },
          status: 201,
          businessId: purchaseId
        };
      }
    );
    reply.header('Idempotent-Replayed', String(result.replayed));
    return ok(reply, request, result.data, result.replayed ? 200 : result.status);
  });

  app.get('/purchase-orders/:id', admin, async (request, reply) => {
    const { id } = validate(idParam, request.params);
    const purchase = db.get<PurchaseOrderRow>('SELECT * FROM purchase_orders WHERE id = ?', id);
    if (!purchase) throw errors.notFound('采购单不存在');
    const item = db.get<PurchaseItemRow>('SELECT * FROM purchase_items WHERE purchase_order_id = ?', id);
    const arrivals = item
      ? db.all<ArrivalRow>(
          `SELECT a.*, u.display_name AS operator_name FROM arrival_records a
           JOIN users u ON u.id = a.operator_id WHERE a.purchase_item_id = ? ORDER BY a.created_at`,
          item.id
        )
      : [];
    return ok(reply, request, {
      purchase: {
        id: purchase.id,
        purchaseNo: purchase.purchase_no,
        orderId: purchase.order_id,
        supplier: { id: purchase.supplier_id, name: purchase.supplier_name },
        createdAt: purchase.created_at
      },
      item: item
        ? {
            id: item.id,
            partName: item.part_name,
            spec: item.spec,
            quantity: item.quantity,
            unitPrice: formatCents(item.unit_price_cents),
            amount: formatCents(item.quantity * item.unit_price_cents),
            arrivedQty: arrivals.reduce((sum, arrival) => sum + arrival.quantity, 0),
            arrivals: arrivals.map((arrival) => ({
              id: arrival.id,
              quantity: arrival.quantity,
              operatorName: arrival.operator_name,
              note: arrival.note,
              createdAt: arrival.created_at
            }))
          }
        : null
    });
  });

  app.get('/orders/:id/arrivals', admin, async (request, reply) => {
    const { id } = validate(idParam, request.params);
    getOrderOrThrow(db, id);
    const purchase = getPurchase(db, id);
    return ok(reply, request, {
      purchaseItemId: purchase?.item?.id ?? null,
      purchasedQty: purchase?.item?.quantity ?? 0,
      arrivedQty: purchase?.arrivedQty ?? 0,
      arrivals:
        purchase?.arrivals.map((arrival) => ({
          id: arrival.id,
          quantity: arrival.quantity,
          operatorName: arrival.operator_name,
          note: arrival.note,
          createdAt: arrival.created_at
        })) ?? []
    });
  });

  app.post('/purchase-items/:id/arrivals', logistics, async (request, reply) => {
    const { id: purchaseItemId } = validate(idParam, request.params);
    const key = requireIdempotencyKey(request);
    const input = validate(arrivalSchema, request.body);
    const actor = request.auth!.user;
    if (actor.role !== 'LOGISTICS') throw errors.forbidden('只有物流角色可以登记到货');

    const result = runIdempotent(
      db,
      {
        actorId: actor.id,
        operation: 'arrival.create',
        key,
        payload: { purchaseItemId, ...input }
      },
      () => {
        // 在事务内重新读取，确保累计判断与写入一致。
        const context = loadPurchaseContext(db, purchaseItemId);
        if (context.order.status !== 'PURCHASING') {
          throw errors.invalidState('当前订单不在采购中，不能登记到货');
        }
        const next = context.arrivedQty + input.quantity;
        if (next > context.item.quantity) {
          throw errors.quantity('到货数量超过采购数量', {
            purchased: context.item.quantity,
            arrived: context.arrivedQty,
            remaining: context.item.quantity - context.arrivedQty
          });
        }
        const arrivalId = newId();
        const now = nowIso();
        db.run(
          `INSERT INTO arrival_records(id, purchase_item_id, quantity, operator_id, note, request_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          arrivalId,
          purchaseItemId,
          input.quantity,
          actor.id,
          input.note,
          request.id,
          now
        );
        addTimeline(db, {
          orderId: context.order.id,
          eventType: 'ARRIVAL_RECORDED',
          actor,
          resourceType: 'ARRIVAL',
          resourceId: arrivalId,
          quantity: input.quantity,
          payload: { arrivedQty: next, purchasedQty: context.item.quantity }
        });
        notifyAdmins(db, {
          eventType: 'ARRIVAL_RECORDED',
          title: '物流登记到货',
          body: `${context.order.order_no}：本次到货 ${input.quantity} 件，累计 ${next}/${context.item.quantity}。`,
          resourceType: 'ORDER',
          resourceId: context.order.id,
          dedupeKey: `arrival:${arrivalId}`
        });
        writeAudit(db, {
          requestId: request.id,
          actor,
          action: 'ARRIVAL_CREATE',
          resourceType: 'ARRIVAL',
          resourceId: arrivalId,
          result: 'SUCCESS',
          after: { quantity: input.quantity, arrivedQty: next, purchasedQty: context.item.quantity }
        });
        return {
          data: {
            id: arrivalId,
            arrivedQty: next,
            purchasedQty: context.item.quantity,
            remainingQty: context.item.quantity - next,
            fullyArrived: next === context.item.quantity
          },
          status: 201,
          businessId: arrivalId
        };
      }
    );
    reply.header('Idempotent-Replayed', String(result.replayed));
    return ok(reply, request, result.data, result.replayed ? 200 : result.status);
  });
}
