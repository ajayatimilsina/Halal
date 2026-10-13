import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/firebase-sync.js', async route => {
    const response = await route.fetch();
    const source = await response.text();
    await route.fulfill({ response, body: source.replace('export const configured = Boolean(FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.appId) || emulator;', 'export const configured = false;') });
  });
});

for (const width of [360, 1440]) {
  test(`catalogue, cart, themes and preview protection at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('/customer.html');
    await expect(page.getByRole('heading', { name: 'Mutton meat' })).toBeVisible();
    await expect.poll(() => page.locator('.product img').evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'カートに入れる' }).click();
    await expect(page.locator('#cart-count')).toHaveText('1 点');
    await page.locator('[data-cart-option]').selectOption('0');
    await expect(page.locator('#totals')).toContainText('￥2,250');
    await page.getByRole('button', { name: '数量を増やす' }).click();
    await expect(page.locator('#totals')).toContainText('￥4,500');
    await page.locator('[name=address]').fill('名古屋市中区');
    await expect(page.locator('[name=address]')).toHaveValue('名古屋市中区');
    await expect(page.locator('#submit-order')).toBeDisabled();
    await page.screenshot({ path: `test-results/customer-light-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: '表示テーマを切り替え' }).click();
    await page.screenshot({ path: `test-results/customer-${width}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    expect(errors).toEqual([]);
    await page.reload(); await expect(page.locator('#cart-count')).toHaveText('2 点');
  });
}
test('all staff pages require Google login and ignore legacy password flags', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('staffGate', 'true'));
  for (const name of ['menu', 'inventory', 'orders', 'shipping', 'payment']) {
    await page.goto(`/${name}.html`);
    await expect(page.getByRole('heading', { name: 'スタッフログイン' })).toBeVisible();
    await expect(page.locator('[name=password]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Googleでログイン' }).click();
    await expect(page.locator('#message')).toContainText('Firebase設定が未完了');
  }
});
test('storage denial and unavailable icon CDN still render the shop', async ({ page }) => {
  await page.addInitScript(() => { for (const key of ['localStorage', 'sessionStorage']) Object.defineProperty(window, key, { get() { throw new Error('blocked'); } }); });
  await page.route('**/lucide.min.js', route => route.abort());
  await page.goto('/customer.html');
  await page.getByRole('button', { name: 'カートに入れる' }).click();
  await expect(page.locator('#cart-count')).toHaveText('1 点');
});
test('HTML escaping and all hub links', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.locator('.hub a')).toHaveCount(6);
  const escaped = await page.evaluate(async () => (await import('/ui.js')).escapeHtml('<img src=x onerror=alert(1)>'));
  expect(escaped).toBe('&lt;img src=x onerror=alert(1)&gt;');
});
test('checkout works without reCAPTCHA or a Cloud Functions SDK', async ({ page }) => {
  await page.unroute('**/firebase-sync.js');
  const mocks = {
    'firebase-app.js': 'export function initializeApp(){return {};}',
    'firebase-database.js': 'export function getDatabase(){return {};} export function ref(db,path){return path;} export function onValue(path,callback){callback({val:()=>path==="menu"?[{id:"mutton",n:"Mutton meat",cat:"Meat",p:1500,img:"",out:false,opts:[]}]:null});return ()=>{};}',
    'firebase-auth.js': 'const auth={authStateReady:async()=>{},currentUser:null}; export function getAuth(){return auth;} export async function signInAnonymously(){auth.currentUser={uid:"test-customer",isAnonymous:true};window.anonymousSignedIn=true;return {user:auth.currentUser};}'
  };
  await page.route('https://www.gstatic.com/firebasejs/11.10.0/*', route => {
    const name = route.request().url().split('/').pop();
    if (!mocks[name]) throw new Error(`Unexpected SDK import: ${name}`);
    return route.fulfill({ contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: mocks[name] });
  });
  await page.goto('/customer.html');
  await expect(page.getByRole('heading', { name: 'Mutton meat' })).toBeVisible();
  await expect(page.locator('#message')).toBeHidden();
  await page.getByRole('button', { name: 'カートに入れる' }).click();
  await expect(page.locator('#submit-order')).toBeEnabled();
  await expect(page.locator('#submit-order')).toHaveText('注文を確定して支払いへ');
  await page.evaluate(async () => {
    const gateway = await import('/firebase-sync.js');
    await gateway.customerAuth();
  });
  expect(await page.evaluate(() => window.anonymousSignedIn)).toBeTruthy();
});