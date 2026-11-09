import { errors } from '../../common/errors.js';
import { formatCents, computeProfit, type ProfitBreakdown } from '../../common/money.js';
import type { AppDatabase } from '../../db/database.js';
import type { TimelineEventType } from '../../common/events.js';

export type OrderStatus =
  | 'PENDING_PURCHASE'
  | 'PURCHASING'
  | 'IN_PRODUCTION'
  | 'PENDING_QC'
  | 'QC_DONE'
  | 'PACKING'
  | 'SHIPPING'
  | 'COMPLETED'
  | 'CANCELLED';

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING_PURCHASE: '待采购',
  PURCHASING: '采购中',
  IN_PRODUCTION: '生产中',
  PENDING_QC: '待质检',
  QC_DONE: '质检已放行',
  PACKING: '包装中',
  SHIPPING: '待发货',
  COMPLETED: '已完成',
  CANCELLED: '已撤销'
};

export const CANCEL_WINDOW_MS = 12 * 60 * 60 * 1000;

/** 撤销不改变历史 status 字段，展示层统一映射为 CANCELLED。 */
export function effectiveStatus(order: Pick<OrderRow, 'status' | 'cancelled_at'>): OrderStatus {
  return order.cancelled_at ? 'CANCELLED' : order.status;
}

export function cancelDeadline(createdAt: string): string {
  return new Date(Date.parse(createdAt) + CANCEL_WINDOW_MS).toISOString();
}

export interface OrderRow {
  id: string;
  order_no: string;
  customer_id: string;
  customer_name: string;
  due_date: string;
  status: OrderStatus;
  note: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
}

export interface OrderItemRow {
  id: string;
  order_id: string;
  part_id: string | null;
  product_name: string;
  spec: string;
  quantity: number;
  unit_price_cents: number;
  created_at: string;
}

export interface PurchaseOrderRow {
  id: string;
  order_id: string;
  purchase_no: string;
  supplier_id: string;
  supplier_name: string;
  created_at: string;
}

export interface PurchaseItemRow {
  id: string;
  purchase_order_id: string;
  part_id: string;
  part_name: string;
  spec: string;
  quantity: number;
  unit_price_cents: number;
}

export interface ArrivalRow {
  id: string;
  purchase_item_id: string;
  quantity: number;
  operator_id: string;
  operator_name: string;
  note: string;
  created_at: string;
}

export interface ProductionRow {
  id: string;
  order_id: string;
  order_item_id: string;
  department_id: string;
  department_name: string;
  assignee_id: string | null;
  assignee_name: string | null;
  process_name: string;
  quantity: number;
  unit_price_cents: number;
  price_visible: number;
  due_date: string;
  created_by: string;
  created_at: string;
}

export interface FeedbackRow {
  id: string;
  production_order_id: string;
  quantity: number;
  operator_id: string;
  operator_name: string;
  note: string;
  created_at: string;
}

export interface QcRow {
  id: string;
  production_order_id: string;
  inspected_qty: number;
  qualified_qty: number;
  unqualified_qty: number;
  inspector_id: string;
  inspector_name: string;
  decision: 'PASS' | 'REWORK' | 'SCRAP' | null;
  decided_by: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  created_at: string;
}

export interface PackingRow {
  id: string;
  order_id: string;
  order_item_id: string;
  quantity: number;
  operator_id: string;
  operator_name: string;
  note: string;
  created_at: string;
}

export interface ShipmentRow {
  id: string;
  order_id: string;
  order_item_id: string;
  quantity: number;
  operator_id: string;
  operator_name: string;
  carrier: string;
  tracking_no: string;
  created_at: string;
}

export interface TimelineRow {
  id: string;
  order_id: string;
  event_type: TimelineEventType;
  actor_id: string;
  actor_name: string;
  resource_type: string;
  resource_id: string;
  quantity: number | null;
  payload_json: string | null;
  created_at: string;
}

export function getOrderOrThrow(db: AppDatabase, orderId: string): OrderRow {
  const order = db.get<OrderRow>('SELECT * FROM orders WHERE id = ?', orderId);
  if (!order) throw errors.notFound('订单不存在');
  return order;
}

export function getItems(db: AppDatabase, orderId: string): OrderItemRow[] {
  return db.all<OrderItemRow>(
    'SELECT * FROM order_items WHERE order_id = ? ORDER BY created_at, id',
    orderId
  );
}

