import { initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { createHash, timingSafeEqual } from 'node:crypto';
import { buildOrder, canTransition, integer, validateMenu, DEFAULT_SHIPPING, DEFAULT_PAYMENT } from './lib/domain.js';

initializeApp();
const db = getDatabase();
const ownerUid = process.env.OWNER_UID || 'OWNER_UID_NOT_CONFIGURED';
const hash = value => createHash('sha256').update(value).digest('hex');
const sameHash = (left, right) => typeof left === 'string' && left.length === right.length && timingSafeEqual(Buffer.from(left), Buffer.from(right));
const publicOrder = order => { const { receiptTokenHash, ownerUid: customerUid, ...safe } = order; return safe; };
const receipt = order => ({ id: order.id, t: order.t, items: order.items, itemsTotal: order.itemsTotal, shipping: order.shipping, total: order.total, status: order.status, payment: order.payment });
function authorized(order, request) {
  return order && (order.ownerUid === request.auth.uid || request.auth.uid === ownerUid || (typeof request.data.token === 'string' && /^[a-f0-9]{64}$/.test(request.data.token) && sameHash(order.receiptTokenHash, hash(request.data.token))));
}
function safeUrl(value, host) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && (!host || url.hostname === host); } catch { return false; }
}
function paymentConfig(data) {
  const value = { ...DEFAULT_PAYMENT, ...data };
  if (!safeUrl(value.paypayUrl, 'qr.paypay.ne.jp') || (value.paypalUrl && !safeUrl(value.paypalUrl, 'paypal.me'))) throw new Error('支払いURLを確認してください。');
  if (typeof value.paypalQr !== 'string' || value.paypalQr.length > 600000 || (value.paypalQr && !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value.paypalQr))) throw new Error('PayPal画像を確認してください。');
  for (const key of ['paypayName', 'paypalName']) if (typeof value[key] !== 'string' || value[key].length > 100) throw new Error('名義を確認してください。');
  return Object.fromEntries(Object.keys(DEFAULT_PAYMENT).map(key => [key, value[key]]));
}
function shippingConfig(data) {
  const value = { ...DEFAULT_SHIPPING, ...data };
  value.threshold = integer(value.threshold, '送料無料の基準');
  value.fee = integer(value.fee, '配送料');
  for (const key of ['addressTerms', 'postalPrefixes']) if (!Array.isArray(value[key]) || value[key].length > 30 || value[key].some(term => typeof term !== 'string' || !term.trim() || term.length > 100)) throw new Error('地域の条件を確認してください。');
  if (value.postalPrefixes.some(prefix => !/^\d{1,7}$/.test(prefix))) throw new Error('郵便番号の先頭は数字で入力してください。');
  return Object.fromEntries(Object.keys(DEFAULT_SHIPPING).map(key => [key, value[key]]));
}
async function throttle(uid, action) {
  const now = Date.now();
  const result = await db.ref(`rateLimits/${uid}/${action}`).transaction(current => {
    const counter = current && now - current.t < 60000 ? current : { t: now, count: 0 };
    if (counter.count >= (action === 'createOrder' ? 6 : 90)) return;
    return { ...counter, count: counter.count + 1 };
  });
  if (!result.committed) throw new HttpsError('resource-exhausted', 'しばらくしてから再度お試しください。');
}
async function handle(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'ログインが必要です。');
  const input = request.data || {};
  const action = input.action;
  if (!['createOrder', 'getPaymentReceipt', 'reportPayment', 'recordEmailResult', 'saveMenu', 'saveSettings', 'confirmPayment', 'transitionOrder', 'deleteOrder', 'confirmInventory', 'releaseInventory'].includes(action)) throw new HttpsError('invalid-argument', '操作を確認してください。');
  const customerActions = ['createOrder', 'getPaymentReceipt', 'reportPayment', 'recordEmailResult'];
  if (!customerActions.includes(action) && request.auth.uid !== ownerUid) throw new HttpsError('permission-denied', '管理者のみ操作できます。');
  await throttle(request.auth.uid, action);
  if (action === 'getPaymentReceipt') {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(input.id || '')) throw new HttpsError('invalid-argument', '注文番号を確認してください。');
    const order = (await db.ref(`orders/${input.id}`).get()).val();
    if (!authorized(order, request)) throw new HttpsError('permission-denied', 'この注文を開く権限がありません。');
    return receipt(order);
  }
  let output;
  const now = Date.now();
  if (action === 'createOrder' && (!/^[a-zA-Z0-9_-]{16,80}$/.test(input.requestId || '') || !/^[a-f0-9]{64}$/.test(input.token || ''))) throw new HttpsError('invalid-argument', '注文の識別子を確認してください。');
  const payload = action === 'createOrder' ? {
    requestId: input.requestId, method: input.method,
    customer: Object.fromEntries(['name', 'phone', 'email', 'postal', 'address', 'note'].map(key => [key, input.customer?.[key] ?? ''])),
    items: input.items, token: input.token
  } : null;
  const payloadHash = payload ? hash(JSON.stringify(payload)) : '';
  const rootRef = db.ref();
  const holdSnapshot = () => {};
  rootRef.on('value', holdSnapshot);
  try {
    await rootRef.once('value');
    await rootRef.transaction(current => {
    const root = current || {};
    root.orders ||= {};
    root.stock ||= {};
    root.settings ||= {};
    if (action === 'createOrder') {
      root.requestReceipts ||= {};
      const previous = root.requestReceipts[input.requestId];
      if (previous) {
        if (previous.uid !== request.auth.uid || previous.hash !== payloadHash) throw new Error('注文の再試行内容が一致しません。');
        if (!root.orders[input.requestId]) throw new Error('この注文は削除されています。再注文には新しいカートが必要です。');
        output = publicOrder(root.orders[input.requestId]);
        return root;
      }
      const { order, quantities } = buildOrder(root, payload, request.auth.uid, now, hash(input.token));
      for (const [id, quantity] of Object.entries(quantities)) if (root.stock[id]) root.stock[id].qty -= quantity;
      root.orders[order.id] = order;
      root.requestReceipts[order.id] = { uid: request.auth.uid, hash: payloadHash, t: now };
      output = publicOrder(order);
    } else if (action === 'saveMenu') {
      if ((root.menuRevision || 0) !== input.revision) throw new Error('別の画面で商品が変更されました。キャンセルして再読込してください。');
      root.menu = validateMenu(input.menu);
      root.menuRevision = (root.menuRevision || 0) + 1;
      output = { revision: root.menuRevision };
    } else if (action === 'saveSettings') {
      if (!['shipping', 'payment'].includes(input.section)) throw new Error('設定を確認してください。');
      root.settings[input.section] = input.section === 'shipping' ? shippingConfig(input.value) : paymentConfig(input.value);
      output = root.settings[input.section];
    } else if (['confirmInventory', 'releaseInventory'].includes(action)) {
      if (!(root.menu || []).some(item => item.id === input.mid)) throw new Error('商品が見つかりません。');
      const stock = root.stock[input.mid] || null;
      if (JSON.stringify(stock) !== JSON.stringify(input.expected ?? null)) throw new Error('在庫が変わりました。実数を確認して再度確定してください。');
      if (action === 'releaseInventory') delete root.stock[input.mid];
      else { const qty = integer(input.qty, '実数', 1000000); root.stock[input.mid] = { qty, countedAt: now, diff: qty - (stock?.qty || 0) }; }
      output = { ok: true };
    } else {
      const order = root.orders[input.id];
      if (!order) throw new Error('注文が見つかりません。');
      if (customerActions.includes(action) && !authorized(order, request)) throw new HttpsError('permission-denied', 'この注文を操作できません。');
      if (action === 'reportPayment') {
        if (order.payment.status === 'unpaid') { order.payment.status = 'reported'; order.payment.reportedAt = now; order.reportEmailSent = false; }
        output = receipt(order);
      } else if (action === 'recordEmailResult') {
        if (request.auth.uid !== ownerUid && request.auth.uid !== order.ownerUid) throw new HttpsError('permission-denied', 'メール結果を更新できません。');
        if (!['new', 'reported'].includes(input.event) || typeof input.sent !== 'boolean') throw new Error('メール結果を確認してください。');
        const field = input.event === 'new' ? 'emailSent' : 'reportEmailSent';
        if (!order[field]) order[field] = input.sent;
        output = { ok: true };
      } else if (action === 'confirmPayment') {
        if (order.payment.status !== 'paid') { order.payment.status = 'paid'; order.payment.paidAt = now; }
        output = { ok: true };
      } else if (action === 'transitionOrder') {
        if (!canTransition(order, input.next)) throw new Error('状態を変更できません。出荷前に入金をご確認ください。');
        if (input.tracking && (typeof input.tracking !== 'string' || input.tracking.length > 100)) throw new Error('追跡番号を確認してください。');
        order.status = input.next;
        order.updatedAt = now;
        if (input.next === 'shipped') { order.tracking = input.tracking || ''; order.shippedAt = now; }
        output = { ok: true };
      } else if (action === 'deleteOrder') { delete root.orders[input.id]; output = { ok: true }; }
    }
    return root;
    });
  } finally {
    rootRef.off('value', holdSnapshot);
  }
  return output;
}
export const shopCommand = onCall({
  region: 'asia-northeast1', maxInstances: 3, timeoutSeconds: 60,
  enforceAppCheck: !process.env.FUNCTIONS_EMULATOR
}, async request => {
  try { return await handle(request); }
  catch (error) { if (error instanceof HttpsError) throw error; throw new HttpsError('failed-precondition', error.message || '操作に失敗しました。'); }
});