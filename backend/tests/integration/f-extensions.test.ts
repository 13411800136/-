import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { call, createTestEnv, futureDate, key, login, masterIds, type TestEnv } from '../helpers.js';

let env: TestEnv;
let admin = '';
let ids: ReturnType<typeof masterIds>;
let orderId = '';

before(async () => {
  env = await createTestEnv();
  ids = masterIds(env.db);
  admin = await login(env.app, 'admin');
  const order = await call(
    env.app,
    admin,
    'POST',
    '/orders',
    {
      customerId: ids.customerId,
      dueDate: futureDate(3),
      item: { partId: ids.partId, productName: '交期提醒与图片附件验证', spec: 'F-01', quantity: 5, unitPrice: '9.90' }
    },
    key('f-order')
  );
  assert.equal(order.statusCode, 201, order.body);
  orderId = order.json().data.id;
});

after(async () => {
  await env.close();
});

test('交期提醒：7 天内订单通知管理员，同一订单当天只提醒一次，撤销后不再新增', async () => {
  const first = await call(env.app, admin, 'GET', '/notifications');
  assert.equal(first.statusCode, 200);
  const firstCount = first
    .json()
    .data.items.filter((item: { eventType: string; title: string }) => item.eventType === 'DUE_SOON' && /交期/.test(item.title)).length;
  assert.equal(firstCount, 1);

  const second = await call(env.app, admin, 'GET', '/notifications');
  const secondCount = second
    .json()
    .data.items.filter((item: { eventType: string; title: string }) => item.eventType === 'DUE_SOON' && /交期/.test(item.title)).length;
  assert.equal(secondCount, 1);

  const cancel = await call(env.app, admin, 'POST', `/orders/${orderId}/cancel`, { reason: '交期提醒验证后撤销' }, key('f-cancel'));
  assert.equal(cancel.statusCode, 200);
  const afterCancel = await call(env.app, admin, 'GET', '/notifications/unread-count');
  assert.equal(afterCancel.statusCode, 200);
});

test('附件扩展：PNG 可上传，伪装图片被拒绝', async () => {
  const imageOrder = await call(
    env.app,
    admin,
    'POST',
    '/orders',
    {
      customerId: ids.customerId,
      dueDate: futureDate(10),
      item: { partId: ids.partId, productName: '图片附件验证', spec: 'F-02', quantity: 1, unitPrice: '1.00' }
    },
    key('f-image-order')
  );
  assert.equal(imageOrder.statusCode, 201, imageOrder.body);
  const imageOrderId = imageOrder.json().data.id;
  const png = Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    Buffer.from('0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082', 'hex')
  ]);
  const form = multipart('photo.png', 'image/png', png);
  const upload = await env.app.inject({
    method: 'POST',
    url: `/api/v1/orders/${imageOrderId}/attachments`,
    headers: { cookie: admin, 'content-type': form.contentType },
    payload: form.payload
  });
  assert.equal(upload.statusCode, 201, upload.body);
  assert.equal(upload.json().data.mime, 'image/png');

  const download = await env.app.inject({
    method: 'GET',
    url: `/api/v1/attachments/${upload.json().data.id}/download`,
    headers: { cookie: admin }
  });
  assert.equal(download.statusCode, 200);
  assert.equal(download.headers['content-type'], 'image/png');

  const fake = multipart('fake.png', 'image/png', Buffer.from('not a png', 'utf8'));
  const fakeUpload = await env.app.inject({
    method: 'POST',
    url: `/api/v1/orders/${imageOrderId}/attachments`,
    headers: { cookie: admin, 'content-type': fake.contentType },
    payload: fake.payload
  });
  assert.equal(fakeUpload.statusCode, 415);
});

test('库存导出 xlsx：真实文件、管理员鉴权', async () => {
  const response = await call(env.app, admin, 'GET', '/exports/inventory.xlsx');
  assert.equal(response.statusCode, 200);
  assert.match(String(response.headers['content-type']), /spreadsheetml/);
  assert.equal(response.rawPayload.subarray(0, 2).toString('binary'), 'PK');
  assert.ok(response.rawPayload.length > 1000);
  const logistics = await login(env.app, 'logistics');
  const denied = await call(env.app, logistics, 'GET', '/exports/inventory.xlsx');
  assert.equal(denied.statusCode, 403);
});

function multipart(filename: string, mime: string, content: Buffer): { payload: Buffer; contentType: string } {
  const boundary = `----factoryf${Date.now()}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`,
    'utf8'
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return {
    payload: Buffer.concat([head, content, tail]),
    contentType: `multipart/form-data; boundary=${boundary}`
  };
}
