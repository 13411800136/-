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
let orderId = '';
let orderNo = '';
let purchaseItemId = '';
let taskId = '';
let qcId = '';

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

test('建单幂等：同键同体重放不生成第二张订单', async () => {
  const createKey = key('order');
  const body = {
    customerId: ids.customerId,
    dueDate: futureDate(14),
    note: '完整闭环验收（合成）',
    item: {
      partId: ids.partId,
      productName: '精密传动箱体',
      spec: 'TB-220 / 阳极氧化',
      quantity: 100,
      unitPrice: '12.50'
    }
  };
  const first = await call(env.app, admin, 'POST', '/orders', body, createKey);
  assert.equal(first.statusCode, 201, first.body);
  orderId = first.json().data.id;
  orderNo = first.json().data.orderNo;
  assert.match(orderNo, /^SO-\d{8}-\d{4}$/);

  const replay = await call(env.app, admin, 'POST', '/orders', body, createKey);
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.json().data.id, orderId);
  assert.equal(replay.headers['idempotent-replayed'], 'true');
  const count = env.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM orders WHERE order_no = ?', orderNo);
  assert.equal(count?.count, 1);
});

test('采购与到货：同键重试只入账一次，同键异体冲突', async () => {
  const purchase = await call(
    env.app,
    admin,
    'POST',
    `/orders/${orderId}/purchase-orders`,
    { supplierId: ids.supplierId, item: { partId: ids.partId, quantity: 120, unitPrice: '2.10' } },
    key('po')
  );
  assert.equal(purchase.statusCode, 201, purchase.body);
  purchaseItemId = purchase.json().data.purchaseItemId;

  const arrivalKey = key('arrival');
  const first = await call(
    env.app,
    logistics,
    'POST',
    `/purchase-items/${purchaseItemId}/arrivals`,
    { quantity: 120, note: '一次到齐' },
    arrivalKey
  );
  assert.equal(first.statusCode, 201, first.body);
  assert.equal(first.json().data.arrivedQty, 120);

  const replay = await call(
    env.app,
    logistics,
    'POST',
    `/purchase-items/${purchaseItemId}/arrivals`,
    { quantity: 120, note: '一次到齐' },
    arrivalKey
  );
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.json().data.id, first.json().data.id);
  const arrivals = env.db.get<{ count: number }>(
    'SELECT COUNT(*) AS count FROM arrival_records WHERE purchase_item_id = ?',
    purchaseItemId
  );
  assert.equal(arrivals?.count, 1);

  const conflict = await call(
    env.app,
    logistics,
    'POST',
    `/purchase-items/${purchaseItemId}/arrivals`,
    { quantity: 119, note: '一次到齐' },
    arrivalKey
  );
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().error.code, 'CONFLICT');
});

test('生产：部门隔离、单价开关与幂等下发', async () => {
  const dispatchKey = key('task');
  const body = {
    orderItemId: env.db.get<{ id: string }>('SELECT id FROM order_items WHERE order_id = ?', orderId)!.id,
    departmentId: ids.departmentId,
    assigneeId: ids.productionUserId,
    processName: '精加工与装配',
    quantity: 100,
    unitPrice: '1.20',
    dueDate: futureDate(5),
    priceVisible: false
  };
  const dispatched = await call(env.app, admin, 'POST', `/orders/${orderId}/production-orders`, body, dispatchKey);
  assert.equal(dispatched.statusCode, 201, dispatched.body);
  taskId = dispatched.json().data.id;

  const replay = await call(env.app, admin, 'POST', `/orders/${orderId}/production-orders`, body, dispatchKey);
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.json().data.id, taskId);

  const myTasks = await call(env.app, prod, 'GET', '/tablet/production/my-tasks');
  assert.equal(myTasks.statusCode, 200);
  const task = myTasks.json().data.tasks.find((row: { id: string }) => row.id === taskId);
  assert.ok(task);
  assert.equal(task.unitPrice, undefined);

  const wrongDept = await call(
    env.app,
    prod2,
    'POST',
    `/production-orders/${taskId}/feedbacks`,
    { quantity: 1, note: '越权' },
    key('wrong')
  );
  assert.equal(wrongDept.statusCode, 404);

  const visibility = await call(
    env.app,
    admin,
    'PATCH',
    `/production-orders/${taskId}/price-visibility`,
    { priceVisible: true },
    key('visibility')
  );
  assert.equal(visibility.statusCode, 200);
  const afterVisibility = await call(env.app, prod, 'GET', '/tablet/production/my-tasks');
  const visibleTask = afterVisibility.json().data.tasks.find((row: { id: string }) => row.id === taskId);
  assert.equal(visibleTask.unitPrice, '1.20');
});

