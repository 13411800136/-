import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { call, createTestEnv, futureDate, key, login, masterIds, type TestEnv } from '../helpers.js';

let env: TestEnv;
let admin = '';
let ids: ReturnType<typeof masterIds>;
let employeeCookie = '';

before(async () => {
  env = await createTestEnv();
  ids = masterIds(env.db);
  admin = await login(env.app, 'admin');
});

after(async () => {
  await env.close();
});

test('基础数据：编码唯一、改名不破坏历史快照、停用不能新建引用', async () => {
  const created = await call(env.app, admin, 'POST', '/customers', {
    code: 'CUS-T01',
    name: '历史快照客户',
    contact: '合成联系人'
  });
  assert.equal(created.statusCode, 201, created.body);
  const customerId = created.json().data.id;

  const duplicate = await call(env.app, admin, 'POST', '/customers', {
    code: 'cus-t01',
    name: '重复编码',
    contact: ''
  });
  assert.equal(duplicate.statusCode, 409);

  const order = await call(
    env.app,
    admin,
    'POST',
    '/orders',
    {
      customerId,
      dueDate: futureDate(10),
      item: { productName: '快照验证产品', spec: 'SNAP-01', quantity: 3, unitPrice: '10.00' }
    },
    key('snapshot')
  );
  assert.equal(order.statusCode, 201, order.body);
  const orderId = order.json().data.id;

  await call(env.app, admin, 'PATCH', `/customers/${customerId}`, { name: '改名后的客户' });
  const detail = await call(env.app, admin, 'GET', `/orders/${orderId}`);
  assert.equal(detail.json().data.order.customer.name, '历史快照客户');

  const supplier = await call(env.app, admin, 'POST', '/suppliers', {
    code: 'SUP-T01',
    name: '停用供应商',
    contact: ''
  });
  const supplierId = supplier.json().data.id;
  await call(env.app, admin, 'PATCH', `/suppliers/${supplierId}`, { active: false });

  const order2 = await call(
    env.app,
    admin,
    'POST',
    '/orders',
    {
      customerId,
      dueDate: futureDate(10),
      item: { productName: '停用供应商验证', spec: 'STOP-01', quantity: 1, unitPrice: '1.00' }
    },
    key('stop-order')
  );
  const purchase = await call(
    env.app,
    admin,
    'POST',
    `/orders/${order2.json().data.id}/purchase-orders`,
    { supplierId, item: { partId: ids.partId, quantity: 1, unitPrice: '1.00' } },
    key('stop-po')
  );
  assert.equal(purchase.statusCode, 400);

  const parts = await call(env.app, admin, 'GET', '/parts?search=铝合金');
  assert.equal(parts.statusCode, 200);
  assert.ok(parts.json().data.items.length >= 1);
});

test('员工账号：创建、部门匹配、停用后旧会话与登录均失效', async () => {
  const department = env.db.get<{ id: string; category: string }>(
    "SELECT id, category FROM departments WHERE code = 'PROD-A'"
  )!;
  const created = await call(env.app, admin, 'POST', '/users', {
    username: 'prod_t01',
    displayName: '临时生产员工',
    role: 'PRODUCTION',
    departmentId: department.id,
    password: 'Temp@2026'
  });
  assert.equal(created.statusCode, 201, created.body);
  const userId = created.json().data.id;

  employeeCookie = await login(env.app, 'prod_t01', 'Temp@2026');
  const me = await call(env.app, employeeCookie, 'GET', '/auth/me');
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().data.user.role, 'PRODUCTION');

  const duplicate = await call(env.app, admin, 'POST', '/users', {
    username: 'PROD_T01',
    displayName: '重复账号',
    role: 'PRODUCTION',
    departmentId: department.id,
    password: 'Temp@2026'
  });
  assert.equal(duplicate.statusCode, 409);

  const disabled = await call(env.app, admin, 'PATCH', `/users/${userId}`, { active: false });
  assert.equal(disabled.statusCode, 200, disabled.body);

  const oldSession = await call(env.app, employeeCookie, 'GET', '/auth/me');
  assert.equal(oldSession.statusCode, 401);
  const relogin = await call(env.app, null, 'POST', '/auth/login', {
    username: 'prod_t01',
    password: 'Temp@2026'
  });
  assert.equal(relogin.statusCode, 401);
});
