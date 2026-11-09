-- 内部消息：现场角色与管理员/其他角色之间的工作沟通。
-- 只追加消息与已读时间，不提供删除，避免沟通记录被随意覆盖。

CREATE TABLE internal_messages (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  order_id TEXT REFERENCES orders(id) ON DELETE RESTRICT,
  body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 2 AND 1000),
  read_at TEXT,
  created_at TEXT NOT NULL,
  CHECK (sender_id <> recipient_id)
) STRICT;

CREATE INDEX idx_messages_recipient ON internal_messages(recipient_id, read_at, created_at DESC);
CREATE INDEX idx_messages_sender ON internal_messages(sender_id, created_at DESC);
