import { watch, command, configured, commandsReady, customerAuth, sendOrderEmail } from './firebase-sync.js';
import { DEFAULT_PAYMENT, DEFAULT_SHIPPING, availability, shippingFor, validateCustomer, yen } from './shop-domain.js';
import { html,text,t, mountShell, escapeHtml as esc, storage, message, attempt, imageSource, safeUrl, icons, randomToken, paymentLabels } from './ui.js';

mountShell('今日の買い物');
const state = { menu: [], stock: {}, shipping: DEFAULT_SHIPPING, payment: DEFAULT_PAYMENT, busy: false, receipt: null };
let cart = storage.get('cart', []);
if (!Array.isArray(cart)) cart = [];
cart = cart.filter(row => typeof row.mid === 'string' && Number.isInteger(row.option) && Number.isInteger(row.q) && row.q > 0 && row.q <= 99);
const chosen = new Map();
let paymentToken = '';
let receiptStop;
let watchedReceipt = '';
let pendingOrder = storage.get('pendingOrder');
let menuLoaded = false;
const loadedPaths = new Set();
document.querySelector('#app').innerHTML = html`<div id="shop" class="layout"><section class="catalogue"><div class="toolbar"><span class="muted">ミート・食料品 / Grocery</span><label><input id="search" type="search" placeholder="商品を検索" aria-label="商品を検索"></label></div><div id="catalogue"><p class="empty">商品を読込中…</p></div></section><aside class="cart"><h2>カート <small id="cart-count"></small></h2><div id="cart-items"></div><div id="totals" class="totals"></div><section class="checkout"><h2>お届け先</h2><form id="checkout"><div class="form-grid"><label class="full">お名前<input name="name" required maxlength="100" autocomplete="name"></label><label>電話番号<input name="phone" type="tel" required maxlength="25" autocomplete="tel"></label><label>郵便番号<input name="postal" required pattern="[0-9０-９]{3}[-－]?[0-9０-９]{4}" autocomplete="postal-code" inputmode="numeric" placeholder="460-0001"></label><label class="full">メール<input name="email" type="email" required maxlength="200" autocomplete="email"></label><label class="full">住所<input name="address" required maxlength="500" autocomplete="street-address" placeholder="都道府県・市区町村・番地・建物"></label><label class="full">備考<textarea name="note" maxlength="2000"></textarea></label><label class="full">お支払い方法<select name="method" required><option value="">選択してください</option><option value="PayPay">PayPay</option><option id="paypal-option" value="PayPal" disabled>PayPal（準備中）</option></select></label></div><p id="shipping-rule" class="muted"></p><button id="submit-order" class="primary" type="submit">注文を確定して支払いへ</button></form></section></aside></div><section id="payment-view" class="payment-view" hidden></section>`;
const form = document.querySelector('#checkout');
const customer = () => Object.fromEntries(new FormData(form));
const key = row => `${row.mid}:${row.option}`;
const productFor = row => state.menu.find(item => item.id === row.mid);
const priceFor = row => { const item = productFor(row); return Number(item.p) + Number(item.opts?.[row.option]?.p || 0); };
function saveCart() { storage.set('cart', cart); }
function drawCart() {
  const total = cart.reduce((sum, row) => sum + priceFor(row) * row.q, 0);
  const delivery = shippingFor(total, customer(), state.shipping);
  document.querySelector('#cart-count').textContent = text`${cart.reduce((sum, row) => sum + row.q, 0)} 点`;
  document.querySelector('#cart-items').innerHTML = cart.length ? cart.map(row => {
    const item = productFor(row);
    return html`<div class="cart-row"><div><h3>${esc(item.n)}</h3><select data-cart-option="${esc(key(row))}" aria-label="${esc(item.n)}のオプション"><option value="-1">通常</option>${(item.opts || []).map((option, index) => html`<option value="${index}" ${index === row.option ? 'selected' : ''}>${esc(option.n)} +${yen(option.p)}</option>`).join('')}</select><small>${yen(priceFor(row))} / 点</small></div><div><strong>${yen(priceFor(row) * row.q)}</strong><div class="quantity"><button data-change="-1" data-key="${esc(key(row))}" aria-label="数量を減らす" title="数量を減らす"><i data-lucide="minus"></i></button><span>${row.q}</span><button data-change="1" data-key="${esc(key(row))}" aria-label="数量を増やす" title="数量を増やす"><i data-lucide="plus"></i></button></div></div></div>`;
  }).join('') : html('<p class="empty">カートは空です。</p>');
  document.querySelector('#totals').innerHTML = html`<div><span>商品合計</span><strong>${yen(total)}</strong></div><div><span>配送料</span><span>${customer().address ? (delivery.mode === '着払い' ? t('着払い（到着時）') : yen(delivery.fee)) : t('住所入力後に確定')}</span></div><div class="grand"><span>お支払い合計</span><span>${yen(total + delivery.fee)}</span></div>`;
  document.querySelector('#shipping-rule').textContent = text`名古屋市：${yen(state.shipping.threshold)}以上で送料無料。未満は${yen(state.shipping.fee)}。全国：着払い（サイトでの送料請求なし）。`;
  document.querySelector('#submit-order').disabled = !commandsReady || !cart.length || state.busy;
  document.querySelector('#submit-order').textContent = commandsReady ? t('注文を確定して支払いへ') : t('注文受付の設定待ち');
  icons();
}
function draw() {
  if (!menuLoaded || (configured && loadedPaths.size < 4)) return;
  const previous = cart.length;
  cart = cart.filter(row => { const item = productFor(row); return item && !availability(item, state.stock[item.id]).out && (row.option === -1 || item.opts?.[row.option]); });
  if (previous !== cart.length) { saveCart(); message('販売状況が変わりました。カートをご確認ください。', true); }
  const query = document.querySelector('#search').value.toLowerCase();
  const visible = state.menu.filter(item => `${item.n} ${item.cat}`.toLowerCase().includes(query));
  const categories = [...new Set(visible.map(item => item.cat))];
  document.querySelector('#catalogue').innerHTML = categories.map(cat => html`<section class="category"><h2>${esc(cat)}<small>${visible.filter(item => item.cat === cat).length} 商品</small></h2><div class="products">${visible.filter(item => item.cat === cat).map(item => {
    const status = availability(item, state.stock[item.id]);
    const photo = imageSource(item.img);
    return html`<article class="product">${photo ? html`<img src="${esc(photo)}" alt="${esc(item.n)}" loading="lazy">` : html('<div class="empty">写真未登録</div>')}<div class="product-body"><div><h3>${esc(item.n)}</h3>${status.out ? html('<span class="badge out">欠品</span>') : status.low ? html('<span class="badge low">残りわずか</span>') : html('<span class="badge">販売中</span>')}</div><span class="price">${yen(item.p)}</span><select data-option="${esc(item.id)}" aria-label="${esc(item.n)}のオプション" ${status.out ? 'disabled' : ''}><option value="-1">通常</option>${(item.opts || []).map((option, index) => html`<option value="${index}" ${chosen.get(item.id) === index ? 'selected' : ''}>${esc(option.n)} +${yen(option.p)}</option>`).join('')}</select><button class="primary" data-add="${esc(item.id)}" ${status.out ? 'disabled' : ''}>${status.out ? t('欠品') : t('カートに入れる')}</button></div></article>`;
  }).join('')}</div></section>`).join('') || html('<p class="empty">商品がありません。</p>');
  const paypal = document.querySelector('#paypal-option'); delete paypal.dataset.i18nOption; paypal.disabled = !state.payment.paypalQr; paypal.textContent = state.payment.paypalQr ? 'PayPal' : t('PayPal（準備中）');
  if (paypal.disabled && form.elements.method.value === 'PayPal') form.elements.method.value = '';
  drawCart();
}
function add(mid, option, quantity = 1) {
  if (state.busy) return;
  const item = state.menu.find(product => product.id === mid);
  const stock = state.stock[mid];
  if (!item || availability(item, stock).out) return;
  const combined = cart.filter(row => row.mid === mid).reduce((sum, row) => sum + row.q, 0);
  const row = cart.find(entry => entry.mid === mid && entry.option === option);
  if ((stock && combined + quantity > stock.qty) || (row?.q || 0) + quantity > 99) { message('在庫数を超える数量は追加できません。', true); return; }
  if (row) row.q += quantity; else cart.push({ mid, option, q: quantity });
  saveCart(); drawCart();
}
document.querySelector('#catalogue').onclick = event => { const button = event.target.closest('[data-add]'); if (button) add(button.dataset.add, chosen.get(button.dataset.add) ?? -1); };
document.querySelector('#catalogue').onchange = event => { if (event.target.dataset.option) chosen.set(event.target.dataset.option, Number(event.target.value)); };
document.querySelector('#cart-items').onclick = event => {
  const button = event.target.closest('[data-change]'); if (!button || state.busy) return;
  const row = cart.find(entry => key(entry) === button.dataset.key); if (!row) return;
  if (Number(button.dataset.change) > 0) add(row.mid, row.option);
  else { row.q--; cart = cart.filter(entry => entry.q > 0); saveCart(); drawCart(); }
};
document.querySelector('#cart-items').onchange = event => {
  if (!event.target.dataset.cartOption || state.busy) return;
  const row = cart.find(entry => key(entry) === event.target.dataset.cartOption);
  if (row) { const next = Number(event.target.value); const duplicate = cart.find(entry => entry !== row && entry.mid === row.mid && entry.option === next); if (duplicate) { if (duplicate.q + row.q > 99) { message('一つのオプションは99点までです。', true); drawCart(); return; } duplicate.q += row.q; cart = cart.filter(entry => entry !== row); } else row.option = next; saveCart(); drawCart(); }
};
document.querySelector('#search').oninput = draw;
document.addEventListener('languagechange', () => { draw(); if (state.receipt) drawPayment(); });
form.oninput = () => { if (menuLoaded) drawCart(); };
form.onsubmit = event => {
  event.preventDefault(); if (state.busy || !cart.length || !navigator.onLine) { message('オンラインでカートを確認してから注文してください。', true); return; }
  attempt(async () => {
    const info = customer(); const method = info.method; delete info.method; validateCustomer(info);
    state.busy = true; drawCart();
    try {
      await customerAuth();
      const payload = { customer: info, method, items: structuredClone(cart) };
      const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)));
      const signature = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
      let pending = pendingOrder;
      if (!pending || pending.signature !== signature) pending = { requestId: crypto.randomUUID(), token: randomToken(), signature };
      pendingOrder = pending;
      storage.set('pendingOrder', pending);
      const input = { ...payload, requestId: pending.requestId, token: pending.token };
      const order = await command('createOrder', input);
      state.receipt = order; paymentToken = pending.token;
      storage.set(`receipt:${order.id}`, paymentToken); storage.remove('pendingOrder'); pendingOrder = null;
      location.hash = new URLSearchParams({ pay: order.id }).toString();
      cart = []; saveCart(); form.reset(); drawPayment();
      try { await sendOrderEmail(order); message('注文を受け付けました。お支払いをお願いします。'); }
      catch { message('注文は保存されました。店舗通知メールは再送待ちです。', true); }
    } finally { state.busy = false; drawCart(); }
  });
};
function drawPayment() {
  const order = state.receipt; if (!order) return;
  if (configured && watchedReceipt !== order.id) {
    watchedReceipt = order.id; receiptStop?.();
    receiptStop = watch(`orders/${order.id}`, value => { if (value) { state.receipt = value; drawPayment(); } }, error => message(error.message, true));
  }
  const ready = !order.stockStatus || order.stockStatus === 'applied';
  const waiting = order.stockStatus === 'shortage' ? t('在庫不足のため店舗からの連絡をお待ちください。まだ送金しないでください。') : t('店舗で在庫を確認しています。確認完了後にお支払いください。');
  const instructions = order.payment.instructions || state.payment;
  const method = order.payment.method;
  let qr = '';
  const paypayUrl = safeUrl(instructions.paypayUrl, 'qr.paypay.ne.jp');
  if (ready && method === 'PayPay' && paypayUrl) {
    try { const code = globalThis.qrcode(0, 'M'); code.addData(paypayUrl); code.make(); qr = code.createDataURL(6, 8); }
    catch { qr = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(paypayUrl)}`; }
  } else qr = ready && method === 'PayPal' ? imageSource(instructions.paypalQr) : '';
  const paypalUrl = safeUrl(instructions.paypalUrl, 'paypal.me');
  document.querySelector('#shop').hidden = true;
  const view = document.querySelector('#payment-view'); view.hidden = false;
  view.innerHTML = html`<span class="badge ${esc(order.payment.status)}">${ready ? esc(paymentLabels[order.payment.status]) : t('在庫確認待ち')}</span><h2>注文 #${esc(order.id)}</h2>${!ready ? html('<small>仮合計</small>') : ''}<p class="amount">${yen(order.total)}</p><p>${ready ? html`${esc(method)}で ${yen(order.total)} を送金してください。<br>メッセージに注文番号 #${esc(order.id)} を入力してください。` : esc(waiting)}</p>${qr ? html`<img class="qr" src="${esc(qr)}" alt="${esc(method)}支払いQR">` : ''}<strong>${ready ? esc(method === 'PayPay' ? instructions.paypayName : instructions.paypalName) : ''}</strong><div class="actions">${ready && method === 'PayPay' && paypayUrl ? html`<a class="button primary" href="${esc(paypayUrl)}" target="_blank" rel="noopener noreferrer">PayPayを開く <i data-lucide="external-link"></i></a>` : ''}${method === 'PayPal' && qr ? html`<a class="button" href="${esc(qr)}" download="paypal-qr.jpg"><i data-lucide="download"></i>QRを保存</a>` : ''}${ready && method === 'PayPal' && paypalUrl ? html`<a class="button primary" href="${esc(paypalUrl)}" target="_blank" rel="noopener noreferrer">PayPal.meを開く</a>` : ''}</div><p class="muted">${esc(t(order.shipping.mode))}${order.shipping.mode === '着払い' ? t('：送料は到着時に配送会社へお支払いください。') : ''}</p><div class="actions"><button id="reported" class="primary" ${!ready || order.payment.status !== 'unpaid' ? 'disabled' : ''}>${!ready ? t('在庫確認待ち') : order.payment.status === 'unpaid' ? t('支払いました') : esc(paymentLabels[order.payment.status])}</button><button id="refresh-receipt" class="icon-button" title="支払い状況を更新" aria-label="支払い状況を更新"><i data-lucide="refresh-cw"></i></button></div><a href="./customer.html${location.search}">買い物に戻る</a>`;
  document.querySelector('#reported').onclick = event => attempt(async () => {
    state.receipt = await command('reportPayment', { id: order.id, token: paymentToken }); drawPayment();
    message('支払い報告を受け付けました。店舗の確認をお待ちください。');
    try { await sendOrderEmail({ ...order, payment: state.receipt.payment }, 'reported'); } catch { message('支払い報告は保存されました。メール通知は再送待ちです。', true); }
  }, event.currentTarget);
  document.querySelector('#refresh-receipt').onclick = event => attempt(refreshReceipt, event.currentTarget);
  icons();
}
async function refreshReceipt() {
  if (!state.receipt) return;
  state.receipt = await command('getPaymentReceipt', { id: state.receipt.id, token: paymentToken }); drawPayment();
}
const stops = ['menu', 'stock', 'settings/shipping', 'settings/payment'].map(path => watch(path, value => {
  loadedPaths.add(path);
  if (path === 'menu') { state.menu = (value || []).map(item => ({ ...item, opts: item.opts || [] })); menuLoaded = true; }
  else if (path === 'stock') state.stock = value || {};
  else if (path.endsWith('shipping')) state.shipping = { ...DEFAULT_SHIPPING, ...value };
  else state.payment = { ...DEFAULT_PAYMENT, ...value };
  draw();
}, error => message(error.message, true)));
addEventListener('pagehide', () => { stops.forEach(stop => stop()); receiptStop?.(); }, { once: true });
addEventListener('focus', () => { if (state.receipt && configured) attempt(refreshReceipt); });
const hashParams = new URLSearchParams(location.hash.slice(1));
if (hashParams.has('pay')) attempt(async () => {
  paymentToken = hashParams.get('token') || storage.get(`receipt:${hashParams.get('pay')}`, '');
  state.receipt = await command('getPaymentReceipt', { id: hashParams.get('pay'), token: paymentToken }); drawPayment();
});