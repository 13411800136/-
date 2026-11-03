import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { api } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { useAsync, useDocumentTitle } from '../../lib/hooks';
import type { ExceptionItem } from '../../lib/types';
import { Card, EmptyState, ErrorState, LoadingState, PageHeader } from '../../components/ui';

export function ExceptionsPage() {
  useDocumentTitle('现场异常');
  const navigate = useNavigate();
  const exceptions = useAsync<{ items: ExceptionItem[] }>(() => api.get('/exceptions'), []);

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="SHOP FLOOR EXCEPTIONS"
        title="现场异常"
        description="现场人员可上报问题并关联订单；异常不会直接改变订单数量。处理状态与处理人属于 F 能力，当前未启用。"
      />

      {exceptions.loading && !exceptions.data ? (
        <LoadingState rows={5} />
      ) : exceptions.error && !exceptions.data ? (
        <ErrorState error={exceptions.error} onRetry={exceptions.reload} />
      ) : (exceptions.data?.items.length ?? 0) === 0 ? (
        <EmptyState title="暂无现场异常" description="生产、物流、品控或包装人员上报后会出现在这里。" icon={<AlertTriangle size={26} />} />
      ) : (
        <div className="exception-grid">
          {exceptions.data!.items.map((exception) => (
            <Card key={exception.id} className="exception-card">
              <div className="exception-head">
                <span className="exception-tag">{exception.categoryLabel ?? exception.category}</span>
                <span className={exception.status === 'OPEN' ? 'soft-badge soft-badge-warn' : 'soft-badge'}>
                  {exception.status === 'OPEN' ? '待处理' : '已处理'}
                </span>
              </div>
              <h3>{exception.description}</h3>
              <p className="exception-meta">
                {exception.reporterName} · {fmtDateTime(exception.createdAt)}
              </p>
              <button type="button" className="text-link" onClick={() => navigate(`/admin/orders/${exception.orderId}`)}>
                订单 {exception.orderNo} <ArrowRight size={14} />
              </button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
