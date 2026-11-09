import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { call, createTestEnv, futureDate, key, login, masterIds, type TestEnv } from '../helpers.js';

let env: TestEnv;
let admin = '';
let logistics = '';
let prod = '';
let prod2 = '';
let qc = '';
let pack = '';
let ids: ReturnType<typeof masterIds>;

before(async () => {
  env = await createTestEnv();
  ids = masterIds(env.db);
  admin = await login(env.app, 'admin');
  logistics = await login(env.app, 'logistics');
  prod = await login(env.app, 'prod');
  prod2 = await login(env.app, 'prod2');
  qc = await login(env.app, 'qc');
  pack = await login(env.app, 'pack');
});

after(async () => {
  await env.close();
});

async function createOrder(quantity = 10): Promise<string> {
  const response = await call(
    env.app,
    admin,
    'POST',
    '/orders',
    {
      customerId: ids.customerId,
      dueDate: futureDate(12),
      item: {
        partId: ids.partId,
        productName: '运营增强验证产品',
        spec: 'OPS-01',
        quantity,
        unitPrice: '10.00'
      }
    },
    key('ops-order')
  );
  assert.equal(response.statusCode, 201, response.body);
  return response.json().data.id;
}

async function advanceToPacking(quantity = 10): Promise<string> {
  const orderId = await createOrder(quantity);
  const purchase = await call(
    env.app,
    admin,
    'POST',
    `/orders/${orderId}/purchase-orders`,
    { supplierId: ids.supplierId, item: { partId: ids.partId, quantity, unitPrice: '2.00' } },
    key('ops-po')
  );
  const item = env.db.get<{ id: string }>('SELECT id FROM order_items WHERE order_id = ?', orderId)!;
  assert.equal(purchase.statusCode, 201, purchase.body);
  const purchaseItemId = purchase.json().data.purchaseItemId;
  await call(env.app, logistics, 'POST', `/purchase-items/${purchaseItemId}/arrivals`, { quantity }, key('ops-arrival'));
  const task = await call(
    env.app,
    admin,
    'POST',
    `/orders/${orderId}/production-orders`,
    {
      orderItemId: item.id,
      departmentId: ids.departmentId,
      processName: '批量验证工艺',
      quantity,
      unitPrice: '1.00',
      dueDate: futureDate(5),
      priceVisible: false
    },
    key('ops-task')
  );
  const taskId = task.json().data.id;
  await call(env.app, prod, 'POST', `/production-orders/${taskId}/feedbacks`, { quantity }, key('ops-feedback'));
  await call(env.app, admin, 'POST', `/orders/${orderId}/dispatch-qc`, {}, key('ops-qcd'));
  const qcRecord = await call(
    env.app,
    qc,
    'POST',
    `/production-orders/${taskId}/qc-records`,
    { inspectedQuantity: quantity, qualifiedQuantity: quantity, unqualifiedQuantity: 0 },
    key('ops-qc')
  );
  await call(env.app, admin, 'POST', `/qc-records/${qcRecord.json().data.id}/decision`, { decision: 'PASS' }, key('ops-pass'));
  await call(env.app, admin, 'POST', `/orders/${orderId}/dispatch-packing`, {}, key('ops-packd'));
  await call(env.app, pack, 'POST', `/orders/${orderId}/packing-records`, { quantity }, key('ops-pack'));
  return orderId;
}

