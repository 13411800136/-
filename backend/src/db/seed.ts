import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppDatabase } from './database.js';
import { migrate, assertSchemaReady } from './migrate.js';
import { loadConfig } from '../config.js';
import { hashPassword, newId } from '../common/crypto.js';
import { businessDate, addDays } from '../common/time.js';

export interface SeedOptions {
  includeDemoOrders?: boolean;
  demoPassword?: string;
  authPepper?: string;
}

const DEMO_PASSWORD = 'Demo@2026';

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

function dateFromNow(days: number): string {
  return addDays(businessDate(), days);
}

interface MasterSpec {
  departments: Array<{ code: string; name: string; category: string }>;
  users: Array<{
    username: string;
    displayName: string;
    role: string;
    departmentCode: string | null;
    superAdmin?: boolean;
  }>;
}

const MASTER: MasterSpec = {
  departments: [
    { code: 'PROD-A', name: '生产一部', category: 'PRODUCTION' },
    { code: 'PROD-B', name: '生产二部', category: 'PRODUCTION' },
    { code: 'LOG', name: '物流部', category: 'LOGISTICS' },
    { code: 'QC', name: '品控部', category: 'QC' },
    { code: 'PACK', name: '包装部', category: 'PACKING' }
  ],
  users: [
    { username: 'admin', displayName: '系统管理员', role: 'ADMIN', departmentCode: null, superAdmin: true },
    { username: 'logistics', displayName: '物流专员 林航', role: 'LOGISTICS', departmentCode: 'LOG' },
    { username: 'prod', displayName: '生产一组 周成', role: 'PRODUCTION', departmentCode: 'PROD-A' },
    { username: 'prod2', displayName: '生产二组 赵磊', role: 'PRODUCTION', departmentCode: 'PROD-B' },
    { username: 'qc', displayName: '品控员 陈谨', role: 'QC', departmentCode: 'QC' },
    { username: 'pack', displayName: '包装员 吴桐', role: 'PACKING', departmentCode: 'PACK' }
  ]
};

function seedMaster(db: AppDatabase, password: string, authPepper: string): void {
  const now = new Date().toISOString();
  for (const department of MASTER.departments) {
    const existing = db.get<{ id: string }>('SELECT id FROM departments WHERE code = ?', department.code);
    if (!existing) {
      db.run(
        `INSERT INTO departments(id, code, name, category, active, created_at)
         VALUES (?, ?, ?, ?, 1, ?)`,
        newId(),
        department.code,
        department.name,
        department.category,
        now
      );
    }
  }
  for (const user of MASTER.users) {
    const department = user.departmentCode
      ? db.get<{ id: string }>('SELECT id FROM departments WHERE code = ?', user.departmentCode)
      : undefined;
    if (user.departmentCode && !department) throw new Error(`种子部门不存在：${user.departmentCode}`);
    const existing = db.get<{ id: string }>('SELECT id FROM users WHERE username = ?', user.username);
    if (existing) {
      db.run(
        `UPDATE users SET display_name = ?, role = ?, department_id = ?, active = 1, updated_at = ?
         WHERE id = ?`,
        user.displayName,
        user.role,
        department?.id ?? null,
        now,
        existing.id
      );
      continue;
    }
    const { hash, salt } = hashPassword(password, authPepper);
    db.run(
      `INSERT INTO users(id, username, display_name, role, department_id, password_hash, password_salt,
                         is_super_admin, active, session_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`,
      newId(),
      user.username,
      user.displayName,
      user.role,
      department?.id ?? null,
      hash,
      salt,
      user.superAdmin ? 1 : 0,
      now,
      now
    );
  }

  const customers = [
    { code: 'CUS-001', name: '华东精工（演示）', contact: '王工 / 021-0000-0001' },
    { code: 'CUS-002', name: '苏州蓝海装备（演示）', contact: '李工 / 0512-0000-0002' }
  ];
  for (const customer of customers) {
    db.run(
      `INSERT INTO customers(id, code, name, contact, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?) ON CONFLICT(code) DO NOTHING`,
      newId(),
      customer.code,
      customer.name,
      customer.contact,
      now,
      now
    );
  }

  const suppliers = [
    { code: 'SUP-001', name: '恒信五金（演示）', contact: '周一 / 021-0000-0101' },
    { code: 'SUP-002', name: '瑞通型材（演示）', contact: '孙工 / 0512-0000-0102' }
  ];
  for (const supplier of suppliers) {
    db.run(
      `INSERT INTO suppliers(id, code, name, contact, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?) ON CONFLICT(code) DO NOTHING`,
      newId(),
      supplier.code,
      supplier.name,
      supplier.contact,
      now,
      now
    );
  }

  const parts = [
    { code: 'PART-001', name: '铝合金外壳', spec: 'AL-6061 / 120×80mm', unit: '件' },
    { code: 'PART-002', name: '不锈钢支架', spec: 'SUS-304 / 3mm', unit: '件' },
    { code: 'PART-003', name: '控制面板组件', spec: 'PCB-A2 / 黑色', unit: '套' }
  ];
  for (const part of parts) {
    db.run(
      `INSERT INTO parts(id, code, name, spec, unit, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?) ON CONFLICT(code) DO NOTHING`,
      newId(),
      part.code,
      part.name,
      part.spec,
      part.unit,
      now,
      now
    );
  }
}

