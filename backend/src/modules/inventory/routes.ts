import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { newId, productKeyOf } from '../../common/crypto.js';
import { errors } from '../../common/errors.js';
import { writeAudit } from '../../common/audit.js';
import { createAuthenticate, requireAdmin } from '../../common/auth.js';
import { ok } from '../../common/http.js';
import { requireIdempotencyKey, runIdempotent } from '../../common/idempotency.js';
import { nowIso } from '../../common/time.js';
import { idParam, requiredText, shortText, validate } from '../../common/validation.js';
import type { AppContext } from '../../common/types.js';

const deltaSchema = z
  .number({ error: '增减数量必须是整数' })
  .int('增减数量必须是整数')
  .refine((value) => value !== 0, '增减数量不能为 0')
  .refine((value) => Math.abs(value) <= 1_000_000, '增减数量过大');

const partAdjustSchema = z.object({
  partId: z.string().min(1, '请选择配件'),
  delta: deltaSchema,
  reason: requiredText(200, '原因'),
  sourceOrderId: z.string().min(1).nullable().optional()
});

const productAdjustSchema = z.object({
  productName: requiredText(80, '成品名称'),
  spec: shortText(120, '规格').default(''),
  delta: deltaSchema,
  reason: requiredText(200, '原因'),
  sourceOrderId: z.string().min(1).nullable().optional()
});

const searchQuery = z.object({ search: z.string().trim().max(80).optional() });

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

interface AdjustResult {
  inventoryId: string;
  resourceType: 'PART' | 'PRODUCT';
  resourceId: string;
  productKey?: string;
  before: number;
  delta: number;
  after: number;
  logId: string;
}

