import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { call, createTestEnv, futureDate, key, login, masterIds, type TestEnv } from '../helpers.js';

let env: TestEnv;
let admin = '';
let logistics = '';
let orderId = '';
let purchaseItemId = '';

before(async () => {
  env = await createTestEnv();
  const ids = masterIds(env.db);
  admin = await login(env.app, 'admin');
  logistics = await login(env.app, 'logistics');
  const order = await call(
    env.app,
    admin,
    'POST',
    '/orders',
    {
      customerId: ids.customerId,
      dueDate: futureDate(10),
      item: { partId: ids.partId, productName: '事务回滚验证', spec: 'AT-01', quantity: 5, unitPrice: '2.00' }
    },
    key('atomic-order')
  );
  orderId = order.json().data.id;
  const purchase = await call(
    env.app,
    admin,
    'POST',
    `/orders/${orderId}/purchase-orders`,
    { supplierId: ids.supplierId, item: { partId: ids.partId, quantity: 5, unitPrice: '1.00' } },
    key('atomic-po')
  );
  purchaseItemId = purchase.json().data.purchaseItemId;
});

after(async () => {
  await env.close();
});

test('事务中途失败：到货、时间线、通知、审计、幂等结果一起回滚；同键重试成功一次', async () => {
  env.db.exec(`
    CREATE TRIGGER inject_notification_failure
    BEFORE INSERT ON notifications
    WHEN NEW.event_type = 'ARRIVAL_RECORDED'
    BEGIN
      SELECT RAISE(ABORT, 'injected notification failure');
    END;
  `);
  const arrivalKey = key('atomic-arrival');
  const inserted = await call(
    env.app,
    logistics,
    'POST',
    `/purchase-items/${purchaseItemId}/arrivals`,
    { quantity: 5, note: '注入失败' },
    arrivalKey
  );
  assert.equal(inserted.statusCode, 500);
  assert.equal(inserted.json().error.code, 'INTERNAL_ERROR');

  const counts = env.db.get<{
    arrivals: number;
    timeline: number;
    notifications: number;
    idempotency: number;
    partLogs: number;
  }>(`
    SELECT
      (SELECT COUNT(*) FROM arrival_records WHERE purchase_item_id = '${purchaseItemId}') AS arrivals,
      (SELECT COUNT(*) FROM order_timeline WHERE order_id = '${orderId}' AND event_type = 'ARRIVAL_RECORDED') AS timeline,
      (SELECT COUNT(*) FROM notifications WHERE resource_id = '${orderId}') AS notifications,
      (SELECT COUNT(*) FROM idempotency_requests WHERE operation = 'arrival.create') AS idempotency,
      (SELECT COUNT(*) FROM inventory_logs WHERE source_order_id = '${orderId}') AS partLogs
  `);
  assert.deepEqual(
    { arrivals: counts?.arrivals, timeline: counts?.timeline, notifications: counts?.notifications, idempotency: counts?.idempotency, partLogs: counts?.partLogs },
    { arrivals: 0, timeline: 0, notifications: 0, idempotency: 0, partLogs: 0 }
  );

  env.db.exec('DROP TRIGGER inject_notification_failure;');

  const retry = await call(
    env.app,
    logistics,
    'POST',
    `/purchase-items/${purchaseItemId}/arrivals`,
    { quantity: 5, note: '注入失败' },
    arrivalKey
  );
  assert.equal(retry.statusCode, 201, retry.body);
  const finalCount = env.db.get<{ c: number }>(
    'SELECT COUNT(*) AS c FROM arrival_records WHERE purchase_item_id = ?',
    purchaseItemId
  );
  assert.equal(finalCount?.c, 1);
});
