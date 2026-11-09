import { useEffect, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Download, History, PackagePlus, Search, SlidersHorizontal } from 'lucide-react';
import { api, errorMessage, isUnknownResult } from '../../lib/api';
import { fmtDateTime, fmtNumber } from '../../lib/format';
import { useAsync, useDocumentTitle, useIntentKey } from '../../lib/hooks';
import type { InventoryLog, PartInventoryItem, ProductInventoryItem } from '../../lib/types';
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
  Tabs,
  TextInput,
  useToast
} from '../../components/ui';

type Tab = 'parts' | 'products';

export function InventoryPage() {
  useDocumentTitle('库存台账');
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('parts');
  const [exporting, setExporting] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [adjusting, setAdjusting] = useState<
    | { mode: 'part'; item: PartInventoryItem }
    | { mode: 'product'; item: ProductInventoryItem | null }
    | null
  >(null);
  const [logs, setLogs] = useState<
    | { mode: 'part'; id: string; name: string }
    | { mode: 'product'; id: string; name: string }
    | null
  >(null);

  const parts = useAsync<{ items: PartInventoryItem[] }>(
    () => api.get(`/inventory/parts${search ? `?search=${encodeURIComponent(search)}` : ''}`),
    [search]
  );
  const products = useAsync<{ items: ProductInventoryItem[] }>(
    () => api.get(`/inventory/products${search ? `?search=${encodeURIComponent(search)}` : ''}`),
    [search]
  );

  const active = tab === 'parts' ? parts : products;
  const refresh = () => {
    parts.reload();
    products.reload();
  };

  const exportInventory = async () => {
    setExporting(true);
    try {
      const { blob, filename } = await api.download('/exports/inventory.xlsx');
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success('库存导出台账已生成', filename);
    } catch (reason) {
      toast.error('库存导出失败', errorMessage(reason));
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    setSearchInput('');
    setSearch('');
  }, [tab]);

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="INVENTORY LEDGER"
        title="库存台账"
        description="手工增减、原因留痕、非负约束。到货、投产、包装和发货都不会自动扣减库存。"
        actions={
          <>
            <Button variant="secondary" icon={<Download size={16} />} loading={exporting} onClick={() => void exportInventory()}>
              导出库存 xlsx
            </Button>
            {tab === 'products' ? (
              <Button icon={<PackagePlus size={16} />} onClick={() => setAdjusting({ mode: 'product', item: null })}>
                新建成品库存
              </Button>
            ) : (
              <span className="hint-chip">
                <SlidersHorizontal size={14} /> 从下方选择配件调整
              </span>
            )}
          </>
        }
      />

      <div className="inventory-toolbar">
        <Tabs
          items={[
            { value: 'parts', label: '配件库存', count: parts.data?.items.length },
            { value: 'products', label: '成品库存', count: products.data?.items.length }
          ]}
          value={tab}
          onChange={(value) => setTab(value as Tab)}
        />
        <div className="filter-search inventory-search">
          <Search size={16} />
          <TextInput
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') setSearch(searchInput.trim());
            }}
            placeholder={tab === 'parts' ? '搜索配件名称、编码或规格' : '搜索成品名称或规格'}
          />
          <Button variant="dark" size="sm" onClick={() => setSearch(searchInput.trim())}>
            查询
          </Button>
        </div>
      </div>

      <Alert tone="info" title="并发安全说明">
        库存调整在数据库事务中使用原子条件更新（quantity + delta ≥ 0），同一身份首次创建由唯一约束保护；不同请求同时扣减不会丢更新，也不会出现负库存。
      </Alert>

      {active.loading && !active.data ? (
        <LoadingState rows={6} />
      ) : active.error && !active.data ? (
        <ErrorState error={active.error} onRetry={active.reload} />
      ) : tab === 'parts' ? (
        <PartTable
          items={parts.data?.items ?? []}
          onAdjust={(item) => setAdjusting({ mode: 'part', item })}
          onLogs={(item) => setLogs({ mode: 'part', id: item.partId, name: item.name })}
          onRefresh={refresh}
        />
      ) : (
        <ProductTable
          items={products.data?.items ?? []}
          onAdjust={(item) => setAdjusting({ mode: 'product', item })}
          onLogs={(item) => setLogs({ mode: 'product', id: item.inventoryId, name: item.productName })}
          onCreate={() => setAdjusting({ mode: 'product', item: null })}
        />
      )}

      {adjusting ? (
        <AdjustModal
          state={adjusting}
          onClose={() => setAdjusting(null)}
          onDone={() => {
            setAdjusting(null);
            refresh();
            toast.success('库存已更新', '流水与审计已同步写入');
          }}
        />
      ) : null}
      {logs ? <LogsModal state={logs} onClose={() => setLogs(null)} /> : null}
    </div>
  );
}

