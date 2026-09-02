import { useCallback, useEffect, useState } from 'react';
import { Activity, ExternalLink, KeyRound, RefreshCw, Save, Trash2 } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { API_BASE } from '../config/api';
import { WorkbenchPageHeader } from '../components/workbench/WorkbenchPrimitives';

type LlmConfig = {
  configured: boolean;
  base_url: string | null;
  key_prefix: string | null;
  updated_at: string | null;
  onellm_portal_url: string;
};

type Usage = {
  window_days: number;
  summary: { requests: number; tokens: number; credits: number; cost_cents: number };
  daily: { day: string; requests: number; tokens: number; credits: number; cost_cents: number }[];
  models?: {
    model: string;
    requests: number;
    input_tokens: number;
    output_tokens: number;
    tokens: number;
    credits: number;
    cost_cents: number;
  }[];
};

const fmt = (n: number) => n.toLocaleString('zh-CN');

/** 后端按 Asia/Shanghai 日界聚合，PG 返回 UTC 时刻（如 2026-08-30T16:00:00Z 即本地 08-31），需转时区格式化 */
const formatDay = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
};

/** 用户 AI 网关配置页（BYOK）：平台不卖套餐/不收支付，用户自带网关 key。 */
export default function MyPlan() {
  const { token, user } = useAuthStore();
  const [config, setConfig] = useState<LlmConfig | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');

  const load = useCallback(async () => {
    if (!token) {
      setLoading(false);
      setError('请先登录后配置 AI Token');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [configRes, usageRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/entitlement/portal/my/llm-config`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${API_BASE}/api/v1/entitlement/portal/my/usage?days=90`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      if (configRes.status === 401 || usageRes.status === 401) {
        setError('登录已过期，请退出后重新登录');
      } else if (!configRes.ok) {
        setError(`配置服务请求失败（HTTP ${configRes.status}），请确认后端服务可用`);
      } else {
        setConfig(await configRes.json());
      }
      if (usageRes.ok) setUsage(await usageRes.json());
    } catch {
      setError('加载配置失败，请检查网络与后端服务');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!token) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch(`${API_BASE}/api/v1/entitlement/portal/my/llm-config`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ base_url: baseUrl, api_key: apiKey }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || data.detail || '保存失败');
        return;
      }
      setConfig(data);
      setEditing(false);
      setApiKey('');
      setNotice('AI Token 配置已保存，Agent 调用将使用该网关');
    } catch {
      setError('保存失败，请检查网络与后端服务');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!token || !confirm('确定清除当前 AI Token 配置吗？清除后 Agent 将无法调用模型。')) return;
    setSaving(true);
    setNotice('');
    try {
      const res = await fetch(`${API_BASE}/api/v1/entitlement/portal/my/llm-config`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message || data.detail || '清除失败');
        return;
      }
      setConfig(await res.json());
      setEditing(false);
      setBaseUrl('');
      setApiKey('');
      setNotice('配置已清除');
    } catch {
      setError('清除失败，请检查网络与后端服务');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = () => {
    setEditing(true);
    setBaseUrl(config?.base_url ?? '');
    setApiKey('');
    setNotice('');
    setError('');
  };

  if (!user) {
    return (
      <div className="mx-auto w-full max-w-[1440px]">
        <WorkbenchPageHeader icon={KeyRound} eyebrow="配置 AI Token" title="配置 AI Token" description="配置 AI 网关地址与 API Key。" />
        <div className="space-y-3 rounded-xl border border-[var(--border)] p-8 text-center">
          <div className="text-sm text-[var(--text-600)]">请使用普通用户身份登录后配置</div>
          <button
            onClick={() => (window.location.href = '/login')}
            className="rounded-lg bg-[var(--brand-600)] px-6 py-2 text-sm font-medium text-white hover:bg-[var(--brand-700)]"
          >
            去登录
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6">
      <WorkbenchPageHeader
        icon={KeyRound}
        eyebrow="配置 AI Token"
        title="配置 AI Token"
        description="配置 AI 网关地址与 API Key，Agent 调用模型时使用。支持自有网关或 OneLLM 两种方式。"
      />
      <div className="flex justify-end">
        <button onClick={load} className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-600)] hover:bg-[var(--background-100)]">
          <RefreshCw className="h-3.5 w-3.5" /> 刷新
        </button>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">{error}</div>}
      {notice && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</div>}
      {loading && <div className="rounded-xl border border-[var(--border)] p-8 text-center text-sm text-[var(--text-500)]">加载中…</div>}

      {!loading && (
        <>
          {/* 当前配置 */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--background-0)] p-5">
            {config?.configured ? (
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-full bg-emerald-500 px-3 py-1 text-xs font-medium text-white">已配置</span>
                <span className="text-sm text-[var(--text-800)]">网关地址：<code className="rounded bg-[var(--background-100)] px-1.5 py-0.5">{config.base_url}</code></span>
                <span className="text-sm text-[var(--text-800)]">Key：<code className="rounded bg-[var(--background-100)] px-1.5 py-0.5">{config.key_prefix}…（已加密存储）</code></span>
                {config.updated_at && <span className="text-xs text-[var(--text-400)]">更新于 {new Date(config.updated_at).toLocaleString()}</span>}
                <div className="ml-auto flex items-center gap-3">
                  <button onClick={startEdit} className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--text-600)] hover:bg-[var(--background-100)]">更换配置</button>
                  <button onClick={remove} disabled={saving} className="flex items-center gap-1 rounded-lg border border-red-200 px-4 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50">
                    <Trash2 className="h-3.5 w-3.5" /> 清除
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-1 text-center">
                <div className="text-sm text-[var(--text-600)]">尚未配置 AI Token</div>
                <div className="text-xs text-[var(--text-400)]">配置后 Agent 即可调用模型。选择下方任一方式获取网关地址与 API Key。</div>
              </div>
            )}
          </div>

          {/* 两种接入方式 */}
          <div className="grid gap-4 md:grid-cols-2">
            {/* 方案一：自有网关 */}
            <div className="flex flex-col space-y-3 rounded-xl border border-[var(--border)] p-5">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-[var(--brand-50)] px-2.5 py-0.5 text-xs font-medium text-[var(--brand-700)]">方式一</span>
                <span className="font-medium text-[var(--text-800)]">使用自有网关</span>
              </div>
              <p className="text-xs leading-relaxed text-[var(--text-500)]">
                已有自建或第三方 AI 网关？直接在下方填写网关地址（兼容 OpenAI 接口格式）与 API Key 即可，无需在本平台购买任何套餐。
              </p>
              <button
                onClick={startEdit}
                className="mt-auto w-full rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--text-600)] hover:bg-[var(--background-100)]"
              >
                填写网关地址与 Key
              </button>
            </div>

            {/* 方案二：OneLLM 购买 */}
            <div className="flex flex-col space-y-3 rounded-xl border border-[var(--border)] p-5">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-[var(--brand-50)] px-2.5 py-0.5 text-xs font-medium text-[var(--brand-700)]">方式二</span>
                <span className="font-medium text-[var(--text-800)]">前往 OneLLM 购买 Token</span>
              </div>
              <ol className="list-decimal space-y-1 pl-4 text-xs leading-relaxed text-[var(--text-500)]">
                <li>访问 OneLLM 门户购买 Token 套餐</li>
                <li>在 OneLLM 控制台创建 API Key</li>
                <li>回到本页填写网关地址与 Key 完成配置</li>
              </ol>
              <a
                href={config?.onellm_portal_url ?? 'https://onellm.opennotebook.chat/portal/home'}
                target="_blank"
                rel="noreferrer"
                className="mt-auto flex w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--brand-600)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-700)]"
              >
                打开 OneLLM 门户 <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>

          {/* 配置表单 */}
          {editing && (
            <div className="space-y-4 rounded-xl border border-[var(--border)] p-5">
              <div className="text-sm font-medium text-[var(--text-800)]">{config?.configured ? '更换 AI Token 配置' : '填写 AI Token 配置'}</div>
              <div className="space-y-1">
                <label className="text-xs text-[var(--text-500)]" htmlFor="llm-base-url">网关地址（Base URL）</label>
                <input
                  id="llm-base-url"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="例如 https://onellm.opennotebook.chat 或 https://api.your-gateway.com"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background-0)] px-3 py-2 text-sm outline-none focus:border-[var(--brand-500)]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-[var(--text-500)]" htmlFor="llm-api-key">API Key</label>
                <input
                  id="llm-api-key"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-…"
                  autoComplete="off"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background-0)] px-3 py-2 text-sm outline-none focus:border-[var(--brand-500)]"
                />
                <div className="text-xs text-[var(--text-400)]">Key 使用 AES-256-GCM 加密存储，仅用于 Agent 调用转发，不会明文展示或导出。</div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={save}
                  disabled={saving || !baseUrl.trim() || !apiKey.trim()}
                  className="flex items-center gap-1.5 rounded-lg bg-[var(--brand-600)] px-5 py-2 text-sm font-medium text-white hover:bg-[var(--brand-700)] disabled:opacity-50"
                >
                  <Save className="h-4 w-4" /> {saving ? '保存中…' : '保存配置'}
                </button>
                <button
                  onClick={() => { setEditing(false); setApiKey(''); setError(''); }}
                  className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--text-600)] hover:bg-[var(--background-100)]"
                >
                  取消
                </button>
              </div>
            </div>
          )}
          {/* 调用量（近 90 天，平台计量口径） */}
          <div className="space-y-4 rounded-xl border border-[var(--border)] p-5">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-[var(--brand-600)]" />
              <span className="text-sm font-medium text-[var(--text-800)]">AI Token 调用量</span>
              <span className="text-xs text-[var(--text-400)]">近 90 天 · 平台计量口径</span>
            </div>
            {!usage ? (
              <div className="text-xs text-[var(--text-400)]">用量数据加载失败</div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  {[
                    { label: '调用次数', value: fmt(usage.summary.requests) },
                    { label: 'Token 总量', value: fmt(usage.summary.tokens) },
                    { label: '媒体 Credits', value: fmt(usage.summary.credits) },
                    { label: '估算金额', value: `¥${(usage.summary.cost_cents / 100).toFixed(2)}` },
                  ].map((item) => (
                    <div key={item.label} className="rounded-lg border border-[var(--border)] p-3">
                      <div className="text-xs text-[var(--text-500)]">{item.label}</div>
                      <div className="mt-1 text-lg font-semibold text-[var(--text-800)]">{item.value}</div>
                    </div>
                  ))}
                </div>

                {!!usage.models?.length && (
                  <div>
                    <div className="mb-2 text-xs font-medium text-[var(--text-500)]">按模型</div>
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-[var(--border)] text-[var(--text-500)]">
                          <th className="py-1.5 pr-3 font-medium">模型</th>
                          <th className="py-1.5 pr-3 font-medium">次数</th>
                          <th className="py-1.5 pr-3 font-medium">输入 Token</th>
                          <th className="py-1.5 pr-3 font-medium">输出 Token</th>
                          <th className="py-1.5 pr-3 font-medium">金额</th>
                        </tr>
                      </thead>
                      <tbody>
                        {usage.models.map((m) => (
                          <tr key={m.model} className="border-b border-[var(--border)] last:border-0">
                            <td className="py-1.5 pr-3 font-medium text-[var(--text-800)]">{m.model}</td>
                            <td className="py-1.5 pr-3 text-[var(--text-600)]">{fmt(m.requests)}</td>
                            <td className="py-1.5 pr-3 text-[var(--text-600)]">{fmt(m.input_tokens)}</td>
                            <td className="py-1.5 pr-3 text-[var(--text-600)]">{fmt(m.output_tokens)}</td>
                            <td className="py-1.5 pr-3 text-[var(--text-600)]">¥{(m.cost_cents / 100).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {!!usage.daily?.length && (
                  <div>
                    <div className="mb-2 text-xs font-medium text-[var(--text-500)]">按日明细</div>
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-[var(--border)] text-[var(--text-500)]">
                          <th className="py-1.5 pr-3 font-medium">日期</th>
                          <th className="py-1.5 pr-3 font-medium">次数</th>
                          <th className="py-1.5 pr-3 font-medium">Token</th>
                          <th className="py-1.5 pr-3 font-medium">金额</th>
                        </tr>
                      </thead>
                      <tbody>
                        {usage.daily.map((d) => (
                          <tr key={d.day} className="border-b border-[var(--border)] last:border-0">
                            <td className="py-1.5 pr-3 text-[var(--text-800)]">{formatDay(d.day)}</td>
                            <td className="py-1.5 pr-3 text-[var(--text-600)]">{fmt(d.requests)}</td>
                            <td className="py-1.5 pr-3 text-[var(--text-600)]">{fmt(d.tokens)}</td>
                            <td className="py-1.5 pr-3 text-[var(--text-600)]">¥{(d.cost_cents / 100).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
