import { test, expect } from '@playwright/test';

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
test('all staff pages gate access and reject wrong password', async ({ page }) => {
  for (const name of ['menu', 'inventory', 'orders', 'shipping', 'payment']) {
    await page.goto(`/${name}.html`);
    await expect(page.getByRole('heading', { name: 'スタッフログイン' })).toBeVisible();
    await page.locator('[name=password]').fill('incorrect');
    await page.getByRole('button', { name: '管理者でログイン' }).click();
    await expect(page.locator('#message')).toHaveText('パスワードが違います。');
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