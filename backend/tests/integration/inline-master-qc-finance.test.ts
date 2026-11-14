import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { call, createTestEnv, futureDate, key, login, masterIds, type TestEnv } from '../helpers.js';

let env: TestEnv;
let admin = '';
let logistics = '';
let prod = '';
let qc = '';
let pack = '';
let ids: ReturnType<typeof masterIds>;

before(async () => {
  env = await createTestEnv();
  ids = masterIds(env.db);
  admin = await login(env.app, 'admin');
  logistics = await login(env.app, 'logistics');
  prod = await login(env.app, 'prod');
  qc = await login(env.app, 'qc');
  pack = await login(env.app, 'pack');
});

after(async () => {
  await env.close();
});

test('建单时直接输入新客户与新配件，自动建档并保留快照', async () => {
  const created = await call(
    env.app,
    admin,
    'POST',
    '/orders',
    {
      customerName: '现场新客户（合成）',
      dueDate: futureDate(10),
      item: {
        partName: '现场新配件（合成）',
        spec: 'INLINE-01',
        productName: '现场新建档产品',
        quantity: 5,
        unitPrice: '12.00'
      }
    },
    key('inline-order')
  );
  assert.equal(created.statusCode, 201, created.body);
  const orderId = created.json().data.id;

  const customers = await call(env.app, admin, 'GET', `/customers?search=${encodeURIComponent('现场新客户')}`);
  assert.equal(customers.json().data.items.length, 1);
  assert.match(customers.json().data.items[0].code, /^CUS-[A-Z0-9]{6}$/);

  const parts = await call(env.app, admin, 'GET', `/parts?search=${encodeURIComponent('现场新配件')}`);
  assert.equal(parts.json().data.items.length, 1);
  assert.equal(parts.json().data.items[0].spec, 'INLINE-01');

  const detail = await call(env.app, admin, 'GET', `/orders/${orderId}`);
  assert.equal(detail.json().data.order.customer.name, '现场新客户（合成）');
  assert.equal(detail.json().data.items[0].productName, '现场新建档产品');

  // 重复输入同名客户不会重复建档
  const again = await call(
    env.app,
    admin,
    'POST',
    '/orders',
    {
      customerName: '现场新客户（合成）',
      dueDate: futureDate(10),
      item: { productName: '同名客户第二单', quantity: 1, unitPrice: '1.00' }
    },
    key('inline-order-2')
  );
  assert.equal(again.statusCode, 201, again.body);
  const customersAgain = await call(env.app, admin, 'GET', `/customers?search=${encodeURIComponent('现场新客户')}`);
  assert.equal(customersAgain.json().data.items.length, 1);
});

test('采购时直接输入新供应商与新采购配件', async () => {
  const order = await call(
    env.app,
    admin,
    'POST',
    '/orders',
    {
      customerId: ids.customerId,
      dueDate: futureDate(10),
      item: { productName: '采购现场建档产品', quantity: 3, unitPrice: '10.00' }
    },
    key('purchase-inline-order')
  );
  const orderId = order.json().data.id;
  const purchase = await call(
    env.app,
    admin,
    'POST',
    `/orders/${orderId}/purchase-orders`,
    {
      supplierName: '现场新供应商（合成）',
      item: { partName: '现场新采购件（合成）', spec: 'SUP-01', quantity: 3, unitPrice: '2.00' }
    },
    key('purchase-inline')
  );
  assert.equal(purchase.statusCode, 201, purchase.body);

  const suppliers = await call(env.app, admin, 'GET', `/suppliers?search=${encodeURIComponent('现场新供应商')}`);
  assert.equal(suppliers.json().data.items.length, 1);
  assert.match(suppliers.json().data.items[0].code, /^SUP-[A-Z0-9]{6}$/);
  const detail = await call(env.app, admin, 'GET', `/orders/${orderId}`);
  assert.equal(detail.json().data.purchase.supplier.name, '现场新供应商（合成）');
  assert.equal(detail.json().data.purchase.item.partName, '现场新采购件（合成）');
});

