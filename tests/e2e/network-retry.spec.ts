import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const EVIDENCE = join(process.cwd(), 'tests', 'evidence', 'e2e');
mkdirSync(EVIDENCE, { recursive: true });

test('响应丢失：显示结果未知，同键重试只生成一张订单', async ({ page }) => {
  await page.goto('/login', { waitUntil: 'networkidle' });
  await page.locator('input[autocomplete="username"]').fill('admin');
  await page.locator('input[autocomplete="current-password"]').fill('Demo@2026');
  await page.getByRole('button', { name: /登录系统/ }).click();
  await page.waitForURL('**/admin');

  const productName = `网络重试验证-${Date.now()}`;
  await page.goto('/admin/orders/new', { waitUntil: 'networkidle' });
  await expect(page.locator('#customer option')).not.toHaveCount(1);
  await page.selectOption('#customer', { index: 1 });
  await page.fill('#productName', productName);
  await page.fill('#quantity', '2');
  await page.fill('#unitPrice', '3.00');

  // 草稿：等待保存后刷新，页面应恢复未提交内容（不含密码）。
  await page.waitForTimeout(600);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByText('已恢复未提交草稿').first()).toBeVisible();
  await expect(page.locator('#productName')).toHaveValue(productName);

  let intercepted = false;
  await page.route('**/api/v1/orders', async (route) => {
    if (!intercepted && route.request().method() === 'POST') {
      intercepted = true;
      // 让请求真实到达服务端并写入，再丢弃响应，模拟“结果未知”。
      await route.fetch();
      await route.abort('failed');
      return;
    }
    await route.continue();
  });

  await page.getByRole('button', { name: '保存订单' }).click();
  await expect(page.getByText('提交结果未知').first()).toBeVisible();
  await expect(page.getByRole('button', { name: '重试原请求' })).toBeVisible();
  await page.screenshot({ path: join(EVIDENCE, '09-network-unknown.png'), fullPage: true });

  await page.unroute('**/api/v1/orders');
  await page.getByRole('button', { name: '重试原请求' }).click();
  await page.waitForURL(/\/admin\/orders\/[0-9a-f-]+$/);
  await expect(page.getByText(productName).first()).toBeVisible();
  await page.screenshot({ path: join(EVIDENCE, '10-network-retried-order.png'), fullPage: true });

  const count = await page.evaluate(async (name) => {
    const response = await fetch(`/api/v1/orders?keyword=${encodeURIComponent(name)}&pageSize=100`);
    const payload = await response.json();
    return payload.data.items.length;
  }, productName);
  expect(count).toBe(1);
});
