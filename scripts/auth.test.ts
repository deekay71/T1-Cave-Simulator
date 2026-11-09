import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTicketIssuer, createTicketVerifier, generateTicketKeys } from '@te-liet/auth';

const keys = await generateTicketKeys();
const issue = createTicketIssuer(keys.privateJwk);
const verify = createTicketVerifier(keys.publicJwks);

test('vé hợp lệ trả về đúng danh tính', async () => {
  const ticket = await issue({ id: 'acc-1', name: 'Người trong hang', trust: 0 });
  assert.deepEqual(await verify(ticket), { id: 'acc-1', name: 'Người trong hang', trust: 0 });
});

test('vé bị sửa hoặc ký bằng khóa khác bị từ chối', async () => {
  const ticket = await issue({ id: 'acc-1', name: 'A', trust: 0 });
  const [h, , s] = ticket.split('.');
  const forged = [h, Buffer.from(JSON.stringify({ sub: 'acc-1', name: 'A', trust: 3 })).toString('base64url'), s].join('.');
  await assert.rejects(verify(forged));
  const other = await generateTicketKeys();
  await assert.rejects(verify(await createTicketIssuer(other.privateJwk)({ id: 'acc-1', name: 'A', trust: 0 })));
});

test('khóa công khai không chứa phần riêng tư', () => {
  for (const key of keys.publicJwks.keys) assert.equal('d' in key, false);
});

test('vé thiếu hoặc sai kiểu bị từ chối', async () => {
  await assert.rejects(verify(undefined));
  await assert.rejects(verify('not-a-jwt'));
});
