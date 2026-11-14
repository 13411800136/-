import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CircleDollarSign, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { fmtDateTime, fmtMoney, STATUS_TONE } from '../../lib/format';
import { useAsync, useDocumentTitle } from '../../lib/hooks';
import type { OrderStatus } from '../../lib/types';
import { Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, StatusPill, useToast } from '../../components/ui';

interface FinanceOrder {
  id: string;
  orderNo: string;
  customerName: string;
  status: OrderStatus;
  statusLabel: string;
  cancelled: boolean;
  dueDate: string;
  createdAt: string;
  quantity: number;
  sales: string;
  purchaseCost: string;
  productionCost: string;
  profit: string;
  margin: string;
  salesCents: number;
  purchaseCents: number;
  productionCents: number;
  profitCents: number;
}

interface FinanceSummary {
  generatedAt: string;
  businessDate: string;
  scopeNote: string;
  totals: {
    orders: number;
    cancelledOrders: number;
    sales: string;
    purchaseCost: string;
    productionCost: string;
    profit: string;
    margin: string;
    salesCents: number;
    purchaseCents: number;
    productionCents: number;
    profitCents: number;
  };
  orders: FinanceOrder[];
}

export function FinancePage() {
  useDocumentTitle('订单流水');
  const navigate = useNavigate();
  const toast = useToast();
  const [refreshing, setRefreshing] = useState(false);
  const summary = useAsync<FinanceSummary>(() => api.get('/finance/summary'), []);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await summary.reload();
      toast.success('已刷新', '数据来自当前业务表实时汇总');
    } catch (reason) {
      toast.error('刷新失败', errorMessage(reason));
    } finally {
      setRefreshing(false);
    }
  };

  const data = summary.data;
  const totals = data?.totals;
  const maxCents = totals ? Math.max(totals.salesCents, 1) : 1;

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="ORDER CASH FLOW"
        title="订单流水"
        description="按订单实时汇总销售额、采购成本与已反馈生产完成量成本；撤销订单单独列出，不计入合计。"
        actions={
          <>
            <Button variant="secondary" icon={<RefreshCw size={16} />} loading={refreshing} onClick={() => void refresh()}>
              刷新
            </Button>
            <Button variant="ghost" icon={<ArrowRight size={16} />} onClick={() => navigate('/admin')}>
              返回看板
            </Button>
          </>
        }
      />

      {summary.loading && !data ? (
        <LoadingState rows={6} />
      ) : summary.error && !data ? (
        <ErrorState error={summary.error} onRetry={summary.reload} />
      ) : !data || !totals ? (
        <EmptyState title="暂无流水数据" description="创建订单后，这里会按订单汇总实时成本与利润。" />
      ) : (
        <>
          <div className="kpi-grid finance-kpis">
            <div className="kpi-card">
              <div className="kpi-head">
                <span className="kpi-label">销售额</span>
                <span className="kpi-icon kpi-icon-teal">
                  <TrendingUp size={16} />
                </span>
              </div>
              <strong className="kpi-value kpi-money">{fmtMoney(totals.sales)}</strong>
              <span className="kpi-foot">{totals.orders} 张有效订单</span>
            </div>
            <div className="kpi-card">
              <div className="kpi-head">
                <span className="kpi-label">采购成本</span>
                <span className="kpi-icon kpi-icon-orange">
                  <TrendingDown size={16} />
                </span>
              </div>
              <strong className="kpi-value kpi-money">{fmtMoney(totals.purchaseCost)}</strong>
              <span className="kpi-foot">来自采购单快照</span>
            </div>
            <div className="kpi-card">
              <div className="kpi-head">
                <span className="kpi-label">生产完成成本</span>
                <span className="kpi-icon kpi-icon-blue">
                  <CircleDollarSign size={16} />
                </span>
              </div>
              <strong className="kpi-value kpi-money">{fmtMoney(totals.productionCost)}</strong>
              <span className="kpi-foot">仅计入已反馈完成量</span>
            </div>
            <div className="kpi-card kpi-ink">
              <div className="kpi-head">
                <span className="kpi-label">预计利润</span>
                <span className="kpi-icon">
                  <CircleDollarSign size={16} />
                </span>
              </div>
              <strong className={`kpi-value kpi-money ${totals.profitCents < 0 ? 'negative' : ''}`}>
                {fmtMoney(totals.profit)}
              </strong>
              <span className="kpi-foot">毛利率 {totals.margin}%</span>
            </div>
          </div>

          <Card>
            <div className="finance-waterfall" aria-label="销售额到利润的构成">
              <div className="finance-bar">
                <span className="finance-bar-label">销售额</span>
                <div className="finance-bar-track">
                  <span className="finance-bar-fill tone-sales" style={{ width: '100%' }} />
                </div>
                <strong className="finance-bar-value">{fmtMoney(totals.sales)}</strong>
              </div>
              <div className="finance-bar">
                <span className="finance-bar-label">采购成本</span>
                <div className="finance-bar-track">
                  <span
                    className="finance-bar-fill tone-cost"
                    style={{ width: `${Math.min(100, (totals.purchaseCents / maxCents) * 100)}%` }}
                  />
                </div>
                <strong className="finance-bar-value">− {fmtMoney(totals.purchaseCost)}</strong>
              </div>
              <div className="finance-bar">
                <span className="finance-bar-label">生产成本</span>
                <div className="finance-bar-track">
                  <span
                    className="finance-bar-fill tone-cost"
                    style={{ width: `${Math.min(100, (totals.productionCents / maxCents) * 100)}%` }}
                  />
                </div>
                <strong className="finance-bar-value">− {fmtMoney(totals.productionCost)}</strong>
              </div>
              <div className="finance-bar finance-bar-total">
                <span className="finance-bar-label">预计利润</span>
                <div className="finance-bar-track">
                  <span
                    className={`finance-bar-fill ${totals.profitCents < 0 ? 'tone-negative' : 'tone-profit'}`}
                    style={{ width: `${Math.min(100, (Math.abs(totals.profitCents) / maxCents) * 100)}%` }}
                  />
                </div>
                <strong className="finance-bar-value">{fmtMoney(totals.profit)}</strong>
              </div>
            </div>
            <p className="muted-note">{data.scopeNote}</p>
          </Card>

          <Card>
            <div className="finance-table-head">
              <div>
                <h2>按订单明细</h2>
                <p>
                  生成于 {fmtDateTime(data.generatedAt)} · 业务日 {data.businessDate} · 撤销 {totals.cancelledOrders} 张不计入合计
                </p>
              </div>
            </div>
            <div className="table-wrap">
              <table className="data-table finance-table">
                <thead>
                  <tr>
                    <th>订单号</th>
                    <th>客户 / 状态</th>
                    <th className="num">数量</th>
                    <th className="num">销售额</th>
                    <th className="num">采购成本</th>
                    <th className="num">生产成本</th>
                    <th className="num">预计利润</th>
                    <th className="num">毛利率</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.orders.map((row) => (
                    <tr
                      key={row.id}
                      className="row-clickable"
                      onClick={() => navigate(`/admin/orders/${row.id}`)}
                    >
                      <td>
                        <span className="mono order-no">{row.orderNo}</span>
                      </td>
                      <td>
                        <span className="cell-sub">{row.customerName}</span>
                        <StatusPill status={row.status} label={row.statusLabel} tone={STATUS_TONE[row.status]} />
                      </td>
                      <td className="num">{row.quantity}</td>
                      <td className="num money">{fmtMoney(row.sales)}</td>
                      <td className="num money">{fmtMoney(row.purchaseCost)}</td>
                      <td className="num money">{fmtMoney(row.productionCost)}</td>
                      <td className={`num money ${Number(row.profit) < 0 ? 'negative' : ''}`}>{fmtMoney(row.profit)}</td>
                      <td className="num">{row.margin}%</td>
                      <td className="num">
                        <ArrowRight size={14} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}