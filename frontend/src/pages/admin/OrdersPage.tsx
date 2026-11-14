import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Archive, ArrowRight, Download, Filter, Plus, Search, X } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { useAsync, useDocumentTitle, useIntentKey } from '../../lib/hooks';
import type { OrderListItem, Pagination } from '../../lib/types';
import { fmtDate, fmtMoney, STATUS_TONE, dueLabel } from '../../lib/format';
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Modal,
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
  const [pageSize, setPageSize] = useState(20);
  const [showArchived, setShowArchived] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archivePreview, setArchivePreview] = useState<{ month: string; count: number } | null>(null);
  const [archiveMonth, setArchiveMonth] = useState(previousMonth());
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [batching, setBatching] = useState(false);
  const { key: batchKey, renew: renewBatchKey } = useIntentKey('batch-ship-');

  useEffect(() => {
    setSelected([]);
  }, [page, pageSize, status, keyword, showArchived]);

  useEffect(() => {
    const next = params.get('status') ?? '';
    setStatus(next);
    setPage(1);
  }, [params]);

  const { data, loading, error, reload } = useAsync<OrderListResponse>(
    () =>
      api.get(
        `/orders?page=${page}&pageSize=${pageSize}${status ? `&status=${encodeURIComponent(status)}` : ''}${
          keyword ? `&keyword=${encodeURIComponent(keyword)}` : ''
        }${showArchived ? '&archived=1' : ''}`
      ),
    [page, pageSize, status, keyword, showArchived]
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

  useEffect(() => {
    if (!archiveOpen) return;
    setArchiveLoading(true);
    api
      .get<{ month: string; count: number }>(`/orders/archive-preview?month=${archiveMonth}`)
      .then((result) => setArchivePreview({ month: result.month, count: result.count }))
      .catch((reason) => toast.error('读取归档预览失败', errorMessage(reason)))
      .finally(() => setArchiveLoading(false));
  }, [archiveOpen, archiveMonth, toast]);

  const runArchive = async () => {
    setArchiving(true);
    try {
      const result = await api.post<{
        month: string;
        count: number;
        archived: number;
        xlsxPath: string | null;
        message?: string;
      }>('/orders/archive-month', { month: archiveMonth });
      if (result.archived > 0) {
        toast.success('归档完成', `${result.month} 共 ${result.archived} 张订单已移出列表，月报写入过去订单目录`);
      } else {
        toast.info(result.message ?? '没有可归档的订单');
      }
      setArchiveOpen(false);
      setArchivePreview(null);
      setPage(1);
      reload();
    } catch (reason) {
      toast.error('归档失败', errorMessage(reason));
    } finally {
      setArchiving(false);
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
            <Button variant="ghost" icon={<Archive size={16} />} onClick={() => setArchiveOpen(true)}>
              归档上月
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
        <label className="filter-toggle">
          <input type="checkbox" checked={showArchived} onChange={(event) => { setShowArchived(event.target.checked); setPage(1); }} />
          查看已归档
        </label>
        <span className="filter-result">
          {pagination ? (
            <>
              共 <strong>{pagination.total}</strong> 张{showArchived ? '归档订单' : '订单'}
            </>
          ) : null}
        </span>
      </section>

      {selected.length > 0 ? (
        <div className="batch-bar">
          <span>
            已选择 <strong>{selected.length}</strong> 张包装中的订单
          </span>
          <Button size="sm" variant="dark" loading={batching} className="fx-morph" data-fx-particles onClick={() => void batchConfirmShipment()}>
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
          {pagination ? (
            <div className="pagination">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage(1)}
              >
                首页
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                上一页
              </Button>
              <span className="pagination-pages">
                {pageNumbers(pagination.page, pagination.totalPages).map((value, index) =>
                  value === null ? (
                    <span key={`gap-${index}`} className="pagination-gap">
                      …
                    </span>
                  ) : (
                    <button
                      key={value}
                      type="button"
                      className={value === pagination.page ? 'pagination-page is-current' : 'pagination-page'}
                      onClick={() => setPage(value)}
                    >
                      {value}
                    </button>
                  )
                )}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= pagination.totalPages}
                onClick={() => setPage((value) => Math.min(pagination.totalPages, value + 1))}
              >
                下一页
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= pagination.totalPages}
                onClick={() => setPage(pagination.totalPages)}
              >
                末页
              </Button>
              <span className="pagination-summary">
                共 {pagination.total} 条 · 第 {pagination.page}/{pagination.totalPages} 页
              </span>
              <label className="pagination-size">
                每页
                <Select
                  value={String(pageSize)}
                  onChange={(event) => {
                    setPageSize(Number(event.target.value));
                    setPage(1);
                  }}
                  aria-label="每页显示条数"
                >
                  <option value="10">10</option>
                  <option value="20">20</option>
                  <option value="50">50</option>
                </Select>
                条
              </label>
            </div>
          ) : null}
        </>
      )}

      <Modal
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        title="归档上月已完成订单"
        subtitle="先把月报写入「过去订单」目录，再把订单移出当前列表；数据仍可在归档视图与审计中查询。"
        footer={
          <>
            <Button variant="ghost" onClick={() => setArchiveOpen(false)}>
              取消
            </Button>
            <Button
              loading={archiving}
              disabled={archiveLoading || !archivePreview || archivePreview.count === 0}
              className="fx-morph"
              data-fx-particles
              onClick={() => void runArchive()}
            >
              确认归档
            </Button>
          </>
        }
      >
        <div className="stack">
          <label className="archive-month">
            归档月份
            <TextInput
              type="month"
              value={archiveMonth}
              max={currentMonth()}
              onChange={(event) => setArchiveMonth(event.target.value)}
            />
          </label>
          {archiveLoading ? (
            <p className="muted-note">正在统计该月完成订单…</p>
          ) : archivePreview ? (
            <>
              <p>
                归档月份：<strong>{archivePreview.month}</strong>
              </p>
              <p>
                可归档已完成订单：<strong>{archivePreview.count}</strong> 张
              </p>
              {archivePreview.count === 0 ? (
                <p className="muted-note">该月没有可归档订单，或已经归档过。</p>
              ) : (
                <p className="muted-note">
                  月报会生成为 <code>{archivePreview.month}-已完成订单.xlsx</code> 与同名 CSV；
                  归档后这些订单不再出现在「全部订单」，可勾选「查看已归档」查看。
                </p>
              )}
            </>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}

function previousMonth(): string {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function pageNumbers(current: number, total: number): Array<number | null> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const pages = new Set<number>([1, total, current - 1, current, current + 1]);
  if (current <= 3) [2, 3, 4].forEach((value) => pages.add(value));
  if (current >= total - 2) [total - 3, total - 2, total - 1].forEach((value) => pages.add(value));
  const sorted = [...pages].filter((value) => value >= 1 && value <= total).sort((a, b) => a - b);
  const result: Array<number | null> = [];
  sorted.forEach((value, index) => {
    if (index > 0 && value - sorted[index - 1]! > 1) result.push(null);
    result.push(value);
  });
  return result;
}
