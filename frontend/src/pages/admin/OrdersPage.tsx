import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Download, Filter, Plus, Search, X } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { useAsync, useDocumentTitle, useIntentKey } from '../../lib/hooks';
import type { OrderListItem, Pagination } from '../../lib/types';
import { fmtDate, fmtMoney, STATUS_TONE, dueLabel } from '../../lib/format';
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Select,
  StatusPill,
  TextInput,
  useToast
} from '../../components/ui';

const STATUS_OPTIONS = [
  ['', '全部状态'],
  ['PENDING_PURCHASE', '待采购'],
  ['PURCHASING', '采购中'],
  ['IN_PRODUCTION', '生产中'],
  ['PENDING_QC', '待质检'],
  ['QC_DONE', '质检已放行'],
  ['PACKING', '包装中'],
  ['SHIPPING', '待发货'],
  ['COMPLETED', '已完成'],
  ['CANCELLED', '已撤销']
] as const;

interface OrderListResponse {
  items: OrderListItem[];
  pagination: Pagination;
}

export function OrdersPage() {
  useDocumentTitle('订单协同');
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const toast = useToast();
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [keywordInput, setKeywordInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [batching, setBatching] = useState(false);
  const { key: batchKey, renew: renewBatchKey } = useIntentKey('batch-ship-');

  useEffect(() => {
    setSelected([]);
  }, [page, status, keyword]);

  useEffect(() => {
    const next = params.get('status') ?? '';
    setStatus(next);
    setPage(1);
  }, [params]);

  const { data, loading, error, reload } = useAsync<OrderListResponse>(
    () =>
      api.get(
        `/orders?page=${page}&pageSize=20${status ? `&status=${encodeURIComponent(status)}` : ''}${
          keyword ? `&keyword=${encodeURIComponent(keyword)}` : ''
        }`
      ),
    [page, status, keyword]
  );

  const applySearch = () => {
    setKeyword(keywordInput.trim());
    setPage(1);
  };

  const clear = () => {
    setKeywordInput('');
    setKeyword('');
    setStatus('');
    setPage(1);
  };

  const exportXlsx = async () => {
    setExporting(true);
    try {
      const { blob, filename } = await api.download(
        `/exports/orders.xlsx${status ? `?status=${encodeURIComponent(status)}` : ''}${
          keyword ? `${status ? '&' : '?'}keyword=${encodeURIComponent(keyword)}` : ''
        }`
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success('导出完成', `文件已生成：${filename}（${(blob.size / 1024).toFixed(1)} KB）`);
    } catch (reason) {
      toast.error('导出失败', errorMessage(reason));
    } finally {
      setExporting(false);
    }
  };

  const items = data?.items ?? [];
  const pagination = data?.pagination;
  const hasFilter = Boolean(status || keyword);
  const selectableItems = items.filter((order) => order.status === 'PACKING');
  const selectedSet = new Set(selected);

  const toggleSelected = (orderId: string) => {
    setSelected((current) =>
      current.includes(orderId) ? current.filter((id) => id !== orderId) : [...current, orderId]
    );
  };

  const toggleAll = () => {
    if (selectableItems.every((order) => selectedSet.has(order.id))) {
      setSelected((current) => current.filter((id) => !selectableItems.some((order) => order.id === id)));
    } else {
      setSelected((current) => [
        ...current,
        ...selectableItems.map((order) => order.id).filter((id) => !current.includes(id))
      ]);
    }
  };

  const batchConfirmShipment = async () => {
    if (selected.length === 0) return;
    setBatching(true);
    try {
      const result = await api.post<{ count: number; message: string }>(
        '/orders/batch/confirm-shipment',
        { orderIds: selected },
        batchKey
      );
      toast.success('批量确认发货成功', result.message);
      setSelected([]);
      renewBatchKey();
      reload();
    } catch (reason) {
      toast.error('批量确认发货失败', errorMessage(reason));
    } finally {
      setBatching(false);
    }
  };

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="ORDER COLLABORATION"
        title="订单协同"
        description="从建单到发货的完整业务记录；所有金额为人民币不含税快照。"
        actions={
          <>
            <Button variant="secondary" icon={<Download size={16} />} loading={exporting} onClick={() => void exportXlsx()}>
              导出 xlsx
            </Button>
            <Button icon={<Plus size={16} />} onClick={() => navigate('/admin/orders/new')}>
              新建订单
            </Button>
          </>
        }
      />

      <section className="filter-bar">
        <div className="filter-search">
          <Search size={16} />
          <TextInput
            value={keywordInput}
            onChange={(event) => setKeywordInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') applySearch();
            }}
            placeholder="搜索订单号、客户或产品"
            aria-label="搜索订单"
          />
          {keywordInput ? (
            <button type="button" className="filter-clear" onClick={() => setKeywordInput('')} aria-label="清除搜索">
              <X size={14} />
            </button>
          ) : null}
        </div>
        <div className="filter-select">
          <Filter size={15} />
          <Select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
            aria-label="按状态筛选"
          >
            {STATUS_OPTIONS.map(([value, label]) => (
              <option key={value || 'all'} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <Button variant="dark" size="sm" onClick={applySearch}>
          查询
        </Button>
        {hasFilter ? (
          <button type="button" className="text-link filter-reset" onClick={clear}>
            清除筛选
          </button>
        ) : null}
        <span className="filter-result">
          {pagination ? (
            <>
              共 <strong>{pagination.total}</strong> 张订单
            </>
          ) : null}
        </span>
      </section>

      {selected.length > 0 ? (
        <div className="batch-bar">
          <span>
            已选择 <strong>{selected.length}</strong> 张包装中的订单
          </span>
          <Button size="sm" variant="dark" loading={batching} onClick={() => void batchConfirmShipment()}>
            批量确认发货
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
            清空选择
          </Button>
        </div>
      ) : null}

      {loading && !data ? (
        <LoadingState rows={6} />
      ) : error && !data ? (
        <ErrorState error={error} onRetry={reload} />
      ) : items.length === 0 ? (
        <EmptyState
          title={hasFilter ? '没有匹配的订单' : '还没有业务订单'}
          description={hasFilter ? '调整筛选条件，或清除筛选查看全部订单。' : '从一张合成订单开始，走完采购、生产、质检、包装和发货。'}
          action={
            hasFilter ? (
              <Button variant="secondary" size="sm" onClick={clear}>
                清除筛选
              </Button>
            ) : (
              <Button size="sm" icon={<Plus size={14} />} onClick={() => navigate('/admin/orders/new')}>
                新建订单
              </Button>
            )
          }
        />
      ) : (
        <>
          <div className="table-wrap card-table">
            <table className="data-table order-table">
              <thead>
                <tr>
                  <th className="check-col">
                    <input
                      type="checkbox"
                      aria-label="全选可批量确认发货的订单"
                      checked={selectableItems.length > 0 && selectableItems.every((order) => selectedSet.has(order.id))}
                      onChange={toggleAll}
                      disabled={selectableItems.length === 0}
                    />
                  </th>
                  <th>订单号</th>
                  <th>客户 / 产品</th>
                  <th className="num">数量</th>
                  <th className="num">销售额</th>
                  <th>交期</th>
                  <th>状态</th>
                  <th>创建时间</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((order) => {
                  const due = dueLabel(order.dueDate);
                  return (
                    <tr key={order.id} className="row-clickable" onClick={() => navigate(`/admin/orders/${order.id}`)}>
                      <td className="check-cell" onClick={(event) => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`选择订单 ${order.orderNo}`}
                          checked={selectedSet.has(order.id)}
                          disabled={order.status !== 'PACKING'}
                          onChange={() => toggleSelected(order.id)}
                        />
                      </td>
                      <td>
                        <span className="mono order-no">{order.orderNo}</span>
                        {order.note ? <span className="cell-sub truncate">{order.note}</span> : null}
                      </td>
                      <td>
                        <strong>{order.customerName}</strong>
                        <span className="cell-sub">
                          {order.productName}
                          {order.spec ? ` · ${order.spec}` : ''}
                        </span>
                      </td>
                      <td className="num">{order.quantity}</td>
                      <td className="num money">{fmtMoney(order.amount)}</td>
                      <td>
                        <span className={`due-text due-${due.tone}`}>{due.text}</span>
                        <span className="cell-sub">{fmtDate(order.dueDate)}</span>
                      </td>
                      <td>
                        <StatusPill status={order.status} label={order.statusLabel} tone={STATUS_TONE[order.status]} />
                      </td>
                      <td className="muted">{fmtDate(order.createdAt)}</td>
                      <td className="row-arrow">
                        <ArrowRight size={15} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {pagination && pagination.totalPages > 1 ? (
            <div className="pagination">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                上一页
              </Button>
              <span>
                第 {pagination.page} / {pagination.totalPages} 页 · 共 {pagination.total} 条
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= pagination.totalPages}
                onClick={() => setPage((value) => Math.min(pagination.totalPages, value + 1))}
              >
                下一页
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