export function getSingleItemOrThrow(db: AppDatabase, orderId: string): OrderItemRow {
  const items = getItems(db, orderId);
  if (items.length === 0) throw errors.conflict('订单没有产品明细');
  if (items.length > 1) throw errors.conflict('当前最低实现只支持单明细订单，该订单存在多条明细');
  return items[0]!;
}

export function getPurchase(db: AppDatabase, orderId: string): {
  order: PurchaseOrderRow;
  item: PurchaseItemRow | null;
  arrivals: ArrivalRow[];
  arrivedQty: number;
} | null {
  const order = db.get<PurchaseOrderRow>('SELECT * FROM purchase_orders WHERE order_id = ?', orderId);
  if (!order) return null;
  const item = db.get<PurchaseItemRow>(
    'SELECT * FROM purchase_items WHERE purchase_order_id = ?',
    order.id
  );
  const arrivals = item
    ? db.all<ArrivalRow>(
        `SELECT a.id, a.purchase_item_id, a.quantity, a.operator_id, a.note, a.created_at,
                u.display_name AS operator_name
         FROM arrival_records a JOIN users u ON u.id = a.operator_id
         WHERE a.purchase_item_id = ? ORDER BY a.created_at, a.id`,
        item.id
      )
    : [];
  return {
    order,
    item: item ?? null,
    arrivals,
    arrivedQty: arrivals.reduce((sum, row) => sum + row.quantity, 0)
  };
}

export function getProductions(db: AppDatabase, orderId: string): Array<ProductionRow & { producedQty: number; feedbacks: FeedbackRow[] }> {
  const rows = db.all<ProductionRow>(
    `SELECT p.*, d.name AS department_name, u.display_name AS assignee_name
     FROM production_orders p
     JOIN departments d ON d.id = p.department_id
     LEFT JOIN users u ON u.id = p.assignee_id
     WHERE p.order_id = ? ORDER BY p.created_at, p.id`,
    orderId
  );
  return rows.map((row) => {
    const feedbacks = db.all<FeedbackRow>(
      `SELECT f.id, f.production_order_id, f.quantity, f.operator_id, f.note, f.created_at,
              u.display_name AS operator_name
       FROM production_feedbacks f JOIN users u ON u.id = f.operator_id
       WHERE f.production_order_id = ? ORDER BY f.created_at, f.id`,
      row.id
    );
    return {
      ...row,
      producedQty: feedbacks.reduce((sum, feedback) => sum + feedback.quantity, 0),
      feedbacks
    };
  });
}

export function getQcRecords(db: AppDatabase, orderId: string): QcRow[] {
  return db.all<QcRow>(
    `SELECT q.*, i.display_name AS inspector_name, d.display_name AS decided_by_name
     FROM qc_records q
     JOIN production_orders p ON p.id = q.production_order_id
     JOIN users i ON i.id = q.inspector_id
     LEFT JOIN users d ON d.id = q.decided_by
     WHERE p.order_id = ? ORDER BY q.created_at, q.id`,
    orderId
  );
}

export function getPacking(db: AppDatabase, orderId: string): PackingRow[] {
  return db.all<PackingRow>(
    `SELECT p.id, p.order_id, p.order_item_id, p.quantity, p.operator_id, p.note, p.created_at,
            u.display_name AS operator_name
     FROM packing_records p JOIN users u ON u.id = p.operator_id
     WHERE p.order_id = ? ORDER BY p.created_at, p.id`,
    orderId
  );
}

export function getShipments(db: AppDatabase, orderId: string): ShipmentRow[] {
  return db.all<ShipmentRow>(
    `SELECT s.id, s.order_id, s.order_item_id, s.quantity, s.operator_id, s.carrier,
            s.tracking_no, s.created_at, u.display_name AS operator_name
     FROM shipment_records s JOIN users u ON u.id = s.operator_id
     WHERE s.order_id = ? ORDER BY s.created_at, s.id`,
    orderId
  );
}

export interface QuantityState {
  ordered: number;
  purchased: number;
  arrived: number;
  taskQuantity: number | null;
  produced: number;
  inspected: number;
  qualified: number;
  released: number;
  packed: number;
  shipped: number;
}

