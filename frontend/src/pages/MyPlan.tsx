import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  RefreshCw,
  Trash2,
  XCircle,
  Zap,
} from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { API_BASE } from '../config/api';
import { WorkbenchPageHeader } from '../components/workbench/WorkbenchPrimitives';
import { useConfirm } from '../components/ui/confirm-context';

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

/** 服务商预设：选中即预填地址，用户无需手拼 URL；后续新增服务商只改此常量 */
const PROVIDER_PRESETS = [
  {
    id: 'onellm',
    label: 'OneLLM',
    desc: '平台推荐 · 前往门户购买套餐并创建密钥',
    baseUrl: 'https://onellmapi.opennotebook.chat',
    portal: 'https://onellm.opennotebook.chat/portal/home',
  },
  {
    id: 'lingke',
    label: '灵科 OneLLM',
    desc: '已在灵科购买 AI 服务的用户',
    baseUrl: 'https://api.lk888.ai',
    portal: null as string | null,
  },
  {
    id: 'custom',
    label: '其他服务 / 自建网关',
    desc: '手动填写服务商标识的接口地址',
    baseUrl: '',
    portal: null as string | null,
  },
] as const;

type ProbeResult = {
  ok: boolean;
  error_kind: 'auth' | 'quota' | 'not_found' | 'upstream' | 'unreachable' | null;
  model_count: number;
  models: string[];
};

const PROBE_FAIL_TEXT: Record<string, string> = {
  auth: '密钥不正确或已失效，请到服务商控制台核对后重新粘贴。',
  unreachable: '服务地址无法访问，请检查地址是否填写正确。',
  not_found: '该服务不提供在线检测（无模型列表），可直接保存，配置后以实际调用为准。',
  quota: '连接成功，但该密钥余额不足，建议先到服务商处充值，否则智能体调用会失败。',
  upstream: '服务暂时不可用，可稍后重新测试，或跳过测试直接保存。',
};

const fmt = (n: number) => n.toLocaleString('zh-CN');

/** 后端按 Asia/Shanghai 日界聚合，PG 返回 UTC 时刻（如 2026-08-30T16:00:00Z 即本地 08-31），需转时区格式化 */
const formatDay = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
};

/** 按 base_url 匹配预设服务商（已配置用户「更换配置」时预选） */
const matchProvider = (baseUrl: string | null | undefined): string => {
  if (!baseUrl) return 'onellm';
  const hit = PROVIDER_PRESETS.find((p) => p.baseUrl && baseUrl.startsWith(p.baseUrl));
  return hit?.id ?? 'custom';
};

