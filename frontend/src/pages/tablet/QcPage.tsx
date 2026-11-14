import { useState } from 'react';
import { CheckCircle2, ClipboardCheck, RefreshCw, ShieldCheck } from 'lucide-react';
import { api, errorMessage, isUnknownResult } from '../../lib/api';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { useAsync, useDocumentTitle, useIntentKey } from '../../lib/hooks';
import type { QcHistoryItem, QcTask } from '../../lib/types';
import {
  Alert,
  Button,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  PageHeader,
  Tabs,
  TextInput,
  useToast
} from '../../components/ui';

export function QcPage() {
  useDocumentTitle('质检队列');
  const [tab, setTab] = useState<'queue' | 'history'>('queue');
  const queue = useAsync<{ tasks: QcTask[] }>(() => api.get('/tablet/qc/queue'), []);
  const history = useAsync<{ items: QcHistoryItem[] }>(() => api.get('/tablet/qc/history'), []);
  const refreshAll = () => {
    queue.reload();
    history.reload();
  };

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="QUALITY CONTROL"
        title="质检队列"
        description="录入检验结果不等于放行。有不合格品时如实上报，由管理员决定返工或报废；补产复检通过后才进入包装。"
        actions={
          <Button variant="secondary" size="sm" icon={<RefreshCw size={15} />} onClick={refreshAll}>
            刷新队列
          </Button>
        }
      />

      <div className="tablet-summary">
        <div>
          <ShieldCheck size={18} />
          <span>待质检任务</span>
          <strong>{queue.data?.tasks.length ?? 0}</strong>
        </div>
        <div>
          <ClipboardCheck size={18} />
          <span>录入规则</span>
          <strong className="small">全检 · 可上报不合格</strong>
        </div>
        <div>
          <CheckCircle2 size={18} />
          <span>放行权限</span>
          <strong className="small">管理员</strong>
        </div>
      </div>

      <Tabs
        items={[
          { value: 'queue', label: '待检队列', count: queue.data?.tasks.length },
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
          <EmptyState title="没有待质检任务" description="管理员下发质检后，任务会出现在这里。" icon={<ShieldCheck size={26} />} />
        ) : (
        <div className="tablet-grid">
          {queue.data!.tasks.map((task) => (
            <article key={task.productionOrderId} className="tablet-task">
              <header className="tablet-task-head">
                <div>
                  <span className="task-order-no mono">{task.orderNo}</span>
                  <h3>{task.productName}</h3>
                  <p>
                    {task.spec || '无规格'} · {task.processName} · {task.departmentName} · 交期 {fmtDate(task.dueDate)}
                  </p>
                </div>
                <span className="tablet-task-icon tone-violet">
                  <ShieldCheck size={20} />
                </span>
              </header>
              <div className="task-metrics">
                <div>
                  <span>任务数量</span>
                  <strong>{task.taskQuantity}</strong>
                </div>
                <div>
                  <span>已完成生产</span>
                  <strong>{task.producedQty}</strong>
                </div>
                <div>
                  <span>本次检验</span>
                  <strong className="highlight">{task.producedQty}</strong>
                </div>
              </div>
              <QcForm task={task} onDone={refreshAll} />
            </article>
          ))}
        </div>
        )
      ) : (
        <QcHistoryView data={history.data} loading={history.loading} error={history.error} onRetry={history.reload} />
      )}
      <p className="page-footnote">
        不合格必须如实上报：管理员会决定返工或报废，不合格数量不会计入可包装量；补产并复检通过后才能继续。
      </p>
    </div>
  );
}