test('生产反馈完成，超量被拒绝且不累加', async () => {
  const feedbackKey = key('feedback');
  const feedback = await call(
    env.app,
    prod,
    'POST',
    `/production-orders/${taskId}/feedbacks`,
    { quantity: 100, note: '本批完成' },
    feedbackKey
  );
  assert.equal(feedback.statusCode, 201, feedback.body);
  assert.equal(feedback.json().data.completed, true);

  const over = await call(
    env.app,
    prod,
    'POST',
    `/production-orders/${taskId}/feedbacks`,
    { quantity: 1, note: '超量' },
    key('over')
  );
  assert.equal(over.statusCode, 409);
  const total = env.db.get<{ qty: number }>(
    'SELECT COALESCE(SUM(quantity), 0) AS qty FROM production_feedbacks WHERE production_order_id = ?',
    taskId
  );
  assert.equal(total?.qty, 100);
});

test('质检录入与管理员放行分离，重复 PASS 不重复放行', async () => {
  const dispatchKey = key('qcd');
  const dispatch = await call(env.app, admin, 'POST', `/orders/${orderId}/dispatch-qc`, {}, dispatchKey);
  assert.equal(dispatch.statusCode, 200, dispatch.body);
  const dispatchReplay = await call(env.app, admin, 'POST', `/orders/${orderId}/dispatch-qc`, {}, dispatchKey);
  assert.equal(dispatchReplay.statusCode, 200);
  assert.equal(dispatchReplay.headers['idempotent-replayed'], 'true');

  const earlyPack = await call(env.app, pack, 'POST', `/orders/${orderId}/packing-records`, { quantity: 100 }, key('early'));
  assert.equal(earlyPack.statusCode, 409);

  const partial = await call(
    env.app,
    qc,
    'POST',
    `/production-orders/${taskId}/qc-records`,
    { inspectedQuantity: 100, qualifiedQuantity: 99, unqualifiedQuantity: 1 },
    key('partial')
  );
  assert.equal(partial.statusCode, 409);
  assert.equal(partial.json().error.code, 'FEATURE_NOT_ENABLED');

  const record = await call(
    env.app,
    qc,
    'POST',
    `/production-orders/${taskId}/qc-records`,
    { inspectedQuantity: 100, qualifiedQuantity: 100, unqualifiedQuantity: 0 },
    key('qc')
  );
  assert.equal(record.statusCode, 201, record.body);
  qcId = record.json().data.id;

  const decision = await call(env.app, admin, 'POST', `/qc-records/${qcId}/decision`, { decision: 'PASS' }, key('pass'));
  assert.equal(decision.statusCode, 200, decision.body);
  assert.equal(decision.json().data.orderStatus, 'QC_DONE');
  const repeat = await call(env.app, admin, 'POST', `/qc-records/${qcId}/decision`, { decision: 'PASS' }, key('pass-2'));
  assert.equal(repeat.statusCode, 200);
  assert.equal(repeat.json().data.releasedQty, 100);
  const released = env.db.get<{ qty: number }>(
    'SELECT qualified_qty AS qty FROM qc_records WHERE id = ?',
    qcId
  );
  assert.equal(released?.qty, 100);
});

test('包装与发货数量闸门，足量后订单完成', async () => {
  const dispatch = await call(env.app, admin, 'POST', `/orders/${orderId}/dispatch-packing`, {}, key('pack-d'));
  assert.equal(dispatch.statusCode, 200, dispatch.body);

  const packing = await call(env.app, pack, 'POST', `/orders/${orderId}/packing-records`, { quantity: 100 }, key('pack'));
  assert.equal(packing.statusCode, 201, packing.body);

  const overPack = await call(env.app, pack, 'POST', `/orders/${orderId}/packing-records`, { quantity: 1 }, key('pack-over'));
  assert.equal(overPack.statusCode, 409);

  const trigger = await call(env.app, admin, 'POST', `/orders/${orderId}/trigger-shipment`, {}, key('trigger'));
  assert.equal(trigger.statusCode, 200, trigger.body);

  const overShip = await call(env.app, logistics, 'POST', `/orders/${orderId}/shipments`, { quantity: 101 }, key('ship-over'));
  assert.equal(overShip.statusCode, 409);

  const shipment = await call(
    env.app,
    logistics,
    'POST',
    `/orders/${orderId}/shipments`,
    { quantity: 100, carrier: '顺程物流（演示）', trackingNo: 'TEST-TRK' },
    key('ship')
  );
  assert.equal(shipment.statusCode, 201, shipment.body);
  assert.equal(shipment.json().data.completed, true);

  const detail = await call(env.app, admin, 'GET', `/orders/${orderId}`);
  assert.equal(detail.statusCode, 200);
  const data = detail.json().data;
  assert.equal(data.order.status, 'COMPLETED');
  assert.equal(data.profit.sales, '1250.00');
  assert.equal(data.profit.purchaseCost, '252.00');
  assert.equal(data.profit.productionCost, '120.00');
  assert.equal(data.profit.profit, '878.00');
  assert.equal(data.profit.margin, '70.24');
  assert.equal(data.summary.quantities.released, 100);
  assert.equal(data.summary.quantities.packed, 100);
  assert.equal(data.summary.quantities.shipped, 100);
  const types = data.stages.map((stage: { key: string; state: string }) => `${stage.key}:${stage.state}`);
  assert.ok(types.includes('PLATING:NOT_APPLICABLE'));
  assert.ok(types.includes('COMPLETED:DONE'));
});

