import { useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, Send } from 'lucide-react';
import { api, errorMessage, isUnknownResult } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { useAsync, useDocumentTitle } from '../../lib/hooks';
import type { ExceptionItem } from '../../lib/types';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  PageHeader,
  Select,
  TextArea,
  useToast
} from '../../components/ui';

const CATEGORIES = [
  ['MATERIAL', '物料问题'],
  ['EQUIPMENT', '设备故障'],
  ['QUALITY', '质量异常'],
  ['PROCESS', '工艺问题'],
  ['OTHER', '其他']
] as const;

interface OrderOption {
  id: string;
  order_no: string;
  product_name: string;
  status: string;
}

export function TabletExceptionsPage() {
  useDocumentTitle('异常上报');
  const toast = useToast();
  const options = useAsync<{ items: OrderOption[] }>(() => api.get('/tablet/order-options'), []);
  const own = useAsync<{ items: ExceptionItem[] }>(() => api.get('/tablet/exceptions'), []);
  const [orderId, setOrderId] = useState('');
  const [category, setCategory] = useState('OTHER');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unknown, setUnknown] = useState(false);
  const [success, setSuccess] = useState(false);

  const submit = async () => {
    setError(null);
    setUnknown(false);
    setSuccess(false);
    if (!orderId) return setError('请选择关联订单');
    if (description.trim().length < 5) return setError('请至少填写 5 个字符的问题描述');
    setSubmitting(true);
    try {
      await api.post('/tablet/exceptions', { orderId, category, description: description.trim() });
      toast.success('异常已上报', '管理员可在后台查看；异常不会改变订单数量');
      setDescription('');
      setSuccess(true);
      own.reload();
    } catch (reason) {
      if (isUnknownResult(reason)) setUnknown(true);
      else setError(errorMessage(reason));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="SHOP FLOOR ISSUE"
        title="异常上报"
        description="报告物料、设备、质量或工艺问题，并关联到当前订单。上报不会直接改变任务完成量或订单状态。"
        actions={
          <Button variant="secondary" size="sm" icon={<RefreshCw size={15} />} onClick={() => { options.reload(); own.reload(); }}>
            刷新
          </Button>
        }
      />

      <div className="exception-layout">
        <Card className="exception-form-card">
          <div className="section-title">
            <div>
              <h2>新建上报</h2>
              <p>仅关联你当前职责范围内的订单</p>
            </div>
            <span className="tablet-task-icon tone-danger">
              <AlertTriangle size={20} />
            </span>
          </div>
          {unknown ? (
            <Alert tone="warning" title="结果未知">
              网络中断，系统未确认是否写入。请先刷新下方列表确认，避免重复上报。
            </Alert>
          ) : null}
          {error ? <Alert tone="danger">{error}</Alert> : null}
          {success ? (
            <Alert tone="success" title="已上报">
              <CheckCircle2 size={14} /> 管理员已收到通知，可在订单详情与异常列表中查看。
            </Alert>
          ) : null}
          <Field label="关联订单" required>
            <Select value={orderId} onChange={(event) => setOrderId(event.target.value)}>
              <option value="">请选择订单</option>
              {(options.data?.items ?? []).map((option) => (
                <option key={option.id} value={option.id}>
                  {option.order_no} · {option.product_name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="问题分类" required>
            <Select value={category} onChange={(event) => setCategory(event.target.value)}>
              {CATEGORIES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="问题描述" required hint="请写清位置、现象和已采取的措施">
            <TextArea
              rows={5}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={500}
              placeholder="例如：3 号工位夹具松动，已停机并通知班组长，等待维修确认。"
            />
          </Field>
          <Button onClick={() => void submit()} loading={submitting} icon={<Send size={15} />}>
            提交异常上报
          </Button>
        </Card>

        <div className="stack">
          <Card>
            <div className="section-title">
              <div>
                <h2>我的上报</h2>
                <p>按时间倒序，仅显示本人记录</p>
              </div>
              <span className="count-chip">{own.data?.items.length ?? 0} 条</span>
            </div>
            {own.loading && !own.data ? (
              <LoadingState rows={3} compact />
            ) : own.error && !own.data ? (
              <ErrorState error={own.error} onRetry={own.reload} />
            ) : (own.data?.items.length ?? 0) === 0 ? (
              <EmptyState title="还没有上报记录" description="发现异常时，填写左侧表单并关联订单。" icon={<AlertTriangle size={24} />} />
            ) : (
              <div className="exception-history">
                {own.data!.items.map((item) => (
                  <article key={item.id}>
                    <div>
                      <span className="exception-tag">{item.categoryLabel ?? item.category}</span>
                      <span
                className={
                  item.status === 'RESOLVED'
                    ? 'soft-badge soft-badge-ok'
                    : item.status === 'ACKNOWLEDGED'
                      ? 'soft-badge soft-badge-info'
                      : 'soft-badge soft-badge-warn'
                }
              >
                {item.statusLabel ?? (item.status === 'RESOLVED' ? '已解决' : item.status === 'ACKNOWLEDGED' ? '处理中' : '待处理')}
              </span>
                    </div>
                    <p>{item.description}</p>
                    <small>
                      {item.orderNo} · {fmtDateTime(item.createdAt)}
                    </small>
                  </article>
                ))}
              </div>
            )}
          </Card>
          <Card className="exception-guide">
            <h3>上报边界</h3>
            <ul>
              <li>异常记录不能修改订单数量，也不能替代质检或返工流程。</li>
              <li>只关联自己职责范围内的订单，跨部门资源会被服务端拒绝。</li>
              <li>管理员可查看全部异常；处理状态与处理人属于 F，当前未启用。</li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
