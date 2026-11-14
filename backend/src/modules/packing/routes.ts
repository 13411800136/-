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
  getQcRecords,
  getShipments,
  getSingleItemOrThrow
} from '../orders/service.js';

const packingSchema = z.object({
  quantity: positiveInt,
  note: shortText(200, '备注').default('')
});

interface PackingQueueRow {
  order_id: string;
  order_no: string;
  product_name: string;
  spec: string;
  ordered_qty: number;
  released_qty: number;
  packed_qty: number;
  due_date: string;
}

function releasedQty(db: AppContext['db'], orderId: string): number {
  return getQcRecords(db, orderId)
    .filter((record) => record.decision !== null)
    .reduce((sum, record) => sum + record.qualified_qty, 0);
}

export async function registerPackingRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { db, config } = ctx;
  const authenticate = createAuthenticate(db, config);
  const admin = { preHandler: [authenticate, requireAdmin] };
  const packingRole = { preHandler: [authenticate, requireRole('PACKING')] };

  app.post('/orders/:id/dispatch-packing', admin, async (request, reply) => {
    const { id: orderId } = validate(idParam, request.params);
    const key = requireIdempotencyKey(request);
    const actor = request.auth!.user;

    const result = runIdempotent(
      db,
      { actorId: actor.id, operation: 'packing.dispatch', key, payload: { orderId } },
      () => {
        const order = getOrderOrThrow(db, orderId);
        assertOrderStatus(order, ['QC_DONE'], '只有质检已放行的订单可以下发包装');
        const released = releasedQty(db, orderId);
        const packed = getPacking(db, orderId).reduce((sum, row) => sum + row.quantity, 0);
        if (released <= packed) throw errors.invalidState('没有可包装的放行数量');
        db.run('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?', 'PACKING', nowIso(), orderId);
        addTimeline(db, {
          orderId,
          eventType: 'PACKING_DISPATCHED',
          actor,
          resourceType: 'ORDER',
          resourceId: orderId,
          quantity: released - packed
        });
        writeAudit(db, {
          requestId: request.id,
          actor,
          action: 'PACKING_DISPATCH',
          resourceType: 'ORDER',
          resourceId: orderId,
          result: 'SUCCESS',
          before: { status: order.status },
          after: { status: 'PACKING', released, packed }
        });
        return { data: { orderId, status: 'PACKING' }, businessId: orderId };
      }
    );
    reply.header('Idempotent-Replayed', String(result.replayed));
    return ok(reply, request, result.data, result.replayed ? 200 : result.status);
  });

  app.get('/tablet/packing/queue', packingRole, async (request, reply) => {
    const rows = db.all<PackingQueueRow>(
      `SELECT o.id AS order_id, o.order_no, oi.product_name, oi.spec, oi.quantity AS ordered_qty, o.due_date,
              COALESCE((SELECT SUM(q.qualified_qty) FROM qc_records q
                        JOIN production_orders p ON p.id = q.production_order_id
                        WHERE p.order_id = o.id AND q.decision = 'PASS'), 0) AS released_qty,
              COALESCE((SELECT SUM(r.quantity) FROM packing_records r WHERE r.order_id = o.id), 0) AS packed_qty
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       WHERE o.status = 'PACKING'
         AND COALESCE((SELECT SUM(r.quantity) FROM packing_records r WHERE r.order_id = o.id), 0) < oi.quantity
       ORDER BY o.due_date, o.created_at`
    );
    return ok(reply, request, {
      tasks: rows.map((row) => ({
        orderId: row.order_id,
        orderNo: row.order_no,
        productName: row.product_name,
        spec: row.spec,
        orderedQty: row.ordered_qty,
        releasedQty: row.released_qty,
        packedQty: row.packed_qty,
        remainingQty: Math.max(0, Math.min(row.released_qty - row.packed_qty, row.ordered_qty - row.packed_qty)),
        dueDate: row.due_date
      }))
    });
  });

  app.get('/tablet/packing/history', packingRole, async (request, reply) => {
    const rows = db.all<{
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
      `SELECT r.id, o.id AS order_id, o.order_no, oi.product_name, oi.spec, r.quantity, r.note,
              u.display_name AS operator_name, r.created_at
       FROM packing_records r
       JOIN orders o ON o.id = r.order_id
       JOIN order_items oi ON oi.id = r.order_item_id
       JOIN users u ON u.id = r.operator_id
       ORDER BY r.created_at DESC, r.id DESC LIMIT 100`
    );
    return ok(reply, request, {
      items: rows.map((row) => ({
        id: row.id,
        orderId: row.order_id,
        orderNo: row.order_no,
        productName: row.product_name,
        spec: row.spec,
        quantity: row.quantity,
        note: row.note,
        operatorName: row.operator_name,
        createdAt: row.created_at
      }))
    });
  });

  app.post('/orders/:id/packing-records', packingRole, async (request, reply) => {
    const { id: orderId } = validate(idParam, request.params);
    const key = requireIdempotencyKey(request);
    const input = validate(packingSchema, request.body);
    const actor = request.auth!.user;

    const result = runIdempotent(
      db,
      { actorId: actor.id, operation: 'packing.record', key, payload: { orderId, ...input } },
      () => {
        const order = getOrderOrThrow(db, orderId);
        if (order.status !== 'PACKING') throw errors.invalidState('订单不在包装中，不能提交包装记录');
        const item = getSingleItemOrThrow(db, orderId);
        const released = releasedQty(db, orderId);
        const packed = getPacking(db, orderId).reduce((sum, row) => sum + row.quantity, 0);
        const available = Math.min(released - packed, item.quantity - packed);
        if (input.quantity > available) {
          throw errors.quantity('包装数量超过可包装剩余', {
            released,
            packed,
            available: Math.max(0, available)
          });
        }
        const packingId = newId();
        const now = nowIso();
        db.run(
          `INSERT INTO packing_records(id, order_id, order_item_id, quantity, operator_id, note, request_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          packingId,
          orderId,
          item.id,
          input.quantity,
          actor.id,
          input.note,
          request.id,
          now
        );
        addTimeline(db, {
          orderId,
          eventType: 'PACKING_RECORDED',
          actor,
          resourceType: 'PACKING',
          resourceId: packingId,
          quantity: input.quantity,
          payload: { packedQty: packed + input.quantity, releasedQty: released }
        });
        notifyAdmins(db, {
          eventType: 'PACKING_RECORDED',
          title: '包装记录已提交',
          body: `${order.order_no}：本次包装 ${input.quantity}，累计 ${packed + input.quantity}/${item.quantity}。`,
          resourceType: 'ORDER',
          resourceId: orderId,
          dedupeKey: `packing:${packingId}`
        });
        writeAudit(db, {
          requestId: request.id,
          actor,
          action: 'PACKING_RECORD',
          resourceType: 'PACKING',
          resourceId: packingId,
          result: 'SUCCESS',
          after: { quantity: input.quantity, packedQty: packed + input.quantity, releasedQty: released }
        });
        return {
          data: {
            id: packingId,
            packedQty: packed + input.quantity,
            orderedQty: item.quantity,
            remainingQty: Math.max(0, available - input.quantity)
          },
          status: 201,
          businessId: packingId
        };
      }
    );
    reply.header('Idempotent-Replayed', String(result.replayed));
    return ok(reply, request, result.data, result.replayed ? 200 : result.status);
  });

  app.get('/orders/:id/packing-summary', admin, async (request, reply) => {
    const { id } = validate(idParam, request.params);
    getOrderOrThrow(db, id);
    const item = getSingleItemOrThrow(db, id);
    const released = releasedQty(db, id);
    const packed = getPacking(db, id).reduce((sum, row) => sum + row.quantity, 0);
    const shipped = getShipments(db, id).reduce((sum, row) => sum + row.quantity, 0);
    return ok(reply, request, {
      orderedQty: item.quantity,
      releasedQty: released,
      packedQty: packed,
      shippedQty: shipped,
      remainingToPack: Math.max(0, Math.min(released - packed, item.quantity - packed)),
      remainingToShip: Math.max(0, Math.min(packed - shipped, item.quantity - shipped))
    });
  });
}
