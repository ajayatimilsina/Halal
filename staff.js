import { watch, command, sendOrderEmail, previewMenu } from './firebase-sync.js';
import { protect } from './auth.js';
import { DEFAULT_PAYMENT, DEFAULT_SHIPPING, yen, validateMenu, integer, availability } from './shop-domain.js';
import { mountShell, escapeHtml as esc, message, attempt, imageSource, resizeImage, imageFromUrl, icons, dateText, paymentLabels, statusLabels, copy, safeUrl, preserveFocus } from './ui.js';

const page = document.body.dataset.page;
const titles = { menu: '商品管理', inventory: '棚卸', orders: '注文一覧', shipping: '出荷', payment: '支払い設定' };
mountShell(titles[page], true);
const state = { menu: [], stock: {}, orders: {}, shipping: DEFAULT_SHIPPING, payment: DEFAULT_PAYMENT, revision: 0 };
let draft = [];
let draftRevision = 0;
let dirty = false;
let settingsDirty = false;
let paypalQr = '';
let sound;
let previousOrders;
const counts = new Map();
const tracking = new Map();
const stops = [];
let busy = false;
let stockReady = false;
let menuReady = false;
const app = document.querySelector('#app');
const normalizedMenu = value => (value || []).map(item => ({ ...item, opts: item.opts || [], img: item.img || '' }));
function draw() {
  preserveFocus(() => {
    if (page === 'menu') drawMenu();
    if (page === 'inventory') drawInventory();
    if (page === 'orders' || page === 'shipping') drawOrders();
    if (page === 'payment') drawPaymentSettings();
    icons();
  });
}
async function act(task, button) {
  if (busy) return;
  busy = true;
  try { return await attempt(task, button); } finally { busy = false; }
}
function menuSkeleton() {
  app.innerHTML = '<div class="toolbar"><div class="actions"><button id="add-item"><i data-lucide="plus"></i>商品を追加</button><button id="seed-item">Mutton サンプル</button></div><div class="actions"><span id="draft-status" class="muted"></span><button id="save-menu" class="primary">Save menu / 保存</button><button id="cancel-menu">Cancel / キャンセル</button></div></div><div id="category-actions"></div><div id="menu-editors"></div>';
  document.querySelector('#add-item').onclick = () => { draft.push({ id: crypto.randomUUID(), n: '', cat: '', p: 0, img: '', out: false, opts: [] }); dirty = true; draw(); };
  document.querySelector('#seed-item').onclick = event => act(async () => {
    if (draft.some(item => item.id === 'mutton')) throw new Error('サンプルは既にあります。');
    if (!confirm('参考写真を使用します。実際のMutton商品に合う写真へ変更してから販売してください。')) return;
    const img = await imageFromUrl('./assets/meat.jpg', 600);
    draft.push({ ...previewMenu[0], img }); dirty = true; draw();
  }, event.currentTarget);
  document.querySelector('#cancel-menu').onclick = () => { if (dirty && !confirm('未保存の変更を破棄しますか？')) return; draft = structuredClone(state.menu); draftRevision = state.revision; dirty = false; draw(); message('変更を取り消しました。'); };
  document.querySelector('#save-menu').onclick = event => act(async () => {
    validateMenu(draft);
    const result = await command('saveMenu', { menu: draft, revision: draftRevision });
    state.menu = structuredClone(draft); state.revision = result.revision; draftRevision = result.revision; dirty = false; draw(); message('商品を保存しました。');
  }, event.currentTarget);
  document.querySelector('#menu-editors').oninput = event => {
    const field = event.target.dataset.field;
    if (!field) return;
    const item = draft.find(product => product.id === event.target.closest('[data-mid]').dataset.mid);
    if (!item) return;
    const target = event.target.dataset.optionIndex !== undefined ? item.opts[Number(event.target.dataset.optionIndex)] : item;
    target[field] = event.target.type === 'checkbox' ? event.target.checked : event.target.type === 'number' ? (event.target.value === '' ? '' : Number(event.target.value)) : event.target.value;
    dirty = true; document.querySelector('#draft-status').textContent = '未保存のドラフト';
  };
  document.querySelector('#menu-editors').onchange = event => {
    if (!event.target.matches('[data-photo]')) return;
    const file = event.target.files[0]; if (!file) return;
    act(async () => { const item = draft.find(product => product.id === event.target.closest('[data-mid]').dataset.mid); item.img = await resizeImage(file); dirty = true; draw(); });
  };
  document.querySelector('#menu-editors').onclick = event => {
    const button = event.target.closest('[data-action]'); if (!button || busy) return;
    const item = draft.find(product => product.id === button.closest('[data-mid]').dataset.mid);
    if (button.dataset.action === 'remove' && confirm(`${item.n || '商品'}を削除しますか？`)) draft = draft.filter(product => product !== item);
    else if (button.dataset.action === 'add-option') item.opts.push({ n: '', p: 0 });
    else if (button.dataset.action === 'remove-option') item.opts.splice(Number(button.dataset.index), 1);
    else return;
    dirty = true; draw();
  };
  document.querySelector('#category-actions').onclick = event => {
    const button = event.target.closest('[data-category]'); if (!button || busy) return;
    for (const item of draft) if (item.cat === button.dataset.category) item.out = button.dataset.out === 'true';
    dirty = true; draw();
  };
}
function drawMenu() {
  document.querySelector('#draft-status').textContent = dirty ? '未保存のドラフト' : '保存済み';
  document.querySelector('#category-actions').innerHTML = [...new Set(draft.map(item => item.cat).filter(Boolean))].map(cat => `<div class="category-controls"><strong>${esc(cat)}</strong><button data-category="${esc(cat)}" data-out="true">まとめて欠品</button><button data-category="${esc(cat)}" data-out="false">まとめて販売再開</button></div>`).join('');
  document.querySelector('#menu-editors').innerHTML = draft.map(item => `<article class="editor" data-mid="${esc(item.id)}"><div class="form-grid"><label>商品名<input data-field="n" value="${esc(item.n)}" required maxlength="120"></label><label>カテゴリ<input data-field="cat" value="${esc(item.cat)}" required maxlength="120"></label><label>価格 (¥)<input data-field="p" type="number" min="0" step="1" value="${esc(item.p)}" required></label><label class="check"><input data-field="out" type="checkbox" ${item.out ? 'checked' : ''}>欠品</label><div class="full actions">${imageSource(item.img) ? `<img src="${esc(imageSource(item.img))}" alt="${esc(item.n)}">` : ''}<label>商品写真<input data-photo type="file" accept="image/jpeg,image/png,image/webp"></label></div><div class="full"><h3>オプション</h3>${item.opts.map((option, index) => `<div class="option-row"><input data-field="n" data-option-index="${index}" value="${esc(option.n)}" aria-label="オプション名" placeholder="オプション名"><input data-field="p" data-option-index="${index}" type="number" min="0" value="${esc(option.p)}" aria-label="追加価格"><button data-action="remove-option" data-index="${index}" class="icon-button danger" title="オプションを削除" aria-label="オプションを削除"><i data-lucide="trash-2"></i></button></div>`).join('')}<button data-action="add-option"><i data-lucide="plus"></i>オプションを追加</button></div><div class="full actions"><button data-action="remove" class="danger"><i data-lucide="trash-2"></i>Remove / 削除</button></div></div></article>`).join('') || '<p class="empty">商品を追加してください。</p>';
}
function inventorySkeleton() {
  app.innerHTML = '<div class="table-wrap"><table><thead><tr><th>商品</th><th>システム在庫</th><th>実数</th><th>差異</th><th>前回確定</th><th>操作</th></tr></thead><tbody id="stock-rows"></tbody></table></div>';
  document.querySelector('#stock-rows').oninput = event => {
    if (!event.target.dataset.count) return;
    const mid = event.target.dataset.count;
    counts.set(mid, { value: event.target.value, expected: structuredClone(state.stock[mid] || null) });
    const diff = event.target.closest('tr').querySelector('[data-diff]');
    diff.textContent = event.target.value === '' ? '—' : String(Number(event.target.value) - (state.stock[mid]?.qty || 0));
  };
  document.querySelector('#stock-rows').onclick = event => {
    const button = event.target.closest('[data-stock-action]'); if (!button) return;
    const mid = button.dataset.mid;
    act(async () => {
      if (button.dataset.stockAction === 'release') { if (!confirm('この商品の在庫管理を解除しますか？')) return; await command('releaseInventory', { mid, expected: state.stock[mid] || null }); }
      else { const count = counts.get(mid); if (!count || count.value === '') throw new Error('実数を入力してください。'); await command('confirmInventory', { mid, qty: integer(count.value, '実数'), expected: count.expected }); }
      counts.delete(mid); message('棚卸を保存しました。');
    }, button);
  };
}
function drawInventory() {
  if (!stockReady || !menuReady) { document.querySelector('#stock-rows').innerHTML = '<tr><td colspan="6">在庫を読込中…</td></tr>'; return; }
  document.querySelector('#stock-rows').innerHTML = state.menu.map(item => {
    const stock = state.stock[item.id]; const count = counts.get(item.id); const status = availability(item, stock);
    const stale = count && JSON.stringify(count.expected) !== JSON.stringify(stock || null);
    return `<tr><td><strong>${esc(item.n)}</strong><br><small>${esc(item.cat)}</small> ${status.out ? '<span class="badge out">欠品</span>' : status.low ? '<span class="badge low">残りわずか</span>' : ''}</td><td>${stock ? stock.qty : '管理なし'}</td><td><input data-count="${esc(item.id)}" value="${esc(count?.value ?? '')}" type="number" min="0" step="1" aria-label="${esc(item.n)}の実数">${stale ? '<small class="danger">在庫変更あり・実数を再入力</small>' : ''}</td><td data-diff>${count?.value ? Number(count.value) - (stock?.qty || 0) : '—'}</td><td>${dateText(stock?.countedAt)}<br><small>前回差異 ${stock?.diff ?? '—'}</small></td><td><div class="actions"><button class="primary" data-stock-action="count" data-mid="${esc(item.id)}">棚卸を確定</button><button data-stock-action="release" data-mid="${esc(item.id)}" ${stock ? '' : 'disabled'}>管理解除</button></div></td></tr>`;
  }).join('') || '<tr><td colspan="6">商品がありません。</td></tr>';
}
function ordersSkeleton() {
  app.innerHTML = `${page === 'orders' ? '<div class="toolbar"><label class="check"><input id="unpaid-filter" type="checkbox">未払いのみ</label><button id="sound-button"><i data-lucide="volume-2"></i>新規注文の通知音を有効化</button></div>' : ''}<div id="order-list"></div>${page === 'shipping' ? '<section class="section settings"><h2>配送料・地域設定</h2><form id="shipping-settings"><div class="form-grid"><label>送料無料の商品合計 (¥)<input name="threshold" type="number" min="0" required></label><label>名古屋市・基準未満の送料 (¥)<input name="fee" type="number" min="0" required></label><label class="full">名古屋市の住所キーワード（1行1件）<textarea name="addressTerms"></textarea></label><label class="full">郵便番号の先頭（1行1件）<textarea name="postalPrefixes"></textarea></label></div><div class="actions"><button class="primary">配送設定を保存</button><button type="button" id="cancel-shipping">キャンセル</button></div></form></section>' : ''}`;
  if (page === 'orders') {
    document.querySelector('#unpaid-filter').onchange = draw;
    document.querySelector('#sound-button').onclick = event => act(async () => { sound = new AudioContext(); await sound.resume(); event.currentTarget.textContent = '通知音：有効'; beep(); }, event.currentTarget);
  } else {
    const form = document.querySelector('#shipping-settings');
    form.oninput = () => { settingsDirty = true; };
    form.onsubmit = event => { event.preventDefault(); act(async () => {
      const data = Object.fromEntries(new FormData(form));
      const value = { threshold: integer(data.threshold, '基準'), fee: integer(data.fee, '送料'), addressTerms: lines(data.addressTerms), postalPrefixes: lines(data.postalPrefixes) };
      await command('saveSettings', { section: 'shipping', value }); settingsDirty = false; state.shipping = value; fillShipping(); message('配送設定を保存しました。');
    }, event.submitter); };
    document.querySelector('#cancel-shipping').onclick = () => { settingsDirty = false; fillShipping(); };
    fillShipping();
  }
  document.querySelector('#order-list').oninput = event => { if (event.target.dataset.tracking) tracking.set(event.target.dataset.tracking, event.target.value); };
  document.querySelector('#order-list').onclick = event => {
    const button = event.target.closest('[data-order-action]'); if (!button) return;
    const order = state.orders[button.dataset.id]; if (!order) return;
    act(async () => {
      switch (button.dataset.orderAction) {
        case 'paid': if (!confirm('PayPay / PayPalアプリで入金を確認しましたか？')) return; await command('confirmPayment', { id: order.id }); message('入金確認を保存しました。'); break;
        case 'next': await command('transitionOrder', { id: order.id, next: button.dataset.next, tracking: tracking.get(order.id) || '' }); message('注文状態を更新しました。'); break;
        case 'delete': if (!confirm('注文を削除しますか？在庫は自動で戻りません。')) return; await command('deleteOrder', { id: order.id }); message('注文を削除しました。'); break;
        case 'email': await sendOrderEmail(order, button.dataset.event || 'new'); message('メールを再送しました。'); break;
        case 'copy': await copy(`${order.customer.name}\n〒${order.customer.postal}\n${order.customer.address}\n${order.customer.phone}`); break;
        case 'print': document.querySelector('#print-slip').innerHTML = `<h1>納品・梱包明細</h1>${orderMarkup(order, false)}`; window.print(); break;
      }
    }, button);
  };
}
function beep() {
  if (!sound || sound.state !== 'running') return;
  const oscillator = sound.createOscillator(); const gain = sound.createGain(); oscillator.connect(gain); gain.connect(sound.destination);
  oscillator.frequency.value = 740; gain.gain.setValueAtTime(0.08, sound.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, sound.currentTime + 0.3); oscillator.start(); oscillator.stop(sound.currentTime + 0.3);
}
function orderMarkup(order, controls = true) {
  const customer = order.customer; const next = ({ new: 'packing', packing: 'shipped', shipped: 'done' })[order.status];
  const button = (action, label, attributes = '') => `<button data-order-action="${action}" data-id="${esc(order.id)}" ${attributes}>${label}</button>`;
  return `<article class="order ${order.status === 'new' ? 'new' : ''}"><div class="order-head"><div><h3>#${esc(order.id)}</h3><small>${dateText(order.t)}</small></div><div class="actions"><span class="badge">${esc(statusLabels[order.status])}</span><span class="badge ${esc(order.payment.status)}">${esc(paymentLabels[order.payment.status])}</span></div></div><div class="order-detail"><div><strong>${esc(customer.name)}</strong><address>〒${esc(customer.postal)}\n${esc(customer.address)}</address><p>${esc(customer.phone)}</p><p>${esc(customer.email)}</p>${customer.note ? `<p class="muted">備考：${esc(customer.note)}</p>` : ''}</div><div><ul>${order.items.map(item => `<li>${esc(item.n)}${item.option ? ' / ' + esc(item.option) : ''} × ${item.q} <strong>${yen(item.p * item.q)}</strong></li>`).join('')}</ul><div class="totals"><div><span>商品合計</span><strong>${yen(order.itemsTotal)}</strong></div><div><span>${esc(order.shipping.mode)}</span><span>${yen(order.shipping.fee)}</span></div><div class="grand"><span>合計</span><span>${yen(order.total)}</span></div></div><p>${esc(order.payment.method)} · ${esc(paymentLabels[order.payment.status])}</p>${order.payment.paidAt ? `<small>入金確認 ${dateText(order.payment.paidAt)}</small>` : ''}${order.tracking ? `<p>追跡番号：${esc(order.tracking)}</p>` : ''}</div></div>${controls ? `<div class="actions">${page === 'shipping' ? `${button('copy', '<i data-lucide="copy"></i>住所をコピー')}<input data-tracking="${esc(order.id)}" value="${esc(tracking.get(order.id) || '')}" maxlength="100" aria-label="追跡番号" placeholder="追跡番号（任意）" style="max-width:240px">${button('next', '出荷済み', `data-next="shipped" class="primary" ${order.payment.status === 'paid' ? '' : 'disabled'}`)}` : `${order.payment.status !== 'paid' ? button('paid', '入金を確認', 'class="primary"') : ''}${next ? button('next', esc(statusLabels[next]), `data-next="${next}" ${next === 'shipped' && order.payment.status !== 'paid' ? 'disabled' : ''}`) : ''}${button('print', '<i data-lucide="printer"></i>明細を印刷')}${!order.emailSent ? button('email', 'メールを再送') : ''}${order.payment.reportedAt && !order.reportEmailSent ? button('email', '支払い報告メールを再送', 'data-event="reported"') : ''}${button('delete', '<i data-lucide="trash-2"></i>削除', 'class="danger"')}`}</div>${order.status === 'packing' && order.payment.status !== 'paid' ? '<p class="danger">入金確認が完了するまで出荷できません。</p>' : ''}` : ''}</article>`;
}
function drawOrders() {
  const unpaidOnly = document.querySelector('#unpaid-filter')?.checked;
  const orders = Object.values(state.orders).filter(order => page === 'shipping' ? order.status === 'packing' : !unpaidOnly || order.payment.status !== 'paid').sort((left, right) => right.t - left.t);
  document.querySelector('#order-list').innerHTML = orders.map(order => orderMarkup(order)).join('') || '<p class="empty">該当する注文はありません。</p>';
}
const lines = value => value.split('\n').map(line => line.trim()).filter(Boolean);
function fillShipping() {
  if (settingsDirty) return;
  const form = document.querySelector('#shipping-settings'); if (!form) return;
  for (const [key, value] of Object.entries(state.shipping)) if (form.elements[key]) form.elements[key].value = Array.isArray(value) ? value.join('\n') : value;
}
function paymentSkeleton() {
  app.innerHTML = '<section class="settings"><form id="payment-settings"><h2>PayPay</h2><label>PayPay 送金URL<input name="paypayUrl" type="url" required></label><label>PayPay 名義<input name="paypayName" maxlength="100"></label><div class="section"><h2>PayPal</h2><div id="paypal-preview"></div><label>PayPal QR画像<input id="paypal-file" type="file" accept="image/jpeg,image/png,image/webp"></label><div class="actions"><button type="button" id="use-paypal-image">承認済みQRを読込</button><button type="button" id="remove-paypal" class="danger">QRを解除</button></div><label>PayPal 名義<input name="paypalName" maxlength="100"></label><label>PayPal.me URL（任意）<input name="paypalUrl" type="url" placeholder="https://paypal.me/..."></label></div><div class="actions"><button class="primary">支払い設定を保存</button><button type="button" id="cancel-payment">キャンセル</button></div></form></section>';
  const form = document.querySelector('#payment-settings');
  form.oninput = () => { settingsDirty = true; };
  const updateQr = async file => { paypalQr = await resizeImage(file, 500); settingsDirty = true; drawPaymentPreview(); };
  document.querySelector('#paypal-file').onchange = event => { if (event.target.files[0]) act(() => updateQr(event.target.files[0])); };
  document.querySelector('#use-paypal-image').onclick = event => act(async () => { paypalQr = await imageFromUrl('./image.jpg', 500); settingsDirty = true; drawPaymentPreview(); }, event.currentTarget);
  document.querySelector('#remove-paypal').onclick = () => { paypalQr = ''; settingsDirty = true; drawPaymentPreview(); };
  document.querySelector('#cancel-payment').onclick = () => { settingsDirty = false; drawPaymentSettings(); };
  form.onsubmit = event => { event.preventDefault(); act(async () => {
    const value = { ...Object.fromEntries(new FormData(form)), paypalQr };
    if (!safeUrl(value.paypayUrl, 'qr.paypay.ne.jp') || (value.paypalUrl && !safeUrl(value.paypalUrl, 'paypal.me'))) throw new Error('PayPay / PayPal.me URLを確認してください。');
    await command('saveSettings', { section: 'payment', value }); state.payment = value; settingsDirty = false; message('支払い設定を保存しました。');
  }, event.submitter); };
}
function drawPaymentPreview() {
  document.querySelector('#paypal-preview').innerHTML = paypalQr ? `<img class="qr" src="${esc(imageSource(paypalQr))}" alt="PayPal QRプレビュー">` : '<p class="empty">PayPal 未設定・お客様の選択は無効です。</p>';
}
function drawPaymentSettings() {
  if (settingsDirty) return;
  const form = document.querySelector('#payment-settings');
  for (const key of ['paypayUrl', 'paypayName', 'paypalName', 'paypalUrl']) form.elements[key].value = state.payment[key] || '';
  paypalQr = state.payment.paypalQr || ''; drawPaymentPreview();
}
await protect(async () => {
  if (page === 'menu') menuSkeleton();
  if (page === 'inventory') inventorySkeleton();
  if (page === 'orders' || page === 'shipping') ordersSkeleton();
  if (page === 'payment') paymentSkeleton();
  const paths = page === 'menu' ? ['menu', 'menuRevision'] : page === 'inventory' ? ['menu', 'stock'] : page === 'orders' ? ['orders'] : page === 'shipping' ? ['orders', 'settings/shipping'] : ['settings/payment'];
  for (const path of paths) stops.push(watch(path, value => {
    if (path === 'menu') { menuReady = true; state.menu = normalizedMenu(value); if (!dirty) { draft = structuredClone(state.menu); draftRevision = state.revision; } }
    else if (path === 'menuRevision') { state.revision = value || 0; if (!dirty) draftRevision = state.revision; }
    else if (path === 'stock') { stockReady = true; state.stock = value || {}; }
    else if (path === 'orders') { const keys = Object.keys(value || {}); if (previousOrders && keys.some(id => !previousOrders.has(id))) beep(); previousOrders = new Set(keys); state.orders = value || {}; }
    else if (path.endsWith('shipping')) { state.shipping = { ...DEFAULT_SHIPPING, ...value }; fillShipping(); }
    else state.payment = { ...DEFAULT_PAYMENT, ...value };
    draw();
  }, error => message(error.message, true)));
  draw();
});
addEventListener('pagehide', () => { stops.forEach(stop => stop()); sound?.close(); }, { once: true });
addEventListener('beforeunload', event => { if (dirty || settingsDirty) { event.preventDefault(); event.returnValue = ''; } });