test('订单撤销：12 小时内管理员可撤销，超时/已采购拒绝，留痕且不计利润', async () => {
  const orderId = await createOrder(5);
  const cancelKey = key('cancel');
  const cancelled = await call(env.app, admin, 'POST', `/orders/${orderId}/cancel`, { reason: '客户临时取消（合成）' }, cancelKey);
  assert.equal(cancelled.statusCode, 200, cancelled.body);
  assert.equal(cancelled.json().data.status, 'CANCELLED');

  const detail = await call(env.app, admin, 'GET', `/orders/${orderId}`);
  assert.equal(detail.json().data.order.status, 'CANCELLED');
  assert.equal(detail.json().data.profit.profit, '0.00');
  assert.equal(detail.json().data.summary.canCancel, false);
  const timeline = await call(env.app, admin, 'GET', `/orders/${orderId}/timeline`);
  assert.ok(timeline.json().data.events.some((event: { event_type: string }) => event.event_type === 'ORDER_CANCELLED'));

  const again = await call(env.app, admin, 'POST', `/orders/${orderId}/cancel`, { reason: '重复撤销' }, key('cancel-2'));
  assert.equal(again.statusCode, 409);

  const list = await call(env.app, admin, 'GET', '/orders?status=CANCELLED');
  assert.equal(list.json().data.items.some((order: { id: string }) => order.id === orderId), true);

  const nonAdmin = await call(env.app, logistics, 'POST', `/orders/${orderId}/cancel`, { reason: '越权' }, key('cancel-3'));
  assert.equal(nonAdmin.statusCode, 403);

  const expiredId = await createOrder(3);
  env.db.run(
    'UPDATE orders SET created_at = ? WHERE id = ?',
    new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString(),
    expiredId
  );
  const expired = await call(env.app, admin, 'POST', `/orders/${expiredId}/cancel`, { reason: '超时撤销' }, key('cancel-expired'));
  assert.equal(expired.statusCode, 409);
  assert.equal(expired.json().error.details.code, 'CANCEL_WINDOW_EXPIRED');
});

test('多部门生产任务：拆 60+40，两个部门并行反馈，质检逐任务放行', async () => {
  const orderId = await createOrder(100);
  const purchase = await call(
    env.app,
    admin,
    'POST',
    `/orders/${orderId}/purchase-orders`,
    { supplierId: ids.supplierId, item: { partId: ids.partId, quantity: 100, unitPrice: '2.00' } },
    key('multi-po')
  );
  const purchaseItemId = purchase.json().data.purchaseItemId;
  await call(env.app, logistics, 'POST', `/purchase-items/${purchaseItemId}/arrivals`, { quantity: 100 }, key('multi-arrival'));
  const item = env.db.get<{ id: string }>('SELECT id FROM order_items WHERE order_id = ?', orderId)!;
  const deptB = env.db.get<{ id: string }>("SELECT id FROM departments WHERE code = 'PROD-B'")!;

  const first = await call(
    env.app,
    admin,
    'POST',
    `/orders/${orderId}/production-orders`,
    {
      orderItemId: item.id,
      departmentId: ids.departmentId,
      processName: '前半段',
      quantity: 60,
      unitPrice: '1.00',
      dueDate: futureDate(5),
      priceVisible: true
    },
    key('multi-a')
  );
  assert.equal(first.statusCode, 201, first.body);
  const second = await call(
    env.app,
    admin,
    'POST',
    `/orders/${orderId}/production-orders`,
    {
      orderItemId: item.id,
      departmentId: deptB.id,
      processName: '后半段',
      quantity: 40,
      unitPrice: '1.00',
      dueDate: futureDate(5),
      priceVisible: false
    },
    key('multi-b')
  );
  assert.equal(second.statusCode, 201, second.body);
  const taskA = first.json().data.id;
  const taskB = second.json().data.id;

  const detail = await call(env.app, admin, 'GET', `/orders/${orderId}`);
  assert.equal(detail.json().data.production.length, 2);
  assert.equal(detail.json().data.summary.quantities.taskQuantity, 100);
  assert.equal(detail.json().data.summary.quantities.produced, 0);

  await call(env.app, prod, 'POST', `/production-orders/${taskA}/feedbacks`, { quantity: 60 }, key('multi-fa'));
  await call(env.app, prod2, 'POST', `/production-orders/${taskB}/feedbacks`, { quantity: 40 }, key('multi-fb'));
  const afterFeedback = await call(env.app, admin, 'GET', `/orders/${orderId}`);
  assert.equal(afterFeedback.json().data.summary.quantities.produced, 100);

  const qcDispatch = await call(env.app, admin, 'POST', `/orders/${orderId}/dispatch-qc`, {}, key('multi-qcd'));
  assert.equal(qcDispatch.statusCode, 200, qcDispatch.body);
  const queue = await call(env.app, qc, 'GET', '/tablet/qc/queue');
  assert.equal(queue.json().data.tasks.filter((task: { orderId: string }) => task.orderId === orderId).length, 2);

  const qcA = await call(
    env.app,
    qc,
    'POST',
    `/production-orders/${taskA}/qc-records`,
    { inspectedQuantity: 60, qualifiedQuantity: 60, unqualifiedQuantity: 0 },
    key('multi-qca')
  );
  const qcB = await call(
    env.app,
    qc,
    'POST',
    `/production-orders/${taskB}/qc-records`,
    { inspectedQuantity: 40, qualifiedQuantity: 40, unqualifiedQuantity: 0 },
    key('multi-qcb')
  );
  assert.equal(qcA.statusCode, 201, qcA.body);
  assert.equal(qcB.statusCode, 201, qcB.body);

  const decideA = await call(env.app, admin, 'POST', `/qc-records/${qcA.json().data.id}/decision`, { decision: 'PASS' }, key('multi-pa'));
  assert.equal(decideA.json().data.orderStatus, 'PENDING_QC');
  const decideB = await call(env.app, admin, 'POST', `/qc-records/${qcB.json().data.id}/decision`, { decision: 'PASS' }, key('multi-pb'));
  assert.equal(decideB.json().data.orderStatus, 'QC_DONE');
  assert.equal(decideB.json().data.releasedQty, 100);

  const packingDispatch = await call(env.app, admin, 'POST', `/orders/${orderId}/dispatch-packing`, {}, key('multi-pd'));
  assert.equal(packingDispatch.statusCode, 200, packingDispatch.body);
});

