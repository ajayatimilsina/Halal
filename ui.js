import { configured, SHOP_NAME } from './firebase-sync.js';
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
export const storage = {
  get(key, fallback = null, session = false) { try { return JSON.parse((session ? sessionStorage : localStorage).getItem(key)) ?? fallback; } catch { return fallback; } },
  set(key, value, session = false) { try { (session ? sessionStorage : localStorage).setItem(key, JSON.stringify(value)); return true; } catch { return false; } },
  remove(key, session = false) { try { (session ? sessionStorage : localStorage).removeItem(key); } catch {} }
};
export function message(text, error = false) {
  const element = document.querySelector('#message');
  element.textContent = text;
  element.classList.toggle('error', error);
  element.hidden = !text;
}
export async function attempt(task, button) {
  if (button) button.disabled = true;
  try { return await task(); } catch (error) { message(error.message || '操作に失敗しました。', true); return null; }
  finally { if (button?.isConnected) button.disabled = false; }
}
export function safeUrl(value, host = '') {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && (!host || url.hostname === host) ? url.href : ''; } catch { return ''; }
}
export function imageSource(value) {
  if (/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value || '')) return value;
  if (['./assets/meat.jpg', './image.jpg'].includes(value)) return value;
  return '';
}
export async function resizeImage(file, width = 600) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10000000) throw new Error('10MB以下のJPEG・PNG・WebPを選択してください。');
  const bitmap = await createImageBitmap(file);
  if (bitmap.width * bitmap.height > 40000000) { bitmap.close(); throw new Error('画像サイズが大きすぎます。'); }
  const ratio = Math.min(1, width / bitmap.width, width === 500 ? width / bitmap.height : 1);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * ratio)); canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
  const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
  const result = canvas.toDataURL('image/jpeg', width === 500 ? 0.9 : 0.7);
  if (result.length > 600000) throw new Error('画像を小さくして再度選択してください。');
  return result;
}
export async function imageFromUrl(url, width) {
  const response = await fetch(url); if (!response.ok) throw new Error('画像を読込できません。');
  return resizeImage(await response.blob(), width);
}
export async function copy(text) {
  try { await navigator.clipboard.writeText(text); message('住所をコピーしました。'); }
  catch { const input = document.createElement('textarea'); input.value = text; document.body.append(input); input.select(); document.execCommand('copy'); input.remove(); message('住所をコピーしました。'); }
}
export function icons() { globalThis.lucide?.createIcons(); }
export function preserveFocus(render) {
  const active = document.activeElement;
  let selector = '';
  if (active?.dataset.count) selector = `[data-count="${CSS.escape(active.dataset.count)}"]`;
  else if (active?.dataset.tracking) selector = `[data-tracking="${CSS.escape(active.dataset.tracking)}"]`;
  else if (active?.dataset.field) selector = `[data-mid="${CSS.escape(active.closest('[data-mid]').dataset.mid)}"] [data-field="${CSS.escape(active.dataset.field)}"]${active.dataset.optionIndex !== undefined ? `[data-option-index="${active.dataset.optionIndex}"]` : ':not([data-option-index])'}`;
  const start = active?.selectionStart; const end = active?.selectionEnd;
  render();
  if (selector) { const next = document.querySelector(selector); next?.focus({ preventScroll: true }); if (next && start != null && next.type !== 'number') next.setSelectionRange(start, end); }
}
export function mountShell(title, staff = false) {
  const pages = [['customer', '買い物'], ['menu', '商品'], ['inventory', '棚卸'], ['orders', '注文'], ['shipping', '出荷'], ['payment', '支払い設定']];
  document.querySelector('#shell').innerHTML = `<header class="site-header"><a class="brand" href="./index.html"><span class="brand-mark">H</span><span>${escapeHtml(SHOP_NAME)}<small>HALAL GROCERY · JAPAN</small></span></a><button id="theme" class="icon-button" title="表示テーマを切り替え" aria-label="表示テーマを切り替え"><i data-lucide="sun-moon"></i></button>${staff ? '<button id="logout" class="icon-button" title="ログアウト" aria-label="ログアウト"><i data-lucide="log-out"></i></button>' : ''}</header><nav aria-label="ページ">${pages.map(([path, label]) => `<a ${location.pathname.endsWith(path + '.html') ? 'aria-current="page"' : ''} href="./${path}.html${location.search}">${label}</a>`).join('')}</nav><div class="page-title"><div><span class="eyebrow">${staff ? 'STORE OPERATIONS' : 'WELCOME / ようこそ'}</span><h1>${escapeHtml(title)}</h1></div><span class="mode-tag">${configured ? 'LIVE' : 'プレビュー・注文不可'}</span></div><p id="message" role="status" aria-live="polite" hidden></p>`;
  const theme = storage.get('theme', matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = theme;
  document.querySelector('#theme').onclick = () => { const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = next; storage.set('theme', next); };
  icons();
}
export const dateText = value => value ? new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
export const paymentLabels = { unpaid: '未払い', reported: '支払い報告あり', paid: '支払い確認済み' };
export const statusLabels = { new: '新規', packing: '梱包中', shipped: '出荷済み', done: '完了' };
export const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');