import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Database,
  FileJson,
  Loader2,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Wand2,
  XCircle,
} from 'lucide-react';
import {
  callAdminMCPTool,
  fetchAdminMCPInvocation,
  fetchAdminMCPInvocations,
  fetchAdminMCPTools,
  type AdminMCPCallResponse,
  type AdminMCPInvocation,
  type AdminMCPTool,
} from '../../api/adminMcpApi';
import { useConfirm } from '../ui/confirm-context';
import { useDialogA11y } from '../ui/useDialogA11y';

type Diagnostic = {
  name: string;
  status: 'idle' | 'pass' | 'fail';
  detail: string;
};

const requestId = () => `debug-${Date.now()}`;

function stringifyJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function sampleArguments(tool?: AdminMCPTool) {
  const rid = requestId();
  const key = `${rid}-${tool?.name?.split('.').pop() || 'tool'}`;

  switch (tool?.name) {
    case 'platform.agent.search':
      return { query: 'carbon', topK: 5, request_id: rid };
    case 'platform.agent.get':
      return { agent_id: '', request_id: rid };
    case 'platform.agent.report_health':
      return {
        agent_id: '',
        status: 'online',
        latency_ms: 30,
        load: 0.2,
        idempotency_key: key,
        request_id: rid,
      };
    case 'platform.task.get':
      return { task_id: '', request_id: rid };
    case 'platform.task.list_open':
      return { limit: 10, offset: 0, request_id: rid };
    case 'platform.order.create':
      return {
        task_id: '',
        agent_id: '',
        bid_id: '',
        idempotency_key: key,
        request_id: rid,
      };
    case 'platform.order.get':
      return { order_id: '', request_id: rid };
    case 'platform.order.update_execution':
      return {
        order_id: '',
        status: 'RUNNING',
        progress: 25,
        message: 'MCP debug progress',
        idempotency_key: key,
        request_id: rid,
      };
    case 'platform.artifact.attach':
      return {
        order_id: '',
        artifacts: [{ url: 'https://example.com/result.zip', name: 'result.zip' }],
        delivery_summary: 'MCP debug delivery',
        idempotency_key: key,
        request_id: rid,
      };
    case 'platform.quote.submit':
      return {
        task_id: '',
        agent_id: '',
        price: 100,
        plan_summary: 'MCP debug quote',
        idempotency_key: key,
        request_id: rid,
      };
    default:
      return { request_id: rid };
  }
}

function statusClass(status?: string) {
  if (status === 'success' || status === 'pass') {
    return 'text-[var(--state-success-text)] bg-[var(--state-success-surface)] border-[color:var(--state-success-border)]';
  }
  if (status === 'failed' || status === 'fail') {
    return 'text-[var(--state-error)] bg-[var(--state-error-surface)] border-[color:var(--state-error-border)]';
  }
  return 'text-[var(--text-600)] bg-[var(--background-100)] border-[color:var(--border)]';
}