function QcHistoryView({
  data,
  loading,
  error,
  onRetry
}: {
  data: { items: QcHistoryItem[] } | null;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  if (loading && !data) return <LoadingState rows={4} />;
  if (error && !data) return <ErrorState error={error} onRetry={onRetry} />;
  if ((data?.items.length ?? 0) === 0) {
    return <EmptyState title="还没有质检历史" description="提交质检结果后，记录会保存在这里。" icon={<ClipboardCheck size={26} />} />;
  }
  return (
    <div className="tablet-list">
      {data!.items.map((item) => (
        <article key={item.id} className="history-row">
          <span className={item.decision === 'PASS' ? 'soft-badge' : 'soft-badge soft-badge-warn'}>
            {item.decision === 'PASS'
              ? 'PASS'
              : item.decision === 'REWORK'
                ? '返工'
                : item.decision === 'SCRAP'
                  ? '报废'
                  : '待处置'}
          </span>
          <span className="task-order-no mono">{item.orderNo}</span>
          <strong>{item.productName}</strong>
          <span>
            {item.qualifiedQty}/{item.inspectedQty} 合格
          </span>
          <span className="muted">{item.inspectorName}</span>
          <span className="muted">{fmtDateTime(item.createdAt)}</span>
        </article>
      ))}
    </div>
  );
}

function QcForm({ task, onDone }: { task: QcTask; onDone: () => void }) {
  const toast = useToast();
  const { key } = useIntentKey('qc-');
  const [note, setNote] = useState('');
  const [unqualified, setUnqualified] = useState('0');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unknown, setUnknown] = useState(false);
  const [done, setDone] = useState(false);

  const badCount = Number(unqualified);
  const qualifiedCount = task.producedQty - (Number.isFinite(badCount) ? badCount : 0);

  const submit = async () => {
    setError(null);
    setUnknown(false);
    if (!/^\d+$/.test(unqualified)) {
      setError('不合格量必须是非负整数');
      return;
    }
    if (badCount > task.producedQty) {
      setError(`不合格量不能超过本次检验量 ${task.producedQty}`);
      return;
    }
    if (badCount > 0 && !note.trim()) {
      setError('有不合格品时必须填写原因，便于管理员判断返工或报废');
      return;
    }
    setSubmitting(true);
    try {
      await api.post(
        `/production-orders/${task.productionOrderId}/qc-records`,
        {
          inspectedQuantity: task.producedQty,
          qualifiedQuantity: qualifiedCount,
          unqualifiedQuantity: badCount,
          note: note.trim()
        },
        key
      );
      toast.success(
        '质检结果已录入',
        badCount > 0 ? '已上报不合格，等待管理员处置返工或报废' : '等待管理员确认 PASS 后进入包装'
      );
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
        <CheckCircle2 size={16} /> 已提交，等待管理员处置
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
      <div className="qc-fixed-grid">
        <div>
          <span>检验量</span>
          <strong>{task.producedQty}</strong>
        </div>
        <div>
          <span>合格量</span>
          <strong className="positive">{Math.max(0, qualifiedCount)}</strong>
        </div>
        <div>
          <span>不合格量</span>
          <strong className={badCount > 0 ? 'negative' : ''}>{badCount > 0 ? badCount : 0}</strong>
        </div>
      </div>
      <Field
        label="本次不合格数量"
        hint="0 表示全部合格；大于 0 时会上报管理员，由管理员决定返工或报废"
      >
        <TextInput
          value={unqualified}
          inputMode="numeric"
          onChange={(event) => setUnqualified(event.target.value)}
          placeholder="0"
        />
      </Field>
      <Field label={badCount > 0 ? '不合格原因（必填）' : '检验备注'}>
        <TextInput
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={badCount > 0 ? '例如：外观划伤 2 件 / 尺寸超差' : '例如：全检合格 / 首件确认'}
          maxLength={200}
        />
      </Field>
      <Button onClick={() => void submit()} loading={submitting} icon={unknown ? <RefreshCw size={15} /> : <ShieldCheck size={15} />}>
        {unknown ? '重试原请求' : badCount > 0 ? '上报不合格并提交' : '确认全检合格并提交'}
      </Button>
    </div>
  );
}
