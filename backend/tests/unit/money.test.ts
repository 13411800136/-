import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeProfit, formatCents, parseMoneyToCents, profitMargin } from '../../src/common/money.js';
import { productKeyOf } from '../../src/common/crypto.js';
import { addDays, businessDate, isValidDateString } from '../../src/common/time.js';

test('金额以整数分精确解析与格式化', () => {
  assert.equal(parseMoneyToCents('12.50'), 1250);
  assert.equal(parseMoneyToCents('0.10'), 10);
  assert.equal(parseMoneyToCents('0.20'), 20);
  assert.equal(parseMoneyToCents('0'), 0);
  assert.equal(parseMoneyToCents(12.5), 1250);
  assert.equal(formatCents(1250), '12.50');
  assert.equal(formatCents(10), '0.10');
  assert.equal(formatCents(-87800), '-878.00');
});

test('非法金额被拒绝', () => {
  for (const value of ['-1', '1.234', 'abc', '', '01.2', '1,000']) {
    assert.throws(() => parseMoneyToCents(value), /金额/);
  }
});

test('A22 利润示例：1250 - 252 - 120 = 878，毛利率 70.24%', () => {
  const profit = computeProfit({ salesCents: 125000, purchaseCents: 25200, productionCents: 12000 });
  assert.equal(profit.profitCents, 87800);
  assert.equal(formatCents(profit.profitCents), '878.00');
  assert.equal(profit.marginPercent, '70.24');
});

test('销售额为 0 时毛利率按约定为 0.00，负利润不归零', () => {
  assert.equal(profitMargin(0, 0), '0.00');
  const loss = computeProfit({ salesCents: 100, purchaseCents: 300, productionCents: 0 });
  assert.equal(loss.profitCents, -200);
  assert.equal(loss.marginPercent, '-200.00');
});

test('成品身份键忽略大小写、全半角与多余空白', () => {
  assert.equal(productKeyOf(' 精密 传动箱体 ', 'TB-220'), productKeyOf('精密 传动箱体', 'tb-220'));
  assert.notEqual(productKeyOf('传动箱体', 'TB-220'), productKeyOf('传动箱体', 'TB-221'));
});

test('日期语义与北京时间自然日', () => {
  assert.equal(isValidDateString('2026-11-03'), true);
  assert.equal(isValidDateString('2026-02-30'), false);
  assert.equal(isValidDateString('2026-1-3'), false);
  assert.equal(addDays('2026-11-03', 7), '2026-11-10');
  assert.match(businessDate(), /^\d{4}-\d{2}-\d{2}$/);
});
