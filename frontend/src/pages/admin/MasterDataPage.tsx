import { useState } from 'react';
import { Pencil, Plus, Search, UserPlus } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { useAsync, useDocumentTitle } from '../../lib/hooks';
import { RoleBadge } from '../../components/ui';
import type { Role } from '../../lib/types';
import {
  Alert,
  Button,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  Modal,
  PageHeader,
  Select,
  Tabs,
  TextInput,
  useToast
} from '../../components/ui';

type Entity = 'customers' | 'suppliers' | 'parts' | 'users' | 'departments';
type MasterEntity = Exclude<Entity, 'departments'>;

const CATEGORY_LABELS: Record<string, string> = {
  PRODUCTION: '生产',
  LOGISTICS: '物流',
  QC: '品控',
  PACKING: '包装'
};

interface CustomerRow {
  id: string;
  code: string;
  name: string;
  contact: string;
  taxNo?: string;
  address?: string;
  active: boolean;
  createdAt: string;
}
interface PartRow {
  id: string;
  code: string;
  name: string;
  spec: string;
  unit: string;
  active: boolean;
  createdAt: string;
}
interface UserRow {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  departmentId: string | null;
  departmentName: string | null;
  departmentCategory: string | null;
  active: boolean;
  createdAt: string;
}
interface DepartmentRow {
  id: string;
  code: string;
  name: string;
  category: string;
  active: boolean;
}

export function MasterDataPage() {
  useDocumentTitle('基础数据');
  const toast = useToast();
  const [tab, setTab] = useState<Entity>('customers');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<
    | { mode: 'create'; entity: MasterEntity }
    | { mode: 'edit'; entity: 'customers' | 'suppliers' | 'parts'; record: CustomerRow | PartRow }
    | null
  >(null);
  const [departmentModal, setDepartmentModal] = useState(false);

  const customers = useAsync<{ items: CustomerRow[] }>(() => api.get('/customers'), []);
  const suppliers = useAsync<{ items: CustomerRow[] }>(() => api.get('/suppliers'), []);
  const parts = useAsync<{ items: PartRow[] }>(() => api.get('/parts'), []);
  const users = useAsync<{ items: UserRow[] }>(() => api.get('/users'), []);
  const departments = useAsync<{ items: DepartmentRow[] }>(() => api.get('/departments'), []);

  const reloadAll = () => {
    customers.reload();
    suppliers.reload();
    parts.reload();
    users.reload();
  };

  const toggleActive = async (entity: Entity, row: CustomerRow | PartRow | UserRow) => {
    try {
      await api.patch(`/${entity}/${row.id}`, { active: !row.active });
      const label = 'displayName' in row ? row.displayName : row.name;
      toast.success(row.active ? '已停用' : '已启用', label);
      reloadAll();
    } catch (reason) {
      toast.error('操作失败', errorMessage(reason));
    }
  };

  const filter = <T extends { name?: string; displayName?: string; code?: string }>(rows: T[]) => {
    if (!search.trim()) return rows;
    const needle = search.trim().toLowerCase();
    return rows.filter((row) =>
      `${row.name ?? ''}${row.displayName ?? ''}${row.code ?? ''}`.toLowerCase().includes(needle)
    );
  };

  const current =
    tab === 'customers'
      ? customers
      : tab === 'suppliers'
        ? suppliers
        : tab === 'parts'
          ? parts
          : tab === 'departments'
            ? departments
            : users;

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="MASTER DATA"
        title="基础数据"
        description="客户、供应商、配件与员工账号。停用不会删除历史，已被业务引用的数据不能物理删除。"
        actions={
          <Button
            icon={tab === 'users' ? <UserPlus size={16} /> : <Plus size={16} />}
            onClick={() => {
              if (tab === 'departments') setDepartmentModal(true);
              else setModal({ mode: 'create', entity: tab });
            }}
          >
            {tab === 'users' ? '新增员工账号' : tab === 'departments' ? '新增部门' : '新增记录'}
          </Button>
        }
      />

      <div className="master-toolbar">
        <Tabs
          items={[
            { value: 'customers', label: '客户', count: customers.data?.items.length },
            { value: 'suppliers', label: '供应商', count: suppliers.data?.items.length },
            { value: 'parts', label: '配件', count: parts.data?.items.length },
            { value: 'departments', label: '部门', count: departments.data?.items.length },
            { value: 'users', label: '员工账号', count: users.data?.items.length }
          ]}
          value={tab}
          onChange={(value) => setTab(value as Entity)}
        />
        <div className="filter-search master-search">
          <Search size={16} />
          <TextInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="按编码、名称或姓名筛选"
          />
        </div>
      </div>

      {current.loading && !current.data ? (
        <LoadingState rows={6} />
      ) : current.error && !current.data ? (
        <ErrorState error={current.error} onRetry={current.reload} />
      ) : tab === 'customers' || tab === 'suppliers' ? (
        <ContactTable
          entity={tab}
          rows={filter((tab === 'customers' ? customers.data?.items : suppliers.data?.items) ?? [])}
          onEdit={(record) => setModal({ mode: 'edit', entity: tab, record })}
          onToggle={(row) => void toggleActive(tab, row)}
        />
      ) : tab === 'parts' ? (
        <PartsTable
          rows={filter(parts.data?.items ?? [])}
          onEdit={(record) => setModal({ mode: 'edit', entity: 'parts', record })}
          onToggle={(row) => void toggleActive('parts', row)}
        />
      ) : tab === 'departments' ? (
        <DepartmentsTable rows={filter(departments.data?.items ?? [])} />
      ) : (
        <UsersTable rows={filter(users.data?.items ?? [])} onToggle={(row) => void toggleActive('users', row)} />
      )}

      {modal ? (
        <MasterModal
          state={modal}
          departments={departments.data?.items ?? []}
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null);
            reloadAll();
          }}
        />
      ) : null}
      {departmentModal ? (
        <DepartmentModal
          onClose={() => setDepartmentModal(false)}
          onDone={() => {
            setDepartmentModal(false);
            departments.reload();
          }}
        />
      ) : null}
    </div>
  );
}

