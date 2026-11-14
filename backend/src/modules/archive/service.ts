import ExcelJS from 'exceljs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { businessDate, nowIso } from '../../common/time.js';
import { computeProfit, formatCents } from '../../common/money.js';
import type { AppDatabase } from '../../db/database.js';

export interface MonthlyArchiveRow {
  id: string;
  order_no: string;
  customer_name: string;
  product_name: string;
  spec: string;
  quantity: number;
  unit_price_cents: number;
  due_date: string;
  completed_at: string;
  sales_cents: number;
  purchase_cents: number;
  production_cents: number;
}

export interface MonthlyArchiveResult {
  month: string;
  count: number;
  xlsxPath: string;
  csvPath: string;
  totals: {
    sales: string;
    purchaseCost: string;
    productionCost: string;
    profit: string;
    margin: string;
  };
}

/** 上个月（北京时间）的 YYYY-MM。 */
export function previousMonth(today = businessDate()): string {
  const [year, month] = today.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, 1));
  date.setUTCMonth(date.getUTCMonth() - 1);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function isValidMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function monthRange(month: string): { startIso: string; endIso: string } {
  const [year, monthIndex] = month.split('-').map(Number);
  const start = new Date(Date.UTC(year!, monthIndex! - 1, 1) - 8 * 60 * 60 * 1000);
  const end = new Date(Date.UTC(year!, monthIndex!, 1) - 8 * 60 * 60 * 1000);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

export function loadMonthlyCompletedOrders(
  db: AppDatabase,
  month: string
): MonthlyArchiveRow[] {
  const { startIso, endIso } = monthRange(month);
  return db.all<MonthlyArchiveRow>(
    `SELECT o.id, o.order_no, o.customer_name, oi.product_name, oi.spec, oi.quantity,
            oi.unit_price_cents, o.due_date,
            COALESCE(
              (SELECT MAX(s.created_at) FROM shipment_records s WHERE s.order_id = o.id),
              o.updated_at
            ) AS completed_at,
            oi.quantity * oi.unit_price_cents AS sales_cents,
            COALESCE((SELECT SUM(pi.quantity * pi.unit_price_cents)
                      FROM purchase_items pi
                      JOIN purchase_orders po ON po.id = pi.purchase_order_id
                      WHERE po.order_id = o.id), 0) AS purchase_cents,
            COALESCE((SELECT SUM(f.quantity * p.unit_price_cents)
                      FROM production_feedbacks f
                      JOIN production_orders p ON p.id = f.production_order_id
                      WHERE p.order_id = o.id), 0) AS production_cents
     FROM orders o
     JOIN order_items oi ON oi.order_id = o.id
     WHERE o.status = 'COMPLETED' AND o.cancelled_at IS NULL AND o.archived_at IS NULL
       AND COALESCE(
             (SELECT MAX(s.created_at) FROM shipment_records s WHERE s.order_id = o.id),
             o.updated_at
           ) >= ? AND COALESCE(
             (SELECT MAX(s.created_at) FROM shipment_records s WHERE s.order_id = o.id),
             o.updated_at
           ) < ?
     ORDER BY completed_at ASC, o.order_no ASC`,
    startIso,
    endIso
  );
}

const HEADERS = [
  '订单号',
  '客户',
  '产品',
  '规格',
  '数量',
  '销售额（元）',
  '采购成本（元）',
  '生产成本（元）',
  '预计利润（元）',
  '毛利率（%）',
  '交期',
  '完成时间'
];

function rowCells(row: MonthlyArchiveRow): (string | number)[] {
  const profit = computeProfit({
    salesCents: row.sales_cents,
    purchaseCents: row.purchase_cents,
    productionCents: row.production_cents
  });
  return [
    row.order_no,
    row.customer_name,
    row.product_name,
    row.spec,
    row.quantity,
    formatCents(row.sales_cents),
    formatCents(row.purchase_cents),
    formatCents(row.production_cents),
    formatCents(profit.profitCents),
    profit.marginPercent,
    row.due_date,
    row.completed_at.slice(0, 16).replace('T', ' ')
  ];
}

export async function writeMonthlyArchive(
  db: AppDatabase,
  archiveDir: string,
  month: string,
  rows: MonthlyArchiveRow[]
): Promise<MonthlyArchiveResult> {
  mkdirSync(archiveDir, { recursive: true });
  const totals = rows.reduce(
    (sum, row) => ({
      sales: sum.sales + row.sales_cents,
      purchase: sum.purchase + row.purchase_cents,
      production: sum.production + row.production_cents
    }),
    { sales: 0, purchase: 0, production: 0 }
  );
  const profit = computeProfit({
    salesCents: totals.sales,
    purchaseCents: totals.purchase,
    productionCents: totals.production
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'FactoryFlow';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(`${month} 已完成订单`);
  sheet.columns = [
    { width: 20 },
    { width: 22 },
    { width: 24 },
    { width: 18 },
    { width: 10 },
    { width: 14 },
    { width: 15 },
    { width: 15 },
    { width: 15 },
    { width: 12 },
    { width: 13 },
    { width: 19 }
  ];
  sheet.mergeCells('A1:L1');
  const title = sheet.getCell('A1');
  title.value = `${month} 已完成订单月报`;
  title.font = { size: 14, bold: true };
  title.alignment = { horizontal: 'left', vertical: 'middle' };
  sheet.getRow(1).height = 26;

  sheet.mergeCells('A2:L2');
  const note = sheet.getCell('A2');
  note.value = `导出时间 ${nowIso()} · 共 ${rows.length} 张订单 · 金额为预计值，不含人工与电镀成本`;
  note.font = { size: 10, color: { argb: 'FF666666' } };

  const header = sheet.getRow(3);
  header.values = HEADERS;
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111614' } };
    cell.font = { bold: true, color: { argb: 'FFECE7DA' } };
    cell.alignment = { horizontal: 'center' };
  });
  header.height = 22;

  rows.forEach((row, index) => {
    const excelRow = sheet.getRow(4 + index);
    excelRow.values = rowCells(row);
    excelRow.alignment = { vertical: 'middle' };
    excelRow.getCell(1).font = { name: 'Consolas' };
  });

  const totalRow = sheet.getRow(4 + rows.length);
  totalRow.values = [
    '合计',
    `${rows.length} 张`,
    '',
    '',
    rows.reduce((sum, row) => sum + row.quantity, 0),
    formatCents(totals.sales),
    formatCents(totals.purchase),
    formatCents(totals.production),
    formatCents(profit.profitCents),
    profit.marginPercent,
    '',
    ''
  ];
  totalRow.font = { bold: true };
  totalRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3EEE2' } };
  });

  sheet.views = [{ state: 'frozen', ySplit: 3 }];

  const xlsxPath = join(archiveDir, `${month}-已完成订单.xlsx`);
  const buffer = await workbook.xlsx.writeBuffer();
  writeFileSync(xlsxPath, Buffer.from(buffer));

  const csvLines = [HEADERS.join(',')];
  for (const row of rows) {
    csvLines.push(
      rowCells(row)
        .map((cell) => {
          const text = String(cell);
          return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        })
        .join(',')
    );
  }
  csvLines.push(
    ['合计', `${rows.length} 张`, '', '', rows.reduce((sum, row) => sum + row.quantity, 0),
      formatCents(totals.sales), formatCents(totals.purchase), formatCents(totals.production),
      formatCents(profit.profitCents), profit.marginPercent, '', ''].join(',')
  );
  const csvPath = join(archiveDir, `${month}-已完成订单.csv`);
  writeFileSync(csvPath, `\uFEFF${csvLines.join('\n')}\n`, 'utf8');

  return {
    month,
    count: rows.length,
    xlsxPath,
    csvPath,
    totals: {
      sales: formatCents(totals.sales),
      purchaseCost: formatCents(totals.purchase),
      productionCost: formatCents(totals.production),
      profit: formatCents(profit.profitCents),
      margin: profit.marginPercent
    }
  };
}