export function getQuantityState(db: AppDatabase, order: OrderRow): QuantityState {
  const item = getSingleItemOrThrow(db, order.id);
  const purchase = getPurchase(db, order.id);
  const productions = getProductions(db, order.id);
  const qcs = getQcRecords(db, order.id);
  const packings = getPacking(db, order.id);
  const shipments = getShipments(db, order.id);
  return {
    ordered: item.quantity,
    purchased: purchase?.item?.quantity ?? 0,
    arrived: purchase?.arrivedQty ?? 0,
    taskQuantity:
      productions.length > 0
        ? productions.reduce((sum, production) => sum + production.quantity, 0)
        : null,
    produced: productions.reduce((sum, production) => sum + production.producedQty, 0),
    inspected: qcs.reduce((sum, record) => sum + record.inspected_qty, 0),
    qualified: qcs.reduce((sum, record) => sum + record.qualified_qty, 0),
    released: qcs
      .filter((record) => record.decision === 'PASS')
      .reduce((sum, record) => sum + record.qualified_qty, 0),
    packed: packings.reduce((sum, packing) => sum + packing.quantity, 0),
    shipped: shipments.reduce((sum, shipment) => sum + shipment.quantity, 0)
  };
}

export type AllowedAction =
  | 'CREATE_PURCHASE'
  | 'RECORD_ARRIVAL'
  | 'DISPATCH_PRODUCTION'
  | 'RECORD_FEEDBACK'
  | 'DISPATCH_QC'
  | 'RECORD_QC'
  | 'DECIDE_QC'
  | 'DISPATCH_PACKING'
  | 'RECORD_PACKING'
  | 'TRIGGER_SHIPMENT'
  | 'RECORD_SHIPMENT';

export interface OperationSummary {
  orderId: string;
  status: OrderStatus;
  statusLabel: string;
  quantities: QuantityState;
  allowedActions: AllowedAction[];
  nextStep: string;
  canCancel: boolean;
  cancelDeadline: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  perItem: Array<{
    itemId: string;
    productName: string;
    spec: string;
    ordered: number;
    packed: number;
    shipped: number;
    remainingToPack: number;
    remainingToShip: number;
  }>;
}

export function buildOperationSummary(db: AppDatabase, order: OrderRow): OperationSummary {
  const state = getQuantityState(db, order);
  const item = getSingleItemOrThrow(db, order.id);
  const allowed: AllowedAction[] = [];
  const hasPurchase = state.purchased > 0;
  const purchase = getPurchase(db, order.id);
  const productions = getProductions(db, order.id);
  const qcs = getQcRecords(db, order.id);
  const status = effectiveStatus(order);
  const withinCancelWindow = Date.now() <= Date.parse(cancelDeadline(order.created_at));
  const canCancel =
    status === 'PENDING_PURCHASE' && !purchase && !order.cancelled_at && withinCancelWindow;

  if (status === 'PENDING_PURCHASE' && !purchase) allowed.push('CREATE_PURCHASE');
  if (status === 'PURCHASING') {
    if (!purchase) allowed.push('CREATE_PURCHASE');
    else if (state.arrived < state.purchased) allowed.push('RECORD_ARRIVAL');
    else if (productions.length === 0) allowed.push('DISPATCH_PRODUCTION');
  }
  if (status === 'IN_PRODUCTION') {
    if (productions.some((production) => production.producedQty < production.quantity)) {
      allowed.push('RECORD_FEEDBACK');
    }
    if ((state.taskQuantity ?? 0) < state.ordered) {
      allowed.push('DISPATCH_PRODUCTION');
    }
    if (
      productions.length > 0 &&
      productions.every((production) => production.producedQty >= production.quantity) &&
      state.produced >= state.ordered &&
      qcs.length === 0
    ) {
      allowed.push('DISPATCH_QC');
    }
  }
  if (status === 'PENDING_QC') {
    const missingQc = productions.some(
      (production) => !qcs.some((qc) => qc.production_order_id === production.id)
    );
    if (missingQc) allowed.push('RECORD_QC');
    else if (qcs.some((qc) => qc.decision === null)) allowed.push('DECIDE_QC');
  }
  if (status === 'QC_DONE') {
    if (state.released > state.packed) allowed.push('DISPATCH_PACKING');
  }
  if (status === 'PACKING') {
    if (state.packed < state.released && state.packed < state.ordered) allowed.push('RECORD_PACKING');
    if (state.packed >= state.ordered && state.packed > state.shipped) allowed.push('TRIGGER_SHIPMENT');
  }
  if (status === 'SHIPPING') {
    if (state.shipped < state.packed && state.shipped < state.ordered) allowed.push('RECORD_SHIPMENT');
  }

  return {
    orderId: order.id,
    status,
    statusLabel: ORDER_STATUS_LABELS[status],
    quantities: state,
    allowedActions: allowed,
    nextStep: nextStepOf(status, state, hasPurchase),
    canCancel,
    cancelDeadline: canCancel ? cancelDeadline(order.created_at) : null,
    cancelledAt: order.cancelled_at,
    cancelReason: order.cancel_reason,
    perItem: [
      {
        itemId: item.id,
        productName: item.product_name,
        spec: item.spec,
        ordered: item.quantity,
        packed: state.packed,
        shipped: state.shipped,
        remainingToPack: Math.max(0, state.released - state.packed),
        remainingToShip: Math.max(0, Math.min(state.packed - state.shipped, state.ordered - state.shipped))
      }
    ]
  };
}

