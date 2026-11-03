/**
 * 金额统一使用“分”的整数存储与计算，避免二进制浮点尾差。
 * 对外以两位小数字符串输出，保留精确口径。
 */

const MONEY_RE = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;

export function parseMoneyToCents(input: string | number): number {
  const raw = typeof input === 'number' ? input.toFixed(2) : input.trim();
  if (!MONEY_RE.test(raw)) {
    throw new Error('金额格式不合法，需为非负数字，最多两位小数');
  }
  const [yuan, fraction = ''] = raw.split('.') as [string, string?];
  const cents = Number(yuan) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) throw new Error('金额超出可处理范围');
  return cents;
}

export function formatCents(cents: number): string {
  if (!Number.isInteger(cents)) throw new Error('金额分值必须为整数');
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

/** 毛利率展示：两位小数百分数字符串；销售额为 0 时按约定返回 0.00。 */
export function profitMargin(profitCents: number, salesCents: number): string {
  if (salesCents === 0) return '0.00';
  return ((profitCents / salesCents) * 100).toFixed(2);
}

export interface ProfitBreakdown {
  salesCents: number;
  purchaseCents: number;
  platingCents: number;
  productionCents: number;
  profitCents: number;
  marginPercent: string;
}

export function computeProfit(input: {
  salesCents: number;
  purchaseCents: number;
  productionCents: number;
  platingCents?: number;
}): ProfitBreakdown {
  const platingCents = input.platingCents ?? 0;
  const profitCents =
    input.salesCents - input.purchaseCents - platingCents - input.productionCents;
  return {
    salesCents: input.salesCents,
    purchaseCents: input.purchaseCents,
    platingCents,
    productionCents: input.productionCents,
    profitCents,
    marginPercent: profitMargin(profitCents, input.salesCents)
  };
}
