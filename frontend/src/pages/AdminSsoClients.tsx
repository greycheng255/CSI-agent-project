import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { API_BASE } from '../config/api';
import { WorkbenchPageHeader } from '../components/workbench/WorkbenchPrimitives';
import {
  CheckCircle,
  Copy,
  KeyRound,
  Loader2,
  Plus,
  ShieldCheck,
  XCircle,
} from 'lucide-react';

/** SSO 接入方（不含 secret） */
interface SsoClientItem {
  id: string;
  clientId: string;
  name: string;
  redirectUris: string[];
  confidential: boolean;
  createdAt: string;
}

export default function AdminSsoClients() {
  const { admin, adminToken } = useAuthStore();

  const [clients, setClients] = useState<SsoClientItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // 新建表单
  const [showCreate, setShowCreate] = useState(false);
  const [clientId, setClientId] = useState('');
  const [name, setName] = useState('');
  const [redirectUrisText, setRedirectUrisText] = useState('');
  const [confidential, setConfidential] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const adminHeaders = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${adminToken}`,
  });

  const loadClients = useCallback(() => {
    setLoading(true);
    setError('');
    fetch(`${API_BASE}/api/v1/sso/clients`, { headers: adminHeaders() })
      .then(async (response) => {
        if (!response.ok) {
          const data = await response.json().catch(() => null);
          throw new Error(data?.message || '接入方列表加载失败');
        }
        return response.json();
      })
      .then((data) => setClients(data.clients || []))
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : '接入方列表加载失败'),
      )
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 请求头由 admin 会话派生
  }, [admin, adminToken]);

  useEffect(() => {
    if (admin) loadClients();
  }, [admin, loadClients]);

  if (!admin) {
    return <Navigate to="/login" replace />;
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    const trimmedId = clientId.trim();
    const trimmedName = name.trim();
    const uris = redirectUrisText
      .split(/[\n,]/)
      .map((u) => u.trim())
      .filter(Boolean);
    if (!trimmedId || !trimmedName || uris.length === 0) {
      setError('请填写 client_id、名称，且至少提供一个 redirect_uri');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/sso/clients`, {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify({
          clientId: trimmedId,
          name: trimmedName,
          redirectUris: uris,
          confidential,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || '注册失败');
        return;
      }
      setNewSecret(data.client_secret || null);
      setShowCreate(false);
      setClientId('');
      setName('');
      setRedirectUrisText('');
      setConfidential(false);
      setNotice(`接入方「${trimmedId}」注册成功`);
      loadClients();
    } catch {
      setError('网络错误');
    } finally {
      setCreating(false);
    }
  };

  const handleCopySecret = async () => {
    if (!newSecret) return;
    try {
      await navigator.clipboard.writeText(newSecret);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // 剪贴板不可用时静默降级，可手动选择复制
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6">
      <WorkbenchPageHeader
        icon={ShieldCheck}
        eyebrow="SSO 统一认证"
        title="接入方管理"
        description="管理通过 Marketplace 账号登录的子应用。机密客户端的 client_secret 仅在创建时显示一次。"
        actions={
          !showCreate && !newSecret ? (
            <button
              type="button"
              onClick={() => {
                setShowCreate(true);
                setError('');
                setNotice('');
              }}
              className="btn-cs btn-primary btn-sm"
            >
              <Plus className="h-4 w-4" />注册接入方
            </button>
          ) : undefined
        }
      />

      {(error || notice) && (
        <div
          className={`flex items-center gap-2 rounded-xl border p-3 text-sm ${
            error
              ? 'border-[#ffc6c1] bg-[var(--state-error-surface)] text-[var(--state-error)]'
              : 'border-[#bde9c9] bg-[var(--state-success-surface)] text-[var(--state-success-text)]'
          }`}
        >
          {error ? (
            <XCircle className="h-4 w-4 shrink-0" />
          ) : (
            <CheckCircle className="h-4 w-4 shrink-0" />
          )}
          {error || notice}
        </div>
      )}

      {newSecret && (
        <div className="space-y-3 rounded-2xl border border-[#bde9c9] bg-[var(--state-success-surface)] p-5">
          <div className="flex items-center gap-2 text-sm font-medium text-[var(--state-success-text)]">
            <KeyRound className="h-4 w-4 shrink-0" />
            client_secret 已生成，仅显示一次，请立即复制保存
          </div>
          <div className="flex items-stretch gap-2">
            <code className="min-w-0 flex-1 break-all rounded-lg bg-white/70 px-3 py-2 font-mono text-xs text-[var(--text-800)]">
              {newSecret}
            </code>
            <button
              type="button"
              onClick={handleCopySecret}
              className="btn-cs btn-secondary btn-sm shrink-0"
            >
              {copied ? (
                <CheckCircle className="h-4 w-4" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              {copied ? '已复制' : '复制'}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setNewSecret(null)}
            className="btn-cs btn-ghost-dark btn-sm w-full"
          >
            我已保存，关闭
          </button>
        </div>
      )}

      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="space-y-4 rounded-2xl border border-[color:var(--border)] bg-white p-5 sm:p-6"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="sso-client-id" className="mb-1.5 block text-sm font-medium text-[var(--text-600)]">
                client_id
              </label>
              <input
                id="sso-client-id"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="例如：partner-app"
                maxLength={64}
                className="field-input font-mono"
              />
            </div>
            <div>
              <label htmlFor="sso-client-name" className="mb-1.5 block text-sm font-medium text-[var(--text-600)]">
                应用名称
              </label>
              <input
                id="sso-client-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：合作伙伴门户"
                maxLength={64}
                className="field-input"
              />
            </div>
          </div>
          <div>
            <label htmlFor="sso-redirect-uris" className="mb-1.5 block text-sm font-medium text-[var(--text-600)]">
              回调地址白名单（每行一个，精确匹配；回环地址允许任意端口）
            </label>
            <textarea
              id="sso-redirect-uris"
              value={redirectUrisText}
              onChange={(e) => setRedirectUrisText(e.target.value)}
              rows={3}
              placeholder={'https://app.example.com/auth/callback\nhttp://127.0.0.1/callback'}
              className="field-input font-mono"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--text-700)]">
            <input
              type="checkbox"
              checked={confidential}
              onChange={(e) => setConfidential(e.target.checked)}
              className="h-4 w-4 rounded border-[color:var(--border)] accent-[var(--brand-500)]"
            />
            机密客户端（有服务端，可保管 client_secret）；纯前端应用请留空并使用 PKCE
          </label>
          <div className="flex justify-end gap-2 border-t border-[color:var(--border)] pt-4">
            <button type="button" onClick={() => setShowCreate(false)} className="btn-cs btn-ghost-dark btn-sm">
              取消
            </button>
            <button type="submit" disabled={creating} className="btn-cs btn-primary btn-sm disabled:opacity-50">
              {creating && <Loader2 className="h-4 w-4 animate-spin" />}
              {creating ? '注册中...' : '确认注册'}
            </button>
          </div>
        </form>
      )}

      <section className="overflow-hidden rounded-2xl border border-[color:var(--border)] bg-white">
        <div className="border-b border-[color:var(--border)] px-5 py-4">
          <h2 className="text-sm font-semibold text-[var(--text-800)]">已注册接入方（{clients.length}）</h2>
        </div>
        {loading ? (
          <div className="space-y-3 p-5" aria-label="正在加载接入方列表">
            {[0, 1].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-lg bg-[var(--background-100)]" />
            ))}
          </div>
        ) : clients.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-[var(--text-500)]">
            暂无接入方，点击右上角「注册接入方」创建第一个。
          </p>
        ) : (
          <ul className="divide-y divide-[color:var(--border)]">
            {clients.map((client) => (
              <li key={client.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-[var(--text-900)]">{client.clientId}</span>
                  <span className="text-sm text-[var(--text-600)]">{client.name}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      client.confidential
                        ? 'bg-[var(--brand-50)] text-[var(--brand-700)]'
                        : 'bg-[var(--background-100)] text-[var(--text-500)]'
                    }`}
                  >
                    {client.confidential ? '机密客户端' : '公开客户端（PKCE）'}
                  </span>
                </div>
                <ul className="mt-2 space-y-1">
                  {client.redirectUris.map((uri) => (
                    <li key={uri} className="break-all font-mono text-xs text-[var(--text-500)]">
                      {uri}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-[var(--text-400)]">
                  注册于 {new Date(client.createdAt).toLocaleDateString('zh-CN')}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
