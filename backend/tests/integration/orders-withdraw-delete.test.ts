import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { call, createTestEnv, futureDate, key, login, masterIds, type TestEnv } from '../helpers.js';

let env: TestEnv;
let admin = '';
let prod = '';
let ids: ReturnType<typeof masterIds>;

before(async () => {
  env = await createTestEnv();
  ids = masterIds(env.db);
  admin = await login(env.app, 'admin');
  prod = await login(env.app, 'prod');
});

after(async () => {
  await env.close();
});

async function createOrder(tag: string): Promise<string> {
  const created = await call(
    env.app,
    admin,
    'POST',
    '/orders',
    {
      customerId: ids.customerId,
      dueDate: futureDate(10),
      item: { productName: `撤回删除验证 ${tag}`, quantity: 2, unitPrice: '10.00' }
    },
    key(`create-${tag}`)
  );
  assert.equal(created.statusCode, 201, created.body);
  return created.json().data.id;
}

test('订单撤回：进行中订单可撤回并留痕，不能重复撤回', async () => {
  const orderId = await createOrder('withdraw');
  const withdraw = await call(
    env.app,
    admin,
    'POST',
    `/orders/${orderId}/withdraw`,
    { reason: '客户临时取消订单' },
    key('withdraw-1')
  );
  assert.equal(withdraw.statusCode, 200, withdraw.body);
  assert.equal(withdraw.json().data.status, 'CANCELLED');

  const detail = await call(env.app, admin, 'GET', `/orders/${orderId}`);
  assert.equal(detail.json().data.order.status, 'CANCELLED');
  assert.equal(detail.json().data.order.withdrawReason, '客户临时取消订单');

  const again = await call(
    env.app,
    admin,
    'POST',
    `/orders/${orderId}/withdraw`,
    { reason: '重复撤回' },
    key('withdraw-2')
  );
  assert.equal(again.statusCode, 409);

  const timeline = await call(env.app, admin, 'GET', `/orders/${orderId}/timeline`);
  assert.equal(
    timeline.json().data.events.some((event: { event_type: string }) => event.event_type === 'ORDER_WITHDRAWN'),
    true
  );

  const audits = await call(env.app, admin, 'GET', '/audit-logs?pageSize=100');
  assert.equal(audits.json().data.items.some((item: { action: string }) => item.action === 'ORDER_WITHDRAW'), true);

  const forbidden = await call(
    env.app,
    prod,
    'POST',
    `/orders/${orderId}/withdraw`,
    { reason: '现场角色越权' },
    key('withdraw-prod')
  );
  assert.equal(forbidden.statusCode, 403);
});

test('订单删除：只能删除已撤销或已完成订单，删除后列表与详情不可见', async () => {
  const orderId = await createOrder('delete');

  const blocked = await call(env.app, admin, 'DELETE', `/orders/${orderId}`, undefined, key('delete-blocked'));
  assert.equal(blocked.statusCode, 409, blocked.body);

  await call(env.app, admin, 'POST', `/orders/${orderId}/withdraw`, { reason: '删除前撤回' }, key('delete-withdraw'));

  const removed = await call(env.app, admin, 'DELETE', `/orders/${orderId}`, undefined, key('delete-ok'));
  assert.equal(removed.statusCode, 200, removed.body);
  assert.equal(removed.json().data.deleted, true);

  const detail = await call(env.app, admin, 'GET', `/orders/${orderId}`);
  assert.equal(detail.statusCode, 404);

  const list = await call(env.app, admin, 'GET', '/orders?pageSize=100');
  assert.equal(list.json().data.items.some((item: { id: string }) => item.id === orderId), false);

  const archived = await call(env.app, admin, 'GET', '/orders?pageSize=100&archived=1');
  assert.equal(archived.json().data.items.some((item: { id: string }) => item.id === orderId), false);

  const repeat = await call(env.app, admin, 'DELETE', `/orders/${orderId}`, undefined, key('delete-repeat'));
  assert.equal(repeat.statusCode, 404);

  const audits = await call(env.app, admin, 'GET', '/audit-logs?pageSize=100');
  assert.equal(audits.json().data.items.some((item: { action: string }) => item.action === 'ORDER_DELETE'), true);
});

test('已删除订单不计入看板与订单流水', async () => {
  const before = await call(env.app, admin, 'GET', '/dashboard/summary');
  const beforeTotal = before.json().data.totalOrders;

  const orderId = await createOrder('dashboard');
  await call(env.app, admin, 'POST', `/orders/${orderId}/withdraw`, { reason: '统计验证' }, key('stats-withdraw'));
  await call(env.app, admin, 'DELETE', `/orders/${orderId}`, undefined, key('stats-delete'));

  const afterSummary = await call(env.app, admin, 'GET', '/dashboard/summary');
  assert.equal(afterSummary.json().data.totalOrders, beforeTotal);

  const finance = await call(env.app, admin, 'GET', '/finance/summary');
  assert.equal(
    finance.json().data.orders.some((row: { id: string }) => row.id === orderId),
    false
  );
});