export const DEFAULT_SHIPPING = { threshold: 10000, fee: 0, addressTerms: ['名古屋市', 'Nagoya City'], postalPrefixes: [] };
export const DEFAULT_PAYMENT = { paypayUrl: 'https://qr.paypay.ne.jp/p2p01_M2QLOAUSh8VcxFGt', paypayName: '', paypalQr: '', paypalName: 'TIMILSINA AJAYA', paypalUrl: '' };
export const yen = value => new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 }).format(Math.round(value || 0));
export const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[\s-]/g, '');
export function integer(value, label, max = 100000000) {
  if (value === '' || value === null || value === undefined || !Number.isSafeInteger(Number(value)) || Number(value) < 0 || Number(value) > max) throw new Error(`${label}を正しく入力してください。`);
  return Number(value);
}
export function availability(item, stock) {
  const tracked = stock != null;
  return { tracked, out: Boolean(item.out || (tracked && stock.qty <= 0)), low: tracked && stock.qty > 0 && stock.qty < 5 };
}
export function shippingFor(total, customer, settings = DEFAULT_SHIPPING) {
  const config = { ...DEFAULT_SHIPPING, ...settings };
  const local = config.addressTerms.some(term => normalize(term) && normalize(customer.address).includes(normalize(term))) || config.postalPrefixes.some(prefix => normalize(prefix) && normalize(customer.postal).startsWith(normalize(prefix)));
  return local ? { area: '名古屋市', fee: total >= config.threshold ? 0 : config.fee, mode: total >= config.threshold ? '送料無料' : '名古屋配達' } : { area: '全国', fee: 0, mode: '着払い' };
}
export function validateCustomer(customer) {
  for (const field of ['name', 'phone', 'email', 'postal', 'address']) if (typeof customer?.[field] !== 'string' || !customer[field].trim() || customer[field].length > 500) throw new Error('お客様情報を入力してください。');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email) || !/^\d{3}-?\d{4}$/.test(customer.postal.normalize('NFKC')) || !/^[+\d\s()-]{8,25}$/.test(customer.phone)) throw new Error('メール・電話番号・郵便番号を確認してください。');
  if (typeof customer.note !== 'string' || customer.note.length > 2000) throw new Error('備考は2000文字以内です。');
}
export function validateMenu(menu) {
  if (!Array.isArray(menu) || menu.length > 150) throw new Error('商品は150件以内です。');
  const ids = new Set();
  for (const item of menu) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(item.id) || ids.has(item.id)) throw new Error('商品IDが不正です。');
    ids.add(item.id);
    for (const key of ['n', 'cat']) if (typeof item[key] !== 'string' || !item[key].trim() || item[key].length > 120) throw new Error('商品名・カテゴリを入力してください。');
    integer(item.p, '価格');
    if (typeof item.img !== 'string' || (item.img && !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(item.img)) || item.img.length > 600000) throw new Error('JPEG画像を確認してください。');
    if (!Array.isArray(item.opts) || item.opts.length > 20) throw new Error('オプションは20件以内です。');
    for (const option of item.opts) { if (!option.n?.trim() || option.n.length > 100) throw new Error('オプション名を入力してください。'); integer(option.p, '追加価格'); }
  }
  return menu;
}
export function buildOrder(root, input, uid, now, tokenHash) {
  validateCustomer(input.customer);
  const paymentSettings = { ...DEFAULT_PAYMENT, ...root.settings?.payment };
  if (!['PayPay', 'PayPal'].includes(input.method) || (input.method === 'PayPal' && !paymentSettings.paypalQr)) throw new Error('お支払い方法を確認してください。');
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > 50) throw new Error('カートを確認してください。');
  const quantities = {};
  const items = input.items.map(row => {
    const item = (root.menu || []).find(product => product.id === row.mid);
    if (!item || availability(item, root.stock?.[item.id]).out) throw new Error('欠品または販売終了の商品があります。');
    const quantity = integer(row.q, '数量', 99);
    if (!quantity) throw new Error('数量を確認してください。');
    const optionIndex = Number(row.option);
    const options = item.opts || [];
    if (!Number.isInteger(optionIndex) || optionIndex < -1 || optionIndex >= options.length) throw new Error('オプションを確認してください。');
    const option = optionIndex === -1 ? null : options[optionIndex];
    quantities[item.id] = (quantities[item.id] || 0) + quantity;
    return { mid: item.id, n: item.n, p: integer(item.p, '価格') + (option ? integer(option.p, '追加価格') : 0), q: quantity, option: option?.n || '', optionIndex };
  });
  for (const [id, quantity] of Object.entries(quantities)) if (root.stock?.[id] && root.stock[id].qty < quantity) throw new Error('在庫が不足しています。数量を変更してください。');
  const itemsTotal = items.reduce((total, item) => total + item.p * item.q, 0);
  const shipping = shippingFor(itemsTotal, input.customer, root.settings?.shipping);
  const order = { id: input.requestId, t: now, ownerUid: uid, receiptTokenHash: tokenHash, customer: input.customer, items, itemsTotal, shipping, total: itemsTotal + shipping.fee, status: 'new', payment: { method: input.method, status: 'unpaid', instructions: paymentSettings }, emailSent: false };
  return { order, quantities };
}
export function canTransition(order, next) {
  return ({ new: 'packing', packing: 'shipped', shipped: 'done' })[order.status] === next && (next !== 'shipped' || order.payment.status === 'paid');
}