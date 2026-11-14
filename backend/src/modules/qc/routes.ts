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
import { idParam, nonNegativeInt, positiveInt, shortText, validate } from '../../common/validation.js';
import type { AppContext } from '../../common/types.js';
import {
  assertOrderStatus,
  getOrderOrThrow,
  getProductions,
  getQcRecords,
  getSingleItemOrThrow
} from '../orders/service.js';

const qcRecordSchema = z.object({
  inspectedQuantity: positiveInt,
  qualifiedQuantity: nonNegativeInt,
  unqualifiedQuantity: nonNegativeInt,
  note: shortText(200, '备注').default('')
});

const decisionSchema = z.object({
  decision: z.enum(['PASS', 'REWORK', 'SCRAP']),
  note: shortText(200, '备注').default('')
});

interface QcQueueRow {
  production_order_id: string;
  order_id: string;
  order_no: string;
  product_name: string;
  spec: string;
  task_quantity: number;
  produced_qty: number;
  process_name: string;
  department_name: string;
  due_date: string;
}

export async function registerQcRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { db, config } = ctx;
  const authenticate = createAuthenticate(db, config);
  const admin = { preHandler: [authenticate, requireAdmin] };
  const qcRole = { preHandler: [authenticate, requireRole('QC')] };

  app.post('/orders/:id/dispatch-qc', admin, async (request, reply) => {
    const { id: orderId } = validate(idParam, request.params);
    const key = requireIdempotencyKey(request);
    const actor = request.auth!.user;

    const result = runIdempotent(
      db,
      { actorId: actor.id, operation: 'qc.dispatch', key, payload: { orderId } },
      () => {
        const order = getOrderOrThrow(db, orderId);
        assertOrderStatus(order, ['IN_PRODUCTION'], '只有生产中的订单可以下发质检');
        const productions = getProductions(db, orderId);
        if (productions.length === 0) throw errors.invalidState('订单没有生产任务，不能下发质检');
        const item = getSingleItemOrThrow(db, orderId);
        const assigned = productions.reduce((sum, task) => sum + task.quantity, 0);
        if (assigned < item.quantity) {
          throw errors.invalidState('生产任务总量尚未覆盖订单应交数量，不能下发质检', {
            ordered: item.quantity,
            assigned
          });
        }
        const incomplete = productions.filter((task) => task.producedQty < task.quantity);
        if (incomplete.length > 0) {
          throw errors.invalidState('生产任务尚未全部完成，不能下发质检', {
            pending: incomplete.map((task) => ({ id: task.id, produced: task.producedQty, quantity: task.quantity }))
          });
        }
        const pendingDecision = getQcRecords(db, orderId).filter((record) => record.decision === null);
        if (pendingDecision.length > 0) {
          throw errors.conflict('上一轮质检还有未处置记录，请管理员先处置后再下发复检');
        }
        const alreadyInspected = new Set(
          getQcRecords(db, orderId).map((record) => record.production_order_id)
        );
        const unInspected = productions.filter((task) => !alreadyInspected.has(task.id));
        if (unInspected.length === 0) {
          throw errors.conflict('当前所有生产任务都已录入质检结果，没有可下发复检的任务');
        }
        db.run('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?', 'PENDING_QC', nowIso(), orderId);
        addTimeline(db, {
          orderId,
          eventType: 'QC_DISPATCHED',
          actor,
          resourceType: 'ORDER',
          resourceId: orderId,
          payload: {
            productionOrderIds: productions.map((task) => task.id),
            reinspection: alreadyInspected.size > 0
          }
        });
        writeAudit(db, {
          requestId: request.id,
          actor,
          action: 'QC_DISPATCH',
          resourceType: 'ORDER',
          resourceId: orderId,
          result: 'SUCCESS',
          before: { status: order.status },
          after: { status: 'PENDING_QC' }
        });
        return { data: { orderId, status: 'PENDING_QC' }, businessId: orderId };
      }
    );
    reply.header('Idempotent-Replayed', String(result.replayed));
    return ok(reply, request, result.data, result.replayed ? 200 : result.status);
  });

  app.get('/tablet/qc/queue', qcRole, async (request, reply) => {
    const rows = db.all<QcQueueRow>(
      `SELECT p.id AS production_order_id, o.id AS order_id, o.order_no, oi.product_name, oi.spec,
              p.quantity AS task_quantity, p.process_name, d.name AS department_name, o.due_date,
              (SELECT COALESCE(SUM(f.quantity), 0) FROM production_feedbacks f
               WHERE f.production_order_id = p.id) AS produced_qty
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       JOIN production_orders p ON p.order_id = o.id
       JOIN departments d ON d.id = p.department_id
       LEFT JOIN qc_records q ON q.production_order_id = p.id
       WHERE o.status = 'PENDING_QC' AND q.id IS NULL
       ORDER BY o.due_date, o.created_at`
    );
    return ok(reply, request, {
      tasks: rows.map((row) => ({
        productionOrderId: row.production_order_id,
        orderId: row.order_id,
        orderNo: row.order_no,
        productName: row.product_name,
        spec: row.spec,
        taskQuantity: row.task_quantity,
        producedQty: row.produced_qty,
        processName: row.process_name,
        departmentName: row.department_name,
        dueDate: row.due_date
      }))
    });
  });

  app.get('/tablet/qc/history', qcRole, async (request, reply) => {
    const rows = db.all<{
      id: string;
      order_id: string;
      order_no: string;
      product_name: string;
      spec: string;
      inspected_qty: number;
      qualified_qty: number;
      unqualified_qty: number;
      decision: string | null;
      inspector_name: string;
      decided_by_name: string | null;
      created_at: string;
      decided_at: string | null;
    }>(
      `SELECT q.id, o.id AS order_id, o.order_no, oi.product_name, oi.spec,
              q.inspected_qty, q.qualified_qty, q.unqualified_qty, q.decision,
              i.display_name AS inspector_name, d.display_name AS decided_by_name,
              q.created_at, q.decided_at
       FROM qc_records q
       JOIN production_orders p ON p.id = q.production_order_id
       JOIN orders o ON o.id = p.order_id
       JOIN order_items oi ON oi.id = p.order_item_id
       JOIN users i ON i.id = q.inspector_id
       LEFT JOIN users d ON d.id = q.decided_by
       ORDER BY q.created_at DESC, q.id DESC LIMIT 100`
    );
    return ok(reply, request, {
      items: rows.map((row) => ({
        id: row.id,
        orderId: row.order_id,
        orderNo: row.order_no,
        productName: row.product_name,
        spec: row.spec,
        inspectedQty: row.inspected_qty,
        qualifiedQty: row.qualified_qty,
        unqualifiedQty: row.unqualified_qty,
        decision: row.decision,
        inspectorName: row.inspector_name,
        decidedByName: row.decided_by_name,
        createdAt: row.created_at,
        decidedAt: row.decided_at
      }))
    });
  });

  app.post('/production-orders/:id/qc-records', qcRole, async (request, reply) => {
    const { id: taskId } = validate(idParam, request.params);
    const key = requireIdempotencyKey(request);
    const input = validate(qcRecordSchema, request.body);
    const actor = request.auth!.user;
    if (input.inspectedQuantity !== input.qualifiedQuantity + input.unqualifiedQuantity) {
      throw errors.validation('合格量与不合格量之和必须等于检验量', [
        { path: 'qualifiedQuantity', message: '数量不守恒' }
      ]);
    }

    const result = runIdempotent(
      db,
      { actorId: actor.id, operation: 'qc.record', key, payload: { taskId, ...input } },
      () => {
        const task = db.get<{
          id: string;
          order_id: string;
          quantity: number;
          produced_qty: number;
          order_status: string;
        }>(
          `SELECT p.id, p.order_id, p.quantity, o.status AS order_status,
                  (SELECT COALESCE(SUM(f.quantity), 0) FROM production_feedbacks f
                   WHERE f.production_order_id = p.id) AS produced_qty
           FROM production_orders p JOIN orders o ON o.id = p.order_id WHERE p.id = ?`,
          taskId
        );
        if (!task) throw errors.notFound('生产任务不存在');
        if (task.order_status !== 'PENDING_QC') throw errors.invalidState('订单不在待质检状态');
        const existing = db.get<{ id: string }>('SELECT id FROM qc_records WHERE production_order_id = ?', taskId);
        if (existing) throw errors.conflict('该生产任务已录入质检结果');
        if (input.inspectedQuantity > task.produced_qty) {
          throw errors.quantity('检验量不能超过已完成生产量', {
            produced: task.produced_qty,
            inspected: input.inspectedQuantity
          });
        }
        if (input.inspectedQuantity !== task.produced_qty) {
          throw errors.validation('最低实现为一次全检，检验量必须等于已完成生产量', [
            { path: 'inspectedQuantity', message: `应为 ${task.produced_qty}` }
          ]);
        }
        const qcId = newId();
        const now = nowIso();
        db.run(
          `INSERT INTO qc_records(id, production_order_id, inspected_qty, qualified_qty, unqualified_qty,
                                  inspector_id, decision, decided_by, decided_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?)`,
          qcId,
          taskId,
          input.inspectedQuantity,
          input.qualifiedQuantity,
          input.unqualifiedQuantity,
          actor.id,
          now
        );
        addTimeline(db, {
          orderId: task.order_id,
          eventType: 'QC_RECORDED',
          actor,
          resourceType: 'QC_RECORD',
          resourceId: qcId,
          quantity: input.inspectedQuantity,
          payload: {
            inspected: input.inspectedQuantity,
            qualified: input.qualifiedQuantity,
            unqualified: input.unqualifiedQuantity
          }
        });
        notifyAdmins(db, {
          eventType: 'QC_RECORDED',
          title:
            input.unqualifiedQuantity > 0
              ? `品控上报不合格 ${input.unqualifiedQuantity} 件，待处置`
              : '品控已录入质检结果',
          body:
            input.unqualifiedQuantity > 0
              ? `生产任务 ${taskId.slice(0, 8)}：检验 ${input.inspectedQuantity}，合格 ${input.qualifiedQuantity}，不合格 ${input.unqualifiedQuantity}。请选择返工或报废，不能直接放行。`
              : `生产任务 ${taskId.slice(0, 8)}：检验 ${input.inspectedQuantity}，合格 ${input.qualifiedQuantity}，等待管理员放行。`,
          resourceType: 'ORDER',
          resourceId: task.order_id,
          dedupeKey: `qc-recorded:${qcId}`
        });
        writeAudit(db, {
          requestId: request.id,
          actor,
          action: 'QC_RECORD',
          resourceType: 'QC_RECORD',
          resourceId: qcId,
          result: 'SUCCESS',
          after: {
            inspected: input.inspectedQuantity,
            qualified: input.qualifiedQuantity,
            unqualified: input.unqualifiedQuantity
          }
        });
        return {
          data: {
            id: qcId,
            inspectedQty: input.inspectedQuantity,
            qualifiedQty: input.qualifiedQuantity,
            decision: null,
            status: 'AWAITING_DECISION'
          },
          status: 201,
          businessId: qcId
        };
      }
    );
    reply.header('Idempotent-Replayed', String(result.replayed));
    return ok(reply, request, result.data, result.replayed ? 200 : result.status);
  });

  app.post('/qc-records/:id/decision', admin, async (request, reply) => {
    const { id: qcId } = validate(idParam, request.params);
    const key = requireIdempotencyKey(request);
    const input = validate(decisionSchema, request.body);
    const actor = request.auth!.user;
    const qc = db.get<{
      id: string;
      production_order_id: string;
      order_id: string;
      decision: string | null;
      qualified_qty: number;
      unqualified_qty: number;
      order_status: string;
    }>(
      `SELECT q.id, q.production_order_id, p.order_id, q.decision, q.qualified_qty, q.unqualified_qty,
              o.status AS order_status
       FROM qc_records q
       JOIN production_orders p ON p.id = q.production_order_id
       JOIN orders o ON o.id = p.order_id
       WHERE q.id = ?`,
      qcId
    );
    if (!qc) throw errors.notFound('质检记录不存在');
    if (qc.decision !== null) {
      const replayReleased = db.get<{ qty: number | null }>(
        `SELECT COALESCE(SUM(q.qualified_qty), 0) AS qty
         FROM qc_records q
         JOIN production_orders p ON p.id = q.production_order_id
         WHERE p.order_id = ? AND q.decision IS NOT NULL`,
        qc.order_id
      );
      return ok(reply, request, {
        id: qcId,
        decision: qc.decision,
        orderStatus: qc.order_status,
        releasedQty: replayReleased?.qty ?? qc.qualified_qty,
        replayed: true
      });
    }
    if (qc.order_status !== 'PENDING_QC') throw errors.invalidState('订单不在待质检状态');
    if (input.decision === 'PASS' && qc.unqualified_qty > 0) {
      throw errors.invalidState('本次检验存在不合格品，不能直接放行；请选择返工或报废', {
        unqualified: qc.unqualified_qty
      });
    }
    if (input.decision !== 'PASS' && qc.unqualified_qty === 0) {
      throw errors.invalidState('本次检验没有不合格品，无需返工或报废', { unqualified: 0 });
    }

    const result = runIdempotent(
      db,
      { actorId: actor.id, operation: 'qc.decision', key, payload: { qcId, ...input } },
      () => {
        const now = nowIso();
        const updated = db.run(
          `UPDATE qc_records SET decision = ?, decided_by = ?, decided_at = ?
           WHERE id = ? AND decision IS NULL`,
          input.decision,
          actor.id,
          now,
          qcId
        );
        if (Number(updated.changes) !== 1) throw errors.conflict('质检记录已被其他请求处置');

        const allRecords = getQcRecords(db, qc.order_id);
        const itemQty = getSingleItemOrThrow(db, qc.order_id).quantity;
        const releasedQty = allRecords
          .filter((record) => record.decision !== null)
          .reduce((sum, record) => sum + record.qualified_qty, 0);
        const noPendingDecision = allRecords.every((record) => record.decision !== null);

        let nextStatus: 'QC_DONE' | 'PENDING_QC' | 'IN_PRODUCTION';
        if (input.decision === 'PASS') {
          // 全部记录已处置，且放行量覆盖应交量，才算质检完成；返工/报废记录不再阻塞
          nextStatus = noPendingDecision && releasedQty >= itemQty ? 'QC_DONE' : 'PENDING_QC';
        } else {
          // 返工/报废：退回生产，由管理员补产或返工后再次送检
          nextStatus = 'IN_PRODUCTION';
        }
        db.run('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?', nextStatus, now, qc.order_id);
        addTimeline(db, {
          orderId: qc.order_id,
          eventType:
            input.decision === 'PASS'
              ? 'QC_PASSED'
              : input.decision === 'REWORK'
                ? 'QC_REWORKED'
                : 'QC_SCRAPPED',
          actor,
          resourceType: 'QC_RECORD',
          resourceId: qcId,
          quantity: input.decision === 'PASS' ? qc.qualified_qty : qc.unqualified_qty,
          payload: {
            decision: input.decision,
            qualified: qc.qualified_qty,
            unqualified: qc.unqualified_qty,
            released: releasedQty,
            note: input.note
          }
        });
        if (input.decision !== 'PASS') {
          notifyAdmins(db, {
            eventType: 'QC_DISPOSED',
            title: input.decision === 'REWORK' ? '质检不合格已退回返工' : '质检不合格已登记报废',
            body: `订单 ${qc.order_id.slice(0, 8)}：不合格 ${qc.unqualified_qty} 件，订单退回生产，需补产后再送检。`,
            resourceType: 'ORDER',
            resourceId: qc.order_id,
            dedupeKey: `qc-disposed:${qcId}`
          });
        }
        writeAudit(db, {
          requestId: request.id,
          actor,
          action: 'QC_DECISION',
          resourceType: 'QC_RECORD',
          resourceId: qcId,
          result: 'SUCCESS',
          before: { decision: null },
          after: {
            decision: input.decision,
            qualified: qc.qualified_qty,
            unqualified: qc.unqualified_qty,
            released: releasedQty,
            orderStatus: nextStatus
          }
        });
        return {
          data: {
            id: qcId,
            decision: input.decision,
            orderStatus: nextStatus,
            releasedQty,
            unqualifiedQty: qc.unqualified_qty
          },
          businessId: qcId
        };
      }
    );
    reply.header('Idempotent-Replayed', String(result.replayed));
    return ok(reply, request, result.data, result.replayed ? 200 : result.status);
  });

  app.get('/orders/:id/qc', admin, async (request, reply) => {
    const { id } = validate(idParam, request.params);
    getOrderOrThrow(db, id);
    return ok(reply, request, {
      qc: getQcRecords(db, id).map((record) => ({
        id: record.id,
        inspectedQty: record.inspected_qty,
        qualifiedQty: record.qualified_qty,
        unqualifiedQty: record.unqualified_qty,
        inspectorName: record.inspector_name,
        decision: record.decision,
        decidedByName: record.decided_by_name,
        decidedAt: record.decided_at,
        createdAt: record.created_at
      }))
    });
  });
}
