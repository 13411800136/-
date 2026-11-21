import type { AuditItem } from './types';

/** 审计动作 → 人话（谁做了什么），不展示内部代码。 */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  ORDER_CREATE: '创建了订单',
  ORDER_WITHDRAW: '撤回了订单',
  ORDER_DELETE: '删除了订单',
  ORDER_ARCHIVE: '归档了订单',
  ORDER_CANCEL: '撤销了订单',
  ORDER_BATCH_CONFIRM_SHIPMENT: '批量确认发货',
  PURCHASE_CREATE: '建立了采购单',
  ARRIVAL_CREATE: '登记了到货',
  PRODUCTION_DISPATCH: '派发了生产任务',
  PRODUCTION_FEEDBACK: '反馈了生产进度',
  PRODUCTION_PRICE_VISIBILITY: '调整了生产价格可见性',
  QC_DISPATCH: '派发了质检任务',
  QC_RECORD: '录入了质检结果',
  QC_DECISION: '处置了质检不合格',
  PACKING_DISPATCH: '派发了包装任务',
  PACKING_RECORD: '登记了包装',
  SHIPMENT_TRIGGER: '触发了发货',
  SHIPMENT_RECORD: '登记了发货',
  EXCEPTION_ACKNOWLEDGE: '受理了现场异常',
  EXCEPTION_RESOLVE: '解决了现场异常',
  TABLET_EXCEPTION_CREATE: '上报了现场异常',
  MESSAGE_SEND: '发送了内部消息',
  ATTACHMENT_UPLOAD: '上传了附件',
  INVENTORY_PART_ADJUST: '调整了配件库存',
  INVENTORY_PRODUCT_ADJUST: '调整了成品库存',
  EXPORT_ORDERS_XLSX: '导出了订单 Excel',
  EXPORT_INVENTORY_XLSX: '导出了库存 Excel',
  USER_CREATE: '创建了员工账号',
  USER_UPDATE: '修改了员工账号',
  DEPARTMENT_CREATE: '创建了部门',
  PARTS_CREATE: '创建了配件',
  AUTH_LOGIN: '登录了系统',
  AUTH_LOGOUT: '退出了系统'
};

export const AUDIT_RESOURCE_LABELS: Record<string, string> = {
  ORDER: '订单',
  PURCHASE_ORDER: '采购单',
  ARRIVAL: '到货单',
  PRODUCTION_ORDER: '生产任务',
  QC_RECORD: '质检单',
  PACKING: '包装单',
  SHIPMENT: '发货单',
  PART_INVENTORY: '配件库存',
  PRODUCT_INVENTORY: '成品库存',
  ATTACHMENT: '附件',
  USER: '员工账号',
  SESSION: '登录会话',
  INTERNAL_MESSAGE: '内部消息',
  DEPARTMENT: '部门',
  PART: '配件',
  EXCEPTION: '现场异常'
};

/** 字段 → 中文名；只展示业务字段，技术字段不呈现。 */
const FIELD_LABELS: Record<string, string> = {
  status: '状态',
  reason: '原因',
  orderNo: '订单号',
  quantity: '数量',
  unitPrice: '单价',
  totalAmount: '金额',
  dueDate: '交期',
  customerName: '客户',
  productName: '产品',
  name: '名称',
  note: '备注',
  amount: '数量',
  readAt: '已读时间',
  archivedAt: '归档时间',
  deletedAt: '删除时间',
  withdrawnAt: '撤回时间',
  cancelledAt: '撤销时间',
  priceVisible: '价格可见',
  category: '分类',
  description: '描述',
  role: '角色',
  departmentId: '部门',
  supplierId: '供应商',
  partId: '配件',
  batchNo: '批次',
  inspectedQuantity: '检验数量',
  decision: '处置结论',
  productionOrderId: '生产任务',
  exceptionId: '异常记录',
  acknowledgedAt: '受理时间',
  resolvedAt: '解决时间',
  resolutionNote: '处理结论',
  archived: '是否归档',
  deleted: '是否删除'
};

const ORDER_STATUS_LABELS: Record<string, string> = {
  PENDING_PURCHASE: '待采购',
  PURCHASING: '采购中',
  IN_PRODUCTION: '生产中',
  PENDING_QC: '待质检',
  QC_DONE: '质检已放行',
  PACKING: '包装中',
  SHIPPING: '待发货',
  COMPLETED: '已完成',
  CANCELLED: '已撤销',
  OPEN: '待处理',
  ACKNOWLEDGED: '处理中',
  RESOLVED: '已解决'
};

const ROLE_LABELS: Record<string, string> = {
  ADMIN: '管理员',
  LOGISTICS: '物流',
  PRODUCTION: '生产',
  QC: '品控',
  PACKING: '包装'
};

const SKIP_FIELDS = new Set([
  'id',
  'requestId',
  'createdAt',
  'updatedAt',
  'actorId',
  'actorName',
  'password',
  'passwordHash',
  'token',
  'sessionId',
  'dedupeKey'
]);

function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'string') {
    if (key === 'status') return ORDER_STATUS_LABELS[value] ?? value;
    if (key === 'role') return ROLE_LABELS[value] ?? value;
    return value;
  }
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.length === 0 ? '—' : `${value.length} 项`;
  return '已更新';
}

export interface AuditChange {
  key: string;
  label: string;
  before: string;
  after: string;
  kind: 'added' | 'removed' | 'changed';
}

export function auditChanges(item: AuditItem): AuditChange[] {
  const before = (item.before ?? {}) as Record<string, unknown>;
  const after = (item.after ?? {}) as Record<string, unknown>;
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes: AuditChange[] = [];
  for (const key of keys) {
    if (SKIP_FIELDS.has(key)) continue;
    const label = FIELD_LABELS[key];
    if (!label) continue;
    const from = formatValue(key, before[key]);
    const to = formatValue(key, after[key]);
    if (from === to) continue;
    const kind = from === '—' ? 'added' : to === '—' ? 'removed' : 'changed';
    changes.push({ key, label, before: from, after: to, kind });
  }
  return changes;
}

/** 不附加对象的纯动作，避免“登录了系统 登录会话（编号…）”这类冗余。 */
const ACTIONS_WITHOUT_TARGET = new Set(['AUTH_LOGIN', 'AUTH_LOGOUT', 'EXPORT_ORDERS_XLSX', 'EXPORT_INVENTORY_XLSX']);

/** 一句话说明“谁做了什么、对象是谁”。 */
export function auditSummary(item: AuditItem): string {
  const verb = AUDIT_ACTION_LABELS[item.action] ?? '执行了业务操作';
  if (ACTIONS_WITHOUT_TARGET.has(item.action)) return verb;
  return `${verb} ${auditTarget(item)}`;
}

/** 对象：优先业务单号，其次资源名。 */
export function auditTarget(item: AuditItem): string {
  const before = (item.before ?? {}) as Record<string, unknown>;
  const after = (item.after ?? {}) as Record<string, unknown>;
  const orderNo = (after.orderNo ?? before.orderNo) as string | undefined;
  const resource = AUDIT_RESOURCE_LABELS[item.resourceType] ?? '业务对象';
  if (orderNo) return `${resource} ${orderNo}`;
  if (item.resourceId) return `${resource}（编号 ${item.resourceId.slice(0, 8)}）`;
  return resource;
}

/** 失败时补充原因。 */
export function auditResultText(item: AuditItem): string {
  if (item.result === 'SUCCESS') return '成功';
  return item.errorCode ? `失败 · ${item.errorCode}` : '失败';
}