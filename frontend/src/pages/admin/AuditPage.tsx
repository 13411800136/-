import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight, ScrollText, Search, ShieldCheck } from 'lucide-react';
import { api } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { useAsync, useDocumentTitle } from '../../lib/hooks';
import type { AuditItem, Pagination } from '../../lib/types';
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Select,
  TextInput
} from '../../components/ui';

const RESOURCE_OPTIONS = [
  ['', '全部资源'],
  ['ORDER', '订单'],
  ['PURCHASE_ORDER', '采购单'],
  ['ARRIVAL', '到货'],
  ['PRODUCTION_ORDER', '生产任务'],
  ['QC_RECORD', '质检'],
  ['PACKING', '包装'],
  ['SHIPMENT', '发货'],
  ['PART_INVENTORY', '配件库存'],
  ['PRODUCT_INVENTORY', '成品库存'],
  ['ATTACHMENT', '附件'],
  ['USER', '员工账号'],
  ['SESSION', '会话']
] as const;

export function AuditPage() {
  useDocumentTitle('审计日志');
  const [keywordInput, setKeywordInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [resourceType, setResourceType] = useState('');
  const [result, setResult] = useState('');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);

  const audit = useAsync<{ items: AuditItem[]; pagination: Pagination }>(
    () =>
      api.get(
        `/audit-logs?page=${page}&pageSize=30${keyword ? `&keyword=${encodeURIComponent(keyword)}` : ''}${
          resourceType ? `&resourceType=${resourceType}` : ''
        }${result ? `&result=${result}` : ''}`
      ),
    [page, keyword, resourceType, result]
  );

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="AUDIT TRAIL"
        title="审计日志"
        description="关键写操作的操作者、资源、时间、请求关联与脱敏前后值。普通角色不可改删，管理员也不提供删除入口。"
        actions={
          <span className="hint-chip">
            <ShieldCheck size={14} /> 只追加记录
          </span>
        }
      />

      <section className="filter-bar">
        <div className="filter-search">
          <Search size={16} />
          <TextInput
            value={keywordInput}
            onChange={(event) => setKeywordInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                setKeyword(keywordInput.trim());
                setPage(1);
              }
            }}
            placeholder="搜索操作、操作者或资源 ID"
          />
        </div>
        <Select
          value={resourceType}
          onChange={(event) => {
            setResourceType(event.target.value);
            setPage(1);
          }}
          className="filter-native"
          aria-label="按资源筛选"
        >
          {RESOURCE_OPTIONS.map(([value, label]) => (
            <option key={value || 'all'} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <Select
          value={result}
          onChange={(event) => {
            setResult(event.target.value);
            setPage(1);
          }}
          className="filter-native"
          aria-label="按结果筛选"
        >
          <option value="">全部结果</option>
          <option value="SUCCESS">成功</option>
          <option value="FAILURE">失败</option>
        </Select>
        <Button variant="dark" size="sm" onClick={() => { setKeyword(keywordInput.trim()); setPage(1); }}>
          查询
        </Button>
      </section>

      {audit.loading && !audit.data ? (
        <LoadingState rows={7} />
      ) : audit.error && !audit.data ? (
        <ErrorState error={audit.error} onRetry={audit.reload} />
      ) : (audit.data?.items.length ?? 0) === 0 ? (
        <EmptyState title="没有匹配的审计记录" description="关键业务操作发生后会自动写入审计。" icon={<ScrollText size={26} />} />
      ) : (
        <>
          <div className="table-wrap card-table">
            <table className="data-table audit-table">
              <thead>
                <tr>
                  <th />
                  <th>时间</th>
                  <th>操作者</th>
                  <th>动作</th>
                  <th>资源</th>
                  <th>结果</th>
                  <th>请求 ID</th>
                </tr>
              </thead>
              <tbody>
                {audit.data!.items.map((item) => (
                  <Fragment key={item.id}>
                    <tr className="audit-row">
                      <td>
                        <button
                          type="button"
                          className="icon-button"
                          onClick={() => setExpanded(expanded === item.id ? null : item.id)}
                          aria-label="展开前后变化"
                        >
                          {expanded === item.id ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                        </button>
                      </td>
                      <td className="muted">{fmtDateTime(item.createdAt)}</td>
                      <td>{item.actorName}</td>
                      <td>
                        <span className="mono audit-action">{item.action}</span>
                      </td>
                      <td>
                        <span className="cell-sub">
                          {item.resourceType}
                          {item.resourceId ? ` · ${item.resourceId.slice(0, 8)}` : ''}
                        </span>
                      </td>
                      <td>
                        <span className={item.result === 'SUCCESS' ? 'result-ok' : 'result-fail'}>
                          {item.result === 'SUCCESS' ? '成功' : '失败'}
                        </span>
                        {item.errorCode ? <span className="cell-sub">{item.errorCode}</span> : null}
                      </td>
                      <td className="mono muted request-id">{item.requestId.slice(0, 8)}</td>
                    </tr>
                    {expanded === item.id ? (
                      <tr className="audit-detail-row">
                        <td colSpan={7}>
                          <div className="audit-detail">
                            <div>
                              <h4>变更前</h4>
                              <pre>{item.before ? JSON.stringify(item.before, null, 2) : '—'}</pre>
                            </div>
                            <div>
                              <h4>变更后</h4>
                              <pre>{item.after ? JSON.stringify(item.after, null, 2) : '—'}</pre>
                            </div>
                            {item.detail ? (
                              <div className="audit-detail-note">
                                <h4>说明</h4>
                                <p>{item.detail}</p>
                              </div>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          {audit.data!.pagination.totalPages > 1 ? (
            <div className="pagination">
              <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
                上一页
              </Button>
              <span>
                第 {audit.data!.pagination.page} / {audit.data!.pagination.totalPages} 页 · 共 {audit.data!.pagination.total} 条
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={page >= audit.data!.pagination.totalPages}
                onClick={() => setPage((value) => value + 1)}
              >
                下一页
              </Button>
            </div>
          ) : null}
        </>
      )}
      <p className="page-footnote">审计中的密码、令牌、Cookie、salt/hash 等字段已在写入前脱敏；页面只读。</p>
    </div>
  );
}
