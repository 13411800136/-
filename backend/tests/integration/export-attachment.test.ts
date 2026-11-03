import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { call, createTestEnv, futureDate, key, login, masterIds, type TestEnv } from '../helpers.js';

let env: TestEnv;
let admin = '';
let logistics = '';
let orderId = '';
let attachmentId = '';

before(async () => {
  env = await createTestEnv();
  admin = await login(env.app, 'admin');
  logistics = await login(env.app, 'logistics');
  const ids = masterIds(env.db);
  const order = await call(
    env.app,
    admin,
    'POST',
    '/orders',
    {
      customerId: ids.customerId,
      dueDate: futureDate(10),
      note: '附件与导出验收',
      item: { partId: ids.partId, productName: '导出测试产品', spec: 'EXP-01', quantity: 5, unitPrice: '9.90' }
    },
    key('export-order')
  );
  assert.equal(order.statusCode, 201, order.body);
  orderId = order.json().data.id;
});

after(async () => {
  await env.close();
});

test('订单列表导出 xlsx：真实文件、鉴权、空筛选仍生成表头', async () => {
  const response = await call(env.app, admin, 'GET', '/exports/orders.xlsx');
  assert.equal(response.statusCode, 200);
  assert.match(String(response.headers['content-type']), /spreadsheetml/);
  assert.match(String(response.headers['content-disposition']), /\.xlsx/);
  const buffer = response.rawPayload;
  assert.equal(buffer.subarray(0, 2).toString('binary'), 'PK');
  assert.ok(buffer.length > 1000);

  const empty = await call(env.app, admin, 'GET', '/exports/orders.xlsx?keyword=绝对不存在的订单');
  assert.equal(empty.statusCode, 200);
  assert.equal(empty.rawPayload.subarray(0, 2).toString('binary'), 'PK');

  const denied = await call(env.app, logistics, 'GET', '/exports/orders.xlsx');
  assert.equal(denied.statusCode, 403);
});

function multipart(filename: string, mime: string, content: Buffer): { payload: Buffer; contentType: string } {
  const boundary = `----factorytest${Date.now()}`;
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

test('附件：PDF 上传、下载、类型伪装与越权拒绝', async () => {
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n', 'utf8');
  const form = multipart('demo-drawing.pdf', 'application/pdf', pdf);
  const upload = await env.app.inject({
    method: 'POST',
    url: `/api/v1/orders/${orderId}/attachments`,
    headers: { cookie: admin, 'content-type': form.contentType },
    payload: form.payload
  });
  assert.equal(upload.statusCode, 201, upload.body);
  attachmentId = upload.json().data.id;

  const download = await env.app.inject({
    method: 'GET',
    url: `/api/v1/attachments/${attachmentId}/download`,
    headers: { cookie: admin }
  });
  assert.equal(download.statusCode, 200);
  assert.equal(download.headers['content-type'], 'application/pdf');
  assert.equal(download.rawPayload.subarray(0, 5).toString('ascii'), '%PDF-');

  const denied = await env.app.inject({
    method: 'GET',
    url: `/api/v1/attachments/${attachmentId}/download`,
    headers: { cookie: logistics }
  });
  assert.equal(denied.statusCode, 403);

  const fake = multipart('fake.pdf', 'application/pdf', Buffer.from('not a pdf', 'utf8'));
  const fakeUpload = await env.app.inject({
    method: 'POST',
    url: `/api/v1/orders/${orderId}/attachments`,
    headers: { cookie: admin, 'content-type': fake.contentType },
    payload: fake.payload
  });
  assert.equal(fakeUpload.statusCode, 415);
  assert.equal(fakeUpload.json().error.code, 'UNSUPPORTED_FILE_TYPE');

  const txt = multipart('note.txt', 'text/plain', Buffer.from('hello', 'utf8'));
  const txtUpload = await env.app.inject({
    method: 'POST',
    url: `/api/v1/orders/${orderId}/attachments`,
    headers: { cookie: admin, 'content-type': txt.contentType },
    payload: txt.payload
  });
  assert.equal(txtUpload.statusCode, 415);

  const list = await call(env.app, admin, 'GET', `/orders/${orderId}/attachments`);
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().data.items.length, 1);
  assert.equal(list.json().data.items[0].originalName, 'demo-drawing.pdf');
});
