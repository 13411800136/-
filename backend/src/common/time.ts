export const BUSINESS_TIME_ZONE = 'Asia/Shanghai';

const isoDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

export function nowIso(): string {
  return new Date().toISOString();
}

/** 业务自然日（北京时间），格式 YYYY-MM-DD。 */
export function businessDate(date: Date = new Date()): string {
  return isoDateFormatter.format(date);
}

/** 校验 YYYY-MM-DD 是否是真实存在的日历日期。 */
export function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** 在业务时区比较两个日期字符串，仅支持日期语义。 */
export function compareDateStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** 展示用：北京时间 YYYY-MM-DD HH:mm。 */
export function formatBusinessDateTime(iso: string): string {
  const date = new Date(iso);
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
    .format(date)
    .replace(/\//g, '-');
}

export function addDays(dateString: string, days: number): string {
  const [year, month, day] = dateString.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
