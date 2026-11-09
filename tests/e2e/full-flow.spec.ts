import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const EVIDENCE = join(process.cwd(), 'tests', 'evidence', 'e2e');
mkdirSync(EVIDENCE, { recursive: true });

async function login(page: Page, username: string): Promise<void> {
  await page.goto('/login', { waitUntil: 'networkidle' });
  await page.locator('input[autocomplete="username"]').fill(username);
  await page.locator('input[autocomplete="current-password"]').fill('Demo@2026');
  await page.getByRole('button', { name: /登录系统/ }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(350);
}

async function logout(page: Page): Promise<void> {
  await page.getByRole('button', { name: '退出登录' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '确认退出' }).click();
  await page.waitForURL('**/login');
}

async function closeDialog(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeHidden({ timeout: 15_000 });
}

test('管理员建单 → 物流到货 → 生产 → 品控 → 包装 → 发货完整闭环', async ({ page }) => {
  await login(page, 'admin');
  await page.screenshot({ path: join(EVIDENCE, '01-dashboard.png'), fullPage: true });

  await page.goto('/admin/orders/new', { waitUntil: 'networkidle' });
  await expect(page.locator('#customer option')).not.toHaveCount(1);
  await page.selectOption('#customer', { index: 1 });
  await page.fill('#productName', 'UI 闭环验证产品');
  await page.fill('#spec', 'E2E-01 / 合成');
  await page.fill('#quantity', '10');
  await page.fill('#unitPrice', '12.50');
  await page.fill('#note', '浏览器端到端闭环（合成数据）');
  await page.screenshot({ path: join(EVIDENCE, '02-new-order.png'), fullPage: true });
  await page.getByRole('button', { name: '保存订单' }).click();
  await page.waitForURL(/\/admin\/orders\/[0-9a-f-]+$/);
  const orderUrl = page.url();
  const orderNo = (await page.locator('h1').first().innerText()).trim();
  expect(orderNo).toMatch(/^SO-\d{8}-\d{4}$/);
  await expect(page.getByText('待采购').first()).toBeVisible();

  // 采购
  await page.getByRole('button', { name: '建立采购单' }).first().click();
  const purchaseDialog = page.getByRole('dialog');
  await expect(purchaseDialog).toBeVisible();
  await purchaseDialog.locator('select').nth(0).selectOption({ index: 1 });
  await purchaseDialog.locator('select').nth(1).selectOption({ index: 1 });
  await purchaseDialog.locator('input[inputmode="numeric"]').fill('12');
  await purchaseDialog.getByPlaceholder('2.10').fill('2.10');
  await purchaseDialog.getByRole('button', { name: '保存采购单' }).click();
  await closeDialog(page);
  await expect(page.getByText(/PO-\d{8}-\d{4}/).first()).toBeVisible();

  // 物流到货
  await logout(page);
  await login(page, 'logistics');
  await page.screenshot({ path: join(EVIDENCE, '03-logistics-queue.png'), fullPage: true });
  const arrivalCard = page.locator('.tablet-task').filter({ hasText: orderNo });
  await arrivalCard.getByRole('button', { name: '确认登记到货' }).click();
  await expect(page.getByText('到货已登记').first()).toBeVisible();
  await page.waitForTimeout(900);
  await logout(page);

  // 下发生产
  await login(page, 'admin');
  await page.goto(orderUrl, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '下发生产' }).first().click();
  const productionDialog = page.getByRole('dialog');
  await expect(productionDialog).toBeVisible();
  await productionDialog.getByPlaceholder('1.20').fill('1.20');
  await productionDialog.getByRole('button', { name: '下发任务' }).click();
  await closeDialog(page);
  await expect(page.getByText('生产中').first()).toBeVisible();

  // 生产反馈
  await logout(page);
  await login(page, 'prod');
  await page.screenshot({ path: join(EVIDENCE, '04-production.png'), fullPage: true });
  await page
    .locator('.tablet-task')
    .filter({ hasText: orderNo })
    .getByRole('button', { name: '提交生产反馈' })
    .click();
  await expect(page.getByText('生产反馈已提交').first()).toBeVisible();
  await page.waitForTimeout(900);
  await logout(page);

  // 下发质检
  await login(page, 'admin');
  await page.goto(orderUrl, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '下发质检' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: '下发质检' }).click();
  await closeDialog(page);

  // 品控录入
  await logout(page);
  await login(page, 'qc');
  await page
    .locator('.tablet-task')
    .filter({ hasText: orderNo })
    .getByRole('button', { name: '确认全检合格并提交' })
    .click();
  await expect(page.getByText('质检结果已录入').first()).toBeVisible();
  await page.waitForTimeout(900);
  await logout(page);

  // 管理员放行
  await login(page, 'admin');
  await page.goto(orderUrl, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '处置质检' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: '确认 PASS 放行' }).click();
  await closeDialog(page);
  await expect(page.getByText('质检已放行').first()).toBeVisible();

  // 下发包装
  await page.getByRole('button', { name: '下发包装' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: '下发包装' }).click();
  await closeDialog(page);

  // 包装
  await logout(page);
  await login(page, 'pack');
  await page.screenshot({ path: join(EVIDENCE, '05-packing.png'), fullPage: true });
  await page
    .locator('.tablet-task')
    .filter({ hasText: orderNo })
    .getByRole('button', { name: '确认提交包装' })
    .click();
  await expect(page.getByText('包装记录已提交').first()).toBeVisible();
  await page.waitForTimeout(900);
  await logout(page);

  // 触发发货
  await login(page, 'admin');
  await page.goto(orderUrl, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '确认发货' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: '确认发货' }).click();
  await closeDialog(page);

  // 物流发货
  await logout(page);
  await login(page, 'logistics');
  await page.getByRole('tab', { name: /发货登记/ }).click();
  await page.screenshot({ path: join(EVIDENCE, '06-logistics-shipment.png'), fullPage: true });
  await page
    .locator('.tablet-task')
    .filter({ hasText: orderNo })
    .getByRole('button', { name: '确认登记发货' })
    .click();
  await expect(page.getByText('发货已登记').first()).toBeVisible();
  await page.waitForTimeout(900);
  await logout(page);

  // 最终核对
  await login(page, 'admin');
  await page.goto(orderUrl, { waitUntil: 'networkidle' });
  await expect(page.getByText('已完成交付').first()).toBeVisible();
  await expect(page.getByText('¥87.80').first()).toBeVisible();
  await expect(page.getByText('70.24%').first()).toBeVisible();
  await page.screenshot({ path: join(EVIDENCE, '07-completed-order.png'), fullPage: true });

  const timeline = page.locator('.timeline-item');
  await expect(timeline).toHaveCount(13);
  await page.screenshot({ path: join(EVIDENCE, '08-order-timeline.png'), fullPage: true });
});
