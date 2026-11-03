import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { call, createTestEnv, futureDate, key, login, masterIds, type TestEnv } from '../helpers.js';

let env: TestEnv;
let admin = '';
let logistics = '';
let prod = '';
let prod2 = '';
let orderId = '';
let taskId = '';
let purchaseItemId = '';

before(async () => {
  env = await createTestEnv();
  admin = await login(env.app, 'admin');
  logistics = await login(env.app, 'logistics');
  prod = await login(env.app, 'prod');
  prod2 = await login(env.app, 'prod2');
  const ids = masterIds(env.db);
  const order = await call(
    env.app,
    admin,
    'POST',
    '/orders',
    {
      customerId: ids.customerId,
      dueDate: futureDate(8),
      note: '通知与看板验收',
      item: { partId: ids.partId, productName: '看板验证产品', spec: 'DSH-01', quantity: 20, unitPrice: '5.00' }
    },
    key('dash-order')
  );
  orderId = order.json().data.id;
  const purchase = await call(
    env.app,
    admin,
    'POST',
    `/orders/${orderId}/purchase-orders`,
    { supplierId: ids.supplierId, item: { partId: ids.partId, quantity: 20, unitPrice: '1.00' } },
    key('dash-po')
  );
  purchaseItemId = purchase.json().data.purchaseItemId;
  await call(
    env.app,
    logistics,
    'POST',
    `/purchase-items/${purchaseItemId}/arrivals`,
    { quantity: 20, note: '看板到货' },
    key('dash-arrival')
  );
  const dispatch = await call(
    env.app,
    admin,
    'POST',
    `/orders/${orderId}/production-orders`,
    {
      orderItemId: env.db.get<{ id: string }>('SELECT id FROM order_items WHERE order_id = ?', orderId)!.id,
      departmentId: ids.departmentId,
      processName: '测试工艺',
      quantity: 20,
      unitPrice: '0.50',
      dueDate: futureDate(4),
      priceVisible: false
    },
    key('dash-task')
  );
  taskId = dispatch.json().data.id;
});

after(async () => {
  await env.close();
});

test('关键事件通知持久化，重放不重复，已读与未读一致', async () => {
  const before = await call(env.app, admin, 'GET', '/notifications');
  assert.equal(before.statusCode, 200);
  const arrivalItems = before
    .json()
    .data.items.filter((item: { eventType: string }) => item.eventType === 'ARRIVAL_RECORDED');
  assert.equal(arrivalItems.length, 1);
  const unread = before.json().data.unreadCount;
  assert.ok(unread >= 1);

  const notificationId = arrivalItems[0].id;
  const read = await call(env.app, admin, 'POST', `/notifications/${notificationId}/read`, {});
  assert.equal(read.statusCode, 200);
  assert.equal(read.json().data.unreadCount, unread - 1);

  const count = await call(env.app, admin, 'GET', '/notifications/unread-count');
  assert.equal(count.json().data.unreadCount, unread - 1);

  const all = await call(env.app, admin, 'POST', '/notifications/mark-all-read', {});
  assert.equal(all.statusCode, 200);
  assert.equal(all.json().data.unreadCount, 0);
});

test('看板统计与列表使用同一业务数据', async () => {
  const dashboard = await call(env.app, admin, 'GET', '/dashboard/summary');
  assert.equal(dashboard.statusCode, 200);
  const data = dashboard.json().data;
  const statusSum = data.statusCounts.reduce((sum: number, row: { count: number }) => sum + row.count, 0);
  assert.equal(statusSum, data.totalOrders);
  assert.ok(data.totalOrders >= 1);
  assert.equal(data.production.progress.some((row: { orderId: string }) => row.orderId === orderId), true);

  const list = await call(env.app, admin, 'GET', '/orders?page=1&pageSize=100');
  assert.equal(list.json().data.pagination.total, data.totalOrders);
});

test('现场异常关联订单、部门隔离且不改变数量', async () => {
  const before = env.db.get<{ count: number }>(
    'SELECT COUNT(*) AS count FROM production_feedbacks WHERE production_order_id = ?',
    taskId
  );
  const report = await call(env.app, prod, 'POST', '/tablet/exceptions', {
    orderId,
    productionOrderId: taskId,
    category: 'EQUIPMENT',
    description: '夹具松动，已停机等待维修确认。'
  });
  assert.equal(report.statusCode, 201, report.body);

  const crossDept = await call(env.app, prod2, 'POST', '/tablet/exceptions', {
    orderId,
    productionOrderId: taskId,
    category: 'OTHER',
    description: '跨部门异常应当被拒绝。'
  });
  assert.equal(crossDept.statusCode, 404);

  const adminList = await call(env.app, admin, 'GET', '/exceptions');
  assert.equal(adminList.statusCode, 200);
  assert.equal(adminList.json().data.items.length, 1);

  const resolve = await call(env.app, admin, 'PATCH', `/exceptions/${report.json().data.id}`, { status: 'RESOLVED' });
  assert.equal(resolve.statusCode, 409);
  assert.equal(resolve.json().error.code, 'FEATURE_NOT_ENABLED');

  const afterCount = env.db.get<{ count: number }>(
    'SELECT COUNT(*) AS count FROM production_feedbacks WHERE production_order_id = ?',
    taskId
  );
  assert.equal(afterCount?.count, before?.count);
});

test('审计受保护，敏感值不落盘', async () => {
  const denied = await call(env.app, logistics, 'GET', '/audit-logs');
  assert.equal(denied.statusCode, 403);

  const logs = await call(env.app, admin, 'GET', '/audit-logs?pageSize=100');
  assert.equal(logs.statusCode, 200);
  const text = JSON.stringify(logs.json());
  assert.equal(text.includes('Demo@2026'), false);
  assert.equal(text.includes('password_salt'), false);
  assert.equal(text.includes('password_hash'), false);

  const auditId = logs.json().data.items[0].id;
  const remove = await call(env.app, admin, 'DELETE', `/audit-logs/${auditId}`);
  assert.equal(remove.statusCode, 409);
  assert.equal(remove.json().error.code, 'FEATURE_NOT_ENABLED');
});