/** 用户 AI 服务配置页（BYOK 三步向导）：选择服务 → 粘贴密钥 → 测试连接并保存。 */
export default function MyPlan() {
  const { token, user } = useAuthStore();
  const confirm = useConfirm();
  const [config, setConfig] = useState<LlmConfig | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  // 向导状态
  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [providerId, setProviderId] = useState<string>('onellm');
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<ProbeResult | null>(null);

  const provider = PROVIDER_PRESETS.find((p) => p.id === providerId) ?? PROVIDER_PRESETS[0];
  const effectiveBaseUrl = provider.baseUrl || customBaseUrl.trim();
  const wizardVisible = wizardOpen || !config?.configured;

  const load = useCallback(async () => {
    if (!token) {
      setLoading(false);
      setError('请先登录后配置 AI 服务');
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

  const openWizard = () => {
    setProviderId(matchProvider(config?.base_url));
    setCustomBaseUrl(config?.base_url ?? '');
    setApiKey('');
    setShowKey(false);
    setProbeResult(null);
    setStep(1);
    setWizardOpen(true);
    setNotice('');
    setError('');
  };

  const runProbe = async () => {
    if (!token || !effectiveBaseUrl || !apiKey.trim()) return;
    setProbing(true);
    setProbeResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/entitlement/portal/my/llm-config/probe`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ base_url: effectiveBaseUrl, api_key: apiKey.trim() }),
      });
      if (!res.ok) {
        setProbeResult({ ok: false, error_kind: 'upstream', model_count: 0, models: [] });
        return;
      }
      setProbeResult(await res.json());
    } catch {
      setProbeResult({ ok: false, error_kind: 'unreachable', model_count: 0, models: [] });
    } finally {
      setProbing(false);
    }
  };

  const goToStep3 = () => {
    setStep(3);
    setProbeResult(null);
    // 进入第 3 步自动开始测试，减少一次点击
    setTimeout(() => void runProbe(), 0);
  };

  const save = async () => {
    if (!token) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch(`${API_BASE}/api/v1/entitlement/portal/my/llm-config`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ base_url: effectiveBaseUrl, api_key: apiKey.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || data.detail || '保存失败');
        return;
      }
      setConfig(data);
      setWizardOpen(false);
      setApiKey('');
      setNotice('AI 服务配置已保存，智能体调用将使用该服务');
    } catch {
      setError('保存失败，请检查网络与后端服务');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!token) return;
    const { confirmed } = await confirm({
      title: '清除 AI 服务配置',
      description: '确定清除当前 AI 服务配置吗？清除后智能体将无法调用模型。',
      tone: 'danger',
      confirmText: '确认清除',
    });
    if (!confirmed) return;
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
      setWizardOpen(false);
      setCustomBaseUrl('');
      setApiKey('');
      setNotice('配置已清除');
    } catch {
      setError('清除失败，请检查网络与后端服务');
    } finally {
      setSaving(false);
    }
  };

  if (!user) {
    return (
      <div className="mx-auto w-full max-w-[1440px]">
        <WorkbenchPageHeader icon={KeyRound} eyebrow="配置 AI 服务" title="配置 AI 服务" description="三步完成：选择服务 → 粘贴密钥 → 测试保存。" />
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

  const step1Valid = providerId !== 'custom' || /^https?:\/\/.+/i.test(customBaseUrl.trim());
  const step2Valid = apiKey.trim().length >= 8;

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6">
      <WorkbenchPageHeader
        icon={KeyRound}
        eyebrow="配置 AI 服务"
        title="配置 AI 服务"
        description="三步完成：选择 AI 服务商 → 粘贴服务密钥 → 测试连接并保存。配置后智能体调用模型时使用。"
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
          {/* 当前配置状态 */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--background-0)] p-5">
            {config?.configured ? (
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-full bg-emerald-500 px-3 py-1 text-xs font-medium text-white">已配置</span>
                <span className="text-sm text-[var(--text-800)]">服务地址：<code className="rounded bg-[var(--background-100)] px-1.5 py-0.5">{config.base_url}</code></span>
                <span className="text-sm text-[var(--text-800)]">密钥：<code className="rounded bg-[var(--background-100)] px-1.5 py-0.5">{config.key_prefix}…（已加密存储）</code></span>
                {config.updated_at && <span className="text-xs text-[var(--text-400)]">更新于 {new Date(config.updated_at).toLocaleString()}</span>}
                <div className="ml-auto flex items-center gap-3">
                  {!wizardOpen && (
                    <button onClick={openWizard} className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--text-600)] hover:bg-[var(--background-100)]">更换配置</button>
                  )}
                  <button onClick={remove} disabled={saving} className="flex items-center gap-1 rounded-lg border border-red-200 px-4 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50">
                    <Trash2 className="h-3.5 w-3.5" /> 清除
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-1 text-center">
                <div className="text-sm text-[var(--text-600)]">尚未配置 AI 服务</div>
                <div className="text-xs text-[var(--text-400)]">按下方向导三步完成配置，配置后智能体即可调用模型。</div>
              </div>
            )}
          </div>

          {/* 三步向导 */}
          {wizardVisible && (
            <div className="rounded-xl border border-[var(--border)] p-5">
              {/* 步骤指示 */}
              <ol className="mb-6 flex items-center gap-2 text-xs">
                {['选择服务', '粘贴密钥', '测试并保存'].map((label, index) => {
                  const value = index + 1;
                  const active = step === value;
                  const done = step > value;
                  return (
                    <li key={label} className="flex items-center gap-2">
                      <span className={`flex h-6 w-6 items-center justify-center rounded-full font-semibold ${done ? 'bg-emerald-500 text-white' : active ? 'bg-[var(--brand-600)] text-white' : 'bg-[var(--background-200)] text-[var(--text-500)]'}`}>
                        {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : value}
                      </span>
                      <span className={active ? 'font-semibold text-[var(--text-800)]' : 'text-[var(--text-500)]'}>{label}</span>
                      {value < 3 && <span className="mx-1 h-px w-6 bg-[var(--border)]" />}
                    </li>
                  );
                })}
              </ol>

              {/* Step 1：选择服务商 */}
              {step === 1 && (
                <div className="space-y-3">
                  <div className="text-sm font-medium text-[var(--text-800)]">你的 AI 服务来自哪里？</div>
                  <div className="grid gap-3 md:grid-cols-3">
                    {PROVIDER_PRESETS.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setProviderId(p.id)}
                        className={`rounded-xl border p-4 text-left transition-colors ${providerId === p.id ? 'border-[var(--brand-500)] bg-[var(--brand-50)]' : 'border-[var(--border)] hover:border-[var(--brand-300)]'}`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-[var(--text-800)]">{p.label}</span>
                          {providerId === p.id && <CheckCircle2 className="h-4 w-4 text-[var(--brand-600)]" />}
                        </div>
                        <div className="mt-1 text-xs leading-5 text-[var(--text-500)]">{p.desc}</div>
                        {p.baseUrl && <div className="mt-2 break-all text-xs text-[var(--text-400)]">{p.baseUrl}</div>}
                      </button>
                    ))}
                  </div>
                  {providerId === 'onellm' && provider.portal && (
                    <a
                      href={provider.portal}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--brand-600)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-700)]"
                    >
                      打开 OneLLM 门户获取密钥 <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                  {providerId === 'custom' && (
                    <div className="space-y-1">
                      <label className="text-xs text-[var(--text-500)]" htmlFor="wizard-base-url">服务地址</label>
                      <input
                        id="wizard-base-url"
                        value={customBaseUrl}
                        onChange={(e) => setCustomBaseUrl(e.target.value)}
                        placeholder="例如 https://api.your-ai-service.com（以服务商标识的接口地址为准）"
                        className="w-full rounded-lg border border-[var(--border)] bg-[var(--background-0)] px-3 py-2 text-sm outline-none focus:border-[var(--brand-500)]"
                      />
                    </div>
                  )}
                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      disabled={!step1Valid}
                      onClick={() => setStep(2)}
                      className="flex items-center gap-1.5 rounded-lg bg-[var(--brand-600)] px-5 py-2 text-sm font-medium text-white hover:bg-[var(--brand-700)] disabled:opacity-50"
                    >
                      下一步 <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* Step 2：粘贴密钥 */}
              {step === 2 && (
                <div className="space-y-4">
                  <div className="text-sm font-medium text-[var(--text-800)]">粘贴服务密钥</div>
                  <div className="rounded-lg bg-[var(--background-100)] px-3 py-2 text-xs text-[var(--text-500)]">
                    服务地址：<span className="break-all text-[var(--text-700)]">{effectiveBaseUrl}</span>
                    {providerId !== 'custom' && '（已自动填入）'}
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-[var(--text-500)]" htmlFor="wizard-api-key">服务密钥（API Key）</label>
                    <div className="relative">
                      <input
                        id="wizard-api-key"
                        type={showKey ? 'text' : 'password'}
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder="sk-…"
                        autoComplete="off"
                        className="w-full rounded-lg border border-[var(--border)] bg-[var(--background-0)] px-3 py-2 pr-10 text-sm outline-none focus:border-[var(--brand-500)]"
                      />
                      <button
                        type="button"
                        onClick={() => setShowKey((v) => !v)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-400)] hover:text-[var(--text-600)]"
                        aria-label={showKey ? '隐藏密钥' : '显示密钥'}
                      >
                        {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <div className="text-xs text-[var(--text-400)]">密钥使用 AES-256-GCM 加密存储，仅用于智能体调用转发，不会明文展示或导出。</div>
                  </div>
                  <div className="flex justify-between pt-2">
                    <button type="button" onClick={() => setStep(1)} className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--text-600)] hover:bg-[var(--background-100)]">
                      <ArrowLeft className="h-4 w-4" /> 上一步
                    </button>
                    <button
                      type="button"
                      disabled={!step2Valid}
                      onClick={goToStep3}
                      className="flex items-center gap-1.5 rounded-lg bg-[var(--brand-600)] px-5 py-2 text-sm font-medium text-white hover:bg-[var(--brand-700)] disabled:opacity-50"
                    >
                      下一步 <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* Step 3：测试连接并保存 */}
              {step === 3 && (
                <div className="space-y-4">
                  <div className="text-sm font-medium text-[var(--text-800)]">测试连接</div>

                  {probing && (
                    <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--background-100)] px-4 py-3 text-sm text-[var(--text-600)]">
                      <Loader2 className="h-4 w-4 animate-spin" /> 正在测试连接，请稍候…
                    </div>
                  )}

                  {probeResult?.ok && (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                      <div className="flex items-center gap-2 font-medium">
                        <CheckCircle2 className="h-4 w-4" /> 连接正常
                        {probeResult.model_count > 0 && `，该密钥可用 ${probeResult.model_count} 个模型`}
                      </div>
                      {!!probeResult.models.length && (
                        <div className="mt-1 break-all text-xs text-emerald-600">
                          {probeResult.models.slice(0, 5).join(' · ')}
                          {probeResult.models.length > 5 ? ' …' : ''}
                        </div>
                      )}
                    </div>
                  )}

                  {probeResult && !probeResult.ok && (
                    <div className={`rounded-lg border px-4 py-3 text-sm ${probeResult.error_kind === 'not_found' || probeResult.error_kind === 'quota' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-red-200 bg-red-50 text-red-600'}`}>
                      <div className="flex items-center gap-2 font-medium">
                        {probeResult.error_kind === 'not_found' || probeResult.error_kind === 'quota' ? <Zap className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                        {PROBE_FAIL_TEXT[probeResult.error_kind ?? 'upstream'] ?? PROBE_FAIL_TEXT.upstream}
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap justify-between gap-2 pt-2">
                    <button type="button" onClick={() => setStep(2)} className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--text-600)] hover:bg-[var(--background-100)]">
                      <ArrowLeft className="h-4 w-4" /> 上一步
                    </button>
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" onClick={runProbe} disabled={probing || saving} className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--text-600)] hover:bg-[var(--background-100)] disabled:opacity-50">
                        <Zap className="h-4 w-4" /> 重新测试
                      </button>
                      {/* 测试通过 / 不支持检测 / 余额不足 → 主按钮直接保存；其余失败 → 次级「跳过测试」 */}
                      {probeResult?.ok || probeResult?.error_kind === 'not_found' || probeResult?.error_kind === 'quota' ? (
                        <button
                          type="button"
                          onClick={save}
                          disabled={saving}
                          className="flex items-center gap-1.5 rounded-lg bg-[var(--brand-600)] px-5 py-2 text-sm font-medium text-white hover:bg-[var(--brand-700)] disabled:opacity-50"
                        >
                          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                          {probeResult.error_kind === 'quota' ? '仍要保存' : '保存并启用'}
                        </button>
                      ) : (
                        probeResult && (
                          <button
                            type="button"
                            onClick={save}
                            disabled={saving}
                            className="rounded-lg border border-[var(--brand-400)] px-5 py-2 text-sm font-medium text-[var(--brand-700)] hover:bg-[var(--brand-50)] disabled:opacity-50"
                          >
                            {saving ? '保存中…' : '跳过测试，直接保存'}
                          </button>
                        )
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 调用量（近 90 天，平台计量口径） */}
          <div className="space-y-4 rounded-xl border border-[var(--border)] p-5">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-[var(--brand-600)]" />
              <span className="text-sm font-medium text-[var(--text-800)]">AI 服务调用量</span>
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