function ContactTable({
  entity,
  rows,
  onEdit,
  onToggle
}: {
  entity: 'customers' | 'suppliers';
  rows: CustomerRow[];
  onEdit: (row: CustomerRow) => void;
  onToggle: (row: CustomerRow) => void;
}) {
  if (rows.length === 0) return <EmptyState title={`没有${entity === 'customers' ? '客户' : '供应商'}`} description="点击右上角新增一条合成记录。" />;
  return (
    <div className="table-wrap card-table">
      <table className="data-table">
        <thead>
          <tr>
            <th>编码</th>
            <th>{entity === 'customers' ? '客户名称' : '供应商名称'}</th>
            <th>联系方式</th>
            {entity === 'customers' ? <th>税号（选填）</th> : null}
            {entity === 'customers' ? <th>地址（选填）</th> : null}
            <th>状态</th>
            <th>创建时间</th>
            <th className="actions-col">操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="mono">{row.code}</td>
              <td>
                <strong>{row.name}</strong>
              </td>
              <td className="muted">{row.contact || '—'}</td>
              {entity === 'customers' ? <td className="muted">{row.taxNo || '—'}</td> : null}
              {entity === 'customers' ? <td className="muted">{row.address || '—'}</td> : null}
              <td>{row.active ? <span className="soft-badge">启用</span> : <span className="soft-badge soft-badge-off">停用</span>}</td>
              <td className="muted">{fmtDateTime(row.createdAt)}</td>
              <td>
                <div className="row-actions">
                  <button type="button" className="icon-button" onClick={() => onEdit(row)} aria-label="编辑">
                    <Pencil size={15} />
                  </button>
                  <Button size="sm" variant={row.active ? 'ghost' : 'secondary'} onClick={() => onToggle(row)}>
                    {row.active ? '停用' : '启用'}
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PartsTable({ rows, onEdit, onToggle }: { rows: PartRow[]; onEdit: (row: PartRow) => void; onToggle: (row: PartRow) => void }) {
  if (rows.length === 0) return <EmptyState title="没有配件" description="配件是采购与库存台账的基础。" />;
  return (
    <div className="table-wrap card-table">
      <table className="data-table">
        <thead>
          <tr>
            <th>编码</th>
            <th>配件名称</th>
            <th>规格</th>
            <th>单位</th>
            <th>状态</th>
            <th className="actions-col">操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="mono">{row.code}</td>
              <td>
                <strong>{row.name}</strong>
              </td>
              <td className="muted">{row.spec || '—'}</td>
              <td>{row.unit}</td>
              <td>{row.active ? <span className="soft-badge">启用</span> : <span className="soft-badge soft-badge-off">停用</span>}</td>
              <td>
                <div className="row-actions">
                  <button type="button" className="icon-button" onClick={() => onEdit(row)} aria-label="编辑">
                    <Pencil size={15} />
                  </button>
                  <Button size="sm" variant={row.active ? 'ghost' : 'secondary'} onClick={() => onToggle(row)}>
                    {row.active ? '停用' : '启用'}
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UsersTable({ rows, onToggle }: { rows: UserRow[]; onToggle: (row: UserRow) => void }) {
  if (rows.length === 0) return <EmptyState title="没有员工账号" description="新增合成员工账号并分配部门与角色。" />;
  return (
    <div className="table-wrap card-table">
      <table className="data-table">
        <thead>
          <tr>
            <th>账号</th>
            <th>姓名</th>
            <th>角色</th>
            <th>部门</th>
            <th>状态</th>
            <th>创建时间</th>
            <th className="actions-col">操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="mono">{row.username}</td>
              <td>
                <strong>{row.displayName}</strong>
              </td>
              <td>
                <RoleBadge role={row.role} />
              </td>
              <td className="muted">{row.departmentName ?? '—'}</td>
              <td>{row.active ? <span className="soft-badge">启用</span> : <span className="soft-badge soft-badge-off">停用</span>}</td>
              <td className="muted">{fmtDateTime(row.createdAt)}</td>
              <td>
                <Button size="sm" variant={row.active ? 'ghost' : 'secondary'} onClick={() => onToggle(row)}>
                  {row.active ? '停用并撤销会话' : '启用'}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DepartmentsTable({ rows }: { rows: DepartmentRow[] }) {
  if (rows.length === 0) return <EmptyState title="没有部门" description="新增生产、物流、品控或包装部门后，可在下发任务时选择。" />;
  return (
    <div className="table-wrap card-table">
      <table className="data-table">
        <thead>
          <tr>
            <th>部门编码</th>
            <th>部门名称</th>
            <th>类别</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="mono">{row.code}</td>
              <td>
                <strong>{row.name}</strong>
              </td>
              <td>{CATEGORY_LABELS[row.category] ?? row.category}</td>
              <td>{row.active ? <span className="soft-badge">启用</span> : <span className="soft-badge soft-badge-off">停用</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DepartmentModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('PRODUCTION');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!name.trim()) return setError('请填写部门名称');
    setSubmitting(true);
    setError(null);
    try {
      await api.post('/departments', { name: name.trim(), category });
      toast.success('部门已创建', '下发生产任务时可以选择该部门');
      onDone();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="新增部门"
      subtitle="生产部门可以承接多个并行的生产任务，提高完成效率"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button loading={submitting} onClick={() => void submit()}>
            保存
          </Button>
        </>
      }
    >
      <div className="stack">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field label="部门名称" required>
          <TextInput value={name} onChange={(event) => setName(event.target.value)} placeholder="例如 生产三部" maxLength={40} />
        </Field>
        <Field label="部门类别" required>
          <Select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="PRODUCTION">生产</option>
            <option value="LOGISTICS">物流</option>
            <option value="QC">品控</option>
            <option value="PACKING">包装</option>
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

function MasterModal({
  state,
  departments,
  onClose,
  onDone
}: {
  state:
    | { mode: 'create'; entity: MasterEntity }
    | { mode: 'edit'; entity: 'customers' | 'suppliers' | 'parts'; record: CustomerRow | PartRow };
  departments: DepartmentRow[];
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const isEdit = state.mode === 'edit';
  const record = isEdit ? state.record : null;
  const entity = state.entity;
  const [code, setCode] = useState(!isEdit && entity !== 'users' ? '' : (record as CustomerRow | PartRow | null)?.code ?? '');
  const [name, setName] = useState((record as CustomerRow | PartRow | null)?.name ?? '');
  const [contact, setContact] = useState(state.mode === 'edit' && state.entity !== 'parts' ? (state.record as CustomerRow).contact : '');
  const [taxNo, setTaxNo] = useState(state.mode === 'edit' && state.entity === 'customers' ? (state.record as CustomerRow).taxNo ?? '' : '');
  const [address, setAddress] = useState(state.mode === 'edit' && state.entity === 'customers' ? (state.record as CustomerRow).address ?? '' : '');
  const [spec, setSpec] = useState(state.mode === 'edit' && state.entity === 'parts' ? (state.record as PartRow).spec : '');
  const [unit, setUnit] = useState(state.mode === 'edit' && state.entity === 'parts' ? (state.record as PartRow).unit : '件');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<Role>('PRODUCTION');
  const [departmentId, setDepartmentId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const roleDepartmentCategory: Record<Exclude<Role, 'ADMIN'>, string> = {
    PRODUCTION: 'PRODUCTION',
    LOGISTICS: 'LOGISTICS',
    QC: 'QC',
    PACKING: 'PACKING'
  };

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      if (entity === 'users') {
        if (!/^[A-Za-z0-9_]{3,32}$/.test(username)) throw new Error('账号需为 3-32 位字母、数字或下划线');
        if (!displayName.trim()) throw new Error('请填写姓名');
        if (password.length < 8) throw new Error('初始密码至少 8 位');
        if (role !== 'ADMIN' && !departmentId) throw new Error('现场角色必须选择部门');
        await api.post('/users', {
          username,
          displayName: displayName.trim(),
          role,
          departmentId: role === 'ADMIN' ? null : departmentId,
          password
        });
        toast.success('员工账号已创建', '请通过受控渠道告知本人初始密码');
      } else if (isEdit) {
        const body =
          entity === 'parts'
            ? { name: name.trim(), spec: spec.trim(), unit: unit.trim() }
            : entity === 'customers'
              ? { name: name.trim(), contact: contact.trim(), taxNo: taxNo.trim(), address: address.trim() }
              : { name: name.trim(), contact: contact.trim() };
        await api.patch(`/${entity}/${record!.id}`, body);
        toast.success('基础数据已更新', '历史单据仍保留原快照');
      } else {
        const body =
          entity === 'parts'
            ? { code: code.trim(), name: name.trim(), spec: spec.trim(), unit: unit.trim() }
            : entity === 'customers'
              ? { code: code.trim(), name: name.trim(), contact: contact.trim(), taxNo: taxNo.trim(), address: address.trim() }
              : { code: code.trim(), name: name.trim(), contact: contact.trim() };
        await api.post(`/${entity}`, body);
        toast.success('记录已创建');
      }
      onDone();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSubmitting(false);
    }
  };

  const title =
    entity === 'users'
      ? '新增员工账号'
      : isEdit
        ? '编辑基础数据'
        : entity === 'customers'
          ? '新增客户'
          : entity === 'suppliers'
            ? '新增供应商'
            : '新增配件';

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      subtitle="所有记录均为合成演示数据；停用不会删除历史。"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button loading={submitting} onClick={() => void submit()}>
            保存
          </Button>
        </>
      }
    >
      <div className="stack">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {entity === 'users' ? (
          <div className="form-grid">
            <Field label="登录账号" required hint="3-32 位字母、数字或下划线">
              <TextInput value={username} onChange={(event) => setUsername(event.target.value)} />
            </Field>
            <Field label="姓名" required>
              <TextInput value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
            </Field>
            <Field label="角色" required>
              <Select
                value={role}
                onChange={(event) => {
                  setRole(event.target.value as Role);
                  setDepartmentId('');
                }}
              >
                <option value="ADMIN">管理员</option>
                <option value="LOGISTICS">物流</option>
                <option value="PRODUCTION">生产</option>
                <option value="QC">品控</option>
                <option value="PACKING">包装</option>
              </Select>
            </Field>
            <Field label="所属部门" required={role !== 'ADMIN'}>
              <Select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} disabled={role === 'ADMIN'}>
                <option value="">{role === 'ADMIN' ? '管理员不绑定现场部门' : '请选择部门'}</option>
                {departments
                  .filter((department) => department.active && (role === 'ADMIN' || department.category === roleDepartmentCategory[role as Exclude<Role, 'ADMIN'>]))
                  .map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="初始密码" required hint="至少 8 位；不会写入浏览器存储">
              <TextInput type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" />
            </Field>
          </div>
        ) : (
          <div className="form-grid">
            {!isEdit ? (
              <Field label="编码" required hint="唯一，保存时转为大写">
                <TextInput
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  placeholder={entity === 'customers' ? '例如 CUS-003' : entity === 'suppliers' ? '例如 SUP-003' : '例如 PART-004'}
                />
              </Field>
            ) : null}
            <Field
              label={entity === 'customers' ? '客户名称' : entity === 'suppliers' ? '供应商名称' : '配件名称'}
              required
            >
              <TextInput value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
            {entity === 'parts' ? (
              <>
                <Field label="规格">
                  <TextInput value={spec} onChange={(event) => setSpec(event.target.value)} />
                </Field>
                <Field label="单位">
                  <TextInput value={unit} onChange={(event) => setUnit(event.target.value)} />
                </Field>
              </>
            ) : (
              <>
                <Field label="联系方式">
                  <TextInput value={contact} onChange={(event) => setContact(event.target.value)} placeholder="合成联系人 / 合成电话" />
                </Field>
                {entity === 'customers' ? (
                  <>
                    <Field label="税号（选填）" hint="可以不填；仅用于展示与人工对账">
                      <TextInput value={taxNo} onChange={(event) => setTaxNo(event.target.value)} maxLength={50} placeholder="例如 91310000DEMO0001X" />
                    </Field>
                    <Field label="地址（选填）" hint="可以不填">
                      <TextInput value={address} onChange={(event) => setAddress(event.target.value)} maxLength={200} placeholder="例如 上海市合成路 1 号" />
                    </Field>
                  </>
                ) : null}
              </>
            )}
          </div>
        )}
        <p className="muted-note">提示：历史订单保存客户名、产品名与价格快照，修改基础数据不会改写历史单据。</p>
      </div>
    </Modal>
  );
}
