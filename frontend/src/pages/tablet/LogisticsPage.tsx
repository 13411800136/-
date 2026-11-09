import { useState } from 'react';
import { CheckCircle2, PackageCheck, RefreshCw, Send, Truck } from 'lucide-react';
import { api, errorMessage, isUnknownResult } from '../../lib/api';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { useAsync, useDocumentTitle, useIntentKey } from '../../lib/hooks';
import type { LogisticsHistory, LogisticsQueue } from '../../lib/types';
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

export function LogisticsPage() {
  useDocumentTitle('物流工作台');
  const [tab, setTab] = useState<'arrivals' | 'shipments' | 'history'>('arrivals');
  const queue = useAsync<LogisticsQueue>(() => api.get('/tablet/logistics/queue'), []);
  const history = useAsync<LogisticsHistory>(() => api.get('/tablet/logistics/history'), []);
  const data = queue.data;
  const refreshAll = () => {
    queue.reload();
    history.reload();
  };

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="LOGISTICS DESK"
        title="物流工作台"
        description="登记本次到货或发货数量；服务端按累计量校验，重复提交使用同一幂等键，不会重复入账。"
        actions={
          <Button variant="secondary" size="sm" icon={<RefreshCw size={15} />} onClick={refreshAll}>
            刷新队列
          </Button>
        }
      />

      <div className="tablet-summary">
        <div>
          <Truck size={18} />
          <span>待到货</span>
          <strong>{data?.arrivals.length ?? 0}</strong>
        </div>
        <div>
          <Send size={18} />
          <span>待发货</span>
          <strong>{data?.shipments.length ?? 0}</strong>
        </div>
        <div>
          <span>业务时区</span>
          <strong className="small">北京时间</strong>
        </div>
      </div>

      <Tabs
        items={[
          { value: 'arrivals', label: '到货登记', count: data?.arrivals.length },
          { value: 'shipments', label: '发货登记', count: data?.shipments.length },
          {
            value: 'history',
            label: '历史记录',
            count: (history.data?.arrivals.length ?? 0) + (history.data?.shipments.length ?? 0)
          }
        ]}
        value={tab}
        onChange={(value) => setTab(value as 'arrivals' | 'shipments' | 'history')}
      />

      {queue.loading && !data ? (
        <LoadingState rows={4} />
      ) : queue.error && !data ? (
        <ErrorState error={queue.error} onRetry={queue.reload} />
      ) : tab === 'arrivals' ? (
        (data?.arrivals.length ?? 0) === 0 ? (
          <EmptyState title="没有待登记的到货" description="采购单建立后，到货任务会出现在这里。" icon={<Truck size={26} />} />
        ) : (
          <div className="tablet-grid">
            {data!.arrivals.map((arrival) => (
              <article key={`${arrival.purchaseItemId}:${arrival.arrivedQty}`} className="tablet-task">
                <header className="tablet-task-head">
                  <div>
                    <span className="task-order-no mono">{arrival.orderNo}</span>
                    <h3>{arrival.productName}</h3>
                    <p>
                      {arrival.partName} · {arrival.spec || '无规格'} · 交期 {fmtDate(arrival.dueDate)}
                    </p>
                  </div>
                  <span className="tablet-task-icon tone-cyan">
                    <Truck size={20} />
                  </span>
                </header>
                <div className="task-metrics">
                  <div>
                    <span>采购量</span>
                    <strong>{arrival.purchasedQty}</strong>
                  </div>
                  <div>
                    <span>已到货</span>
                    <strong>{arrival.arrivedQty}</strong>
                  </div>
                  <div>
                    <span>剩余</span>
                    <strong className="highlight">{arrival.remainingQty}</strong>
                  </div>
                </div>
                <Progress value={arrival.arrivedQty} max={arrival.purchasedQty} />
                <ArrivalForm
                  purchaseItemId={arrival.purchaseItemId}
                  remaining={arrival.remainingQty}
                  onDone={queue.reload}
                />
              </article>
            ))}
          </div>
        )
      ) : tab === 'shipments' ? (
        (data?.shipments.length ?? 0) === 0 ? (
          <EmptyState title="没有待发货任务" description="管理员确认发货后，任务会出现在这里。" icon={<Send size={26} />} />
        ) : (
        <div className="tablet-grid">
          {data!.shipments.map((shipment) => (
            <article key={`${shipment.orderId}:${shipment.shippedQty}`} className="tablet-task">
              <header className="tablet-task-head">
                <div>
                  <span className="task-order-no mono">{shipment.orderNo}</span>
                  <h3>{shipment.productName}</h3>
                  <p>
                    {shipment.spec || '无规格'} · 交期 {fmtDate(shipment.dueDate)}
                  </p>
                </div>
                <span className="tablet-task-icon tone-blue">
                  <PackageCheck size={20} />
                </span>
              </header>
              <div className="task-metrics">
                <div>
                  <span>应交</span>
                  <strong>{shipment.orderedQty}</strong>
                </div>
                <div>
                  <span>已包装</span>
                  <strong>{shipment.packedQty}</strong>
                </div>
                <div>
                  <span>待发货</span>
                  <strong className="highlight">{shipment.remainingQty}</strong>
                </div>
              </div>
              <Progress value={shipment.shippedQty} max={shipment.orderedQty} tone="blue" />
              <ShipmentForm orderId={shipment.orderId} remaining={shipment.remainingQty} onDone={queue.reload} />
            </article>
          ))}
        </div>
        )
      ) : (
        <LogisticsHistoryView
          data={history.data}
          loading={history.loading}
          error={history.error}
          onRetry={history.reload}
        />
      )}
      <p className="page-footnote">到货与发货都不会自动改动配件或成品库存；库存需管理员在台账中手工调整。</p>
    </div>
  );
}

