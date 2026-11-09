# 数据字典：厂序 FactoryFlow

数据库：SQLite 3（Node `node:sqlite`），文件 `data/factory.db`，WAL。
迁移：`backend/migrations/001_init.sql`、`002_internal_messages.sql`、`003_orders_customers_batch.sql`（`schema_migrations` 记录校验和）。
类型：金额一律 `INTEGER` 分；事件时间 `TEXT` UTC ISO8601；交期 `TEXT` `YYYY-MM-DD`（北京时间日期语义）；布尔 `INTEGER 0/1`。
约束：核心表使用 `STRICT`；业务数量 `CHECK > 0`；库存 `CHECK >= 0`；外键 `ON`（RESTRICT/CASCADE 见表）；时间线/审计只追加。

## 1. 身份与组织

| 表 | 关键字段 | 约束/索引 | 说明 |
| --- | --- | --- | --- |
| `departments` | `id`、`code`、`name`、`category`、`active`、`created_at` | `code UNIQUE`、`name UNIQUE`、`category CHECK` | 类别：PRODUCTION/LOGISTICS/QC/PACKING；停用不删除 |
| `users` | `id`、`username`、`display_name`、`role`、`department_id`、`password_hash`、`password_salt`、`is_super_admin`、`active`、`session_version` | `username COLLATE NOCASE UNIQUE`；`role CHECK`；生产角色必须有部门 | 员工账号；不存明文密码；停用/改密递增 session_version |
| `sessions` | `id`、`user_id`、`token_hash`、`session_version`、`expires_at`、`last_seen_at`、`revoked_at` | `token_hash UNIQUE`；用户/过期索引；FK CASCADE | 只存令牌 SHA-256；撤销/过期即失效 |

## 2. 主数据

| 表 | 关键字段 | 约束/索引 | 说明 |
| --- | --- | --- | --- |
| `customers` | `id`、`code`、`name`、`contact`、`tax_no`、`address`、`active`、`created_at`、`updated_at` | `code COLLATE NOCASE UNIQUE`；税号/地址默认空串 | 订单保存客户名快照；税号地址选填 |
| `suppliers` | 同上 | `code UNIQUE` | 采购保存供应商名快照 |
| `parts` | `id`、`code`、`name`、`spec`、`unit`、`active`、时间 | `code UNIQUE` | 采购/库存引用；停用不物理删除 |

## 3. 订单与采购

| 表 | 关键字段 | 约束/索引 | 说明 |
| --- | --- | --- | --- |
| `orders` | `id`、`order_no`、`customer_id`、`customer_name`、`due_date`、`status`、`note`、`created_by`、`created_at`、`updated_at`、`cancelled_at`、`cancelled_by`、`cancel_reason` | `order_no UNIQUE`；`status CHECK(8 种)`；`(status,created_at)`、客户、交期、`cancelled_at` 索引 | 主键 UUID 与展示号分离；客户名快照；CANCELLED 为派生有效状态 |
| `order_items` | `id`、`order_id`、`part_id`、`product_name`、`spec`、`quantity`、`unit_price_cents`、`created_at` | FK order；`quantity>0`；`unit_price_cents>=0` | M 单明细；产品名/价快照 |
| `purchase_orders` | `id`、`order_id`、`purchase_no`、`supplier_id`、`supplier_name`、`created_by`、`created_at` | `order_id UNIQUE`（一单一采购单）；`purchase_no UNIQUE` | 供应商快照 |
| `purchase_items` | `id`、`purchase_order_id`、`part_id`、`part_name`、`spec`、`quantity`、`unit_price_cents`、`created_at` | `purchase_order_id UNIQUE`（M 单配件）；数量/价格 CHECK | 采购价快照 |
| `arrival_records` | `id`、`purchase_item_id`、`quantity`、`operator_id`、`note`、`request_id`、`created_at` | FK；`quantity>0`；`(purchase_item_id,created_at)` | 只追加；累计由 SUM 得出 |

## 4. 生产、质检、交付

| 表 | 关键字段 | 约束/索引 | 说明 |
| --- | --- | --- | --- |
| `production_orders` | `id`、`order_id`、`order_item_id`、`department_id`、`assignee_id`、`process_name`、`quantity`、`unit_price_cents`、`price_visible`、`due_date`、`created_by`、`created_at` | FK；数量/价格 CHECK；部门/订单索引 | 部门归属用于现场隔离 |
| `production_feedbacks` | `id`、`production_order_id`、`quantity`、`operator_id`、`note`、`request_id`、`created_at` | FK；`quantity>0` | 可多次累计，不得超过任务量（服务层） |
| `qc_records` | `id`、`production_order_id`、`inspected_qty`、`qualified_qty`、`unqualified_qty`、`inspector_id`、`decision`、`decided_by`、`decided_at`、`created_at` | `production_order_id UNIQUE`；`qualified+unqualified=inspected`；`decision CHECK` | 品控录入与管理员决策分离 |
| `packing_records` | `id`、`order_id`、`order_item_id`、`quantity`、`operator_id`、`note`、`request_id`、`created_at` | FK；`quantity>0`；订单/明细索引 | 可包装量 = 已放行 − 已包装 |
| `shipment_records` | `id`、`order_id`、`order_item_id`、`quantity`、`operator_id`、`carrier`、`tracking_no`、`request_id`、`created_at` | FK；`quantity>0`；订单/明细索引 | 可发货量 = min(已包装−已发, 应交−已发) |

