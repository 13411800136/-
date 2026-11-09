import type { FastifyInstance } from 'fastify';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { writeAudit } from '../../common/audit.js';
import { createAuthenticate, requireAdmin } from '../../common/auth.js';
import { ok } from '../../common/http.js';
import { businessDate } from '../../common/time.js';
import { validate } from '../../common/validation.js';
import type { AppContext } from '../../common/types.js';
import { ORDER_STATUS_LABELS, type OrderStatus } from '../orders/service.js';

const exportQuery = z.object({
  status: z
    .enum(['PENDING_PURCHASE', 'PURCHASING', 'IN_PRODUCTION', 'PENDING_QC', 'QC_DONE', 'PACKING', 'SHIPPING', 'COMPLETED'])
    .optional(),
  keyword: z.string().trim().max(80).optional()
});

interface ExportRow {
  order_no: string;
  customer_name: string;
  product_name: string;
  spec: string;
  quantity: number;
  unit_price_cents: number;
  due_date: string;
  status: OrderStatus;
  created_at: string;
}

export async function registerExportRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { db, config } = ctx;
  const authenticate = createAuthenticate(db, config);
  const admin = { preHandler: [authenticate, requireAdmin] };

  app.get('/exports/orders.xlsx', admin, async (request, reply) => {
    const query = validate(exportQuery, request.query);
    const where: string[] = [];
    const params: string[] = [];
    if (query.status) {
      where.push('o.status = ?');
      params.push(query.status);
    }
    if (query.keyword) {
      where.push('(o.order_no LIKE ? OR o.customer_name LIKE ? OR oi.product_name LIKE ?)');
      const like = `%${query.keyword}%`;
      params.push(like, like, like);
    }
    const rows = db.all<ExportRow>(
      `SELECT o.order_no, o.customer_name, oi.product_name, oi.spec, oi.quantity,
              oi.unit_price_cents, o.due_date, o.status, o.created_at
       FROM orders o JOIN order_items oi ON oi.order_id = o.id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY o.created_at DESC, o.id DESC LIMIT 10000`,
      ...params
    );

    const workbook = new ExcelJS.Workbook();
    workbook.creator = '厂序 FactoryFlow';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('订单列表', {
      views: [{ state: 'frozen', ySplit: 1 }]
    });
    sheet.columns = [
      { header: '订单号', key: 'orderNo', width: 22 },
      { header: '客户', key: 'customer', width: 26 },
      { header: '产品', key: 'product', width: 22 },
      { header: '规格', key: 'spec', width: 24 },
      { header: '数量', key: 'quantity', width: 10 },
      { header: '单价(元)', key: 'unitPrice', width: 14 },
      { header: '金额(元)', key: 'amount', width: 16 },
      { header: '交期', key: 'dueDate', width: 14 },
      { header: '状态', key: 'status', width: 14 },
      { header: '创建时间(北京时间)', key: 'createdAt', width: 22 }
    ];
    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A34' } };
    header.alignment = { vertical: 'middle' };
    header.height = 24;

    for (const row of rows) {
      const added = sheet.addRow({
        orderNo: row.order_no,
        customer: row.customer_name,
        product: row.product_name,
        spec: row.spec,
        quantity: row.quantity,
        unitPrice: Number((row.unit_price_cents / 100).toFixed(2)),
        amount: Number(((row.quantity * row.unit_price_cents) / 100).toFixed(2)),
        dueDate: row.due_date,
        status: ORDER_STATUS_LABELS[row.status],
        createdAt: new Intl.DateTimeFormat('zh-CN', {
          timeZone: 'Asia/Shanghai',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        }).format(new Date(row.created_at))
      });
      added.getCell('unitPrice').numFmt = '#,##0.00';
      added.getCell('amount').numFmt = '#,##0.00';
      added.alignment = { vertical: 'middle' };
    }
    sheet.autoFilter = { from: 'A1', to: 'J1' };
    if (rows.length === 0) {
      sheet.addRow({
        orderNo: '（当前筛选条件下没有订单）',
        customer: '',
        product: '',
        spec: '',
        quantity: '',
        unitPrice: '',
        amount: '',
        dueDate: '',
        status: '',
        createdAt: ''
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `订单列表-${businessDate()}.xlsx`;
    writeAudit(db, {
      requestId: request.id,
      actor: request.auth!.user,
      action: 'EXPORT_ORDERS_XLSX',
      resourceType: 'EXPORT',
      resourceId: 'orders.xlsx',
      result: 'SUCCESS',
      detail: `行数=${rows.length}，条件=${JSON.stringify(query)}`
    });
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', `attachment; filename="orders-${businessDate()}.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    reply.header('Cache-Control', 'private, no-store');
    return reply.send(Buffer.from(buffer));
  });

  app.get('/exports/inventory.xlsx', admin, async (request, reply) => {
    const parts = db.all<{ name: string; spec: string; unit: string; quantity: number; active: number }>(
      `SELECT p.name, p.spec, p.unit, COALESCE(i.quantity, 0) AS quantity, p.active
       FROM parts p LEFT JOIN part_inventory i ON i.part_id = p.id
       ORDER BY p.active DESC, p.name`
    );
    const products = db.all<{ name: string; spec: string; quantity: number }>(
      `SELECT product_name AS name, spec, quantity FROM product_inventory ORDER BY product_name, spec`
    );
    const workbook = new ExcelJS.Workbook();
    workbook.creator = '厂序 FactoryFlow';
    workbook.created = new Date();
    const partSheet = workbook.addWorksheet('配件库存', { views: [{ state: 'frozen', ySplit: 1 }] });
    partSheet.columns = [
      { header: '配件名称', key: 'name', width: 26 },
      { header: '规格', key: 'spec', width: 24 },
      { header: '单位', key: 'unit', width: 10 },
      { header: '库存数量', key: 'quantity', width: 14 },
      { header: '状态', key: 'status', width: 10 }
    ];
    for (const row of parts) {
      partSheet.addRow({ name: row.name, spec: row.spec, unit: row.unit, quantity: row.quantity, status: row.active === 1 ? '启用' : '停用' });
    }
    const productSheet = workbook.addWorksheet('成品库存', { views: [{ state: 'frozen', ySplit: 1 }] });
    productSheet.columns = [
      { header: '成品名称', key: 'name', width: 26 },
      { header: '规格', key: 'spec', width: 24 },
      { header: '库存数量', key: 'quantity', width: 14 }
    ];
    for (const row of products) {
      productSheet.addRow({ name: row.name, spec: row.spec, quantity: row.quantity });
    }
    const buffer = await workbook.xlsx.writeBuffer();
    writeAudit(db, {
      requestId: request.id,
      actor: request.auth!.user,
      action: 'EXPORT_INVENTORY_XLSX',
      resourceType: 'EXPORT',
      resourceId: 'inventory.xlsx',
      result: 'SUCCESS',
      detail: `配件=${parts.length}，成品=${products.length}`
    });
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header(
      'Content-Disposition',
      `attachment; filename="inventory-${businessDate()}.xlsx"; filename*=UTF-8''${encodeURIComponent(`库存台账-${businessDate()}.xlsx`)}`
    );
    reply.header('Cache-Control', 'private, no-store');
    return reply.send(Buffer.from(buffer));
  });

  app.get('/exports/history', admin, async (request, reply) => {
    const rows = db.all<{
      id: string;
      action: string;
      actor_name: string;
      detail: string | null;
      created_at: string;
    }>(
      `SELECT id, action, actor_name, detail, created_at FROM audit_logs
       WHERE action LIKE 'EXPORT_%' ORDER BY created_at DESC LIMIT 50`
    );
    return ok(reply, request, {
      items: rows.map((row) => ({
        id: row.id,
        action: row.action,
        actorName: row.actor_name,
        detail: row.detail,
        createdAt: row.created_at
      }))
    });
  });
}
