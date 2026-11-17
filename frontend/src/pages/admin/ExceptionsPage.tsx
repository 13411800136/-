import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, CheckCircle2, PlayCircle } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { useAsync, useDocumentTitle, useIntentKey } from '../../lib/hooks';
import type { ExceptionItem } from '../../lib/types';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  Modal,
  PageHeader,
  TextArea,
  useToast
} from '../../components/ui';

interface ExceptionResponse {
  summary: { OPEN: number; ACKNOWLEDGED: number; RESOLVED: number };
  items: ExceptionItem[];
}

type Filter = 'ALL' | 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'ALL', label: '全部' },
  { value: 'OPEN', label: '待处理' },
  { value: 'ACKNOWLEDGED', label: '处理中' },
  { value: 'RESOLVED', label: '已解决' }
];

const STATUS_CLASS: Record<string, string> = {
  OPEN: 'soft-badge soft-badge-warn',
  ACKNOWLEDGED: 'soft-badge soft-badge-info',
  RESOLVED: 'soft-badge soft-badge-ok'
};

export function ExceptionsPage() {
  useDocumentTitle('现场异常');
  const navigate = useNavigate();
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>('ALL');
  const [modal, setModal] = useState<{ type: 'ack' | 'resolve'; item: ExceptionItem } | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { key, renew } = useIntentKey('exception-handle-');

  const exceptions = useAsync<ExceptionResponse>(
    () => api.get(`/exceptions${filter === 'ALL' ? '' : `?status=${filter}`}`),
    [filter]
  );
  const summary = exceptions.data?.summary ?? { OPEN: 0, ACKNOWLEDGED: 0, RESOLVED: 0 };

  const openModal = (type: 'ack' | 'resolve', item: ExceptionItem) => {
    setModal({ type, item });
    setNote('');
    setError(null);
  };

  const submit = async () => {
    if (!modal) return;
    if (modal.type === 'resolve' && note.trim().length < 2) {
      setError('请填写处理结论');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const path = `/exceptions/${modal.item.id}/${modal.type === 'ack' ? 'acknowledge' : 'resolve'}`;
      await api.post(path, { note: note.trim() }, `${key}-${modal.item.id}-${modal.type}`);
      toast.success(
        modal.type === 'ack' ? '已开始处理' : '异常已解决',
        modal.type === 'ack' ? '上报人会在通知中心看到受理结果' : '处理结论已回给上报人'
      );
      setModal(null);
      renew();
      exceptions.reload();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSubmitting(false);
    }
  };

  const items = exceptions.data?.items ?? [];

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="SHOP FLOOR EXCEPTIONS"
        title="现场异常"
        description="现场人员上报后进入待处理；管理员受理后进入处理中，处理完成填写结论并回给上报人。异常只做协同，不直接改订单数量。"
        actions={
          <div className="exception-summary">
            <span className="exception-summary-chip">
              待处理 <strong>{summary.OPEN}</strong>
            </span>
            <span className="exception-summary-chip">
              处理中 <strong>{summary.ACKNOWLEDGED}</strong>
            </span>
            <span className="exception-summary-chip">
              已解决 <strong>{summary.RESOLVED}</strong>
            </span>
          </div>
        }
      />

      <div className="exception-toolbar">
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={filter === option.value ? 'filter-chip filter-chip-active' : 'filter-chip'}
            onClick={() => setFilter(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {exceptions.loading && !exceptions.data ? (
        <LoadingState rows={5} />
      ) : exceptions.error && !exceptions.data ? (
        <ErrorState error={exceptions.error} onRetry={exceptions.reload} />
      ) : items.length === 0 ? (
        <EmptyState
          title="暂无现场异常"
          description="生产、物流、品控或包装人员上报后会出现在这里。"
          icon={<AlertTriangle size={26} />}
        />
      ) : (
        <div className="exception-grid">
          {items.map((exception) => (
            <Card key={exception.id} className="exception-card glass-card">
              <div className="exception-head">
                <span className="exception-tag">{exception.categoryLabel ?? exception.category}</span>
                <span className={STATUS_CLASS[exception.status] ?? 'soft-badge'}>
                  {exception.statusLabel ?? exception.status}
                </span>
              </div>
              <h3>{exception.description}</h3>
              <p className="exception-meta">
                {exception.reporterName} · {fmtDateTime(exception.createdAt)}
              </p>
              {exception.acknowledgedAt ? (
                <p className="exception-meta">
                  受理：{exception.acknowledgedByName ?? '管理员'} · {fmtDateTime(exception.acknowledgedAt)}
                </p>
              ) : null}
              {exception.resolutionNote ? (
                <p className="exception-resolution">
                  <CheckCircle2 size={13} /> {exception.resolutionNote}
                  {exception.resolvedAt ? ` · ${fmtDateTime(exception.resolvedAt)}` : ''}
                </p>
              ) : null}
              <div className="exception-actions">
                <button
                  type="button"
                  className="text-link"
                  onClick={() => navigate(`/admin/orders/${exception.orderId}`)}
                >
                  订单 {exception.orderNo} <ArrowRight size={14} />
                </button>
                {exception.status === 'OPEN' ? (
                  <Button size="sm" variant="secondary" icon={<PlayCircle size={14} />} onClick={() => openModal('ack', exception)}>
                    开始处理
                  </Button>
                ) : null}
                {exception.status !== 'RESOLVED' ? (
                  <Button size="sm" icon={<CheckCircle2 size={14} />} onClick={() => openModal('resolve', exception)}>
                    标记解决
                  </Button>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={modal !== null}
        onClose={() => setModal(null)}
        title={modal?.type === 'ack' ? '开始处理异常' : '标记异常已解决'}
        subtitle={modal?.item.orderNo}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setModal(null)}>
              取消
            </Button>
            <Button loading={submitting} onClick={() => void submit()}>
              {modal?.type === 'ack' ? '确认受理' : '确认解决'}
            </Button>
          </>
        }
      >
        <div className="stack">
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <p className="muted-note">{modal?.item.description}</p>
          <Field
            label={modal?.type === 'ack' ? '处理说明（可选）' : '处理结论'}
            required={modal?.type === 'resolve'}
            hint={modal?.type === 'resolve' ? '结论会通知上报人，并写入订单时间线' : undefined}
          >
            <TextArea
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={modal?.type === 'ack' ? '例如：已到现场排查，等待备件' : '例如：更换刀具并复检，已恢复正常'}
              maxLength={300}
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}