function nextStepOf(status: OrderStatus, state: QuantityState, hasPurchase: boolean): string {
  switch (status) {
    case 'PENDING_PURCHASE':
      return '建立采购单，选择供应商与配件';
    case 'PURCHASING':
      if (!hasPurchase) return '建立采购单';
      if (state.arrived < state.purchased) return `等待物流登记到货（${state.arrived}/${state.purchased}）`;
      return '材料到齐，下发生产任务';
    case 'IN_PRODUCTION':
      if (state.taskQuantity !== null && state.produced < state.taskQuantity) {
        return `等待生产反馈（${state.produced}/${state.taskQuantity}）`;
      }
      return '生产完成，下发质检';
    case 'PENDING_QC':
      if (state.inspected === 0) return '等待品控录入检验结果';
      if (state.released === 0) return '管理员处置质检结果（PASS）';
      return '质检已录入，管理员确认放行';
    case 'QC_DONE':
      return '放行完成，下发包装';
    case 'PACKING':
      if (state.packed < state.ordered) return `等待包装（${state.packed}/${state.ordered}）`;
      return '包装完成，触发发货';
    case 'SHIPPING':
      return `等待物流发货（${state.shipped}/${state.ordered}）`;
    case 'COMPLETED':
      return '订单已完成交付';
    case 'CANCELLED':
      return '订单已撤销，不再继续流转';
  }
}

export interface ProfitView extends ProfitBreakdown {
  orderId: string;
  sales: string;
  purchaseCost: string;
  productionCost: string;
  platingCost: string;
  profit: string;
  margin: string;
  scopeNote: string;
}

export function buildProfit(db: AppDatabase, order: OrderRow): ProfitView {
  if (order.cancelled_at) {
    const zero = computeProfit({ salesCents: 0, purchaseCents: 0, productionCents: 0 });
    return {
      ...zero,
      orderId: order.id,
      sales: '0.00',
      purchaseCost: '0.00',
      productionCost: '0.00',
      platingCost: '0.00',
      profit: '0.00',
      margin: '0.00',
      scopeNote: '订单已撤销，不计入预计利润。撤销前未发生采购或生产，因此成本为 0。'
    };
  }
  const sales = db.get<{ cents: number }>(
    'SELECT COALESCE(SUM(quantity * unit_price_cents), 0) AS cents FROM order_items WHERE order_id = ?',
    order.id
  );
  const purchase = db.get<{ cents: number }>(
    `SELECT COALESCE(SUM(pi.quantity * pi.unit_price_cents), 0) AS cents
     FROM purchase_items pi JOIN purchase_orders po ON po.id = pi.purchase_order_id
     WHERE po.order_id = ?`,
    order.id
  );
  const production = db.get<{ cents: number }>(
    `SELECT COALESCE(SUM(f.quantity * p.unit_price_cents), 0) AS cents
     FROM production_feedbacks f
     JOIN production_orders p ON p.id = f.production_order_id
     WHERE p.order_id = ?`,
    order.id
  );
  const breakdown = computeProfit({
    salesCents: sales?.cents ?? 0,
    purchaseCents: purchase?.cents ?? 0,
    productionCents: production?.cents ?? 0
  });
  return {
    ...breakdown,
    orderId: order.id,
    sales: formatCents(breakdown.salesCents),
    purchaseCost: formatCents(breakdown.purchaseCents),
    productionCost: formatCents(breakdown.productionCents),
    platingCost: formatCents(breakdown.platingCents),
    profit: formatCents(breakdown.profitCents),
    margin: breakdown.marginPercent,
    scopeNote: '预计利润：销售额 − 采购成本 − 电镀成本 − 已反馈生产完成量成本；不代表回款或财务结算。'
  };
}

