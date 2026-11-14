import type { FastifyInstance } from 'fastify';
import { createAuthenticate, requireAdmin } from '../../common/auth.js';
import { ok } from '../../common/http.js';
import { computeProfit, formatCents } from '../../common/money.js';
import { addDays, businessDate } from '../../common/time.js';
import type { AppContext } from '../../common/types.js';
import { ORDER_STATUS_LABELS, effectiveStatus, type OrderStatus } from '../orders/service.js';

interface Summary {
  statusCounts: Array<{ status: OrderStatus; label: string; count: number }>;
  totalOrders: number;
  completedOrders: number;
  activeOrders: number;
  profit: {
    sales: string;
    purchaseCost: string;
    productionCost: string;
    profit: string;
    margin: string;
    salesCents: number;
    profitCents: number;
  };
  production: {
    activeTasks: number;
    completedTasks: number;
    progress: Array<{
      orderId: string;
      orderNo: string;
      productName: string;
      departmentName: string;
      processName: string;
      quantity: number;
      producedQty: number;
      percent: number;
      dueDate: string;
    }>;
  };
  dueSoon: Array<{
    orderId: string;
    orderNo: string;
    customerName: string;
    dueDate: string;
    status: OrderStatus;
    statusLabel: string;
    daysLeft: number;
  }>;
  inventory: {
    partKinds: number;
    partQuantity: number;
    productKinds: number;
    productQuantity: number;
  };
  recentOrders: Array<{
    id: string;
    orderNo: string;
    customerName: string;
    productName: string;
    quantity: number;
    status: OrderStatus;
    statusLabel: string;
    dueDate: string;
    createdAt: string;
  }>;
  unreadNotifications: number;
}

