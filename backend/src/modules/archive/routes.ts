import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { writeAudit } from '../../common/audit.js';
import { createAuthenticate, requireAdmin } from '../../common/auth.js';
import { errors } from '../../common/errors.js';
import { ok } from '../../common/http.js';
import { nowIso } from '../../common/time.js';
import { validate } from '../../common/validation.js';
import type { AppContext } from '../../common/types.js';
import {
  isValidMonth,
  loadMonthlyCompletedOrders,
  previousMonth,
  writeMonthlyArchive
} from './service.js';

const archiveSchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional()
});

/**
 * 按月归档已完成订单：先写月报表格到 ARCHIVE_DIR，再把订单标记 archived_at。
 * 不物理删除：时间线、审计、附件与追责证据仍可查；列表默认隐藏归档单。
 */
export async function registerArchiveRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { db, config } = ctx;
  const authenticate = createAuthenticate(db, config);
  const admin = { preHandler: [authenticate, requireAdmin] };

  app.post('/orders/archive-month', admin, async (request, reply) => {
    const input = validate(archiveSchema, request.body ?? {});
    const actor = request.auth!.user;
    const month = input.month ?? previousMonth();
    if (!isValidMonth(month)) throw errors.validation('月份格式应为 YYYY-MM');

    const rows = loadMonthlyCompletedOrders(db, month);
    const allRows = loadMonthlyCompletedOrders(db, month, true);
    if (allRows.length === 0) {
      return ok(reply, request, {
        month,
        count: 0,
        archived: 0,
        message: '该月没有已完成订单',
        xlsxPath: null,
        csvPath: null
      });
    }

    // 月报始终覆盖为该月全量（含此前已归档），避免同月多次归档把旧行覆盖掉
    const archive = await writeMonthlyArchive(db, config.archiveDir, month, allRows);
    if (rows.length === 0) {
      return ok(reply, request, {
        month,
        count: allRows.length,
        archived: 0,
        message: '该月订单已全部归档，月报已按全量刷新',
        xlsxPath: archive.xlsxPath,
        csvPath: archive.csvPath,
        totals: archive.totals
      });
    }
    const now = nowIso();
    const archived = db.tx(() => {
      let changed = 0;
      for (const row of rows) {
        const result = db.run(
          'UPDATE orders SET archived_at = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL',
          now,
          now,
          row.id
        );
        changed += Number(result.changes);
      }
      return changed;
    });

    writeAudit(db, {
      requestId: request.id,
      actor,
      action: 'ORDER_ARCHIVE',
      resourceType: 'MONTH',
      resourceId: month,
      result: 'SUCCESS',
      after: {
        month,
        orders: rows.length,
        archived,
        file: archive.xlsxPath,
        totals: archive.totals
      }
    });

    return ok(reply, request, {
      month,
      count: allRows.length,
      archived,
      xlsxPath: archive.xlsxPath,
      csvPath: archive.csvPath,
      totals: archive.totals
    });
  });

  app.get('/orders/archive-preview', admin, async (request, reply) => {
    const query = validate(archiveSchema, request.query);
    const month = query.month ?? previousMonth();
    const rows = loadMonthlyCompletedOrders(db, month);
    return ok(reply, request, {
      month,
      count: rows.length,
      rows: rows.map((row) => ({
        id: row.id,
        orderNo: row.order_no,
        customer: row.customer_name,
        product: row.product_name,
        quantity: row.quantity,
        completedAt: row.completed_at
      }))
    });
  });
}