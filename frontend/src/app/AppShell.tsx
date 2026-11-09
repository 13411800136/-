import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Bell,
  Boxes,
  ClipboardCheck,
  ClipboardList,
  Factory,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  PackageCheck,
  ScrollText,
  ShieldCheck,
  Truck,
  Users,
  X
} from 'lucide-react';
import { useAuth } from './AuthContext';
import { Button, Modal, RoleBadge } from '../components/ui';
import { api } from '../lib/api';
import { initials } from '../lib/format';

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  end?: boolean;
}

const ADMIN_NAV: NavItem[] = [
  { to: '/admin', label: '业务看板', icon: LayoutDashboard, end: true },
  { to: '/admin/orders', label: '订单协同', icon: ClipboardList },
  { to: '/admin/inventory', label: '库存台账', icon: Boxes },
  { to: '/admin/master', label: '基础数据', icon: Users },
  { to: '/admin/exceptions', label: '现场异常', icon: AlertTriangle },
  { to: '/messages', label: '内部消息', icon: MessageSquare },
  { to: '/admin/notifications', label: '通知中心', icon: Bell },
  { to: '/admin/audit', label: '审计日志', icon: ScrollText }
];

const ROLE_NAV: Record<string, NavItem[]> = {
  LOGISTICS: [
    { to: '/tablet/logistics', label: '物流工作台', icon: Truck, end: true },
    { to: '/messages', label: '内部消息', icon: MessageSquare },
    { to: '/tablet/exceptions', label: '异常上报', icon: AlertTriangle }
  ],
  PRODUCTION: [
    { to: '/tablet/production', label: '生产任务', icon: Factory, end: true },
    { to: '/messages', label: '内部消息', icon: MessageSquare },
    { to: '/tablet/exceptions', label: '异常上报', icon: AlertTriangle }
  ],
  QC: [
    { to: '/tablet/qc', label: '质检队列', icon: ShieldCheck, end: true },
    { to: '/messages', label: '内部消息', icon: MessageSquare },
    { to: '/tablet/exceptions', label: '异常上报', icon: AlertTriangle }
  ],
  PACKING: [
    { to: '/tablet/packing', label: '包装队列', icon: PackageCheck, end: true },
    { to: '/messages', label: '内部消息', icon: MessageSquare },
    { to: '/tablet/exceptions', label: '异常上报', icon: AlertTriangle }
  ]
};

const TITLES: Array<[RegExp, string]> = [
  [/^\/admin\/orders\/new/, '创建订单'],
  [/^\/admin\/orders\/[^/]+/, '订单详情'],
  [/^\/admin\/orders$/, '订单协同'],
  [/^\/admin\/inventory$/, '库存台账'],
  [/^\/admin\/master$/, '基础数据'],
  [/^\/admin\/exceptions$/, '现场异常'],
  [/^\/admin\/notifications$/, '通知中心'],
  [/^\/admin\/audit$/, '审计日志'],
  [/^\/messages$/, '内部消息'],
  [/^\/admin$/, '业务看板'],
  [/^\/tablet\/logistics$/, '物流工作台'],
  [/^\/tablet\/production$/, '生产任务'],
  [/^\/tablet\/qc$/, '质检队列'],
  [/^\/tablet\/packing$/, '包装队列'],
  [/^\/tablet\/exceptions$/, '异常上报']
];