function writeLog(
  db: AppContext['db'],
  input: {
    resourceType: 'PART' | 'PRODUCT';
    resourceId: string;
    before: number;
    delta: number;
    after: number;
    reason: string;
    operatorId: string;
    sourceOrderId: string | null;
    requestId: string;
    now: string;
  }
): string {
  const logId = newId();
  db.run(
    `INSERT INTO inventory_logs(id, resource_type, resource_id, before_qty, delta, after_qty, reason,
                                operator_id, source_order_id, request_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    logId,
    input.resourceType,
    input.resourceId,
    input.before,
    input.delta,
    input.after,
    input.reason,
    input.operatorId,
    input.sourceOrderId,
    input.requestId,
    input.now
  );
  return logId;
}

function assertSourceOrder(db: AppContext['db'], sourceOrderId: string | null | undefined): void {
  if (!sourceOrderId) return;
  const order = db.get<{ id: string }>('SELECT id FROM orders WHERE id = ?', sourceOrderId);
  if (!order) throw errors.validation('来源订单不存在', [{ path: 'sourceOrderId', message: '订单不存在' }]);
}

export async function registerInventoryRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { db, config } = ctx;
  const authenticate = createAuthenticate(db, config);
  const admin = { preHandler: [authenticate, requireAdmin] };

  app.get('/inventory/parts', admin, async (request, reply) => {
    const query = validate(searchQuery, request.query);
    const params: string[] = [];
    let where = '';
    if (query.search) {
      where = 'WHERE (p.name LIKE ? OR p.spec LIKE ? OR p.code LIKE ?)';
      params.push(`%${query.search}%`, `%${query.search}%`, `%${query.search}%`);
    }
    const rows = db.all<{
      part_id: string;
      code: string;
      name: string;
      spec: string;
      unit: string;
      active: number;
      inventory_id: string | null;
      quantity: number | null;
      version: number | null;
      updated_at: string | null;
    }>(
      `SELECT p.id AS part_id, p.code, p.name, p.spec, p.unit, p.active,
              i.id AS inventory_id, i.quantity, i.version, i.updated_at
       FROM parts p LEFT JOIN part_inventory i ON i.part_id = p.id
       ${where}
       ORDER BY p.active DESC, p.name LIMIT 200`,
      ...params
    );
    return ok(reply, request, {
      items: rows.map((row) => ({
        partId: row.part_id,
        code: row.code,
        name: row.name,
        spec: row.spec,
        unit: row.unit,
        active: row.active === 1,
        inventoryId: row.inventory_id,
        quantity: row.quantity ?? 0,
        version: row.version ?? 0,
        updatedAt: row.updated_at
      }))
    });
  });

  app.get('/inventory/products', admin, async (request, reply) => {
    const query = validate(searchQuery, request.query);
    const params: string[] = [];
    let where = '';
    if (query.search) {
      where = 'WHERE (product_name LIKE ? OR spec LIKE ? OR product_key LIKE ?)';
      params.push(`%${query.search}%`, `%${query.search}%`, `%${query.search}%`);
    }
    const rows = db.all<{
      id: string;
      product_key: string;
      product_name: string;
      spec: string;
      quantity: number;
      version: number;
      updated_at: string;
    }>(
      `SELECT id, product_key, product_name, spec, quantity, version, updated_at
       FROM product_inventory ${where} ORDER BY updated_at DESC, id LIMIT 200`,
      ...params
    );
    return ok(reply, request, {
      items: rows.map((row) => ({
        inventoryId: row.id,
        productKey: row.product_key,
        productName: row.product_name,
        spec: row.spec,
        quantity: row.quantity,
        version: row.version,
        updatedAt: row.updated_at
      }))
    });
  });

  app.post('/inventory/parts/adjust', admin, async (request, reply) => {
    const key = requireIdempotencyKey(request);
    const input = validate(partAdjustSchema, request.body);
    const actor = request.auth!.user;
    const part = db.get<{ id: string; name: string; spec: string; active: number }>(
      'SELECT id, name, spec, active FROM parts WHERE id = ?',
      input.partId
    );
    if (!part) throw errors.validation('配件不存在', [{ path: 'partId', message: '配件不存在' }]);
    assertSourceOrder(db, input.sourceOrderId);

    const result = runIdempotent(
      db,
      { actorId: actor.id, operation: 'inventory.part.adjust', key, payload: input },
      () => {
        const now = nowIso();
        let inventory = db.get<{ id: string; quantity: number }>(
          'SELECT id, quantity FROM part_inventory WHERE part_id = ?',
          input.partId
        );
        let before: number;
        if (!inventory) {
          if (input.delta < 0) {
            throw errors.conflict('首次建立配件库存只允许正向调整，不能隐式创建负库存', {
              available: 0,
              delta: input.delta
            });
          }
          const inventoryId = newId();
          let inserted = false;
          try {
            db.run(
              `INSERT INTO part_inventory(id, part_id, quantity, version, updated_at)
               VALUES (?, ?, ?, 1, ?)`,
              inventoryId,
              input.partId,
              input.delta,
              now
            );
            inserted = true;
          } catch (error) {
            if (!isUniqueViolation(error)) throw error;
            // 极端竞争下由唯一约束兜底，转为原子更新。
          }
          inventory =
            db.get<{ id: string; quantity: number }>(
              'SELECT id, quantity FROM part_inventory WHERE part_id = ?',
              input.partId
            ) ?? undefined;
          if (!inventory) throw new Error('配件库存创建后未能读取');
          if (inserted) {
            before = 0;
          } else {
            before = inventory.quantity;
            const updated = db.run(
              `UPDATE part_inventory SET quantity = quantity + ?, version = version + 1, updated_at = ?
               WHERE part_id = ? AND quantity + ? >= 0`,
              input.delta,
              now,
              input.partId,
              input.delta
            );
            if (Number(updated.changes) !== 1) {
              throw errors.stock('库存不足', { available: inventory.quantity });
            }
            inventory = db.get<{ id: string; quantity: number }>(
              'SELECT id, quantity FROM part_inventory WHERE part_id = ?',
              input.partId
            )!;
          }
        } else {
          before = inventory.quantity;
          const updated = db.run(
            `UPDATE part_inventory SET quantity = quantity + ?, version = version + 1, updated_at = ?
             WHERE part_id = ? AND quantity + ? >= 0`,
            input.delta,
            now,
            input.partId,
            input.delta
          );
          if (Number(updated.changes) !== 1) {
            const current = db.get<{ quantity: number }>(
              'SELECT quantity FROM part_inventory WHERE part_id = ?',
              input.partId
            );
            throw errors.stock('库存不足，不能减为负数', {
              available: current?.quantity ?? 0,
              delta: input.delta
            });
          }
          inventory = db.get<{ id: string; quantity: number }>(
            'SELECT id, quantity FROM part_inventory WHERE part_id = ?',
            input.partId
          )!;
        }
        const after = inventory.quantity;
        const logId = writeLog(db, {
          resourceType: 'PART',
          resourceId: inventory.id,
          before,
          delta: input.delta,
          after,
          reason: input.reason,
          operatorId: actor.id,
          sourceOrderId: input.sourceOrderId ?? null,
          requestId: request.id,
          now
        });
        writeAudit(db, {
          requestId: request.id,
          actor,
          action: 'INVENTORY_PART_ADJUST',
          resourceType: 'PART_INVENTORY',
          resourceId: inventory.id,
          result: 'SUCCESS',
          before: { quantity: before },
          after: { quantity: after, delta: input.delta, reason: input.reason }
        });
        return {
          data: {
            inventoryId: inventory.id,
            resourceType: 'PART',
            resourceId: part.id,
            before,
            delta: input.delta,
            after,
            logId
          } satisfies AdjustResult,
          businessId: logId
        };
      }
    );
    reply.header('Idempotent-Replayed', String(result.replayed));
    return ok(reply, request, result.data, result.replayed ? 200 : result.status);
  });

  app.post('/inventory/products/adjust', admin, async (request, reply) => {
    const key = requireIdempotencyKey(request);
    const input = validate(productAdjustSchema, request.body);
    const actor = request.auth!.user;
    assertSourceOrder(db, input.sourceOrderId);
    const productKey = productKeyOf(input.productName, input.spec);

    const result = runIdempotent(
      db,
      { actorId: actor.id, operation: 'inventory.product.adjust', key, payload: { ...input, productKey } },
      () => {
        const now = nowIso();
        let inventory = db.get<{ id: string; quantity: number }>(
          'SELECT id, quantity FROM product_inventory WHERE product_key = ?',
          productKey
        );
        let before: number;
        if (!inventory) {
          if (input.delta < 0) {
            throw errors.conflict('首次建立成品库存只允许正向调整，不能隐式创建负库存', {
              available: 0,
              delta: input.delta
            });
          }
          const inventoryId = newId();
          let inserted = false;
          try {
            db.run(
              `INSERT INTO product_inventory(id, product_key, product_name, spec, quantity, version, updated_at)
               VALUES (?, ?, ?, ?, ?, 1, ?)`,
              inventoryId,
              productKey,
              input.productName.trim(),
              input.spec.trim(),
              input.delta,
              now
            );
            inserted = true;
          } catch (error) {
            if (!isUniqueViolation(error)) throw error;
          }
          inventory =
            db.get<{ id: string; quantity: number }>(
              'SELECT id, quantity FROM product_inventory WHERE product_key = ?',
              productKey
            ) ?? undefined;
          if (!inventory) throw new Error('成品库存创建后未能读取');
          if (inserted) {
            before = 0;
          } else {
            before = inventory.quantity;
            const updated = db.run(
              `UPDATE product_inventory SET quantity = quantity + ?, version = version + 1, updated_at = ?
               WHERE product_key = ? AND quantity + ? >= 0`,
              input.delta,
              now,
              productKey,
              input.delta
            );
            if (Number(updated.changes) !== 1) {
              throw errors.stock('库存不足', { available: inventory.quantity });
            }
            inventory = db.get<{ id: string; quantity: number }>(
              'SELECT id, quantity FROM product_inventory WHERE product_key = ?',
              productKey
            )!;
          }
        } else {
          before = inventory.quantity;
          const updated = db.run(
            `UPDATE product_inventory SET quantity = quantity + ?, version = version + 1, updated_at = ?
             WHERE product_key = ? AND quantity + ? >= 0`,
            input.delta,
            now,
            productKey,
            input.delta
          );
          if (Number(updated.changes) !== 1) {
            const current = db.get<{ quantity: number }>(
              'SELECT quantity FROM product_inventory WHERE product_key = ?',
              productKey
            );
            throw errors.stock('库存不足，不能减为负数', {
              available: current?.quantity ?? 0,
              delta: input.delta
            });
          }
          inventory = db.get<{ id: string; quantity: number }>(
            'SELECT id, quantity FROM product_inventory WHERE product_key = ?',
            productKey
          )!;
        }
        const after = inventory.quantity;
        const logId = writeLog(db, {
          resourceType: 'PRODUCT',
          resourceId: inventory.id,
          before,
          delta: input.delta,
          after,
          reason: input.reason,
          operatorId: actor.id,
          sourceOrderId: input.sourceOrderId ?? null,
          requestId: request.id,
          now
        });
        writeAudit(db, {
          requestId: request.id,
          actor,
          action: 'INVENTORY_PRODUCT_ADJUST',
          resourceType: 'PRODUCT_INVENTORY',
          resourceId: inventory.id,
          result: 'SUCCESS',
          before: { quantity: before },
          after: { quantity: after, delta: input.delta, reason: input.reason }
        });
        return {
          data: {
            inventoryId: inventory.id,
            resourceType: 'PRODUCT',
            resourceId: inventory.id,
            productKey,
            before,
            delta: input.delta,
            after,
            logId
          } satisfies AdjustResult,
          businessId: logId
        };
      }
    );
    reply.header('Idempotent-Replayed', String(result.replayed));
    return ok(reply, request, result.data, result.replayed ? 200 : result.status);
  });

  app.get('/inventory/parts/:id/logs', admin, async (request, reply) => {
    const { id } = validate(idParam, request.params);
    const part = db.get<{ id: string; name: string }>('SELECT id, name FROM parts WHERE id = ?', id);
    if (!part) throw errors.notFound('配件不存在');
    const inventory = db.get<{ id: string }>('SELECT id FROM part_inventory WHERE part_id = ?', id);
    const logs = inventory
      ? db.all<Record<string, unknown>>(
          `SELECT l.*, u.display_name AS operator_name FROM inventory_logs l
           JOIN users u ON u.id = l.operator_id
           WHERE l.resource_type = 'PART' AND l.resource_id = ?
           ORDER BY l.created_at DESC, l.id DESC LIMIT 100`,
          inventory.id
        )
      : [];
    return ok(reply, request, {
      part: { id: part.id, name: part.name },
      logs: logs.map((log) => ({
        id: log.id,
        before: log.before_qty,
        delta: log.delta,
        after: log.after_qty,
        reason: log.reason,
        operatorName: log.operator_name,
        createdAt: log.created_at
      }))
    });
  });

  app.get('/inventory/products/:id/logs', admin, async (request, reply) => {
    const { id } = validate(idParam, request.params);
    const inventory = db.get<{ id: string; product_name: string; spec: string }>(
      'SELECT id, product_name, spec FROM product_inventory WHERE id = ?',
      id
    );
    if (!inventory) throw errors.notFound('成品库存不存在');
    const logs = db.all<Record<string, unknown>>(
      `SELECT l.*, u.display_name AS operator_name FROM inventory_logs l
       JOIN users u ON u.id = l.operator_id
       WHERE l.resource_type = 'PRODUCT' AND l.resource_id = ?
       ORDER BY l.created_at DESC, l.id DESC LIMIT 100`,
      id
    );
    return ok(reply, request, {
      product: { id: inventory.id, name: inventory.product_name, spec: inventory.spec },
      logs: logs.map((log) => ({
        id: log.id,
        before: log.before_qty,
        delta: log.delta,
        after: log.after_qty,
        reason: log.reason,
        operatorName: log.operator_name,
        createdAt: log.created_at
      }))
    });
  });
}
