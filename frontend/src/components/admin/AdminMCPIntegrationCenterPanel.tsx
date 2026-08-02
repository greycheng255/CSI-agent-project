import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Copy,
  Database,
  FileJson,
  Globe2,
  Loader2,
  Play,
  Power,
  RefreshCw,
  Save,
  Server,
  ShieldCheck,
  Terminal,
  Wrench,
  XCircle,
} from 'lucide-react';
import {
  discoverMCPIntegrationTools,
  fetchMCPIntegrationApps,
  fetchMCPIntegrationCapabilities,
  fetchMCPIntegrationInvocations,
  fetchMCPIntegrationInvocation,
  fetchMCPIntegrationPlatformTools,
  fetchMCPIntegrationTools,
  fetchMCPTaskBindings,
  issueMCPIntegrationInboundToken,
  pollMCPTaskBinding,
  setMCPIntegrationAppEnabled,
  submitMCPIntegrationExternalTask,
  syncMCPIntegrationCapabilities,
  testMCPIntegrationExternalCall,
  testMCPIntegrationPlatformCall,
  updateMCPIntegrationApp,
  updateMCPIntegrationPlatformTool,
  updateMCPIntegrationTool,
  type MCPAppAuthMode,
  type MCPAppDirection,
  type MCPAppTransport,
  type MCPIntegrationApp,
  type MCPIntegrationCapability,
  type MCPIntegrationInvocation,
  type MCPIntegrationTool,
  type MCPTaskBinding,
} from '../../api/mcpIntegrationsApi';

type DetailTab =
  | 'overview'
  | 'external'
  | 'platform'
  | 'test'
  | 'capabilities'
  | 'bindings'
  | 'invocations';

type AppForm = {
  name: string;
  description: string;
  direction: MCPAppDirection;
  transport: MCPAppTransport;
  endpointUrl: string;
  authMode: MCPAppAuthMode;
  defaultWorkspaceId: string;
  defaultTenantId: string;
};

function stringifyJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function statusClass(status?: string | boolean | null) {
  if (status === true || status === 'healthy' || status === 'success') {
    return 'border-green-500/20 bg-green-500/10 text-green-400';
  }
  if (status === false || status === 'failed') {
    return 'border-red-500/20 bg-red-500/10 text-red-400';
  }
  if (status === 'warning') {
    return 'border-yellow-500/20 bg-yellow-500/10 text-yellow-400';
  }
  return 'border-gray-700 bg-gray-500/10 text-gray-400';
}

function sampleExternalArgs(tool?: MCPIntegrationTool) {
  if (!tool) return {};
  if (tool.name === 'opennotebook_agent_catalog') return {};
  if (tool.name === 'opennotebook_agent_status') {
    return { task_id: 'replace-with-external-task-id' };
  }
  if (tool.name === 'opennotebook_agent_generate') {
    return {
      type: 'mindmap',
      workspace_id: 'replace-with-workspace-id',
      tenant_id: 'replace-with-tenant-id',
      params: {
        sourceMaterial: '人工智能课程第一章：机器学习、神经网络、Transformer。',
        layout: 'mindmap',
        depth: 3,
      },
    };
  }
  if (tool.name === 'opennotebook_framedirector_render_approve') {
    return {
      record_id: 'replace-with-framedirector-task-id',
      tenant_id: 'replace-with-tenant-id',
    };
  }
  return {};
}

function samplePlatformArgs(tool?: MCPIntegrationTool) {
  const requestId = `mcp-center-${Date.now()}`;
  if (!tool) return { request_id: requestId };
  if (tool.name === 'platform.task.list_open') {
    return { limit: 1, offset: 0, request_id: requestId };
  }
  if (tool.name === 'platform.agent.search') {
    return { query: 'carbon', topK: 5, request_id: requestId };
  }
  if (tool.requiresIdempotency) {
    return {
      request_id: requestId,
      idempotency_key: `${requestId}-${tool.name.split('.').pop()}`,
    };
  }
  return { request_id: requestId };
}

const detailTabs: Array<{ key: DetailTab; label: string }> = [
  { key: 'overview', label: '概览' },
  { key: 'external', label: '外部能力' },
  { key: 'platform', label: '平台开放能力' },
  { key: 'test', label: '调用测试' },
  { key: 'capabilities', label: '业务能力' },
  { key: 'bindings', label: '任务绑定' },
  { key: 'invocations', label: '调用审计' },
];

