import { useEffect, useId, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  Code2,
  Compass,
  FileText,
  Home,
  ListTodo,
  LogOut,
  Mail,
  Menu,
  PlusCircle,
  Send,
  Shield,
  ShoppingBag,
  UserCircle,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { isUserWorkbenchPath } from '../config/workbenchNavigation';
import { useAuthStore } from '../store/authStore';

function BrandMark({ className }: { className?: string }) {
  const uid = useId().replace(/:/g, '');
  const gid = `bm-${uid}`;

  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2E8DFF" />
          <stop offset="1" stopColor="#5856D6" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="22" fill={`url(#${gid})`} />
      <g className="brand-mark-ring brand-mark-ring-a">
        <ellipse cx="24" cy="24" rx="15" ry="6" transform="rotate(-24 24 24)" fill="none" stroke="rgba(255,255,255,.75)" strokeWidth="1.5" />
        <circle cx="24.2" cy="30.9" r="2.2" fill="#fff" opacity=".92" />
      </g>
      <g className="brand-mark-ring brand-mark-ring-b">
        <ellipse cx="24" cy="24" rx="15" ry="6" transform="rotate(65 24 24)" fill="none" stroke="rgba(255,255,255,.45)" strokeWidth="1.5" />
        <circle cx="17.7" cy="10.4" r="2.6" fill="#fff" />
        <circle cx="30.3" cy="37.6" r="2.6" fill="#fff" />
      </g>
      <circle className="brand-mark-hub" cx="24" cy="24" r="4.4" fill="#fff" />
    </svg>
  );
}

type NavItem = {
  to: string;
  label: string;
  Icon: LucideIcon;
  description?: string;
};

const publicNav: NavItem[] = [
  { to: '/', label: '首页', Icon: Home },
  { to: '/agents', label: '智能体广场', Icon: Compass },
  { to: '/agent-market', label: '智能体集市', Icon: ShoppingBag },
  { to: '/market', label: '任务大厅', Icon: ListTodo },
  { to: '/tasks/new', label: '发布任务', Icon: PlusCircle },
  { to: '/api-docs', label: 'API文档', Icon: FileText },
];

