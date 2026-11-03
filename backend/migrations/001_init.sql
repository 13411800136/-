-- 厂序 FactoryFlow 初始结构
-- 金额单位：分（INTEGER）；事件时间：UTC ISO8601 文本；交期：北京时间日期 YYYY-MM-DD。

CREATE TABLE departments (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL CHECK (category IN ('PRODUCTION', 'LOGISTICS', 'QC', 'PACKING')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN', 'LOGISTICS', 'PRODUCTION', 'QC', 'PACKING')),
  department_id TEXT REFERENCES departments(id) ON DELETE RESTRICT,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  is_super_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_super_admin IN (0, 1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  session_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (role <> 'PRODUCTION' OR department_id IS NOT NULL)
) STRICT;

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  session_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT
) STRICT;

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL COLLATE NOCASE UNIQUE,
  name TEXT NOT NULL,
  contact TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE suppliers (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL COLLATE NOCASE UNIQUE,
  name TEXT NOT NULL,
  contact TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE parts (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL COLLATE NOCASE UNIQUE,
  name TEXT NOT NULL,
  spec TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '件',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  order_no TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  customer_name TEXT NOT NULL,
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING_PURCHASE'
    CHECK (status IN ('PENDING_PURCHASE', 'PURCHASING', 'IN_PRODUCTION', 'PENDING_QC', 'QC_DONE', 'PACKING', 'SHIPPING', 'COMPLETED')),
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_orders_status_created ON orders(status, created_at DESC, id);
CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_due ON orders(due_date);

CREATE TABLE order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  part_id TEXT REFERENCES parts(id) ON DELETE RESTRICT,
  product_name TEXT NOT NULL,
  spec TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_order_items_order ON order_items(order_id);

CREATE TABLE purchase_orders (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  purchase_no TEXT NOT NULL UNIQUE,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  supplier_name TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE purchase_items (
  id TEXT PRIMARY KEY,
  purchase_order_id TEXT NOT NULL UNIQUE REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  part_id TEXT NOT NULL REFERENCES parts(id) ON DELETE RESTRICT,
  part_name TEXT NOT NULL,
  spec TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE arrival_records (
  id TEXT PRIMARY KEY,
  purchase_item_id TEXT NOT NULL REFERENCES purchase_items(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  operator_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  note TEXT NOT NULL DEFAULT '',
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_arrivals_item ON arrival_records(purchase_item_id, created_at);

CREATE TABLE production_orders (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  order_item_id TEXT NOT NULL REFERENCES order_items(id) ON DELETE RESTRICT,
  department_id TEXT NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  assignee_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  process_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  price_visible INTEGER NOT NULL DEFAULT 0 CHECK (price_visible IN (0, 1)),
  due_date TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_production_orders_order ON production_orders(order_id);
CREATE INDEX idx_production_orders_department ON production_orders(department_id, created_at);

CREATE TABLE production_feedbacks (
  id TEXT PRIMARY KEY,
  production_order_id TEXT NOT NULL REFERENCES production_orders(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  operator_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  note TEXT NOT NULL DEFAULT '',
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_feedbacks_task ON production_feedbacks(production_order_id, created_at);

CREATE TABLE qc_records (
  id TEXT PRIMARY KEY,
  production_order_id TEXT NOT NULL UNIQUE REFERENCES production_orders(id) ON DELETE RESTRICT,
  inspected_qty INTEGER NOT NULL CHECK (inspected_qty > 0),
  qualified_qty INTEGER NOT NULL CHECK (qualified_qty >= 0),
  unqualified_qty INTEGER NOT NULL CHECK (unqualified_qty >= 0),
  inspector_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decision TEXT CHECK (decision IN ('PASS', 'REWORK', 'SCRAP')),
  decided_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
  decided_at TEXT,
  created_at TEXT NOT NULL,
  CHECK (qualified_qty + unqualified_qty = inspected_qty),
  CHECK (decision IS NULL OR (decided_by IS NOT NULL AND decided_at IS NOT NULL))
) STRICT;

CREATE TABLE packing_records (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  order_item_id TEXT NOT NULL REFERENCES order_items(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  operator_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  note TEXT NOT NULL DEFAULT '',
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_packing_order ON packing_records(order_id, order_item_id);

CREATE TABLE shipment_records (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  order_item_id TEXT NOT NULL REFERENCES order_items(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  operator_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  carrier TEXT NOT NULL DEFAULT '',
  tracking_no TEXT NOT NULL DEFAULT '',
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_shipment_order ON shipment_records(order_id, order_item_id);

CREATE TABLE part_inventory (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL UNIQUE REFERENCES parts(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE product_inventory (
  id TEXT PRIMARY KEY,
  product_key TEXT NOT NULL UNIQUE,
  product_name TEXT NOT NULL,
  spec TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE inventory_logs (
  id TEXT PRIMARY KEY,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('PART', 'PRODUCT')),
  resource_id TEXT NOT NULL,
  before_qty INTEGER NOT NULL,
  delta INTEGER NOT NULL,
  after_qty INTEGER NOT NULL,
  reason TEXT NOT NULL,
  operator_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  source_order_id TEXT REFERENCES orders(id) ON DELETE RESTRICT,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (before_qty + delta = after_qty),
  CHECK (after_qty >= 0)
) STRICT;

CREATE INDEX idx_inventory_logs_resource ON inventory_logs(resource_type, resource_id, created_at);

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL UNIQUE,
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  sha256 TEXT NOT NULL,
  uploaded_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_attachments_order ON attachments(order_id, created_at);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  read_at TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_notifications_recipient ON notifications(recipient_id, read_at, created_at DESC);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  actor_id TEXT,
  actor_name TEXT NOT NULL DEFAULT '未认证',
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  result TEXT NOT NULL CHECK (result IN ('SUCCESS', 'FAILURE')),
  error_code TEXT,
  before_json TEXT,
  after_json TEXT,
  detail TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_resource ON audit_logs(resource_type, resource_id, created_at DESC);

CREATE TABLE tablet_exceptions (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  production_order_id TEXT REFERENCES production_orders(id) ON DELETE RESTRICT,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED')),
  reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_exceptions_order ON tablet_exceptions(order_id, created_at DESC);

CREATE TABLE idempotency_requests (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation TEXT NOT NULL,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS', 'COMPLETED')),
  response_status INTEGER,
  response_json TEXT,
  business_id TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  UNIQUE (actor_id, operation, key)
) STRICT;

CREATE INDEX idx_idempotency_expiry ON idempotency_requests(expires_at);

CREATE TABLE order_timeline (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  actor_name TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  quantity INTEGER,
  payload_json TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_timeline_order ON order_timeline(order_id, created_at, id);

CREATE TABLE counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL
) STRICT;
