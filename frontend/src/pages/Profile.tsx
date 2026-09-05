import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { UserCircle, Phone, Shield, LogOut, Key, Clock, Globe, ChevronDown, ChevronUp, Loader2, CheckCircle, XCircle, Edit3, Mail, WalletCards, Copy, KeyRound, Trash2 } from 'lucide-react';
import { API_BASE } from '../config/api';
import { WorkbenchPageHeader } from '../components/workbench/WorkbenchPrimitives';

/** 个人访问令牌（PAT）元数据 */
interface PatItem {
  id: string;
  name: string | null;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export default function Profile() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = () => {
    if (!window.confirm('确定要退出登录吗？')) return;
    logout();
    navigate('/');
  };

  // SSO 全局登出：撤销所有设备/应用的登录与 SSO 令牌（PAT 保留），再清除本地状态
  const handleLogoutAll = async () => {
    if (!window.confirm('确定要退出所有设备的登录吗？所有网页与应用会话将立即失效（个人访问令牌保留）。')) return;
    try {
      await fetch(`${API_BASE}/api/v1/sso/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${useAuthStore.getState().token}`,
        },
        body: JSON.stringify({}),
      });
    } catch {
      // 网络异常时仍清除本地登录状态
    }
    logout();
    navigate('/');
  };

  const admin = useAuthStore(state => state.admin);
  const adminToken = useAuthStore(state => state.adminToken);

  // ==================== 管理员个人中心 ====================
  const [showAdminPwd, setShowAdminPwd] = useState(false);
  const [adminOldPwd, setAdminOldPwd] = useState('');
  const [adminNewPwd, setAdminNewPwd] = useState('');
  const [adminPwdLoading, setAdminPwdLoading] = useState(false);
  const [adminPwdMsg, setAdminPwdMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [adminInfo, setAdminInfo] = useState<{ lastLoginAt?: string; loginIp?: string }>({});
  const [adminInfoLoading, setAdminInfoLoading] = useState(true);
  const [adminInfoError, setAdminInfoError] = useState(false);

  // ==================== 用户状态 ====================
  const [userEdit, setUserEdit] = useState(false);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editMsg, setEditMsg] = useState('');
  const [showUserPwd, setShowUserPwd] = useState(false);
  const [userOldPwd, setUserOldPwd] = useState('');
  const [userNewPwd, setUserNewPwd] = useState('');
  const [userPwdLoading, setUserPwdLoading] = useState(false);
  const [userPwdMsg, setUserPwdMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [balance, setBalance] = useState<{ availableCny: number; frozenCny: number; totalIncomeCny: number } | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(true);
  const [balanceError, setBalanceError] = useState(false);

  // ==================== PAT（个人访问令牌）====================
  const [pats, setPats] = useState<PatItem[]>([]);
  const [patLoading, setPatLoading] = useState(false);
  const [patError, setPatError] = useState('');
  const [showPatCreate, setShowPatCreate] = useState(false);
  const [patName, setPatName] = useState('');
  const [patExpiryDays, setPatExpiryDays] = useState('');
  const [patCreating, setPatCreating] = useState(false);
  const [newPatToken, setNewPatToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const patHeaders = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${useAuthStore.getState().token}`,
  });

  const loadPats = useCallback(() => {
    setPatLoading(true);
    setPatError('');
    fetch(`${API_BASE}/api/v1/users/pat`, { headers: patHeaders() })
      .then((response) => {
        if (!response.ok) throw new Error('pat-request-failed');
        return response.json();
      })
      .then((data) => setPats(data.pats || []))
      .catch(() => setPatError('令牌列表加载失败，请稍后重试'))
      .finally(() => setPatLoading(false));
  }, []);

  useEffect(() => {
    if (!user) return;
    loadPats();
  }, [user, loadPats]);

  const handleCreatePat = async (e: React.FormEvent) => {
    e.preventDefault();
    setPatError('');
    const name = patName.trim();
    if (!name) {
      setPatError('请输入令牌名称');
      return;
    }
    const expiry = patExpiryDays.trim();
    const expiresInDays = expiry ? Number(expiry) : undefined;
    if (expiresInDays !== undefined && (!Number.isInteger(expiresInDays) || expiresInDays <= 0)) {
      setPatError('有效期必须为正整数天数');
      return;
    }
    setPatCreating(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/users/pat`, {
        method: 'POST',
        headers: patHeaders(),
        body: JSON.stringify({ name, expiresInDays }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPatError(data.message || '创建失败');
        return;
      }
      setNewPatToken(data.token);
      setPatName('');
      setPatExpiryDays('');
      setShowPatCreate(false);
      loadPats();
    } catch {
      setPatError('网络错误');
    } finally {
      setPatCreating(false);
    }
  };

  const handleRevokePat = async (id: string, name: string | null) => {
    if (!window.confirm(`确定要撤销令牌「${name || id}」吗？使用该令牌的客户端将立即失去访问权限。`)) return;
    try {
      const res = await fetch(`${API_BASE}/api/v1/users/pat/${id}`, {
        method: 'DELETE',
        headers: patHeaders(),
      });
      if (res.ok) {
        loadPats();
      } else {
        const data = await res.json();
        setPatError(data.message || '撤销失败');
      }
    } catch {
      setPatError('网络错误');
    }
  };

  const handleCopyToken = async () => {
    if (!newPatToken) return;
    try {
      await navigator.clipboard.writeText(newPatToken);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // 剪贴板不可用时静默降级，用户可手动选择复制
    }
  };

  useEffect(() => {
    if (!admin || !adminToken) return;
    const controller = new AbortController();
    setAdminInfoLoading(true);
    setAdminInfoError(false);
    fetch(`${API_BASE}/api/v1/admin/me`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error('admin-profile-request-failed');
        return response.json();
      })
      .then((data) => setAdminInfo({ lastLoginAt: data.lastLoginAt, loginIp: data.loginIp }))
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setAdminInfoError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setAdminInfoLoading(false);
      });
    return () => controller.abort();
  }, [admin, adminToken]);

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    setBalanceLoading(true);
    setBalanceError(false);
    fetch(`${API_BASE}/api/v1/balance/my`, {
      headers: { Authorization: `Bearer ${useAuthStore.getState().token}` },
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error('balance-request-failed');
        return response.json();
      })
      .then((data) => setBalance(data.data || data))
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setBalanceError(true);
      })
      .finally(() => setBalanceLoading(false));
    return () => controller.abort();
  }, [user]);

  const handleAdminChangePwd = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminPwdMsg(null);
    if (!adminOldPwd || !adminNewPwd) {
      setAdminPwdMsg({ ok: false, text: '请填写所有字段' });
      return;
    }
    if (adminNewPwd.length < 6) {
      setAdminPwdMsg({ ok: false, text: '新密码长度至少6位' });
      return;
    }
    setAdminPwdLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/admin/change-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ oldPassword: adminOldPwd, newPassword: adminNewPwd }),
      });
      const data = await res.json();
      if (res.ok) {
        setAdminPwdMsg({ ok: true, text: '密码修改成功' });
        setAdminOldPwd('');
        setAdminNewPwd('');
        setShowAdminPwd(false);
      } else {
        setAdminPwdMsg({ ok: false, text: data.message || '修改失败' });
      }
    } catch {
      setAdminPwdMsg({ ok: false, text: '网络错误' });
    } finally {
      setAdminPwdLoading(false);
    }
  };

  const levelLabel = (level: string) =>
    level === 'SUPER' ? '超级管理员' : level === 'OPERATOR' ? '运营' : '管理员';

  if (admin) {
    return (
      <div className="mx-auto w-full max-w-[1440px] space-y-6">
        <WorkbenchPageHeader
          icon={Shield}
          eyebrow="管理员中心"
          title="账号与安全"
          description="查看当前后台身份、授权范围和最近登录信息，并维护管理员登录密码。"
          actions={<Link to="/dashboard" className="btn-cs btn-ghost-dark btn-sm">返回数据概览</Link>}
        />

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
          <section className="overflow-hidden rounded-2xl border border-[color:var(--border)] bg-white">
            <div className="flex items-center gap-4 border-b border-[color:var(--border)] px-5 py-5 sm:px-6">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-50)] text-[var(--brand-600)]">
                <Shield className="h-7 w-7" />
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-lg font-semibold text-[var(--text-900)]">{admin.displayName || admin.username}</h2>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-[var(--brand-200)] bg-[var(--brand-50)] px-2.5 py-1 text-xs font-medium text-[var(--brand-700)]">{levelLabel(admin.level)}</span>
                  <span className="font-mono text-xs text-[var(--text-400)]">{admin.username}</span>
                </div>
              </div>
            </div>

            {adminInfoLoading ? (
              <div className="grid gap-4 p-5 sm:grid-cols-2 sm:p-6" aria-label="正在加载登录信息">
                <div className="h-11 animate-pulse rounded-lg bg-[var(--background-100)]" />
                <div className="h-11 animate-pulse rounded-lg bg-[var(--background-100)]" />
              </div>
            ) : adminInfoError ? (
              <div className="bg-[var(--state-error-surface)] px-5 py-4 text-sm text-[var(--state-error)] sm:px-6">
                最近登录信息暂时无法加载，不影响其他管理功能。
              </div>
            ) : (
              <dl className="grid divide-y divide-[color:var(--border)] sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                <div className="flex gap-3 p-5 sm:p-6">
                  <Clock className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-400)]" />
                  <div><dt className="text-xs text-[var(--text-500)]">最后登录</dt><dd className="mt-1 text-sm font-medium text-[var(--text-800)]">{adminInfo.lastLoginAt ? new Date(adminInfo.lastLoginAt).toLocaleString('zh-CN') : '暂无记录'}</dd></div>
                </div>
                <div className="flex gap-3 p-5 sm:p-6">
                  <Globe className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-400)]" />
                  <div><dt className="text-xs text-[var(--text-500)]">最近登录 IP</dt><dd className="mt-1 break-all font-mono text-sm font-medium text-[var(--text-800)]">{adminInfo.loginIp || '暂无记录'}</dd></div>
                </div>
              </dl>
            )}

            <div className="border-t border-[color:var(--border)] px-5 py-5 sm:px-6">
              <div className="flex items-center justify-between gap-3">
                <div><h3 className="text-sm font-semibold text-[var(--text-800)]">授权范围</h3><p className="mt-1 text-xs text-[var(--text-500)]">由超级管理员在管理员账号页面统一配置</p></div>
                <span className="text-xs text-[var(--text-400)]">{admin.permissions?.length || 0} 项</span>
              </div>
              {admin.permissions && admin.permissions.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {admin.permissions.map((permission) => (
                    <span key={permission} className="rounded-lg bg-[var(--background-100)] px-2.5 py-1.5 font-mono text-xs text-[var(--text-600)]">
                      {permission === '*' ? '全部权限' : permission}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-4 text-sm text-[var(--text-500)]">当前账号未配置额外权限。</p>
              )}
            </div>
          </section>

          <section className="h-fit overflow-hidden rounded-2xl border border-[color:var(--border)] bg-white">
            <div className="border-b border-[color:var(--border)] px-5 py-5">
              <h2 className="font-semibold text-[var(--text-900)]">安全设置</h2>
              <p className="mt-1 text-sm leading-6 text-[var(--text-500)]">定期更新密码，避免多个后台账号共用同一登录凭证。</p>
            </div>

            {adminPwdMsg && (
              <div className={`mx-5 mt-5 flex items-center gap-2 rounded-xl border p-3 text-sm ${adminPwdMsg.ok ? 'border-[#bde9c9] bg-[var(--state-success-surface)] text-[var(--state-success-text)]' : 'border-[#ffc6c1] bg-[var(--state-error-surface)] text-[var(--state-error)]'}`}>
                {adminPwdMsg.ok ? <CheckCircle className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}{adminPwdMsg.text}
              </div>
            )}

            <button
              type="button"
              onClick={() => { setShowAdminPwd(!showAdminPwd); setAdminPwdMsg(null); }}
              className="flex min-h-14 w-full items-center justify-between px-5 text-left transition-colors hover:bg-[var(--background-100)]"
              aria-expanded={showAdminPwd}
            >
              <span className="flex items-center gap-3 text-sm font-medium text-[var(--text-700)]"><Key className="h-4 w-4 text-[var(--brand-600)]" />修改登录密码</span>
              {showAdminPwd ? <ChevronUp className="h-4 w-4 text-[var(--text-400)]" /> : <ChevronDown className="h-4 w-4 text-[var(--text-400)]" />}
            </button>

            {showAdminPwd && (
              <form onSubmit={handleAdminChangePwd} className="space-y-4 border-t border-[color:var(--border)] px-5 py-5">
                <div><label htmlFor="admin-current-password" className="mb-1.5 block text-sm font-medium text-[var(--text-600)]">当前密码</label><input id="admin-current-password" type="password" value={adminOldPwd} onChange={(e) => setAdminOldPwd(e.target.value)} placeholder="输入当前密码" autoComplete="current-password" className="field-input" /></div>
                <div><label htmlFor="admin-new-password" className="mb-1.5 block text-sm font-medium text-[var(--text-600)]">新密码</label><input id="admin-new-password" type="password" value={adminNewPwd} onChange={(e) => setAdminNewPwd(e.target.value)} placeholder="至少 6 位" autoComplete="new-password" className="field-input" /></div>
                <button type="submit" disabled={adminPwdLoading} className="btn-cs btn-primary btn-sm w-full disabled:opacity-50">
                  {adminPwdLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                  {adminPwdLoading ? '修改中...' : '确认修改'}
                </button>
              </form>
            )}
          </section>
        </div>
      </div>
    );
  }

  const handleUserEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEditMsg('');
    try {
      const res = await fetch(`${API_BASE}/api/v1/users/me`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${useAuthStore.getState().token}`,
        },
        body: JSON.stringify({ displayName: editName || undefined, email: editEmail || undefined }),
      });
      if (res.ok) {
        setEditMsg('保存成功');
        setUserEdit(false);
        useAuthStore.getState().updateUser({ displayName: editName || user?.displayName, email: editEmail || undefined });
      } else {
        const d = await res.json();
        setEditMsg(d.message || '保存失败');
      }
    } catch {
      setEditMsg('网络错误');
    }
  };

  const handleUserChangePwd = async (e: React.FormEvent) => {
    e.preventDefault();
    setUserPwdMsg(null);
    if (!userOldPwd || !userNewPwd) {
      setUserPwdMsg({ ok: false, text: '请填写所有字段' });
      return;
    }
    if (userNewPwd.length < 6) {
      setUserPwdMsg({ ok: false, text: '新密码长度至少6位' });
      return;
    }
    setUserPwdLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/users/change-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${useAuthStore.getState().token}`,
        },
        body: JSON.stringify({ oldPassword: userOldPwd, newPassword: userNewPwd }),
      });
      const d = await res.json();
      if (res.ok) {
        setUserPwdMsg({ ok: true, text: '密码修改成功' });
        setUserOldPwd('');
        setUserNewPwd('');
        setShowUserPwd(false);
      } else {
        setUserPwdMsg({ ok: false, text: d.message || '修改失败' });
      }
    } catch {
      setUserPwdMsg({ ok: false, text: '网络错误' });
    }
    setUserPwdLoading(false);
  };

  if (!user) {
    return (
      <div className="mx-auto w-full max-w-3xl py-10">
        <section className="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed border-[color:var(--border)] bg-white px-6 text-center">
          <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--brand-50)] text-[var(--brand-600)]">
            <UserCircle className="h-6 w-6" />
          </span>
          <h1 className="text-lg font-semibold text-[var(--text-900)]">登录后管理个人账户</h1>
          <p className="mt-2 max-w-md text-sm leading-6 text-[var(--text-500)]">查看账户资料、资金概览和安全设置，需要先完成登录。</p>
          <button onClick={() => navigate('/login')} className="btn-cs btn-primary btn-sm mt-5">去登录</button>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6">
      <WorkbenchPageHeader
        icon={UserCircle}
        eyebrow="个人中心"
        title="账户与安全"
        description="维护个人资料、查看资金状态并管理登录安全。账户信息将用于任务协作与交易通知。"
        actions={(
          <>
            <button onClick={handleLogoutAll} className="btn-cs btn-sm border border-[color:var(--border)] bg-white text-[var(--text-700)] hover:bg-[var(--background-100)]">
              退出所有设备
            </button>
            <button onClick={handleLogout} className="btn-cs btn-sm border border-[#ffc6c1] bg-[var(--state-error-surface)] text-[var(--state-error)] hover:bg-[#ffe1de]">
              <LogOut className="h-4 w-4" />退出登录
            </button>
          </>
        )}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <section className="overflow-hidden rounded-2xl border border-[color:var(--border)] bg-white">
          <div className="flex flex-col gap-4 border-b border-[color:var(--border)] px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="flex min-w-0 items-center gap-4">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-50)] text-[var(--brand-600)]">
                <UserCircle className="h-7 w-7" />
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-lg font-semibold text-[var(--text-900)]">{user.displayName || user.phone}</h2>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-[var(--text-500)]">个人账户</span>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${user.kycStatus === 'VERIFIED' ? 'bg-[var(--state-success-surface)] text-[var(--state-success-text)]' : user.kycStatus === 'PENDING' ? 'bg-[var(--state-warning-surface)] text-[var(--state-warning)]' : 'bg-[var(--state-error-surface)] text-[var(--state-error)]'}`}>
                    {user.kycStatus === 'VERIFIED' ? '已实名' : user.kycStatus === 'PENDING' ? '认证中' : '未实名'}
                  </span>
                </div>
              </div>
            </div>
            {!userEdit && (
              <button
                type="button"
                onClick={() => { setUserEdit(true); setEditName(user.displayName || ''); setEditEmail(user.email || ''); setEditMsg(''); }}
                className="btn-cs btn-ghost-dark btn-sm"
              >
                <Edit3 className="h-4 w-4" />编辑资料
              </button>
            )}
          </div>

          {editMsg && !userEdit && (
            <div className="mx-5 mt-5 flex items-center gap-2 rounded-xl border border-[#bde9c9] bg-[var(--state-success-surface)] p-3 text-sm text-[var(--state-success-text)] sm:mx-6">
              <CheckCircle className="h-4 w-4 shrink-0" />{editMsg}
            </div>
          )}

          {userEdit ? (
            <form onSubmit={handleUserEdit} className="space-y-4 px-5 py-5 sm:px-6">
              {editMsg && (
                <div className="flex items-center gap-2 rounded-xl border border-[#ffc6c1] bg-[var(--state-error-surface)] p-3 text-sm text-[var(--state-error)]">
                  <XCircle className="h-4 w-4 shrink-0" />{editMsg}
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="profile-display-name" className="mb-1.5 block text-sm font-medium text-[var(--text-600)]">显示名称</label>
                  <input id="profile-display-name" value={editName} onChange={(event) => setEditName(event.target.value)} placeholder="用于任务协作中的展示" autoComplete="name" className="field-input" />
                </div>
                <div>
                  <label htmlFor="profile-email" className="mb-1.5 block text-sm font-medium text-[var(--text-600)]">联系邮箱</label>
                  <input id="profile-email" type="email" value={editEmail} onChange={(event) => setEditEmail(event.target.value)} placeholder="your@email.com" autoComplete="email" className="field-input" />
                </div>
              </div>
              <div className="flex justify-end gap-2 border-t border-[color:var(--border)] pt-4">
                <button type="button" onClick={() => { setUserEdit(false); setEditMsg(''); }} className="btn-cs btn-ghost-dark btn-sm">取消</button>
                <button type="submit" className="btn-cs btn-primary btn-sm">保存资料</button>
              </div>
            </form>
          ) : (
            <>
              <dl className="grid divide-y divide-[color:var(--border)] sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                <div className="flex gap-3 p-5 sm:p-6">
                  <Phone className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-400)]" />
                  <div><dt className="text-xs text-[var(--text-500)]">手机号</dt><dd className="mt-1 text-sm font-medium text-[var(--text-800)]">{user.phone}</dd></div>
                </div>
                <div className="flex gap-3 p-5 sm:p-6">
                  <Mail className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-400)]" />
                  <div><dt className="text-xs text-[var(--text-500)]">联系邮箱</dt><dd className="mt-1 break-all text-sm font-medium text-[var(--text-800)]">{user.email || '尚未设置'}</dd></div>
                </div>
              </dl>

              <div className="flex flex-col gap-3 border-t border-[color:var(--border)] px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <div className="flex gap-3">
                  <Shield className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-400)]" />
                  <div><h3 className="text-sm font-medium text-[var(--text-800)]">实名认证</h3><p className="mt-1 text-xs leading-5 text-[var(--text-500)]">完成认证后可使用完整的交易与资金功能。</p></div>
                </div>
                {user.kycStatus === 'VERIFIED' ? (
                  <span className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--state-success-text)]"><CheckCircle className="h-4 w-4" />已完成</span>
                ) : user.kycStatus === 'PENDING' ? (
                  <span className="text-sm font-medium text-[var(--state-warning)]">审核中</span>
                ) : (
                  <button type="button" onClick={() => { useAuthStore.getState().updateKyc('VERIFIED'); alert('模拟实名认证成功！'); }} className="btn-cs btn-primary btn-sm">去认证</button>
                )}
              </div>
            </>
          )}

          <div className="border-t border-[color:var(--border)] px-5 py-5 sm:px-6">
            <div className="flex items-center gap-2">
              <WalletCards className="h-4 w-4 text-[var(--brand-600)]" />
              <h3 className="text-sm font-semibold text-[var(--text-800)]">资金概览</h3>
            </div>
            {balanceLoading ? (
              <div className="mt-4 grid gap-4 sm:grid-cols-3" aria-label="正在加载资金信息">
                {[0, 1, 2].map((item) => <div key={item} className="h-14 animate-pulse rounded-lg bg-[var(--background-100)]" />)}
              </div>
            ) : balanceError ? (
              <p className="mt-4 text-sm text-[var(--state-error)]">资金信息暂时无法加载，请稍后刷新页面重试。</p>
            ) : balance ? (
              <dl className="mt-4 grid divide-y divide-[color:var(--border)] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                <div className="py-3 sm:px-4 sm:py-1 sm:first:pl-0"><dt className="text-xs text-[var(--text-500)]">可用余额</dt><dd className="mt-1 text-lg font-semibold tabular-nums text-[var(--text-900)]">¥{(balance.availableCny / 100).toFixed(2)}</dd></div>
                <div className="py-3 sm:px-4 sm:py-1"><dt className="text-xs text-[var(--text-500)]">冻结中</dt><dd className="mt-1 text-lg font-semibold tabular-nums text-[var(--state-warning)]">¥{(balance.frozenCny / 100).toFixed(2)}</dd></div>
                <div className="py-3 sm:px-4 sm:py-1"><dt className="text-xs text-[var(--text-500)]">累计收入</dt><dd className="mt-1 text-lg font-semibold tabular-nums text-[var(--brand-700)]">¥{(balance.totalIncomeCny / 100).toFixed(2)}</dd></div>
              </dl>
            ) : (
              <p className="mt-4 text-sm text-[var(--text-500)]">暂无资金记录。</p>
            )}
          </div>
        </section>

        <section className="h-fit overflow-hidden rounded-2xl border border-[color:var(--border)] bg-white">
          <div className="border-b border-[color:var(--border)] px-5 py-5">
            <h2 className="font-semibold text-[var(--text-900)]">安全设置</h2>
            <p className="mt-1 text-sm leading-6 text-[var(--text-500)]">建议定期更新密码，并避免在其他服务中重复使用。</p>
          </div>

          {userPwdMsg && (
            <div className={`mx-5 mt-5 flex items-center gap-2 rounded-xl border p-3 text-sm ${userPwdMsg.ok ? 'border-[#bde9c9] bg-[var(--state-success-surface)] text-[var(--state-success-text)]' : 'border-[#ffc6c1] bg-[var(--state-error-surface)] text-[var(--state-error)]'}`}>
              {userPwdMsg.ok ? <CheckCircle className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}{userPwdMsg.text}
            </div>
          )}

          <button
            type="button"
            onClick={() => { setShowUserPwd(!showUserPwd); setUserPwdMsg(null); }}
            className="flex min-h-14 w-full items-center justify-between px-5 text-left transition-colors hover:bg-[var(--background-100)]"
            aria-expanded={showUserPwd}
          >
            <span className="flex items-center gap-3 text-sm font-medium text-[var(--text-700)]"><Key className="h-4 w-4 text-[var(--brand-600)]" />修改登录密码</span>
            {showUserPwd ? <ChevronUp className="h-4 w-4 text-[var(--text-400)]" /> : <ChevronDown className="h-4 w-4 text-[var(--text-400)]" />}
          </button>

          {showUserPwd && (
            <form onSubmit={handleUserChangePwd} className="space-y-4 border-t border-[color:var(--border)] px-5 py-5">
              <div><label htmlFor="user-current-password" className="mb-1.5 block text-sm font-medium text-[var(--text-600)]">当前密码</label><input id="user-current-password" type="password" value={userOldPwd} onChange={(e) => setUserOldPwd(e.target.value)} placeholder="输入当前密码" autoComplete="current-password" className="field-input" /></div>
              <div><label htmlFor="user-new-password" className="mb-1.5 block text-sm font-medium text-[var(--text-600)]">新密码</label><input id="user-new-password" type="password" value={userNewPwd} onChange={(e) => setUserNewPwd(e.target.value)} placeholder="至少 6 位" autoComplete="new-password" className="field-input" /></div>
              <button type="submit" disabled={userPwdLoading} className="btn-cs btn-primary btn-sm w-full disabled:opacity-50">
                {userPwdLoading && <Loader2 className="h-4 w-4 animate-spin" />}{userPwdLoading ? '修改中...' : '确认修改'}
              </button>
            </form>
          )}

          {/* ==================== 个人访问令牌（PAT）=================== */}
          <div className="border-t border-[color:var(--border)]">
            <div className="flex items-center justify-between gap-3 px-5 py-5">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--text-800)]">
                  <KeyRound className="h-4 w-4 text-[var(--brand-600)]" />个人访问令牌
                </h3>
                <p className="mt-1 text-xs leading-5 text-[var(--text-500)]">供 CLI、Agent 等无人值守场景调用 API，权限与本人账号一致。</p>
              </div>
              {!showPatCreate && !newPatToken && (
                <button type="button" onClick={() => { setShowPatCreate(true); setPatError(''); }} className="btn-cs btn-ghost-dark btn-sm shrink-0">新建令牌</button>
              )}
            </div>

            {patError && (
              <div className="mx-5 mb-4 flex items-center gap-2 rounded-xl border border-[#ffc6c1] bg-[var(--state-error-surface)] p-3 text-sm text-[var(--state-error)]">
                <XCircle className="h-4 w-4 shrink-0" />{patError}
              </div>
            )}

            {newPatToken && (
              <div className="mx-5 mb-4 space-y-3 rounded-xl border border-[#bde9c9] bg-[var(--state-success-surface)] p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-[var(--state-success-text)]">
                  <CheckCircle className="h-4 w-4 shrink-0" />令牌已创建，仅显示一次，请立即复制保存
                </div>
                <div className="flex items-stretch gap-2">
                  <code className="min-w-0 flex-1 break-all rounded-lg bg-white/70 px-3 py-2 font-mono text-xs text-[var(--text-800)]">{newPatToken}</code>
                  <button type="button" onClick={handleCopyToken} className="btn-cs btn-secondary btn-sm shrink-0">
                    {copied ? <CheckCircle className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? '已复制' : '复制'}
                  </button>
                </div>
                <p className="text-xs text-[var(--text-500)]">使用方式：作为请求头 <code className="font-mono">Authorization: Bearer &lt;令牌&gt;</code> 传给平台 API。</p>
                <button type="button" onClick={() => setNewPatToken(null)} className="btn-cs btn-ghost-dark btn-sm w-full">我已保存，关闭</button>
              </div>
            )}

            {showPatCreate && (
              <form onSubmit={handleCreatePat} className="space-y-4 border-t border-[color:var(--border)] px-5 py-5">
                <div>
                  <label htmlFor="pat-name" className="mb-1.5 block text-sm font-medium text-[var(--text-600)]">令牌名称</label>
                  <input id="pat-name" value={patName} onChange={(e) => setPatName(e.target.value)} placeholder="例如：genesis-agent 生产环境" maxLength={64} className="field-input" />
                </div>
                <div>
                  <label htmlFor="pat-expiry" className="mb-1.5 block text-sm font-medium text-[var(--text-600)]">有效期（天，留空表示永久）</label>
                  <input id="pat-expiry" type="number" min={1} value={patExpiryDays} onChange={(e) => setPatExpiryDays(e.target.value.replace(/\D/g, ''))} placeholder="例如：90" className="field-input" />
                </div>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setShowPatCreate(false)} className="btn-cs btn-ghost-dark btn-sm">取消</button>
                  <button type="submit" disabled={patCreating} className="btn-cs btn-primary btn-sm disabled:opacity-50">
                    {patCreating && <Loader2 className="h-4 w-4 animate-spin" />}{patCreating ? '创建中...' : '创建令牌'}
                  </button>
                </div>
              </form>
            )}

            <div className="border-t border-[color:var(--border)]">
              {patLoading ? (
                <div className="px-5 py-4" aria-label="正在加载令牌列表">
                  <div className="h-10 animate-pulse rounded-lg bg-[var(--background-100)]" />
                </div>
              ) : pats.length === 0 ? (
                <p className="px-5 py-4 text-sm text-[var(--text-500)]">暂无访问令牌。</p>
              ) : (
                <ul className="divide-y divide-[color:var(--border)]">
                  {pats.map((pat) => {
                    const expired = pat.expiresAt && new Date(pat.expiresAt).getTime() <= Date.now();
                    const inactive = !!pat.revokedAt || expired;
                    return (
                      <li key={pat.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-medium text-[var(--text-800)]">{pat.name || '未命名令牌'}</span>
                            {pat.revokedAt ? (
                              <span className="rounded-full bg-[var(--state-error-surface)] px-2 py-0.5 text-xs font-medium text-[var(--state-error)]">已撤销</span>
                            ) : expired ? (
                              <span className="rounded-full bg-[var(--background-100)] px-2 py-0.5 text-xs font-medium text-[var(--text-500)]">已过期</span>
                            ) : (
                              <span className="rounded-full bg-[var(--state-success-surface)] px-2 py-0.5 text-xs font-medium text-[var(--state-success-text)]">有效</span>
                            )}
                          </div>
                          <p className="mt-1 text-xs text-[var(--text-400)]">
                            创建于 {new Date(pat.createdAt).toLocaleDateString('zh-CN')}
                            {pat.expiresAt && ` · ${expired ? '已于' : '过期于'} ${new Date(pat.expiresAt).toLocaleDateString('zh-CN')}`}
                            {pat.lastUsedAt && !inactive && ` · 最近使用 ${new Date(pat.lastUsedAt).toLocaleString('zh-CN')}`}
                          </p>
                        </div>
                        {!inactive && (
                          <button
                            type="button"
                            onClick={() => handleRevokePat(pat.id, pat.name)}
                            className="flex shrink-0 items-center gap-1 rounded-lg border border-[#ffc6c1] px-2.5 py-1.5 text-xs font-medium text-[var(--state-error)] transition-colors hover:bg-[var(--state-error-surface)]"
                          >
                            <Trash2 className="h-3.5 w-3.5" />撤销
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