function userId(db: AppDatabase, username: string): string {
  const row = db.get<{ id: string }>('SELECT id FROM users WHERE username = ?', username);
  if (!row) throw new Error(`种子用户不存在：${username}`);
  return row.id;
}

function departmentId(db: AppDatabase, code: string): string {
  const row = db.get<{ id: string }>('SELECT id FROM departments WHERE code = ?', code);
  if (!row) throw new Error(`种子部门不存在：${code}`);
  return row.id;
}

function addTimeline(
  db: AppDatabase,
  input: {
    orderId: string;
    eventType: string;
    actorUsername: string;
    actorName: string;
    resourceType: string;
    resourceId: string;
    quantity?: number;
    at: string;
    payload?: unknown;
  }
): void {
  db.run(
    `INSERT INTO order_timeline(id, order_id, event_type, actor_id, actor_name, resource_type,
                                resource_id, quantity, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    newId(),
    input.orderId,
    input.eventType,
    userId(db, input.actorUsername),
    input.actorName,
    input.resourceType,
    input.resourceId,
    input.quantity ?? null,
    input.payload === undefined ? null : JSON.stringify(input.payload),
    input.at
  );
}

function seedDemoOrders(db: AppDatabase): void {
  const existing = db.get<{ id: string }>("SELECT id FROM orders WHERE order_no = 'SO-DEMO-0001'");
  if (existing) return;

  const admin = userId(db, 'admin');
  const logistics = userId(db, 'logistics');
  const prod = userId(db, 'prod');
  const qc = userId(db, 'qc');
  const pack = userId(db, 'pack');
  const customer = db.get<{ id: string; name: string }>(
    "SELECT id, name FROM customers WHERE code = 'CUS-001'"
  );
  const customer2 = db.get<{ id: string; name: string }>(
    "SELECT id, name FROM customers WHERE code = 'CUS-002'"
  );
  const supplier = db.get<{ id: string; name: string }>(
    "SELECT id, name FROM suppliers WHERE code = 'SUP-001'"
  );
  const part = db.get<{ id: string; name: string; spec: string }>(
    "SELECT id, name, spec FROM parts WHERE code = 'PART-001'"
  );
  const part2 = db.get<{ id: string; name: string; spec: string }>(
    "SELECT id, name, spec FROM parts WHERE code = 'PART-003'"
  );
  if (!customer || !customer2 || !supplier || !part || !part2) {
    throw new Error('演示订单依赖的基础数据缺失');
  }
  const deptA = departmentId(db, 'PROD-A');

  // 订单 1：完整闭环，金额与 A22 示例一致（销售 1250，采购 252，生产 120，利润 878）。
  const order1 = 'demo-order-0001';
  db.run(
    `INSERT INTO orders(id, order_no, customer_id, customer_name, due_date, status, note, created_by, created_at, updated_at)
     VALUES (?, 'SO-DEMO-0001', ?, ?, ?, 'COMPLETED', '演示用完整闭环订单（合成数据）', ?, ?, ?)`,
    order1,
    customer.id,
    customer.name,
    dateFromNow(4),
    admin,
    daysFromNow(-6),
    daysFromNow(-1)
  );
  const item1 = 'demo-item-0001';
  db.run(
    `INSERT INTO order_items(id, order_id, part_id, product_name, spec, quantity, unit_price_cents, created_at)
     VALUES (?, ?, ?, '精密传动箱体', 'TB-220 / 阳极氧化', 100, 1250, ?)`,
    item1,
    order1,
    part.id,
    daysFromNow(-6)
  );
  addTimeline(db, {
    orderId: order1,
    eventType: 'ORDER_CREATED',
    actorUsername: 'admin',
    actorName: '系统管理员',
    resourceType: 'ORDER',
    resourceId: order1,
    quantity: 100,
    at: daysFromNow(-6),
    payload: { orderNo: 'SO-DEMO-0001' }
  });
  const po1 = 'demo-po-0001';
  db.run(
    `INSERT INTO purchase_orders(id, order_id, purchase_no, supplier_id, supplier_name, created_by, created_at)
     VALUES (?, ?, 'PO-DEMO-0001', ?, ?, ?, ?)`,
    po1,
    order1,
    supplier.id,
    supplier.name,
    admin,
    daysFromNow(-6)
  );
  const poi1 = 'demo-poi-0001';
  db.run(
    `INSERT INTO purchase_items(id, purchase_order_id, part_id, part_name, spec, quantity, unit_price_cents, created_at)
     VALUES (?, ?, ?, ?, ?, 120, 210, ?)`,
    poi1,
    po1,
    part.id,
    part.name,
    part.spec,
    daysFromNow(-6)
  );
  addTimeline(db, {
    orderId: order1,
    eventType: 'PURCHASE_CREATED',
    actorUsername: 'admin',
    actorName: '系统管理员',
    resourceType: 'PURCHASE_ORDER',
    resourceId: po1,
    at: daysFromNow(-6)
  });
  const arrival1 = 'demo-arrival-0001';
  db.run(
    `INSERT INTO arrival_records(id, purchase_item_id, quantity, operator_id, note, request_id, created_at)
     VALUES (?, ?, 120, ?, '演示到货：全部到齐', 'demo-request-arrival-1', ?)`,
    arrival1,
    poi1,
    logistics,
    daysFromNow(-5)
  );
  addTimeline(db, {
    orderId: order1,
    eventType: 'ARRIVAL_RECORDED',
    actorUsername: 'logistics',
    actorName: '物流专员 林航',
    resourceType: 'ARRIVAL',
    resourceId: arrival1,
    quantity: 120,
    at: daysFromNow(-5)
  });
  const task1 = 'demo-task-0001';
  db.run(
    `INSERT INTO production_orders(id, order_id, order_item_id, department_id, assignee_id, process_name,
                                   quantity, unit_price_cents, price_visible, due_date, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, '精加工与装配', 100, 120, 1, ?, ?, ?)`,
    task1,
    order1,
    item1,
    deptA,
    prod,
    dateFromNow(2),
    admin,
    daysFromNow(-5)
  );
  addTimeline(db, {
    orderId: order1,
    eventType: 'PRODUCTION_DISPATCHED',
    actorUsername: 'admin',
    actorName: '系统管理员',
    resourceType: 'PRODUCTION_ORDER',
    resourceId: task1,
    quantity: 100,
    at: daysFromNow(-5)
  });
  const feedback1 = 'demo-feedback-0001';
  db.run(
    `INSERT INTO production_feedbacks(id, production_order_id, quantity, operator_id, note, request_id, created_at)
     VALUES (?, ?, 100, ?, '演示完成 100 件', 'demo-request-feedback-1', ?)`,
    feedback1,
    task1,
    prod,
    daysFromNow(-3)
  );
  addTimeline(db, {
    orderId: order1,
    eventType: 'PRODUCTION_FEEDBACK',
    actorUsername: 'prod',
    actorName: '生产一组 周成',
    resourceType: 'PRODUCTION_FEEDBACK',
    resourceId: feedback1,
    quantity: 100,
    at: daysFromNow(-3)
  });
  addTimeline(db, {
    orderId: order1,
    eventType: 'QC_DISPATCHED',
    actorUsername: 'admin',
    actorName: '系统管理员',
    resourceType: 'ORDER',
    resourceId: order1,
    at: daysFromNow(-3)
  });
  const qc1 = 'demo-qc-0001';
  db.run(
    `INSERT INTO qc_records(id, production_order_id, inspected_qty, qualified_qty, unqualified_qty,
                            inspector_id, decision, decided_by, decided_at, created_at)
     VALUES (?, ?, 100, 100, 0, ?, 'PASS', ?, ?, ?)`,
    qc1,
    task1,
    qc,
    admin,
    daysFromNow(-2),
    daysFromNow(-2)
  );
  addTimeline(db, {
    orderId: order1,
    eventType: 'QC_RECORDED',
    actorUsername: 'qc',
    actorName: '品控员 陈谨',
    resourceType: 'QC_RECORD',
    resourceId: qc1,
    quantity: 100,
    at: daysFromNow(-2),
    payload: { inspected: 100, qualified: 100, unqualified: 0 }
  });
  addTimeline(db, {
    orderId: order1,
    eventType: 'QC_PASSED',
    actorUsername: 'admin',
    actorName: '系统管理员',
    resourceType: 'QC_RECORD',
    resourceId: qc1,
    quantity: 100,
    at: daysFromNow(-2)
  });
  addTimeline(db, {
    orderId: order1,
    eventType: 'PACKING_DISPATCHED',
    actorUsername: 'admin',
    actorName: '系统管理员',
    resourceType: 'ORDER',
    resourceId: order1,
    at: daysFromNow(-2)
  });
  const packing1 = 'demo-packing-0001';
  db.run(
    `INSERT INTO packing_records(id, order_id, order_item_id, quantity, operator_id, note, request_id, created_at)
     VALUES (?, ?, ?, 100, ?, '演示整批包装', 'demo-request-packing-1', ?)`,
    packing1,
    order1,
    item1,
    pack,
    daysFromNow(-1)
  );
  addTimeline(db, {
    orderId: order1,
    eventType: 'PACKING_RECORDED',
    actorUsername: 'pack',
    actorName: '包装员 吴桐',
    resourceType: 'PACKING',
    resourceId: packing1,
    quantity: 100,
    at: daysFromNow(-1)
  });
  addTimeline(db, {
    orderId: order1,
    eventType: 'SHIPMENT_TRIGGERED',
    actorUsername: 'admin',
    actorName: '系统管理员',
    resourceType: 'ORDER',
    resourceId: order1,
    at: daysFromNow(-1)
  });
  const shipment1 = 'demo-shipment-0001';
  db.run(
    `INSERT INTO shipment_records(id, order_id, order_item_id, quantity, operator_id, carrier, tracking_no, request_id, created_at)
     VALUES (?, ?, ?, 100, ?, '顺程物流（演示）', 'DEMO-TRK-0001', 'demo-request-shipment-1', ?)`,
    shipment1,
    order1,
    item1,
    logistics,
    daysFromNow(-1)
  );
  addTimeline(db, {
    orderId: order1,
    eventType: 'SHIPMENT_RECORDED',
    actorUsername: 'logistics',
    actorName: '物流专员 林航',
    resourceType: 'SHIPMENT',
    resourceId: shipment1,
    quantity: 100,
    at: daysFromNow(-1)
  });
  addTimeline(db, {
    orderId: order1,
    eventType: 'ORDER_COMPLETED',
    actorUsername: 'admin',
    actorName: '系统管理员',
    resourceType: 'ORDER',
    resourceId: order1,
    quantity: 100,
    at: daysFromNow(-1)
  });
  db.run(
    `INSERT INTO notifications(id, recipient_id, event_type, title, body, resource_type, resource_id,
                              dedupe_key, read_at, created_at)
     VALUES (?, ?, 'ORDER_COMPLETED', '演示订单已完成', 'SO-DEMO-0001 已完成交付，可在订单详情查看完整时间线。',
             'ORDER', ?, 'demo:completed:0001', NULL, ?)
     ON CONFLICT(dedupe_key) DO NOTHING`,
    newId(),
    admin,
    order1,
    daysFromNow(-1)
  );

  // 订单 2：待采购
  const order2 = 'demo-order-0002';
  db.run(
    `INSERT INTO orders(id, order_no, customer_id, customer_name, due_date, status, note, created_by, created_at, updated_at)
     VALUES (?, 'SO-DEMO-0002', ?, ?, ?, 'PENDING_PURCHASE', '等待采购（合成数据）', ?, ?, ?)`,
    order2,
    customer2.id,
    customer2.name,
    dateFromNow(14),
    admin,
    daysFromNow(-2),
    daysFromNow(-2)
  );
  const item2 = 'demo-item-0002';
  db.run(
    `INSERT INTO order_items(id, order_id, part_id, product_name, spec, quantity, unit_price_cents, created_at)
     VALUES (?, ?, ?, '机架横梁组件', 'RB-80 / 喷砂', 60, 880, ?)`,
    item2,
    order2,
    part2.id,
    daysFromNow(-2)
  );
  addTimeline(db, {
    orderId: order2,
    eventType: 'ORDER_CREATED',
    actorUsername: 'admin',
    actorName: '系统管理员',
    resourceType: 'ORDER',
    resourceId: order2,
    quantity: 60,
    at: daysFromNow(-2),
    payload: { orderNo: 'SO-DEMO-0002' }
  });

  // 订单 3：采购中（已建采购单，尚未到货）
  const order3 = 'demo-order-0003';
  db.run(
    `INSERT INTO orders(id, order_no, customer_id, customer_name, due_date, status, note, created_by, created_at, updated_at)
     VALUES (?, 'SO-DEMO-0003', ?, ?, ?, 'PURCHASING', '采购单已建，等待到货（合成数据）', ?, ?, ?)`,
    order3,
    customer2.id,
    customer2.name,
    dateFromNow(9),
    admin,
    daysFromNow(-4),
    daysFromNow(-4)
  );
  const item3 = 'demo-item-0003';
  db.run(
    `INSERT INTO order_items(id, order_id, part_id, product_name, spec, quantity, unit_price_cents, created_at)
     VALUES (?, ?, ?, '输送线侧板', 'SP-46 / 折弯', 80, 500, ?)`,
    item3,
    order3,
    part.id,
    daysFromNow(-4)
  );
  const po3 = 'demo-po-0003';
  db.run(
    `INSERT INTO purchase_orders(id, order_id, purchase_no, supplier_id, supplier_name, created_by, created_at)
     VALUES (?, ?, 'PO-DEMO-0003', ?, ?, ?, ?)`,
    po3,
    order3,
    supplier.id,
    supplier.name,
    admin,
    daysFromNow(-4)
  );
  db.run(
    `INSERT INTO purchase_items(id, purchase_order_id, part_id, part_name, spec, quantity, unit_price_cents, created_at)
     VALUES (?, ?, ?, ?, ?, 80, 320, ?)`,
    'demo-poi-0003',
    po3,
    part.id,
    part.name,
    part.spec,
    daysFromNow(-4)
  );
  addTimeline(db, {
    orderId: order3,
    eventType: 'ORDER_CREATED',
    actorUsername: 'admin',
    actorName: '系统管理员',
    resourceType: 'ORDER',
    resourceId: order3,
    quantity: 80,
    at: daysFromNow(-4),
    payload: { orderNo: 'SO-DEMO-0003' }
  });
  addTimeline(db, {
    orderId: order3,
    eventType: 'PURCHASE_CREATED',
    actorUsername: 'admin',
    actorName: '系统管理员',
    resourceType: 'PURCHASE_ORDER',
    resourceId: po3,
    at: daysFromNow(-4)
  });

  // 订单 4：生产中（到货齐套，已下发生产，等待反馈）
  const order4 = 'demo-order-0004';
  db.run(
    `INSERT INTO orders(id, order_no, customer_id, customer_name, due_date, status, note, created_by, created_at, updated_at)
     VALUES (?, 'SO-DEMO-0004', ?, ?, ?, 'IN_PRODUCTION', '生产一部处理中（合成数据）', ?, ?, ?)`,
    order4,
    customer.id,
    customer.name,
    dateFromNow(6),
    admin,
    daysFromNow(-3),
    daysFromNow(-1)
  );
  const item4 = 'demo-item-0004';
  db.run(
    `INSERT INTO order_items(id, order_id, part_id, product_name, spec, quantity, unit_price_cents, created_at)
     VALUES (?, ?, ?, '导轨安装座', 'GM-15 / 发黑', 40, 990, ?)`,
    item4,
    order4,
    part.id,
    daysFromNow(-3)
  );
  const po4 = 'demo-po-0004';
  db.run(
    `INSERT INTO purchase_orders(id, order_id, purchase_no, supplier_id, supplier_name, created_by, created_at)
     VALUES (?, ?, 'PO-DEMO-0004', ?, ?, ?, ?)`,
    po4,
    order4,
    supplier.id,
    supplier.name,
    admin,
    daysFromNow(-3)
  );
  const poi4 = 'demo-poi-0004';
  db.run(
    `INSERT INTO purchase_items(id, purchase_order_id, part_id, part_name, spec, quantity, unit_price_cents, created_at)
     VALUES (?, ?, ?, ?, ?, 40, 250, ?)`,
    poi4,
    po4,
    part.id,
    part.name,
    part.spec,
    daysFromNow(-3)
  );
  db.run(
    `INSERT INTO arrival_records(id, purchase_item_id, quantity, operator_id, note, request_id, created_at)
     VALUES (?, ?, 40, ?, '到货 40 件', 'demo-request-arrival-4', ?)`,
    'demo-arrival-0004',
    poi4,
    logistics,
    daysFromNow(-2)
  );
  const task4 = 'demo-task-0004';
  db.run(
    `INSERT INTO production_orders(id, order_id, order_item_id, department_id, assignee_id, process_name,
                                   quantity, unit_price_cents, price_visible, due_date, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, '数控精加工', 40, 80, 0, ?, ?, ?)`,
    task4,
    order4,
    item4,
    deptA,
    prod,
    dateFromNow(4),
    admin,
    daysFromNow(-1)
  );
  for (const event of [
    { type: 'ORDER_CREATED', actor: 'admin', name: '系统管理员', resource: 'ORDER', id: order4, qty: 40, at: daysFromNow(-3) },
    { type: 'PURCHASE_CREATED', actor: 'admin', name: '系统管理员', resource: 'PURCHASE_ORDER', id: po4, qty: null, at: daysFromNow(-3) },
    { type: 'ARRIVAL_RECORDED', actor: 'logistics', name: '物流专员 林航', resource: 'ARRIVAL', id: 'demo-arrival-0004', qty: 40, at: daysFromNow(-2) },
    { type: 'PRODUCTION_DISPATCHED', actor: 'admin', name: '系统管理员', resource: 'PRODUCTION_ORDER', id: task4, qty: 40, at: daysFromNow(-1) }
  ] as const) {
    addTimeline(db, {
      orderId: order4,
      eventType: event.type,
      actorUsername: event.actor,
      actorName: event.name,
      resourceType: event.resource,
      resourceId: event.id,
      ...(event.qty === null ? {} : { quantity: event.qty }),
      at: event.at
    });
  }
}

export function seedDatabase(db: AppDatabase, options: SeedOptions = {}): void {
  assertSchemaReady(db);
  const password = options.demoPassword ?? DEMO_PASSWORD;
  const authPepper = options.authPepper ?? loadConfig().authPepper;
  db.tx(() => {
    seedMaster(db, password, authPepper);
    if (options.includeDemoOrders !== false) seedDemoOrders(db);
  });
}

function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  return resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  const confirmed = process.argv.includes('--yes') || process.env.SEED_ALLOW === 'yes';
  if (!confirmed) {
    console.error('受控初始化需要显式确认：npm run seed -- --yes');
    console.error('该命令只写入合成演示数据；不会清空已有业务数据。');
    process.exit(1);
  }
  const config = loadConfig();
  const db = new AppDatabase(config.databasePath);
  try {
    // 允许在全新数据库上直接执行 setup。
    migrate(db);
    seedDatabase(db, {
      includeDemoOrders: !process.argv.includes('--no-orders'),
      authPepper: config.authPepper
    });
    console.log('合成演示数据已就绪（重复执行不会清空或重复插入订单）。');
    console.log('演示账号：admin / logistics / prod / prod2 / qc / pack；密码见 README。');
  } finally {
    db.close();
  }
}