export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [messageUnread, setMessageUnread] = useState(0);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const nav = useMemo(() => {
    if (!user) return [];
    return user.role === 'ADMIN' ? ADMIN_NAV : ROLE_NAV[user.role] ?? [];
  }, [user]);

  const title = TITLES.find(([pattern]) => pattern.test(location.pathname))?.[1] ?? '厂序';
  const home = user?.role === 'ADMIN' ? '/admin' : nav[0]?.to ?? '/login';

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (user?.role !== 'ADMIN') return;
    let active = true;
    const load = () => {
      api
        .get<{ unreadCount: number }>('/notifications/unread-count')
        .then((data) => {
          if (active) setUnread(data.unreadCount);
        })
        .catch(() => undefined);
    };
    load();
    const timer = window.setInterval(load, 45_000);
    const refresh = () => load();
    window.addEventListener('notifications:changed', refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('notifications:changed', refresh);
    };
  }, [user?.role, location.pathname]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    const load = () => {
      api
        .get<{ unreadCount: number }>('/messages/unread-count')
        .then((data) => {
          if (active) setMessageUnread(data.unreadCount);
        })
        .catch(() => undefined);
    };
    load();
    const timer = window.setInterval(load, 45_000);
    const refresh = () => load();
    window.addEventListener('messages:changed', refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('messages:changed', refresh);
    };
  }, [user, location.pathname]);

  if (!user) return null;

  const onLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
      setLogoutOpen(false);
      navigate('/login', { replace: true });
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <div className="app-shell">
      <aside className={open ? 'sidebar sidebar-open' : 'sidebar'}>
        <div className="brand">
          <NavLink to={home} className="brand-link" aria-label="返回首页">
            <span className="brand-mark" aria-hidden="true">
              厂
            </span>
            <span className="brand-copy">
              <strong>厂序</strong>
              <small>FACTORYFLOW</small>
            </span>
          </NavLink>
          <button type="button" className="sidebar-close" onClick={() => setOpen(false)} aria-label="关闭导航">
            <X size={18} />
          </button>
        </div>
        <div className="sidebar-context">
          <span className="context-label">{user.role === 'ADMIN' ? '管理后台' : '现场协作'}</span>
          <span className="context-value">{user.role === 'ADMIN' ? '全流程协同' : user.departmentName ?? '现场'}</span>
        </div>
        <nav className="main-nav" aria-label="主导航">
          {nav.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => (isActive ? 'nav-item nav-item-active' : 'nav-item')}
              >
                <Icon size={18} strokeWidth={1.8} />
                <span>{item.label}</span>
                {item.to === '/admin/notifications' && unread > 0 ? (
                  <span className="nav-badge">{unread > 99 ? '99+' : unread}</span>
                ) : null}
                {item.to === '/messages' && messageUnread > 0 ? (
                  <span className="nav-badge">{messageUnread > 99 ? '99+' : messageUnread}</span>
                ) : null}
              </NavLink>
            );
          })}
        </nav>
        <div className="sidebar-note">
          <span className="sidebar-note-title">合成演示环境</span>
          <p>所有客户、员工与订单均为虚构数据，仅用于考核演示。</p>
        </div>
        <div className="sidebar-user">
          <span className="avatar">{initials(user.displayName)}</span>
          <div className="sidebar-user-copy">
            <strong>{user.displayName}</strong>
            <span>
              {user.role === 'ADMIN' ? '系统管理员' : user.departmentName ?? '现场人员'} · <RoleBadge role={user.role} />
            </span>
          </div>
          <button type="button" className="icon-button icon-button-dark" onClick={() => setLogoutOpen(true)} aria-label="退出登录" title="退出登录">
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      {open ? <button type="button" className="sidebar-scrim" aria-label="关闭导航" onClick={() => setOpen(false)} /> : null}

      <div className="app-main">
        <header className="topbar">
          <div className="topbar-left">
            <button type="button" className="icon-button menu-button" onClick={() => setOpen(true)} aria-label="打开导航">
              <Menu size={20} />
            </button>
            <div className="topbar-title">
              <span className="topbar-kicker">{user.role === 'ADMIN' ? 'ADMIN CONSOLE' : 'SHOP FLOOR'}</span>
              <strong>{title}</strong>
            </div>
          </div>
          <div className="topbar-right">
            <span className="topbar-date">
              {new Intl.DateTimeFormat('zh-CN', {
                timeZone: 'Asia/Shanghai',
                month: '2-digit',
                day: '2-digit',
                weekday: 'short'
              }).format(new Date())}
            </span>
            {user.role === 'ADMIN' ? (
              <button type="button" className="topbar-bell" onClick={() => navigate('/admin/notifications')} aria-label={`通知，未读 ${unread}`}>
                <Bell size={18} />
                {unread > 0 ? <span className="bell-dot">{unread > 9 ? '9+' : unread}</span> : null}
              </button>
            ) : null}
            <span className="topbar-avatar">{initials(user.displayName)}</span>
          </div>
        </header>
        <main className="page-content">
          <Outlet />
        </main>
        <footer className="app-footer">
          <span>厂序 FactoryFlow · v1.2.0</span>
          <span>业务时区 Asia/Shanghai · 仅合成演示数据</span>
        </footer>
      </div>

      <Modal
        open={logoutOpen}
        onClose={() => {
          if (!loggingOut) setLogoutOpen(false);
        }}
        title="确认退出登录"
        subtitle="退出后需要重新输入账号和密码"
        size="sm"
        footer={
          <>
            <Button variant="ghost" disabled={loggingOut} onClick={() => setLogoutOpen(false)}>
              取消
            </Button>
            <Button variant="primary" loading={loggingOut} onClick={() => void onLogout()}>
              确认退出
            </Button>
          </>
        }
      >
        <div className="confirm-body">
          当前账号：<strong>{user.displayName}</strong>。退出登录不会删除任何业务数据或本机草稿。
        </div>
        <p className="muted-note">如果只是切换页面，请点“取消”；需要切换身份时再确认退出。</p>
      </Modal>
    </div>
  );
}
