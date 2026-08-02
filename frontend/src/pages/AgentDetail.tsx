import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Bot, ExternalLink, Loader2, Save, Key, Copy, Trash2, Wallet, Server, Link2, Cpu, Activity, HeartPulse, RefreshCw, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { API_BASE } from '../config/api';
import { CardSection } from '../components/agents/CardSection';
import { disableAgent, enableAgent } from '../api/agentsApi';
import { WorkbenchPageHeader, WorkbenchStatePanel } from '../components/workbench/WorkbenchPrimitives';

type AgentStatus = 'ONLINE' | 'OFFLINE';

type Agent = {
  id: string;
  name: string;
  description?: string;
  webhookUrl?: string | null;
  status?: AgentStatus;
  skills?: string[];
  paymentQrUrl?: string | null;
  paymentQrType?: string | null;
  paymentAccount?: string | null;
  openclawUrl?: string | null;
  openclawStatus?: 'CONNECTED' | 'DISCONNECTED' | 'UNKNOWN';
  podName?: string | null;
  agentMode?: 'kubernetes' | 'external';
  externalId?: string | null;
  lastHeartbeatAt?: string | null;
  lastHealthCheckAt?: string | null;
  consecutiveFailures?: number;
  agentType?: string;
  approvalStatus?: string;
  runtimeStatus?: string;
  isActive?: boolean;
  visibility?: string;
  version?: string;
  cardUrl?: string | null;
  endpointUrl?: string | null;
  healthUrl?: string | null;
  authType?: string | null;
  pricingModel?: string | null;
  basePrice?: number | null;
  currency?: string | null;
  reputationScore?: number | null;
  metadata?: Record<string, unknown> | null;
  capabilities?: Array<{ id: string; capabilityType?: string; name: string; value?: Record<string, unknown> | null }>;
  tags?: Array<{ id: string; tag?: string; name?: string; tagType?: string }>;
  cards?: Array<{
    id: string;
    schemaVersion?: string;
    version?: string;
    cardJson?: Record<string, unknown>;
    contentHash?: string;
    source?: string;
    isActive?: boolean;
    fetchedAt?: string | null;
  }>;
  healthCheckResult?: {
    agentOnline: boolean;
    openclawReachable: boolean;
    skillsLoaded: boolean;
    errors?: string[];
  } | null;
};

type HealthCheckResult = {
  status: AgentStatus;
  lastHeartbeatAt: string | null;
  lastHealthCheckAt: string | null;
  executionMode?: 'platform' | 'external';
  hasActiveApiKey?: boolean;
  activeApiKeyCount?: number;
  lastCredentialUsedAt?: string | null;
  checks: {
    heartbeatValid: boolean;
    platformExecutionReady?: boolean;
    webhookConfigured?: boolean;
    configurationValid: boolean;
  };
  errors: string[];
};

type BidItem = {
  id: string;
  priceCny: number;
  createdAt: string;
  planSummary?: string;
  task?: { id: string; title?: string };
  pricingModel?: string | null;
};

type WebhookDeliveryItem = {
  id: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  attempts: number;
  lastError?: string | null;
  createdAt: string;
};

type ApiKeyItem = {
  id: string;
  name?: string | null;
  createdAt: string;
  revokedAt?: string | null;
  lastUsedAt?: string | null;
};

function getAgentTags(agent: Agent) {
  return (agent.tags || [])
    .map((tag) => tag.tag || tag.name || '')
    .filter(Boolean);
}

function normalizeAgentType(value?: string | null) {
  if (!value) return undefined;
  if (['self-hosted', 'self_hosted', 'external'].includes(value)) return 'self-hosted';
  if (['platform-managed', 'platform_managed', 'platform'].includes(value)) return 'platform-managed';
  return value;
}

function isSystemDefaultAgent(agent: Agent) {
  const tags = getAgentTags(agent);
  const agentType = normalizeAgentType(agent.agentType);
  return (
    agentType === 'platform-managed' &&
    (agent.metadata?.systemCreated === true ||
      agent.metadata?.defaultAgent === true ||
      (tags.includes('system-created') && tags.includes('platform-runtime')))
  );
}

function getPlatformExecutionState(agent: Agent, hasActiveApiKey: boolean) {
  if (agent.approvalStatus !== 'approved') {
    return {
      label: '不可用',
      className: 'text-[var(--state-error)]',
      panelClassName: 'bg-[var(--state-error-surface)] border-[#ffc6c1]',
      description: '请检查审核状态或禁用状态',
    };
  }
  if (agent.isActive === false) {
    return {
      label: '待启动',
      className: 'text-[var(--state-warning)]',
      panelClassName: 'bg-[var(--state-warning-surface)] border-[#f3d79a]',
      description: '点击启动后参与任务处理',
    };
  }
  if (!hasActiveApiKey) {
    return {
      label: '凭证未创建',
      className: 'text-[var(--state-warning)]',
      panelClassName: 'bg-[var(--state-warning-surface)] border-[#f3d79a]',
      description: '进入 Agent API Keys 创建执行凭证',
    };
  }
  return {
    label: '可执行',
    className: 'text-[var(--state-success-text)]',
    panelClassName: 'bg-[var(--state-success-surface)] border-[#bde9c9]',
    description: '平台已准备好执行条件',
  };
}

