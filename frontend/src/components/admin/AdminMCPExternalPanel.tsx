import { useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  FileJson,
  Globe2,
  Loader2,
  Play,
  RefreshCw,
  Send,
  Wand2,
  XCircle,
} from 'lucide-react';
import {
  callAdminMCPExternalTool,
  fetchAdminMCPExternalTools,
  type AdminMCPExternalConnection,
  type AdminMCPExternalExchange,
  type AdminMCPExternalTool,
} from '../../api/adminMcpApi';

type AuthMode = NonNullable<AdminMCPExternalConnection['authMode']>;
type JsonObject = Record<string, unknown>;

const requestId = () => `external-debug-${Date.now()}`;

function stringifyJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function asRecord(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function sampleFromSchema(schema: JsonObject | null, depth = 0): unknown {
  if (!schema) return '';

  const enumValues = Array.isArray(schema.enum) ? schema.enum : null;
  if (enumValues?.length) return enumValues[0];

  const rawType = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (rawType === 'integer' || rawType === 'number') return 0;
  if (rawType === 'boolean') return false;
  if (rawType === 'array') return [];
  if (rawType === 'object') {
    if (depth > 2) return {};
    const properties = asRecord(schema.properties);
    if (!properties) return {};
    const value: JsonObject = {};
    for (const [key, childSchema] of Object.entries(properties).slice(0, 12)) {
      value[key] = sampleFromSchema(asRecord(childSchema), depth + 1);
    }
    return value;
  }
  return '';
}

function sampleExternalArguments(tool?: AdminMCPExternalTool) {
  const schema = asRecord(tool?.inputSchema);
  const properties = asRecord(schema?.properties);
  if (!properties) return {};

  const sample: JsonObject = {};
  for (const [key, childSchema] of Object.entries(properties).slice(0, 12)) {
    sample[key] = sampleFromSchema(asRecord(childSchema));
  }
  return sample;
}

function statusClass(ok?: boolean) {
  if (ok === true)
    return 'text-[var(--state-success-text)] bg-[var(--state-success-surface)] border-[color:var(--state-success-border)]';
  if (ok === false)
    return 'text-[var(--state-error)] bg-[var(--state-error-surface)] border-[color:var(--state-error-border)]';
  return 'text-[var(--text-600)] bg-[var(--background-100)] border-[color:var(--border)]';
}

function parseHeaders(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return {};

  const parsed = JSON.parse(trimmed) as unknown;
  const record = asRecord(parsed);
  if (!record) {
    throw new Error('自定义 Headers 必须是 JSON 对象');
  }

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key.trim()) headers[key.trim()] = String(value);
  }
  return headers;
}

