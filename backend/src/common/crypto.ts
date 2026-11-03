import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { normalize } from 'node:path';

export function newId(): string {
  return randomUUID();
}

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string, pepper: string): string {
  return sha256(`${token}|${pepper}`);
}

export function hashPassword(password: string, pepper: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(`${password.normalize('NFKC')}|${pepper}`, salt, 64, {
    N: 16384,
    r: 8,
    p: 1
  }).toString('hex');
  return { hash, salt };
}

export function verifyPassword(
  password: string,
  salt: string,
  expectedHash: string,
  pepper: string
): boolean {
  const actual = scryptSync(`${password.normalize('NFKC')}|${pepper}`, salt, 64, {
    N: 16384,
    r: 8,
    p: 1
  });
  const expected = Buffer.from(expectedHash, 'hex');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/** 稳定请求摘要：对象键排序后 JSON 序列化，用于绑定幂等键与请求内容。 */
export function canonicalJson(value: unknown): string {
  const seen = new WeakSet<object>();
  const normalizeValue = (input: unknown): unknown => {
    if (input === null || typeof input !== 'object') return input;
    if (seen.has(input)) throw new Error('请求内容不能包含循环引用');
    seen.add(input);
    if (Array.isArray(input)) return input.map(normalizeValue);
    const record = input as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) sorted[key] = normalizeValue(record[key]);
    return sorted;
  };
  return JSON.stringify(normalizeValue(value));
}

export function requestHash(payload: unknown): string {
  return sha256(canonicalJson(payload));
}

/** 成品库存稳定身份键：规范化名称 + 规格，忽略大小写与多余空白。 */
export function productKeyOf(name: string, spec: string): string {
  const normalizePart = (value: string) =>
    value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('zh-CN');
  return `${normalizePart(name)}|${normalizePart(spec)}`;
}

// 保留 normalize 导入的显式使用，避免不同平台路径处理差异影响文件名。
export function safeStoredName(stored: string): string {
  return normalize(stored).replace(/^(\.\.(\/|\\|$))+/, '');
}