function getExternalExecutionState(agent: Agent, result?: HealthCheckResult | null) {
  if (!agent.webhookUrl) {
    return {
      label: '缺少 Webhook',
      className: 'text-[var(--state-warning)]',
      panelClassName: 'bg-[var(--state-warning-surface)] border-[#f3d79a]',
      description: '请补充 webhookUrl',
    };
  }
  const webhookHasIssue =
    !!result?.errors?.some((error) => error.includes('Webhook') || error.includes('Health URL')) &&
    result.checks?.webhookConfigured !== false;
  if (webhookHasIssue) {
    return {
      label: 'Webhook 异常',
      className: 'text-[var(--state-error)]',
      panelClassName: 'bg-[var(--state-error-surface)] border-[#ffc6c1]',
      description: '请检查服务地址和网络访问',
    };
  }
  return {
    label: 'Webhook 已配置',
    className: 'text-[var(--state-success-text)]',
    panelClassName: 'bg-[var(--state-success-surface)] border-[#bde9c9]',
    description: agent.webhookUrl,
  };
}

function healthCheckLabel(key: string) {
  if (key === 'heartbeatValid') return '心跳正常';
  if (key === 'platformExecutionReady') return '平台执行状态';
  if (key === 'webhookConfigured') return 'Webhook 配置';
  if (key === 'configurationValid') return '配置有效';
  return key;
}

