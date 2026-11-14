import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { call, createTestEnv, futureDate, key, login, masterIds, type TestEnv } from '../helpers.js';

let env: TestEnv;
let admin = '';
let qc = '';
let ids: ReturnType<typeof masterIds>;

before(async () => {
  env = await createTestEnv();
  ids = masterIds(env.db);
  admin = await login(env.app, 'admin');
  qc = await login(env.app, 'qc');
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

test('通知可删除，不能删除他人通知，可清理已读', async () => {
  const mine = insertNotification(
    env.db.get<{ id: string }>("SELECT id FROM users WHERE username = 'admin'")!.id,
    '待删除通知'
  );
  const other = insertNotification(
    env.db.get<{ id: string }>("SELECT id FROM users WHERE username = 'qc'")!.id,
    '品控的通知'
  );

  const denied = await call(env.app, admin, 'DELETE', `/notifications/${other}`);
  assert.equal(denied.statusCode, 403);

  const removed = await call(env.app, admin, 'DELETE', `/notifications/${mine}`);
  assert.equal(removed.statusCode, 200, removed.body);
  assert.equal(removed.json().data.deleted, true);

  const list = await call(env.app, admin, 'GET', '/notifications?limit=100');
  assert.equal(list.json().data.items.some((item: { id: string }) => item.id === mine), false);

  // 清理已读：先全部已读，再清理
  insertNotification(
    env.db.get<{ id: string }>("SELECT id FROM users WHERE username = 'admin'")!.id,
    '可清理通知'
  );
  await call(env.app, admin, 'POST', '/notifications/mark-all-read', {});
  const cleared = await call(env.app, admin, 'POST', '/notifications/clear-read', {});
  assert.equal(cleared.statusCode, 200, cleared.body);
  assert.ok(cleared.json().data.deleted >= 1);
  const unread = await call(env.app, admin, 'GET', '/notifications/unread-count');
  assert.equal(unread.json().data.unreadCount, 0);
  // 通知中心仅管理员可访问，现场角色连路由都进不来
  assert.equal(await call(env.app, qc, 'DELETE', '/notifications/00000000-0000-0000-0000-000000000000').then((r) => r.statusCode), 403);
});

test('按月归档：生成 xlsx/csv，订单移出默认列表但可查归档视图', async () => {
  const now = new Date();
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const orderId = crypto.randomUUID();
  const itemId = crypto.randomUUID();
  const completedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  env.db.run(
    `INSERT INTO orders(id, order_no, customer_id, customer_name, due_date, status, note, created_by, created_at, updated_at)
     VALUES (?, ?, ?, '归档客户（合成）', ?, 'COMPLETED', '', (SELECT id FROM users WHERE username = 'admin'), ?, ?)`,
    orderId,
    'SO-ARCHIVE-TEST-001',
    ids.customerId,
    futureDate(1),
    completedAt,
    completedAt
  );
  env.db.run(
    `INSERT INTO order_items(id, order_id, part_id, product_name, spec, quantity, unit_price_cents, created_at)
     VALUES (?, ?, NULL, '归档产品', 'AR-1', 10, 1250, ?)`,
    itemId,
    orderId,
    completedAt
  );

  const preview = await call(env.app, admin, 'GET', `/orders/archive-preview?month=${month}`);
  assert.equal(preview.statusCode, 200, preview.body);
  assert.ok(preview.json().data.count >= 1);
  assert.ok(preview.json().data.rows.some((row: { id: string }) => row.id === orderId));

  const archived = await call(env.app, admin, 'POST', '/orders/archive-month', { month }, key('archive'));
  assert.equal(archived.statusCode, 200, archived.body);
  assert.ok(archived.json().data.archived >= 1);
  const xlsxPath = archived.json().data.xlsxPath as string;
  const csvPath = archived.json().data.csvPath as string;
  assert.ok(existsSync(xlsxPath), 'xlsx 应写入归档目录');
  assert.ok(existsSync(csvPath), 'csv 应写入归档目录');
  assert.match(readFileSync(csvPath, 'utf8'), /SO-ARCHIVE-TEST-001/);
  assert.equal(archived.json().data.totals.margin !== undefined, true);

  const list = await call(env.app, admin, 'GET', '/orders?pageSize=100');
  assert.equal(list.json().data.items.some((item: { id: string }) => item.id === orderId), false);
  const archivedList = await call(env.app, admin, 'GET', '/orders?pageSize=100&archived=1');
  assert.equal(archivedList.json().data.items.some((item: { id: string }) => item.id === orderId), true);

  const detail = await call(env.app, admin, 'GET', `/orders/${orderId}`);
  assert.equal(detail.statusCode, 200, '归档后详情仍可追溯');

  // 重复归档：没有新订单可归档，但月报仍按全量刷新
  const repeat = await call(env.app, admin, 'POST', '/orders/archive-month', { month }, key('archive-2'));
  assert.equal(repeat.statusCode, 200);
  assert.equal(repeat.json().data.archived, 0);
  assert.equal(repeat.json().data.count, 1);

  // 同月新增一张已完成订单后再归档：月报应包含两张，旧行不能被覆盖
  const secondId = crypto.randomUUID();
  env.db.run(
    `INSERT INTO orders(id, order_no, customer_id, customer_name, due_date, status, note, created_by, created_at, updated_at)
     VALUES (?, ?, ?, '归档客户二号', ?, 'COMPLETED', '', (SELECT id FROM users WHERE username = 'admin'), ?, ?)`,
    secondId,
    'SO-ARCHIVE-TEST-002',
    ids.customerId,
    futureDate(1),
    completedAt,
    completedAt
  );
  env.db.run(
    `INSERT INTO order_items(id, order_id, part_id, product_name, spec, quantity, unit_price_cents, created_at)
     VALUES (?, ?, NULL, '归档产品二', 'AR-2', 4, 500, ?)`,
    crypto.randomUUID(),
    secondId,
    completedAt
  );
  const second = await call(env.app, admin, 'POST', '/orders/archive-month', { month }, key('archive-3'));
  assert.equal(second.statusCode, 200, second.body);
  assert.equal(second.json().data.archived, 1);
  const csv = readFileSync(csvPath, 'utf8');
  assert.match(csv, /SO-ARCHIVE-TEST-001/);
  assert.match(csv, /SO-ARCHIVE-TEST-002/);

  const rejected = await call(env.app, admin, 'POST', '/orders/archive-month', { month: '2026-13' });
  assert.equal(rejected.statusCode, 400);

  const forbidden = await call(env.app, qc, 'POST', '/orders/archive-month', { month });
  assert.equal(forbidden.statusCode, 403);
});