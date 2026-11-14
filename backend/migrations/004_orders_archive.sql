-- 004: 订单按月归档
-- 归档不删除业务数据：archived_at 置位后，列表默认隐藏，详情/审计/时间线仍可追溯。
ALTER TABLE orders ADD COLUMN archived_at TEXT;

CREATE INDEX idx_orders_archived ON orders(archived_at, status);