/* eslint-disable react-hooks/exhaustive-deps -- the detail and health loaders are intentionally keyed to route and auth changes */
export default function AgentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, token, admin } = useAuthStore();
  const apiBase = API_BASE;

  const [agent, setAgent] = useState<Agent | null>(null);
  const [bids, setBids] = useState<BidItem[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDeliveryItem[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>([]);
  const [creatingKey, setCreatingKey] = useState(false);
  const [revokingKeyId, setRevokingKeyId] = useState<string | null>(null);
  const [newKeyName, setNewKeyName] = useState('platform-executor');
  const [newApiKey, setNewApiKey] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'success' | 'failed'>('idle');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [togglingActive, setTogglingActive] = useState(false);
  const [skillsText, setSkillsText] = useState('');

  const [healthCheckLoading, setHealthCheckLoading] = useState(false);
  const [healthCheckResult, setHealthCheckResult] = useState<HealthCheckResult | null>(null);

  // 收款码相关状态
  const [paymentQrUrl, setPaymentQrUrl] = useState('');
  const [paymentQrType, setPaymentQrType] = useState('alipay');
  const [paymentAccount, setPaymentAccount] = useState('');
  const [savingPayment, setSavingPayment] = useState(false);

  const fetchAll = useCallback(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      fetch(`${apiBase}/api/v1/owner/agents/${id}`).then((r) => r.json()),
      fetch(`${apiBase}/api/v1/agents/${id}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`${apiBase}/api/v1/agent/bids/agent/${id}`).then((r) => r.json()),
      fetch(`${apiBase}/api/v1/owner/agents/${id}/webhook-deliveries`).then((r) => r.json()),
      token
        ? fetch(`${apiBase}/api/v1/owner/agents/${id}/api-keys`, {
            headers: { Authorization: `Bearer ${token}` },
          }).then((r) => r.json())
        : Promise.resolve([]),
    ])
      .then(
        ([agentData, wp2AgentData, bidsData, deliveryData, keysData]: [
          Agent,
          Agent | null,
          BidItem[],
          WebhookDeliveryItem[],
          ApiKeyItem[],
        ]) => {
        const a = agentData ? { ...agentData, ...(wp2AgentData || {}) } : wp2AgentData || null;
        setAgent(a);
        setSkillsText(Array.isArray(a?.skills) ? a.skills.join(',') : '');
        setPaymentQrUrl(a?.paymentQrUrl || '');
        setPaymentQrType(a?.paymentQrType || 'alipay');
        setPaymentAccount(a?.paymentAccount || '');
        setBids(Array.isArray(bidsData) ? bidsData : []);
        setDeliveries(Array.isArray(deliveryData) ? deliveryData : []);
        setApiKeys(Array.isArray(keysData) ? keysData : []);
        setLoading(false);
      })
      .catch(() => {
        setAgent(null);
        setBids([]);
        setDeliveries([]);
        setApiKeys([]);
        setLoading(false);
      });
  }, [apiBase, id, token]);

  useEffect(() => {
    if (!user && !admin) {
      navigate('/login');
      return;
    }
    fetchAll();
    fetchHealthStatus();
  }, [fetchAll, navigate, user]);

  const handleSaveSkills = async () => {
    if (!id) return;
    setSaving(true);
    try {
      const skills = skillsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await fetch(`${apiBase}/api/v1/owner/agents/${id}/skills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skills }),
      });
      if (!res.ok) throw new Error('save failed');
      const updated = (await res.json()) as Agent;
      setAgent(updated);
      setSkillsText(Array.isArray(updated.skills) ? updated.skills.join(',') : '');
    } catch {
      alert('保存 skills 失败，请检查后端服务。');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async () => {
    if (!agent?.id) return;
    if (agent.isActive !== false && !window.confirm(`确认下线 ${agent.name} 吗？下线后将不会出现在智能体广场。`)) {
      return;
    }
    setTogglingActive(true);
    try {
      const updated = agent.isActive === false
        ? await enableAgent(agent.id)
        : await disableAgent(agent.id);
      setAgent(prev => prev ? { ...prev, ...updated } : updated);
      fetchHealthStatus();
    } catch (err) {
      alert(err instanceof Error ? err.message : '上下线操作失败');
    } finally {
      setTogglingActive(false);
    }
  };

  const handleCreateApiKey = async () => {
    if (!id || !token) return;
    setCreatingKey(true);
    setNewApiKey(null);
    setCopyStatus('idle');
    try {
      const res = await fetch(`${apiBase}/api/v1/owner/agents/${id}/api-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: newKeyName }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        alert(err?.message || '创建失败');
        return;
      }
      const data = (await res.json()) as { apiKey?: string };
      setNewApiKey(typeof data.apiKey === 'string' ? data.apiKey : null);
      fetchAll();
    } catch {
      alert('创建失败，请检查后端服务。');
    } finally {
      setCreatingKey(false);
    }
  };

  const handleCopyNewApiKey = async () => {
    if (!newApiKey) return;

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(newApiKey);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = newApiKey;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        textarea.style.top = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const copied = document.execCommand('copy');
        document.body.removeChild(textarea);
        if (!copied) {
          throw new Error('copy failed');
        }
      }

      setCopyStatus('success');
      window.setTimeout(() => setCopyStatus('idle'), 2000);
    } catch {
      setCopyStatus('failed');
      window.setTimeout(() => setCopyStatus('idle'), 3000);
    }
  };

  const handleRevokeApiKey = async (keyId: string) => {
    if (!id || !token) return;
    setRevokingKeyId(keyId);
    try {
      const res = await fetch(`${apiBase}/api/v1/owner/agents/${id}/api-keys/${keyId}/revoke`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        alert(err?.message || '吊销失败');
        return;
      }
      fetchAll();
    } catch {
      alert('吊销失败');
    } finally {
      setRevokingKeyId(null);
    }
  };

  const handleSavePayment = async () => {
    if (!id || !token) return;
    setSavingPayment(true);
    try {
      const res = await fetch(`${apiBase}/api/v1/owner/agents/${id}/payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          paymentQrUrl: paymentQrUrl || null,
          paymentQrType: paymentQrType || null,
          paymentAccount: paymentAccount || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        alert(err?.message || '保存失败');
        return;
      }
      const updated = (await res.json()) as Agent;
      setAgent(updated);
      setPaymentQrUrl(updated.paymentQrUrl || '');
      setPaymentQrType(updated.paymentQrType || 'alipay');
      setPaymentAccount(updated.paymentAccount || '');
      alert('收款信息保存成功！');
    } catch {
      alert('保存失败，请检查后端服务。');
    } finally {
      setSavingPayment(false);
    }
  };

  // 执行健康检查
  const handleHealthCheck = async () => {
    if (!id || !token) return;
    setHealthCheckLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/v1/owner/agents/${id}/health-check`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        alert(err?.message || '健康检查失败');
        return;
      }
      const data = await res.json();
      setHealthCheckResult(data);
      // 同时刷新 Agent 信息
      fetchAll();
    } catch {
      alert('健康检查失败，请检查后端服务。');
    } finally {
      setHealthCheckLoading(false);
    }
  };

  // 获取健康状态
  const fetchHealthStatus = async () => {
    if (!id || !token) return;
    try {
      const res = await fetch(`${apiBase}/api/v1/owner/agents/${id}/health`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setHealthCheckResult(data);
      }
    } catch {
      // 静默失败
    }
  };

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-[1440px] space-y-5" aria-label="正在读取 Agent 信息">
        <div className="h-20 animate-pulse rounded-2xl bg-[var(--background-100)]" />
        <div className="h-64 animate-pulse rounded-2xl border border-[color:var(--border)] bg-white" />
        <div className="h-48 animate-pulse rounded-2xl border border-[color:var(--border)] bg-white" />
      </div>
    );
  }

  if (!agent) {
    return (
      <WorkbenchStatePanel
        icon={Bot}
        title="Agent 信息无法读取"
        description="该 Agent 可能已被删除，或当前账号没有查看权限。"
        action={<button type="button" onClick={() => navigate('/owner/agents')} className="btn-cs btn-primary btn-sm">返回我的 Agent</button>}
      />
    );
  }

  const hasActiveApiKey = apiKeys.some((key) => !key.revokedAt);
  const platformAgent = isSystemDefaultAgent(agent);
  const executionState = platformAgent
    ? getPlatformExecutionState(agent, hasActiveApiKey)
    : getExternalExecutionState(agent, healthCheckResult);
  const executionEndpointLabel = platformAgent ? '平台' : '外部自管 Agent';

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6">
      <WorkbenchPageHeader
        icon={Bot}
        eyebrow="我的 Agent"
        title={agent.name}
        description={agent.description || '管理执行状态、能力配置、收款信息和调用凭证。'}
        actions={(
          <button type="button" onClick={() => navigate('/owner/agents')} className="btn-cs btn-ghost-dark btn-sm">
            <ArrowLeft className="h-4 w-4" />返回列表
          </button>
        )}
      />
      {/* Agent 基本信息 + 健康状态 */}
      <div className="border border-[color:var(--border)] bg-white rounded-xl p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[var(--brand-50)] flex items-center justify-center border border-[var(--brand-200)]">
              <Bot className="w-6 h-6 text-[var(--brand-600)]" />
            </div>
            <div>
              <div className="text-xl font-bold text-[var(--text-900)]">{agent.name}</div>
              <div className="text-xs font-mono text-[var(--text-500)]">ID: {agent.id}</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`px-2 py-0.5 rounded text-xs border ${agent.isActive === false ? 'bg-[var(--background-100)] text-[var(--text-600)] border-[color:var(--border)]' : 'bg-[var(--brand-50)] text-[var(--brand-700)] border-[var(--brand-200)]'}`}>
              {agent.isActive === false ? '已下线' : '已启用'}
            </span>
            <span
              className={`px-2 py-0.5 rounded text-xs border ${
                agent.status === 'ONLINE'
                  ? 'bg-[var(--state-success-surface)] text-[var(--state-success-text)] border-[#bde9c9]'
                  : 'bg-[var(--background-100)] text-[var(--text-600)] border-[color:var(--border)]'
              }`}
            >
              {agent.status}
            </span>
            <button
              type="button"
              onClick={handleToggleActive}
              disabled={togglingActive || !token}
              className={`px-3 py-1.5 rounded border text-sm transition-colors disabled:opacity-50 ${
                agent.isActive === false
                  ? 'border-[var(--state-success)] text-[var(--state-success-text)] hover:bg-[var(--state-success-surface)]'
                  : 'border-[color:var(--border)] text-[var(--text-700)] hover:bg-[var(--background-100)]'
              }`}
            >
              {togglingActive ? '处理中' : agent.isActive === false ? '上线 Agent' : '下线 Agent'}
            </button>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {!platformAgent && (
            <div className="text-xs text-[var(--text-600)] flex items-center">
              <ExternalLink className="w-3 h-3 mr-1" />
              <span className="truncate">{agent.webhookUrl || '未配置 webhookUrl'}</span>
            </div>
          )}
          {agent.description && (
            <div className="text-sm text-[var(--text-500)]">{agent.description}</div>
          )}
        </div>

        {/* 健康检查面板 */}
        <div className="mt-6 border-t border-[color:var(--border)] pt-6">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-2">
              <HeartPulse className="w-5 h-5 text-[var(--state-error)]" />
              <div className="text-lg font-bold text-[var(--text-900)]">健康检查</div>
            </div>
            <button
              type="button"
              onClick={handleHealthCheck}
              disabled={healthCheckLoading || !token}
              className="px-4 py-2 bg-[var(--brand-500)] text-white font-bold rounded hover:bg-[var(--brand-600)] transition-colors disabled:opacity-50 flex items-center gap-2 text-sm"
            >
              {healthCheckLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              执行检查
            </button>
          </div>

          {/* 健康检查指标卡片 */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            {/* Agent 在线状态 */}
            <div className={`p-4 rounded-lg border ${
              agent.status === 'ONLINE' 
                ? 'bg-[var(--state-success-surface)] border-[#bde9c9]'
                : 'bg-[var(--state-error-surface)] border-[#ffc6c1]'
            }`}>
              <div className="flex items-center gap-2 mb-2">
                {agent.status === 'ONLINE' ? (
                  <CheckCircle2 className="w-4 h-4 text-[var(--state-success-text)]" />
                ) : (
                  <XCircle className="w-4 h-4 text-[var(--state-error)]" />
                )}
                <span className="text-xs text-[var(--text-600)]">Agent 状态</span>
              </div>
              <div className={`text-sm font-bold ${
                agent.status === 'ONLINE' ? 'text-[var(--state-success-text)]' : 'text-[var(--state-error)]'
              }`}>
                {agent.status === 'ONLINE' ? '在线' : '离线'}
              </div>
              {agent.lastHeartbeatAt && (
                <div className="text-xs text-[var(--text-500)] mt-1">
                  最后心跳: {new Date(agent.lastHeartbeatAt).toLocaleString()}
                </div>
              )}
            </div>

            {/* 执行端 */}
            <div className={`p-4 rounded-lg border ${executionState.panelClassName}`}>
              <div className="flex items-center gap-2 mb-2">
                {executionState.className === 'text-[var(--state-success-text)]' ? (
                  <CheckCircle2 className="w-4 h-4 text-[var(--state-success-text)]" />
                ) : executionState.className === 'text-[var(--state-error)]' ? (
                  <XCircle className="w-4 h-4 text-[var(--state-error)]" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-[var(--state-warning)]" />
                )}
                <span className="text-xs text-[var(--text-600)]">执行端</span>
              </div>
              <div className="text-sm text-[var(--brand-700)] font-bold">
                {executionEndpointLabel}
              </div>
              <div className={`text-xs mt-1 ${executionState.className}`}>
                {executionState.label}
              </div>
            </div>

            {/* 执行配置 */}
            <div className={`p-4 rounded-lg border ${executionState.panelClassName}`}>
              <div className="flex items-center gap-2 mb-2">
                {executionState.className === 'text-[var(--state-success-text)]' ? (
                  <CheckCircle2 className="w-4 h-4 text-[var(--state-success-text)]" />
                ) : executionState.className === 'text-[var(--state-error)]' ? (
                  <XCircle className="w-4 h-4 text-[var(--state-error)]" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-[var(--state-warning)]" />
                )}
                <span className="text-xs text-[var(--text-600)]">
                  {platformAgent ? '执行凭证' : 'Webhook 配置'}
                </span>
              </div>
              <div className={`text-sm font-bold ${executionState.className}`}>
                {executionState.label}
              </div>
              <div className="text-xs text-[var(--text-500)] mt-1 truncate" title={executionState.description}>
                {executionState.description}
              </div>
            </div>

            {/* Skills 状态 */}
            <div className={`p-4 rounded-lg border ${
              Array.isArray(agent.skills) && agent.skills.length > 0
                ? 'bg-[var(--state-success-surface)] border-[#bde9c9]'
                : 'bg-[var(--state-warning-surface)] border-[#f3d79a]'
            }`}>
              <div className="flex items-center gap-2 mb-2">
                {Array.isArray(agent.skills) && agent.skills.length > 0 ? (
                  <CheckCircle2 className="w-4 h-4 text-[var(--state-success-text)]" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-[var(--state-warning)]" />
                )}
                <span className="text-xs text-[var(--text-600)]">Skills</span>
              </div>
              <div className={`text-sm font-bold ${
                Array.isArray(agent.skills) && agent.skills.length > 0 ? 'text-[var(--state-success-text)]' : 'text-[var(--state-warning)]'
              }`}>
                {Array.isArray(agent.skills) ? `${agent.skills.length} 个技能` : '未配置'}
              </div>
            </div>
          </div>

          {/* 健康检查详细结果 */}
          {healthCheckResult && (
            <div className="border border-[color:var(--border)] rounded-lg p-4 bg-[var(--background-100)]">
              <div className="text-sm font-bold text-[var(--text-900)] mb-3">最近检查结果</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-[var(--text-500)]" />
                  <span className="text-xs text-[var(--text-600)]">Agent 状态:</span>
                  <span className={`text-xs font-bold ${
                    healthCheckResult.status === 'ONLINE' ? 'text-[var(--state-success-text)]' : 'text-[var(--state-error)]'
                  }`}>
                    {healthCheckResult.status}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-[var(--text-500)]" />
                  <span className="text-xs text-[var(--text-600)]">执行端:</span>
                  <span className="text-xs font-bold text-[var(--brand-700)]">
                    {healthCheckResult.executionMode === 'platform' ? '平台' : '外部自管 Agent'}
                  </span>
                </div>
                {healthCheckResult.lastHealthCheckAt && (
                  <div className="flex items-center gap-2">
                    <RefreshCw className="w-4 h-4 text-[var(--text-500)]" />
                    <span className="text-xs text-[var(--text-600)]">检查时间:</span>
                    <span className="text-xs text-[var(--text-700)]">
                      {new Date(healthCheckResult.lastHealthCheckAt).toLocaleString()}
                    </span>
                  </div>
                )}
              </div>

              {/* 检查项详情 */}
              {healthCheckResult.checks && (
                <div className="mt-3 space-y-2">
                  <div className="text-xs text-[var(--text-500)] font-bold">检查项</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {Object.entries(healthCheckResult.checks).map(([key, value]) => (
                      <div key={key} className="flex items-center gap-2 rounded-lg bg-[var(--background-100)] p-2">
                        {value ? (
                          <CheckCircle2 className="w-3 h-3 text-[var(--state-success-text)]" />
                        ) : (
                          <XCircle className="w-3 h-3 text-[var(--state-error)]" />
                        )}
                        <span className="text-xs text-[var(--text-600)]">
                          {healthCheckLabel(key)}
                        </span>
                        <span className={`text-xs font-bold ${value ? 'text-[var(--state-success-text)]' : 'text-[var(--state-error)]'}`}>
                          {value ? '通过' : '失败'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 错误信息 */}
              {healthCheckResult.errors && healthCheckResult.errors.length > 0 && (
                <div className="mt-3 space-y-2">
                  <div className="text-xs text-[var(--state-error)] font-bold">检测到的问题</div>
                  {healthCheckResult.errors.map((error, index) => (
                    <div key={index} className="flex items-start gap-2 p-2 bg-[var(--state-error-surface)] border border-[#ffc6c1] rounded">
                      <AlertTriangle className="w-3 h-3 text-[var(--state-error)] mt-0.5" />
                      <span className="text-xs text-[var(--state-error)]">{error}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 连续失败提示 */}
          {(agent.consecutiveFailures || 0) > 0 && (
            <div className="mt-3 p-3 bg-[var(--state-warning-surface)] border border-[#f3d79a] rounded-lg">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-[var(--state-warning)]" />
                <span className="text-xs text-[var(--state-warning)]">
                  连续心跳失败: {agent.consecutiveFailures} 次
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      <CardSection agent={agent} />

      <div className="border border-[color:var(--border)] bg-white rounded-xl p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-lg font-bold text-[var(--text-900)]">Skills</div>
            <div className="text-xs text-[var(--text-500)] mt-1">
              用逗号分隔，例如：python,爬虫,数据清洗,react
            </div>
          </div>
          <button
            type="button"
            onClick={handleSaveSkills}
            disabled={saving}
              className="btn-cs btn-primary btn-sm disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            保存
          </button>
        </div>

        <div className="mt-4">
          <input
            value={skillsText}
            onChange={(e) => setSkillsText(e.target.value)}
            placeholder="python,爬虫,数据清洗"
            className="w-full bg-white border border-[color:var(--border)] rounded-lg px-4 py-3 text-[var(--text-900)] focus:outline-none focus:border-[var(--brand-500)]"
          />
        </div>

        {Array.isArray(agent.skills) && agent.skills.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-4">
            {agent.skills.map((s) => (
              <span key={s} className="px-2 py-1 bg-[var(--background-100)] rounded text-xs text-[var(--text-700)]">
                {s}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 执行接入信息 */}
      <div className="border border-[color:var(--border)] bg-white rounded-xl p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-lg font-bold text-[var(--text-900)] flex items-center gap-2">
              <Cpu className="w-5 h-5 text-blue-500" />
              执行接入信息
            </div>
            <div className="text-xs text-[var(--text-500)] mt-1">
              显示当前 Agent 的任务执行端、接入地址和执行状态。
            </div>
          </div>
          <span
            className={`px-2 py-0.5 rounded text-xs border ${
              executionState.className === 'text-[var(--state-success-text)]'
                ? 'bg-[var(--state-success-surface)] text-[var(--state-success-text)] border-[#bde9c9]'
                : executionState.className === 'text-[var(--state-error)]'
                ? 'bg-[var(--state-error-surface)] text-[var(--state-error)] border-[#ffc6c1]'
                : 'bg-[var(--state-warning-surface)] text-[var(--state-warning)] border-[#f3d79a]'
            }`}
          >
            {executionState.label}
          </span>
        </div>

        <div className="mt-4 space-y-4">
          <div className="flex items-center gap-3 rounded-lg bg-[var(--background-100)] p-3">
            <Cpu className="w-4 h-4 text-[var(--text-500)]" />
            <div className="flex-1">
              <div className="text-xs text-[var(--text-500)]">执行端</div>
              <div className="text-sm text-[var(--text-700)]">{executionEndpointLabel}</div>
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-lg bg-[var(--background-100)] p-3">
            <Activity className="w-4 h-4 text-[var(--text-500)]" />
            <div className="flex-1">
              <div className="text-xs text-[var(--text-500)]">执行状态</div>
              <div className={`text-sm font-bold ${executionState.className}`}>
                {executionState.label}
              </div>
              <div className="text-xs text-[var(--text-500)] mt-1">{executionState.description}</div>
            </div>
          </div>

          {platformAgent ? (
            <>
              <div className="flex items-center gap-3 rounded-lg bg-[var(--background-100)] p-3">
                <Key className="w-4 h-4 text-[var(--text-500)]" />
                <div className="flex-1">
                  <div className="text-xs text-[var(--text-500)]">执行凭证</div>
                  <div className={`text-sm font-bold ${hasActiveApiKey ? 'text-[var(--state-success-text)]' : 'text-[var(--state-warning)]'}`}>
                    {hasActiveApiKey ? '已创建' : '未创建'}
                  </div>
                  <div className="text-xs text-[var(--text-500)] mt-1">
                    {hasActiveApiKey
                      ? `有效 Key 数量：${apiKeys.filter((key) => !key.revokedAt).length}`
                      : '请在 Agent API Keys 区域创建 Key。'}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 rounded-lg bg-[var(--background-100)] p-3">
                <RefreshCw className="w-4 h-4 text-[var(--text-500)]" />
                <div className="flex-1">
                  <div className="text-xs text-[var(--text-500)]">最近调用</div>
                  <div className="text-sm text-[var(--text-700)]">
                    {healthCheckResult?.lastCredentialUsedAt
                      ? new Date(healthCheckResult.lastCredentialUsedAt).toLocaleString()
                      : apiKeys.find((key) => key.lastUsedAt)?.lastUsedAt
                      ? new Date(apiKeys.find((key) => key.lastUsedAt)!.lastUsedAt!).toLocaleString()
                      : '从未调用'}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-3 rounded-lg bg-[var(--background-100)] p-3">
                <ExternalLink className="w-4 h-4 text-[var(--text-500)]" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-[var(--text-500)]">接收任务地址</div>
                  <div className={`text-sm font-mono truncate ${agent.webhookUrl ? 'text-[var(--text-700)]' : 'text-[var(--state-warning)]'}`}>
                    {agent.webhookUrl || '未配置 webhookUrl'}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 rounded-lg bg-[var(--background-100)] p-3">
                <ExternalLink className="w-4 h-4 text-[var(--text-500)]" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-[var(--text-500)]">任务接口地址</div>
                  <div className={`text-sm font-mono truncate ${agent.endpointUrl ? 'text-[var(--text-700)]' : 'text-[var(--state-warning)]'}`}>
                    {agent.endpointUrl || '未配置 endpointUrl'}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 rounded-lg bg-[var(--background-100)] p-3">
                <HeartPulse className="w-4 h-4 text-[var(--text-500)]" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-[var(--text-500)]">健康检查地址</div>
                  <div className={`text-sm font-mono truncate ${agent.healthUrl ? 'text-[var(--text-700)]' : 'text-[var(--state-warning)]'}`}>
                    {agent.healthUrl || '未配置 healthUrl'}
                  </div>
                </div>
              </div>
            </>
          )}

          {agent.podName && (
            <div className="flex items-center gap-3 rounded-lg bg-[var(--background-100)] p-3">
              <Server className="w-4 h-4 text-[var(--text-500)]" />
              <div className="flex-1">
                <div className="text-xs text-[var(--text-500)]">Pod 名称</div>
                <div className="text-sm font-mono text-[var(--text-700)]">{agent.podName}</div>
              </div>
            </div>
          )}

          {agent.externalId && (
            <div className="flex items-center gap-3 rounded-lg bg-[var(--background-100)] p-3">
              <Link2 className="w-4 h-4 text-[var(--text-500)]" />
              <div className="flex-1">
                <div className="text-xs text-[var(--text-500)]">外部标识 (External ID)</div>
                <div className="text-sm font-mono text-[var(--text-700)]">{agent.externalId}</div>
              </div>
            </div>
          )}

          <div className="mt-4 rounded-lg border border-[var(--brand-200)] bg-[var(--brand-50)] p-4">
            <div className="mb-2 text-xs font-bold text-[var(--brand-700)]">接入说明</div>
            <div className="text-xs text-[var(--text-600)] space-y-1">
              {platformAgent ? (
                <p>平台负责该 Agent 的任务处理；请确保执行凭证已创建并保持 Agent 启用。</p>
              ) : (
                <p>平台会把匹配到的任务推送到 Webhook 地址；请确保你的 Agent 服务可以接收并处理平台推送。</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 收款码管理 */}
      <div className="border border-[color:var(--border)] bg-white rounded-xl p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-lg font-bold text-[var(--text-900)] flex items-center gap-2">
              <Wallet className="w-5 h-5 text-[var(--state-success)]" />
              收款信息设置
            </div>
            <div className="text-xs text-[var(--text-500)] mt-1">
              设置您的收款码，平台放款时将支付到此账户。
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-sm text-[var(--text-600)] mb-2">收款方式</label>
            <select
              value={paymentQrType}
              onChange={(e) => setPaymentQrType(e.target.value)}
              className="w-full bg-white border border-[color:var(--border)] rounded-lg px-4 py-3 text-[var(--text-900)] focus:outline-none focus:border-green-500"
            >
              <option value="alipay">支付宝</option>
              <option value="wechat">微信支付</option>
              <option value="bank">银行卡</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-[var(--text-600)] mb-2">收款账号</label>
            <input
              type="text"
              value={paymentAccount}
              onChange={(e) => setPaymentAccount(e.target.value)}
              placeholder={paymentQrType === 'bank' ? '银行卡号 / 开户行 / 户名' : '手机号 / 邮箱 / 账号'}
              className="w-full bg-white border border-[color:var(--border)] rounded-lg px-4 py-3 text-[var(--text-900)] focus:outline-none focus:border-green-500"
            />
          </div>

          <div>
            <label className="block text-sm text-[var(--text-600)] mb-2">收款码图片 URL</label>
            <input
              type="text"
              value={paymentQrUrl}
              onChange={(e) => setPaymentQrUrl(e.target.value)}
              placeholder="https://example.com/qr-code.png"
              className="w-full bg-white border border-[color:var(--border)] rounded-lg px-4 py-3 text-[var(--text-900)] focus:outline-none focus:border-green-500"
            />
            <p className="text-xs text-[var(--text-500)] mt-1">上传收款码图片到图床，粘贴链接到这里</p>
          </div>

          {paymentQrUrl && (
            <div className="border border-[color:var(--border)] rounded-lg p-4 bg-[var(--background-100)]">
              <p className="text-xs text-[var(--text-500)] mb-2">预览</p>
                <img
                  loading="lazy"
                src={paymentQrUrl}
                alt="收款码"
                className="max-w-xs max-h-48 object-contain rounded"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            </div>
          )}

          <button
            type="button"
            onClick={handleSavePayment}
            disabled={savingPayment || !token}
            className="w-full px-4 py-3 bg-[var(--state-success)] text-white font-bold rounded hover:bg-[var(--state-success-dark)] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {savingPayment ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            保存收款信息
          </button>
        </div>
      </div>

      <div className="border border-[color:var(--border)] bg-white rounded-xl p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-lg font-bold text-[var(--text-900)] flex items-center gap-2">
              <Key className="w-5 h-5 text-[var(--state-warning)]" />
              Agent API Keys
            </div>
            <div className="text-xs text-[var(--text-500)] mt-1">
              用于 Agent 以 Bearer 方式鉴权提交报价。创建后只展示一次，请及时保存。
            </div>
          </div>
          <button
            type="button"
            onClick={fetchAll}
            className="px-3 py-1.5 border border-[color:var(--border)] rounded text-sm text-[var(--text-700)] hover:border-[var(--brand-300)]"
          >
            刷新
          </button>
        </div>

        <div className="mt-4 flex flex-col md:flex-row gap-3">
          <input
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="key 名称（例如 platform-executor）"
            className="flex-1 bg-white border border-[color:var(--border)] rounded-lg px-4 py-3 text-[var(--text-900)] focus:outline-none focus:border-[var(--state-warning)]"
          />
          <button
            type="button"
            onClick={handleCreateApiKey}
            disabled={!token || creatingKey}
            className="px-4 py-3 bg-yellow-500 text-white font-bold rounded hover:bg-yellow-400 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {creatingKey ? <Loader2 className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
            创建 Key
          </button>
        </div>

        {newApiKey && (
          <div className="mt-4 border border-[#f3d79a] rounded-lg p-4 bg-[var(--background-100)]">
            <div className="text-xs text-[var(--state-warning)] font-bold mb-2">新 Key（仅展示一次）</div>
            <div className="flex items-center gap-2">
              <div className="flex-1 font-mono text-xs text-[var(--text-900)] break-all">{newApiKey}</div>
              <button
                type="button"
                onClick={handleCopyNewApiKey}
                className="px-3 py-2 border border-[color:var(--border)] rounded text-sm text-[var(--text-700)] hover:border-[var(--brand-300)] flex items-center gap-2"
              >
                <Copy className="w-4 h-4" />
                {copyStatus === 'success' ? '已复制' : '复制'}
              </button>
            </div>
            {copyStatus === 'failed' && (
              <div className="mt-2 text-xs text-[var(--state-error)]">
                复制失败，请手动选中 Key 后复制。
              </div>
            )}
          </div>
        )}

        {apiKeys.length === 0 ? (
          <div className="text-center py-10 text-[var(--text-500)] border border-[color:var(--border)] border-dashed rounded-lg mt-4">
            暂无 API Key。
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            {apiKeys.map((k) => (
              <div key={k.id} className="border border-[color:var(--border)] rounded-lg p-4 bg-[var(--background-100)]">
                <div className="flex justify-between items-start gap-4">
                  <div className="min-w-0">
                    <div className="text-sm text-[var(--text-900)] font-bold truncate">
                      {k.name || 'Unnamed'}
                    </div>
                    <div className="text-xs text-[var(--text-500)] font-mono mt-1">
                      {k.id.slice(0, 12)}...
                    </div>
                    <div className="text-xs text-[var(--text-500)] mt-2 flex flex-wrap gap-x-6 gap-y-1">
                      <span>创建：{k.createdAt ? new Date(k.createdAt).toLocaleString() : ''}</span>
                      <span>上次使用：{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : '从未'}</span>
                      <span>状态：{k.revokedAt ? '已吊销' : '有效'}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRevokeApiKey(k.id)}
                    disabled={!!k.revokedAt || revokingKeyId === k.id}
                    className="px-3 py-2 border border-red-500 text-[var(--state-error)] rounded hover:bg-[var(--state-error-surface)] transition-colors disabled:opacity-50 flex items-center gap-2 text-sm"
                  >
                    {revokingKeyId === k.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    吊销
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border border-[color:var(--border)] bg-white rounded-xl p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-lg font-bold text-[var(--text-900)]">最近报价</div>
            <div className="text-xs text-[var(--text-500)] mt-1">显示该 Agent 最近 50 条 Bid。</div>
          </div>
          <button
            type="button"
            onClick={fetchAll}
            className="px-3 py-1.5 border border-[color:var(--border)] rounded text-sm text-[var(--text-700)] hover:border-[var(--brand-300)]"
          >
            刷新
          </button>
        </div>

        {bids.length === 0 ? (
          <div className="text-center py-10 text-[var(--text-500)] border border-[color:var(--border)] border-dashed rounded-lg mt-4">
            暂无报价记录。请确认执行端已配置，并且可以正常访问平台。
          </div>
        ) : (
          <div className="space-y-3 mt-4">
            {bids.map((b) => (
              <div key={b.id} className="border border-[color:var(--border)] rounded-lg p-4 bg-[var(--background-100)]">
                <div className="flex justify-between items-start gap-4">
                  <div className="min-w-0">
                    <div className="text-sm text-[var(--text-900)] font-bold truncate">
                      {b.task?.title ? b.task.title : `TASK#${b.task?.id?.slice(0, 8)}`}
                    </div>
                    <div className="text-xs text-[var(--text-500)] font-mono mt-1">
                      {new Date(b.createdAt).toLocaleString()} · {b.pricingModel || 'unknown'}
                    </div>
                    {b.planSummary && (
                      <div className="text-xs text-[var(--text-600)] mt-2 font-mono whitespace-pre-wrap">
                        {b.planSummary}
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold text-[var(--state-success)]">¥{b.priceCny}</div>
                    {b.task?.id && (
                      <button
                        type="button"
                        onClick={() => navigate(`/tasks/${b.task?.id}`)}
                  className="mt-1 text-xs text-[var(--brand-600)] hover:text-[var(--brand-700)]"
                      >
                        查看任务
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border border-[color:var(--border)] bg-white rounded-xl p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-lg font-bold text-[var(--text-900)]">Webhook 投递日志</div>
            <div className="text-xs text-[var(--text-500)] mt-1">显示最近 100 次任务推送投递结果。</div>
          </div>
          <button
            type="button"
            onClick={fetchAll}
            className="px-3 py-1.5 border border-[color:var(--border)] rounded text-sm text-[var(--text-700)] hover:border-[var(--brand-300)]"
          >
            刷新
          </button>
        </div>

        {deliveries.length === 0 ? (
          <div className="text-center py-10 text-[var(--text-500)] border border-[color:var(--border)] border-dashed rounded-lg mt-4">
            暂无投递记录。发布任务后平台会向该 Agent 的 webhookUrl 推送。
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            {deliveries.slice(0, 30).map((d) => (
              <div key={d.id} className="border border-[color:var(--border)] rounded-lg p-3 bg-[var(--background-100)]">
                <div className="flex justify-between items-start gap-4">
                  <div className="min-w-0">
                    <div className="text-xs font-mono text-[var(--text-500)]">{d.id.slice(0, 12)}...</div>
                    <div className="text-xs text-[var(--text-500)] mt-1">
                      {new Date(d.createdAt).toLocaleString()}
                    </div>
                    {d.lastError && (
                      <div className="text-xs text-[var(--state-error)] mt-2 whitespace-pre-wrap">
                        {d.lastError}
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <div
                      className={`px-2 py-0.5 rounded text-xs border ${
                        d.status === 'SUCCESS'
                          ? 'bg-[var(--state-success-surface)] text-[var(--state-success-text)] border-[#bde9c9]'
                          : d.status === 'FAILED'
                            ? 'bg-[var(--state-error-surface)] text-[var(--state-error)] border-[#ffc6c1]'
                            : 'bg-[var(--state-warning-surface)] text-[var(--state-warning)] border-[#f3d79a]'
                      }`}
                    >
                      {d.status}
                    </div>
                    <div className="text-xs text-[var(--text-500)] mt-1">attempts: {d.attempts}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
