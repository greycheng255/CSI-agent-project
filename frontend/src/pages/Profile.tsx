import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { UserCircle, Phone, Shield, LogOut, Key, Clock, Globe, ChevronDown, ChevronUp, Loader2, CheckCircle, XCircle, Edit3 } from 'lucide-react';
import { API_BASE } from '../config/api';

export default function Profile() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = () => {
    if (!window.confirm('确定要退出登录吗？')) return;
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

  const fetchAdminInfo = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/admin/me`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setAdminInfo({ lastLoginAt: data.lastLoginAt, loginIp: data.loginIp });
      }
    } catch { /* ignore */ }
  };

  // 首次渲染时获取管理员详情
  if (admin && !adminInfo.lastLoginAt) {
    fetchAdminInfo();
  }

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
      <div className="min-h-screen bg-[#0a0a0a] text-gray-100 py-8">
        <div className="max-w-2xl mx-auto px-4 space-y-6">
          <h1 className="text-2xl font-bold">管理员中心</h1>

          {/* 基本信息卡片 */}
          <div className="bg-[#111] border border-gray-800 rounded-xl p-6">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 bg-yellow-500/10 rounded-full flex items-center justify-center shrink-0">
                <Shield className="w-10 h-10 text-yellow-400" />
              </div>
              <div>
                <h2 className="text-xl font-semibold">{admin.displayName || admin.username}</h2>
                <p className="text-gray-500 text-sm">{levelLabel(admin.level)}</p>
              </div>
            </div>

            <div className="mt-6 space-y-3">
              <div className="flex items-center gap-3 p-3 bg-black/50 rounded-lg">
                <Shield className="w-5 h-5 text-gray-500 shrink-0" />
                <div className="flex-1">
                  <p className="text-xs text-gray-500">权限级别</p>
                  <p className="text-gray-200 text-sm">{levelLabel(admin.level)}</p>
                </div>
              </div>

              {/* 权限明细 */}
              {admin.permissions && admin.permissions.length > 0 && (
                <div className="flex items-start gap-3 p-3 bg-black/50 rounded-lg">
                  <Shield className="w-5 h-5 text-gray-500 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-xs text-gray-500 mb-2">权限明细</p>
                    <div className="flex flex-wrap gap-1.5">
                      {admin.permissions.map((p) => (
                        <span key={p} className="px-2 py-0.5 bg-yellow-500/10 text-yellow-400 text-xs rounded border border-yellow-500/20">
                          {p === '*' ? '全部权限' : p}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* 最后登录 */}
              {adminInfo.lastLoginAt && (
                <div className="flex items-center gap-3 p-3 bg-black/50 rounded-lg">
                  <Clock className="w-5 h-5 text-gray-500 shrink-0" />
                  <div className="flex-1">
                    <p className="text-xs text-gray-500">最后登录</p>
                    <p className="text-gray-200 text-sm">{new Date(adminInfo.lastLoginAt).toLocaleString('zh-CN')}</p>
                  </div>
                </div>
              )}

              {/* 登录 IP */}
              {adminInfo.loginIp && (
                <div className="flex items-center gap-3 p-3 bg-black/50 rounded-lg">
                  <Globe className="w-5 h-5 text-gray-500 shrink-0" />
                  <div className="flex-1">
                    <p className="text-xs text-gray-500">登录 IP</p>
                    <p className="text-gray-200 text-sm">{adminInfo.loginIp}</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 安全设置 */}
          <div className="bg-[#111] border border-gray-800 rounded-xl p-6">
            <h3 className="text-sm font-bold text-gray-400 mb-4">安全设置</h3>

            <button
              onClick={() => { setShowAdminPwd(!showAdminPwd); setAdminPwdMsg(null); }}
              className="w-full flex items-center justify-between p-3 bg-black/50 rounded-lg hover:bg-black/70 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Key className="w-5 h-5 text-gray-500" />
                <span className="text-sm text-gray-300">修改密码</span>
              </div>
              {showAdminPwd ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
            </button>

            {showAdminPwd && (
              <form onSubmit={handleAdminChangePwd} className="mt-4 space-y-4">
                {adminPwdMsg && (
                  <div className={`p-3 rounded-lg text-sm flex items-center gap-2 ${adminPwdMsg.ok ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                    {adminPwdMsg.ok ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                    {adminPwdMsg.text}
                  </div>
                )}
                <input
                  type="password"
                  value={adminOldPwd}
                  onChange={(e) => setAdminOldPwd(e.target.value)}
                  placeholder="旧密码"
                  autoComplete="current-password"
                  className="w-full bg-black border border-gray-700 rounded-lg px-4 py-2.5 text-gray-200 focus:outline-none focus:border-yellow-500 text-sm"
                />
                <input
                  type="password"
                  value={adminNewPwd}
                  onChange={(e) => setAdminNewPwd(e.target.value)}
                  placeholder="新密码（至少6位）"
                  autoComplete="new-password"
                  className="w-full bg-black border border-gray-700 rounded-lg px-4 py-2.5 text-gray-200 focus:outline-none focus:border-yellow-500 text-sm"
                />
                <button
                  type="submit"
                  disabled={adminPwdLoading}
                  className="w-full py-2.5 bg-yellow-500 text-black font-bold rounded-lg hover:bg-yellow-400 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 text-sm"
                >
                  {adminPwdLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {adminPwdLoading ? '修改中...' : '确认修改'}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    );
  }

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

  useEffect(() => {
    if (!user) return;
    // 加载余额
    fetch(`${API_BASE}/api/v1/balance/my`, {
      headers: { Authorization: `Bearer ${useAuthStore.getState().token}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => d ? setBalance(d.data || d) : null)
      .catch(() => {});
  }, [user]);

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
        useAuthStore.getState().updateUser({ displayName: editName || user.displayName, email: editEmail || undefined });
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
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-400 mb-4">请先登录</p>
          <button
            onClick={() => navigate('/login')}
            className="px-6 py-2 bg-green-500/10 text-green-400 border border-green-500/30 rounded-lg hover:bg-green-500/20 transition-colors"
          >
            去登录
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-gray-100 py-8">
      <div className="max-w-2xl mx-auto px-4 space-y-6">
        <h1 className="text-2xl font-bold">个人中心</h1>

        {/* 基本信息 */}
        <div className="bg-[#111] border border-gray-800 rounded-xl p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center shrink-0">
                <UserCircle className="w-10 h-10 text-green-400" />
              </div>
              <div>
                <h2 className="text-xl font-semibold">{user.displayName || user.phone}</h2>
                <p className="text-gray-500 text-sm">
                  {user.role === 'OWNER' ? '开发者' : '客户'}
                  <span className="mx-2">·</span>
                  {user.kycStatus === 'VERIFIED'
                    ? <span className="text-green-400">已实名</span>
                    : <span className="text-red-400">未实名</span>}
                </p>
              </div>
            </div>
            {!userEdit && (
              <button
                onClick={() => { setUserEdit(true); setEditName(user.displayName || ''); setEditEmail(user.email || ''); setEditMsg(''); }}
                className="px-3 py-1.5 bg-gray-800 text-gray-300 rounded-lg hover:bg-gray-700 text-xs transition-colors flex items-center gap-1"
              >
                <Edit3 className="w-3 h-3" />编辑资料
              </button>
            )}
          </div>

          {userEdit ? (
            <form onSubmit={handleUserEdit} className="space-y-4">
              {editMsg && (
                <div className={`p-3 rounded-lg text-sm ${editMsg === '保存成功' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                  {editMsg}
                </div>
              )}
              <div>
                <label className="text-xs text-gray-500 mb-1 block">显示名</label>
                <input value={editName} onChange={e => setEditName(e.target.value)} placeholder="显示名" autoComplete="off" className="w-full bg-black border border-gray-700 rounded-lg px-3 py-2 text-gray-200 text-sm focus:outline-none focus:border-green-500" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">邮箱</label>
                <input type="email" value={editEmail} onChange={e => setEditEmail(e.target.value)} placeholder="your@email.com" autoComplete="off" className="w-full bg-black border border-gray-700 rounded-lg px-3 py-2 text-gray-200 text-sm focus:outline-none focus:border-green-500" />
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => setUserEdit(false)} className="flex-1 py-2 bg-gray-800 text-gray-400 rounded-lg hover:bg-gray-700 text-sm">取消</button>
                <button type="submit" className="flex-1 py-2 bg-green-500/10 text-green-400 border border-green-500/30 rounded-lg hover:bg-green-500/20 text-sm font-medium">保存</button>
              </div>
            </form>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 bg-black/50 rounded-lg">
                <Phone className="w-5 h-5 text-gray-500 shrink-0" />
                <div>
                  <p className="text-xs text-gray-500">手机号</p>
                  <p className="text-gray-200 text-sm">{user.phone}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-black/50 rounded-lg">
                <Globe className="w-5 h-5 text-gray-500 shrink-0" />
                <div>
                  <p className="text-xs text-gray-500">邮箱</p>
                  <p className="text-gray-200 text-sm">{user.email || '未设置'}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-black/50 rounded-lg">
                <Shield className="w-5 h-5 text-gray-500 shrink-0" />
                <div>
                  <p className="text-xs text-gray-500">实名认证</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {user.kycStatus === 'VERIFIED' ? (
                      <span className="px-2 py-0.5 bg-green-500/10 text-green-400 text-xs rounded border border-green-500/20">已实名</span>
                    ) : (
                      <>
                        <span className="px-2 py-0.5 bg-red-500/10 text-red-400 text-xs rounded border border-red-500/20">未实名</span>
                        <button
                          onClick={() => {
                            useAuthStore.getState().updateKyc('VERIFIED');
                            alert('模拟实名认证成功！');
                          }}
                          className="px-2 py-0.5 bg-green-500/10 text-green-400 text-xs rounded border border-green-500/20 hover:bg-green-500/20 transition-colors"
                        >
                          去认证
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 余额 */}
        {balance && (
          <div className="bg-[#111] border border-gray-800 rounded-xl p-6">
            <h3 className="text-sm font-bold text-gray-400 mb-4">我的余额</h3>
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-black/50 rounded-lg p-4 text-center">
                <p className="text-xs text-gray-500 mb-1">可用余额</p>
                <p className="text-xl font-bold text-green-400">¥{(balance.availableCny / 100).toFixed(2)}</p>
              </div>
              <div className="bg-black/50 rounded-lg p-4 text-center">
                <p className="text-xs text-gray-500 mb-1">冻结中</p>
                <p className="text-xl font-bold text-yellow-400">¥{(balance.frozenCny / 100).toFixed(2)}</p>
              </div>
              <div className="bg-black/50 rounded-lg p-4 text-center">
                <p className="text-xs text-gray-500 mb-1">累计收入</p>
                <p className="text-xl font-bold text-purple-400">¥{(balance.totalIncomeCny / 100).toFixed(2)}</p>
              </div>
            </div>
          </div>
        )}

        {/* 安全设置 */}
        <div className="bg-[#111] border border-gray-800 rounded-xl p-6">
          <h3 className="text-sm font-bold text-gray-400 mb-4">安全设置</h3>

          <button
            onClick={() => { setShowUserPwd(!showUserPwd); setUserPwdMsg(null); }}
            className="w-full flex items-center justify-between p-3 bg-black/50 rounded-lg hover:bg-black/70 transition-colors"
          >
            <div className="flex items-center gap-3">
              <Key className="w-5 h-5 text-gray-500" />
              <span className="text-sm text-gray-300">修改密码</span>
            </div>
            {showUserPwd ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
          </button>

          {showUserPwd && (
            <form onSubmit={handleUserChangePwd} className="mt-4 space-y-4">
              {userPwdMsg && (
                <div className={`p-3 rounded-lg text-sm flex items-center gap-2 ${userPwdMsg.ok ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                  {userPwdMsg.ok ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                  {userPwdMsg.text}
                </div>
              )}
              <input type="password" value={userOldPwd} onChange={e => setUserOldPwd(e.target.value)} placeholder="旧密码" autoComplete="current-password" className="w-full bg-black border border-gray-700 rounded-lg px-4 py-2.5 text-gray-200 focus:outline-none focus:border-green-500 text-sm" />
              <input type="password" value={userNewPwd} onChange={e => setUserNewPwd(e.target.value)} placeholder="新密码（至少6位）" autoComplete="new-password" className="w-full bg-black border border-gray-700 rounded-lg px-4 py-2.5 text-gray-200 focus:outline-none focus:border-green-500 text-sm" />
              <button type="submit" disabled={userPwdLoading} className="w-full py-2.5 bg-green-500/10 text-green-400 border border-green-500/30 rounded-lg hover:bg-green-500/20 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 text-sm font-medium">
                {userPwdLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {userPwdLoading ? '修改中...' : '确认修改'}
              </button>
            </form>
          )}
        </div>

        {/* 退出 */}
        <button
          onClick={handleLogout}
          className="w-full flex items-center justify-center gap-2 p-4 bg-red-500/10 text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/20 transition-colors"
        >
          <LogOut className="w-5 h-5" />
          退出登录
        </button>
      </div>
    </div>
  );
}
