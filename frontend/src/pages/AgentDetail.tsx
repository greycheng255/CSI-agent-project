import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Bot, ExternalLink, Loader2, Save, Key, Copy, Trash2, Wallet, Server, Link2, Cloud, Cpu, Activity, HeartPulse, RefreshCw, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { API_BASE } from '../config/api';

type AgentStatus = 'ONLINE' | 'OFFLINE';

type Agent = {
  id: string;
  name: string;
  description?: string;
  webhookUrl?: string;
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
  healthCheckResult?: {
    agentOnline: boolean;
    openclawReachable: boolean;
    skillsLoaded: boolean;
    errors?: string[];
  } | null;
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
  const [newKeyName, setNewKeyName] = useState('openclaw');
  const [newApiKey, setNewApiKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [skillsText, setSkillsText] = useState('');

  // 健康检查相关状态
  const [healthCheckLoading, setHealthCheckLoading] = useState(false);
  const [healthCheckResult, setHealthCheckResult] = useState<{
    status: AgentStatus;
    openclawStatus: string;
    lastHeartbeatAt: string | null;
    lastHealthCheckAt: string | null;
    checks: {
      podRunning: boolean;
      heartbeatValid: boolean;
      openclawReachable: boolean;
      configurationValid: boolean;
    };
    errors: string[];
  } | null>(null);

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
      fetch(`${apiBase}/api/v1/agent/bids/agent/${id}`).then((r) => r.json()),
      fetch(`${apiBase}/api/v1/owner/agents/${id}/webhook-deliveries`).then((r) => r.json()),
      token
        ? fetch(`${apiBase}/api/v1/owner/agents/${id}/api-keys`, {
            headers: { Authorization: `Bearer ${token}` },
          }).then((r) => r.json())
        : Promise.resolve([]),
    ])
      .then(
        ([agentData, bidsData, deliveryData, keysData]: [
          Agent,
          BidItem[],
          WebhookDeliveryItem[],
          ApiKeyItem[],
        ]) => {
        const a = agentData || null;
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

  const handleCreateApiKey = async () => {
    if (!id || !token) return;
    setCreatingKey(true);
    setNewApiKey(null);
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
      <div className="flex justify-center items-center py-20 text-gray-500">
        <Loader2 className="w-6 h-6 animate-spin mr-3 text-green-500" />
        正在读取 Agent 信息...
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="max-w-3xl mx-auto py-20 text-center text-gray-500">
        Agent 不存在或读取失败。
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Agent 基本信息 + 健康状态 */}
      <div className="border border-gray-800 bg-[#0a0a0a] rounded-xl p-6">
        <div className="flex justify-between items-start gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center border border-purple-500/30">
              <Bot className="w-6 h-6 text-purple-400" />
            </div>
            <div>
              <div className="text-xl font-bold text-gray-200">{agent.name}</div>
              <div className="text-xs font-mono text-gray-500">ID: {agent.id}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`px-2 py-0.5 rounded text-xs border ${
                agent.status === 'ONLINE'
                  ? 'bg-green-500/10 text-green-400 border-green-500/20'
                  : 'bg-gray-800 text-gray-400 border-gray-700'
              }`}
            >
              {agent.status}
            </span>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <div className="text-xs text-gray-400 flex items-center">
            <ExternalLink className="w-3 h-3 mr-1" />
            <span className="truncate">{agent.webhookUrl || '未配置 webhookUrl'}</span>
          </div>
          {agent.description && (
            <div className="text-sm text-gray-500">{agent.description}</div>
          )}
        </div>

        {/* 健康检查面板 */}
        <div className="mt-6 border-t border-gray-800 pt-6">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-2">
              <HeartPulse className="w-5 h-5 text-red-400" />
              <div className="text-lg font-bold text-gray-200">健康检查</div>
            </div>
            <button
              type="button"
              onClick={handleHealthCheck}
              disabled={healthCheckLoading || !token}
              className="px-4 py-2 bg-blue-500 text-black font-bold rounded hover:bg-blue-400 transition-colors disabled:opacity-50 flex items-center gap-2 text-sm"
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
                ? 'bg-green-500/5 border-green-500/20' 
                : 'bg-red-500/5 border-red-500/20'
            }`}>
              <div className="flex items-center gap-2 mb-2">
                {agent.status === 'ONLINE' ? (
                  <CheckCircle2 className="w-4 h-4 text-green-400" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-400" />
                )}
                <span className="text-xs text-gray-400">Agent 状态</span>
              </div>
              <div className={`text-sm font-bold ${
                agent.status === 'ONLINE' ? 'text-green-400' : 'text-red-400'
              }`}>
                {agent.status === 'ONLINE' ? '在线' : '离线'}
              </div>
              {agent.lastHeartbeatAt && (
                <div className="text-xs text-gray-500 mt-1">
                  最后心跳: {new Date(agent.lastHeartbeatAt).toLocaleString()}
                </div>
              )}
            </div>

            {/* Openclaw 连接状态 */}
            <div className={`p-4 rounded-lg border ${
              agent.openclawStatus === 'CONNECTED' 
                ? 'bg-green-500/5 border-green-500/20' 
                : agent.openclawStatus === 'DISCONNECTED'
                ? 'bg-red-500/5 border-red-500/20'
                : 'bg-gray-800/50 border-gray-700'
            }`}>
              <div className="flex items-center gap-2 mb-2">
                {agent.openclawStatus === 'CONNECTED' ? (
                  <CheckCircle2 className="w-4 h-4 text-green-400" />
                ) : agent.openclawStatus === 'DISCONNECTED' ? (
                  <XCircle className="w-4 h-4 text-red-400" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-yellow-400" />
                )}
                <span className="text-xs text-gray-400">Openclaw</span>
              </div>
              <div className={`text-sm font-bold ${
                agent.openclawStatus === 'CONNECTED' ? 'text-green-400' : 
                agent.openclawStatus === 'DISCONNECTED' ? 'text-red-400' : 'text-yellow-400'
              }`}>
                {agent.openclawStatus === 'CONNECTED' ? '已连接' : 
                 agent.openclawStatus === 'DISCONNECTED' ? '未连接' : '未知'}
              </div>
            </div>

            {/* 配置状态 */}
            <div className={`p-4 rounded-lg border ${
              agent.webhookUrl && agent.openclawUrl
                ? 'bg-green-500/5 border-green-500/20' 
                : 'bg-yellow-500/5 border-yellow-500/20'
            }`}>
              <div className="flex items-center gap-2 mb-2">
                {agent.webhookUrl && agent.openclawUrl ? (
                  <CheckCircle2 className="w-4 h-4 text-green-400" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-yellow-400" />
                )}
                <span className="text-xs text-gray-400">配置状态</span>
              </div>
              <div className={`text-sm font-bold ${
                agent.webhookUrl && agent.openclawUrl ? 'text-green-400' : 'text-yellow-400'
              }`}>
                {agent.webhookUrl && agent.openclawUrl ? '已配置' : '配置不完整'}
              </div>
            </div>

            {/* Skills 状态 */}
            <div className={`p-4 rounded-lg border ${
              Array.isArray(agent.skills) && agent.skills.length > 0
                ? 'bg-green-500/5 border-green-500/20' 
                : 'bg-yellow-500/5 border-yellow-500/20'
            }`}>
              <div className="flex items-center gap-2 mb-2">
                {Array.isArray(agent.skills) && agent.skills.length > 0 ? (
                  <CheckCircle2 className="w-4 h-4 text-green-400" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-yellow-400" />
                )}
                <span className="text-xs text-gray-400">Skills</span>
              </div>
              <div className={`text-sm font-bold ${
                Array.isArray(agent.skills) && agent.skills.length > 0 ? 'text-green-400' : 'text-yellow-400'
              }`}>
                {Array.isArray(agent.skills) ? `${agent.skills.length} 个技能` : '未配置'}
              </div>
            </div>
          </div>

          {/* 健康检查详细结果 */}
          {healthCheckResult && (
            <div className="border border-gray-800 rounded-lg p-4 bg-black/40">
              <div className="text-sm font-bold text-gray-200 mb-3">最近检查结果</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-gray-500" />
                  <span className="text-xs text-gray-400">Agent 状态:</span>
                  <span className={`text-xs font-bold ${
                    healthCheckResult.status === 'ONLINE' ? 'text-green-400' : 'text-red-400'
                  }`}>
                    {healthCheckResult.status}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Cloud className="w-4 h-4 text-gray-500" />
                  <span className="text-xs text-gray-400">Openclaw:</span>
                  <span className={`text-xs font-bold ${
                    healthCheckResult.openclawStatus === 'CONNECTED' ? 'text-green-400' : 'text-red-400'
                  }`}>
                    {healthCheckResult.openclawStatus}
                  </span>
                </div>
                {healthCheckResult.lastHealthCheckAt && (
                  <div className="flex items-center gap-2">
                    <RefreshCw className="w-4 h-4 text-gray-500" />
                    <span className="text-xs text-gray-400">检查时间:</span>
                    <span className="text-xs text-gray-300">
                      {new Date(healthCheckResult.lastHealthCheckAt).toLocaleString()}
                    </span>
                  </div>
                )}
              </div>

              {/* 检查项详情 */}
              {healthCheckResult.checks && (
                <div className="mt-3 space-y-2">
                  <div className="text-xs text-gray-500 font-bold">检查项</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {Object.entries(healthCheckResult.checks).map(([key, value]) => (
                      <div key={key} className="flex items-center gap-2 p-2 bg-gray-900/50 rounded">
                        {value ? (
                          <CheckCircle2 className="w-3 h-3 text-green-400" />
                        ) : (
                          <XCircle className="w-3 h-3 text-red-400" />
                        )}
                        <span className="text-xs text-gray-400">
                          {key === 'podRunning' ? 'Pod 运行' :
                           key === 'heartbeatValid' ? '心跳正常' :
                           key === 'openclawReachable' ? 'Openclaw 可达' :
                           key === 'configurationValid' ? '配置有效' : key}
                        </span>
                        <span className={`text-xs font-bold ${value ? 'text-green-400' : 'text-red-400'}`}>
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
                  <div className="text-xs text-red-400 font-bold">检测到的问题</div>
                  {healthCheckResult.errors.map((error, index) => (
                    <div key={index} className="flex items-start gap-2 p-2 bg-red-500/5 border border-red-500/20 rounded">
                      <AlertTriangle className="w-3 h-3 text-red-400 mt-0.5" />
                      <span className="text-xs text-red-300">{error}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 连续失败提示 */}
          {(agent.consecutiveFailures || 0) > 0 && (
            <div className="mt-3 p-3 bg-yellow-500/5 border border-yellow-500/20 rounded-lg">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-yellow-400" />
                <span className="text-xs text-yellow-400">
                  连续心跳失败: {agent.consecutiveFailures} 次
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="border border-gray-800 bg-[#0a0a0a] rounded-xl p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-lg font-bold text-gray-200">Skills</div>
            <div className="text-xs text-gray-500 mt-1">
              用逗号分隔，例如：python,爬虫,数据清洗,react
            </div>
          </div>
          <button
            type="button"
            onClick={handleSaveSkills}
            disabled={saving}
            className="px-4 py-2 bg-purple-500 text-black font-bold rounded hover:bg-purple-400 transition-colors disabled:opacity-50 flex items-center gap-2 text-sm"
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
            className="w-full bg-black border border-gray-700 rounded-lg px-4 py-3 text-gray-200 focus:outline-none focus:border-purple-500"
          />
        </div>

        {Array.isArray(agent.skills) && agent.skills.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-4">
            {agent.skills.map((s) => (
              <span key={s} className="px-2 py-1 bg-gray-800/50 rounded text-xs text-gray-300">
                {s}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Openclaw 实例关联信息 */}
      <div className="border border-gray-800 bg-[#0a0a0a] rounded-xl p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-lg font-bold text-gray-200 flex items-center gap-2">
              <Cloud className="w-5 h-5 text-blue-500" />
              Openclaw 实例关联
            </div>
            <div className="text-xs text-gray-500 mt-1">
              显示当前 Agent 关联的 Openclaw 实例信息和运行状态
            </div>
          </div>
          <span
            className={`px-2 py-0.5 rounded text-xs border ${
              agent.openclawStatus === 'CONNECTED'
                ? 'bg-green-500/10 text-green-400 border-green-500/20'
                : agent.openclawStatus === 'DISCONNECTED'
                ? 'bg-red-500/10 text-red-400 border-red-500/20'
                : 'bg-gray-800 text-gray-400 border-gray-700'
            }`}
          >
            {agent.openclawStatus === 'CONNECTED' ? '已连接' : agent.openclawStatus === 'DISCONNECTED' ? '未连接' : '未知'}
          </span>
        </div>

        <div className="mt-4 space-y-4">
          {/* 运行模式 */}
          <div className="flex items-center gap-3 p-3 bg-gray-900/50 rounded-lg">
            <Cpu className="w-4 h-4 text-gray-500" />
            <div className="flex-1">
              <div className="text-xs text-gray-500">运行模式</div>
              <div className="text-sm text-gray-300">
                {agent.agentMode === 'kubernetes' ? 'Kubernetes 集群模式' : '外部独立模式'}
              </div>
            </div>
          </div>

          {/* Pod 名称 */}
          {agent.podName && (
            <div className="flex items-center gap-3 p-3 bg-gray-900/50 rounded-lg">
              <Server className="w-4 h-4 text-gray-500" />
              <div className="flex-1">
                <div className="text-xs text-gray-500">Pod 名称</div>
                <div className="text-sm font-mono text-gray-300">{agent.podName}</div>
              </div>
            </div>
          )}

          {/* External ID */}
          {agent.externalId && (
            <div className="flex items-center gap-3 p-3 bg-gray-900/50 rounded-lg">
              <Link2 className="w-4 h-4 text-gray-500" />
              <div className="flex-1">
                <div className="text-xs text-gray-500">外部标识 (External ID)</div>
                <div className="text-sm font-mono text-gray-300">{agent.externalId}</div>
              </div>
            </div>
          )}

          {/* Openclaw URL */}
          {agent.openclawUrl ? (
            <div className="flex items-center gap-3 p-3 bg-gray-900/50 rounded-lg">
              <Cloud className="w-4 h-4 text-gray-500" />
              <div className="flex-1">
                <div className="text-xs text-gray-500">Openclaw 地址</div>
                <div className="text-sm font-mono text-gray-300 truncate">{agent.openclawUrl}</div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 p-3 bg-yellow-500/10 rounded-lg border border-yellow-500/20">
              <Cloud className="w-4 h-4 text-yellow-500" />
              <div className="flex-1">
                <div className="text-xs text-yellow-500">未配置 Openclaw</div>
                <div className="text-sm text-gray-400">
                  当前 Agent 未关联 Openclaw 实例，任务分析功能可能受限
                </div>
              </div>
            </div>
          )}

          {/* 关联说明 */}
          <div className="mt-4 p-4 bg-blue-500/10 rounded-lg border border-blue-500/20">
            <div className="text-xs text-blue-400 font-bold mb-2">关联说明</div>
            <div className="text-xs text-gray-400 space-y-1">
              <p>• Genesis Agent 负责扫描任务、技能匹配、转发请求</p>
              <p>• Openclaw 实例负责任务分析、价格计算、代码生成</p>
              <p>• 两者通过 Openclaw Bridge 进行通信</p>
              {agent.agentMode === 'kubernetes' && (
                <p>• 当前为 Kubernetes 模式，Openclaw 实例运行在集群中</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 收款码管理 */}
      <div className="border border-gray-800 bg-[#0a0a0a] rounded-xl p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-lg font-bold text-gray-200 flex items-center gap-2">
              <Wallet className="w-5 h-5 text-green-500" />
              收款信息设置
            </div>
            <div className="text-xs text-gray-500 mt-1">
              设置您的收款码，平台放款时将支付到此账户。
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-2">收款方式</label>
            <select
              value={paymentQrType}
              onChange={(e) => setPaymentQrType(e.target.value)}
              className="w-full bg-black border border-gray-700 rounded-lg px-4 py-3 text-gray-200 focus:outline-none focus:border-green-500"
            >
              <option value="alipay">支付宝</option>
              <option value="wechat">微信支付</option>
              <option value="bank">银行卡</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">收款账号</label>
            <input
              type="text"
              value={paymentAccount}
              onChange={(e) => setPaymentAccount(e.target.value)}
              placeholder={paymentQrType === 'bank' ? '银行卡号 / 开户行 / 户名' : '手机号 / 邮箱 / 账号'}
              className="w-full bg-black border border-gray-700 rounded-lg px-4 py-3 text-gray-200 focus:outline-none focus:border-green-500"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">收款码图片 URL</label>
            <input
              type="text"
              value={paymentQrUrl}
              onChange={(e) => setPaymentQrUrl(e.target.value)}
              placeholder="https://example.com/qr-code.png"
              className="w-full bg-black border border-gray-700 rounded-lg px-4 py-3 text-gray-200 focus:outline-none focus:border-green-500"
            />
            <p className="text-xs text-gray-600 mt-1">上传收款码图片到图床，粘贴链接到这里</p>
          </div>

          {paymentQrUrl && (
            <div className="border border-gray-800 rounded-lg p-4 bg-black/40">
              <p className="text-xs text-gray-500 mb-2">预览</p>
              <img
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
            className="w-full px-4 py-3 bg-green-500 text-black font-bold rounded hover:bg-green-400 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {savingPayment ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            保存收款信息
          </button>
        </div>
      </div>

      <div className="border border-gray-800 bg-[#0a0a0a] rounded-xl p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-lg font-bold text-gray-200 flex items-center gap-2">
              <Key className="w-5 h-5 text-yellow-500" />
              Agent API Keys
            </div>
            <div className="text-xs text-gray-500 mt-1">
              用于 Agent 以 Bearer 方式鉴权提交报价。创建后只展示一次，请及时保存。
            </div>
          </div>
          <button
            type="button"
            onClick={fetchAll}
            className="px-3 py-1.5 border border-gray-700 rounded text-sm text-gray-300 hover:border-gray-500"
          >
            刷新
          </button>
        </div>

        <div className="mt-4 flex flex-col md:flex-row gap-3">
          <input
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="key 名称（例如 openclaw）"
            className="flex-1 bg-black border border-gray-700 rounded-lg px-4 py-3 text-gray-200 focus:outline-none focus:border-yellow-500"
          />
          <button
            type="button"
            onClick={handleCreateApiKey}
            disabled={!token || creatingKey}
            className="px-4 py-3 bg-yellow-500 text-black font-bold rounded hover:bg-yellow-400 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {creatingKey ? <Loader2 className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
            创建 Key
          </button>
        </div>

        {newApiKey && (
          <div className="mt-4 border border-yellow-500/30 rounded-lg p-4 bg-black/40">
            <div className="text-xs text-yellow-400 font-bold mb-2">新 Key（仅展示一次）</div>
            <div className="flex items-center gap-2">
              <div className="flex-1 font-mono text-xs text-gray-200 break-all">{newApiKey}</div>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(newApiKey)}
                className="px-3 py-2 border border-gray-700 rounded text-sm text-gray-300 hover:border-gray-500 flex items-center gap-2"
              >
                <Copy className="w-4 h-4" />
                复制
              </button>
            </div>
          </div>
        )}

        {apiKeys.length === 0 ? (
          <div className="text-center py-10 text-gray-500 border border-gray-800 border-dashed rounded-lg mt-4">
            暂无 API Key。
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            {apiKeys.map((k) => (
              <div key={k.id} className="border border-gray-800 rounded-lg p-4 bg-black/40">
                <div className="flex justify-between items-start gap-4">
                  <div className="min-w-0">
                    <div className="text-sm text-gray-200 font-bold truncate">
                      {k.name || 'Unnamed'}
                    </div>
                    <div className="text-xs text-gray-500 font-mono mt-1">
                      {k.id.slice(0, 12)}...
                    </div>
                    <div className="text-xs text-gray-600 mt-2 flex flex-wrap gap-x-6 gap-y-1">
                      <span>创建：{k.createdAt ? new Date(k.createdAt).toLocaleString() : ''}</span>
                      <span>上次使用：{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : '从未'}</span>
                      <span>状态：{k.revokedAt ? '已吊销' : '有效'}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRevokeApiKey(k.id)}
                    disabled={!!k.revokedAt || revokingKeyId === k.id}
                    className="px-3 py-2 border border-red-500 text-red-400 rounded hover:bg-red-500/10 transition-colors disabled:opacity-50 flex items-center gap-2 text-sm"
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

      <div className="border border-gray-800 bg-[#0a0a0a] rounded-xl p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-lg font-bold text-gray-200">最近报价</div>
            <div className="text-xs text-gray-500 mt-1">显示该 Agent 最近 50 条 Bid。</div>
          </div>
          <button
            type="button"
            onClick={fetchAll}
            className="px-3 py-1.5 border border-gray-700 rounded text-sm text-gray-300 hover:border-gray-500"
          >
            刷新
          </button>
        </div>

        {bids.length === 0 ? (
          <div className="text-center py-10 text-gray-500 border border-gray-800 border-dashed rounded-lg mt-4">
            暂无报价记录。确保 Openclaw 自动报价服务已启动并能访问后端。
          </div>
        ) : (
          <div className="space-y-3 mt-4">
            {bids.map((b) => (
              <div key={b.id} className="border border-gray-800 rounded-lg p-4 bg-black/40">
                <div className="flex justify-between items-start gap-4">
                  <div className="min-w-0">
                    <div className="text-sm text-gray-200 font-bold truncate">
                      {b.task?.title ? b.task.title : `TASK#${b.task?.id?.slice(0, 8)}`}
                    </div>
                    <div className="text-xs text-gray-500 font-mono mt-1">
                      {new Date(b.createdAt).toLocaleString()} · {b.pricingModel || 'unknown'}
                    </div>
                    {b.planSummary && (
                      <div className="text-xs text-gray-400 mt-2 font-mono whitespace-pre-wrap">
                        {b.planSummary}
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold text-green-500">¥{b.priceCny}</div>
                    {b.task?.id && (
                      <button
                        type="button"
                        onClick={() => navigate(`/tasks/${b.task?.id}`)}
                        className="text-xs text-purple-400 hover:text-purple-300 mt-1"
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

      <div className="border border-gray-800 bg-[#0a0a0a] rounded-xl p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-lg font-bold text-gray-200">Webhook 投递日志</div>
            <div className="text-xs text-gray-500 mt-1">显示最近 100 次任务推送投递结果。</div>
          </div>
          <button
            type="button"
            onClick={fetchAll}
            className="px-3 py-1.5 border border-gray-700 rounded text-sm text-gray-300 hover:border-gray-500"
          >
            刷新
          </button>
        </div>

        {deliveries.length === 0 ? (
          <div className="text-center py-10 text-gray-500 border border-gray-800 border-dashed rounded-lg mt-4">
            暂无投递记录。发布任务后平台会向该 Agent 的 webhookUrl 推送。
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            {deliveries.slice(0, 30).map((d) => (
              <div key={d.id} className="border border-gray-800 rounded-lg p-3 bg-black/40">
                <div className="flex justify-between items-start gap-4">
                  <div className="min-w-0">
                    <div className="text-xs font-mono text-gray-500">{d.id.slice(0, 12)}...</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {new Date(d.createdAt).toLocaleString()}
                    </div>
                    {d.lastError && (
                      <div className="text-xs text-red-400 mt-2 whitespace-pre-wrap">
                        {d.lastError}
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <div
                      className={`px-2 py-0.5 rounded text-xs border ${
                        d.status === 'SUCCESS'
                          ? 'bg-green-500/10 text-green-400 border-green-500/20'
                          : d.status === 'FAILED'
                            ? 'bg-red-500/10 text-red-400 border-red-500/20'
                            : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
                      }`}
                    >
                      {d.status}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">attempts: {d.attempts}</div>
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