function LogisticsHistoryView({
  data,
  loading,
  error,
  onRetry
}: {
  data: LogisticsHistory | null;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  if (loading && !data) return <LoadingState rows={4} />;
  if (error && !data) return <ErrorState error={error} onRetry={onRetry} />;
  const rows = [
    ...(data?.arrivals ?? []).map((row) => ({ ...row, kind: '到货' as const })),
    ...(data?.shipments ?? []).map((row) => ({ ...row, kind: '发货' as const }))
  ].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  if (rows.length === 0) {
    return <EmptyState title="还没有物流历史" description="确认登记到货或发货后，记录会保存在这里。" icon={<Truck size={26} />} />;
  }
  return (
    <div className="tablet-list">
      {rows.map((row) => (
        <article key={`${row.kind}-${row.id}`} className="history-row">
          <span className={row.kind === '到货' ? 'soft-badge' : 'soft-badge soft-badge-warn'}>{row.kind}</span>
          <span className="task-order-no mono">{row.orderNo}</span>
          <strong>{row.productName}</strong>
          <span>{row.quantity} 件</span>
          <span className="muted">{row.operatorName}</span>
          <span className="muted">{fmtDateTime(row.createdAt)}</span>
        </article>
      ))}
    </div>
  );
}

function ArrivalForm({ purchaseItemId, remaining, onDone }: { purchaseItemId: string; remaining: number; onDone: () => void }) {
  const toast = useToast();
  const { key } = useIntentKey('arrival-');
  const [quantity, setQuantity] = useState(String(remaining));
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
    if (qty > remaining) return setError(`本次最多可登记 ${remaining} 件`);
    setSubmitting(true);
    try {
      await api.post(`/purchase-items/${purchaseItemId}/arrivals`, { quantity: qty, note: note.trim() }, key);
      toast.success('到货已登记', `本次 ${qty} 件，服务端已更新累计到货`);
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
        <Field label="本次到货数量" required>
          <TextInput value={quantity} inputMode="numeric" onChange={(event) => setQuantity(event.target.value)} />
        </Field>
        <Field label="备注">
          <TextInput value={note} onChange={(event) => setNote(event.target.value)} placeholder="例如：一次到齐 / 首批" maxLength={200} />
        </Field>
      </div>
      <Button onClick={() => void submit()} loading={submitting} icon={unknown ? <RefreshCw size={15} /> : <Truck size={15} />}>
        {unknown ? '重试原请求' : '确认登记到货'}
      </Button>
    </div>
  );
}

function ShipmentForm({ orderId, remaining, onDone }: { orderId: string; remaining: number; onDone: () => void }) {
  const toast = useToast();
  const { key } = useIntentKey('shipment-');
  const [quantity, setQuantity] = useState(String(remaining));
  const [carrier, setCarrier] = useState('顺程物流（演示）');
  const [trackingNo, setTrackingNo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unknown, setUnknown] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setError(null);
    setUnknown(false);
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) return setError('数量必须是正整数');
    if (qty > remaining) return setError(`本次最多可发货 ${remaining} 件`);
    setSubmitting(true);
    try {
      await api.post(`/orders/${orderId}/shipments`, { quantity: qty, carrier: carrier.trim(), trackingNo: trackingNo.trim() }, key);
      toast.success('发货已登记', `本次 ${qty} 件；足量后订单自动完成`);
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
        <Field label="本次发货数量" required>
          <TextInput value={quantity} inputMode="numeric" onChange={(event) => setQuantity(event.target.value)} />
        </Field>
        <Field label="承运方">
          <TextInput value={carrier} onChange={(event) => setCarrier(event.target.value)} maxLength={50} />
        </Field>
      </div>
      <Field label="运单号（可选）">
        <TextInput value={trackingNo} onChange={(event) => setTrackingNo(event.target.value)} maxLength={60} placeholder="演示单号" />
      </Field>
      <Button onClick={() => void submit()} loading={submitting} icon={unknown ? <RefreshCw size={15} /> : <Send size={15} />}>
        {unknown ? '重试原请求' : '确认登记发货'}
      </Button>
      <span className="tablet-hint">提交时间将按北京时间记录：{fmtDateTime(new Date().toISOString())}</span>
    </div>
  );
}
