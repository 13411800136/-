import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { call, createTestEnv, login, type TestEnv } from '../helpers.js';

let env: TestEnv;

before(async () => {
  env = await createTestEnv();
});

after(async () => {
  await env.close();
});

test('无凭证请求库存写入返回 401，伪造角色头无效', async () => {
  const response = await env.app.inject({
    method: 'POST',
    url: '/api/v1/inventory/parts/adjust',
    headers: {
      'content-type': 'application/json',
      'x-role': 'ADMIN',
      'x-actor-id': 'fake-admin'
    },
    payload: { partId: 'x', delta: 1, reason: '伪造' }
  });
  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.code, 'UNAUTHENTICATED');
});

test('错误密码返回通用错误，不泄露账号是否存在', async () => {
  const response = await call(env.app, null, 'POST', '/auth/login', {
    username: 'admin',
    password: 'wrong-password'
  });
  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.message, '用户名或密码不正确');
});

test('真实登录、会话读取与退出后失效', async () => {
  const cookie = await login(env.app, 'admin');
  const me = await call(env.app, cookie, 'GET', '/auth/me');
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().data.user.role, 'ADMIN');

  const logout = await call(env.app, cookie, 'POST', '/auth/logout', {});
  assert.equal(logout.statusCode, 200);
  const afterLogout = await call(env.app, cookie, 'GET', '/auth/me');
  assert.equal(afterLogout.statusCode, 401);
});

test('现场角色不能访问管理员接口', async () => {
  const logistics = await login(env.app, 'logistics');
  const inventory = await call(env.app, logistics, 'GET', '/inventory/parts');
  assert.equal(inventory.statusCode, 403);

  const production = await login(env.app, 'prod');
  const orders = await call(env.app, production, 'GET', '/orders');
  assert.equal(orders.statusCode, 403);
});

test('管理员不能通过通用 PATCH 直接改订单状态', async () => {
  const admin = await login(env.app, 'admin');
  const response = await call(env.app, admin, 'PATCH', '/orders/demo-order-0001/status', { status: 'COMPLETED' });
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().error.code, 'FEATURE_NOT_ENABLED');
});

test('未支持撤销时显式拒绝而不是删除记录', async () => {
  const admin = await login(env.app, 'admin');
  const response = await call(env.app, admin, 'POST', '/arrival-records/demo/cancel', {});
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().error.code, 'FEATURE_NOT_ENABLED');
});