test('批量确认发货：任一订单不满足条件时整批不执行，满足后可批量推进', async () => {
  const packingOrder = await advanceToPacking(10);
  const pendingOrder = await createOrder(3);
  const invalid = await call(
    env.app,
    admin,
    'POST',
    '/orders/batch/confirm-shipment',
    { orderIds: [packingOrder, pendingOrder] },
    key('batch-invalid')
  );
  assert.equal(invalid.statusCode, 409);
  const stillPacking = await call(env.app, admin, 'GET', `/orders/${packingOrder}`);
  assert.equal(stillPacking.json().data.order.status, 'PACKING');

  const valid = await call(
    env.app,
    admin,
    'POST',
    '/orders/batch/confirm-shipment',
    { orderIds: [packingOrder] },
    key('batch-valid')
  );
  assert.equal(valid.statusCode, 200, valid.body);
  assert.equal(valid.json().data.count, 1);
  const shipped = await call(env.app, admin, 'GET', `/orders/${packingOrder}`);
  assert.equal(shipped.json().data.order.status, 'SHIPPING');
});

test('客户税号与地址选填：不填可创建，填写可读取', async () => {
  const withFields = await call(env.app, admin, 'POST', '/customers', {
    code: 'CUS-TAX-01',
    name: '带税号客户',
    contact: '',
    taxNo: '91310000DEMO0001X',
    address: '上海市合成路 1 号'
  });
  assert.equal(withFields.statusCode, 201, withFields.body);
  const list = await call(env.app, admin, 'GET', '/customers?search=带税号');
  assert.equal(list.json().data.items[0].taxNo, '91310000DEMO0001X');
  assert.equal(list.json().data.items[0].address, '上海市合成路 1 号');

  const without = await call(env.app, admin, 'POST', '/customers', {
    code: 'CUS-TAX-02',
    name: '不填税号客户',
    contact: ''
  });
  assert.equal(without.statusCode, 201, without.body);
});