const STAGE_DEFS: Array<{ key: string; label: string; event: TimelineEventType | null }> = [
  { key: 'ORDER', label: '建单', event: 'ORDER_CREATED' },
  { key: 'PURCHASE', label: '采购', event: 'PURCHASE_CREATED' },
  { key: 'ARRIVAL', label: '到货', event: 'ARRIVAL_RECORDED' },
  { key: 'PLATING', label: '电镀', event: null },
  { key: 'PRODUCTION', label: '生产', event: 'PRODUCTION_FEEDBACK' },
  { key: 'QC', label: '质检', event: 'QC_PASSED' },
  { key: 'PACKING', label: '包装', event: 'PACKING_RECORDED' },
  { key: 'SHIPPING', label: '发货', event: 'SHIPMENT_RECORDED' },
  { key: 'COMPLETED', label: '完成', event: 'ORDER_COMPLETED' }
];

export function buildStages(
  db: AppDatabase,
  order: OrderRow
): Array<{ key: string; label: string; state: 'DONE' | 'ACTIVE' | 'PENDING' | 'NOT_APPLICABLE'; at: string | null }> {
  const state = getQuantityState(db, order);
  const events = db.all<{ event_type: string; created_at: string }>(
    'SELECT event_type, created_at FROM order_timeline WHERE order_id = ? ORDER BY created_at, id',
    order.id
  );
  const eventTime = (type: string) => {
    const matches = events.filter((event) => event.event_type === type);
    return matches.length > 0 ? matches[matches.length - 1]!.created_at : null;
  };
  const done: Record<string, boolean> = {
    ORDER: true,
    PURCHASE: state.purchased > 0,
    ARRIVAL: state.purchased > 0 && state.arrived >= state.purchased,
    PLATING: false,
    PRODUCTION:
      state.taskQuantity !== null && state.taskQuantity > 0 && state.produced >= state.taskQuantity,
    QC: state.ordered > 0 && state.released >= state.ordered,
    PACKING: state.ordered > 0 && state.packed >= state.ordered,
    SHIPPING: state.ordered > 0 && state.shipped >= state.ordered,
    COMPLETED: order.status === 'COMPLETED'
  };
  let activeAssigned = false;
  return STAGE_DEFS.map((stage) => {
    if (stage.key === 'PLATING') {
      return { key: stage.key, label: stage.label, state: 'NOT_APPLICABLE' as const, at: null };
    }
    if (done[stage.key]) {
      return {
        key: stage.key,
        label: stage.label,
        state: 'DONE' as const,
        at: stage.event ? eventTime(stage.event) : null
      };
    }
    if (!activeAssigned) {
      activeAssigned = true;
      return {
        key: stage.key,
        label: stage.label,
        state: 'ACTIVE' as const,
        at: stage.event ? eventTime(stage.event) : null
      };
    }
    return {
      key: stage.key,
      label: stage.label,
      state: 'PENDING' as const,
      at: stage.event ? eventTime(stage.event) : null
    };
  });
}

