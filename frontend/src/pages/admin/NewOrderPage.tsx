import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CalendarDays, ClipboardCheck, Info, RotateCcw } from 'lucide-react';
import { useAuth } from '../../app/AuthContext';
import { api, errorMessage, isUnknownResult } from '../../lib/api';
import { addDays, fmtMoney, today } from '../../lib/format';
import { useDraft, useDocumentTitle, useIntentKey } from '../../lib/hooks';
import type { PartInventoryItem } from '../../lib/types';
import {
  Alert,
  Button,
  Card,
  Field,
  PageHeader,
  SectionTitle,
  Select,
  TextArea,
  TextInput,
  useToast
} from '../../components/ui';

interface Customer {
  id: string;
  name: string;
  active: boolean;
  contact: string;
}

interface OrderForm {
  customerId: string;
  customerName: string;
  newPart: string;
  partId: string;
  productName: string;
  spec: string;
  quantity: string;
  unitPrice: string;
  dueDate: string;
  note: string;
}

const EMPTY: OrderForm = {
  customerId: '',
  customerName: '',
  newPart: '',
  partId: '',
  productName: '',
  spec: '',
  quantity: '100',
  unitPrice: '12.50',
  dueDate: addDays(today(), 14),
  note: ''
};

export function NewOrderPage() {
  useDocumentTitle('创建订单');
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [parts, setParts] = useState<PartInventoryItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const draft = useDraft<OrderForm>(`fx:draft:${user?.id ?? 'anon'}:new-order`, EMPTY);
  const form = draft.value;
  const setForm = draft.setValue;
  const { key, renew } = useIntentKey('order-create-');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [unknown, setUnknown] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get<{ items: Customer[] }>('/customers?active=1'),
      api.get<{ items: PartInventoryItem[] }>('/inventory/parts')
    ])
      .then(([customerData, partData]) => {
        setCustomers(customerData.items);
        setParts(partData.items.filter((part) => part.active));
        if (!form.customerId && customerData.items[0]) {
          setForm((current) => ({ ...current, customerId: current.customerId || customerData.items[0]!.id }));
        }
      })
      .catch((reason) => setLoadError(errorMessage(reason)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sales = useMemo(() => {
    const quantity = Number(form.quantity);
    const price = Number(form.unitPrice);
    if (!Number.isFinite(quantity) || !Number.isFinite(price)) return 0;
    return quantity * price;
  }, [form.quantity, form.unitPrice]);

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (form.customerId === '__new__') {
      if (!form.customerName.trim()) next.customerId = '请填写新客户名称';
    } else if (!form.customerId) {
      next.customerId = '请选择客户，或填写新客户名称';
    }
    if (!form.productName.trim()) next.productName = '请填写产品名称';
    if (!/^\d+$/.test(form.quantity) || Number(form.quantity) <= 0) next.quantity = '数量必须是正整数';
    if (!/^\d+(\.\d{1,2})?$/.test(form.unitPrice)) next.unitPrice = '单价格式应为最多两位小数';
    if (!form.dueDate) next.dueDate = '请选择交期';
    else if (form.dueDate < today()) next.dueDate = '交期不能早于今天';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    setUnknown(false);
    try {
      const result = await api.post<{ id: string; orderNo: string }>(
        '/orders',
        {
          ...(form.customerId && form.customerId !== '__new__'
            ? { customerId: form.customerId }
            : { customerName: form.customerName.trim() }),
          dueDate: form.dueDate,
          note: form.note.trim(),
          item: {
            ...(form.partId && form.partId !== '__new__'
              ? { partId: form.partId }
              : form.newPart.trim()
                ? { partName: form.newPart.trim() }
                : {}),
            productName: form.productName.trim(),
            spec: form.spec.trim(),
            quantity: Number(form.quantity),
            unitPrice: form.unitPrice
          }
        },
        key
      );
      draft.clear();
      renew();
      toast.success('订单已创建', `${result.orderNo} 已进入待采购状态`);
      navigate(`/admin/orders/${result.id}`, { replace: true });
    } catch (reason) {
      if (isUnknownResult(reason)) {
        setUnknown(true);
      } else {
        toast.error('创建失败', errorMessage(reason));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="NEW ORDER"
        title="创建业务订单"
        description="订单保存后进入待采购；价格与产品名称会作为业务快照保存，不随基础数据变化。"
        actions={
          <Button variant="ghost" icon={<ArrowLeft size={16} />} onClick={() => navigate('/admin/orders')}>
            返回列表
          </Button>
        }
      />

      {loadError ? (
        <Alert tone="danger" title="基础数据读取失败">
          {loadError}
        </Alert>
      ) : null}
      {draft.restored ? (
        <Alert
          tone="info"
          title="已恢复未提交草稿"
          action={
            <Button
              size="sm"
              variant="secondary"
              icon={<RotateCcw size={14} />}
              onClick={() => {
                draft.clear();
                toast.info('草稿已清除');
              }}
            >
              放弃草稿
            </Button>
          }
        >
          系统检测到上次未提交的建单内容。草稿仅保存在本机浏览器，不包含密码。
        </Alert>
      ) : null}
      {unknown ? (
        <Alert tone="warning" title="提交结果未知">
          网络中断或服务未确认写入。请勿修改内容后重新建单，先使用原请求重试；系统会用同一幂等键避免重复订单。
          <div className="alert-inline-action">
            <Button size="sm" variant="dark" loading={submitting} onClick={() => void submit()}>
              重试原请求
            </Button>
          </div>
        </Alert>
      ) : null}

      <form onSubmit={submit} className="detail-grid">
        <div className="stack">
          <Card>
            <SectionTitle title="客户与交期" hint="客户停用后不能新建引用，但历史订单保留快照。" />
            <div className="form-grid">
              <Field label="客户" htmlFor="customer" required error={errors.customerId}>
                <Select
                  id="customer"
                  value={form.customerId}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      customerId: event.target.value,
                      customerName: event.target.value === '__new__' ? form.customerName : ''
                    })
                  }
                >
                  <option value="">请选择客户</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name}
                    </option>
                  ))}
                  <option value="__new__">＋ 新客户（手动输入名称）</option>
                </Select>
                {form.customerId === '__new__' ? (
                  <div className="inline-create">
                    <TextInput
                      value={form.customerName}
                      onChange={(event) => setForm({ ...form, customerName: event.target.value })}
                      placeholder="输入新客户名称，保存后自动建档"
                      maxLength={80}
                    />
                    <small>编码自动生成；同一名称不会重复建档。</small>
                  </div>
                ) : null}
                {errors.customerId ? <p className="field-error">{errors.customerId}</p> : null}
              </Field>
              <Field label="交期" htmlFor="dueDate" required error={errors.dueDate} hint="北京时间日期语义">
                <div className="input-with-icon">
                  <CalendarDays size={16} />
                  <TextInput
                    id="dueDate"
                    type="date"
                    value={form.dueDate}
                    min={today()}
                    onChange={(event) => setForm({ ...form, dueDate: event.target.value })}
                  />
                </div>
              </Field>
            </div>
          </Card>

          <Card>
            <SectionTitle title="产品明细" hint="最低实现为单产品订单；数量与单价将形成销售额快照。" />
            <div className="form-grid">
              <Field label="关联配件（可选）" htmlFor="part" hint="选择后自动带出名称与规格，可再修改">
                <Select
                  id="part"
                  value={form.partId}
                  onChange={(event) => {
                    const part = parts.find((item) => item.partId === event.target.value);
                    setForm({
                      ...form,
                      partId: event.target.value,
                      newPart: event.target.value === '__new__' ? form.newPart : '',
                      productName:
                        event.target.value === '__new__'
                          ? form.productName
                          : (part?.name ?? form.productName),
                      spec: event.target.value === '__new__' ? form.spec : (part?.spec ?? form.spec)
                    });
                  }}
                >
                  <option value="">不关联配件</option>
                  <option value="__new__">＋ 新配件（手动输入名称）</option>
                  {parts.map((part) => (
                    <option key={part.partId} value={part.partId}>
                      {part.code} · {part.name}
                    </option>
                  ))}
                </Select>
              </Field>
              {form.partId === '__new__' ? (
                <Field label="新配件名称" htmlFor="newPart" hint="保存后自动建档，编码自动生成">
                  <TextInput
                    id="newPart"
                    value={form.newPart}
                    onChange={(event) => setForm({ ...form, newPart: event.target.value })}
                    placeholder="例如：铝合金外壳"
                    maxLength={80}
                  />
                </Field>
              ) : null}
              <Field label="产品名称" htmlFor="productName" required error={errors.productName}>
                <TextInput
                  id="productName"
                  value={form.productName}
                  onChange={(event) => setForm({ ...form, productName: event.target.value })}
                  placeholder="例如：精密传动箱体"
                  maxLength={80}
                />
              </Field>
              <Field label="规格" htmlFor="spec">
                <TextInput
                  id="spec"
                  value={form.spec}
                  onChange={(event) => setForm({ ...form, spec: event.target.value })}
                  placeholder="例如：TB-220 / 阳极氧化"
                  maxLength={120}
                />
              </Field>
              <div className="form-grid form-grid-2">
                <Field label="数量" htmlFor="quantity" required error={errors.quantity}>
                  <TextInput
                    id="quantity"
                    inputMode="numeric"
                    value={form.quantity}
                    onChange={(event) => setForm({ ...form, quantity: event.target.value })}
                    placeholder="100"
                  />
                </Field>
                <Field label="销售单价（元）" htmlFor="unitPrice" required error={errors.unitPrice}>
                  <TextInput
                    id="unitPrice"
                    inputMode="decimal"
                    value={form.unitPrice}
                    onChange={(event) => setForm({ ...form, unitPrice: event.target.value })}
                    placeholder="12.50"
                  />
                </Field>
              </div>
            </div>
            <Field label="备注" htmlFor="note" className="field-span">
              <TextArea
                id="note"
                rows={3}
                value={form.note}
                onChange={(event) => setForm({ ...form, note: event.target.value })}
                placeholder="交期约定、包装要求等（可选）"
                maxLength={300}
              />
            </Field>
          </Card>

          <div className="form-actions">
            <Button type="button" variant="ghost" onClick={() => navigate('/admin/orders')}>
              取消
            </Button>
            <Button type="submit" loading={submitting} icon={<ClipboardCheck size={16} />}>
              保存订单
            </Button>
          </div>
        </div>

        <aside className="stack">
          <Card className="quote-card">
            <SectionTitle title="建单预览" hint="保存前仅作金额试算" />
            <div className="quote-row">
              <span>客户</span>
              <strong>{customers.find((customer) => customer.id === form.customerId)?.name ?? '未选择'}</strong>
            </div>
            <div className="quote-row">
              <span>产品</span>
              <strong>{form.productName || '未填写'}</strong>
            </div>
            <div className="quote-row">
              <span>数量</span>
              <strong>{form.quantity || '0'} 件</strong>
            </div>
            <div className="quote-row">
              <span>交期</span>
              <strong>{form.dueDate || '—'}</strong>
            </div>
            <div className="quote-total">
              <span>预计销售额</span>
              <strong>{fmtMoney(sales.toFixed(2))}</strong>
            </div>
            <p className="quote-note">
              <Info size={14} /> 单价为非负、最多两位小数；最终金额由后端以整数分计算。
            </p>
          </Card>
          <Card className="checklist-card">
            <SectionTitle title="保存后发生什么" />
            <ol className="checklist">
              <li>
                <span>01</span>生成唯一订单号，状态为“待采购”
              </li>
              <li>
                <span>02</span>写入订单、明细、时间线与审计
              </li>
              <li>
                <span>03</span>重复提交使用同一幂等键，不会生成第二张订单
              </li>
              <li>
                <span>04</span>刷新或重启后仍从数据库读取
              </li>
            </ol>
          </Card>
        </aside>
      </form>
    </div>
  );
}
