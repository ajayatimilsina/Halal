import { staffLogin, restoreStaffSession, logout, configured } from './firebase-sync.js';
import { html,text,t, storage, attempt, icons } from './ui.js';
export async function protect(start) {
  const app = document.querySelector('#app');
  const begin = async () => { await staffLogin(); app.innerHTML = ''; await start(); };
  document.querySelector('#logout').onclick = () => attempt(async () => { storage.remove('staffGate', true); await logout(); location.reload(); });
  if (configured && await attempt(restoreStaffSession) === true) { const result = await attempt(begin); if (result !== null) return; }
  app.innerHTML = html('<section class="gate"><i data-lucide="lock-keyhole"></i><h2>スタッフログイン</h2><button id="google-login" class="primary"><i data-lucide="log-in"></i>Googleでログイン</button><p class="muted">管理者アカウント専用</p></section>');
  document.querySelector('#google-login').onclick = event => attempt(begin, event.currentTarget);
  icons();
}