function PartTable({
  items,
  onAdjust,
  onLogs,
  onRefresh
}: {
  items: PartInventoryItem[];
  onAdjust: (item: PartInventoryItem) => void;
  onLogs: (item: PartInventoryItem) => void;
  onRefresh: () => void;
}) {
  if (items.length === 0) {
    return <EmptyState title="没有配件" description="先在基础数据中建立配件，再回到此处调整库存。" />;
  }
  return (
    <div className="table-wrap card-table">
      <table className="data-table">
        <thead>
          <tr>
            <th>配件</th>
            <th>规格</th>
            <th className="num">现存量</th>
            <th className="num">版本</th>
            <th>最近更新</th>
            <th>状态</th>
            <th className="actions-col">操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.partId}>
              <td>
                <strong>{item.name}</strong>
                <span className="cell-sub mono">{item.code}</span>
              </td>
              <td className="muted">{item.spec || '—'}</td>
              <td className="num">
                <strong className={item.quantity === 0 ? 'muted' : 'qty-strong'}>{fmtNumber(item.quantity)}</strong>
                <span className="cell-sub">{item.unit}</span>
              </td>
              <td className="num muted">{item.version || '—'}</td>
              <td className="muted">{item.updatedAt ? fmtDateTime(item.updatedAt) : '尚无库存记录'}</td>
              <td>{item.active ? <span className="soft-badge">启用</span> : <span className="soft-badge soft-badge-off">停用</span>}</td>
              <td>
                <div className="row-actions">
                  <Button size="sm" variant="secondary" onClick={() => onAdjust(item)}>
                    调整
                  </Button>
                  <button type="button" className="icon-button" onClick={() => onLogs(item)} aria-label="查看流水" title="查看流水">
                    <History size={16} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="table-refresh" onClick={onRefresh}>
        刷新数据
      </button>
    </div>
  );
}

