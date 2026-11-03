export type Role = 'ADMIN' | 'LOGISTICS' | 'PRODUCTION' | 'QC' | 'PACKING';

export interface User {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  departmentId: string | null;
  departmentName: string | null;
  departmentCategory: string | null;
  isSuperAdmin: boolean;
}

export interface DemoAccount {
  username: string;
  displayName: string;
  role: Role;
  departmentName: string | null;
  password: string;
}

export interface Pagination {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface OrderListItem {
  id: string;
  orderNo: string;
  customerName: string;
  productName: string;
  spec: string;
  quantity: number;
  unitPrice: string;
  amount: string;
  dueDate: string;
  status: OrderStatus;
  statusLabel: string;
  note: string;
  createdAt: string;
}

export type OrderStatus =
  | 'PENDING_PURCHASE'
  | 'PURCHASING'
  | 'IN_PRODUCTION'
  | 'PENDING_QC'
  | 'QC_DONE'
  | 'PACKING'
  | 'SHIPPING'
  | 'COMPLETED';

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

export interface OperationSummary {
  orderId: string;
  status: OrderStatus;
  statusLabel: string;
  quantities: QuantityState;
  allowedActions: AllowedAction[];
  nextStep: string;
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

export interface Stage {
  key: string;
  label: string;
  state: 'DONE' | 'ACTIVE' | 'PENDING' | 'NOT_APPLICABLE';
  at: string | null;
}

export interface Profit {
  salesCents: number;
  purchaseCents: number;
  platingCents: number;
  productionCents: number;
  profitCents: number;
  marginPercent: string;
  orderId: string;
  sales: string;
  purchaseCost: string;
  productionCost: string;
  platingCost: string;
  profit: string;
  margin: string;
  scopeNote: string;
}

export interface TimelineEvent {
  id: string;
  order_id: string;
  event_type: string;
  actor_name: string;
  resource_type: string;
  resource_id: string;
  quantity: number | null;
  payload: unknown;
  created_at: string;
}

export interface Arrival {
  id: string;
  quantity: number;
  operatorName: string;
  note: string;
  createdAt: string;
}

export interface Feedback {
  id: string;
  quantity: number;
  operatorName: string;
  note: string;
  createdAt: string;
}

export interface OrderDetail {
  order: {
    id: string;
    orderNo: string;
    status: OrderStatus;
    statusLabel: string;
    customer: { id: string; name: string };
    dueDate: string;
    note: string;
    createdAt: string;
    updatedAt: string;
  };
  items: Array<{
    id: string;
    productName: string;
    spec: string;
    quantity: number;
    unitPriceCents: number;
    unitPrice: string;
    amountCents: number;
    amount: string;
  }>;
  purchase: null | {
    id: string;
    purchaseNo: string;
    supplier: { id: string; name: string };
    createdAt: string;
    item: null | {
      id: string;
      partName: string;
      spec: string;
      quantity: number;
      unitPriceCents: number;
      unitPrice: string;
      amountCents: number;
      amount: string;
      arrivedQty: number;
      arrivals: Arrival[];
    };
  };
  production: Array<{
    id: string;
    department: { id: string; name: string };
    assignee: { id: string; name: string } | null;
    processName: string;
    quantity: number;
    unitPriceCents: number;
    unitPrice: string;
    priceVisible: boolean;
    dueDate: string;
    producedQty: number;
    feedbacks: Feedback[];
    createdAt: string;
  }>;
  qc: Array<{
    id: string;
    inspectedQty: number;
    qualifiedQty: number;
    unqualifiedQty: number;
    inspectorName: string;
    decision: 'PASS' | 'REWORK' | 'SCRAP' | null;
    decidedByName: string | null;
    decidedAt: string | null;
    createdAt: string;
  }>;
  packing: Array<{ id: string; quantity: number; operatorName: string; note: string; createdAt: string }>;
  shipments: Array<{
    id: string;
    quantity: number;
    operatorName: string;
    carrier: string;
    trackingNo: string;
    createdAt: string;
  }>;
  summary: OperationSummary;
  profit: Profit;
  stages: Stage[];
  requestId?: string;
}

export interface Attachment {
  id: string;
  originalName: string;
  mime: string;
  size: number;
  uploadedByName: string;
  createdAt: string;
  downloadUrl: string;
}

export interface NotificationItem {
  id: string;
  eventType: string;
  title: string;
  body: string;
  resourceType: string;
  resourceId: string;
  read: boolean;
  readAt: string | null;
  createdAt: string;
}

export interface DashboardSummary {
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

export interface PartInventoryItem {
  partId: string;
  code: string;
  name: string;
  spec: string;
  unit: string;
  active: boolean;
  inventoryId: string | null;
  quantity: number;
  version: number;
  updatedAt: string | null;
}

export interface ProductInventoryItem {
  inventoryId: string;
  productKey: string;
  productName: string;
  spec: string;
  quantity: number;
  version: number;
  updatedAt: string;
}

export interface InventoryLog {
  id: string;
  before: number;
  delta: number;
  after: number;
  reason: string;
  operatorName: string;
  createdAt: string;
}

export interface ProductionTask {
  id: string;
  orderId: string;
  orderNo: string;
  orderStatus: string;
  orderStatusLabel: string;
  productName: string;
  spec: string;
  orderQuantity: number;
  processName: string;
  quantity: number;
  producedQty: number;
  remainingQty: number;
  departmentId: string;
  departmentName: string;
  assigneeName: string | null;
  dueDate: string;
  priceVisible: boolean;
  unitPrice?: string;
  createdAt: string;
}

export interface LogisticsQueue {
  arrivals: Array<{
    orderId: string;
    orderNo: string;
    productName: string;
    spec: string;
    purchaseItemId: string;
    partName: string;
    purchasedQty: number;
    arrivedQty: number;
    remainingQty: number;
    dueDate: string;
  }>;
  shipments: Array<{
    orderId: string;
    orderNo: string;
    productName: string;
    spec: string;
    orderedQty: number;
    packedQty: number;
    shippedQty: number;
    remainingQty: number;
    dueDate: string;
  }>;
}

export interface QcTask {
  productionOrderId: string;
  orderId: string;
  orderNo: string;
  productName: string;
  spec: string;
  taskQuantity: number;
  producedQty: number;
  processName: string;
  departmentName: string;
  dueDate: string;
}

export interface PackingTask {
  orderId: string;
  orderNo: string;
  productName: string;
  spec: string;
  orderedQty: number;
  releasedQty: number;
  packedQty: number;
  remainingQty: number;
  dueDate: string;
}

export interface ExceptionItem {
  id: string;
  orderId: string;
  orderNo: string;
  productionOrderId?: string | null;
  category: string;
  categoryLabel?: string;
  description: string;
  status: string;
  reporterName: string;
  createdAt: string;
}

export interface AuditItem {
  id: string;
  requestId: string;
  actorName: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  result: string;
  errorCode: string | null;
  before: unknown;
  after: unknown;
  detail: string | null;
  createdAt: string;
}
