import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { call, createTestEnv, futureDate, key, login, masterIds, type TestEnv } from '../helpers.js';

let env: TestEnv;
let admin = '';
let prod = '';
let adminId = '';
let ids: ReturnType<typeof masterIds>;

before(async () => {
  env = await createTestEnv();
  ids = masterIds(env.db);
  admin = await login(env.app, 'admin');
  prod = await login(env.app, 'prod');
  adminId = env.db.get<{ id: string }>("SELECT id FROM users WHERE username = 'admin'")!.id;
});

after(async () => {
  await env.close();
});

function insertNotification(recipientId: string, title: string): string {
  const id = crypto.randomUUID();
  env.db.run(
    `INSERT INTO notifications(id, recipient_id, event_type, title, body, resource_type, resource_id, dedupe_key, read_at, created_at)
     VALUES (?, ?, 'TEST', ?, '', 'ORDER', ?, ?, NULL, ?)`,
    id,
    recipientId,
    title,
    id,
    `test:${id}`,
    new Date().toISOString()
  );
  return id;
}

test('交期提醒删除后不会在当天重新生成', async () => {
  // 造一张 3 天到期的订单，读取通知时生成 DUE_SOON
  const orderId = crypto.randomUUID();
  env.db.run(
    `INSERT INTO orders(id, order_no, customer_id, customer_name, due_date, status, note, created_by, created_at, updated_at)
     VALUES (?, ?, ?, '交期提醒客户（合成）', ?, 'PENDING_PURCHASE', '', ?, ?, ?)`,
    orderId,
    `SO-REMINDER-${Date.now()}`,
    ids.customerId,
    futureDate(3),
    adminId,
    new Date().toISOString(),
    new Date().toISOString()
  );

  await call(env.app, admin, 'GET', '/notifications?limit=100');
  const list = await call(env.app, admin, 'GET', '/notifications?limit=100');
  const reminder = list
    .json()
    .data.items.find((item: { resourceId: string }) => item.resourceId === orderId);
  assert.ok(reminder, '应生成交期提醒');

  const removed = await call(env.app, admin, 'DELETE', `/notifications/${reminder.id}`);
  assert.equal(removed.statusCode, 200, removed.body);
  assert.equal(removed.json().data.deleted, true);

  const after = await call(env.app, admin, 'GET', '/notifications?limit=100');
  assert.equal(
    after.json().data.items.some((item: { resourceId: string }) => item.resourceId === orderId),
    false,
    '删除后当天不应重新生成'
  );
});

test('通知批量删除与批量已读', async () => {
  const first = insertNotification(adminId, '批量删除 A');
  const second = insertNotification(adminId, '批量删除 B');
  const third = insertNotification(adminId, '批量已读 C');

  const deleted = await call(
    env.app,
    admin,
    'POST',
    '/notifications/batch',
    { ids: [first, second], action: 'delete' },
    key('batch-delete')
  );
  assert.equal(deleted.statusCode, 200, deleted.body);
  assert.equal(deleted.json().data.changed, 2);

  let list = await call(env.app, admin, 'GET', '/notifications?limit=100');
  assert.equal(list.json().data.items.some((item: { id: string }) => item.id === first), false);
  assert.equal(list.json().data.items.some((item: { id: string }) => item.id === second), false);
  assert.equal(list.json().data.items.some((item: { id: string }) => item.id === third), true);

  const read = await call(
    env.app,
    admin,
    'POST',
    '/notifications/batch',
    { ids: [third], action: 'read' },
    key('batch-read')
  );
  assert.equal(read.statusCode, 200, read.body);
  assert.equal(read.json().data.changed, 1);

  list = await call(env.app, admin, 'GET', '/notifications?limit=100');
  const readRow = list.json().data.items.find((item: { id: string }) => item.id === third);
  assert.equal(readRow.read, true);
});

test('批量操作只影响自己的通知且校验入参', async () => {
  const own = insertNotification(adminId, '归属校验通知');

  const empty = await call(env.app, admin, 'POST', '/notifications/batch', { ids: [], action: 'delete' });
  assert.equal(empty.statusCode, 400);

  const duplicated = await call(
    env.app,
    admin,
    'POST',
    '/notifications/batch',
    { ids: [own, own], action: 'delete' }
  );
  assert.equal(duplicated.statusCode, 400);

  // 通知中心仅管理员可访问，现场角色批量操作应被拒绝
  const other = await call(
    env.app,
    prod,
    'POST',
    '/notifications/batch',
    { ids: [own], action: 'delete' },
    key('batch-other')
  );
  assert.equal(other.statusCode, 403);

  const list = await call(env.app, admin, 'GET', '/notifications?limit=100');
  assert.equal(list.json().data.items.some((item: { id: string }) => item.id === own), true);
});