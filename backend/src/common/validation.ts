import { z } from 'zod';
import { errors } from './errors.js';
import { isValidDateString } from './time.js';
import { parseMoneyToCents } from './money.js';

export function validate<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      path: issue.path.join('.') || '(root)',
      message: issue.message
    }));
    throw errors.validation('请求参数不合法', details);
  }
  return result.data;
}

export const positiveInt = z
  .number({ error: '必须是数字' })
  .int('必须是整数')
  .positive('必须大于 0')
  .max(1_000_000, '数量过大');

export const nonNegativeInt = z.number().int('必须是整数').min(0, '不能为负数').max(1_000_000);

export const moneyInput = z
  .union([z.string(), z.number()])
  .transform((value, ctx) => {
    try {
      return parseMoneyToCents(value);
    } catch (error) {
      ctx.addIssue({ code: 'custom', message: (error as Error).message });
      return z.NEVER;
    }
  });

export const dateInput = z
  .string()
  .refine((value) => isValidDateString(value), '日期必须是真实存在的 YYYY-MM-DD');

export const shortText = (max: number, label = '文本') =>
  z.string().trim().max(max, `${label}不能超过 ${max} 个字符`);

export const requiredText = (max: number, label = '内容') =>
  z.string().trim().min(1, `${label}不能为空`).max(max, `${label}不能超过 ${max} 个字符`);

export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
});

export const idParam = z.object({ id: z.string().min(1).max(100) });
