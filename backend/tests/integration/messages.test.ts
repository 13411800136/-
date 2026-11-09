import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { call, createTestEnv, key, login, type TestEnv } from '../helpers.js';

let env: TestEnv;
let admin = '';
let logistics = '';
let qc = '';

before(async () => {
  env = await createTestEnv();
  admin = await login(env.app, 'admin');
  logistics = await login(env.app, 'logistics');
  qc = await login(env.app, 'qc');
});

after(async () => {
  await env.close();
});

function userId(username: string): string {
  return env.db.get<{ id: string }>('SELECT id FROM users WHERE username = ?', username)!.id;
}

test('内部消息：现场可联系管理员，未读/已读隔离', async () => {
  const messageKey = key('message');
  const body = {
    recipientId: userId('admin'),
    body: '管理员你好，3 号库位外箱有人为破损，请确认是否换货。'
  };
  const sent = await call(env.app, logistics, 'POST', '/messages', body, messageKey);
  assert.equal(sent.statusCode, 201, sent.body);
  const messageId = sent.json().data.id;

  const replay = await call(env.app, logistics, 'POST', '/messages', body, messageKey);
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.json().data.id, messageId);
  assert.equal(
    env.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM internal_messages')!.c,
    1
  );

  const inbox = await call(env.app, admin, 'GET', '/messages/inbox');
  assert.equal(inbox.statusCode, 200);
  assert.equal(inbox.json().data.unreadCount, 1);
  assert.equal(inbox.json().data.items[0].sender.name, '物流专员 林航');

  const sentList = await call(env.app, logistics, 'GET', '/messages/sent');
  assert.equal(sentList.json().data.items.length, 1);

  const qcInbox = await call(env.app, qc, 'GET', '/messages/inbox');
  assert.equal(qcInbox.json().data.items.length, 0);

  const read = await call(env.app, admin, 'POST', `/messages/${messageId}/read`, {});
  assert.equal(read.statusCode, 200);
  assert.equal(read.json().data.unreadCount, 0);

  const wrongReader = await call(env.app, qc, 'POST', `/messages/${messageId}/read`, {});
  assert.equal(wrongReader.statusCode, 403);
});

test('内部消息：接收人列表包含其他角色且不能发给自己', async () => {
  const recipients = await call(env.app, logistics, 'GET', '/messages/recipients');
  assert.equal(recipients.statusCode, 200);
  const names = recipients.json().data.items.map((item: { displayName: string }) => item.displayName);
  assert.ok(names.includes('系统管理员'));
  assert.equal(names.includes('物流专员 林航'), false);

  const self = await call(
    env.app,
    logistics,
    'POST',
    '/messages',
    { recipientId: userId('logistics'), body: '给自己发消息' },
    key('self')
  );
  assert.equal(self.statusCode, 400);
});

test('内部消息：管理员可以联系现场角色', async () => {
  const sent = await call(
    env.app,
    admin,
    'POST',
    '/messages',
    { recipientId: userId('qc'), body: '请优先复检 SO-DEMO-0001 的尺寸项。' },
    key('admin-message')
  );
  assert.equal(sent.statusCode, 201, sent.body);
  const inbox = await call(env.app, qc, 'GET', '/messages/inbox');
  assert.equal(inbox.json().data.items[0].sender.name, '系统管理员');
});
