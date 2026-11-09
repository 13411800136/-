import type { OrderStatus } from './types';

const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
});

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return dateTimeFormatter.format(date).replace(/\//g, '-');
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return dateFormatter.format(date).replace(/\//g, '-');
}

export function fmtMoney(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return `¥${numeric.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtNumber(value: number): string {
  return value.toLocaleString('zh-CN');
}

export function today(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function daysUntil(date: string): number {
  const now = Date.parse(`${today()}T00:00:00+08:00`);
  const target = Date.parse(`${date}T00:00:00+08:00`);
  return Math.round((target - now) / 86_400_000);
}

export const STATUS_TONE: Record<OrderStatus, string> = {
  PENDING_PURCHASE: 'slate',
  PURCHASING: 'amber',
  IN_PRODUCTION: 'teal',
  PENDING_QC: 'violet',
  QC_DONE: 'blue',
  PACKING: 'orange',
  SHIPPING: 'cyan',
  COMPLETED: 'green',
  CANCELLED: 'slate'
};

export function dueLabel(date: string): { text: string; tone: 'normal' | 'warn' | 'danger' } {
  const days = daysUntil(date);
  if (days < 0) return { text: `逾期 ${Math.abs(days)} 天`, tone: 'danger' };
  if (days === 0) return { text: '今日交期', tone: 'danger' };
  if (days <= 3) return { text: `${days} 天后交期`, tone: 'warn' };
  return { text: `还有 ${days} 天`, tone: 'normal' };
}

export function shortId(id: string): string {
  return id.length > 10 ? id.slice(0, 8) : id;
}

export function initials(name: string): string {
  return name.replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '').slice(0, 2) || '厂';
}
