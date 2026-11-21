-- 006: 通知软删除与批量操作
-- 软删除保留 dedupe_key，交期提醒等去重通知被删后不会当天重新生成。
ALTER TABLE notifications ADD COLUMN deleted_at TEXT;

CREATE INDEX idx_notifications_deleted ON notifications(recipient_id, deleted_at, created_at DESC);