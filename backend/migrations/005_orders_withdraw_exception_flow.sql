-- 005: 订单撤回/删除，现场异常处理流程
ALTER TABLE orders ADD COLUMN withdrawn_at TEXT;
ALTER TABLE orders ADD COLUMN withdraw_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN deleted_at TEXT;

ALTER TABLE tablet_exceptions ADD COLUMN acknowledged_at TEXT;
ALTER TABLE tablet_exceptions ADD COLUMN acknowledged_by TEXT REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE tablet_exceptions ADD COLUMN resolved_at TEXT;
ALTER TABLE tablet_exceptions ADD COLUMN resolved_by TEXT REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE tablet_exceptions ADD COLUMN resolution_note TEXT NOT NULL DEFAULT '';

CREATE INDEX idx_orders_deleted ON orders(deleted_at);
CREATE INDEX idx_exceptions_status ON tablet_exceptions(status, created_at DESC);