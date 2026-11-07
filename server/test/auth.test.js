import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

process.env.DB_PATH = ':memory:';
const { validateInitData } = await import('../src/auth.js');

const TOKEN = '123456:TEST-TOKEN';
function sign(fields, token = TOKEN) {
  const params = new URLSearchParams(fields);
  const dcs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  params.set('hash', createHmac('sha256', secret).update(dcs).digest('hex'));
  return params.toString();
}
const fresh = () => String(Math.floor(Date.now() / 1000));
const user = JSON.stringify({ id: 42, first_name: 'Alex' });

test('accepts correctly signed initData', () => {
  const r = validateInitData(sign({ user, auth_date: fresh(), start_param: 'invite_abc' }), TOKEN);
  assert.equal(r.user.id, 42);
  assert.equal(r.startParam, 'invite_abc');
});
test('rejects wrong bot token', () => {
  assert.equal(validateInitData(sign({ user, auth_date: fresh() }, 'other:token'), TOKEN), null);
});
test('rejects tampered payload', () => {
  const good = sign({ user, auth_date: fresh() });
  const evil = good.replace(encodeURIComponent('"id":42'), encodeURIComponent('"id":43'));
  assert.equal(validateInitData(evil, TOKEN), null);
});
test('rejects expired auth_date', () => {
  const old = String(Math.floor(Date.now() / 1000) - 8 * 24 * 3600);
  assert.equal(validateInitData(sign({ user, auth_date: old }), TOKEN), null);
});
test('rejects empty input', () => {
  assert.equal(validateInitData('', TOKEN), null);
  assert.equal(validateInitData('a=b', TOKEN), null);
});
