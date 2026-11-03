#!/usr/bin/env node
/**
 * 对运行中的服务做一次真实 HTTP 冒烟验收（合成数据）。
 * 用法：node backend/scripts/acceptance/smoke.mjs
 * 环境变量：BASE_URL（默认 http://127.0.0.1:8787）
 */
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8787';
const results = [];
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    results.push(`PASS  ${name}${detail ? `  (${detail})` : ''}`);
  } else {
    failed += 1;
    results.push(`FAIL  ${name}${detail ? `  (${detail})` : ''}`);
  }
}

async function login(username, password = 'Demo@2026') {
  const response = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  if (response.status !== 200) throw new Error(`登录失败 ${username}: ${response.status} ${await response.text()}`);
  return response.headers.getSetCookie()[0].split(';')[0];
}

async function api(cookie, method, path, body, key) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (key) headers['idempotency-key'] = key;
  const response = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { raw: text };
  }
  return { status: response.status, data: payload.data, error: payload.error, headers: response.headers };
}

const runId = Date.now().toString(36);
const due = new Date(Date.now() + 12 * 86_400_000).toISOString().slice(0, 10);
const key = (name) => `${name}-${runId}`;

const health = await fetch(`${BASE}/api/v1/health`);
check('健康检查', health.status === 200);

const unauthorized = await api(null, 'POST', '/inventory/parts/adjust', { partId: 'x', delta: 1, reason: 'x' }, key('unauth'));
check('未认证库存写入返回 401', unauthorized.status === 401);

const admin = await login('admin');
const logistics = await login('logistics');
const prod = await login('prod');
const prod2 = await login('prod2');
const qc = await login('qc');
const pack = await login('pack');

const customers = await api(admin, 'GET', '/customers');
const suppliers = await api(admin, 'GET', '/suppliers');
const parts = await api(admin, 'GET', '/parts');
const departments = await api(admin, 'GET', '/departments');
const users = await api(admin, 'GET', '/users?role=PRODUCTION');
const customerId = customers.data.items[0].id;
const supplierId = suppliers.data.items[0].id;
const partId = parts.data.items[0].id;
const dept = departments.data.items.find((row) => row.category === 'PRODUCTION');
const prodUser = users.data.items.find((row) => row.username === 'prod');

const orderKey = key('order');
const createBody = {
  customerId,
  dueDate: due,
  note: `HTTP 验收 ${runId}`,
  item: { partId, productName: 'HTTP验收产品', spec: 'HTTP-01', quantity: 10, unitPrice: '12.50' }
};
const created = await api(admin, 'POST', '/orders', createBody, orderKey);
check('建单 201', created.status === 201, created.data?.orderNo);
const orderId = created.data.id;
const replayOrder = await api(admin, 'POST', '/orders', createBody, orderKey);
check('建单同键重放同一订单', replayOrder.status === 200 && replayOrder.data.id === orderId);

const purchase = await api(
  admin,
  'POST',
  `/orders/${orderId}/purchase-orders`,
  { supplierId, item: { partId, quantity: 12, unitPrice: '2.10' } },
  key('po')
);
check('采购单建立', purchase.status === 201);
const purchaseItemId = purchase.data.purchaseItemId;

const arrivalKey = key('arrival');
const arrival = await api(logistics, 'POST', `/purchase-items/${purchaseItemId}/arrivals`, { quantity: 12, note: '一次到齐' }, arrivalKey);
check('物流到货 12', arrival.status === 201 && arrival.data.arrivedQty === 12);
const replayArrival = await api(logistics, 'POST', `/purchase-items/${purchaseItemId}/arrivals`, { quantity: 12, note: '一次到齐' }, arrivalKey);
check('到货同键重放同一记录', replayArrival.status === 200 && replayArrival.data.id === arrival.data.id);

const item = (await api(admin, 'GET', `/orders/${orderId}`)).data.items[0];
const task = await api(
  admin,
  'POST',
  `/orders/${orderId}/production-orders`,
  {
    orderItemId: item.id,
    departmentId: dept.id,
    assigneeId: prodUser?.id ?? null,
    processName: 'HTTP验收工艺',
    quantity: 10,
    unitPrice: '1.20',
    dueDate: due,
    priceVisible: false
  },
  key('task')
);
check('下发生产', task.status === 201);
const taskId = task.data.id;
const wrongDept = await api(prod2, 'POST', `/production-orders/${taskId}/feedbacks`, { quantity: 1, note: '越权' }, key('wrong'));
check('跨部门反馈 404', wrongDept.status === 404);

const feedback = await api(prod, 'POST', `/production-orders/${taskId}/feedbacks`, { quantity: 10, note: '完成' }, key('feedback'));
check('生产反馈 10', feedback.status === 201 && feedback.data.completed === true);

await api(admin, 'POST', `/orders/${orderId}/dispatch-qc`, {}, key('qcd'));
const qcRecord = await api(
  qc,
  'POST',
  `/production-orders/${taskId}/qc-records`,
  { inspectedQuantity: 10, qualifiedQuantity: 10, unqualifiedQuantity: 0 },
  key('qc')
);
check('品控全检录入', qcRecord.status === 201);
const decision = await api(admin, 'POST', `/qc-records/${qcRecord.data.id}/decision`, { decision: 'PASS' }, key('pass'));
check('管理员 PASS 放行', decision.status === 200 && decision.data.releasedQty === 10);

await api(admin, 'POST', `/orders/${orderId}/dispatch-packing`, {}, key('packd'));
const packing = await api(pack, 'POST', `/orders/${orderId}/packing-records`, { quantity: 10 }, key('pack'));
check('包装 10', packing.status === 201);
await api(admin, 'POST', `/orders/${orderId}/trigger-shipment`, {}, key('trigger'));
const shipment = await api(logistics, 'POST', `/orders/${orderId}/shipments`, { quantity: 10, carrier: '验收物流', trackingNo: `TRK-${runId}` }, key('ship'));
check('发货 10 完成', shipment.status === 201 && shipment.data.completed === true);

const detail = await api(admin, 'GET', `/orders/${orderId}`);
check('订单 COMPLETED', detail.data.order.status === 'COMPLETED');
check('利润 87.80 / 70.24%', detail.data.profit.profit === '87.80' && detail.data.profit.margin === '70.24');

const timeline = await api(admin, 'GET', `/orders/${orderId}/timeline`);
check('时间线 13 事件', timeline.data.events.length === 13, `actual=${timeline.data.events.length}`);

const exportResponse = await fetch(`${BASE}/api/v1/exports/orders.xlsx`, { headers: { cookie: admin } });
const exportBytes = Buffer.from(await exportResponse.arrayBuffer());
check('订单 xlsx 导出', exportResponse.status === 200 && exportBytes.subarray(0, 2).toString() === 'PK', `${exportBytes.length} bytes`);

const inventory = await api(admin, 'POST', '/inventory/parts/adjust', { partId, delta: 10, reason: 'HTTP验收入库' }, key('inventory'));
const insufficient = await api(admin, 'POST', '/inventory/parts/adjust', { partId, delta: -999, reason: 'HTTP验收超领' }, key('inventory-fail'));
check('库存 +10 与负库存拒绝', inventory.status === 200 && insufficient.status === 409);

console.log(results.join('\n'));
console.log(`\n${failed === 0 ? 'ACCEPTANCE PASS' : `ACCEPTANCE FAIL (${failed})`}  order=${detail.data.order.orderNo} id=${orderId}`);
process.exit(failed === 0 ? 0 : 1);
