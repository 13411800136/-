import { useState } from 'react';
import { CheckCircle2, PackageCheck, RefreshCw } from 'lucide-react';
import { api, errorMessage, isUnknownResult } from '../../lib/api';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { useAsync, useDocumentTitle, useIntentKey } from '../../lib/hooks';
import type { PackingHistoryItem, PackingTask } from '../../lib/types';
import {
  Alert,
  Button,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  PageHeader,
  Progress,
  Tabs,
  TextInput,
  useToast
} from '../../components/ui';

export function PackingPage() {
  useDocumentTitle('包装队列');
  const [tab, setTab] = useState<'queue' | 'history'>('queue');
  const queue = useAsync<{ tasks: PackingTask[] }>(() => api.get('/tablet/packing/queue'), []);
  const history = useAsync<{ items: PackingHistoryItem[] }>(() => api.get('/tablet/packing/history'), []);
  const refreshAll = () => {
    queue.reload();
    history.reload();
  };

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="PACKING DESK"
        title="包装队列"
        description="只能处理管理员已下发且已有放行量的订单；本次包装不得超过可包装剩余。"
        actions={
          <Button variant="secondary" size="sm" icon={<RefreshCw size={15} />} onClick={refreshAll}>
            刷新队列
          </Button>
        }
      />

      <div className="tablet-summary">
        <div>
          <PackageCheck size={18} />
          <span>待包装订单</span>
          <strong>{queue.data?.tasks.length ?? 0}</strong>
        </div>
        <div>
          <span>可包装来源</span>
          <strong className="small">管理员放行量</strong>
        </div>
        <div>
          <span>库存影响</span>
          <strong className="small">不自动扣减</strong>
        </div>
      </div>

      <Tabs
        items={[
          { value: 'queue', label: '待包装队列', count: queue.data?.tasks.length },
          { value: 'history', label: '历史记录', count: history.data?.items.length }
        ]}
        value={tab}
        onChange={(value) => setTab(value as 'queue' | 'history')}
      />

      {tab === 'queue' ? (
        queue.loading && !queue.data ? (
          <LoadingState rows={4} />
        ) : queue.error && !queue.data ? (
          <ErrorState error={queue.error} onRetry={queue.reload} />
        ) : (queue.data?.tasks.length ?? 0) === 0 ? (
          <EmptyState title="没有待包装任务" description="管理员下发包装后，任务会出现在这里。" icon={<PackageCheck size={26} />} />
        ) : (
        <div className="tablet-grid">
          {queue.data!.tasks.map((task) => (
            <article key={`${task.orderId}:${task.packedQty}`} className="tablet-task">
              <header className="tablet-task-head">
                <div>
                  <span className="task-order-no mono">{task.orderNo}</span>
                  <h3>{task.productName}</h3>
                  <p>
                    {task.spec || '无规格'} · 交期 {fmtDate(task.dueDate)}
                  </p>
                </div>
                <span className="tablet-task-icon tone-orange">
                  <PackageCheck size={20} />
                </span>
              </header>
              <div className="task-metrics">
                <div>
                  <span>应交</span>
                  <strong>{task.orderedQty}</strong>
                </div>
                <div>
                  <span>已放行</span>
                  <strong>{task.releasedQty}</strong>
                </div>
                <div>
                  <span>已包装</span>
                  <strong>{task.packedQty}</strong>
                </div>
                <div>
                  <span>剩余</span>
                  <strong className="highlight">{task.remainingQty}</strong>
                </div>
              </div>
              <Progress value={task.packedQty} max={task.orderedQty} tone="orange" />
              <PackingForm task={task} onDone={refreshAll} />
            </article>
          ))}
        </div>
        )
      ) : (
        <PackingHistoryView data={history.data} loading={history.loading} error={history.error} onRetry={history.reload} />
      )}
      <p className="page-footnote">未处置的质检结果不会增加可包装量；数量以服务端汇总为准。</p>
    </div>
  );
}

function PackingHistoryView({
  data,
  loading,
  error,
  onRetry
}: {
  data: { items: PackingHistoryItem[] } | null;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  if (loading && !data) return <LoadingState rows={4} />;
  if (error && !data) return <ErrorState error={error} onRetry={onRetry} />;
  if ((data?.items.length ?? 0) === 0) {
    return <EmptyState title="还没有包装历史" description="提交包装记录后，记录会保存在这里。" icon={<PackageCheck size={26} />} />;
  }
  return (
    <div className="tablet-list">
      {data!.items.map((item) => (
        <article key={item.id} className="history-row">
          <span className="soft-badge">包装</span>
          <span className="task-order-no mono">{item.orderNo}</span>
          <strong>{item.productName}</strong>
          <span>{item.quantity} 件</span>
          <span className="muted">{item.operatorName}</span>
          <span className="muted">{fmtDateTime(item.createdAt)}</span>
        </article>
      ))}
    </div>
  );
}

function PackingForm({ task, onDone }: { task: PackingTask; onDone: () => void }) {
  const toast = useToast();
  const { key } = useIntentKey('packing-');
  const [quantity, setQuantity] = useState(String(task.remainingQty));
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unknown, setUnknown] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setError(null);
    setUnknown(false);
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) return setError('数量必须是正整数');
    if (qty > task.remainingQty) return setError(`本次最多可包装 ${task.remainingQty} 件`);
    setSubmitting(true);
    try {
      await api.post(`/orders/${task.orderId}/packing-records`, { quantity: qty, note: note.trim() }, key);
      toast.success('包装记录已提交', `本次 ${qty} 件`);
      setDone(true);
      onDone();
    } catch (reason) {
      if (isUnknownResult(reason)) setUnknown(true);
      else setError(errorMessage(reason));
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="task-success">
        <CheckCircle2 size={16} /> 已提交，等待队列刷新
      </div>
    );
  }

  return (
    <div className="tablet-form">
      {unknown ? (
        <Alert tone="warning" title="结果未知">
          网络中断，系统未确认写入。请勿重复新建，先使用原请求重试。
        </Alert>
      ) : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="tablet-form-row">
        <Field label="本次包装数量" required>
          <TextInput value={quantity} inputMode="numeric" onChange={(event) => setQuantity(event.target.value)} />
        </Field>
        <Field label="备注">
          <TextInput value={note} onChange={(event) => setNote(event.target.value)} placeholder="例如：整批包装 / 分托" maxLength={200} />
        </Field>
      </div>
      <Button onClick={() => void submit()} loading={submitting} icon={unknown ? <RefreshCw size={15} /> : <PackageCheck size={15} />}>
        {unknown ? '重试原请求' : '确认提交包装'}
      </Button>
    </div>
  );
}