async function setupOrderToQc(quantity: number): Promise<{ orderId: string; taskId: string }> {
  const order = await call(
    env.app,
    admin,
    'POST',
    '/orders',
    {
      customerId: ids.customerId,
      dueDate: futureDate(12),
      item: { productName: '不合格处置验证产品', spec: 'QC-01', quantity, unitPrice: '10.00' }
    },
    key('qc-order')
  );
  const orderId = order.json().data.id;
  const purchase = await call(
    env.app,
    admin,
    'POST',
    `/orders/${orderId}/purchase-orders`,
    { supplierId: ids.supplierId, item: { partId: ids.partId, quantity, unitPrice: '2.00' } },
    key('qc-po')
  );
  await call(
    env.app,
    logistics,
    'POST',
    `/purchase-items/${purchase.json().data.purchaseItemId}/arrivals`,
    { quantity },
    key('qc-arrival')
  );
  const itemId = env.db.get<{ id: string }>('SELECT id FROM order_items WHERE order_id = ?', orderId)!.id;
  const task = await call(
    env.app,
    admin,
    'POST',
    `/orders/${orderId}/production-orders`,
    {
      orderItemId: itemId,
      departmentId: ids.departmentId,
      processName: '不合格验证工艺',
      quantity,
      unitPrice: '1.00',
      dueDate: futureDate(5),
      priceVisible: false
    },
    key('qc-task')
  );
  const taskId = task.json().data.id;
  await call(env.app, prod, 'POST', `/production-orders/${taskId}/feedbacks`, { quantity }, key('qc-feedback'));
  await call(env.app, admin, 'POST', `/orders/${orderId}/dispatch-qc`, {}, key('qc-dispatch'));
  return { orderId, taskId };
}

test('质检不合格：不能直接 PASS，返工后补产、复检可完成，并写入时间线', async () => {
  const { orderId, taskId } = await setupOrderToQc(10);

  const worst = await call(
    env.app,
    qc,
    'POST',
    `/production-orders/${taskId}/qc-records`,
    { inspectedQuantity: 10, qualifiedQuantity: 9, unqualifiedQuantity: 1, note: '尺寸超差 1 件' },
    key('qc-bad')
  );
  assert.equal(worst.statusCode, 201, worst.body);
  const recordId = worst.json().data.id;

  const pass = await call(env.app, admin, 'POST', `/qc-records/${recordId}/decision`, { decision: 'PASS' }, key('qc-pass'));
  assert.equal(pass.statusCode, 409);

  const rework = await call(
    env.app,
    admin,
    'POST',
    `/qc-records/${recordId}/decision`,
    { decision: 'REWORK', note: '退回返工' },
    key('qc-rework')
  );
  assert.equal(rework.statusCode, 200, rework.body);
  assert.equal(rework.json().data.orderStatus, 'IN_PRODUCTION');

  const detail = await call(env.app, admin, 'GET', `/orders/${orderId}`);
  assert.equal(detail.json().data.summary.quantities.released, 9);
  assert.match(detail.json().data.summary.nextStep, /补产 1 件/);

  const itemId = env.db.get<{ id: string }>('SELECT id FROM order_items WHERE order_id = ?', orderId)!.id;
  const reworkTask = await call(
    env.app,
    admin,
    'POST',
    `/orders/${orderId}/production-orders`,
    {
      orderItemId: itemId,
      departmentId: ids.departmentId,
      processName: '返工',
      quantity: 1,
      unitPrice: '1.00',
      dueDate: futureDate(5),
      priceVisible: false
    },
    key('qc-rework-task')
  );
  assert.equal(reworkTask.statusCode, 201, reworkTask.body);
  const reworkTaskId = reworkTask.json().data.id;
  await call(env.app, prod, 'POST', `/production-orders/${reworkTaskId}/feedbacks`, { quantity: 1 }, key('qc-rework-fb'));
  await call(env.app, admin, 'POST', `/orders/${orderId}/dispatch-qc`, {}, key('qc-redispatch'));

  const reRecord = await call(
    env.app,
    qc,
    'POST',
    `/production-orders/${reworkTaskId}/qc-records`,
    { inspectedQuantity: 1, qualifiedQuantity: 1, unqualifiedQuantity: 0 },
    key('qc-re-record')
  );
  assert.equal(reRecord.statusCode, 201, reRecord.body);
  const pass2 = await call(
    env.app,
    admin,
    'POST',
    `/qc-records/${reRecord.json().data.id}/decision`,
    { decision: 'PASS' },
    key('qc-pass-2')
  );
  assert.equal(pass2.statusCode, 200, pass2.body);
  assert.equal(pass2.json().data.orderStatus, 'QC_DONE');
  assert.equal(pass2.json().data.releasedQty, 10);

  const timeline = await call(env.app, admin, 'GET', `/orders/${orderId}/timeline`);
  const events = timeline.json().data.events.map((event: { event_type: string }) => event.event_type);
  assert.ok(events.includes('QC_REWORKED'));
  assert.ok(events.includes('QC_PASSED'));
});

