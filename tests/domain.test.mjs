import test from 'node:test';
import assert from 'node:assert/strict';
import { shippingFor, availability, buildOrder, canTransition, validateMenu } from '../shop-domain.js';
const customer = { name: 'Test', phone: '09012345678', email: 'test@example.com', postal: '460-0001', address: '名古屋市中区', note: '' };
const menu = [{ id: 'mutton', n: 'Mutton meat', cat: 'Mutton / ミート', p: 1500, img: '', out: false, opts: [{ n: 'Large', p: 200 }] }];
test('shipping threshold and nationwide collect', () => {
  assert.equal(shippingFor(9999, customer, { fee: 500 }).fee, 500);
  assert.equal(shippingFor(10000, customer, { fee: 500 }).fee, 0);
  assert.equal(shippingFor(20000, { ...customer, address: '東京都' }).mode, '着払い');
  assert.equal(shippingFor(10, { ...customer, address: '東京都', postal: '４６０－０００１' }, { postalPrefixes: ['460'] }).area, '名古屋市');
});
test('manual sold-out, tracked zero, untracked and low stock', () => {
  assert.equal(availability(menu[0], null).out, false);
  assert.equal(availability(menu[0], { qty: 0 }).out, true);
  assert.equal(availability(menu[0], { qty: 4 }).low, true);
  assert.equal(availability({ out: true }, { qty: 20 }).out, true);
});
test('canonical option totals ignore customer prices', () => {
  const result = buildOrder({ menu, stock: { mutton: { qty: 3 } } }, { customer, method: 'PayPay', requestId: 'test', items: [{ mid: 'mutton', option: 0, q: 2, p: 1 }] }, 'uid', 123, 'hash');
  assert.equal(result.order.total, 3400);
  assert.equal(result.quantities.mutton, 2);
});
test('aggregate option quantities and reject insufficiency', () => assert.throws(() => buildOrder({ menu, stock: { mutton: { qty: 1 } } }, { customer, method: 'PayPay', items: [{ mid: 'mutton', option: -1, q: 1 }, { mid: 'mutton', option: 0, q: 1 }] }, 'uid', 1, 'hash'), /在庫/));
test('shipping requires paid and flow cannot skip', () => {
  assert.equal(canTransition({ status: 'packing', payment: { status: 'reported' } }, 'shipped'), false);
  assert.equal(canTransition({ status: 'packing', payment: { status: 'paid' } }, 'shipped'), true);
  assert.equal(canTransition({ status: 'new', payment: { status: 'paid' } }, 'done'), false);
});
test('invalid menu price and duplicate IDs fail', () => {
  assert.throws(() => validateMenu([{ ...menu[0], p: -1 }]));
  assert.throws(() => validateMenu([menu[0], menu[0]]));
});