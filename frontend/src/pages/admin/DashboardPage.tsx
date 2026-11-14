import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Boxes,
  CalendarClock,
  CircleDollarSign,
  ClipboardList,
  Factory,
  Plus,
  TrendingUp,
  Truck
} from 'lucide-react';
import { useAuth } from '../../app/AuthContext';
import { useAsync, useDocumentTitle } from '../../lib/hooks';
import { api } from '../../lib/api';
import type { DashboardSummary } from '../../lib/types';
import { fmtDate, fmtDateTime, fmtMoney, fmtNumber, STATUS_TONE, today } from '../../lib/format';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Progress,
  SectionTitle,
  StatusPill
} from '../../components/ui';

function greeting(): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', hour12: false }).format(new Date())
  );
  if (hour < 6) return '夜班辛苦了';
  if (hour < 12) return '早上好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

export function DashboardPage() {
  useDocumentTitle('业务看板');
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useAsync<DashboardSummary>(
    () => api.get('/dashboard/summary'),
    []
  );

  if (loading && !data) {
    return (
      <div className="stack-lg">
        <div className="page-skeleton-hero" />
        <LoadingState rows={5} />
      </div>
    );
  }
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return null;

  const totalStatus = Math.max(1, data.totalOrders);
  const maxStatus = Math.max(...data.statusCounts.map((item) => item.count), 1);

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="今日协同概览"
        title={`${greeting()}，${user?.displayName ?? ''}`}
        description={
          <>
            北京时间 {today()} · 当前有 <strong>{fmtNumber(data.activeOrders)}</strong> 张订单在流转，
            <strong>{fmtNumber(data.production.activeTasks)}</strong> 个生产任务进行中。
          </>
        }
        actions={
          <div className="header-actions fx-stagger">
            <Button variant="secondary" icon={<ClipboardList size={16} />} onClick={() => navigate('/admin/orders')}>
              全部订单
            </Button>
            <Button icon={<Plus size={16} />} onClick={() => navigate('/admin/orders/new')}>
              新建订单
            </Button>
          </div>
        }
      />

      <div className="kpi-grid">
        <Card className="kpi-card kpi-ink">
          <div className="kpi-head">
            <span className="kpi-icon">
              <ClipboardList size={19} />
            </span>
            <span className="kpi-label">订单总量</span>
          </div>
          <strong className="kpi-value">{fmtNumber(data.totalOrders)}</strong>
          <div className="kpi-foot">
            <span>进行中 {data.activeOrders}</span>
            <span className="kpi-divider" />
            <span>已完成 {data.completedOrders}</span>
          </div>
        </Card>
        <Card className="kpi-card">
          <div className="kpi-head">
            <span className="kpi-icon kpi-icon-teal">
              <Factory size={19} />
            </span>
            <span className="kpi-label">生产在途</span>
          </div>
          <strong className="kpi-value">{fmtNumber(data.production.activeTasks)}</strong>
          <div className="kpi-foot">
            <span>已完成任务 {data.production.completedTasks}</span>
          </div>
        </Card>
        <Card className="kpi-card">
          <div className="kpi-head">
            <span className="kpi-icon kpi-icon-orange">
              <TrendingUp size={19} />
            </span>
            <span className="kpi-label">预计利润</span>
          </div>
          <strong className="kpi-value kpi-money">{fmtMoney(data.profit.profit)}</strong>
          <div className="kpi-foot">
            <span>毛利率 {data.profit.margin}%</span>
          </div>
        </Card>
        <Card className="kpi-card">
          <div className="kpi-head">
            <span className="kpi-icon kpi-icon-blue">
              <Boxes size={19} />
            </span>
            <span className="kpi-label">库存台账</span>
          </div>
          <strong className="kpi-value">{fmtNumber(data.inventory.partQuantity + data.inventory.productQuantity)}</strong>
          <div className="kpi-foot">
            <span>配件 {data.inventory.partKinds} 类 · 成品 {data.inventory.productKinds} 类</span>
          </div>
        </Card>
      </div>

      <div className="dashboard-grid">
        <div className="dashboard-main">
          <Card className="status-card">
            <SectionTitle
              title="订单状态分布"
              hint="按主状态汇总，点击进入对应列表"
              action={
                <button type="button" className="text-link" onClick={() => navigate('/admin/orders')}>
                  查看全部 <ArrowRight size={14} />
                </button>
              }
            />
            <div className="status-bar" aria-hidden="true">
              {data.statusCounts.map((item) => (
                <span
                  key={item.status}
                  className={`status-segment tone-${STATUS_TONE[item.status]}`}
                  style={{ width: `${Math.max(2, (item.count / totalStatus) * 100)}%` }}
                  title={`${item.label} ${item.count}`}
                />
              ))}
            </div>
            <div className="status-legend">
              {data.statusCounts.map((item) => (
                <button
                  type="button"
                  key={item.status}
                  className="status-legend-item"
                  onClick={() => navigate(`/admin/orders?status=${item.status}`)}
                >
                  <span className={`legend-dot tone-${STATUS_TONE[item.status]}`} />
                  <span className="legend-label">{item.label}</span>
                  <strong>{item.count}</strong>
                  <span className="legend-track">
                    <span
                      className={`legend-fill tone-${STATUS_TONE[item.status]}`}
                      style={{ width: `${Math.max(3, (item.count / maxStatus) * 100)}%` }}
                    />
                  </span>
                </button>
              ))}
            </div>
          </Card>

          <Card>
            <SectionTitle
              title="生产进度"
              hint="只统计已下发且未完成质检的任务"
              action={
                <button type="button" className="text-link" onClick={() => navigate('/admin/orders?status=IN_PRODUCTION')}>
                  生产中的订单 <ArrowRight size={14} />
                </button>
              }
            />
            {data.production.progress.length === 0 ? (
              <EmptyState
                title="暂无进行中的生产任务"
                description="采购到齐后，在订单详情中下发生产。"
                icon={<Factory size={26} />}
              />
            ) : (
              <div className="progress-list">
                {data.production.progress.map((task) => (
                  <button
                    type="button"
                    key={`${task.orderId}-${task.processName}`}
                    className="progress-row"
                    onClick={() => navigate(`/admin/orders/${task.orderId}`)}
                  >
                    <div className="progress-row-head">
                      <span className="mono">{task.orderNo}</span>
                      <span className="progress-product">{task.productName}</span>
                      <span className="progress-dept">{task.departmentName}</span>
                      <span className="progress-count">
                        {task.producedQty}/{task.quantity}
                      </span>
                    </div>
                    <Progress value={task.producedQty} max={task.quantity} />
                    <div className="progress-row-foot">
                      <span>{task.processName}</span>
                      <span>{task.percent}%</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <SectionTitle
              title="最近订单"
              hint="最新创建的业务订单"
              action={
                <button type="button" className="text-link" onClick={() => navigate('/admin/orders')}>
                  订单列表 <ArrowRight size={14} />
                </button>
              }
            />
            {data.recentOrders.length === 0 ? (
              <EmptyState
                title="还没有订单"
                description="创建第一张合成订单，开始完整闭环演示。"
                icon={<ClipboardList size={26} />}
                action={<Button size="sm" icon={<Plus size={14} />} onClick={() => navigate('/admin/orders/new')}>新建订单</Button>}
              />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>订单号</th>
                      <th>客户 / 产品</th>
                      <th>数量</th>
                      <th>交期</th>
                      <th>状态</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentOrders.map((order) => (
                      <tr key={order.id} onClick={() => navigate(`/admin/orders/${order.id}`)} className="row-clickable">
                        <td className="mono">{order.orderNo}</td>
                        <td>
                          <strong>{order.customerName}</strong>
                          <span className="cell-sub">{order.productName}</span>
                        </td>
                        <td className="num">{order.quantity}</td>
                        <td>{fmtDate(order.dueDate)}</td>
                        <td>
                          <StatusPill status={order.status} label={order.statusLabel} tone={STATUS_TONE[order.status]} />
                        </td>
                        <td className="row-arrow">
                          <ArrowRight size={15} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <aside className="dashboard-rail">
          <Card className="profit-card">
            <SectionTitle
              title="订单利润口径"
              hint="预计值，非财务结算"
              action={
                <button type="button" className="text-link" onClick={() => navigate('/admin/finance')}>
                  查看订单流水 <ArrowRight size={14} />
                </button>
              }
            />
            <div className="profit-hero">
              <span>预计利润</span>
              <strong>{fmtMoney(data.profit.profit)}</strong>
              <span className="profit-margin">
                <CircleDollarSign size={14} /> 毛利率 {data.profit.margin}%
              </span>
            </div>
            <div className="profit-breakdown">
              <div>
                <span>销售额</span>
                <strong>{fmtMoney(data.profit.sales)}</strong>
              </div>
              <div>
                <span>采购成本</span>
                <strong>− {fmtMoney(data.profit.purchaseCost)}</strong>
              </div>
              <div>
                <span>生产成本</span>
                <strong>− {fmtMoney(data.profit.productionCost)}</strong>
              </div>
            </div>
            <p className="profit-note">销售额 − 采购成本 − 电镀成本 − 已反馈生产完成量成本</p>
          </Card>

          <Card>
            <SectionTitle title="临期订单" hint="未来 7 天内到期" />
            {data.dueSoon.length === 0 ? (
              <p className="muted-note">未来 7 天没有临期订单。</p>
            ) : (
              <div className="due-list">
                {data.dueSoon.map((order) => (
                  <button
                    type="button"
                    key={order.orderId}
                    className="due-item"
                    onClick={() => navigate(`/admin/orders/${order.orderId}`)}
                  >
                    <span className={`due-badge ${order.daysLeft < 0 ? 'due-danger' : order.daysLeft <= 2 ? 'due-warn' : ''}`}>
                      {order.daysLeft < 0 ? `逾期${Math.abs(order.daysLeft)}天` : order.daysLeft === 0 ? '今天' : `${order.daysLeft}天`}
                    </span>
                    <span className="due-copy">
                      <strong className="mono">{order.orderNo}</strong>
                      <small>{order.customerName}</small>
                    </span>
                    <CalendarClock size={15} className="due-icon" />
                  </button>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <SectionTitle title="库存概览" hint="手工台账，不自动扣减" />
            <div className="inventory-snapshot">
              <div>
                <span>配件</span>
                <strong>{fmtNumber(data.inventory.partQuantity)}</strong>
                <small>{data.inventory.partKinds} 类有库存</small>
              </div>
              <div>
                <span>成品</span>
                <strong>{fmtNumber(data.inventory.productQuantity)}</strong>
                <small>{data.inventory.productKinds} 类有库存</small>
              </div>
            </div>
            <Button variant="secondary" size="sm" className="full-width" onClick={() => navigate('/admin/inventory')}>
              打开库存台账 <ArrowRight size={14} />
            </Button>
          </Card>

          <Card className="notice-rail">
            <SectionTitle title="待处理提醒" hint={`未读通知 ${data.unreadNotifications} 条`} />
            <div className="notice-rail-body">
              <span className="notice-icon">
                <Truck size={18} />
              </span>
              <p>物流到货、生产反馈、质检录入与订单完成会推送到通知中心。</p>
            </div>
            <Button variant="ghost" size="sm" className="full-width" onClick={() => navigate('/admin/notifications')}>
              查看通知 <ArrowRight size={14} />
            </Button>
          </Card>
        </aside>
      </div>
      <p className="page-footnote">看板数据来自真实业务表，统计时间为 {fmtDateTime(new Date().toISOString())}（北京时间）。</p>
    </div>
  );
}
