import type { FastifyInstance } from 'fastify';
import { createAuthenticate, requireAdmin } from '../../common/auth.js';
import { ok } from '../../common/http.js';
import { businessDate } from '../../common/time.js';
import { computeProfit, formatCents } from '../../common/money.js';
import type { AppContext } from '../../common/types.js';
import { ORDER_STATUS_LABELS, effectiveStatus, type OrderStatus } from '../orders/service.js';

interface FinanceRow {
  id: string;
  order_no: string;
  customer_name: string;
  status: OrderStatus;
  cancelled_at: string | null;
  due_date: string;
  created_at: string;
  quantity: number;
  sales_cents: number;
  purchase_cents: number;
  production_cents: number;
}

/**
 * 订单流水：所有金额来自当前业务表实时汇总，不做缓存与预计算表。
 * 撤销订单单独列出但不计入合计，避免污染利润口径。
 */
export async function registerFinanceRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { db, config } = ctx;
  const authenticate = createAuthenticate(db, config);
  const admin = { preHandler: [authenticate, requireAdmin] };

  app.get('/finance/summary', admin, async (request, reply) => {
    const rows = db.all<FinanceRow>(
      `SELECT o.id, o.order_no, o.customer_name, o.status, o.cancelled_at, o.due_date, o.created_at,
              oi.quantity,
              oi.quantity * oi.unit_price_cents AS sales_cents,
              COALESCE((SELECT SUM(pi.quantity * pi.unit_price_cents)
                        FROM purchase_items pi
                        JOIN purchase_orders po ON po.id = pi.purchase_order_id
                        WHERE po.order_id = o.id), 0) AS purchase_cents,
              COALESCE((SELECT SUM(f.quantity * p.unit_price_cents)
                        FROM production_feedbacks f
                        JOIN production_orders p ON p.id = f.production_order_id
                        WHERE p.order_id = o.id), 0) AS production_cents
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       ORDER BY o.created_at DESC, o.id DESC`
    );

    const active = rows.filter((row) => !row.cancelled_at);
    const totals = active.reduce(
      (sum, row) => ({
        salesCents: sum.salesCents + row.sales_cents,
        purchaseCents: sum.purchaseCents + row.purchase_cents,
        productionCents: sum.productionCents + row.production_cents
      }),
      { salesCents: 0, purchaseCents: 0, productionCents: 0 }
    );
    const profit = computeProfit(totals);
    const cancelled = rows.filter((row) => row.cancelled_at);

    return ok(reply, request, {
      generatedAt: new Date().toISOString(),
      businessDate: businessDate(),
      scopeNote: '实时汇总：销售额 − 采购成本 − 已反馈生产完成量成本；不含电镀与人工分摊，不代表回款或财务结算。',
      totals: {
        orders: active.length,
        cancelledOrders: cancelled.length,
        sales: formatCents(totals.salesCents),
        purchaseCost: formatCents(totals.purchaseCents),
        productionCost: formatCents(totals.productionCents),
        profit: formatCents(profit.profitCents),
        margin: profit.marginPercent,
        salesCents: totals.salesCents,
        purchaseCents: totals.purchaseCents,
        productionCents: totals.productionCents,
        profitCents: profit.profitCents
      },
      orders: rows.map((row) => {
        const breakdown = computeProfit({
          salesCents: row.sales_cents,
          purchaseCents: row.purchase_cents,
          productionCents: row.production_cents
        });
        const status = effectiveStatus(row);
        return {
          id: row.id,
          orderNo: row.order_no,
          customerName: row.customer_name,
          status,
          statusLabel: ORDER_STATUS_LABELS[status],
          cancelled: Boolean(row.cancelled_at),
          dueDate: row.due_date,
          createdAt: row.created_at,
          quantity: row.quantity,
          sales: formatCents(row.sales_cents),
          purchaseCost: formatCents(row.purchase_cents),
          productionCost: formatCents(row.production_cents),
          profit: formatCents(breakdown.profitCents),
          margin: breakdown.marginPercent,
          salesCents: row.sales_cents,
          purchaseCents: row.purchase_cents,
          productionCents: row.production_cents,
          profitCents: breakdown.profitCents
        };
      })
    });
  });
}