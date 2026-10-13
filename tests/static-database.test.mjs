import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import * as databaseSdk from 'firebase/database';
import { runDatabaseCommand } from '../database-commands.js';
const ownerUid = 'test-owner'; let environment;
const customer = { name: 'Test', phone: '09012345678', email: 'test@example.com', postal: '460-0001', address: '名古屋市中区', note: '' };
const menu = [{ id: 'mutton', n: 'Mutton meat', cat: 'Meat', p: 1500, img: '', out: false, opts: [] }];
const service = uid => ({ databaseSdk, db: environment.authenticatedContext(uid).database(), auth: { currentUser: { uid } } });
const call = (uid, action, input = {}) => runDatabaseCommand(service(uid), action, input, ownerUid);
const payload = () => ({ requestId: crypto.randomUUID(), token: 'a'.repeat(64), customer, method: 'PayPay', items: [{ mid: 'mutton', option: -1, q: 1 }] });
before(async () => {
  const rules = JSON.parse(await readFile(new URL('../database.rules.json', import.meta.url), 'utf8'));
  for (const field of ['.read', '.write']) rules.rules[field] = `auth != null && auth.uid === '${ownerUid}'`;
  environment = await initializeTestEnvironment({ projectId: 'demo-kiranahibino', database: { host: '127.0.0.1', port: 9000, rules: JSON.stringify(rules) } });
});
after(() => environment?.cleanup());
beforeEach(async () => environment.withSecurityRulesDisabled(async context => databaseSdk.set(databaseSdk.ref(context.database()), { menu, catalog: { mutton: { n: 'Mutton meat', p: 1500, out: false } }, stock: { mutton: { qty: 1 } } })));
test('customers create only their own pending order; staff settles it once', async () => {
  const input = payload(); const order = await call('customer', 'createOrder', input);
  assert.equal(order.stockStatus, 'pending');
  await assertFails(databaseSdk.get(databaseSdk.ref(service('other').db, `orders/${order.id}`)));
  await assertFails(databaseSdk.get(databaseSdk.ref(service('customer').db, 'orders')));
  await assertFails(databaseSdk.set(databaseSdk.ref(service('customer').db, 'stock/mutton/qty'), 99));
  await call(ownerUid, 'processPendingOrders');
  assert.equal((await call('customer', 'getPaymentReceipt', { id: order.id })).stockStatus, 'applied');
  await call(ownerUid, 'processPendingOrders');
  assert.equal((await databaseSdk.get(databaseSdk.ref(service(ownerUid).db, 'stock/mutton/qty'))).val(), 0);
  assert.equal((await call('customer', 'createOrder', input)).id, order.id);
});
test('only owner can confirm paid, ship or edit inventory', async () => {
  const order = await call('customer', 'createOrder', payload());
  await assert.rejects(call('customer', 'reportPayment', { id: order.id }), /在庫/);
  await call(ownerUid, 'processPendingOrders'); await call('customer', 'reportPayment', { id: order.id });
  await assertFails(databaseSdk.set(databaseSdk.ref(service('customer').db, `orders/${order.id}/payment/status`), 'paid'));
  await assert.rejects(call('customer', 'confirmPayment', { id: order.id }));
  await call(ownerUid, 'transitionOrder', { id: order.id, next: 'packing' });
  await assert.rejects(call(ownerUid, 'transitionOrder', { id: order.id, next: 'shipped' }));
  await assertFails(databaseSdk.set(databaseSdk.ref(service(ownerUid).db, `orders/${order.id}/status`), 'shipped'));
  await call(ownerUid, 'confirmPayment', { id: order.id });
  await call(ownerUid, 'transitionOrder', { id: order.id, next: 'shipped', tracking: 'TEST' });
  assert.equal((await call('customer', 'getPaymentReceipt', { id: order.id })).payment.status, 'paid');
});
test('concurrent pending orders never deduct below zero with two owner processors', async () => {
  const [first, second] = await Promise.all([call('first', 'createOrder', payload()), call('second', 'createOrder', payload())]);
  assert.equal(first.stockStatus, 'pending'); assert.equal(second.stockStatus, 'pending');
  await Promise.all([call(ownerUid, 'processPendingOrders'), call(ownerUid, 'processPendingOrders')]);
  const root = (await databaseSdk.get(databaseSdk.ref(service(ownerUid).db))).val();
  assert.deepEqual(Object.values(root.orders).map(order => order.stockStatus).sort(), ['applied', 'shortage']);
  assert.equal(root.stock.mutton.qty, 0);
});
test('rules reject forged prices, foreign ownership, paid flags and standalone orders', async () => {
  const order = await call('customer', 'createOrder', payload());
  const raw = { ...order, id: crypto.randomUUID(), t: databaseSdk.serverTimestamp() };
  const write = value => databaseSdk.update(databaseSdk.ref(service('customer').db), { [`orders/${value.id}`]: value, [`customerRequests/customer/${value.id}`]: { id: value.id, signature: 'b'.repeat(64) } });
  await assertFails(write({ ...raw, items: [{ ...raw.items[0], p: 1 }] }));
  await assertFails(write({ ...raw, ownerUid: 'other' }));
  await assertFails(write({ ...raw, payment: { ...raw.payment, status: 'paid' } }));
  await assertFails(databaseSdk.set(databaseSdk.ref(service('customer').db, `orders/${raw.id}`), raw));
  const incomplete = structuredClone(raw); delete incomplete.payment.method;
  await assertFails(write(incomplete));
});
test('owner recomputes submitted aggregates before exposing payment', async () => {
  const order = await call('customer', 'createOrder', payload());
  const raw = { ...order, id: crypto.randomUUID(), t: databaseSdk.serverTimestamp(), itemsTotal: 1, total: 1 };
  await databaseSdk.update(databaseSdk.ref(service('customer').db), { [`orders/${raw.id}`]: raw, [`customerRequests/customer/${raw.id}`]: { id: raw.id, signature: 'c'.repeat(64) } });
  await call(ownerUid, 'deleteOrder', { id: order.id });
  await call(ownerUid, 'processPendingOrders');
  const settled = await call('customer', 'getPaymentReceipt', { id: raw.id });
  assert.equal(settled.total, 1500); assert.equal(settled.stockStatus, 'applied');
});
test('request records prevent retry-after-deletion and changed-payload retries', async () => {
  const input = payload(); const order = await call('customer', 'createOrder', input);
  await assert.rejects(call('customer', 'createOrder', { ...input, customer: { ...customer, name: 'Changed' } }));
  await call(ownerUid, 'deleteOrder', { id: order.id });
  await assert.rejects(call('customer', 'createOrder', input));
  assert.equal((await databaseSdk.get(databaseSdk.ref(service(ownerUid).db, 'stock/mutton/qty'))).val(), 1);
});
test('inventory stale counts and menu revisions are protected', async () => {
  await call(ownerUid, 'saveMenu', { menu, revision: 0 });
  await assert.rejects(call(ownerUid, 'saveMenu', { menu, revision: 0 }));
  const order = await call('customer', 'createOrder', payload()); await call(ownerUid, 'processPendingOrders');
  await assert.rejects(call(ownerUid, 'confirmInventory', { mid: 'mutton', qty: 9, expected: { qty: 1 } }));
  await call(ownerUid, 'confirmInventory', { mid: 'mutton', qty: 3, expected: { qty: 0 } });
  const stock = (await databaseSdk.get(databaseSdk.ref(service(ownerUid).db, 'stock/mutton'))).val();
  assert.equal(stock.diff, 3);
  await call(ownerUid, 'releaseInventory', { mid: 'mutton', expected: stock });
  await assert.rejects(call('customer', 'saveMenu', { menu, revision: 1 }));
  await assertFails(databaseSdk.set(databaseSdk.ref(service('customer').db, 'menu'), menu));
  assert.equal((await call('customer', 'getPaymentReceipt', { id: order.id })).stockStatus, 'applied');
});
test('missing authentication, unknown options and unavailable PayPal are rejected', async () => {
  const anonymousDb = environment.unauthenticatedContext().database();
  await assertFails(databaseSdk.get(databaseSdk.ref(anonymousDb, 'orders')));
  await assert.rejects(runDatabaseCommand({ ...service('customer'), auth: { currentUser: null } }, 'createOrder', payload(), ownerUid));
  await assert.rejects(call('customer', 'createOrder', { ...payload(), method: 'PayPal' }));
  await assert.rejects(call('customer', 'createOrder', { ...payload(), items: [{ mid: 'mutton', q: 1, option: 99 }] }));
});
test('legacy reserved orders can report payment without deducting stock twice', async () => {
  const order = await call('customer', 'createOrder', payload());
  await databaseSdk.update(databaseSdk.ref(service(ownerUid).db), { [`orders/${order.id}/stockStatus`]: null, 'stock/mutton/qty': 0 });
  await call(ownerUid, 'processPendingOrders');
  assert.equal((await databaseSdk.get(databaseSdk.ref(service(ownerUid).db, 'stock/mutton/qty'))).val(), 0);
  assert.equal((await call('customer', 'reportPayment', { id: order.id })).payment.status, 'reported');
});
test('option prices and combined quantities settle correctly under database rules', async () => {
  await call(ownerUid, 'saveMenu', { menu: [{ ...menu[0], opts: [{ n: 'Large', p: 200 }] }], revision: 0 });
  await call(ownerUid, 'confirmInventory', { mid: 'mutton', qty: 3, expected: { qty: 1 } });
  const order = await call('customer', 'createOrder', { ...payload(), items: [{ mid: 'mutton', option: 0, q: 1 }, { mid: 'mutton', option: -1, q: 1 }] });
  assert.equal(order.items[0].p, 1700);
  await call(ownerUid, 'processPendingOrders');
  assert.equal((await call('customer', 'getPaymentReceipt', { id: order.id })).total, 3200);
  assert.equal((await databaseSdk.get(databaseSdk.ref(service(ownerUid).db, 'stock/mutton/qty'))).val(), 1);
});