import { DEFAULT_PAYMENT, DEFAULT_SHIPPING } from './shop-domain.js';

export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAw5fh-mNu72irHOszXTpXmXzaHWeSXG3E',
  authDomain: 'kiranahibino.firebaseapp.com',
  databaseURL: 'https://kiranahibino-default-rtdb.firebaseio.com',
  projectId: 'kiranahibino',
  storageBucket: 'kiranahibino.firebasestorage.app',
  messagingSenderId: '59402858023',
  appId: '1:59402858023:web:678654a369c891a34a2802',
  measurementId: 'G-W2KBY6L01H'
};
export const OWNER_UID = 'OWNER_UID_NOT_CONFIGURED';
export const EMAILJS = { serviceId: '', templateId: '', publicKey: '', ownerEmail: 'ajayatimilsina1@gmail.com' };
export const APP_CHECK_SITE_KEY = '';
export const SHOP_NAME = 'ハラール食料品店';
const emulator = ['localhost', '127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).get('emulator') === '1';
export const configured = Boolean(FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.appId) || emulator;
export const previewMenu = [{ id: 'mutton', cat: 'Mutton / ミート', n: 'Mutton meat', p: 1500, img: './assets/meat.jpg', out: false, opts: [{ n: '500g 追加', p: 750 }] }];
let services;
let initPromise;
async function initialize() {
  if (!configured) throw new Error('Firebase設定が未完了です。商品プレビューのみ表示しています。');
  if (!initPromise) initPromise = (async () => {
    const base = 'https://www.gstatic.com/firebasejs/11.10.0/';
    const [appSdk, databaseSdk, authSdk, functionsSdk] = await Promise.all(['firebase-app.js', 'firebase-database.js', 'firebase-auth.js', 'firebase-functions.js'].map(file => import(base + file)));
    const config = emulator ? { ...FIREBASE_CONFIG, apiKey: 'demo-key', appId: 'demo-app', projectId: 'demo-kiranahibino', authDomain: 'demo-kiranahibino.firebaseapp.com', databaseURL: 'https://demo-kiranahibino.firebaseio.com' } : FIREBASE_CONFIG;
    const app = appSdk.initializeApp(config);
    const db = databaseSdk.getDatabase(app);
    const auth = authSdk.getAuth(app);
    const functions = functionsSdk.getFunctions(app, 'asia-northeast1');
    if (emulator) { databaseSdk.connectDatabaseEmulator(db, '127.0.0.1', 9000); authSdk.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true }); functionsSdk.connectFunctionsEmulator(functions, '127.0.0.1', 5001); }
    else {
      if (!APP_CHECK_SITE_KEY) throw new Error('App Check設定が未完了です。');
      const appCheck = await import(base + 'firebase-app-check.js');
      appCheck.initializeAppCheck(app, { provider: new appCheck.ReCaptchaV3Provider(APP_CHECK_SITE_KEY), isTokenAutoRefreshEnabled: true });
    }
    await auth.authStateReady();
    services = { db, auth, functions, databaseSdk, authSdk, functionsSdk };
    return services;
  })();
  return initPromise;
}
export function watch(path, callback, onError = () => {}) {
  let unsubscribe = () => {};
  let cancelled = false;
  if (!configured) {
    const examples = { menu: previewMenu, stock: {}, 'settings/shipping': DEFAULT_SHIPPING, 'settings/payment': { ...DEFAULT_PAYMENT, paypalQr: './image.jpg' }, orders: {}, menuRevision: 0 };
    queueMicrotask(() => { if (!cancelled) callback(structuredClone(examples[path] ?? null)); });
  } else initialize().then(service => {
    if (!cancelled) unsubscribe = service.databaseSdk.onValue(service.databaseSdk.ref(service.db, path), snapshot => callback(snapshot.val()), onError);
  }).catch(onError);
  return () => { cancelled = true; unsubscribe(); };
}
export async function customerAuth() {
  const service = await initialize();
  if (!service.auth.currentUser) await service.authSdk.signInAnonymously(service.auth);
  return service.auth.currentUser;
}
export async function staffLogin() {
  const service = await initialize();
  await service.authSdk.setPersistence(service.auth, service.authSdk.browserSessionPersistence);
  let user = service.auth.currentUser;
  if (!user || user.isAnonymous) user = (await service.authSdk.signInWithPopup(service.auth, new service.authSdk.GoogleAuthProvider())).user;
  if (user.uid !== OWNER_UID) { await service.authSdk.signOut(service.auth); throw new Error('登録された管理者アカウントでログインしてください。'); }
  return user;
}
export async function logout() { if (services) await services.authSdk.signOut(services.auth); }
export async function command(action, data = {}) {
  const service = await initialize();
  if (!service.auth.currentUser) await customerAuth();
  const result = await service.functionsSdk.httpsCallable(service.functions, 'shopCommand')({ ...data, action });
  return result.data;
}
let lastEmailAt = 0;
export async function sendOrderEmail(order, event = 'new') {
  let sent = false;
  try {
    if (!EMAILJS.serviceId || !EMAILJS.templateId || !EMAILJS.publicKey) throw new Error('EmailJS設定が未完了です。管理画面から再送してください。');
    if (Date.now() - lastEmailAt < 1100) throw new Error('メール再送は少し間隔を空けてください。');
    lastEmailAt = Date.now();
    const emailjs = await import('https://cdn.jsdelivr.net/npm/@emailjs/browser@4.4.1/+esm');
    const params = {
      subject: event === 'new' ? `【新規注文】#${order.id} ${order.customer?.name || ''}` : `【支払い報告】#${order.id}`,
      order_id: order.id, customer_name: order.customer?.name || '',
      items: (order.items || []).map(item => `${item.n}${item.option ? ' / ' + item.option : ''} × ${item.q} = ¥${item.p * item.q}`).join('\n'),
      items_total: order.itemsTotal, shipping: `${order.shipping?.mode || ''} ¥${order.shipping?.fee || 0}`, total: order.total,
      payment_method: order.payment.method, payment_status: order.payment.status,
      customer_details: order.customer ? `${order.customer.phone}\n${order.customer.email}\n〒${order.customer.postal}\n${order.customer.address}\n${order.customer.note}` : '詳細は管理画面でご確認ください。'
    };
    await emailjs.send(EMAILJS.serviceId, EMAILJS.templateId, params, { publicKey: EMAILJS.publicKey });
    sent = true;
  } finally {
    try { await command('recordEmailResult', { id: order.id, event, sent }); } catch {}
  }
  return sent;
}