function ProductTable({
  items,
  onAdjust,
  onLogs,
  onCreate
}: {
  items: ProductInventoryItem[];
  onAdjust: (item: ProductInventoryItem) => void;
  onLogs: (item: ProductInventoryItem) => void;
  onCreate: () => void;
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        title="还没有成品库存"
        description="成品库存需手工建立；首次调整必须为正数，系统以规范化名称 + 规格作为唯一身份。"
        action={
          <Button size="sm" icon={<PackagePlus size={14} />} onClick={onCreate}>
            新建成品库存
          </Button>
        }
      />
    );
  }
  return (
    <div className="table-wrap card-table">
      <table className="data-table">
        <thead>
          <tr>
            <th>成品</th>
            <th>规格</th>
            <th className="num">现存量</th>
            <th className="num">版本</th>
            <th>最近更新</th>
            <th className="actions-col">操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.inventoryId}>
              <td>
                <strong>{item.productName}</strong>
                <span className="cell-sub mono">{item.productKey}</span>
              </td>
              <td className="muted">{item.spec || '—'}</td>
              <td className="num">
                <strong className={item.quantity === 0 ? 'muted' : 'qty-strong'}>{fmtNumber(item.quantity)}</strong>
              </td>
              <td className="num muted">{item.version}</td>
              <td className="muted">{fmtDateTime(item.updatedAt)}</td>
              <td>
                <div className="row-actions">
                  <Button size="sm" variant="secondary" onClick={() => onAdjust(item)}>
                    调整
                  </Button>
                  <button type="button" className="icon-button" onClick={() => onLogs(item)} aria-label="查看流水">
                    <History size={16} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AdjustModal({
  state,
  onClose,
  onDone
}: {
  state:
    | { mode: 'part'; item: PartInventoryItem }
    | { mode: 'product'; item: ProductInventoryItem | null };
  onClose: () => void;
  onDone: () => void;
}) {
  const isPart = state.mode === 'part';
  const current = isPart ? state.item.quantity : state.item?.quantity ?? 0;
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [productName, setProductName] = useState(state.mode === 'product' ? state.item?.productName ?? '' : '');
  const [spec, setSpec] = useState(state.mode === 'product' ? state.item?.spec ?? '' : '');
  const [error, setError] = useState<string | null>(null);
  const [unknown, setUnknown] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const { key } = useIntentKey('inventory-');

  const onSubmit = async () => {
    setError(null);
    setUnknown(false);
    const numeric = Number(delta);
    if (!Number.isInteger(numeric) || numeric === 0) return setError('增减数量必须是非零整数');
    if (!reason.trim() || reason.trim().length < 2) return setError('请填写至少 2 个字符的原因');
    if (state.mode === 'product' && !state.item && !productName.trim()) return setError('请填写成品名称');
    setSubmitting(true);
    try {
      const body =
        state.mode === 'part'
          ? { partId: state.item.partId, delta: numeric, reason: reason.trim() }
          : { productName: productName.trim(), spec: spec.trim(), delta: numeric, reason: reason.trim() };
      await api.post(state.mode === 'part' ? '/inventory/parts/adjust' : '/inventory/products/adjust', body, key);
      onDone();
    } catch (reasonValue) {
      if (isUnknownResult(reasonValue)) setUnknown(true);
      else setError(errorMessage(reasonValue));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={isPart ? '调整配件库存' : state.item ? '调整成品库存' : '新建成品库存'}
      subtitle={isPart ? state.item.name : state.item ? state.item.productName : '首次建立必须为正数'}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button loading={submitting} onClick={() => void onSubmit()}>
            提交调整
          </Button>
        </>
      }
    >
      <div className="stack">
        {unknown ? (
          <Alert tone="warning" title="结果未知">
            网络中断，无法确认库存是否已变更。请保留原数量与原因，用原请求重试；系统会按幂等键返回原流水。
            <div className="alert-inline-action">
              <Button size="sm" variant="dark" loading={submitting} onClick={() => void onSubmit()}>
                重试原请求
              </Button>
            </div>
          </Alert>
        ) : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {!isPart && !state.item ? (
          <div className="form-grid">
            <Field label="成品名称" required>
              <TextInput value={productName} onChange={(event) => setProductName(event.target.value)} placeholder="例如：精密传动箱体" />
            </Field>
            <Field label="规格">
              <TextInput value={spec} onChange={(event) => setSpec(event.target.value)} placeholder="例如：TB-220" />
            </Field>
          </div>
        ) : null}
        <div className="stock-current">
          <span>当前现存量</span>
          <strong>{current}</strong>
        </div>
        <Field label="增减数量" required hint="正数增加、负数减少；减少后不能小于 0">
          <div className="delta-input">
            <button type="button" className="delta-step" onClick={() => setDelta(String(Number(delta || '0') - 1))}>
              <ArrowDownRight size={16} />
            </button>
            <TextInput
              value={delta}
              inputMode="numeric"
              onChange={(event) => setDelta(event.target.value)}
              placeholder="例如 10 或 -3"
            />
            <button type="button" className="delta-step" onClick={() => setDelta(String(Number(delta || '0') + 1))}>
              <ArrowUpRight size={16} />
            </button>
          </div>
        </Field>
        <Field label="原因" required>
          <TextInput value={reason} onChange={(event) => setReason(event.target.value)} placeholder="例如：验收入库 / 演示领用" maxLength={200} />
        </Field>
        <div className="stock-preview">
          <span>{current}</span>
          <span className={Number(delta) < 0 ? 'negative' : 'positive'}>
            {Number(delta) > 0 ? '+' : ''}
            {Number.isFinite(Number(delta)) ? delta || 0 : 0}
          </span>
          <span>=</span>
          <strong>{Number.isFinite(Number(delta)) ? current + Number(delta || 0) : current}</strong>
        </div>
      </div>
    </Modal>
  );
}

function LogsModal({
  state,
  onClose
}: {
  state: { mode: 'part' | 'product'; id: string; name: string };
  onClose: () => void;
}) {
  const logs = useAsync<{ logs: InventoryLog[] }>(
    () => api.get(`/inventory/${state.mode === 'part' ? 'parts' : 'products'}/${state.id}/logs`),
    [state.id, state.mode]
  );
  return (
    <Modal open onClose={onClose} title={`库存流水 · ${state.name}`} subtitle="只追加、不修改；before + delta = after" size="lg">
      {logs.loading ? <LoadingState rows={4} compact /> : null}
      {logs.error ? <ErrorState error={logs.error} onRetry={logs.reload} /> : null}
      {logs.data && logs.data.logs.length === 0 ? <EmptyState title="暂无流水" description="第一次库存调整后会生成流水。" /> : null}
      {logs.data && logs.data.logs.length > 0 ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>时间</th>
                <th className="num">变更前</th>
                <th className="num">增减</th>
                <th className="num">变更后</th>
                <th>原因</th>
                <th>操作人</th>
              </tr>
            </thead>
            <tbody>
              {logs.data.logs.map((log) => (
                <tr key={log.id}>
                  <td className="muted">{fmtDateTime(log.createdAt)}</td>
                  <td className="num">{log.before}</td>
                  <td className={`num ${log.delta < 0 ? 'negative' : 'positive'}`}>
                    {log.delta > 0 ? '+' : ''}
                    {log.delta}
                  </td>
                  <td className="num">
                    <strong>{log.after}</strong>
                  </td>
                  <td>{log.reason}</td>
                  <td className="muted">{log.operatorName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Modal>
  );
}
