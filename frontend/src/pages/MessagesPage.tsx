import { useState } from 'react';
import { CheckCheck, MessageSquare, RefreshCw, Send } from 'lucide-react';
import { api, errorMessage, isUnknownResult } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import { useAsync, useDocumentTitle, useIntentKey } from '../lib/hooks';
import { useAuth } from '../app/AuthContext';
import type { MessageItem, MessageRecipient } from '../lib/types';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  PageHeader,
  Select,
  Tabs,
  TextArea,
  useToast
} from '../components/ui';

interface OrderOption {
  id: string;
  orderNo: string;
  productName: string;
  status: string;
}

const ROLE_LABELS: Record<string, string> = {
  ADMIN: '管理员',
  LOGISTICS: '物流',
  PRODUCTION: '生产',
  QC: '品控',
  PACKING: '包装'
};

export function MessagesPage() {
  useDocumentTitle('内部消息');
  const { user } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState<'inbox' | 'sent'>('inbox');
  const [recipientId, setRecipientId] = useState('');
  const [orderId, setOrderId] = useState('');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { key, renew } = useIntentKey('message-');

  const inbox = useAsync<{ items: MessageItem[]; unreadCount: number }>(() => api.get('/messages/inbox'), []);
  const sent = useAsync<{ items: MessageItem[] }>(() => api.get('/messages/sent'), []);
  const recipients = useAsync<{ items: MessageRecipient[] }>(() => api.get('/messages/recipients'), []);
  const orders = useAsync<{ items: OrderOption[] }>(
    async () => {
      if (user?.role === 'ADMIN') {
        const result = await api.get<{
          items: Array<{ id: string; orderNo: string; productName: string; status: string }>;
        }>('/orders?pageSize=100');
        return {
          items: result.items.map((row) => ({
            id: row.id,
            orderNo: row.orderNo,
            productName: row.productName,
            status: row.status
          }))
        };
      }
      const result = await api.get<{
        items: Array<{ id: string; order_no: string; product_name: string; status: string }>;
      }>('/tablet/order-options');
      return {
        items: result.items.map((row) => ({
          id: row.id,
          orderNo: row.order_no,
          productName: row.product_name,
          status: row.status
        }))
      };
    },
    [user?.role]
  );

  const activeRecipient = recipients.data?.items.find((item) => item.id === recipientId);
  const unread = inbox.data?.unreadCount ?? 0;
  const list = tab === 'inbox' ? inbox.data?.items ?? [] : sent.data?.items ?? [];

  const send = async () => {
    setError(null);
    setUnknown(false);
    if (!recipientId) return setError('请选择接收人');
    if (body.trim().length < 2) return setError('请至少填写 2 个字符的消息内容');
    setSubmitting(true);
    try {
      await api.post<{ id: string }>(
        '/messages',
        { recipientId, orderId: orderId || null, body: body.trim() },
        key
      );
      toast.success('消息已发送', activeRecipient ? `已通知 ${activeRecipient.displayName}` : undefined);
      setBody('');
      setOrderId('');
      setTab('sent');
      renew();
      sent.reload();
      inbox.reload();
      window.dispatchEvent(new Event('messages:changed'));
    } catch (reason) {
      if (isUnknownResult(reason)) setUnknown(true);
      else setError(errorMessage(reason));
    } finally {
      setSubmitting(false);
    }
  };

  const markRead = async (message: MessageItem) => {
    if (message.read) return;
    try {
      await api.post(`/messages/${message.id}/read`, {});
      inbox.reload();
      window.dispatchEvent(new Event('messages:changed'));
    } catch (reason) {
      toast.error('标记失败', errorMessage(reason));
    }
  };

  const refresh = () => {
    inbox.reload();
    sent.reload();
    recipients.reload();
    orders.reload();
  };

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="INTERNAL MESSAGES"
        title="内部消息"
        description="现场与管理员之间的工作沟通：可以联系管理员，也可以联系其他职务；消息持久保存，未读与已读独立。"
        actions={
          <Button variant="secondary" size="sm" icon={<RefreshCw size={15} />} onClick={refresh}>
            刷新消息
          </Button>
        }
      />

      <div className="messages-layout">
        <div className="stack">
          <div className="notification-toolbar">
            <Tabs
              items={[
                { value: 'inbox', label: '收件箱', count: unread },
                { value: 'sent', label: '已发送', count: sent.data?.items.length }
              ]}
              value={tab}
              onChange={(value) => setTab(value as 'inbox' | 'sent')}
            />
            <span className="unread-summary">
              <MessageSquare size={13} /> 未读 {unread} 条
            </span>
          </div>

          {tab === 'inbox' && inbox.loading && !inbox.data ? (
            <LoadingState rows={4} />
          ) : tab === 'inbox' && inbox.error && !inbox.data ? (
            <ErrorState error={inbox.error} onRetry={inbox.reload} />
          ) : tab === 'sent' && sent.loading && !sent.data ? (
            <LoadingState rows={4} />
          ) : tab === 'sent' && sent.error && !sent.data ? (
            <ErrorState error={sent.error} onRetry={sent.reload} />
          ) : list.length === 0 ? (
            <EmptyState
              title={tab === 'inbox' ? '收件箱为空' : '还没有发送记录'}
              description={tab === 'inbox' ? '其他角色给你发消息后会出现在这里。' : '在右侧选择接收人，写一条工作消息。'}
              icon={<MessageSquare size={26} />}
            />
          ) : (
            <div className="message-list">
              {list.map((message) => {
                const other = tab === 'inbox' ? message.sender : message.recipient;
                return (
                  <article key={message.id} className={message.read ? 'message-item' : 'message-item message-unread'}>
                    <span className="message-avatar">{other.name.slice(0, 1)}</span>
                    <div className="message-copy">
                      <div className="message-head">
                        <strong>{other.name}</strong>
                        <span className="event-tag">{ROLE_LABELS[other.role] ?? other.role}</span>
                        {message.order ? <span className="message-order">{message.order.orderNo}</span> : null}
                        <time>{fmtDateTime(message.createdAt)}</time>
                      </div>
                      <p>{message.body}</p>
                      <div className="message-foot">
                        {tab === 'inbox' ? (
                          message.read ? (
                            <span className="read-label">
                              <CheckCheck size={13} /> 已读
                            </span>
                          ) : (
                            <button type="button" className="text-link" onClick={() => void markRead(message)}>
                              标为已读
                            </button>
                          )
                        ) : (
                          <span className={message.read ? 'read-label' : 'message-unread-label'}>
                            {message.read ? '对方已读' : '对方未读'}
                          </span>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <Card className="message-compose">
          <div className="section-title">
            <div>
              <h2>写消息</h2>
              <p>发给管理员或其他职务，可关联一张订单</p>
            </div>
            <span className="kpi-icon">
              <Send size={17} />
            </span>
          </div>
          {unknown ? (
            <Alert tone="warning" title="发送结果未知">
              网络中断，系统未确认是否写入。请不要重复新建，先用原请求重试。
              <div className="alert-inline-action">
                <Button size="sm" variant="dark" loading={submitting} onClick={() => void send()}>
                  重试原请求
                </Button>
              </div>
            </Alert>
          ) : null}
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Field label="接收人" required hint="所有启用中的管理员与现场角色">
            <Select value={recipientId} onChange={(event) => setRecipientId(event.target.value)}>
              <option value="">请选择接收人</option>
              {(recipients.data?.items ?? []).map((recipient) => (
                <option key={recipient.id} value={recipient.id}>
                  {recipient.displayName} · {ROLE_LABELS[recipient.role] ?? recipient.role}
                  {recipient.departmentName ? ` / ${recipient.departmentName}` : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="关联订单（可选）" hint="只列出当前职责范围内的订单">
            <Select value={orderId} onChange={(event) => setOrderId(event.target.value)}>
              <option value="">不关联订单</option>
              {(orders.data?.items ?? []).map((order) => (
                <option key={order.id} value={order.id}>
                  {order.orderNo} · {order.productName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="消息内容" required hint="例如：这批货物外箱有人为破损，请管理员确认是否换货。">
            <TextArea
              rows={5}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              maxLength={1000}
              placeholder="写清问题、位置和已采取的措施…"
            />
          </Field>
          <Button loading={submitting} icon={<Send size={15} />} onClick={() => void send()}>
            发送消息
          </Button>
          <p className="muted-note">消息只追加保存，不提供删除；发送人和接收人都能在各自列表中查到。</p>
        </Card>
      </div>
    </div>
  );
}
