import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { call, createTestEnv, key, login, masterIds, type TestEnv } from '../helpers.js';

let env: TestEnv;
let admin = '';
let partId = '';

before(async () => {
  env = await createTestEnv({ connections: 2 });
  admin = await login(env.apps[0]!, 'admin');
  partId = masterIds(env.db).partId;
});

after(async () => {
  await env.close();
});

test('配件库存：增减、流水、非负与幂等绑定', async () => {
  const adjustKey = key('inv');
  const plus = await call(
    env.apps[0]!,
    admin,
    'POST',
    '/inventory/parts/adjust',
    { partId, delta: 10, reason: '验收入库' },
    adjustKey
  );
  assert.equal(plus.statusCode, 200, plus.body);
  assert.deepEqual(
    { before: plus.json().data.before, delta: plus.json().data.delta, after: plus.json().data.after },
    { before: 0, delta: 10, after: 10 }
  );

  const replay = await call(
    env.apps[0]!,
    admin,
    'POST',
    '/inventory/parts/adjust',
    { partId, delta: 10, reason: '验收入库' },
    adjustKey
  );
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.json().data.logId, plus.json().data.logId);
  assert.equal(replay.json().data.after, 10);

  const minus = await call(
    env.apps[0]!,
    admin,
    'POST',
    '/inventory/parts/adjust',
    { partId, delta: -3, reason: '演示领用' },
    key('inv')
  );
  assert.equal(minus.statusCode, 200, minus.body);
  assert.equal(minus.json().data.after, 7);

  const insufficient = await call(
    env.apps[0]!,
    admin,
    'POST',
    '/inventory/parts/adjust',
    { partId, delta: -8, reason: '超领' },
    key('inv')
  );
  assert.equal(insufficient.statusCode, 409);
  assert.equal(insufficient.json().error.code, 'STOCK_INSUFFICIENT');

  const conflict = await call(
    env.apps[0]!,
    admin,
    'POST',
    '/inventory/parts/adjust',
    { partId, delta: 11, reason: '验收入库' },
    adjustKey
  );
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().error.code, 'CONFLICT');

  const blankReason = await call(
    env.apps[0]!,
    admin,
    'POST',
    '/inventory/parts/adjust',
    { partId, delta: 1, reason: '  ' },
    key('inv')
  );
  assert.equal(blankReason.statusCode, 400);

  const logs = await call(env.apps[0]!, admin, 'GET', `/inventory/parts/${partId}/logs`);
  assert.equal(logs.statusCode, 200);
  for (const log of logs.json().data.logs) {
    assert.equal(log.before + log.delta, log.after);
  }
});

test('真数据库并发：两个 -7 只能一次成功，最终 3，无丢更新', async () => {
  const reset = await call(
    env.apps[0]!,
    admin,
    'POST',
    '/inventory/parts/adjust',
    { partId, delta: 3, reason: '重置夹具至 10' },
    key('reset')
  );
  assert.equal(reset.statusCode, 200);

  const [left, right] = await Promise.all([
    call(env.apps[0]!, admin, 'POST', '/inventory/parts/adjust', { partId, delta: -7, reason: '并发扣减 A' }, key('conc-a')),
    call(env.apps[1]!, admin, 'POST', '/inventory/parts/adjust', { partId, delta: -7, reason: '并发扣减 B' }, key('conc-b'))
  ]);
  const statuses = [left.statusCode, right.statusCode].sort();
  assert.deepEqual(statuses, [200, 409]);
  const row = env.db.get<{ quantity: number; version: number }>(
    'SELECT i.quantity, i.version FROM part_inventory i WHERE i.part_id = ?',
    partId
  );
  assert.equal(row?.quantity, 3);
  const successes = env.db.get<{ count: number }>(
    "SELECT COUNT(*) AS count FROM inventory_logs WHERE resource_type = 'PART' AND delta = -7"
  );
  assert.equal(successes?.count, 1);
});

test('成品首次创建并发：唯一身份、最终数量 2、两笔流水', async () => {
  const name = '并发验证成品';
  const spec = 'CC-01';
  const [left, right] = await Promise.all([
    call(
      env.apps[0]!,
      admin,
      'POST',
      '/inventory/products/adjust',
      { productName: name, spec, delta: 1, reason: '并发首建 A' },
      key('prod-a')
    ),
    call(
      env.apps[1]!,
      admin,
      'POST',
      '/inventory/products/adjust',
      { productName: name, spec, delta: 1, reason: '并发首建 B' },
      key('prod-b')
    )
  ]);
  assert.equal(left.statusCode, 200, left.body);
  assert.equal(right.statusCode, 200, right.body);

  const products = env.db.all<{ id: string; quantity: number }>(
    'SELECT id, quantity FROM product_inventory WHERE product_name = ?',
    name
  );
  assert.equal(products.length, 1);
  assert.equal(products[0]!.quantity, 2);
  const logs = env.db.get<{ count: number }>(
    "SELECT COUNT(*) AS count FROM inventory_logs WHERE resource_type = 'PRODUCT' AND resource_id = ?",
    products[0]!.id
  );
  assert.equal(logs?.count, 2);

  const negativeFirst = await call(
    env.apps[0]!,
    admin,
    'POST',
    '/inventory/products/adjust',
    { productName: '不存在的负库存', spec: '', delta: -1, reason: '非法负向' },
    key('prod-neg')
  );
  assert.equal(negativeFirst.statusCode, 409);

  const search = await call(env.apps[0]!, admin, 'GET', '/inventory/products?search=并发验证');
  assert.equal(search.statusCode, 200);
  assert.equal(search.json().data.items.length, 1);
  assert.equal(search.json().data.items[0].quantity, 2);
});

test('并发同键：两个相同请求只产生一次业务影响', async () => {
  const before = env.db.get<{ quantity: number }>(
    'SELECT quantity FROM part_inventory WHERE part_id = ?',
    partId
  )!.quantity;
  const sharedKey = key('same');
  const [left, right] = await Promise.all([
    call(
      env.apps[0]!,
      admin,
      'POST',
      '/inventory/parts/adjust',
      { partId, delta: 2, reason: '并发同键 A' },
      sharedKey
    ),
    call(
      env.apps[1]!,
      admin,
      'POST',
      '/inventory/parts/adjust',
      { partId, delta: 2, reason: '并发同键 A' },
      sharedKey
    )
  ]);
  assert.equal(left.statusCode, 200, left.body);
  assert.equal(right.statusCode, 200, right.body);
  assert.equal(left.json().data.logId, right.json().data.logId);
  const after = env.db.get<{ quantity: number }>(
    'SELECT quantity FROM part_inventory WHERE part_id = ?',
    partId
  )!.quantity;
  assert.equal(after, before + 2);
  const logs = env.db.get<{ c: number }>(
    "SELECT COUNT(*) AS c FROM inventory_logs WHERE reason = '并发同键 A'"
  );
  assert.equal(logs?.c, 1);
});

test('库存调整失败不写成功流水', async () => {
  const before = env.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM inventory_logs');
  const response = await call(
    env.apps[0]!,
    admin,
    'POST',
    '/inventory/parts/adjust',
    { partId, delta: -999, reason: '必然失败' },
    key('fail')
  );
  assert.equal(response.statusCode, 409);
  const after = env.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM inventory_logs');
  assert.equal(after?.count, before?.count);
});