test('质检不合格：报废同样退回生产，放行量不包含报废数量', async () => {
  const { orderId, taskId } = await setupOrderToQc(6);
  const record = await call(
    env.app,
    qc,
    'POST',
    `/production-orders/${taskId}/qc-records`,
    { inspectedQuantity: 6, qualifiedQuantity: 4, unqualifiedQuantity: 2, note: '报废 2 件' },
    key('qc-scrap-record')
  );
  assert.equal(record.statusCode, 201, record.body);
  const scrap = await call(
    env.app,
    admin,
    'POST',
    `/qc-records/${record.json().data.id}/decision`,
    { decision: 'SCRAP', note: '确认报废' },
    key('qc-scrap')
  );
  assert.equal(scrap.statusCode, 200, scrap.body);
  assert.equal(scrap.json().data.orderStatus, 'IN_PRODUCTION');

  const detail = await call(env.app, admin, 'GET', `/orders/${orderId}`);
  assert.equal(detail.json().data.summary.quantities.released, 4);
  const timeline = await call(env.app, admin, 'GET', `/orders/${orderId}/timeline`);
  assert.ok(timeline.json().data.events.some((event: { event_type: string }) => event.event_type === 'QC_SCRAPPED'));
});

test('订单流水：实时汇总销售额、采购、生产与利润，撤销单不计入合计', async () => {
  const summary = await call(env.app, admin, 'GET', '/finance/summary');
  assert.equal(summary.statusCode, 200, summary.body);
  const data = summary.json().data;
  assert.ok(data.orders.length >= 4);
  assert.equal(typeof data.totals.sales, 'string');
  assert.equal(typeof data.totals.margin, 'string');
  assert.match(data.scopeNote, /不含电镀/);

  const active = data.orders.filter((row: { cancelled: boolean }) => !row.cancelled);
  const salesSum = active.reduce((sum: number, row: { salesCents: number }) => sum + row.salesCents, 0);
  assert.equal(data.totals.salesCents, salesSum);

  // 建一张再撤销，确认撤销单出现在列表但不进入合计
  const order = await call(
    env.app,
    admin,
    'POST',
    '/orders',
    {
      customerId: ids.customerId,
      dueDate: futureDate(3),
      item: { productName: '流水验证撤销单', quantity: 1, unitPrice: '100.00' }
    },
    key('finance-cancel-order')
  );
  const orderId = order.json().data.id;
  await call(env.app, admin, 'POST', `/orders/${orderId}/cancel`, { reason: '流水验证' }, key('finance-cancel'));

  const after = await call(env.app, admin, 'GET', '/finance/summary');
  const afterData = after.json().data;
  const cancelledRow = afterData.orders.find((row: { id: string }) => row.id === orderId);
  assert.equal(cancelledRow.cancelled, true);
  assert.equal(afterData.totals.salesCents, data.totals.salesCents);
  assert.ok(afterData.totals.cancelledOrders >= 1);

  const denied = await call(env.app, logistics, 'GET', '/finance/summary');
  assert.equal(denied.statusCode, 403);
});