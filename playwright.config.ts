import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'tests/reports/playwright', open: 'never' }]
  ],
  use: {
    baseURL: 'http://127.0.0.1:8787',
    channel: 'msedge',
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000
  },
  webServer: {
    command: 'npm run start',
    url: 'http://127.0.0.1:8787/api/v1/health',
    reuseExistingServer: true,
    timeout: 30_000
  }
});
