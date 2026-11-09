import { useState } from 'react';
import { CheckCircle2, ClipboardCheck, Factory, History, Lock, RefreshCw } from 'lucide-react';
import { api, errorMessage, isUnknownResult } from '../../lib/api';
import { fmtDate, fmtDateTime, fmtMoney } from '../../lib/format';
import { useAsync, useDocumentTitle, useIntentKey } from '../../lib/hooks';
import type { ProductionTask } from '../../lib/types';
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

export function ProductionPage() {
  useDocumentTitle('生产任务');
  const [tab, setTab] = useState<'active' | 'history'>('active');
  const tasks = useAsync<{ tasks: ProductionTask[]; department?: string }>(
    () => api.get('/tablet/production/my-tasks'),
    []
  );
  const history = useAsync<{ tasks: ProductionTask[] }>(() => api.get('/tablet/production/history'), []);
  const refresh = () => {
    tasks.reload();
    history.reload();
  };

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="PRODUCTION DESK"
        title="生产任务"
        description={`仅显示本部门任务。当前部门：${tasks.data?.department ?? '—'}；服务端在每次反馈时重新校验归属。`}
        actions={
          <Button variant="secondary" size="sm" icon={<RefreshCw size={15} />} onClick={refresh}>
            刷新任务
          </Button>
        }
      />

      <div className="tablet-summary">
        <div>
          <Factory size={18} />
          <span>待反馈任务</span>
          <strong>{tasks.data?.tasks.length ?? 0}</strong>
        </div>
        <div>
          <History size={18} />
          <span>历史任务</span>
          <strong>{history.data?.tasks.length ?? 0}</strong>
        </div>
        <div>
          <Lock size={18} />
          <span>价格字段</span>
          <strong className="small">按任务开关裁剪</strong>
        </div>
      </div>

      <Tabs
        items={[
          { value: 'active', label: '我的任务', count: tasks.data?.tasks.length },
          { value: 'history', label: '历史记录', count: history.data?.tasks.length }
        ]}
        value={tab}
        onChange={(value) => setTab(value as 'active' | 'history')}
      />

      {tab === 'active' ? (
        tasks.loading && !tasks.data ? (
          <LoadingState rows={4} />
        ) : tasks.error && !tasks.data ? (
          <ErrorState error={tasks.error} onRetry={tasks.reload} />
        ) : (tasks.data?.tasks.length ?? 0) === 0 ? (
          <EmptyState title="本部门没有待处理任务" description="管理员下发生产后，任务会出现在这里。" icon={<Factory size={26} />} />
        ) : (
          <div className="tablet-grid">
            {tasks.data!.tasks.map((task) => (
              <article key={`${task.id}:${task.producedQty}`} className="tablet-task">
                <header className="tablet-task-head">
                  <div>
                    <span className="task-order-no mono">{task.orderNo}</span>
                    <h3>{task.productName}</h3>
                    <p>
                      {task.spec || '无规格'} · {task.processName} · 交期 {fmtDate(task.dueDate)}
                    </p>
                  </div>
                  <span className="tablet-task-icon tone-teal">
                    <Factory size={20} />
                  </span>
                </header>
                <div className="task-metrics">
                  <div>
                    <span>任务数量</span>
                    <strong>{task.quantity}</strong>
                  </div>
                  <div>
                    <span>已完成</span>
                    <strong>{task.producedQty}</strong>
                  </div>
                  <div>
                    <span>剩余</span>
                    <strong className="highlight">{task.remainingQty}</strong>
                  </div>
                </div>
                <Progress value={task.producedQty} max={task.quantity} />
                <div className="task-price-line">
                  {task.unitPrice ? (
                    <>
                      <span>本任务工艺单价</span>
                      <strong>{fmtMoney(task.unitPrice)}</strong>
                    </>
                  ) : (
                    <>
                      <Lock size={14} />
                      <span>本任务单价未向生产端开放</span>
                    </>
                  )}
                </div>
                <FeedbackForm task={task} onDone={refresh} />
              </article>
            ))}
          </div>
        )
      ) : history.loading && !history.data ? (
        <LoadingState rows={4} />
      ) : history.error && !history.data ? (
        <ErrorState error={history.error} onRetry={history.reload} />
      ) : (history.data?.tasks.length ?? 0) === 0 ? (
        <EmptyState title="暂无历史任务" description="完成反馈或订单流转后，任务会进入历史记录。" icon={<History size={26} />} />
      ) : (
        <div className="tablet-list">
          {history.data!.tasks.map((task) => (
            <article key={task.id} className="production-history-item">
              <div className="history-row">
                <span className="task-order-no mono">{task.orderNo}</span>
                <strong>{task.productName}</strong>
                <span>{task.processName}</span>
                <span>
                  {task.producedQty}/{task.quantity} 件
                </span>
                <span className="muted">{task.orderStatusLabel}</span>
                <span className="muted">{fmtDateTime(task.createdAt)}</span>
              </div>
              {task.feedbacks && task.feedbacks.length > 0 ? (
                <div className="production-feedback-history">
                  {task.feedbacks.map((feedback) => (
                    <span key={feedback.id}>
                      已提交生产反馈 {feedback.quantity} 件 · {feedback.operatorName} · {fmtDateTime(feedback.createdAt)}
                      {feedback.note ? ` · ${feedback.note}` : ''}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="production-feedback-history muted">尚无反馈记录</div>
              )}
            </article>
          ))}
        </div>
      )}
      <p className="page-footnote">同一任务可多次反馈，累计不得超过任务数量；提交失败不会累加。</p>
    </div>
  );
}

function FeedbackForm({ task, onDone }: { task: ProductionTask; onDone: () => void }) {
  const toast = useToast();
  const { key } = useIntentKey('feedback-');
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
    if (qty > task.remainingQty) return setError(`本次最多可反馈 ${task.remainingQty} 件`);
    setSubmitting(true);
    try {
      await api.post(`/production-orders/${task.id}/feedbacks`, { quantity: qty, note: note.trim() }, key);
      toast.success('生产反馈已提交', `本次完成 ${qty} 件，等待管理员下发质检`);
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
        <CheckCircle2 size={16} /> 已提交生产反馈
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
        <Field label="本次完成数量" required>
          <TextInput value={quantity} inputMode="numeric" onChange={(event) => setQuantity(event.target.value)} />
        </Field>
        <Field label="备注">
          <TextInput value={note} onChange={(event) => setNote(event.target.value)} placeholder="例如：本批完成 / 换刀后继续" maxLength={200} />
        </Field>
      </div>
      <Button onClick={() => void submit()} loading={submitting} icon={unknown ? <RefreshCw size={15} /> : <ClipboardCheck size={15} />}>
        {unknown ? '重试原请求' : '提交生产反馈'}
      </Button>
    </div>
  );
}
