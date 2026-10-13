import { buildOrder, canTransition, validateMenu, integer, settlePendingOrder, DEFAULT_PAYMENT, DEFAULT_SHIPPING } from './shop-domain.js';
const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');
const receipt = order => ({ id: order.id, t: order.t, items: order.items, itemsTotal: order.itemsTotal, shipping: order.shipping, total: order.total, status: order.status, stockStatus: order.stockStatus, payment: order.payment });
const read = async (service, path) => (await service.databaseSdk.get(service.databaseSdk.ref(service.db, path))).val();
function requireId(id) { if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id || '')) throw new Error('注文番号・商品IDを確認してください。'); }
function validUrl(value, host) { try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === host && !url.username && !url.password; } catch { return false; } }
async function ownOrder(service, id, ownerUid) {
  requireId(id);
  const order = await read(service, `orders/${id}`);
  if (!order || ![order.ownerUid, ownerUid].includes(service.auth.currentUser.uid)) throw new Error('同じブラウザから注文を開いてください。');
  order.items = Object.values(order.items || {});
  return order;
}
async function ownerTransaction(service, mutate) {
  const rootRef = service.databaseSdk.ref(service.db); let stop;
  try {
    await new Promise((resolve, reject) => { stop = service.databaseSdk.onValue(rootRef, resolve, reject); });
    return await service.databaseSdk.runTransaction(rootRef, mutate, { applyLocally: false });
  } finally { stop?.(); }
}
export async function runDatabaseCommand(service, action, input, ownerUid) {
  const uid = service.auth.currentUser?.uid;
  if (!uid) throw new Error('Firebaseログインが必要です。');
  const sdk = service.databaseSdk;
  if (action === 'createOrder') {
    requireId(input.requestId);
    if (!/^[a-f0-9]{64}$/.test(input.token || '')) throw new Error('注文の識別子を確認してください。');
    const signature = await digest(JSON.stringify({ customer: input.customer, items: input.items, method: input.method, token: input.token }));
    const requestPath = `customerRequests/${uid}/${input.requestId}`;
    const previous = await read(service, requestPath);
    if (previous) {
      if (previous.signature !== signature) throw new Error('注文の再試行内容が一致しません。');
      return ownOrder(service, input.requestId, ownerUid);
    }
    const [menu, stock, shipping, payment] = await Promise.all(['menu', 'stock', 'settings/shipping', 'settings/payment'].map(path => read(service, path)));
    const { order } = buildOrder({ menu, stock, settings: { shipping, payment } }, input, uid, Date.now(), await digest(input.token));
    order.t = sdk.serverTimestamp(); order.stockStatus = 'pending';
    try { await sdk.update(sdk.ref(service.db), { [`orders/${order.id}`]: order, [requestPath]: { id: order.id, signature } }); }
    catch (error) { const accepted = await read(service, requestPath); if (!accepted || accepted.signature !== signature) throw error; }
    return ownOrder(service, order.id, ownerUid);
  }
  if (['getPaymentReceipt', 'reportPayment', 'recordEmailResult'].includes(action)) {
    const order = await ownOrder(service, input.id, ownerUid);
    if (action === 'getPaymentReceipt') return receipt(order);
    if (action === 'recordEmailResult') {
      if (!['new', 'reported'].includes(input.event) || typeof input.sent !== 'boolean') throw new Error('メール結果を確認してください。');
      const field = input.event === 'new' ? 'emailSent' : 'reportEmailSent';
      if (order[field] !== true) await sdk.set(sdk.ref(service.db, `orders/${order.id}/${field}`), input.sent);
      return { ok: true };
    }
    if (order.payment.status === 'unpaid') {
      if (order.stockStatus && order.stockStatus !== 'applied') throw new Error('店舗の在庫確認をお待ちください。');
      try { await sdk.update(sdk.ref(service.db, `orders/${order.id}`), { 'payment/status': 'reported', 'payment/reportedAt': sdk.serverTimestamp(), reportEmailSent: false }); }
      catch (error) { const latest = await ownOrder(service, order.id, ownerUid); if (latest.payment.status === 'unpaid') throw error; }
    }
    return receipt(await ownOrder(service, order.id, ownerUid));
  }
  if (uid !== ownerUid) throw new Error('管理者のみ操作できます。');
  let output = { ok: true };
  await ownerTransaction(service, current => {
    const root = current || {};
    root.stock ||= {}; root.orders ||= {}; root.settings ||= {};
    if (action === 'processPendingOrders') {
      const initializeCatalog = !root.catalog && (root.menu || []).length > 0;
      if (initializeCatalog) root.catalog = Object.fromEntries(root.menu.map(item => [item.id, { n: item.n, p: item.p, out: Boolean(item.out), opts: item.opts || [] }]));
      let count = 0;
      for (const order of Object.values(root.orders).sort((left, right) => left.t - right.t)) if (settlePendingOrder(root, order.id, Date.now())) count++;
      output = { processed: count }; if (!count && !initializeCatalog) return;
    } else if (action === 'saveMenu') {
      if ((root.menuRevision || 0) !== input.revision) throw new Error('商品が変更されました。キャンセルして再読込してください。');
      root.menu = structuredClone(validateMenu(input.menu));
      root.catalog = Object.fromEntries(root.menu.map(item => [item.id, { n: item.n, p: item.p, out: Boolean(item.out), opts: item.opts }]));
      root.menuRevision = (root.menuRevision || 0) + 1; output = { revision: root.menuRevision };
    } else if (action === 'saveSettings') {
      if (input.section === 'shipping') {
        const value = { ...DEFAULT_SHIPPING, ...input.value };
        value.fee = integer(value.fee, '送料'); value.threshold = integer(value.threshold, '基準');
        for (const field of ['addressTerms', 'postalPrefixes']) if (!Array.isArray(value[field]) || value[field].length > 30 || value[field].some(term => typeof term !== 'string' || !term.trim() || term.length > 100)) throw new Error('配送条件を確認してください。');
        if (value.postalPrefixes.some(prefix => !/^\d{1,7}$/.test(prefix))) throw new Error('郵便番号の先頭は数字で入力してください。');
        root.settings.shipping = value;
      } else if (input.section === 'payment') {
        const value = { ...DEFAULT_PAYMENT, ...input.value };
        if (!validUrl(value.paypayUrl, 'qr.paypay.ne.jp') || (value.paypalUrl && !validUrl(value.paypalUrl, 'paypal.me'))) throw new Error('支払いURLを確認してください。');
        if (typeof value.paypalQr !== 'string' || value.paypalQr.length > 600000 || (value.paypalQr && !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value.paypalQr))) throw new Error('QR画像を確認してください。');
        for (const field of ['paypayName', 'paypalName']) if (typeof value[field] !== 'string' || value[field].length > 100) throw new Error('名義を確認してください。');
        root.settings.payment = value;
      } else throw new Error('設定を確認してください。');
    } else if (['confirmInventory', 'releaseInventory'].includes(action)) {
      requireId(input.mid);
      if (!(root.menu || []).some(item => item.id === input.mid)) throw new Error('商品がありません。');
      const stock = root.stock[input.mid] || null;
      if (JSON.stringify(stock) !== JSON.stringify(input.expected ?? null)) throw new Error('在庫が変わりました。実数を確認して再度確定してください。');
      if (action === 'releaseInventory') delete root.stock[input.mid];
      else { const qty = integer(input.qty, '実数', 1000000); root.stock[input.mid] = { qty, countedAt: Date.now(), diff: qty - (stock?.qty || 0) }; }
    } else {
      requireId(input.id); const order = root.orders[input.id]; if (!order) throw new Error('注文がありません。');
      if (action === 'confirmPayment') {
        if (order.stockStatus && order.stockStatus !== 'applied') throw new Error('在庫確認を完了してください。');
        if (order.payment.status !== 'paid') { order.payment.status = 'paid'; order.payment.paidAt = Date.now(); }
      } else if (action === 'transitionOrder') {
        if (!canTransition(order, input.next) || (order.stockStatus && order.stockStatus !== 'applied')) throw new Error('在庫・入金確認が必要です。');
        if (input.tracking && (typeof input.tracking !== 'string' || input.tracking.length > 100)) throw new Error('追跡番号を確認してください。');
        order.status = input.next; order.updatedAt = Date.now();
        if (input.next === 'shipped') { order.tracking = input.tracking || ''; order.shippedAt = Date.now(); }
      } else if (action === 'deleteOrder') delete root.orders[input.id];
      else throw new Error('操作を確認してください。');
    }
    return root;
  });
  return output;
}