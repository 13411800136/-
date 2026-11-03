import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, Circle } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { useAsync, useDocumentTitle } from '../../lib/hooks';
import type { NotificationItem } from '../../lib/types';
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Tabs,
  useToast
} from '../../components/ui';

const EVENT_LABELS: Record<string, string> = {
  ARRIVAL_RECORDED: '物流到货',
  PRODUCTION_FEEDBACK: '生产反馈',
  QC_RECORDED: '质检录入',
  PACKING_RECORDED: '包装记录',
  SHIPMENT_RECORDED: '物流发货',
  ORDER_COMPLETED: '订单完成',
  TABLET_EXCEPTION_REPORTED: '现场异常'
};

export function NotificationsPage() {
  useDocumentTitle('通知中心');
  const toast = useToast();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const notifications = useAsync<{ items: NotificationItem[]; unreadCount: number }>(
    () => api.get(`/notifications?unreadOnly=${filter === 'unread' ? '1' : '0'}`),
    [filter]
  );

  const notifyShell = () => window.dispatchEvent(new Event('notifications:changed'));

  const markRead = async (item: NotificationItem) => {
    if (item.read) return;
    try {
      await api.post(`/notifications/${item.id}/read`, {});
      notifications.reload();
      notifyShell();
    } catch (reason) {
      toast.error('标记失败', errorMessage(reason));
    }
  };

  const markAll = async () => {
    try {
      const result = await api.post<{ updated: number }>('/notifications/mark-all-read', {});
      toast.success('已全部标为已读', `本次更新 ${result.updated} 条`);
      notifications.reload();
      notifyShell();
    } catch (reason) {
      toast.error('操作失败', errorMessage(reason));
    }
  };

  const items = notifications.data?.items ?? [];

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="NOTIFICATIONS"
        title="通知中心"
        description="关键业务事件持久保存；同一事件重放不会重复生成。未读数量与列表使用同一数据源。"
        actions={
          <Button variant="secondary" icon={<CheckCheck size={16} />} onClick={() => void markAll()} disabled={!notifications.data?.unreadCount}>
            全部已读
          </Button>
        }
      />

      <div className="notification-toolbar">
        <Tabs
          items={[
            { value: 'all', label: '全部通知' },
            { value: 'unread', label: '未读', count: notifications.data?.unreadCount }
          ]}
          value={filter}
          onChange={(value) => setFilter(value as 'all' | 'unread')}
        />
        <span className="unread-summary">
          <Circle size={9} fill="currentColor" /> 未读 {notifications.data?.unreadCount ?? 0} 条
        </span>
      </div>

      {notifications.loading && !notifications.data ? (
        <LoadingState rows={5} />
      ) : notifications.error && !notifications.data ? (
        <ErrorState error={notifications.error} onRetry={notifications.reload} />
      ) : items.length === 0 ? (
        <EmptyState
          title={filter === 'unread' ? '没有未读通知' : '暂无通知'}
          description="到货、生产反馈、质检和订单完成等关键事件会出现在这里。"
          icon={<Bell size={26} />}
        />
      ) : (
        <div className="notification-list">
          {items.map((item) => (
            <article key={item.id} className={item.read ? 'notification-item' : 'notification-item notification-unread'}>
              <span className="notification-dot">{!item.read ? <Circle size={8} fill="currentColor" /> : null}</span>
              <div className="notification-copy">
                <div className="notification-head">
                  <span className="event-tag">{EVENT_LABELS[item.eventType] ?? item.eventType}</span>
                  <strong>{item.title}</strong>
                  <time>{fmtDateTime(item.createdAt)}</time>
                </div>
                <p>{item.body}</p>
                <div className="notification-actions">
                  {item.resourceType === 'ORDER' ? (
                    <button
                      type="button"
                      className="text-link"
                      onClick={async () => {
                        await markRead(item);
                        navigate(`/admin/orders/${item.resourceId}`);
                      }}
                    >
                      查看订单
                    </button>
                  ) : null}
                  {!item.read ? (
                    <button type="button" className="text-link" onClick={() => void markRead(item)}>
                      标为已读
                    </button>
                  ) : (
                    <span className="read-label">已读</span>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