/* eslint-disable react-hooks/exhaustive-deps -- remote resource loaders are intentionally refreshed by the explicit selection effects below */
export default function AdminMCPIntegrationCenterPanel() {
  const [apps, setApps] = useState<MCPIntegrationApp[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');
  const [form, setForm] = useState<AppForm>({
    name: '',
    description: '',
    direction: 'bidirectional',
    transport: 'streamable-http',
    endpointUrl: '',
    authMode: 'none',
    defaultWorkspaceId: '',
    defaultTenantId: '',
  });
  const [externalTools, setExternalTools] = useState<MCPIntegrationTool[]>([]);
  const [platformTools, setPlatformTools] = useState<MCPIntegrationTool[]>([]);
  const [capabilities, setCapabilities] = useState<MCPIntegrationCapability[]>([]);
  const [bindings, setBindings] = useState<MCPTaskBinding[]>([]);
  const [invocations, setInvocations] = useState<MCPIntegrationInvocation[]>([]);
  const [detail, setDetail] = useState<MCPIntegrationInvocation | null>(null);
  const [selectedExternalTool, setSelectedExternalTool] = useState('');
  const [selectedPlatformTool, setSelectedPlatformTool] = useState('');
  const [externalArgs, setExternalArgs] = useState('{}');
  const [platformArgs, setPlatformArgs] = useState('{}');
  const [bindingPlatformTaskId, setBindingPlatformTaskId] = useState('');
  const [bindingPlatformOrderId, setBindingPlatformOrderId] = useState('');
  const [bindingToolName, setBindingToolName] = useState('');
  const [bindingArgs, setBindingArgs] = useState('{}');
  const [response, setResponse] = useState<unknown>(null);
  const [issuedInboundToken, setIssuedInboundToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState('');
  const [error, setError] = useState('');

  const selectedApp = useMemo(
    () => apps.find((app) => app.id === selectedId) || null,
    [apps, selectedId],
  );
  const currentExternalTool = useMemo(
    () => externalTools.find((tool) => tool.name === selectedExternalTool),
    [externalTools, selectedExternalTool],
  );
  const currentPlatformTool = useMemo(
    () => platformTools.find((tool) => tool.name === selectedPlatformTool),
    [platformTools, selectedPlatformTool],
  );

  const loadApps = async (preferredId?: string) => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchMCPIntegrationApps();
      setApps(data.data);
      const nextId = preferredId || selectedId || data.data[0]?.id || '';
      setSelectedId(nextId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'MCP 应用加载失败');
    } finally {
      setLoading(false);
    }
  };

  const loadAppData = async (appId: string) => {
    if (!appId) return;
    setError('');
    try {
      const [external, platform, caps, bindingData, invocationData] = await Promise.all([
        fetchMCPIntegrationTools(appId, 'external'),
        fetchMCPIntegrationPlatformTools(appId),
        fetchMCPIntegrationCapabilities(appId),
        fetchMCPTaskBindings({ appId, limit: 20 }),
        fetchMCPIntegrationInvocations({ appId, limit: 20 }),
      ]);
      setExternalTools(external.data);
      setPlatformTools(platform.data);
      setCapabilities(caps.data);
      setBindings(bindingData.data);
      setInvocations(invocationData.data);
      if (!selectedExternalTool && external.data[0]) {
        setSelectedExternalTool(external.data[0].name);
        setExternalArgs(stringifyJson(sampleExternalArgs(external.data[0])));
      }
      if (!bindingToolName && external.data[0]) {
        setBindingToolName(
          external.data.find((tool) => tool.name.includes('generate'))?.name ||
            external.data[0].name,
        );
        const generateTool =
          external.data.find((tool) => tool.name.includes('generate')) ||
          external.data[0];
        setBindingArgs(stringifyJson(sampleExternalArgs(generateTool)));
      }
      if (!selectedPlatformTool && platform.data[0]) {
        setSelectedPlatformTool(platform.data[0].name);
        setPlatformArgs(stringifyJson(samplePlatformArgs(platform.data[0])));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '应用详情加载失败');
    }
  };

  useEffect(() => {
    void loadApps();
  }, []);

  useEffect(() => {
    if (!selectedApp) return;
    setForm({
      name: selectedApp.name,
      description: selectedApp.description || '',
      direction: selectedApp.direction,
      transport: selectedApp.transport,
      endpointUrl: selectedApp.endpointUrl || '',
      authMode: selectedApp.authMode,
      defaultWorkspaceId: selectedApp.defaultWorkspaceId || '',
      defaultTenantId: selectedApp.defaultTenantId || '',
    });
    setSelectedExternalTool('');
    setSelectedPlatformTool('');
    setResponse(null);
    setIssuedInboundToken('');
    void loadAppData(selectedApp.id);
  }, [selectedApp?.id]);

  const saveApp = async () => {
    if (!selectedApp) return;
    setActionLoading('save');
    setError('');
    try {
      await updateMCPIntegrationApp(selectedApp.id, {
        ...form,
        endpointUrl: form.endpointUrl,
        defaultWorkspaceId: form.defaultWorkspaceId || null,
        defaultTenantId: form.defaultTenantId || null,
      });
      await loadApps(selectedApp.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setActionLoading('');
    }
  };

  const toggleApp = async () => {
    if (!selectedApp) return;
    setActionLoading('toggle');
    try {
      await setMCPIntegrationAppEnabled(selectedApp.id, !selectedApp.enabled);
      await loadApps(selectedApp.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : '状态切换失败');
    } finally {
      setActionLoading('');
    }
  };

  const discoverTools = async () => {
    if (!selectedApp) return;
    setActionLoading('discover');
    setError('');
    try {
      const data = await discoverMCPIntegrationTools(selectedApp.id);
      setExternalTools(data.tools);
      setResponse(data.exchange);
      await loadApps(selectedApp.id);
      await loadAppData(selectedApp.id);
      setActiveTab('external');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Tool 发现失败');
    } finally {
      setActionLoading('');
    }
  };

  const syncCapabilities = async () => {
    if (!selectedApp) return;
    setActionLoading('sync');
    setError('');
    try {
      const data = await syncMCPIntegrationCapabilities(selectedApp.id);
      setCapabilities(data.capabilities);
      setResponse(data.exchange || data);
      await loadApps(selectedApp.id);
      await loadAppData(selectedApp.id);
      setActiveTab('capabilities');
    } catch (err) {
      setError(err instanceof Error ? err.message : '能力同步失败');
    } finally {
      setActionLoading('');
    }
  };

  const issueInboundToken = async () => {
    if (!selectedApp) return;
    setActionLoading('issue-token');
    setError('');
    setIssuedInboundToken('');
    try {
      const data = await issueMCPIntegrationInboundToken(selectedApp.id);
      setIssuedInboundToken(data.token);
      setResponse(data);
      await loadApps(selectedApp.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : '入站 Token 签发失败');
    } finally {
      setActionLoading('');
    }
  };

  const toggleExternalTool = async (tool: MCPIntegrationTool) => {
    if (!selectedApp) return;
    await updateMCPIntegrationTool(tool.id, { enabled: !tool.enabled });
    const data = await fetchMCPIntegrationTools(selectedApp.id, 'external');
    setExternalTools(data.data);
  };

  const togglePlatformTool = async (tool: MCPIntegrationTool) => {
    if (!selectedApp) return;
    await updateMCPIntegrationPlatformTool(selectedApp.id, tool.name, {
      enabled: !tool.enabled,
    });
    const data = await fetchMCPIntegrationPlatformTools(selectedApp.id);
    setPlatformTools(data.data);
  };

  const selectExternalTool = (tool: MCPIntegrationTool) => {
    setSelectedExternalTool(tool.name);
    setExternalArgs(stringifyJson(sampleExternalArgs(tool)));
  };

  const selectPlatformTool = (tool: MCPIntegrationTool) => {
    setSelectedPlatformTool(tool.name);
    setPlatformArgs(stringifyJson(samplePlatformArgs(tool)));
  };

  const callExternalTool = async () => {
    if (!selectedApp || !currentExternalTool) return;
    setActionLoading('call-external');
    setError('');
    try {
      const data = await testMCPIntegrationExternalCall(selectedApp.id, {
        name: currentExternalTool.name,
        arguments: JSON.parse(externalArgs) as Record<string, unknown>,
      });
      setResponse(data);
      await loadAppData(selectedApp.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : '外部 Tool 调用失败');
    } finally {
      setActionLoading('');
    }
  };

  const callPlatformTool = async () => {
    if (!selectedApp || !currentPlatformTool) return;
    setActionLoading('call-platform');
    setError('');
    try {
      const data = await testMCPIntegrationPlatformCall(selectedApp.id, {
        name: currentPlatformTool.name,
        arguments: JSON.parse(platformArgs) as Record<string, unknown>,
      });
      setResponse(data);
      await loadAppData(selectedApp.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : '平台 Tool 模拟调用失败');
    } finally {
      setActionLoading('');
    }
  };

  const submitTaskBinding = async () => {
    if (!selectedApp || !bindingToolName) return;
    setActionLoading('submit-binding');
    setError('');
    try {
      const data = await submitMCPIntegrationExternalTask(selectedApp.id, {
        platformTaskId: bindingPlatformTaskId || null,
        platformOrderId: bindingPlatformOrderId || null,
        toolName: bindingToolName,
        arguments: JSON.parse(bindingArgs) as Record<string, unknown>,
      });
      setResponse(data);
      await loadAppData(selectedApp.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : '外部任务提交失败');
    } finally {
      setActionLoading('');
    }
  };

  const pollBinding = async (binding: MCPTaskBinding) => {
    if (!selectedApp) return;
    setActionLoading(`poll-${binding.id}`);
    setError('');
    try {
      const data = await pollMCPTaskBinding(binding.id, {
        deliverOnFinal: true,
      });
      setResponse(data);
      await loadAppData(selectedApp.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : '任务状态同步失败');
    } finally {
      setActionLoading('');
    }
  };

  const showInvocation = async (id: string) => {
    try {
      setDetail(await fetchMCPIntegrationInvocation(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : '调用详情加载失败');
    }
  };

  const copyResponse = () => {
    if (!response) return;
    void navigator.clipboard?.writeText(stringifyJson(response));
  };

  const copyIssuedInboundToken = () => {
    if (!issuedInboundToken) return;
    void navigator.clipboard?.writeText(issuedInboundToken);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <Terminal className="h-6 w-6 text-yellow-400" />
          <div>
            <h1 className="text-2xl font-bold">MCP 集成中心</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
              <span className="rounded border border-gray-800 bg-black px-2 py-0.5">
                双向 MCP 应用
              </span>
              <span className="rounded border border-gray-800 bg-black px-2 py-0.5">
                Tool 发现与保存
              </span>
              <span className="rounded border border-gray-800 bg-black px-2 py-0.5">
                调用测试审计
              </span>
            </div>
          </div>
        </div>
        <button
          onClick={() => void loadApps(selectedApp?.id)}
          className="flex items-center justify-center gap-2 rounded-lg border border-gray-800 bg-[#111] px-4 py-2 text-sm text-gray-300 hover:border-yellow-500/40 hover:text-yellow-400"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          刷新
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[340px_1fr]">
        <div className="overflow-hidden rounded-xl border border-gray-800 bg-[#111]">
          <div className="border-b border-gray-800 px-4 py-3">
            <div className="flex items-center gap-2">
              <Globe2 className="h-4 w-4 text-yellow-400" />
              <span className="text-sm font-bold">MCP 应用</span>
              <span className="text-xs text-gray-600">{apps.length}</span>
            </div>
          </div>
          <div className="max-h-[720px] overflow-y-auto">
            {apps.map((app) => (
              <button
                key={app.id}
                onClick={() => setSelectedId(app.id)}
                className={`w-full border-b border-gray-800/70 px-4 py-4 text-left transition-colors hover:bg-white/5 ${
                  selectedId === app.id ? 'bg-yellow-500/10' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      {app.code === 'opennotebook' ? (
                        <Globe2 className="h-4 w-4 text-cyan-400" />
                      ) : (
                        <Server className="h-4 w-4 text-purple-400" />
                      )}
                      <span className="text-sm font-bold text-gray-100">{app.name}</span>
                    </div>
                    <p className="mt-1 text-xs text-gray-600">{app.code}</p>
                  </div>
                  <span className={`rounded border px-2 py-0.5 text-xs ${statusClass(app.healthStatus)}`}>
                    {app.healthStatus}
                  </span>
                </div>
                <p className="mt-2 line-clamp-2 text-xs text-gray-500">
                  {app.description || '暂无说明'}
                </p>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded border border-gray-800 bg-black px-2 py-1">
                    <p className="text-gray-600">方向</p>
                    <p className="truncate text-gray-300">{app.direction}</p>
                  </div>
                  <div className="rounded border border-gray-800 bg-black px-2 py-1">
                    <p className="text-gray-600">外部</p>
                    <p className="text-gray-300">{app.externalToolCount || 0}</p>
                  </div>
                  <div className="rounded border border-gray-800 bg-black px-2 py-1">
                    <p className="text-gray-600">平台</p>
                    <p className="text-gray-300">{app.platformToolCount || 0}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-5">
          {selectedApp ? (
            <>
              <div className="flex flex-col gap-4 rounded-xl border border-gray-800 bg-[#111] p-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-bold text-gray-100">{selectedApp.name}</h2>
                    <span className={`rounded border px-2 py-0.5 text-xs ${statusClass(selectedApp.enabled)}`}>
                      {selectedApp.enabled ? 'enabled' : 'disabled'}
                    </span>
                    <span className="rounded border border-gray-800 bg-black px-2 py-0.5 text-xs text-gray-500">
                      {selectedApp.transport}
                    </span>
                  </div>
                  <p className="mt-1 break-all text-xs text-gray-500">
                    {selectedApp.endpointUrl || '未配置外部 endpoint'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={saveApp}
                    className="flex items-center gap-2 rounded-lg bg-yellow-500 px-4 py-2 text-sm font-bold text-black hover:bg-yellow-400"
                  >
                    {actionLoading === 'save' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    保存配置
                  </button>
                  <button
                    onClick={toggleApp}
                    className="flex items-center gap-2 rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:border-yellow-500/40 hover:text-yellow-400"
                  >
                    <Power className="h-4 w-4" />
                    {selectedApp.enabled ? '停用' : '启用'}
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {detailTabs.map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                      activeTab === tab.key
                        ? 'border-yellow-500/40 bg-yellow-500/10 text-yellow-400'
                        : 'border-gray-800 bg-[#111] text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {activeTab === 'overview' && (
                <div className="grid grid-cols-1 gap-4 rounded-xl border border-gray-800 bg-[#111] p-4 lg:grid-cols-2">
                  <label className="space-y-1 text-sm">
                    <span className="text-gray-500">应用名称</span>
                    <input
                      value={form.name}
                      onChange={(event) => setForm({ ...form, name: event.target.value })}
                      className="w-full rounded-lg border border-gray-700 bg-black px-3 py-2 text-gray-200 focus:border-yellow-500 focus:outline-none"
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="text-gray-500">Endpoint</span>
                    <input
                      value={form.endpointUrl}
                      onChange={(event) => setForm({ ...form, endpointUrl: event.target.value })}
                      className="w-full rounded-lg border border-gray-700 bg-black px-3 py-2 text-gray-200 focus:border-yellow-500 focus:outline-none"
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="text-gray-500">集成方向</span>
                    <select
                      value={form.direction}
                      onChange={(event) =>
                        setForm({ ...form, direction: event.target.value as MCPAppDirection })
                      }
                      className="w-full rounded-lg border border-gray-700 bg-black px-3 py-2 text-gray-200 focus:border-yellow-500 focus:outline-none"
                    >
                      <option value="inbound">inbound</option>
                      <option value="outbound">outbound</option>
                      <option value="bidirectional">bidirectional</option>
                    </select>
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="text-gray-500">Transport</span>
                    <select
                      value={form.transport}
                      onChange={(event) =>
                        setForm({ ...form, transport: event.target.value as MCPAppTransport })
                      }
                      className="w-full rounded-lg border border-gray-700 bg-black px-3 py-2 text-gray-200 focus:border-yellow-500 focus:outline-none"
                    >
                      <option value="streamable-http">streamable-http</option>
                      <option value="http-jsonrpc">http-jsonrpc</option>
                    </select>
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="text-gray-500">鉴权方式</span>
                    <select
                      value={form.authMode}
                      onChange={(event) =>
                        setForm({ ...form, authMode: event.target.value as MCPAppAuthMode })
                      }
                      className="w-full rounded-lg border border-gray-700 bg-black px-3 py-2 text-gray-200 focus:border-yellow-500 focus:outline-none"
                    >
                      <option value="none">none</option>
                      <option value="bearer">bearer</option>
                      <option value="headers">headers</option>
                    </select>
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="text-gray-500">默认 workspace_id</span>
                    <input
                      value={form.defaultWorkspaceId}
                      onChange={(event) =>
                        setForm({ ...form, defaultWorkspaceId: event.target.value })
                      }
                      className="w-full rounded-lg border border-gray-700 bg-black px-3 py-2 text-gray-200 focus:border-yellow-500 focus:outline-none"
                    />
                  </label>
                  <label className="space-y-1 text-sm lg:col-span-2">
                    <span className="text-gray-500">说明</span>
                    <textarea
                      value={form.description}
                      onChange={(event) =>
                        setForm({ ...form, description: event.target.value })
                      }
                      className="h-20 w-full resize-none rounded-lg border border-gray-700 bg-black px-3 py-2 text-gray-200 focus:border-yellow-500 focus:outline-none"
                    />
                  </label>
                  <div className="rounded-lg border border-gray-800 bg-black p-4 lg:col-span-2">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <ShieldCheck className="h-4 w-4 text-yellow-400" />
                          <span className="text-sm font-bold text-gray-200">入站 MCP Token</span>
                          <span
                            className={`rounded border px-2 py-0.5 text-xs ${statusClass(selectedApp.hasMcpToken)}`}
                          >
                            {selectedApp.hasMcpToken ? '已签发' : '未签发'}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-gray-600">
                          {selectedApp.mcpTokenIssuedAt
                            ? `签发时间：${new Date(selectedApp.mcpTokenIssuedAt).toLocaleString('zh-CN')}`
                            : '用于外部应用调用平台 /mcp，明文 token 只在签发时展示一次。'}
                        </p>
                      </div>
                      <button
                        onClick={issueInboundToken}
                        className="flex items-center justify-center gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-2 text-sm text-yellow-400 hover:bg-yellow-500/20"
                      >
                        {actionLoading === 'issue-token' ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <ShieldCheck className="h-4 w-4" />
                        )}
                        {selectedApp.hasMcpToken ? '轮换 Token' : '签发 Token'}
                      </button>
                    </div>
                    {issuedInboundToken && (
                      <div className="mt-4 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-xs font-bold text-yellow-300">
                              本次签发的明文 Token
                            </p>
                            <p className="mt-1 text-xs text-gray-500">
                              只展示这一次，请复制到外部 MCP 应用配置中。
                            </p>
                          </div>
                          <button
                            onClick={copyIssuedInboundToken}
                            className="flex shrink-0 items-center gap-2 rounded border border-yellow-500/30 bg-black px-3 py-1.5 text-xs text-yellow-400 hover:bg-yellow-500/10"
                          >
                            <Copy className="h-3.5 w-3.5" />
                            复制
                          </button>
                        </div>
                        <pre className="mt-3 max-h-24 overflow-auto whitespace-pre-wrap break-all rounded border border-gray-800 bg-black p-3 font-mono text-xs text-yellow-100">
                          {issuedInboundToken}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'external' && (
                <ToolListPanel
                  title="外部 Tool"
                  icon={<Wrench className="h-4 w-4 text-cyan-400" />}
                  tools={externalTools}
                  emptyText="尚未发现外部 Tool"
                  action={
                    <button
                      onClick={discoverTools}
                      className="flex items-center gap-2 rounded-lg bg-cyan-500 px-3 py-2 text-xs font-bold text-black hover:bg-cyan-400"
                    >
                      {actionLoading === 'discover' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                      发现 Tool
                    </button>
                  }
                  onToggle={toggleExternalTool}
                />
              )}

              {activeTab === 'platform' && (
                <ToolListPanel
                  title="平台开放 Tool"
                  icon={<ShieldCheck className="h-4 w-4 text-yellow-400" />}
                  tools={platformTools}
                  emptyText="暂无平台 Tool"
                  onToggle={togglePlatformTool}
                />
              )}

              {activeTab === 'capabilities' && (
                <div className="overflow-hidden rounded-xl border border-gray-800 bg-[#111]">
                  <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Database className="h-4 w-4 text-yellow-400" />
                      <span className="text-sm font-bold">业务能力</span>
                      <span className="text-xs text-gray-600">{capabilities.length}</span>
                    </div>
                    <button
                      onClick={syncCapabilities}
                      className="flex items-center gap-2 rounded-lg bg-yellow-500 px-3 py-2 text-xs font-bold text-black hover:bg-yellow-400"
                    >
                      {actionLoading === 'sync' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                      同步能力
                    </button>
                  </div>
                  <div className="divide-y divide-gray-800">
                    {capabilities.map((item) => (
                      <div key={item.id} className="grid grid-cols-[110px_1fr_120px] gap-3 px-4 py-3 text-sm">
                        <span className="rounded border border-gray-700 bg-black px-2 py-1 text-center text-xs text-gray-400">
                          {item.capabilityType}
                        </span>
                        <div>
                          <p className="font-medium text-gray-200">{item.name}</p>
                          <p className="mt-1 text-xs text-gray-600">{item.code}</p>
                          <p className="mt-1 line-clamp-2 text-xs text-gray-500">
                            {item.description || '无说明'}
                          </p>
                        </div>
                        <span className={`h-fit rounded border px-2 py-1 text-center text-xs ${statusClass(item.enabled)}`}>
                          {item.enabled ? 'enabled' : 'disabled'}
                        </span>
                      </div>
                    ))}
                    {capabilities.length === 0 && (
                      <div className="py-12 text-center text-sm text-gray-600">
                        暂无业务能力
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'test' && (
                <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                  <CallPanel
                    title={`平台 -> ${selectedApp.name}`}
                    accent="cyan"
                    tools={externalTools}
                    selectedTool={selectedExternalTool}
                    argsText={externalArgs}
                    running={actionLoading === 'call-external'}
                    onSelect={(name) => {
                      const tool = externalTools.find((item) => item.name === name);
                      if (tool) selectExternalTool(tool);
                    }}
                    onArgsChange={setExternalArgs}
                    onFormat={() => setExternalArgs(stringifyJson(JSON.parse(externalArgs)))}
                    onRun={callExternalTool}
                  />
                  <CallPanel
                    title={`${selectedApp.name} -> 平台`}
                    accent="yellow"
                    tools={platformTools}
                    selectedTool={selectedPlatformTool}
                    argsText={platformArgs}
                    running={actionLoading === 'call-platform'}
                    onSelect={(name) => {
                      const tool = platformTools.find((item) => item.name === name);
                      if (tool) selectPlatformTool(tool);
                    }}
                    onArgsChange={setPlatformArgs}
                    onFormat={() => setPlatformArgs(stringifyJson(JSON.parse(platformArgs)))}
                    onRun={callPlatformTool}
                  />
                  <div className="overflow-hidden rounded-xl border border-gray-800 bg-[#111] xl:col-span-2">
                    <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
                      <div className="flex items-center gap-2">
                        <FileJson className="h-4 w-4 text-yellow-400" />
                        <span className="text-sm font-bold">最近响应</span>
                      </div>
                      <button
                        onClick={copyResponse}
                        disabled={!response}
                        className="p-2 text-gray-500 hover:text-yellow-400 disabled:opacity-30"
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                    </div>
                    <pre className="max-h-[360px] overflow-auto bg-black p-4 font-mono text-xs text-gray-300">
                      {response ? stringifyJson(response) : '暂无响应'}
                    </pre>
                  </div>
                </div>
              )}

              {activeTab === 'bindings' && (
                <div className="space-y-5">
                  <div className="grid grid-cols-1 gap-5 xl:grid-cols-[360px_1fr]">
                    <div className="overflow-hidden rounded-xl border border-gray-800 bg-[#111]">
                      <div className="border-b border-gray-800 px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Database className="h-4 w-4 text-yellow-400" />
                          <span className="text-sm font-bold">提交外部任务</span>
                        </div>
                      </div>
                      <div className="space-y-3 p-4">
                        <label className="block space-y-1 text-sm">
                          <span className="text-gray-500">平台任务 ID</span>
                          <input
                            value={bindingPlatformTaskId}
                            onChange={(event) =>
                              setBindingPlatformTaskId(event.target.value)
                            }
                            className="w-full rounded-lg border border-gray-700 bg-black px-3 py-2 text-gray-200 focus:border-yellow-500 focus:outline-none"
                          />
                        </label>
                        <label className="block space-y-1 text-sm">
                          <span className="text-gray-500">平台订单 ID</span>
                          <input
                            value={bindingPlatformOrderId}
                            onChange={(event) =>
                              setBindingPlatformOrderId(event.target.value)
                            }
                            className="w-full rounded-lg border border-gray-700 bg-black px-3 py-2 text-gray-200 focus:border-yellow-500 focus:outline-none"
                          />
                        </label>
                        <label className="block space-y-1 text-sm">
                          <span className="text-gray-500">外部提交 Tool</span>
                          <select
                            value={bindingToolName}
                            onChange={(event) => {
                              const next = event.target.value;
                              setBindingToolName(next);
                              const tool = externalTools.find((item) => item.name === next);
                              setBindingArgs(stringifyJson(sampleExternalArgs(tool)));
                            }}
                            className="w-full rounded-lg border border-gray-700 bg-black px-3 py-2 text-gray-200 focus:border-yellow-500 focus:outline-none"
                          >
                            <option value="">选择 Tool</option>
                            {externalTools.map((tool) => (
                              <option key={tool.id} value={tool.name}>
                                {tool.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          onClick={submitTaskBinding}
                          disabled={!bindingToolName || actionLoading === 'submit-binding'}
                          className="flex w-full items-center justify-center gap-2 rounded-lg bg-yellow-500 px-4 py-2 text-sm font-bold text-black hover:bg-yellow-400 disabled:opacity-50"
                        >
                          {actionLoading === 'submit-binding' ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Play className="h-4 w-4" />
                          )}
                          提交并绑定
                        </button>
                      </div>
                    </div>
                    <div className="overflow-hidden rounded-xl border border-gray-800 bg-[#111]">
                      <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
                        <span className="text-sm font-bold">提交参数 JSON</span>
                        <button
                          onClick={() => setBindingArgs(stringifyJson(JSON.parse(bindingArgs)))}
                          className="p-2 text-gray-500 hover:text-yellow-400"
                          title="格式化"
                        >
                          <FileJson className="h-4 w-4" />
                        </button>
                      </div>
                      <textarea
                        value={bindingArgs}
                        onChange={(event) => setBindingArgs(event.target.value)}
                        spellCheck={false}
                        className="h-72 w-full resize-none bg-black p-4 font-mono text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-yellow-500"
                      />
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-xl border border-gray-800 bg-[#111]">
                    <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Database className="h-4 w-4 text-yellow-400" />
                        <span className="text-sm font-bold">任务绑定</span>
                        <span className="text-xs text-gray-600">{bindings.length}</span>
                      </div>
                      <button
                        onClick={() => selectedApp && void loadAppData(selectedApp.id)}
                        className="text-gray-500 hover:text-yellow-400"
                      >
                        <RefreshCw className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-800 text-gray-500">
                            <th className="px-4 py-3 text-left">外部任务</th>
                            <th className="px-4 py-3 text-left">平台订单</th>
                            <th className="px-4 py-3 text-left">状态</th>
                            <th className="px-4 py-3 text-left">结果</th>
                            <th className="px-4 py-3 text-right">操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {bindings.map((binding) => (
                            <tr key={binding.id} className="border-b border-gray-800/50">
                              <td className="max-w-[220px] truncate px-4 py-3 text-xs text-gray-300">
                                {binding.externalTaskId || '-'}
                              </td>
                              <td className="max-w-[220px] truncate px-4 py-3 text-xs text-gray-500">
                                {binding.platformOrderId || '-'}
                              </td>
                              <td className="px-4 py-3">
                                <span className={`rounded border px-2 py-0.5 text-xs ${statusClass(binding.errorMessage ? 'failed' : binding.status || 'unknown')}`}>
                                  {binding.errorMessage ? 'failed' : binding.status || '-'}
                                </span>
                              </td>
                              <td className="max-w-[260px] truncate px-4 py-3 text-xs text-gray-500">
                                {binding.resultUrl || '-'}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <button
                                  onClick={() => void pollBinding(binding)}
                                  className="rounded border border-yellow-500/30 bg-yellow-500/10 px-3 py-1.5 text-xs text-yellow-400 hover:bg-yellow-500/20"
                                >
                                  {actionLoading === `poll-${binding.id}` ? '同步中' : '同步状态'}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {bindings.length === 0 && (
                        <div className="py-12 text-center text-sm text-gray-600">
                          暂无任务绑定
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'invocations' && (
                <div className="overflow-hidden rounded-xl border border-gray-800 bg-[#111]">
                  <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Database className="h-4 w-4 text-yellow-400" />
                      <span className="text-sm font-bold">调用审计</span>
                      <span className="text-xs text-gray-600">{invocations.length}</span>
                    </div>
                    <button
                      onClick={() => selectedApp && void loadAppData(selectedApp.id)}
                      className="text-gray-500 hover:text-yellow-400"
                    >
                      <RefreshCw className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-800 text-gray-500">
                          <th className="px-4 py-3 text-left">时间</th>
                          <th className="px-4 py-3 text-left">方向</th>
                          <th className="px-4 py-3 text-left">Tool</th>
                          <th className="px-4 py-3 text-left">状态</th>
                          <th className="px-4 py-3 text-right">耗时</th>
                        </tr>
                      </thead>
                      <tbody>
                        {invocations.map((item) => (
                          <tr
                            key={item.id}
                            onClick={() => void showInvocation(item.id)}
                            className="cursor-pointer border-b border-gray-800/50 hover:bg-white/5"
                          >
                            <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">
                              {new Date(item.createdAt).toLocaleString('zh-CN')}
                            </td>
                            <td className="px-4 py-3 text-xs text-gray-300">{item.direction}</td>
                            <td className="px-4 py-3 text-xs text-gray-300">{item.toolName}</td>
                            <td className="px-4 py-3">
                              <span className={`rounded border px-2 py-0.5 text-xs ${statusClass(item.status)}`}>
                                {item.status}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right text-xs text-gray-500">
                              {item.durationMs ?? '-'} ms
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {invocations.length === 0 && (
                      <div className="py-12 text-center text-sm text-gray-600">
                        暂无调用记录
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="rounded-xl border border-gray-800 bg-[#111] py-16 text-center text-sm text-gray-600">
              暂无 MCP 应用
            </div>
          )}
        </div>
      </div>

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
          <div className="max-h-[86vh] w-full max-w-5xl overflow-hidden rounded-xl border border-gray-800 bg-[#111]">
            <div className="flex items-center justify-between border-b border-gray-800 px-5 py-4">
              <div>
                <p className="font-bold">{detail.toolName}</p>
                <p className="text-xs text-gray-600">{detail.id}</p>
              </div>
              <button
                onClick={() => setDetail(null)}
                className="text-gray-500 hover:text-gray-300"
              >
                <XCircle className="h-5 w-5" />
              </button>
            </div>
            <div className="grid max-h-[72vh] grid-cols-1 overflow-auto lg:grid-cols-2">
              <div className="border-r border-gray-800">
                <div className="border-b border-gray-800 px-4 py-2 text-xs text-gray-500">
                  request_json
                </div>
                <pre className="whitespace-pre-wrap p-4 font-mono text-xs text-gray-300">
                  {stringifyJson(detail.requestJson)}
                </pre>
              </div>
              <div>
                <div className="border-b border-gray-800 px-4 py-2 text-xs text-gray-500">
                  response_json
                </div>
                <pre className="whitespace-pre-wrap p-4 font-mono text-xs text-gray-300">
                  {stringifyJson(detail.responseJson)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ToolListPanel({
  title,
  icon,
  tools,
  emptyText,
  action,
  onToggle,
}: {
  title: string;
  icon: React.ReactNode;
  tools: MCPIntegrationTool[];
  emptyText: string;
  action?: React.ReactNode;
  onToggle: (tool: MCPIntegrationTool) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-800 bg-[#111]">
      <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-bold">{title}</span>
          <span className="text-xs text-gray-600">{tools.length}</span>
        </div>
        {action}
      </div>
      <div className="divide-y divide-gray-800">
        {tools.map((tool) => (
          <div key={tool.id} className="grid grid-cols-[1fr_90px_110px] gap-3 px-4 py-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="break-all text-sm font-medium text-gray-200">{tool.name}</p>
                <span
                  className={`rounded border px-2 py-0.5 text-[10px] ${
                    tool.isWrite
                      ? 'border-orange-500/20 bg-orange-500/10 text-orange-400'
                      : 'border-cyan-500/20 bg-cyan-500/10 text-cyan-400'
                  }`}
                >
                  {tool.isWrite ? '写' : '读'}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-gray-600">
                {tool.description || '无说明'}
              </p>
              {tool.lastError && (
                <p className="mt-1 line-clamp-1 text-xs text-red-400">{tool.lastError}</p>
              )}
            </div>
            <span className={`h-fit rounded border px-2 py-1 text-center text-xs ${statusClass(tool.lastStatus)}`}>
              {tool.lastStatus || 'idle'}
            </span>
            <button
              onClick={() => onToggle(tool)}
              className={`h-fit rounded border px-3 py-1.5 text-xs ${
                tool.enabled
                  ? 'border-green-500/20 bg-green-500/10 text-green-400'
                  : 'border-gray-700 bg-black text-gray-500'
              }`}
            >
              {tool.enabled ? '已启用' : '已停用'}
            </button>
          </div>
        ))}
        {tools.length === 0 && (
          <div className="py-12 text-center text-sm text-gray-600">{emptyText}</div>
        )}
      </div>
    </div>
  );
}

function CallPanel({
  title,
  accent,
  tools,
  selectedTool,
  argsText,
  running,
  onSelect,
  onArgsChange,
  onFormat,
  onRun,
}: {
  title: string;
  accent: 'cyan' | 'yellow';
  tools: MCPIntegrationTool[];
  selectedTool: string;
  argsText: string;
  running: boolean;
  onSelect: (name: string) => void;
  onArgsChange: (value: string) => void;
  onFormat: () => void;
  onRun: () => void;
}) {
  const accentClass =
    accent === 'cyan'
      ? 'bg-cyan-500 text-black hover:bg-cyan-400'
      : 'bg-yellow-500 text-black hover:bg-yellow-400';
  return (
    <div className="overflow-hidden rounded-xl border border-gray-800 bg-[#111]">
      <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
        <div>
          <p className="text-sm font-bold">{title}</p>
          <p className="mt-1 text-xs text-gray-600">JSON-RPC tools/call</p>
        </div>
        <button
          onClick={onFormat}
          className="p-2 text-gray-500 hover:text-yellow-400"
          title="格式化"
        >
          <FileJson className="h-4 w-4" />
        </button>
      </div>
      <div className="border-b border-gray-800 p-3">
        <select
          value={selectedTool}
          onChange={(event) => onSelect(event.target.value)}
          className="w-full rounded-lg border border-gray-700 bg-black px-3 py-2 text-sm text-gray-200 focus:border-yellow-500 focus:outline-none"
        >
          <option value="">选择 Tool</option>
          {tools.map((tool) => (
            <option key={tool.id} value={tool.name}>
              {tool.name}
            </option>
          ))}
        </select>
      </div>
      <textarea
        value={argsText}
        onChange={(event) => onArgsChange(event.target.value)}
        spellCheck={false}
        className="h-72 w-full resize-none bg-black p-4 font-mono text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-yellow-500"
      />
      <div className="flex items-center justify-end border-t border-gray-800 px-4 py-3">
        <button
          onClick={onRun}
          disabled={!selectedTool || running}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold disabled:opacity-50 ${accentClass}`}
        >
          {running ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          执行
        </button>
      </div>
    </div>
  );
}
