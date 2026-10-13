import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: '**/browser-live.spec.mjs', workers: 1,
  use: { baseURL: 'http://127.0.0.1:8080', browserName: 'chromium', screenshot: 'only-on-failure' },
  webServer: { command: 'npm run serve', url: 'http://127.0.0.1:8080', reuseExistingServer: true }, reporter: 'list'
});