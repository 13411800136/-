-- v1.2：客户税号/地址可选；订单 12 小时撤销留痕。
-- 撤销使用 cancelled_at 表达，保留原 status 便于历史数据兼容；查询层将有效状态映射为 CANCELLED。

ALTER TABLE customers ADD COLUMN tax_no TEXT NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN address TEXT NOT NULL DEFAULT '';

ALTER TABLE orders ADD COLUMN cancelled_at TEXT;
ALTER TABLE orders ADD COLUMN cancelled_by TEXT REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE orders ADD COLUMN cancel_reason TEXT;

CREATE INDEX idx_orders_cancelled ON orders(cancelled_at);
