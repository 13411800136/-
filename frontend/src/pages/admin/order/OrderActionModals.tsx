import { useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, Factory, ShieldCheck } from 'lucide-react';
import { api, errorMessage, isUnknownResult } from '../../../lib/api';
import { fmtDateTime, fmtMoney, today } from '../../../lib/format';
import { useIntentKey } from '../../../lib/hooks';
import type { OrderDetail } from '../../../lib/types';
import {
  Alert,
  Button,
  Field,
  Modal,
  Select,
  TextArea,
  TextInput,
  useToast
} from '../../../components/ui';

export interface SupplierOption {
  id: string;
  name: string;
  active: boolean;
}

export interface PartOption {
  partId: string;
  code: string;
  name: string;
  spec: string;
  active: boolean;
}

export interface DepartmentOption {
  id: string;
  name: string;
  category: string;
  active: boolean;
}

export interface EmployeeOption {
  id: string;
  username: string;
  displayName: string;
  role: string;
  departmentId: string | null;
  active: boolean;
}

function UnknownAlert({ retry, submitting }: { retry: () => void; submitting: boolean }) {
  return (
    <Alert tone="warning" title="提交结果未知">
      网络中断或服务未确认写入。不要修改内容另开一笔，请用原幂等键重试。
      <div className="alert-inline-action">
        <Button size="sm" variant="dark" loading={submitting} onClick={retry}>
          重试原请求
        </Button>
      </div>
    </Alert>
  );
}

function useActionState(onDone: () => void) {
  const toast = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (request: () => Promise<unknown>, successTitle: string, successMessage?: string) => {
    setSubmitting(true);
    setUnknown(false);
    setError(null);
    try {
      await request();
      toast.success(successTitle, successMessage);
      onDone();
    } catch (reason) {
      if (isUnknownResult(reason)) setUnknown(true);
      else setError(errorMessage(reason));
    } finally {
      setSubmitting(false);
    }
  };

  return { submitting, unknown, error, run };
}

