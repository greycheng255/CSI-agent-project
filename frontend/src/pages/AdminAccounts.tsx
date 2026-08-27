import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { Shield, Users, Plus, X, Loader2, Edit3, RefreshCw, FileText, Clock, Search, Terminal } from 'lucide-react';
import { API_BASE } from '../config/api';
import AdminMCPConsolePanel from '../components/admin/AdminMCPConsolePanel';
import { WorkbenchPageHeader, WorkbenchStatePanel } from '../components/workbench/WorkbenchPrimitives';

interface AdminItem {
  id: string;
  username: string;
  displayName?: string;
  phone?: string;
  email?: string;
  level: 'SUPER' | 'ADMIN' | 'OPERATOR';
  status: 'ACTIVE' | 'DISABLED' | 'PENDING';
  permissions: string[];
  createdAt: string;
  lastLoginAt?: string;
  loginIp?: string;
}

interface PermGroup {
  group: string;
  permissions: { key: string; label: string }[];
}


/* eslint-disable react-hooks/exhaustive-deps -- the initial administrator fetch is intentionally keyed only by the auth guard */
export default function AdminAccounts() {
  const { admin, adminToken } = useAuthStore();

  const [admins, setAdmins] = useState<AdminItem[]>([]);
  const [permGroups, setPermGroups] = useState<PermGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'accounts' | 'logs' | 'mcp'>('accounts');
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // 新建表单
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newLevel, setNewLevel] = useState<'ADMIN' | 'OPERATOR'>('ADMIN');
  const [newPerms, setNewPerms] = useState<string[]>([]);
  const [createLoading, setCreateLoading] = useState(false);
  const [createMsg, setCreateMsg] = useState('');
  const [createOk, setCreateOk] = useState(false);

  // 编辑表单
  const [editLevel, setEditLevel] = useState('');
  const [editPerms, setEditPerms] = useState<string[]>([]);
  const [editStatus, setEditStatus] = useState('');
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editLoading, setEditLoading] = useState(false);
  const [editMsg, setEditMsg] = useState('');
  const [editOk, setEditOk] = useState(false);

  const headers = { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' };

  const fetchAdmins = async () => {
    setLoading(true);
    try {
      const [listRes, permRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/admin/list`, { headers }),
        fetch(`${API_BASE}/api/v1/admin/permissions`, { headers }),
      ]);
      if (listRes.ok) {
        const d = await listRes.json();
        setAdmins(d.data || []);
      }
      if (permRes.ok) {
        const d = await permRes.json();
        setPermGroups(d.groups || []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => void fetchAdmins(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  // ========== 操作日志 ==========
  interface AuditLogItem {
    id: string; actor_type: string; actor_id: string | null;
    action: string; entity_type: string; entity_id: string;
    payload: unknown; created_at: string;
  }
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logPage, setLogPage] = useState(1);
  const [logTotal, setLogTotal] = useState(0);
  const [logFilter, setLogFilter] = useState({ action: '', actorType: '', entityType: '' });

  const fetchLogs = async (page = 1) => {
    setLogsLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: '30' });
    if (logFilter.action) params.set('action', logFilter.action);
    if (logFilter.actorType) params.set('actorType', logFilter.actorType);
    if (logFilter.entityType) params.set('entityType', logFilter.entityType);
    try {
      const res = await fetch(`${API_BASE}/api/v1/admin/audit-logs?${params}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (res.ok) {
        const d = await res.json();
        setLogs(d.data || []);
        setLogTotal(d.pagination?.total || 0);
        setLogPage(d.pagination?.page || 1);
      }
    } catch { /* ignore */ }
    setLogsLoading(false);
  };

  const switchTab = (tab: 'accounts' | 'logs' | 'mcp') => {
    setActiveTab(tab);
    if (tab === 'logs') void fetchLogs();
  };

  const actorLabel = (t: string) => {
    const m: Record<string, string> = { CLIENT: '雇主', OWNER: '开发者', AGENT: 'Agent', SYSTEM: '系统', ADMIN: '管理员' };
    return m[t] || t;
  };
  const actorColor = (t: string) => {
    const m: Record<string, string> = {
      ADMIN: 'text-[var(--state-warning)]', CLIENT: 'text-[var(--state-success-text)]', OWNER: 'text-purple-400',
      AGENT: 'text-[var(--brand-600)]', SYSTEM: 'text-[var(--text-500)]',
    };
    return m[t] || 'text-[var(--text-600)]';
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateMsg('');
    if (!newUsername || !newPassword) {
      setCreateMsg('请填写用户名和密码');
      setCreateOk(false);
      return;
    }
    setCreateLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/admin/create`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          username: newUsername,
          password: newPassword,
          displayName: newDisplayName || undefined,
          level: newLevel,
          permissions: newPerms,
        }),
      });
      const d = await res.json();
      if (res.ok) {
        setCreateMsg('创建成功');
        setCreateOk(true);
        setShowCreate(false);
        setNewUsername('');
        setNewPassword('');
        setNewDisplayName('');
        setNewPerms([]);
        fetchAdmins();
      } else {
        setCreateMsg(d.message || '创建失败');
        setCreateOk(false);
      }
    } catch {
      setCreateMsg('网络错误');
      setCreateOk(false);
    }
    setCreateLoading(false);
  };

  const startEdit = (a: AdminItem) => {
    setEditingId(a.id);
    setEditLevel(a.level);
    setEditPerms(a.permissions || []);
    setEditStatus(a.status);
    setEditDisplayName(a.displayName || '');
    setEditMsg('');
  };

  const handleEdit = async (id: string) => {
    setEditLoading(true);
    setEditMsg('');
    try {
      const res = await fetch(`${API_BASE}/api/v1/admin/${id}/update`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          level: editLevel,
          permissions: editPerms,
          status: editStatus,
          displayName: editDisplayName,
        }),
      });
      const d = await res.json();
      if (res.ok) {
        setEditMsg('更新成功');
        setEditOk(true);
        setEditingId(null);
        fetchAdmins();
      } else {
        setEditMsg(d.message || '更新失败');
        setEditOk(false);
      }
    } catch {
      setEditMsg('网络错误');
      setEditOk(false);
    }
    setEditLoading(false);
  };

  const togglePerm = (key: string, current: string[], setter: (v: string[]) => void) => {
    setter(current.includes(key) ? current.filter((p) => p !== key) : [...current, key]);
  };

  const levelLabel = (l: string) => l === 'SUPER' ? '超级管理员' : l === 'OPERATOR' ? '运营' : '管理员';
  const levelColor = (l: string) => l === 'SUPER' ? 'text-[var(--state-warning)] bg-[var(--state-warning-surface)] border-[#f3d79a]' : l === 'OPERATOR' ? 'text-[var(--brand-700)] bg-[var(--brand-50)] border-[var(--brand-200)]' : 'text-[#514fc4] bg-[#f1f0ff] border-[#d9d7ff]';
  const statusColor = (s: string) => s === 'ACTIVE' ? 'text-[var(--state-success-text)] bg-[var(--state-success-surface)]' : 'text-[var(--state-error)] bg-[var(--state-error-surface)]';

  if (!admin) return <Navigate to="/login" replace />;
  if (admin.level !== 'SUPER') {
    return <WorkbenchStatePanel icon={Shield} title="无权访问管理员账号" description="该页面仅对超级管理员开放。" tone="error" />;
  }

  if (loading) {
    return (
      <div className="flex min-h-64 items-center justify-center rounded-2xl border border-[color:var(--border)] bg-white text-sm text-[var(--text-500)]">
        <Loader2 className="mr-3 h-5 w-5 animate-spin text-[var(--brand-500)]" />正在读取管理员数据...
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6">
      <WorkbenchPageHeader
        icon={Users}
        eyebrow="管理员账号"
        title="账号、权限与审计"
        description="管理后台访问账号、角色权限、操作日志与 MCP 集成配置。"
        actions={activeTab === 'accounts' ? <button type="button" onClick={() => setShowCreate(!showCreate)} className={showCreate ? 'btn-cs btn-ghost-dark btn-sm' : 'btn-cs btn-primary btn-sm'}>{showCreate ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}{showCreate ? '取消新建' : '新建管理员'}</button> : undefined}
      />
      {/* Tab 导航 */}
      <div className="flex w-full gap-1 overflow-x-auto rounded-xl bg-[var(--background-100)] p-1 sm:w-fit">
        <button
          onClick={() => switchTab('accounts')}
          className={`flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors ${
            activeTab === 'accounts'
              ? 'bg-white text-[var(--brand-700)] shadow-sm'
              : 'text-[var(--text-500)] hover:text-[var(--text-800)]'
          }`}
        >
          <Users className="w-4 h-4" />管理员列表
        </button>
        <button
          onClick={() => switchTab('logs')}
          className={`flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors ${
            activeTab === 'logs'
              ? 'bg-white text-[var(--brand-700)] shadow-sm'
              : 'text-[var(--text-500)] hover:text-[var(--text-800)]'
          }`}
        >
          <FileText className="w-4 h-4" />操作日志
        </button>
        <button
          onClick={() => switchTab('mcp')}
          className={`flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors ${
            activeTab === 'mcp'
              ? 'bg-white text-[var(--brand-700)] shadow-sm'
              : 'text-[var(--text-500)] hover:text-[var(--text-800)]'
          }`}
        >
          <Terminal className="w-4 h-4" />MCP 集成中心
        </button>
      </div>

      {activeTab === 'accounts' && (
      <>
      {/* 新建表单 */}
      {showCreate && (
        <section className="rounded-2xl border border-[color:var(--border)] bg-white p-6">
          <h2 className="mb-4 text-lg font-semibold text-[var(--text-900)]">新建管理员</h2>
          <form onSubmit={handleCreate} className="space-y-4">
            {createMsg && (
              <div className={`p-3 rounded-lg text-sm ${createOk ? 'bg-[var(--state-success-surface)] text-[var(--state-success-text)] border border-[#bde9c9]' : 'bg-[var(--state-error-surface)] text-[var(--state-error)] border border-[#ffc6c1]'}`}>
                {createMsg}
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div><label htmlFor="new-admin-username" className="mb-1.5 block text-sm font-medium text-[var(--text-600)]">用户名 <span className="text-[var(--state-error)]">*</span></label><input id="new-admin-username" value={newUsername} onChange={e => setNewUsername(e.target.value)} placeholder="输入管理员用户名" className="field-input" required /></div>
              <div><label htmlFor="new-admin-password" className="mb-1.5 block text-sm font-medium text-[var(--text-600)]">初始密码 <span className="text-[var(--state-error)]">*</span></label><input id="new-admin-password" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="输入初始密码" autoComplete="new-password" className="field-input" required /></div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><label htmlFor="new-admin-display-name" className="mb-1.5 block text-sm font-medium text-[var(--text-600)]">显示名称</label><input id="new-admin-display-name" value={newDisplayName} onChange={e => setNewDisplayName(e.target.value)} placeholder="选填" className="field-input" /></div>
              <div><label htmlFor="new-admin-level" className="mb-1.5 block text-sm font-medium text-[var(--text-600)]">管理员级别</label><select id="new-admin-level" value={newLevel} onChange={e => setNewLevel(e.target.value as 'ADMIN' | 'OPERATOR')} className="field-input">
                <option value="ADMIN">管理员 (ADMIN)</option>
                <option value="OPERATOR">运营 (OPERATOR)</option>
              </select></div>
            </div>
            {/* 权限选择 */}
            <div>
              <p className="text-xs text-[var(--text-500)] mb-2">权限分配</p>
              <div className="grid grid-cols-3 gap-3">
                {permGroups.map((g) => (
                  <div key={g.group} className="rounded-xl bg-[var(--background-100)] p-3">
                    <p className="text-xs text-[var(--text-500)] mb-2">{g.group}</p>
                    {g.permissions.map((p) => (
                      <label key={p.key} className="flex items-center gap-2 py-0.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={newPerms.includes(p.key)}
                          onChange={() => togglePerm(p.key, newPerms, setNewPerms)}
                          className="w-3.5 h-3.5 rounded accent-[var(--brand-500)]"
                        />
                        <span className="text-xs text-[var(--text-600)]">{p.label}</span>
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            </div>
            <button type="submit" disabled={createLoading} className="btn-cs btn-primary btn-sm w-full disabled:opacity-50">
              {createLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {createLoading ? '创建中...' : '创建管理员'}
            </button>
          </form>
        </section>
      )}

      {/* 管理员列表 */}
      <section className="overflow-hidden rounded-2xl border border-[color:var(--border)] bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[color:var(--border)] bg-[var(--background-100)] text-[var(--text-500)]">
                <th className="text-left py-3 px-4">用户名</th>
                <th className="text-left py-3 px-4">级别</th>
                <th className="text-left py-3 px-4">状态</th>
                <th className="text-left py-3 px-4">权限</th>
                <th className="text-left py-3 px-4">最后登录</th>
                <th className="text-right py-3 px-4">操作</th>
              </tr>
            </thead>
            <tbody>
              {admins.map((a) => (
                <tr key={a.id} className="border-b border-[color:var(--border)] hover:bg-[var(--background-100)]">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <Shield className="w-4 h-4 text-[var(--state-warning)]" />
                      <div>
                        <p className="text-[var(--text-800)]">{a.displayName || a.username}</p>
                        <p className="text-xs text-[var(--text-500)]">{a.username}</p>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-0.5 rounded text-xs border ${levelColor(a.level)}`}>
                      {levelLabel(a.level)}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-0.5 rounded text-xs ${statusColor(a.status)}`}>
                      {a.status === 'ACTIVE' ? '正常' : a.status === 'DISABLED' ? '已禁用' : '待审核'}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex flex-wrap gap-1 max-w-[200px]">
                      {a.permissions?.slice(0, 3).map((p) => (
                        <span key={p} className="px-1.5 py-0.5 bg-[var(--state-warning-surface)] text-[var(--state-warning)] text-[10px] rounded border border-[#f3d79a]">
                          {p === '*' ? '全部' : p.split(':')[1] || p}
                        </span>
                      ))}
                      {a.permissions?.length > 3 && (
                        <span className="text-xs text-[var(--text-500)]">+{a.permissions.length - 3}</span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-xs text-[var(--text-500)]">
                    {a.lastLoginAt ? new Date(a.lastLoginAt).toLocaleString('zh-CN') : '-'}
                  </td>
                  <td className="py-3 px-4 text-right">
                    {a.level !== 'SUPER' && (
                      <button
                        onClick={() => startEdit(a)}
                        className="flex min-h-8 items-center gap-1 rounded-lg bg-[var(--background-100)] px-3 text-xs font-medium text-[var(--text-600)] hover:text-[var(--brand-600)]"
                      >
                        <Edit3 className="w-3 h-3" />
                        编辑
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 编辑面板 */}
        {editingId && (
          <div className="border-t border-[color:var(--border)] p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-sm">编辑管理员</h3>
              <button type="button" onClick={() => setEditingId(null)} aria-label="关闭管理员编辑" className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-500)] hover:bg-[var(--background-100)] hover:text-[var(--text-800)]">
                <X className="w-4 h-4" />
              </button>
            </div>
            {editMsg && (
              <div className={`mb-4 p-3 rounded-lg text-sm ${editOk ? 'bg-[var(--state-success-surface)] text-[var(--state-success-text)] border border-[#bde9c9]' : 'bg-[var(--state-error-surface)] text-[var(--state-error)] border border-[#ffc6c1]'}`}>
                {editMsg}
              </div>
            )}
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <div><label htmlFor="edit-admin-display-name" className="mb-1.5 block text-sm font-medium text-[var(--text-600)]">显示名称</label><input id="edit-admin-display-name" value={editDisplayName} onChange={e => setEditDisplayName(e.target.value)} placeholder="显示名" className="field-input" /></div>
                <div><label htmlFor="edit-admin-level" className="mb-1.5 block text-sm font-medium text-[var(--text-600)]">管理员级别</label><select id="edit-admin-level" value={editLevel} onChange={e => setEditLevel(e.target.value)} className="field-input">
                  <option value="ADMIN">管理员 (ADMIN)</option>
                  <option value="OPERATOR">运营 (OPERATOR)</option>
                </select></div>
                <div><label htmlFor="edit-admin-status" className="mb-1.5 block text-sm font-medium text-[var(--text-600)]">账号状态</label><select id="edit-admin-status" value={editStatus} onChange={e => setEditStatus(e.target.value)} className="field-input">
                  <option value="ACTIVE">正常</option>
                  <option value="DISABLED">禁用</option>
                </select></div>
              </div>
              {/* 权限编辑 */}
              <div className="grid grid-cols-3 gap-3">
                {permGroups.map((g) => (
                  <div key={g.group} className="rounded-xl bg-[var(--background-100)] p-3">
                    <p className="text-xs text-[var(--text-500)] mb-2">{g.group}</p>
                    {g.permissions.map((p) => (
                      <label key={p.key} className="flex items-center gap-2 py-0.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editPerms.includes(p.key)}
                          onChange={() => togglePerm(p.key, editPerms, setEditPerms)}
                          className="w-3.5 h-3.5 rounded accent-[var(--brand-500)]"
                        />
                        <span className="text-xs text-[var(--text-600)]">{p.label}</span>
                      </label>
                    ))}
                  </div>
                ))}
              </div>
              <div className="flex gap-3">
                <button onClick={() => setEditingId(null)} className="btn-cs btn-ghost-dark btn-sm flex-1">取消</button>
                <button onClick={() => handleEdit(editingId)} disabled={editLoading} className="btn-cs btn-primary btn-sm flex-1 disabled:opacity-50">
                  {editLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  {editLoading ? '保存中...' : '保存修改'}
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
      </>
      )}

      {/* ======== 操作日志 Tab ======== */}
      {activeTab === 'logs' && (
        <div className="space-y-4">
          {/* 过滤器 */}
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[color:var(--border)] bg-white p-4">
            <Search className="w-4 h-4 text-[var(--text-500)]" />
            <input
              aria-label="按操作类型筛选"
              type="text"
              value={logFilter.action}
              onChange={e => setLogFilter({ ...logFilter, action: e.target.value })}
              placeholder="操作类型"
              className="field-input w-36"
            />
            <select
              aria-label="按角色筛选"
              value={logFilter.actorType}
              onChange={e => setLogFilter({ ...logFilter, actorType: e.target.value })}
              className="field-input w-auto"
            >
              <option value="">全部角色</option>
              <option value="CLIENT">雇主</option>
              <option value="OWNER">开发者</option>
              <option value="AGENT">Agent</option>
              <option value="ADMIN">管理员</option>
              <option value="SYSTEM">系统</option>
            </select>
            <select
              aria-label="按实体类型筛选"
              value={logFilter.entityType}
              onChange={e => setLogFilter({ ...logFilter, entityType: e.target.value })}
              className="field-input w-auto"
            >
              <option value="">全部实体</option>
              <option value="order">订单</option>
              <option value="task">任务</option>
              <option value="agent">Agent</option>
              <option value="user">用户</option>
              <option value="admin">管理员</option>
            </select>
            <button
              onClick={() => fetchLogs(1)}
              className="btn-cs btn-primary btn-sm"
            >
              查询
            </button>
            <span className="text-xs text-[var(--text-500)] ml-auto">共 {logTotal} 条记录</span>
          </div>

          {/* 日志表格 */}
          <div className="overflow-hidden rounded-2xl border border-[color:var(--border)] bg-white">
            {logsLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-[var(--text-500)]" />
              </div>
            ) : logs.length === 0 ? (
              <div className="text-center py-12 text-[var(--text-500)] text-sm">暂无操作日志</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[color:var(--border)] bg-[var(--background-100)] text-[var(--text-500)]">
                      <th className="text-left py-3 px-4">时间</th>
                      <th className="text-left py-3 px-4">操作者</th>
                      <th className="text-left py-3 px-4">操作</th>
                      <th className="text-left py-3 px-4">对象</th>
                      <th className="text-left py-3 px-4">详情</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => (
                      <tr key={log.id} className="border-b border-[color:var(--border)] hover:bg-[var(--background-100)]">
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-[var(--text-600)]">
                          <div className="flex items-center gap-1.5">
                            <Clock className="w-3 h-3" />
                            {new Date(log.created_at).toLocaleString('zh-CN')}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <span className={`text-xs ${actorColor(log.actor_type)}`}>
                            {actorLabel(log.actor_type)}
                          </span>
                          {log.actor_id && (
                            <span className="text-[10px] text-[var(--text-500)] ml-1">({log.actor_id.slice(0, 8)}...)</span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <span className="text-xs text-[var(--text-700)]">{log.action}</span>
                        </td>
                        <td className="py-3 px-4">
                          <span className="text-xs text-[var(--text-500)]">{log.entity_type}</span>
                          <span className="text-[10px] text-[var(--text-700)] ml-1">#{log.entity_id?.slice(0, 8)}</span>
                        </td>
                        <td className="py-3 px-4 text-xs text-[var(--text-500)] max-w-[200px] truncate">
                          {log.payload ? JSON.stringify(log.payload).slice(0, 60) + (JSON.stringify(log.payload).length > 60 ? '...' : '') : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 分页 */}
          {logTotal > 30 && (
            <div className="flex justify-center gap-2">
              <button
                onClick={() => fetchLogs(logPage - 1)}
                disabled={logPage <= 1}
                className="min-h-9 rounded-full border border-[color:var(--border)] px-3 text-sm text-[var(--text-600)] disabled:opacity-30"
              >
                上一页
              </button>
              <span className="px-3 py-1.5 text-sm text-[var(--text-500)]">第 {logPage} / {Math.ceil(logTotal / 30)} 页</span>
              <button
                onClick={() => fetchLogs(logPage + 1)}
                disabled={logPage >= Math.ceil(logTotal / 30)}
                className="min-h-9 rounded-full border border-[color:var(--border)] px-3 text-sm text-[var(--text-600)] disabled:opacity-30"
              >
                下一页
              </button>
            </div>
          )}
        </div>
      )}

      {activeTab === 'mcp' && <AdminMCPConsolePanel />}
    </div>
  );
}