function buildSummary(db: AppContext['db'], adminId: string): Summary {
  const statusRows = db.all<{ status: OrderStatus; count: number }>(
    'SELECT status, COUNT(*) AS count FROM orders WHERE cancelled_at IS NULL AND archived_at IS NULL GROUP BY status'
  );
  const cancelledRow = db.get<{ count: number }>(
    'SELECT COUNT(*) AS count FROM orders WHERE cancelled_at IS NOT NULL AND archived_at IS NULL'
  );
  const statusCounts = (Object.keys(ORDER_STATUS_LABELS) as OrderStatus[]).map((status) => ({
    status,
    label: ORDER_STATUS_LABELS[status],
    count:
      status === 'CANCELLED'
        ? cancelledRow?.count ?? 0
        : statusRows.find((row) => row.status === status)?.count ?? 0
  }));
  const totalOrders = statusCounts.reduce((sum, row) => sum + row.count, 0);
  const completedOrders = statusCounts.find((row) => row.status === 'COMPLETED')?.count ?? 0;

  const sales = db.get<{ cents: number }>(
    `SELECT COALESCE(SUM(oi.quantity * oi.unit_price_cents), 0) AS cents
     FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.cancelled_at IS NULL AND o.archived_at IS NULL`
  );
  const purchase = db.get<{ cents: number }>(
    `SELECT COALESCE(SUM(pi.quantity * pi.unit_price_cents), 0) AS cents
     FROM purchase_items pi JOIN purchase_orders po ON po.id = pi.purchase_order_id
     JOIN orders o ON o.id = po.order_id WHERE o.cancelled_at IS NULL AND o.archived_at IS NULL`
  );
  const production = db.get<{ cents: number }>(
    `SELECT COALESCE(SUM(f.quantity * p.unit_price_cents), 0) AS cents
     FROM production_feedbacks f JOIN production_orders p ON p.id = f.production_order_id
     JOIN orders o ON o.id = p.order_id WHERE o.cancelled_at IS NULL AND o.archived_at IS NULL`
  );
  const profit = computeProfit({
    salesCents: sales?.cents ?? 0,
    purchaseCents: purchase?.cents ?? 0,
    productionCents: production?.cents ?? 0
  });

  const progress = db.all<{
    order_id: string;
    order_no: string;
    product_name: string;
    department_name: string;
    process_name: string;
    quantity: number;
    produced_qty: number;
    due_date: string;
  }>(
    `SELECT o.id AS order_id, o.order_no, oi.product_name, d.name AS department_name,
            p.process_name, p.quantity, o.due_date,
            COALESCE((SELECT SUM(f.quantity) FROM production_feedbacks f
                      WHERE f.production_order_id = p.id), 0) AS produced_qty
     FROM production_orders p
     JOIN orders o ON o.id = p.order_id
     JOIN order_items oi ON oi.id = p.order_item_id
     JOIN departments d ON d.id = p.department_id
     WHERE o.cancelled_at IS NULL AND o.archived_at IS NULL AND o.status IN ('IN_PRODUCTION', 'PENDING_QC')
     ORDER BY o.due_date`
  );
  const completedTaskCount = db.get<{ count: number }>(
    `SELECT COUNT(*) AS count FROM production_orders p
     WHERE (SELECT COALESCE(SUM(f.quantity), 0) FROM production_feedbacks f
            WHERE f.production_order_id = p.id) >= p.quantity`
  );

  const today = businessDate();
  const dueLimit = addDays(today, 7);
  const dueSoon = db.all<{
    id: string;
    order_no: string;
    customer_name: string;
    due_date: string;
    status: OrderStatus;
    cancelled_at: string | null;
  }>(
    `SELECT id, order_no, customer_name, due_date, status, cancelled_at FROM orders
     WHERE cancelled_at IS NULL AND status <> 'COMPLETED' AND due_date <= ?
     ORDER BY due_date, created_at LIMIT 8`,
    dueLimit
  ).map((row) => ({
    orderId: row.id,
    orderNo: row.order_no,
    customerName: row.customer_name,
    dueDate: row.due_date,
    status: effectiveStatus(row),
    statusLabel: ORDER_STATUS_LABELS[effectiveStatus(row)],
    daysLeft: Math.round((Date.parse(`${row.due_date}T00:00:00+08:00`) - Date.parse(`${today}T00:00:00+08:00`)) / 86_400_000)
  }));

  const inventory = db.get<{
    part_kinds: number;
    part_qty: number;
    product_kinds: number;
    product_qty: number;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM part_inventory) AS part_kinds,
       (SELECT COALESCE(SUM(quantity), 0) FROM part_inventory) AS part_qty,
       (SELECT COUNT(*) FROM product_inventory) AS product_kinds,
       (SELECT COALESCE(SUM(quantity), 0) FROM product_inventory) AS product_qty`
  );

  const recentOrders = db.all<{
    id: string;
    order_no: string;
    customer_name: string;
    product_name: string;
    quantity: number;
    status: OrderStatus;
    due_date: string;
    created_at: string;
    cancelled_at: string | null;
  }>(
    `SELECT o.id, o.order_no, o.customer_name, oi.product_name, oi.quantity, o.status, o.due_date, o.created_at,
            o.cancelled_at
     FROM orders o JOIN order_items oi ON oi.order_id = o.id
     ORDER BY o.created_at DESC, o.id DESC LIMIT 6`
  ).map((row) => ({
    id: row.id,
    orderNo: row.order_no,
    customerName: row.customer_name,
    productName: row.product_name,
    quantity: row.quantity,
    status: effectiveStatus(row),
    statusLabel: ORDER_STATUS_LABELS[effectiveStatus(row)],
    dueDate: row.due_date,
    createdAt: row.created_at
  }));

  const unread = db.get<{ count: number }>(
    'SELECT COUNT(*) AS count FROM notifications WHERE recipient_id = ? AND read_at IS NULL',
    adminId
  );

  return {
    statusCounts,
    totalOrders,
    completedOrders,
    activeOrders:
      totalOrders -
      completedOrders -
      (statusCounts.find((row) => row.status === 'CANCELLED')?.count ?? 0),
    profit: {
      sales: formatCents(profit.salesCents),
      purchaseCost: formatCents(profit.purchaseCents),
      productionCost: formatCents(profit.productionCents),
      profit: formatCents(profit.profitCents),
      margin: profit.marginPercent,
      salesCents: profit.salesCents,
      profitCents: profit.profitCents
    },
    production: {
      activeTasks: progress.filter((row) => row.produced_qty < row.quantity).length,
      completedTasks: completedTaskCount?.count ?? 0,
      progress: progress.map((row) => ({
        orderId: row.order_id,
        orderNo: row.order_no,
        productName: row.product_name,
        departmentName: row.department_name,
        processName: row.process_name,
        quantity: row.quantity,
        producedQty: row.produced_qty,
        percent: row.quantity > 0 ? Math.round((row.produced_qty / row.quantity) * 100) : 0,
        dueDate: row.due_date
      }))
    },
    dueSoon,
    inventory: {
      partKinds: inventory?.part_kinds ?? 0,
      partQuantity: inventory?.part_qty ?? 0,
      productKinds: inventory?.product_kinds ?? 0,
      productQuantity: inventory?.product_qty ?? 0
    },
    recentOrders,
    unreadNotifications: unread?.count ?? 0
  };
}

export async function registerDashboardRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { db, config } = ctx;
  const authenticate = createAuthenticate(db, config);
  const admin = { preHandler: [authenticate, requireAdmin] };

  app.get('/dashboard/summary', admin, async (request, reply) => {
    const summary = buildSummary(db, request.auth!.user.id);
    return ok(reply, request, summary);
  });

  app.get('/dashboard/order-stats', admin, async (request, reply) => {
    const summary = buildSummary(db, request.auth!.user.id);
    return ok(reply, request, {
      statusCounts: summary.statusCounts,
      totalOrders: summary.totalOrders,
      completedOrders: summary.completedOrders,
      activeOrders: summary.activeOrders
    });
  });

  app.get('/dashboard/profit-stats', admin, async (request, reply) => {
    const summary = buildSummary(db, request.auth!.user.id);
    return ok(reply, request, summary.profit);
  });

  app.get('/dashboard/production-kanban', admin, async (request, reply) => {
    const summary = buildSummary(db, request.auth!.user.id);
    return ok(reply, request, summary.production);
  });

  app.get('/dashboard/due-soon', admin, async (request, reply) => {
    const summary = buildSummary(db, request.auth!.user.id);
    return ok(reply, request, { items: summary.dueSoon });
  });

  app.get('/dashboard/inventory-overview', admin, async (request, reply) => {
    const summary = buildSummary(db, request.auth!.user.id);
    return ok(reply, request, summary.inventory);
  });
}
