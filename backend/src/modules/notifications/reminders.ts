import type { AppDatabase } from '../../db/database.js';
import { notifyAdmins } from '../../common/events.js';
import { addDays, businessDate, compareDateStrings } from '../../common/time.js';

/**
 * F：交期提醒。
 * 同一订单同一自然日只提醒一次；已完成/已撤销订单不提醒。
 * 没有后台常驻任务，读取通知时补齐，适合单机演示且不会产生重复通知。
 */
export function generateDueSoonNotifications(db: AppDatabase): void {
  const today = businessDate();
  const limit = addDays(today, 7);
  const rows = db.all<{
    id: string;
    order_no: string;
    customer_name: string;
    due_date: string;
  }>(
    `SELECT id, order_no, customer_name, due_date
     FROM orders
     WHERE cancelled_at IS NULL
       AND status <> 'COMPLETED'
       AND due_date <= ?
     ORDER BY due_date, created_at`,
    limit
  );
  for (const row of rows) {
    const overdue = compareDateStrings(row.due_date, today) < 0;
    const title = overdue ? '订单已逾期，请处理' : '订单交期提醒';
    notifyAdmins(db, {
      eventType: 'DUE_SOON',
      title,
      body: `${row.order_no} · ${row.customer_name} · 交期 ${row.due_date}${overdue ? '（已逾期）' : '（7 天内）'}`,
      resourceType: 'ORDER',
      resourceId: row.id,
      dedupeKey: `due-soon:${row.id}:${today}`
    });
  }
}