## 5. 库存

| 表 | 关键字段 | 约束/索引 | 说明 |
| --- | --- | --- | --- |
| `part_inventory` | `id`、`part_id`、`quantity`、`version`、`updated_at` | `part_id UNIQUE`；`quantity>=0` | 首次创建必须为正；条件更新 |
| `product_inventory` | `id`、`product_key`、`product_name`、`spec`、`quantity`、`version`、`updated_at` | `product_key UNIQUE`；`quantity>=0` | `product_key=规范化(名称)|规范化(规格)` |
| `inventory_logs` | `id`、`resource_type`、`resource_id`、`before_qty`、`delta`、`after_qty`、`reason`、`operator_id`、`source_order_id`、`request_id`、`created_at` | `before+delta=after`；`after>=0`；资源索引 | 只追加，不更新/删除 |

## 6. 附件、通知、审计、异常

| 表 | 关键字段 | 约束/索引 | 说明 |
| --- | --- | --- | --- |
| `attachments` | `id`、`order_id`、`original_name`、`stored_name`、`mime`、`size_bytes`、`sha256`、`uploaded_by`、`created_at` | `stored_name UNIQUE`；`size>0`；订单索引 | 仅 PDF；物理文件在 `uploadDir` |
| `notifications` | `id`、`recipient_id`、`event_type`、`title`、`body`、`resource_type`、`resource_id`、`dedupe_key`、`read_at`、`created_at` | `dedupe_key UNIQUE`；接收人/未读索引 | 事件去重；已读隔离 |
| `audit_logs` | `id`、`request_id`、`actor_id`、`actor_name`、`action`、`resource_type`、`resource_id`、`result`、`error_code`、`before_json`、`after_json`、`detail`、`created_at` | `result CHECK`；时间/资源索引 | 只追加；写入前脱敏；管理员可检索 |
| `tablet_exceptions` | `id`、`order_id`、`production_order_id`、`category`、`description`、`status`、`reporter_id`、`created_at` | FK；`status CHECK('OPEN','RESOLVED')` | M 上报/查看；处理状态 F 未启用 |
| `internal_messages` | `id`、`sender_id`、`recipient_id`、`order_id`、`body`、`read_at`、`created_at` | `sender<>recipient`；`body` 2-1000；收件人/发件人索引 | 现场与管理员/其他职务沟通；只追加，不删除 |
| `order_timeline` | `id`、`order_id`、`event_type`、`actor_id`、`actor_name`、`resource_type`、`resource_id`、`quantity`、`payload_json`、`created_at` | FK；`(order_id,created_at,id)` | 业务时间线；稳定事件枚举 |
| `idempotency_requests` | `id`、`actor_id`、`operation`、`key`、`request_hash`、`status`、`response_status`、`response_json`、`business_id`、`created_at`、`expires_at` | `UNIQUE(actor_id,operation,key)`；过期索引 | 请求意图绑定与结果回放 |
| `counters` | `name`、`value` | `name PK` | 订单号/采购号并发安全递增 |
| `schema_migrations` | `version`、`checksum`、`applied_at` | `version PK` | 迁移校验；禁止改写已应用迁移 |

## 7. 关系与删除策略

```text
customers 1─n orders 1─n order_items
orders 1─1 purchase_orders 1─1 purchase_items 1─n arrival_records
orders 1─n production_orders 1─n production_feedbacks
production_orders 1─1 qc_records
orders 1─n packing_records / shipment_records
orders 1─n attachments / order_timeline / tablet_exceptions
users 1─n sessions / notifications / audit(actor) / 业务操作者
users 1─n internal_messages（sender / recipient）
orders 1─n internal_messages（可选关联）
parts 1─1 part_inventory 1─n inventory_logs
product_inventory 1─n inventory_logs
```

- 业务记录不物理删除：客户/供应商/配件/员工停用；订单/到货/反馈/质检/包装/发货/审计/时间线/流水只追加。
- `sessions` 随用户删除 CASCADE；`notifications` 随接收人删除 CASCADE；其他业务引用 `RESTRICT`，防止误删历史。
- 修改基础数据不会回写历史快照字段（订单客户名、采购供应商名/配件名、产品名/价格）。

## 8. 索引与查询路径

- 订单列表：`(status, created_at DESC, id)`、客户、交期；分页稳定排序。
- 到货/反馈/包装/发货：按父资源 + 时间索引，累计 SUM。
- 库存：`part_id`/`product_key` 唯一；流水按资源 + 时间。
- 通知：接收人 + 未读 + 时间；去重键唯一。
- 审计：时间、资源 + 时间；管理员筛选。
- 时间线：订单 + 时间 + id。

## 9. 迁移与恢复

- 结构变更必须新增 `NNN_*.sql`，禁止改历史迁移；迁移在事务内执行并记录 checksum。
- 备份用 `VACUUM INTO` + 附件复制 + manifest（SHA-256）；恢复校验 `integrity_check`、行数与附件哈希。
- 运行数据库/附件/备份不进入源码包；`.env`、`data/`、`backups/` 均已忽略。
