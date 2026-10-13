import { staffLogin, logout, configured } from './firebase-sync.js';
import { storage, message, attempt } from './ui.js';

// This front-end gate is not real security. Firebase Auth and server rules authorize staff.
const PASSWORD_HASH = '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4';
export async function protect(start) {
  const app = document.querySelector('#app');
  const begin = async () => { await staffLogin(); app.innerHTML = ''; await start(); };
  document.querySelector('#logout').onclick = () => attempt(async () => { storage.remove('staffGate', true); await logout(); location.reload(); });
  if (storage.get('staffGate', false, true) && configured) { const result = await attempt(begin); if (result !== null) return; }
  app.innerHTML = '<section class="gate"><i data-lucide="lock-keyhole"></i><h2>スタッフログイン</h2><form id="gate"><label>パスワード<input type="password" name="password" required autocomplete="current-password" inputmode="numeric"></label><button class="primary" type="submit">管理者でログイン</button></form><p class="muted">管理者 Google アカウントが必要です。</p></section>';
  document.querySelector('#gate').onsubmit = event => {
    event.preventDefault();
    attempt(async () => {
      const value = new FormData(event.target).get('password');
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
      const hashed = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      if (hashed !== PASSWORD_HASH) { message('パスワードが違います。', true); return; }
      await begin(); storage.set('staffGate', true, true);
    }, event.submitter);
  };
  globalThis.lucide?.createIcons();
}