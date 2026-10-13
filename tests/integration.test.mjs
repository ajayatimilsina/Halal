import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { ref, get, set } from 'firebase/database';

const projectId = 'demo-kiranahibino';
let environment;
let customerToken;
let otherToken;
let ownerToken;
const customer = { name: 'Test', phone: '09012345678', email: 'test@example.com', postal: '460-0001', address: '名古屋市中区', note: '' };
const menu = [{ id: 'mutton', n: 'Mutton meat', cat: 'Mutton / ミート', p: 1500, img: '', out: false, opts: [{ n: 'Large', p: 200 }] }, { id: 'rice', n: 'Rice', cat: 'Rice', p: 1000, img: '', out: false, opts: [] }];
const payload = (overrides = {}) => ({ requestId: crypto.randomUUID(), token: 'a'.repeat(64), customer, method: 'PayPay', items: [{ mid: 'mutton', option: -1, q: 1 }], ...overrides });
async function auth(body, method = 'signUp') {
  const response = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:${method}?key=demo-key`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json(); if (!response.ok) throw new Error(JSON.stringify(data)); return data.idToken;
}
async function call(token, action, data = {}) {
  const response = await fetch(`http://127.0.0.1:5001/${projectId}/asia-northeast1/shopCommand`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ data: { ...data, action } }) });
  const result = await response.json(); if (result.error) throw new Error(result.error.message); return result.result;
}
async function root() {
  let data;
  await environment.withSecurityRulesDisabled(async context => { data = (await get(ref(context.database()))).val(); });
  return data;
}
before(async () => {
  environment = await initializeTestEnvironment({ projectId, database: { host: '127.0.0.1', port: 9000, rules: await readFile(new URL('../database.rules.json', import.meta.url), 'utf8') } });
  customerToken = await auth({ returnSecureToken: true }); otherToken = await auth({ returnSecureToken: true });
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ uid: 'OWNER_UID_NOT_CONFIGURED', sub: 'test', iss: 'test', aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })}.`;
  ownerToken = await auth({ token, returnSecureToken: true }, 'signInWithCustomToken');
});
after(async () => environment?.cleanup());
beforeEach(async () => environment.withSecurityRulesDisabled(async context => set(ref(context.database()), { menu, stock: { mutton: { qty: 1 }, rice: { qty: 5 } }, settings: { shipping: { threshold: 10000, fee: 500, addressTerms: ['名古屋市'] } } })));
test('public reads, private orders and all direct writes denied', async () => {
  const db = environment.unauthenticatedContext().database();
  await assertSucceeds(get(ref(db, 'menu'))); await assertSucceeds(get(ref(db, 'stock')));
  await assertFails(get(ref(db, 'orders'))); await assertFails(set(ref(db, 'stock/mutton/qty'), 50)); await assertFails(set(ref(db, 'orders/fake'), {}));
  await assertSucceeds(get(ref(environment.authenticatedContext('OWNER_UID_NOT_CONFIGURED').database(), 'orders')));
});
test('checkout is canonical and works without an open staff page', async () => {
  const order = await call(customerToken, 'createOrder', payload({ total: 1, items: [{ mid: 'mutton', option: 0, q: 1, p: 1 }] }));
  assert.equal(order.total, 2200); assert.equal(order.payment.status, 'unpaid'); assert.equal((await root()).stock.mutton.qty, 0);
});
test('concurrent checkout cannot oversell last unit', async () => {
  const results = await Promise.allSettled([call(customerToken, 'createOrder', payload()), call(otherToken, 'createOrder', payload())]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const data = await root(); assert.equal(data.stock.mutton.qty, 0); assert.equal(Object.keys(data.orders).length, 1);
});
test('multi-item failure does not deduct any inventory', async () => {
  await assert.rejects(call(customerToken, 'createOrder', payload({ items: [{ mid: 'rice', option: -1, q: 2 }, { mid: 'mutton', option: -1, q: 2 }] })));
  assert.equal((await root()).stock.rice.qty, 5); assert.equal((await root()).orders, undefined);
});
test('idempotent retry, changed payload denial and deletion tombstone', async () => {
  const input = payload(); const order = await call(customerToken, 'createOrder', input);
  assert.equal((await call(customerToken, 'createOrder', input)).id, order.id);
  await assert.rejects(call(customerToken, 'createOrder', { ...input, customer: { ...customer, name: 'Changed' } }));
  await call(ownerToken, 'deleteOrder', { id: order.id });
  await assert.rejects(call(customerToken, 'createOrder', input)); assert.equal((await root()).stock.mutton.qty, 0);
});
test('receipt capability, paid confirmation and shipping invariants', async () => {
  const input = payload(); const order = await call(customerToken, 'createOrder', input);
  await assert.rejects(call(otherToken, 'getPaymentReceipt', { id: order.id }));
  const receipt = await call(otherToken, 'getPaymentReceipt', { id: order.id, token: input.token }); assert.equal(receipt.customer, undefined);
  await assert.rejects(call(customerToken, 'confirmPayment', { id: order.id }));
  await call(ownerToken, 'transitionOrder', { id: order.id, next: 'packing' });
  await assert.rejects(call(ownerToken, 'transitionOrder', { id: order.id, next: 'shipped' }));
  await call(customerToken, 'reportPayment', { id: order.id });
  await call(ownerToken, 'confirmPayment', { id: order.id });
  await call(customerToken, 'reportPayment', { id: order.id });
  assert.equal((await call(customerToken, 'getPaymentReceipt', { id: order.id })).payment.status, 'paid');
  await call(ownerToken, 'transitionOrder', { id: order.id, next: 'shipped', tracking: 'TRACK123' });
  assert.equal((await root()).orders[order.id].tracking, 'TRACK123');
});
test('inventory rejects stale actual counts and supports untracking', async () => {
  await call(customerToken, 'createOrder', payload());
  await assert.rejects(call(ownerToken, 'confirmInventory', { mid: 'mutton', expected: { qty: 1 }, qty: 10 }));
  await call(ownerToken, 'confirmInventory', { mid: 'mutton', expected: { qty: 0 }, qty: 3 });
  const stock = (await root()).stock.mutton; assert.equal(stock.diff, 3); assert.ok(stock.countedAt);
  await call(ownerToken, 'releaseInventory', { mid: 'mutton', expected: stock }); assert.equal((await root()).stock.mutton, undefined);
});
test('non-owner settings and unsupported PayPal rejected', async () => {
  await assert.rejects(call(customerToken, 'saveSettings', { section: 'shipping', value: {} }));
  await assert.rejects(call(customerToken, 'createOrder', payload({ method: 'PayPal' })));
  await assert.rejects(call(customerToken, 'createOrder', payload({ items: [{ mid: 'mutton', option: 99, q: 1 }] })));
});
test('menu revisions reject conflicting saves and manual sold-out blocks checkout', async () => {
  const changed = menu.map(item => ({ ...item, out: true }));
  await call(ownerToken, 'saveMenu', { menu: changed, revision: 0 });
  await assert.rejects(call(ownerToken, 'saveMenu', { menu, revision: 0 }));
  await assert.rejects(call(customerToken, 'createOrder', payload()));
  assert.equal((await root()).stock.mutton.qty, 1);
});