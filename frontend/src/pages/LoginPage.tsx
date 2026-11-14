import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Boxes,
  Check,
  Eye,
  EyeOff,
  Factory,
  LockKeyhole,
  PackageCheck,
  ShieldCheck,
  Truck,
  UserRound
} from 'lucide-react';
import { useAuth, homeForRole } from '../app/AuthContext';
import { api, errorMessage } from '../lib/api';
import type { DemoAccount, Role } from '../lib/types';
import { Button, Spinner } from '../components/ui';

const ROLE_META: Record<Role, { label: string; icon: typeof UserRound; hint: string }> = {
  ADMIN: { label: '管理员', icon: Boxes, hint: '订单、采购、成本与库存' },
  LOGISTICS: { label: '物流', icon: Truck, hint: '到货登记与发货' },
  PRODUCTION: { label: '生产', icon: Factory, hint: '本部门生产任务' },
  QC: { label: '品控', icon: ShieldCheck, hint: '录入检验结果' },
  PACKING: { label: '包装', icon: PackageCheck, hint: '处理已放行包装' }
};

const FLOW = ['建单', '采购', '到货', '生产', '质检', '包装', '发货'];

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('Demo@2026');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<DemoAccount[] | null>(null);
  const [selected, setSelected] = useState<string | null>('admin');

  useEffect(() => {
    api
      .get<DemoAccount[]>('/auth/demo-accounts')
      .then(setAccounts)
      .catch(() => setAccounts(null));
  }, []);

  const choose = (account: DemoAccount) => {
    setUsername(account.username);
    setPassword(account.password);
    setSelected(account.username);
    setError(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const user = await login(username.trim(), password);
      const state = location.state as { from?: string } | null;
      const target = state?.from && state.from !== '/login' ? state.from : homeForRole(user.role);
      navigate(target, { replace: true });
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <section className="login-visual">
        <div className="login-brand">
          <span className="brand-mark brand-mark-large">厂</span>
          <div>
            <strong>厂序</strong>
            <small>FACTORYFLOW / 工厂业务协同</small>
          </div>
        </div>
        <div className="login-hero">
          <p className="eyebrow eyebrow-light">ORDER TO DELIVERY</p>
          <h1>
            让一张订单，
            <br />
            走完整个工厂。
          </h1>
          <p className="login-lede">
            从采购到发货，把分散在车间、仓库和办公室里的动作，收进同一份可追溯的业务记录。
          </p>
        </div>
        <div className="login-flow" aria-label="业务流程">
          {FLOW.map((step, index) => (
            <div key={step} className="login-flow-step">
              <span className="flow-index">{String(index + 1).padStart(2, '0')}</span>
              <span className="flow-label">{step}</span>
              {index < FLOW.length - 1 ? <span className="flow-line" /> : null}
            </div>
          ))}
        </div>
        <p className="login-flow-note">主流转 7 个工位；电镀本版不适用，未列入。</p>
        <div className="login-proof">
          <div>
            <strong>5</strong>
            <span>业务角色</span>
          </div>
          <div>
            <strong>9</strong>
            <span>流程阶段</span>
          </div>
          <div>
            <strong>1</strong>
            <span>真实数据源</span>
          </div>
        </div>
        <p className="login-disclaimer">合成演示环境 · 不含真实客户、员工或生产数据</p>
      </section>

      <section className="login-panel">
        <div className="login-card">
          <header>
            <p className="eyebrow">SIGN IN</p>
            <h2>进入协同系统</h2>
            <p className="login-subtitle">使用分配的业务账号登录，系统将按角色隔离数据与权限。</p>
          </header>

          <form onSubmit={submit} className="login-form">
            <label className="login-field">
              <span>账号</span>
              <div className="login-input-wrap">
                <UserRound size={17} />
                <input
                  value={username}
                  onChange={(event) => {
                    setUsername(event.target.value);
                    setSelected(null);
                  }}
                  autoComplete="username"
                  placeholder="请输入账号"
                  required
                />
              </div>
            </label>
            <label className="login-field">
              <span>密码</span>
              <div className="login-input-wrap">
                <LockKeyhole size={17} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  placeholder="请输入密码"
                  required
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>
            {error ? <div className="login-error">{error}</div> : null}
            <Button
            type="submit"
            size="lg"
            loading={loading}
            className="login-submit fx-mask fx-parallax"
            data-fx-particles
          >
              登录系统 <ArrowRight size={17} />
            </Button>
          </form>

          <div className="demo-section">
            <div className="demo-heading">
              <span>演示身份</span>
              <small>点击填入合成账号</small>
            </div>
            {accounts === null ? (
              <div className="demo-loading">
                <Spinner label="读取演示账号" />
              </div>
            ) : (
              <div className="demo-grid">
                {accounts.map((account) => {
                  const meta = ROLE_META[account.role];
                  const Icon = meta.icon;
                  return (
                    <button
                      key={account.username}
                      type="button"
                      className={selected === account.username ? 'demo-account demo-account-active' : 'demo-account'}
                      onClick={() => choose(account)}
                    >
                      <span className={`demo-icon role-${account.role.toLowerCase()}`}>
                        <Icon size={16} />
                      </span>
                      <span className="demo-copy">
                        <strong>{meta.label}</strong>
                        <small>{account.displayName}</small>
                      </span>
                      {selected === account.username ? <Check size={15} className="demo-check" /> : null}
                    </button>
                  );
                })}
              </div>
            )}
            <p className="demo-hint">账号仅用于本机演示，密码不会记录在浏览器存储中。</p>
          </div>
        </div>
        <p className="login-footnote">
          厂序 FactoryFlow · 业务时区 北京时间（UTC+08:00） · 合成演示环境
        </p>
      </section>
    </div>
  );
}