test('时间线、通知与审计完整记录', async () => {
  const timeline = await call(env.app, admin, 'GET', `/orders/${orderId}/timeline`);
  assert.equal(timeline.statusCode, 200);
  const eventTypes = timeline.json().data.events.map((event: { event_type: string }) => event.event_type);
  for (const expected of [
    'ORDER_CREATED',
    'PURCHASE_CREATED',
    'ARRIVAL_RECORDED',
    'PRODUCTION_DISPATCHED',
    'PRODUCTION_FEEDBACK',
    'QC_RECORDED',
    'QC_PASSED',
    'PACKING_RECORDED',
    'SHIPMENT_RECORDED',
    'ORDER_COMPLETED'
  ]) {
    assert.ok(eventTypes.includes(expected), `缺少时间线事件 ${expected}`);
  }

  const notifications = await call(env.app, admin, 'GET', '/notifications');
  assert.equal(notifications.statusCode, 200);
  const arrivalNotifications = notifications
    .json()
    .data.items.filter((item: { eventType: string; body: string }) => item.eventType === 'ARRIVAL_RECORDED');
  assert.equal(arrivalNotifications.length, 1);
  assert.equal(notifications.json().data.unreadCount >= 1, true);

  const audits = await call(env.app, admin, 'GET', '/audit-logs?pageSize=100');
  const actions = audits.json().data.items.map((item: { action: string }) => item.action);
  for (const expected of ['ORDER_CREATE', 'PURCHASE_CREATE', 'ARRIVAL_CREATE', 'QC_DECISION', 'SHIPMENT_RECORD']) {
    assert.ok(actions.includes(expected), `缺少审计动作 ${expected}`);
  }
  const serialized = JSON.stringify(audits.json());
  assert.equal(serialized.includes('Demo@2026'), false);
  assert.equal(serialized.includes('password_hash'), false);
});

test('各现场岗位都有历史记录，已完成的待办不再出现', async () => {
  const logisticsHistory = await call(env.app, logistics, 'GET', '/tablet/logistics/history');
  assert.equal(logisticsHistory.statusCode, 200);
  assert.equal(logisticsHistory.json().data.arrivals.some((row: { orderId: string }) => row.orderId === orderId), true);
  assert.equal(logisticsHistory.json().data.shipments.some((row: { orderId: string }) => row.orderId === orderId), true);

  const logisticsQueue = await call(env.app, logistics, 'GET', '/tablet/logistics/queue');
  assert.equal(logisticsQueue.json().data.arrivals.some((row: { orderId: string }) => row.orderId === orderId), false);
  assert.equal(logisticsQueue.json().data.shipments.some((row: { orderId: string }) => row.orderId === orderId), false);

  const qcHistory = await call(env.app, qc, 'GET', '/tablet/qc/history');
  assert.equal(qcHistory.statusCode, 200);
  assert.equal(qcHistory.json().data.items.some((row: { id: string }) => row.id === qcId), true);

  const packingHistory = await call(env.app, pack, 'GET', '/tablet/packing/history');
  assert.equal(packingHistory.statusCode, 200);
  assert.equal(packingHistory.json().data.items.some((row: { orderId: string }) => row.orderId === orderId), true);

  const qcQueue = await call(env.app, qc, 'GET', '/tablet/qc/queue');
  assert.equal(qcQueue.json().data.tasks.length, 0);
  const packingQueue = await call(env.app, pack, 'GET', '/tablet/packing/queue');
  assert.equal(packingQueue.json().data.tasks.length, 0);
});