export default function AdminMCPExternalPanel() {
  const [endpoint, setEndpoint] = useState('');
  const [authMode, setAuthMode] = useState<AuthMode>('none');
  const [bearerToken, setBearerToken] = useState('');
  const [headersText, setHeadersText] = useState('{\n  "X-API-Key": ""\n}');
  const [timeoutMs, setTimeoutMs] = useState(10000);
  const [tools, setTools] = useState<AdminMCPExternalTool[]>([]);
  const [selectedName, setSelectedName] = useState('');
  const [argsText, setArgsText] = useState('{}');
  const [response, setResponse] = useState<AdminMCPExternalExchange | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [calling, setCalling] = useState(false);
  const [error, setError] = useState('');

  const selectedTool = useMemo(
    () => tools.find((tool) => tool.name === selectedName),
    [selectedName, tools],
  );

  const buildConnection = (): AdminMCPExternalConnection => {
    if (!endpoint.trim()) {
      throw new Error('请输入外部 MCP Endpoint');
    }

    const connection: AdminMCPExternalConnection = {
      endpoint: endpoint.trim(),
      authMode,
      timeoutMs,
    };

    if (authMode === 'bearer') {
      connection.bearerToken = bearerToken.trim();
    }

    if (authMode === 'headers') {
      connection.headers = parseHeaders(headersText);
    }

    return connection;
  };

  const discoverTools = async () => {
    setDiscovering(true);
    setError('');
    setResponse(null);
    try {
      const data = await fetchAdminMCPExternalTools({
        ...buildConnection(),
        id: requestId(),
      });
      const discoveredTools = data.tools || [];
      setTools(discoveredTools);
      setResponse(data);
      if (discoveredTools.length > 0) {
        setSelectedName(discoveredTools[0].name);
        setArgsText(stringifyJson(sampleExternalArguments(discoveredTools[0])));
      } else {
        setSelectedName('');
        setArgsText('{}');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '外部 Tool 发现失败');
    } finally {
      setDiscovering(false);
    }
  };

  const selectTool = (tool: AdminMCPExternalTool) => {
    setSelectedName(tool.name);
    setArgsText(stringifyJson(sampleExternalArguments(tool)));
    setError('');
  };

  const formatArgs = () => {
    try {
      setArgsText(stringifyJson(JSON.parse(argsText)));
      setError('');
    } catch {
      setError('调用参数不是合法 JSON');
    }
  };

  const formatHeaders = () => {
    try {
      setHeadersText(stringifyJson(parseHeaders(headersText)));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Headers 格式不正确');
    }
  };

  const resetArgs = () => {
    setArgsText(stringifyJson(sampleExternalArguments(selectedTool)));
    setError('');
  };

  const callTool = async () => {
    if (!selectedTool) return;
    setCalling(true);
    setError('');
    setResponse(null);
    try {
      const args = JSON.parse(argsText) as Record<string, unknown>;
      const data = await callAdminMCPExternalTool({
        ...buildConnection(),
        name: selectedTool.name,
        arguments: args,
        id: requestId(),
      });
      setResponse(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '外部 Tool 调用失败');
    } finally {
      setCalling(false);
    }
  };

  const copyResponse = () => {
    if (!response) return;
    void navigator.clipboard?.writeText(stringifyJson(response));
  };

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-[color:var(--border)] bg-[var(--background-50)] p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <Globe2 className="h-5 w-5 text-[var(--brand-600)]" />
            <div>
              <h2 className="text-base font-bold text-[var(--text-900)]">外部 MCP 应用</h2>
              <p className="mt-1 text-xs text-[var(--text-500)]">
                当前平台连接外部应用，调试外部 MCP Endpoint 的 tools/list 与 tools/call。
              </p>
            </div>
          </div>
          <button
            onClick={discoverTools}
            disabled={discovering}
            className="flex items-center justify-center gap-2 rounded-lg bg-[var(--brand-500)] px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-[var(--brand-strong)] disabled:opacity-50"
          >
            {discovering ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            发现 Tool
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_150px_130px]">
          <input
            value={endpoint}
            onChange={(event) => setEndpoint(event.target.value)}
            placeholder="https://external-app.example.com/mcp"
            className="rounded-lg border border-[color:var(--input)] bg-[var(--background-50)] px-3 py-2 text-sm text-[var(--text-800)] focus:border-[color:var(--brand-500)] focus:outline-none"
          />
          <select
            value={authMode}
            onChange={(event) => setAuthMode(event.target.value as AuthMode)}
            className="rounded-lg border border-[color:var(--input)] bg-[var(--background-50)] px-3 py-2 text-sm text-[var(--text-800)] focus:border-[color:var(--brand-500)] focus:outline-none"
          >
            <option value="none">无鉴权</option>
            <option value="bearer">Bearer Token</option>
            <option value="headers">自定义 Headers</option>
          </select>
          <input
            type="number"
            value={timeoutMs}
            min={1000}
            max={30000}
            step={1000}
            onChange={(event) => setTimeoutMs(Number(event.target.value))}
            className="rounded-lg border border-[color:var(--input)] bg-[var(--background-50)] px-3 py-2 text-sm text-[var(--text-800)] focus:border-[color:var(--brand-500)] focus:outline-none"
            title="超时时间，毫秒"
          />
        </div>

        {authMode === 'bearer' && (
          <input
            value={bearerToken}
            onChange={(event) => setBearerToken(event.target.value)}
            placeholder="Bearer token"
            type="password"
            className="mt-3 w-full rounded-lg border border-[color:var(--input)] bg-[var(--background-50)] px-3 py-2 text-sm text-[var(--text-800)] focus:border-[color:var(--brand-500)] focus:outline-none"
          />
        )}

        {authMode === 'headers' && (
          <div className="mt-3 overflow-hidden rounded-lg border border-[color:var(--border)] bg-[var(--background-100)]">
            <div className="flex items-center justify-between border-b border-[color:var(--border)] px-3 py-2">
              <span className="text-xs text-[var(--text-500)]">Headers JSON</span>
              <button
                onClick={formatHeaders}
                className="p-1 text-[var(--text-500)] hover:text-[var(--brand-600)]"
                title="格式化 Headers"
              >
                <FileJson className="h-4 w-4" />
              </button>
            </div>
            <textarea
              value={headersText}
              onChange={(event) => setHeadersText(event.target.value)}
              spellCheck={false}
              className="h-24 w-full resize-none bg-[var(--background-50)] p-3 font-mono text-xs text-[var(--text-800)] focus:outline-none focus:ring-1 focus:ring-[color:var(--brand-500)]"
            />
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-[color:var(--state-error-border)] bg-[var(--state-error-surface)] px-4 py-3 text-sm text-[var(--state-error)]">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[320px_1fr]">
        <div className="overflow-hidden rounded-xl border border-[color:var(--border)] bg-[var(--background-50)]">
          <div className="flex items-center justify-between border-b border-[color:var(--border)] px-4 py-3">
            <div className="flex items-center gap-2">
              <Send className="h-4 w-4 text-[var(--brand-600)]" />
              <span className="text-sm font-bold">外部 Tool</span>
              <span className="text-xs text-[var(--text-500)]">{tools.length}</span>
            </div>
            <span className={`rounded border px-2 py-0.5 text-xs ${statusClass(response?.ok)}`}>
              {response ? (response.ok ? 'connected' : 'failed') : 'idle'}
            </span>
          </div>
          <div className="max-h-[560px] overflow-y-auto">
            {tools.map((tool) => (
              <button
                key={tool.name}
                onClick={() => selectTool(tool)}
                title={`${tool.name}\n${tool.description || ''}`}
                className={`w-full border-b border-[color:var(--border)] px-4 py-3 text-left transition-colors hover:bg-[var(--background-100)] ${
                  selectedName === tool.name ? 'bg-[var(--brand-50)]' : ''
                }`}
              >
                <div className="break-all text-sm text-[var(--text-800)]">{tool.name}</div>
                <p className="mt-1 line-clamp-2 text-xs text-[var(--text-500)]">
                  {tool.description || '无说明'}
                </p>
              </button>
            ))}
            {tools.length === 0 && (
              <div className="px-4 py-10 text-center text-sm text-[var(--text-500)]">
                未发现外部 Tool
              </div>
            )}
          </div>
        </div>

        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className="overflow-hidden rounded-xl border border-[color:var(--border)] bg-[var(--background-50)]">
              <div className="flex items-center justify-between border-b border-[color:var(--border)] px-4 py-3">
                <div>
                  <p className="text-sm font-bold">{selectedTool?.name || '未选择外部 Tool'}</p>
                  <p className="mt-1 text-xs text-[var(--text-500)]">JSON-RPC tools/call</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={resetArgs}
                    className="p-2 text-[var(--text-500)] hover:text-[var(--brand-600)]"
                    title="按 Schema 生成参数"
                  >
                    <Wand2 className="h-4 w-4" />
                  </button>
                  <button
                    onClick={formatArgs}
                    className="p-2 text-[var(--text-500)] hover:text-[var(--brand-600)]"
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
                  参数来源于外部 Tool inputSchema
                </span>
                <button
                  onClick={callTool}
                  disabled={!selectedTool || calling}
                  className="flex items-center gap-2 rounded-lg bg-[var(--brand-500)] px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-[var(--brand-strong)] disabled:opacity-50"
                >
                  {calling ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  调用外部
                </button>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-[color:var(--border)] bg-[var(--background-50)]">
              <div className="flex items-center justify-between border-b border-[color:var(--border)] px-4 py-3">
                <div className="flex items-center gap-2">
                  {response?.ok ? (
                    <CheckCircle2 className="h-4 w-4 text-[var(--state-success-text)]" />
                  ) : response ? (
                    <XCircle className="h-4 w-4 text-[var(--state-error)]" />
                  ) : (
                    <Globe2 className="h-4 w-4 text-[var(--brand-600)]" />
                  )}
                  <span className="text-sm font-bold">外部响应</span>
                </div>
                <button
                  onClick={copyResponse}
                  disabled={!response}
                  className="p-2 text-[var(--text-500)] hover:text-[var(--brand-600)] disabled:opacity-30"
                  title="复制"
                >
                  <Copy className="h-4 w-4" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3 border-b border-[color:var(--border)] p-4 text-xs">
                <div>
                  <p className="mb-1 text-[var(--text-500)]">连接状态</p>
                  <span className={`rounded border px-2 py-1 ${statusClass(response?.ok)}`}>
                    {response ? (response.ok ? 'success' : 'failed') : '-'}
                  </span>
                </div>
                <div>
                  <p className="mb-1 text-[var(--text-500)]">HTTP</p>
                  <p className="text-[var(--text-700)]">{response?.statusCode ?? '-'}</p>
                </div>
                <div>
                  <p className="mb-1 text-[var(--text-500)]">耗时</p>
                  <p className="text-[var(--text-700)]">{response?.durationMs ?? '-'} ms</p>
                </div>
                <div>
                  <p className="mb-1 text-[var(--text-500)]">Content-Type</p>
                  <p className="truncate text-[var(--text-700)]">{response?.contentType || '-'}</p>
                </div>
              </div>
              <pre className="h-[254px] overflow-auto bg-[var(--background-100)] p-4 font-mono text-xs text-[var(--text-700)]">
                {response ? stringifyJson(response) : '暂无响应'}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