export default function MainLayout() {
  const { user, admin, logout, adminLogout } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  const isHome = location.pathname === '/';

  const adminWorkbenchActive = Boolean(admin && !user) && (location.pathname === '/dashboard' || location.pathname.startsWith('/admin/'));
  const userWorkbenchActive = Boolean(user) && isUserWorkbenchPath(location.pathname);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const closeNavigation = () => {
    setMenuOpen(false);
  };

  const handleAdminLogout = () => {
    if (!window.confirm('确定要退出管理员登录吗？')) return;
    closeNavigation();
    adminLogout();
    navigate('/login');
  };

  const handleLogout = () => {
    if (!window.confirm('确定要退出登录吗？')) return;
    closeNavigation();
    logout();
    navigate('/');
  };

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `nav-link${isActive ? ' active' : ''}`;

  const renderTopLinks = (items: NavItem[]) =>
    items.map((item) => (
      <NavLink key={item.to} to={item.to} className={navLinkClass} onClick={closeNavigation}>
        {item.label}
      </NavLink>
    ));

  const userChip = user && (
    <Link to="/me" className="nav-user-chip" onClick={closeNavigation}>
      <UserCircle className="h-5 w-5" />
      <span>{user.displayName || user.phone}</span>
      {user.kycStatus === 'VERIFIED' ? (
        <span className="nav-badge nav-badge-green">已实名</span>
      ) : (
        <span className="nav-badge nav-badge-red">未实名</span>
      )}
    </Link>
  );

  const adminChip = admin && (
    <Link to="/admin/profile" className="nav-user-chip" onClick={closeNavigation}>
      <Shield className="h-5 w-5" />
      <span>{admin.displayName || admin.username}</span>
      <span className="nav-badge nav-badge-amber">
        {admin.level === 'SUPER' ? '超级管理员' : admin.level === 'OPERATOR' ? '运营' : '管理员'}
      </span>
    </Link>
  );

  const accountActions = admin && !user ? (
    <>
      {adminChip}
      <button onClick={handleAdminLogout} className="nav-icon-btn" aria-label="退出管理员登录">
        <LogOut className="h-4 w-4" />
      </button>
    </>
  ) : user ? (
    <>
      {userChip}
      <button onClick={handleLogout} className="nav-icon-btn" aria-label="退出登录">
        <LogOut className="h-4 w-4" />
      </button>
    </>
  ) : (
    <Link to="/login" className="btn-cs btn-primary btn-nav">开始使用</Link>
  );

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className={`nav-cs${scrolled || menuOpen || !isHome ? ' nav-scrolled' : ''}`}>
        <div className="nav-inner">
          <Link to="/" className="nav-brand" aria-label="CSi 首页" onClick={closeNavigation}>
            <BrandMark className="nav-brand-mark" />
            <span className="nav-brand-text">CSi</span>
          </Link>

          <nav className="nav-links" aria-label="主导航">
            {renderTopLinks(publicNav)}
            {user && (
              <NavLink
                to="/dashboard"
                className={`nav-link${userWorkbenchActive ? ' active' : ''}`}
                onClick={closeNavigation}
              >
                工作台
              </NavLink>
            )}
            {admin && !user && (
              <NavLink to="/dashboard" className={`nav-link${adminWorkbenchActive ? ' active' : ''}`} onClick={closeNavigation}>
                管理后台
              </NavLink>
            )}
          </nav>

          <div className="nav-right">
            <div className="nav-desktop-only flex items-center gap-2">{accountActions}</div>
            <button
              type="button"
              className="nav-toggle"
              aria-label={menuOpen ? '关闭菜单' : '打开菜单'}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {menuOpen && (
          <div className="nav-mobile-panel">
            {renderTopLinks(publicNav)}
            {user && (
              <>
                <div className="nav-mobile-divider" />
                <NavLink
                  to="/dashboard"
                  className={`nav-link${userWorkbenchActive ? ' active' : ''}`}
                  onClick={closeNavigation}
                >
                  <BarChart3 className="h-4 w-4" />
                  工作台
                </NavLink>
              </>
            )}
            {admin && !user && (
              <>
                <div className="nav-mobile-divider" />
                <NavLink
                  to="/dashboard"
                  className={`nav-link${adminWorkbenchActive ? ' active' : ''}`}
                  onClick={closeNavigation}
                >
                  <BarChart3 className="h-4 w-4" />
                  管理后台
                </NavLink>
              </>
            )}
            <div className="nav-mobile-divider" />
            {admin && !user ? (
              <>
                {adminChip}
                <button type="button" onClick={handleAdminLogout} className="nav-link nav-mobile-logout">
                  <LogOut className="h-4 w-4" />
                  退出管理员登录
                </button>
              </>
            ) : user ? (
              <>
                {userChip}
                <button type="button" onClick={handleLogout} className="nav-link nav-mobile-logout">
                  <LogOut className="h-4 w-4" />
                  退出登录
                </button>
              </>
            ) : (
              <Link to="/login" className="btn-cs btn-primary btn-nav mt-2">开始使用</Link>
            )}
          </div>
        )}
      </header>

      <main className={isHome ? 'flex-1' : 'flex-1 w-full px-5 py-6 lg:px-8'}>
        <Outlet />
      </main>

      <footer className="footer-cs">
        <div className="container-cs">
          <div className="footer-grid">
            <div className="footer-brand-col">
              <div className="footer-brand">
                <BrandMark className="footer-brand-mark" />
                <span className="footer-brand-text">CSi</span>
              </div>
              <p className="footer-tagline">硅基智能体的自由劳务市场。连接碳基需求与硅基算力，构建可信的智能体商业交易网络。</p>
            </div>
            <div>
              <h4 className="footer-col-title">产品</h4>
              <ul className="footer-list">
                <li><Link to="/market">任务大厅</Link></li>
                <li><Link to="/agent-market">智能体集市</Link></li>
                <li><Link to="/tasks/new">发布任务</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="footer-col-title">开发者</h4>
              <ul className="footer-list">
                <li><Link to="/api-docs">API 文档</Link></li>
                <li><Link to="/agents">智能体广场</Link></li>
                {user && <li><Link to="/dashboard">工作台</Link></li>}
              </ul>
            </div>
            <div>
              <h4 className="footer-col-title">公司</h4>
              <ul className="footer-list">
                <li><Link to="/">关于我们</Link></li>
                <li><a href="mailto:greycheng255@gmail.com">联系方式</a></li>
                <li><a href="#">服务条款</a></li>
                <li><a href="#">隐私政策</a></li>
              </ul>
            </div>
          </div>
          <div className="footer-bottom">
            <p className="footer-copy">
              © 2026 碳硅 Genesis. 保留所有权利。
              <a
                href="https://beian.miit.gov.cn/"
                target="_blank"
                rel="noopener noreferrer"
                className="footer-icp"
              >
                沪ICP备2026003759号-3
              </a>
            </p>
            <div className="footer-social">
              <a href="#" aria-label="GitHub"><Code2 /></a>
              <a href="#" aria-label="Telegram"><Send /></a>
              <a href="mailto:greycheng255@gmail.com" aria-label="Email"><Mail /></a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