export function PurchaseModal({
  orderId,
  item,
  suppliers,
  parts,
  onClose,
  onDone
}: {
  orderId: string;
  item: OrderDetail['items'][number];
  suppliers: SupplierOption[];
  parts: PartOption[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { key } = useIntentKey('purchase-');
  const [supplierId, setSupplierId] = useState(suppliers.find((supplier) => supplier.active)?.id ?? '');
  const [partId, setPartId] = useState(parts.find((part) => part.active)?.partId ?? '');
  const [quantity, setQuantity] = useState(String(item.quantity));
  const [unitPrice, setUnitPrice] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const action = useActionState(onDone);
  const total = useMemo(() => {
    const qty = Number(quantity);
    const price = Number(unitPrice);
    return Number.isFinite(qty) && Number.isFinite(price) ? fmtMoney((qty * price).toFixed(2)) : '—';
  }, [quantity, unitPrice]);

  const submit = () => {
    if (!supplierId) return setFieldError('请选择供应商');
    if (!partId) return setFieldError('请选择采购配件');
    if (!/^\d+$/.test(quantity) || Number(quantity) <= 0) return setFieldError('采购数量必须是正整数');
    if (!/^\d+(\.\d{1,2})?$/.test(unitPrice)) return setFieldError('采购单价格式不合法');
    void action.run(
      () =>
        api.post(
          `/orders/${orderId}/purchase-orders`,
          { supplierId, item: { partId, quantity: Number(quantity), unitPrice } },
          key
        ),
      '采购单已建立',
      '订单进入采购中，等待物流登记到货'
    );
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="建立采购单"
      subtitle="最低实现：一订单一张采购单、单配件；采购数量可与订单数量不同。"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button loading={action.submitting} onClick={submit}>
            保存采购单
          </Button>
        </>
      }
    >
      <div className="stack">
        {action.unknown ? <UnknownAlert retry={submit} submitting={action.submitting} /> : null}
        {action.error ? <Alert tone="danger">{action.error}</Alert> : null}
        {fieldError ? <Alert tone="danger">{fieldError}</Alert> : null}
        <div className="form-grid">
          <Field label="供应商" required>
            <Select value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
              <option value="">请选择供应商</option>
              {suppliers
                .filter((supplier) => supplier.active)
                .map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="采购配件" required>
            <Select value={partId} onChange={(event) => setPartId(event.target.value)}>
              <option value="">请选择配件</option>
              {parts
                .filter((part) => part.active)
                .map((part) => (
                  <option key={part.partId} value={part.partId}>
                    {part.code} · {part.name}
                    {part.spec ? ` / ${part.spec}` : ''}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="采购数量" required hint={`订单应交 ${item.quantity} 件；采购量按本单物料计划填写`}>
            <TextInput value={quantity} inputMode="numeric" onChange={(event) => setQuantity(event.target.value)} />
          </Field>
          <Field label="采购单价（元）" required hint="创建时快照，不随基础报价变化">
            <TextInput value={unitPrice} inputMode="decimal" onChange={(event) => setUnitPrice(event.target.value)} placeholder="2.10" />
          </Field>
        </div>
        <div className="quote-inline">
          <span>采购金额试算</span>
          <strong>{total}</strong>
        </div>
      </div>
    </Modal>
  );
}

export function ProductionModal({
  orderId,
  item,
  departments,
  employees,
  remainingToAssign,
  orderDueDate,
  onClose,
  onDone
}: {
  orderId: string;
  item: OrderDetail['items'][number];
  departments: DepartmentOption[];
  employees: EmployeeOption[];
  remainingToAssign: number;
  orderDueDate: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const productionDepartments = departments.filter((department) => department.active && department.category === 'PRODUCTION');
  const [departmentId, setDepartmentId] = useState(productionDepartments[0]?.id ?? '');
  const [assigneeId, setAssigneeId] = useState('');
  const [processName, setProcessName] = useState('精加工与装配');
  const [quantity, setQuantity] = useState(String(remainingToAssign));
  const [unitPrice, setUnitPrice] = useState('');
  const [dueDate, setDueDate] = useState(orderDueDate >= today() ? orderDueDate : today());
  const [priceVisible, setPriceVisible] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const { key } = useIntentKey('production-');
  const action = useActionState(onDone);
  const assignees = employees.filter(
    (employee) => employee.active && employee.role === 'PRODUCTION' && employee.departmentId === departmentId
  );

  const submit = () => {
    if (!departmentId) return setFieldError('请选择生产部门');
    if (!processName.trim()) return setFieldError('请填写工艺名称');
    if (!/^\d+$/.test(quantity) || Number(quantity) <= 0) return setFieldError('生产数量必须是正整数');
    if (Number(quantity) > remainingToAssign) return setFieldError(`本次最多可分配 ${remainingToAssign} 件`);
    if (!/^\d+(\.\d{1,2})?$/.test(unitPrice)) return setFieldError('工艺单价格式不合法');
    void action.run(
      () =>
        api.post(
          `/orders/${orderId}/production-orders`,
          {
            orderItemId: item.id,
            departmentId,
            assigneeId: assigneeId || null,
            processName: processName.trim(),
            quantity: Number(quantity),
            unitPrice,
            dueDate,
            priceVisible
          },
          key
        ),
      '生产任务已下发',
      '订单进入生产中，现场人员可提交反馈'
    );
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="下发生产任务"
      subtitle="可按部门拆分多个任务并行生产；本次数量不能超过订单剩余可分配量。"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button loading={action.submitting} onClick={submit}>
            下发任务
          </Button>
        </>
      }
    >
      <div className="stack">
        {action.unknown ? <UnknownAlert retry={submit} submitting={action.submitting} /> : null}
        {action.error ? <Alert tone="danger">{action.error}</Alert> : null}
        {fieldError ? <Alert tone="danger">{fieldError}</Alert> : null}
        <div className="task-banner">
          <Factory size={18} />
          <div>
            <strong>{item.productName}</strong>
            <span>
              订单数量 {item.quantity} 件 · 交期 {orderDueDate}
            </span>
          </div>
        </div>
        <div className="form-grid">
          <Field label="生产部门" required>
            <Select
              value={departmentId}
              onChange={(event) => {
                setDepartmentId(event.target.value);
                setAssigneeId('');
              }}
            >
              <option value="">请选择生产部门</option>
              {productionDepartments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="指定人员（可选）" hint="只能选择该部门启用中的生产人员">
            <Select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}>
              <option value="">不指定具体人员</option>
              {assignees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.displayName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="工艺名称" required>
            <TextInput value={processName} onChange={(event) => setProcessName(event.target.value)} maxLength={50} />
          </Field>
          <Field label="生产数量" required hint={`订单剩余可分配 ${remainingToAssign} 件`}>
            <TextInput value={quantity} inputMode="numeric" onChange={(event) => setQuantity(event.target.value)} />
          </Field>
          <Field label="工艺单价（元）" required hint="仅计入有效完成量成本">
            <TextInput value={unitPrice} inputMode="decimal" onChange={(event) => setUnitPrice(event.target.value)} placeholder="1.20" />
          </Field>
          <Field label="生产交期" required>
            <TextInput type="date" min={today()} value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
          </Field>
        </div>
        <label className="checkbox-row">
          <input type="checkbox" checked={priceVisible} onChange={(event) => setPriceVisible(event.target.checked)} />
          <span>
            允许生产端查看该任务工艺单价
            <small>关闭时现场只能看到任务数量，不泄露任何价格。</small>
          </span>
        </label>
      </div>
    </Modal>
  );
}

export function ConfirmActionModal({
  title,
  subtitle,
  description,
  confirmLabel,
  path,
  body,
  tone = 'primary',
  icon,
  onClose,
  onDone
}: {
  title: string;
  subtitle?: string;
  description: ReactNode;
  confirmLabel: string;
  path: string;
  body?: unknown;
  tone?: 'primary' | 'dark';
  icon?: ReactNode;
  onClose: () => void;
  onDone: () => void;
}) {
  const { key } = useIntentKey('action-');
  const action = useActionState(onDone);
  const submit = () =>
    void action.run(
      () => api.post(path, body ?? {}, key),
      `${confirmLabel}成功`,
      '状态已按服务端校验结果更新'
    );

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant={tone} loading={action.submitting} onClick={submit} icon={icon}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="stack">
        {action.unknown ? <UnknownAlert retry={submit} submitting={action.submitting} /> : null}
        {action.error ? <Alert tone="danger">{action.error}</Alert> : null}
        <div className="confirm-body">{description}</div>
        <p className="muted-note">操作将写入业务记录、时间线与审计日志，并用幂等键防重复。</p>
      </div>
    </Modal>
  );
}

export function CancelOrderModal({
  orderId,
  orderNo,
  deadline,
  onClose,
  onDone
}: {
  orderId: string;
  orderNo: string;
  deadline: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [unknown, setUnknown] = useState(false);
  const { key } = useIntentKey('cancel-order-');
  const action = useActionState(onDone);
  const submit = () => {
    if (reason.trim().length < 2) {
      setError('请填写至少 2 个字符的撤销原因');
      return;
    }
    setError(null);
    setUnknown(false);
    void action.run(
      async () => {
        await api.post(`/orders/${orderId}/cancel`, { reason: reason.trim() }, key);
      },
      '订单已撤销',
      '撤销记录、原因和操作人已写入时间线与审计'
    );
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="撤销订单"
      subtitle="谨慎操作：撤销后订单不再继续流转，且不能恢复"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="danger" loading={action.submitting} onClick={submit}>
            确认撤销
          </Button>
        </>
      }
    >
      <div className="stack">
        {unknown ? <UnknownAlert retry={submit} submitting={action.submitting} /> : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {action.error ? <Alert tone="danger">{action.error}</Alert> : null}
        <Alert tone="warning" title={`仅限创建后 12 小时内`}>
          {orderNo} 的撤销窗口截止 {fmtDateTime(deadline)}（北京时间）。只有管理员可操作，且订单必须尚未建立采购单。
        </Alert>
        <Field label="撤销原因" required hint="会记录到订单时间线和审计日志，不会删除订单">
          <TextArea
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={200}
            placeholder="例如：客户临时取消（合成演示）"
          />
        </Field>
      </div>
    </Modal>
  );
}

export function QcDecisionModal({
  qc,
  onClose,
  onDone
}: {
  qc: OrderDetail['qc'][number];
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState('');
  const { key } = useIntentKey('qc-decision-');
  const action = useActionState(onDone);
  const submit = () =>
    void action.run(
      () => api.post(`/qc-records/${qc.id}/decision`, { decision: 'PASS', note }, key),
      '质检已放行',
      `放行 ${qc.qualifiedQty} 件，可进入包装`
    );

  return (
    <Modal
      open
      onClose={onClose}
      title="处置质检结果"
      subtitle="品控只录入结果，管理员确认放行后包装才可读取数量。"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button loading={action.submitting} onClick={submit} icon={<CheckCircle2 size={16} />}>
            确认 PASS 放行
          </Button>
        </>
      }
    >
      <div className="stack">
        {action.unknown ? <UnknownAlert retry={submit} submitting={action.submitting} /> : null}
        {action.error ? <Alert tone="danger">{action.error}</Alert> : null}
        <div className="qc-summary">
          <div>
            <span>检验量</span>
            <strong>{qc.inspectedQty}</strong>
          </div>
          <div>
            <span>合格量</span>
            <strong className="positive">{qc.qualifiedQty}</strong>
          </div>
          <div>
            <span>不合格量</span>
            <strong>{qc.unqualifiedQty}</strong>
          </div>
          <div>
            <span>录入人</span>
            <strong className="small">{qc.inspectorName}</strong>
          </div>
        </div>
        <div className="decision-options">
          <div className="decision-option decision-option-active">
            <CheckCircle2 size={18} />
            <div>
              <strong>PASS · 全额放行</strong>
              <span>当前最低实现唯一启用选项</span>
            </div>
          </div>
          <div className="decision-option decision-option-disabled">
            <ShieldCheck size={18} />
            <div>
              <strong>REWORK / SCRAP</strong>
              <span>F 能力未启用，不能提交</span>
            </div>
          </div>
        </div>
        <Field label="处置备注（可选）">
          <TextArea rows={2} value={note} onChange={(event) => setNote(event.target.value)} maxLength={200} />
        </Field>
      </div>
    </Modal>
  );
}
