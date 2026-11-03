import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Factory,
  FileText,
  Package,
  RefreshCw,
  Send,
  ShieldCheck,
  Truck,
  UserRound
} from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { fmtDate, fmtDateTime, fmtMoney, STATUS_TONE, dueLabel } from '../../lib/format';
import { useAsync, useDocumentTitle } from '../../lib/hooks';
import type { Attachment, ExceptionItem, OrderDetail, TimelineEvent } from '../../lib/types';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Progress,
  SectionTitle,
  StatusPill,
  useToast
} from '../../components/ui';
import {
  AttachmentPanel,
  DeliverySummary,
  OrderTimeline,
  PriceVisibility,
  ProfitPanel,
  StageStepper
} from './order/OrderPanels';
import {
  ConfirmActionModal,
  ProductionModal,
  PurchaseModal,
  QcDecisionModal,
  type DepartmentOption,
  type EmployeeOption,
  type PartOption,
  type SupplierOption
} from './order/OrderActionModals';

type ModalState =
  | { type: 'purchase' }
  | { type: 'production' }
  | { type: 'qcDispatch' }
  | { type: 'qcDecision' }
  | { type: 'packingDispatch' }
  | { type: 'shipmentTrigger' }
  | null;

export function OrderDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [modal, setModal] = useState<ModalState>(null);
  const [visibilityBusy, setVisibilityBusy] = useState(false);

  const detail = useAsync<OrderDetail>(() => api.get(`/orders/${id}`), [id]);
  const timeline = useAsync<{ events: TimelineEvent[] }>(() => api.get(`/orders/${id}/timeline`), [id]);
  const attachments = useAsync<{ items: Attachment[] }>(() => api.get(`/orders/${id}/attachments`), [id]);
  const options = useAsync<{
    suppliers: SupplierOption[];
    parts: PartOption[];
    departments: DepartmentOption[];
    employees: EmployeeOption[];
  }>(
    async () => {
      const [suppliers, parts, departments, users] = await Promise.all([
        api.get<{ items: SupplierOption[] }>('/suppliers?active=1'),
        api.get<{ items: Array<{ id: string; code: string; name: string; spec: string; active: boolean }> }>(
          '/parts?active=1'
        ),
        api.get<{ items: DepartmentOption[] }>('/departments'),
        api.get<{ items: EmployeeOption[] }>('/users?role=PRODUCTION')
      ]);
      return {
        suppliers: suppliers.items,
        parts: parts.items.map((part) => ({
          partId: part.id,
          code: part.code,
          name: part.name,
          spec: part.spec,
          active: part.active
        })),
        departments: departments.items,
        employees: users.items
      };
    },
    []
  );
  const exceptions = useAsync<{ items: ExceptionItem[] }>(() => api.get('/exceptions'), []);

  const data = detail.data;
  useDocumentTitle(data ? data.order.orderNo : '订单详情');

  if (detail.loading && !data) {
    return (
      <div className="stack-lg">
        <div className="page-skeleton-hero" />
        <LoadingState rows={6} />
      </div>
    );
  }
  if (detail.error && !data) return <ErrorState error={detail.error} onRetry={detail.reload} />;
  if (!data) return null;

  const { order, items, purchase, production, qc, packing, shipments, summary, profit, stages } = data;
  const item = items[0];
  const due = dueLabel(order.dueDate);
  const orderExceptions = (exceptions.data?.items ?? []).filter((exception) => exception.orderId === order.id);
  const task = production[0];
  const qcRecord = qc[0];

  const refreshAll = () => {
    detail.reload();
    timeline.reload();
    attachments.reload();
  };

  const closeModal = () => setModal(null);
  const done = () => {
    closeModal();
    refreshAll();
  };

  const togglePriceVisibility = async () => {
    if (!task) return;
    setVisibilityBusy(true);
    try {
      await api.patch(
        `/production-orders/${task.id}/price-visibility`,
        { priceVisible: !task.priceVisible },
        `visibility-${crypto.randomUUID()}`
      );
      toast.success(task.priceVisible ? '已隐藏生产端单价' : '已允许生产端查看单价');
      detail.reload();
    } catch (reason) {
      toast.error('更新失败', errorMessage(reason));
    } finally {
      setVisibilityBusy(false);
    }
  };

  const adminAction = (() => {
    const allowed = summary.allowedActions;
    if (allowed.includes('CREATE_PURCHASE')) {
      return { label: '建立采购单', icon: <FileText size={16} />, onClick: () => setModal({ type: 'purchase' }) };
    }
    if (allowed.includes('DISPATCH_PRODUCTION')) {
      return { label: '下发生产', icon: <Factory size={16} />, onClick: () => setModal({ type: 'production' }) };
    }
    if (allowed.includes('DISPATCH_QC')) {
      return { label: '下发质检', icon: <ShieldCheck size={16} />, onClick: () => setModal({ type: 'qcDispatch' }) };
    }
    if (allowed.includes('DECIDE_QC')) {
      return { label: '处置质检', icon: <ClipboardCheck size={16} />, onClick: () => setModal({ type: 'qcDecision' }) };
    }
    if (allowed.includes('DISPATCH_PACKING')) {
      return { label: '下发包装', icon: <Package size={16} />, onClick: () => setModal({ type: 'packingDispatch' }) };
    }
    if (allowed.includes('TRIGGER_SHIPMENT')) {
      return { label: '触发发货', icon: <Send size={16} />, onClick: () => setModal({ type: 'shipmentTrigger' }) };
    }
    return null;
  })();

  const waitingText =
    summary.allowedActions.includes('RECORD_ARRIVAL')
      ? '等待物流登记到货'
      : summary.allowedActions.includes('RECORD_FEEDBACK')
        ? '等待生产现场反馈'
        : summary.allowedActions.includes('RECORD_QC')
          ? '等待品控录入检验结果'
          : summary.allowedActions.includes('RECORD_PACKING')
            ? '等待包装现场录入'
            : summary.allowedActions.includes('RECORD_SHIPMENT')
              ? '等待物流登记发货'
              : null;

  return (
    <div className="stack-lg order-detail">
      <div className="order-crumb">
        <button type="button" className="text-link" onClick={() => navigate('/admin/orders')}>
          <ArrowLeft size={14} /> 订单协同
        </button>
        <span>/</span>
        <span className="mono">{order.orderNo}</span>
      </div>

      <header className="order-head">
        <div className="order-head-main">
          <div className="order-head-title">
            <h1 className="mono">{order.orderNo}</h1>
            <StatusPill status={order.status} label={order.statusLabel} tone={STATUS_TONE[order.status]} />
            <span className={`due-chip due-${due.tone}`}>
              <CalendarDays size={14} /> {due.text}
            </span>
          </div>
          <p className="order-head-sub">
            {order.customer.name} · {item?.productName}
            {item?.spec ? ` / ${item.spec}` : ''} · {item?.quantity ?? 0} 件 · 创建于 {fmtDateTime(order.createdAt)}
          </p>
        </div>
        <div className="order-head-actions">
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={refreshAll}>
            刷新
          </Button>
          {waitingText ? <span className="waiting-chip">{waitingText}</span> : null}
          {adminAction ? (
            <Button icon={adminAction.icon} onClick={adminAction.onClick}>
              {adminAction.label}
            </Button>
          ) : order.status === 'COMPLETED' ? (
            <span className="complete-chip">
              <CheckCircle2 size={15} /> 已完成交付
            </span>
          ) : null}
        </div>
      </header>

      <Card className="stage-card">
        <StageStepper stages={stages} />
      </Card>

      <div className="detail-grid">
        <div className="stack">
          <Card>
            <SectionTitle
              title="产品明细"
              hint="业务快照：后续基础数据改名或改价不影响本单"
              action={<span className="count-chip">{items.length} 项</span>}
            />
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>产品</th>
                    <th>规格</th>
                    <th className="num">数量</th>
                    <th className="num">销售单价</th>
                    <th className="num">销售额</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <strong>{row.productName}</strong>
                      </td>
                      <td className="muted">{row.spec || '—'}</td>
                      <td className="num">{row.quantity}</td>
                      <td className="num money">{fmtMoney(row.unitPrice)}</td>
                      <td className="num money">{fmtMoney(row.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="line-total">
              <span>销售额合计</span>
              <strong>{fmtMoney(profit.sales)}</strong>
            </div>
          </Card>

          <Card>
            <SectionTitle
              title="采购与到货"
              hint="一订单一张采购单；到货由物流登记，累计不得超过采购量"
              action={
                !purchase && summary.allowedActions.includes('CREATE_PURCHASE') ? (
                  <Button size="sm" variant="secondary" onClick={() => setModal({ type: 'purchase' })}>
                    建立采购单
                  </Button>
                ) : null
              }
            />
            {!purchase ? (
              <EmptyState
                title="尚未建立采购单"
                description="手动选择供应商与配件，采购价格按创建时快照保存。"
                icon={<Truck size={24} />}
                action={
                  summary.allowedActions.includes('CREATE_PURCHASE') ? (
                    <Button size="sm" onClick={() => setModal({ type: 'purchase' })}>
                      建立采购单
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <div className="stack">
                <div className="purchase-head">
                  <div>
                    <span className="mono purchase-no">{purchase.purchaseNo}</span>
                    <span className="cell-sub">供应商 · {purchase.supplier.name}</span>
                  </div>
                  <span className="muted">创建于 {fmtDateTime(purchase.createdAt)}</span>
                </div>
                {purchase.item ? (
                  <>
                    <div className="purchase-item">
                      <div>
                        <strong>{purchase.item.partName}</strong>
                        <span>{purchase.item.spec || '无规格'}</span>
                      </div>
                      <div className="purchase-nums">
                        <span>
                          采购 <strong>{purchase.item.quantity}</strong> 件
                        </span>
                        <span>
                          单价 <strong>{fmtMoney(purchase.item.unitPrice)}</strong>
                        </span>
                        <span>
                          金额 <strong>{fmtMoney(purchase.item.amount)}</strong>
                        </span>
                      </div>
                    </div>
                    <div className="arrival-progress">
                      <div className="arrival-progress-head">
                        <span>
                          到货进度 <strong>{purchase.item.arrivedQty}</strong> / {purchase.item.quantity}
                        </span>
                        <span>{purchase.item.arrivedQty >= purchase.item.quantity ? '已全部到齐' : '部分到货'}</span>
                      </div>
                      <Progress value={purchase.item.arrivedQty} max={purchase.item.quantity} />
                    </div>
                    {purchase.item.arrivals.length > 0 ? (
                      <ul className="record-list">
                        {purchase.item.arrivals.map((arrival) => (
                          <li key={arrival.id}>
                            <span className="record-icon tone-cyan">
                              <Truck size={14} />
                            </span>
                            <div>
                              <strong>到货 {arrival.quantity} 件</strong>
                              <span>
                                {arrival.operatorName} · {fmtDateTime(arrival.createdAt)}
                                {arrival.note ? ` · ${arrival.note}` : ''}
                              </span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted-note">物流尚未登记到货。到齐后管理员可下发生产。</p>
                    )}
                  </>
                ) : null}
              </div>
            )}
          </Card>

          <Card>
            <SectionTitle
              title="生产任务"
              hint="部门隔离：现场只能处理本部门任务；单价可见性由管理员控制"
              action={
                !task && summary.allowedActions.includes('DISPATCH_PRODUCTION') ? (
                  <Button size="sm" variant="secondary" onClick={() => setModal({ type: 'production' })}>
                    下发生产
                  </Button>
                ) : null
              }
            />
            {!task ? (
              <EmptyState
                title="尚未下发生产"
                description="采购全部到齐后，选择生产部门、工艺、人员与单价。"
                icon={<Factory size={24} />}
              />
            ) : (
              <div className="stack">
                <div className="task-card-head">
                  <div>
                    <span className="task-dept">{task.department.name}</span>
                    <strong className="task-process">{task.processName}</strong>
                    <span className="cell-sub">
                      {task.assignee ? `指定 ${task.assignee.name}` : '未指定具体人员'} · 交期 {fmtDate(task.dueDate)}
                    </span>
                  </div>
                  <div className="task-head-right">
                    <span className="money-block">
                      工艺单价 <strong>{fmtMoney(task.unitPrice)}</strong>
                    </span>
                    <PriceVisibility visible={task.priceVisible} onToggle={() => void togglePriceVisibility()} busy={visibilityBusy} />
                  </div>
                </div>
                <div className="task-progress">
                  <div className="arrival-progress-head">
                    <span>
                      完成进度 <strong>{task.producedQty}</strong> / {task.quantity}
                    </span>
                    <span>{task.producedQty >= task.quantity ? '已全部反馈' : '现场处理中'}</span>
                  </div>
                  <Progress value={task.producedQty} max={task.quantity} />
                </div>
                {task.feedbacks.length > 0 ? (
                  <ul className="record-list">
                    {task.feedbacks.map((feedback) => (
                      <li key={feedback.id}>
                        <span className="record-icon tone-teal">
                          <ClipboardCheck size={14} />
                        </span>
                        <div>
                          <strong>反馈完成 {feedback.quantity} 件</strong>
                          <span>
                            {feedback.operatorName} · {fmtDateTime(feedback.createdAt)}
                            {feedback.note ? ` · ${feedback.note}` : ''}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted-note">
                    等待生产现场提交反馈。单价可见开关为
                    <strong>{task.priceVisible ? '开启' : '关闭'}</strong>，关闭时现场响应不包含任何价格字段。
                  </p>
                )}
              </div>
            )}
          </Card>

          <Card>
            <SectionTitle
              title="质检与放行"
              hint="品控录入结果，管理员决策；只有 PASS 的合格量可进入包装"
              action={
                summary.allowedActions.includes('DECIDE_QC') && qcRecord ? (
                  <Button size="sm" variant="secondary" onClick={() => setModal({ type: 'qcDecision' })}>
                    处置质检
                  </Button>
                ) : summary.allowedActions.includes('DISPATCH_QC') ? (
                  <Button size="sm" variant="secondary" onClick={() => setModal({ type: 'qcDispatch' })}>
                    下发质检
                  </Button>
                ) : null
              }
            />
            {!qcRecord ? (
              <EmptyState
                title="尚未录入质检结果"
                description={
                  summary.allowedActions.includes('DISPATCH_QC')
                    ? '生产任务已全部完成，可以下发质检。'
                    : '生产反馈全部完成后，管理员可下发质检。'
                }
                icon={<ShieldCheck size={24} />}
              />
            ) : (
              <div className="qc-block">
                <div className="qc-metrics">
                  <div>
                    <span>检验量</span>
                    <strong>{qcRecord.inspectedQty}</strong>
                  </div>
                  <div>
                    <span>合格量</span>
                    <strong className="positive">{qcRecord.qualifiedQty}</strong>
                  </div>
                  <div>
                    <span>不合格量</span>
                    <strong className={qcRecord.unqualifiedQty > 0 ? 'negative' : ''}>{qcRecord.unqualifiedQty}</strong>
                  </div>
                  <div>
                    <span>录入人</span>
                    <strong className="small">{qcRecord.inspectorName}</strong>
                  </div>
                  <div>
                    <span>决策</span>
                    <strong className={qcRecord.decision === 'PASS' ? 'positive' : ''}>
                      {qcRecord.decision === 'PASS' ? 'PASS 已放行' : '待管理员处置'}
                    </strong>
                  </div>
                </div>
                {qcRecord.decision === 'PASS' ? (
                  <Alert tone="success" title="质检已放行">
                    {qcRecord.decidedByName} 于 {fmtDateTime(qcRecord.decidedAt)} 确认放行 {qcRecord.qualifiedQty} 件。
                  </Alert>
                ) : (
                  <Alert tone="warning" title="等待管理员处置">
                    品控保存结果不等于放行。管理员确认 PASS 后，包装队列才会出现可包装数量。
                  </Alert>
                )}
              </div>
            )}
          </Card>

          <Card>
            <SectionTitle
              title="包装与发货"
              hint="可包装量来自已放行合格量；可发货量不超过已包装量与应交剩余"
              action={
                summary.allowedActions.includes('DISPATCH_PACKING') ? (
                  <Button size="sm" variant="secondary" onClick={() => setModal({ type: 'packingDispatch' })}>
                    下发包装
                  </Button>
                ) : summary.allowedActions.includes('TRIGGER_SHIPMENT') ? (
                  <Button size="sm" variant="secondary" onClick={() => setModal({ type: 'shipmentTrigger' })}>
                    触发发货
                  </Button>
                ) : null
              }
            />
            <DeliverySummary
              detail={data}
              onPack={
                summary.allowedActions.includes('DISPATCH_PACKING')
                  ? () => setModal({ type: 'packingDispatch' })
                  : undefined
              }
              onShip={
                summary.allowedActions.includes('TRIGGER_SHIPMENT')
                  ? () => setModal({ type: 'shipmentTrigger' })
                  : undefined
              }
            />
            <div className="delivery-lists">
              <div>
                <h3>
                  <Package size={15} /> 包装记录
                </h3>
                {packing.length === 0 ? (
                  <p className="muted-note">暂无包装记录。</p>
                ) : (
                  <ul className="record-list">
                    {packing.map((row) => (
                      <li key={row.id}>
                        <span className="record-icon tone-orange">
                          <Package size={14} />
                        </span>
                        <div>
                          <strong>包装 {row.quantity} 件</strong>
                          <span>
                            {row.operatorName} · {fmtDateTime(row.createdAt)}
                            {row.note ? ` · ${row.note}` : ''}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h3>
                  <Truck size={15} /> 发货记录
                </h3>
                {shipments.length === 0 ? (
                  <p className="muted-note">暂无发货记录。</p>
                ) : (
                  <ul className="record-list">
                    {shipments.map((row) => (
                      <li key={row.id}>
                        <span className="record-icon tone-blue">
                          <Send size={14} />
                        </span>
                        <div>
                          <strong>发货 {row.quantity} 件</strong>
                          <span>
                            {row.operatorName} · {fmtDateTime(row.createdAt)}
                            {row.carrier ? ` · ${row.carrier}` : ''}
                            {row.trackingNo ? ` · ${row.trackingNo}` : ''}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </Card>

          <Card>
            <SectionTitle title="业务时间线" hint="由后端事件写入，不由前端点亮" />
            <OrderTimeline events={timeline.data?.events ?? []} loading={timeline.loading} />
          </Card>
        </div>

        <aside className="detail-rail">
          <Card className="profit-panel-card">
            <ProfitPanel profit={profit} />
          </Card>

          <Card>
            <SectionTitle title="订单信息" />
            <div className="info-list">
              <div>
                <span>
                  <UserRound size={14} /> 客户
                </span>
                <strong>{order.customer.name}</strong>
              </div>
              <div>
                <span>
                  <CalendarDays size={14} /> 交期
                </span>
                <strong className={`due-${due.tone}`}>{fmtDate(order.dueDate)}</strong>
              </div>
              <div>
                <span>创建时间</span>
                <strong className="small">{fmtDateTime(order.createdAt)}</strong>
              </div>
              <div>
                <span>备注</span>
                <strong className="small">{order.note || '无'}</strong>
              </div>
            </div>
          </Card>

          <Card>
            <SectionTitle title="下一步" hint={summary.nextStep} />
            <ul className="next-list">
              {summary.allowedActions.length === 0 ? (
                <li>
                  <CheckCircle2 size={15} /> 当前没有可执行动作
                </li>
              ) : (
                summary.allowedActions.map((action) => (
                  <li key={action}>
                    <ArrowRight size={14} /> {ACTION_LABELS[action] ?? action}
                  </li>
                ))
              )}
            </ul>
            <div className="mini-metrics">
              <span>已放行 {summary.quantities.released}</span>
              <span>已包装 {summary.quantities.packed}</span>
              <span>已发货 {summary.quantities.shipped}</span>
            </div>
          </Card>

          <Card>
            <AttachmentPanel
              orderId={order.id}
              attachments={attachments.data?.items ?? []}
              onChanged={() => attachments.reload()}
            />
          </Card>

          {orderExceptions.length > 0 ? (
            <Card>
              <SectionTitle title="现场异常" hint={`${orderExceptions.length} 条`} />
              <ul className="exception-mini-list">
                {orderExceptions.map((exception) => (
                  <li key={exception.id}>
                    <span className="exception-mini-icon">
                      <AlertTriangle size={14} />
                    </span>
                    <div>
                      <strong>{exception.categoryLabel ?? exception.category}</strong>
                      <span>{exception.description}</span>
                      <small>
                        {exception.reporterName} · {fmtDateTime(exception.createdAt)}
                      </small>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </aside>
      </div>

      {modal?.type === 'purchase' && item && options.data ? (
        <PurchaseModal
          orderId={order.id}
          item={item}
          suppliers={options.data.suppliers}
          parts={options.data.parts}
          onClose={closeModal}
          onDone={done}
        />
      ) : null}
      {modal?.type === 'production' && item && options.data ? (
        <ProductionModal
          orderId={order.id}
          item={item}
          departments={options.data.departments}
          employees={options.data.employees}
          orderDueDate={order.dueDate}
          onClose={closeModal}
          onDone={done}
        />
      ) : null}
      {modal?.type === 'qcDispatch' ? (
        <ConfirmActionModal
          title="下发质检"
          subtitle="指定生产任务进入待质检"
          description={
            <>
              生产已完成 <strong>{summary.quantities.produced}</strong> 件。下发后由品控录入全合格检验结果，管理员再确认放行。
            </>
          }
          confirmLabel="下发质检"
          path={`/orders/${order.id}/dispatch-qc`}
          icon={<ShieldCheck size={16} />}
          onClose={closeModal}
          onDone={done}
        />
      ) : null}
      {modal?.type === 'qcDecision' && qcRecord ? (
        <QcDecisionModal qc={qcRecord} onClose={closeModal} onDone={done} />
      ) : null}
      {modal?.type === 'packingDispatch' ? (
        <ConfirmActionModal
          title="下发包装"
          subtitle="放行数量进入包装队列"
          description={
            <>
              已放行 <strong>{summary.quantities.released}</strong> 件，已包装 {summary.quantities.packed} 件。下发后包装人员可录入包装数量。
            </>
          }
          confirmLabel="下发包装"
          path={`/orders/${order.id}/dispatch-packing`}
          icon={<Package size={16} />}
          onClose={closeModal}
          onDone={done}
        />
      ) : null}
      {modal?.type === 'shipmentTrigger' ? (
        <ConfirmActionModal
          title="触发发货"
          subtitle="物流将看到待发货任务"
          description={
            <>
              已包装 <strong>{summary.quantities.packed}</strong> 件。触发后物流登记发货；足量后订单自动完成。
            </>
          }
          confirmLabel="触发发货"
          path={`/orders/${order.id}/trigger-shipment`}
          icon={<Send size={16} />}
          onClose={closeModal}
          onDone={done}
        />
      ) : null}
    </div>
  );
}

const ACTION_LABELS: Record<string, string> = {
  CREATE_PURCHASE: '建立采购单',
  RECORD_ARRIVAL: '等待物流登记到货',
  DISPATCH_PRODUCTION: '下发生产任务',
  RECORD_FEEDBACK: '等待生产现场反馈',
  DISPATCH_QC: '下发质检',
  RECORD_QC: '等待品控录入结果',
  DECIDE_QC: '管理员处置质检',
  DISPATCH_PACKING: '下发包装',
  RECORD_PACKING: '等待包装现场录入',
  TRIGGER_SHIPMENT: '触发发货',
  RECORD_SHIPMENT: '等待物流登记发货'
};