/* eslint-disable react-hooks/exhaustive-deps -- invocation and tool loaders are scoped to their explicit filter effects */
export default function AdminMCPPlatformPanel() {
  const [tools, setTools] = useState<AdminMCPTool[]>([]);
  const [selectedName, setSelectedName] = useState('');
  const [argsText, setArgsText] = useState('{}');
  const [toolsLoading, setToolsLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState('');
  const [response, setResponse] = useState<AdminMCPCallResponse | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([
    { name: '管理员代理', status: 'idle', detail: '未检测' },
    { name: '工具发现', status: 'idle', detail: '未检测' },
    { name: '协议调用', status: 'idle', detail: '未检测' },
    { name: '审计查询', status: 'idle', detail: '未检测' },
  ]);
  const [invocations, setInvocations] = useState<AdminMCPInvocation[]>([]);
  const [invocationTotal, setInvocationTotal] = useState(0);
  const [invocationsLoading, setInvocationsLoading] = useState(false);
  const [detail, setDetail] = useState<AdminMCPInvocation | null>(null);
  const [toolFilter, setToolFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [requestFilter, setRequestFilter] = useState('');

  const confirm = useConfirm();
  const detailDialogRef = useRef<HTMLDivElement>(null);
  useDialogA11y(Boolean(detail), detailDialogRef, () => setDetail(null));

  const selectedTool = useMemo(
    () => tools.find((tool) => tool.name === selectedName),
    [selectedName, tools],
  );

  const loadTools = async () => {
    setToolsLoading(true);
    setError('');
    try {
      const data = await fetchAdminMCPTools();
      setTools(data.tools);
      if (!selectedName && data.tools.length > 0) {
        setSelectedName(data.tools[0].name);
        setArgsText(stringifyJson(sampleArguments(data.tools[0])));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '工具列表加载失败');
    } finally {
      setToolsLoading(false);
    }
  };

  const loadInvocations = async () => {
    setInvocationsLoading(true);
    try {
      const data = await fetchAdminMCPInvocations({
        limit: 20,
        toolName: toolFilter || undefined,
        status: statusFilter || undefined,
        requestId: requestFilter || undefined,
      });
      setInvocations(data.data);
      setInvocationTotal(data.pagination.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : '调用记录加载失败');
    } finally {
      setInvocationsLoading(false);
    }
  };

  useEffect(() => {
    loadTools();
    loadInvocations();
  }, []);

  const selectTool = (tool: AdminMCPTool) => {
    setSelectedName(tool.name);
    setArgsText(stringifyJson(sampleArguments(tool)));
    setResponse(null);
    setError('');
  };

  const formatArgs = () => {
    try {
      setArgsText(stringifyJson(JSON.parse(argsText)));
      setError('');
    } catch {
      setError('JSON 参数格式不正确');
    }
  };

  const resetArgs = () => {
    setArgsText(stringifyJson(sampleArguments(selectedTool)));
    setError('');
  };

  const execute = async () => {
    if (!selectedTool) return;
    setExecuting(true);
    setError('');
    setResponse(null);
    try {
      const args = JSON.parse(argsText) as Record<string, unknown>;
      if (
        selectedTool.requiresIdempotency &&
        typeof args.idempotency_key !== 'string'
      ) {
        args.idempotency_key = `${requestId()}-${selectedTool.name.split('.').pop()}`;
        setArgsText(stringifyJson(args));
      }
      if (selectedTool.isWrite) {
        const { confirmed } = await confirm({
          title: '执行写工具',
          description: `确认执行写工具 ${selectedTool.name} 吗？`,
          tone: 'danger',
          confirmText: '确认执行',
        });
        if (!confirmed) return;
      }
      const data = await callAdminMCPTool({
        name: selectedTool.name,
        arguments: args,
        id: args.request_id as string | undefined,
      });
      setResponse(data);
      await loadInvocations();
    } catch (err) {
      setError(err instanceof Error ? err.message : '调用失败');
    } finally {
      setExecuting(false);
    }
  };

  const runDiagnostics = async () => {
    const next: Diagnostic[] = [];
    setDiagnostics([
      { name: '管理员代理', status: 'idle', detail: '检测中' },
      { name: '工具发现', status: 'idle', detail: '检测中' },
      { name: '协议调用', status: 'idle', detail: '检测中' },
      { name: '审计查询', status: 'idle', detail: '检测中' },
    ]);

    try {
      const toolData = await fetchAdminMCPTools();
      next.push({ name: '管理员代理', status: 'pass', detail: '鉴权通过' });
      next.push({
        name: '工具发现',
        status: toolData.tools.length > 0 ? 'pass' : 'fail',
        detail: `${toolData.tools.length} 个 Tool`,
      });
      setTools(toolData.tools);
      if (!selectedName && toolData.tools.length > 0) {
        setSelectedName(toolData.tools[0].name);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '连接失败';
      setDiagnostics([
        { name: '管理员代理', status: 'fail', detail: message },
        { name: '工具发现', status: 'fail', detail: '-' },
        { name: '协议调用', status: 'fail', detail: '-' },
        { name: '审计查询', status: 'fail', detail: '-' },
      ]);
      return;
    }

    try {
      const call = await callAdminMCPTool({
        name: 'platform.task.list_open',
        arguments: { limit: 1, offset: 0, request_id: requestId() },
        id: 'diagnose-list-open',
      });
      next.push({
        name: '协议调用',
        status: call.result.success ? 'pass' : 'fail',
        detail: call.result.success
          ? `${call.durationMs} ms`
          : call.result.error?.code || '失败',
      });
    } catch (err) {
      next.push({
        name: '协议调用',
        status: 'fail',
        detail: err instanceof Error ? err.message : '调用失败',
      });
    }

    try {
      const data = await fetchAdminMCPInvocations({ limit: 5 });
      next.push({
        name: '审计查询',
        status: 'pass',
        detail: `${data.pagination.total} 条记录`,
      });
      setInvocations(data.data);
      setInvocationTotal(data.pagination.total);
    } catch (err) {
      next.push({
        name: '审计查询',
        status: 'fail',
        detail: err instanceof Error ? err.message : '查询失败',
      });
    }

    setDiagnostics(next);
  };

  const showInvocationDetail = async (id: string) => {
    try {
      setDetail(await fetchAdminMCPInvocation(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : '详情加载失败');
    }
  };

  const copyResponse = () => {
    if (!response) return;
    void navigator.clipboard?.writeText(stringifyJson(response));
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-xl border border-[color:var(--border)] bg-[var(--background-50)] p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-5 w-5 text-[var(--state-warning)]" />
          <div>
            <h2 className="text-base font-bold text-[var(--text-900)]">平台 MCP 服务</h2>
            <p className="mt-1 text-xs text-[var(--text-500)]">
              外部应用调用当前平台，调试本平台暴露的 /mcp Tool。
            </p>
          </div>
        </div>
        <button
          onClick={runDiagnostics}
          className="flex items-center justify-center gap-2 rounded-lg bg-[var(--brand-500)] px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-[var(--brand-strong)]"
        >
          <ShieldCheck className="h-4 w-4" />
          一键诊断
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-[color:var(--state-error-border)] bg-[var(--state-error-surface)] px-4 py-3 text-sm text-[var(--state-error)]">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {diagnostics.map((item) => (
          <div key={item.name} className="rounded-lg border border-[color:var(--border)] bg-[var(--background-50)] p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm text-[var(--text-700)]">{item.name}</span>
              {item.status === 'pass' ? (
                <CheckCircle2 className="h-4 w-4 text-[var(--state-success-text)]" />
              ) : item.status === 'fail' ? (
                <XCircle className="h-4 w-4 text-[var(--state-error)]" />
              ) : (
                <span className="h-4 w-4 rounded-full border border-[color:var(--input)]" />
              )}
            </div>
            <p className="truncate text-xs text-[var(--text-500)]">{item.detail}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[300px_1fr]">
        <div className="overflow-hidden rounded-xl border border-[color:var(--border)] bg-[var(--background-50)]">
          <div className="flex items-center justify-between border-b border-[color:var(--border)] px-4 py-3">
            <div className="flex items-center gap-2">
              <FileJson className="h-4 w-4 text-[var(--state-warning)]" />
              <span className="text-sm font-bold">本平台 Tool</span>
              <span className="text-xs text-[var(--text-500)]">{tools.length}</span>
            </div>
            <button
              onClick={loadTools}
              className="text-[var(--text-500)] hover:text-[var(--state-warning)]"
              title="刷新"
            >
              {toolsLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </button>
          </div>
          <div className="max-h-[520px] overflow-y-auto">
            {tools.map((tool) => (
              <button
                key={tool.name}
                onClick={() => selectTool(tool)}
                title={`${tool.name}\n${tool.description || ''}\n${
                  tool.requiresIdempotency
                    ? '需要 idempotency_key'
                    : '不需要 idempotency_key'
                }`}
                className={`w-full border-b border-[color:var(--border)] px-4 py-3 text-left transition-colors hover:bg-[var(--background-100)] ${
                  selectedName === tool.name ? 'bg-[var(--state-warning-surface)]' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="break-all text-sm text-[var(--text-800)]">{tool.name}</span>
                  <span
                    className={`rounded border px-2 py-0.5 text-[10px] ${
                      tool.isWrite
                        ? 'border-[color:var(--state-warning-border)] bg-[var(--state-warning-surface)] text-[var(--state-warning)]'
                        : 'border-[color:var(--brand-200)] bg-[var(--brand-50)] text-[var(--brand-600)]'
                    }`}
                  >
                    {tool.isWrite ? '写' : '读'}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-[var(--text-500)]">
                  {tool.description}
                </p>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className="overflow-hidden rounded-xl border border-[color:var(--border)] bg-[var(--background-50)]">
              <div className="flex items-center justify-between border-b border-[color:var(--border)] px-4 py-3">
                <div>
                  <p className="text-sm font-bold">{selectedTool?.name || '未选择 Tool'}</p>
                  <p className="mt-1 text-xs text-[var(--text-500)]">
                    {selectedTool?.isWrite ? '写操作需要幂等键' : '读操作'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={resetArgs}
                    className="p-2 text-[var(--text-500)] hover:text-[var(--state-warning)]"
                    title="示例参数"
                  >
                    <Wand2 className="h-4 w-4" />
                  </button>
                  <button
                    onClick={formatArgs}
                    className="p-2 text-[var(--text-500)] hover:text-[var(--state-warning)]"
                    title="格式化"
                  >
                    <FileJson className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <textarea
                value={argsText}
                onChange={(event) => setArgsText(event.target.value)}
                spellCheck={false}
                className="h-80 w-full resize-none bg-[var(--background-50)] p-4 font-mono text-xs text-[var(--text-800)] focus:outline-none focus:ring-1 focus:ring-[color:var(--brand-500)]"
              />
              <div className="flex items-center justify-between border-t border-[color:var(--border)] px-4 py-3">
                <span className="text-xs text-[var(--text-500)]">
                  {selectedTool?.requiresIdempotency
                    ? 'idempotency_key 自动补全'
                    : 'request_id 可选'}
                </span>
                <button
                  onClick={execute}
                  disabled={!selectedTool || executing}
                  className="flex items-center gap-2 rounded-lg bg-[var(--brand-500)] px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-[var(--brand-strong)] disabled:opacity-50"
                >
                  {executing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  执行
                </button>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-[color:var(--border)] bg-[var(--background-50)]">
              <div className="flex items-center justify-between border-b border-[color:var(--border)] px-4 py-3">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-[var(--state-warning)]" />
                  <span className="text-sm font-bold">响应结果</span>
                </div>
                <button
                  onClick={copyResponse}
                  disabled={!response}
                  className="p-2 text-[var(--text-500)] hover:text-[var(--state-warning)] disabled:opacity-30"
                  title="复制"
                >
                  <Copy className="h-4 w-4" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3 border-b border-[color:var(--border)] p-4 text-xs">
                <div>
                  <p className="mb-1 text-[var(--text-500)]">状态</p>
                  <span
                    className={`rounded border px-2 py-1 ${
                      response?.result.success
                        ? statusClass('success')
                        : response
                          ? statusClass('failed')
                          : statusClass()
                    }`}
                  >
                    {response ? (response.result.success ? 'success' : 'failed') : '-'}
                  </span>
                </div>
                <div>
                  <p className="mb-1 text-[var(--text-500)]">耗时</p>
                  <p className="text-[var(--text-700)]">{response?.durationMs ?? '-'} ms</p>
                </div>
                <div>
                  <p className="mb-1 text-[var(--text-500)]">审计 ID</p>
                  <p className="truncate text-[var(--text-700)]">{response?.invocationId || '-'}</p>
                </div>
                <div>
                  <p className="mb-1 text-[var(--text-500)]">错误码</p>
                  <p className="truncate text-[var(--text-700)]">{response?.result.error?.code || '-'}</p>
                </div>
              </div>
              <pre className="h-[254px] overflow-auto bg-[var(--background-100)] p-4 font-mono text-xs text-[var(--text-700)]">
                {response ? stringifyJson(response) : '暂无响应'}
              </pre>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-[color:var(--border)] bg-[var(--background-50)]">
            <div className="flex items-center justify-between border-b border-[color:var(--border)] px-4 py-3">
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-[var(--state-warning)]" />
                <span className="text-sm font-bold">最近 MCP 调用</span>
                <span className="text-xs text-[var(--text-500)]">共 {invocationTotal} 条</span>
              </div>
              <button
                onClick={loadInvocations}
                className="text-[var(--text-500)] hover:text-[var(--state-warning)]"
              >
                {invocationsLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-3 border-b border-[color:var(--border)] p-3">
              <select
                value={toolFilter}
                onChange={(event) => setToolFilter(event.target.value)}
                className="rounded-lg border border-[color:var(--input)] bg-[var(--background-50)] px-3 py-2 text-xs text-[var(--text-800)] focus:border-[color:var(--brand-500)] focus:outline-none"
              >
                <option value="">全部 Tool</option>
                {tools.map((tool) => (
                  <option key={tool.name} value={tool.name}>
                    {tool.name}
                  </option>
                ))}
              </select>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="rounded-lg border border-[color:var(--input)] bg-[var(--background-50)] px-3 py-2 text-xs text-[var(--text-800)] focus:border-[color:var(--brand-500)] focus:outline-none"
              >
                <option value="">全部状态</option>
                <option value="success">success</option>
                <option value="failed">failed</option>
              </select>
              <input
                value={requestFilter}
                onChange={(event) => setRequestFilter(event.target.value)}
                placeholder="request_id"
                className="rounded-lg border border-[color:var(--input)] bg-[var(--background-50)] px-3 py-2 text-xs text-[var(--text-800)] focus:border-[color:var(--brand-500)] focus:outline-none"
              />
              <button
                onClick={loadInvocations}
                className="rounded-lg border border-[color:var(--state-warning-border)] bg-[var(--state-warning-surface)] px-3 py-2 text-xs text-[var(--state-warning)] transition-colors hover:bg-[color:var(--state-warning-border)]"
              >
                查询
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[color:var(--border)] text-[var(--text-500)]">
                    <th scope="col" className="px-4 py-3 text-left">时间</th>
                    <th scope="col" className="px-4 py-3 text-left">Tool</th>
                    <th scope="col" className="px-4 py-3 text-left">request_id</th>
                    <th scope="col" className="px-4 py-3 text-left">幂等键</th>
                    <th scope="col" className="px-4 py-3 text-left">状态</th>
                    <th scope="col" className="px-4 py-3 text-right">耗时</th>
                  </tr>
                </thead>
                <tbody>
                  {invocations.map((item) => (
                    <tr
                      key={item.id}
                      onClick={() => showInvocationDetail(item.id)}
                      className="cursor-pointer border-b border-[color:var(--border)] hover:bg-[var(--background-100)]"
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-[var(--text-500)]">
                        {new Date(item.createdAt).toLocaleString('zh-CN')}
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--text-700)]">
                        {item.toolName}
                      </td>
                      <td className="max-w-[180px] truncate px-4 py-3 text-xs text-[var(--text-500)]">
                        {item.requestId || '-'}
                      </td>
                      <td className="max-w-[180px] truncate px-4 py-3 text-xs text-[var(--text-500)]">
                        {item.idempotencyKey || '-'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded border px-2 py-0.5 text-xs ${statusClass(item.status)}`}>
                          {item.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-[var(--text-500)]">
                        {item.durationMs ?? '-'} ms
                      </td>
                    </tr>
                  ))}
                  {invocations.length === 0 && (
                    <tr>
                      <td className="py-10 text-center text-sm text-[var(--text-500)]" colSpan={6}>
                        暂无调用记录
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {detail && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
          role="dialog"
          aria-modal="true"
          aria-label="MCP 调用详情"
        >
          <div
            ref={detailDialogRef}
            className="max-h-[86vh] w-full max-w-4xl overflow-hidden rounded-xl border border-[color:var(--border)] bg-[var(--background-50)]"
          >
            <div className="flex items-center justify-between border-b border-[color:var(--border)] px-5 py-4">
              <div>
                <p className="font-bold">{detail.toolName}</p>
                <p className="text-xs text-[var(--text-500)]">{detail.id}</p>
              </div>
              <button
                onClick={() => setDetail(null)}
                aria-label="关闭调用详情"
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-[var(--text-500)] hover:bg-[var(--background-100)] hover:text-[var(--text-700)]"
              >
                <XCircle className="h-5 w-5" />
              </button>
            </div>
            <div className="grid max-h-[72vh] grid-cols-1 overflow-auto lg:grid-cols-2">
              <div className="border-r border-[color:var(--border)]">
                <div className="border-b border-[color:var(--border)] px-4 py-2 text-xs text-[var(--text-500)]">
                  input_json
                </div>
                <pre className="whitespace-pre-wrap p-4 font-mono text-xs text-[var(--text-700)]">
                  {stringifyJson(detail.inputJson)}
                </pre>
              </div>
              <div>
                <div className="border-b border-[color:var(--border)] px-4 py-2 text-xs text-[var(--text-500)]">
                  output_json
                </div>
                <pre className="whitespace-pre-wrap p-4 font-mono text-xs text-[var(--text-700)]">
                  {stringifyJson(detail.outputJson)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