export function getOrderDetail(db: AppDatabase, orderId: string) {
  const order = getOrderOrThrow(db, orderId);
  const items = getItems(db, orderId);
  const purchase = getPurchase(db, orderId);
  const productions = getProductions(db, orderId);
  const qcs = getQcRecords(db, orderId);
  const packing = getPacking(db, orderId);
  const shipments = getShipments(db, orderId);
  const status = effectiveStatus(order);
  return {
    order: {
      id: order.id,
      orderNo: order.order_no,
      status,
      statusLabel: ORDER_STATUS_LABELS[status],
      customer: { id: order.customer_id, name: order.customer_name },
      dueDate: order.due_date,
      note: order.note,
      createdAt: order.created_at,
      updatedAt: order.updated_at,
      cancelledAt: order.cancelled_at,
      cancelReason: order.cancel_reason
    },
    items: items.map((item) => ({
      id: item.id,
      productName: item.product_name,
      spec: item.spec,
      quantity: item.quantity,
      unitPriceCents: item.unit_price_cents,
      unitPrice: formatCents(item.unit_price_cents),
      amountCents: item.quantity * item.unit_price_cents,
      amount: formatCents(item.quantity * item.unit_price_cents)
    })),
    purchase: purchase
      ? {
          id: purchase.order.id,
          purchaseNo: purchase.order.purchase_no,
          supplier: { id: purchase.order.supplier_id, name: purchase.order.supplier_name },
          createdAt: purchase.order.created_at,
          item: purchase.item
            ? {
                id: purchase.item.id,
                partName: purchase.item.part_name,
                spec: purchase.item.spec,
                quantity: purchase.item.quantity,
                unitPriceCents: purchase.item.unit_price_cents,
                unitPrice: formatCents(purchase.item.unit_price_cents),
                amountCents: purchase.item.quantity * purchase.item.unit_price_cents,
                amount: formatCents(purchase.item.quantity * purchase.item.unit_price_cents),
                arrivedQty: purchase.arrivedQty,
                arrivals: purchase.arrivals.map((arrival) => ({
                  id: arrival.id,
                  quantity: arrival.quantity,
                  operatorName: arrival.operator_name,
                  note: arrival.note,
                  createdAt: arrival.created_at
                }))
              }
            : null
        }
      : null,
    production: productions.map((production) => ({
      id: production.id,
      department: { id: production.department_id, name: production.department_name },
      assignee: production.assignee_id
        ? { id: production.assignee_id, name: production.assignee_name }
        : null,
      processName: production.process_name,
      quantity: production.quantity,
      unitPriceCents: production.unit_price_cents,
      unitPrice: formatCents(production.unit_price_cents),
      priceVisible: production.price_visible === 1,
      dueDate: production.due_date,
      producedQty: production.producedQty,
      feedbacks: production.feedbacks.map((feedback) => ({
        id: feedback.id,
        quantity: feedback.quantity,
        operatorName: feedback.operator_name,
        note: feedback.note,
        createdAt: feedback.created_at
      })),
      createdAt: production.created_at
    })),
    qc: qcs.map((qc) => ({
      id: qc.id,
      inspectedQty: qc.inspected_qty,
      qualifiedQty: qc.qualified_qty,
      unqualifiedQty: qc.unqualified_qty,
      inspectorName: qc.inspector_name,
      decision: qc.decision,
      decidedByName: qc.decided_by_name,
      decidedAt: qc.decided_at,
      createdAt: qc.created_at
    })),
    packing: packing.map((row) => ({
      id: row.id,
      quantity: row.quantity,
      operatorName: row.operator_name,
      note: row.note,
      createdAt: row.created_at
    })),
    shipments: shipments.map((row) => ({
      id: row.id,
      quantity: row.quantity,
      operatorName: row.operator_name,
      carrier: row.carrier,
      trackingNo: row.tracking_no,
      createdAt: row.created_at
    }))
  };
}

export function getTimeline(db: AppDatabase, orderId: string): Array<TimelineRow & { payload: unknown }> {
  getOrderOrThrow(db, orderId);
  const rows = db.all<TimelineRow>(
    'SELECT * FROM order_timeline WHERE order_id = ? ORDER BY created_at, id',
    orderId
  );
  return rows.map((row) => ({
    ...row,
    payload: row.payload_json ? (JSON.parse(row.payload_json) as unknown) : null
  }));
}

export function setOrderStatus(db: AppDatabase, orderId: string, status: OrderStatus): void {
  db.run('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?', status, new Date().toISOString(), orderId);
}

export function assertOrderStatus(order: OrderRow, allowed: OrderStatus[], message: string): void {
  if (order.cancelled_at) {
    throw errors.invalidState('订单已撤销，不能继续执行该动作', {
      currentStatus: 'CANCELLED',
      statusLabel: ORDER_STATUS_LABELS.CANCELLED
    });
  }
  if (!allowed.includes(order.status)) {
    throw errors.invalidState(message, {
      currentStatus: order.status,
      statusLabel: ORDER_STATUS_LABELS[order.status]
    });
  }
}
