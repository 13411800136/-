import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { newId } from '../../common/crypto.js';
import { errors } from '../../common/errors.js';
import { addTimeline, notifyAdmins } from '../../common/events.js';
import { writeAudit } from '../../common/audit.js';
import { createAuthenticate, requireAdmin, requireRole } from '../../common/auth.js';
import { ok } from '../../common/http.js';
import { requireIdempotencyKey, runIdempotent } from '../../common/idempotency.js';
import { nowIso } from '../../common/time.js';
import { idParam, positiveInt, shortText, validate } from '../../common/validation.js';
import type { AppContext } from '../../common/types.js';
import {
  assertOrderStatus,
  getOrderOrThrow,
  getPacking,
  getShipments,
  getSingleItemOrThrow
} from '../orders/service.js';

const shipmentSchema = z.object({
  quantity: positiveInt,
  carrier: shortText(50, '承运方').default(''),
  trackingNo: shortText(60, '运单号').default('')
});

export async function registerShippingRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { db, config } = ctx;
  const authenticate = createAuthenticate(db, config);
  const admin = { preHandler: [authenticate, requireAdmin] };
  const logistics = { preHandler: [authenticate, requireRole('LOGISTICS')] };

  app.get('/tablet/logistics/queue', logistics, async (request, reply) => {
    const arrivals = db.all<{
      order_id: string;
      order_no: string;
      product_name: string;
      spec: string;
      purchase_item_id: string;
      part_name: string;
      purchased_qty: number;
      arrived_qty: number;
      due_date: string;
    }>(
      `SELECT o.id AS order_id, o.order_no, oi.product_name, oi.spec, pi.id AS purchase_item_id,
              pi.part_name, pi.quantity AS purchased_qty, o.due_date,
              COALESCE((SELECT SUM(a.quantity) FROM arrival_records a
                        WHERE a.purchase_item_id = pi.id), 0) AS arrived_qty
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       JOIN purchase_orders po ON po.order_id = o.id
       JOIN purchase_items pi ON pi.purchase_order_id = po.id
       WHERE o.status = 'PURCHASING'
         AND COALESCE((SELECT SUM(a.quantity) FROM arrival_records a
                       WHERE a.purchase_item_id = pi.id), 0) < pi.quantity
       ORDER BY o.due_date, o.created_at`
    );
    const shipments = db.all<{
      order_id: string;
      order_no: string;
      product_name: string;
      spec: string;
      ordered_qty: number;
      packed_qty: number;
      shipped_qty: number;
      due_date: string;
    }>(
      `SELECT o.id AS order_id, o.order_no, oi.product_name, oi.spec, oi.quantity AS ordered_qty, o.due_date,
              COALESCE((SELECT SUM(p.quantity) FROM packing_records p WHERE p.order_id = o.id), 0) AS packed_qty,
              COALESCE((SELECT SUM(s.quantity) FROM shipment_records s WHERE s.order_id = o.id), 0) AS shipped_qty
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       WHERE o.status = 'SHIPPING'
       ORDER BY o.due_date, o.created_at`
    );
    return ok(reply, request, {
      arrivals: arrivals.map((row) => ({
        orderId: row.order_id,
        orderNo: row.order_no,
        productName: row.product_name,
        spec: row.spec,
        purchaseItemId: row.purchase_item_id,
        partName: row.part_name,
        purchasedQty: row.purchased_qty,
        arrivedQty: row.arrived_qty,
        remainingQty: Math.max(0, row.purchased_qty - row.arrived_qty),
        dueDate: row.due_date
      })),
      shipments: shipments
        .filter((row) => row.packed_qty > row.shipped_qty)
        .map((row) => ({
          orderId: row.order_id,
          orderNo: row.order_no,
          productName: row.product_name,
          spec: row.spec,
          orderedQty: row.ordered_qty,
          packedQty: row.packed_qty,
          shippedQty: row.shipped_qty,
          remainingQty: Math.max(0, Math.min(row.packed_qty - row.shipped_qty, row.ordered_qty - row.shipped_qty)),
          dueDate: row.due_date
        }))
    });
  });

  app.get('/tablet/logistics/history', logistics, async (request, reply) => {
    const arrivals = db.all<{
      id: string;
      order_id: string;
      order_no: string;
      product_name: string;
      spec: string;
      quantity: number;
      note: string;
      operator_name: string;
      created_at: string;
    }>(
      `SELECT a.id, o.id AS order_id, o.order_no, oi.product_name, oi.spec, a.quantity, a.note,
              u.display_name AS operator_name, a.created_at
       FROM arrival_records a
       JOIN purchase_items pi ON pi.id = a.purchase_item_id
       JOIN purchase_orders po ON po.id = pi.purchase_order_id
       JOIN orders o ON o.id = po.order_id
       JOIN order_items oi ON oi.order_id = o.id
       JOIN users u ON u.id = a.operator_id
       ORDER BY a.created_at DESC, a.id DESC LIMIT 100`
    );
    const shipments = db.all<{
      id: string;
      order_id: string;
      order_no: string;
      product_name: string;
      spec: string;
      quantity: number;
      carrier: string;
      tracking_no: string;
      operator_name: string;
      created_at: string;
    }>(
      `SELECT s.id, o.id AS order_id, o.order_no, oi.product_name, oi.spec, s.quantity,
              s.carrier, s.tracking_no, u.display_name AS operator_name, s.created_at
       FROM shipment_records s
       JOIN orders o ON o.id = s.order_id
       JOIN order_items oi ON oi.id = s.order_item_id
       JOIN users u ON u.id = s.operator_id
       ORDER BY s.created_at DESC, s.id DESC LIMIT 100`
    );
    return ok(reply, request, {
      arrivals: arrivals.map((row) => ({
        id: row.id,
        type: 'ARRIVAL',
        orderId: row.order_id,
        orderNo: row.order_no,
        productName: row.product_name,
        spec: row.spec,
        quantity: row.quantity,
        note: row.note,
        operatorName: row.operator_name,
        createdAt: row.created_at
      })),
      shipments: shipments.map((row) => ({
        id: row.id,
        type: 'SHIPMENT',
        orderId: row.order_id,
        orderNo: row.order_no,
        productName: row.product_name,
        spec: row.spec,
        quantity: row.quantity,
        carrier: row.carrier,
        trackingNo: row.tracking_no,
        operatorName: row.operator_name,
        createdAt: row.created_at
      }))
    });
  });

  app.post('/orders/:id/trigger-shipment', admin, async (request, reply) => {
    const { id: orderId } = validate(idParam, request.params);
    const key = requireIdempotencyKey(request);
    const actor = request.auth!.user;

    const result = runIdempotent(
      db,
      { actorId: actor.id, operation: 'shipment.trigger', key, payload: { orderId } },
      () => {
        const order = getOrderOrThrow(db, orderId);
        assertOrderStatus(order, ['PACKING'], '只有包装中的订单可以触发发货');
        const item = getSingleItemOrThrow(db, orderId);
        const packed = getPacking(db, orderId).reduce((sum, row) => sum + row.quantity, 0);
        const shipped = getShipments(db, orderId).reduce((sum, row) => sum + row.quantity, 0);
        if (packed < item.quantity) {
          throw errors.invalidState('包装数量尚未达到订单应交数量，不能触发发货', {
            ordered: item.quantity,
            packed
          });
        }
        if (packed <= shipped) throw errors.invalidState('没有已包装待发货的数量');
        db.run('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?', 'SHIPPING', nowIso(), orderId);
        addTimeline(db, {
          orderId,
          eventType: 'SHIPMENT_TRIGGERED',
          actor,
          resourceType: 'ORDER',
          resourceId: orderId,
          quantity: packed - shipped
        });
        writeAudit(db, {
          requestId: request.id,
          actor,
          action: 'SHIPMENT_TRIGGER',
          resourceType: 'ORDER',
          resourceId: orderId,
          result: 'SUCCESS',
          before: { status: order.status },
          after: { status: 'SHIPPING', packed, shipped }
        });
        return { data: { orderId, status: 'SHIPPING' }, businessId: orderId };
      }
    );
    reply.header('Idempotent-Replayed', String(result.replayed));
    return ok(reply, request, result.data, result.replayed ? 200 : result.status);
  });

  app.post('/orders/:id/shipments', logistics, async (request, reply) => {
    const { id: orderId } = validate(idParam, request.params);
    const key = requireIdempotencyKey(request);
    const input = validate(shipmentSchema, request.body);
    const actor = request.auth!.user;

    const result = runIdempotent(
      db,
      { actorId: actor.id, operation: 'shipment.record', key, payload: { orderId, ...input } },
      () => {
        const order = getOrderOrThrow(db, orderId);
        if (order.status !== 'SHIPPING') throw errors.invalidState('订单不在待发货状态，不能登记发货');
        const item = getSingleItemOrThrow(db, orderId);
        const packed = getPacking(db, orderId).reduce((sum, row) => sum + row.quantity, 0);
        const shipped = getShipments(db, orderId).reduce((sum, row) => sum + row.quantity, 0);
        const available = Math.min(packed - shipped, item.quantity - shipped);
        if (input.quantity > available) {
          throw errors.quantity('发货数量超过可发货剩余或应交剩余', {
            packed,
            shipped,
            available: Math.max(0, available)
          });
        }
        const shipmentId = newId();
        const now = nowIso();
        db.run(
          `INSERT INTO shipment_records(id, order_id, order_item_id, quantity, operator_id, carrier, tracking_no, request_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          shipmentId,
          orderId,
          item.id,
          input.quantity,
          actor.id,
          input.carrier,
          input.trackingNo,
          request.id,
          now
        );
        const totalShipped = shipped + input.quantity;
        addTimeline(db, {
          orderId,
          eventType: 'SHIPMENT_RECORDED',
          actor,
          resourceType: 'SHIPMENT',
          resourceId: shipmentId,
          quantity: input.quantity,
          payload: { shippedQty: totalShipped, orderedQty: item.quantity }
        });
        const completed = totalShipped === item.quantity;
        if (completed) {
          db.run('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?', 'COMPLETED', now, orderId);
          addTimeline(db, {
            orderId,
            eventType: 'ORDER_COMPLETED',
            actor,
            resourceType: 'ORDER',
            resourceId: orderId,
            quantity: totalShipped
          });
        }
        notifyAdmins(db, {
          eventType: completed ? 'ORDER_COMPLETED' : 'SHIPMENT_RECORDED',
          title: completed ? '订单已完成交付' : '物流登记发货',
          body: completed
            ? `${order.order_no}：已发货 ${totalShipped}/${item.quantity}，订单完成。`
            : `${order.order_no}：本次发货 ${input.quantity}，累计 ${totalShipped}/${item.quantity}。`,
          resourceType: 'ORDER',
          resourceId: orderId,
          dedupeKey: `shipment:${shipmentId}`
        });
        writeAudit(db, {
          requestId: request.id,
          actor,
          action: 'SHIPMENT_RECORD',
          resourceType: 'SHIPMENT',
          resourceId: shipmentId,
          result: 'SUCCESS',
          before: { status: 'SHIPPING', shipped },
          after: {
            status: completed ? 'COMPLETED' : 'SHIPPING',
            quantity: input.quantity,
            shippedQty: totalShipped
          }
        });
        return {
          data: {
            id: shipmentId,
            shippedQty: totalShipped,
            orderedQty: item.quantity,
            completed,
            orderStatus: completed ? 'COMPLETED' : 'SHIPPING'
          },
          status: 201,
          businessId: shipmentId
        };
      }
    );
    reply.header('Idempotent-Replayed', String(result.replayed));
    return ok(reply, request, result.data, result.replayed ? 200 : result.status);
  });

  app.get('/orders/:id/shipping-summary', admin, async (request, reply) => {
    const { id } = validate(idParam, request.params);
    const order = getOrderOrThrow(db, id);
    const item = getSingleItemOrThrow(db, id);
    const packed = getPacking(db, id).reduce((sum, row) => sum + row.quantity, 0);
    const shipped = getShipments(db, id).reduce((sum, row) => sum + row.quantity, 0);
    return ok(reply, request, {
      status: order.status,
      orderedQty: item.quantity,
      packedQty: packed,
      shippedQty: shipped,
      remainingToShip: Math.max(0, Math.min(packed - shipped, item.quantity - shipped)),
      shipments: getShipments(db, id).map((row) => ({
        id: row.id,
        quantity: row.quantity,
        carrier: row.carrier,
        trackingNo: row.tracking_no,
        operatorName: row.operator_name,
        createdAt: row.created_at
      }))
    });
  });
}
