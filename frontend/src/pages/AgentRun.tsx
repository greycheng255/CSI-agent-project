import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Copy,
  ExternalLink,
  FolderOpen,
  Loader2,
  Star,
  Zap,
} from 'lucide-react';
import {
  createAgentTask,
  findCompatibleModels,
  findWorkflowDefinition,
  getAgentTaskStatus,
  isCatalogItemRunnable,
  loadAgentDirectory,
  type AgentDirectory,
  type AgentParamMap,
  type AgentParamOption,
  type AgentParamSchema,
  type AgentTaskStatus,
} from '../api/agentMarketApi';
import { AGENT_STYLE, getCatalogItem } from '../data/agentMarketCatalog';
import {
  AgentSpecificPanel,
  resolveAgentMarketPlugin,
} from '../features/agent-market/plugins/registry';

const CONTEXT_KEY = 'genesis-agent-market-context';

const FIELD_LABELS: Record<string, string> = {
  sourceMaterial: '素材内容',
  cardStyle: '卡片类型',
  count: '生成数量',
  layout: '布局',
  depth: '展开层级',
  style: '风格',
  duration: '时长',
  hostVoice: '主持人音色',
  guestVoice: '嘉宾音色',
  text: '票据文本',
  imageUrls: '图片 URL',
  pdfUrl: 'PDF URL',
  pdfName: 'PDF 文件名',
  categoryHint: '类别提示',
  imageUrl: '图片 URL',
  audioUrl: '音频 URL',
  resolution: '分辨率',
  videoType: '视频类型',
  prompt: '提示词',
  firstFrameUrl: '首帧 URL',
  lastFrameUrl: '尾帧 URL',
  size: '画幅/尺寸',
  shotType: '镜头类型',
  referenceUrls: '参考素材 URL',
  audio: '生成声音',
  images: '参考图片 URL',
  image_url: '参考图片 URL',
  quality: '质量',
  voice: '音色',
  format: '格式',
  tags: '风格标签',
  is_music: '音乐模式',
  aspect_ratio: '画面比例',
  duration_s: '视频秒数',
  preview_only: '先生成预览',
  visual_preset: '视觉预设',
  include_bgm: '包含配乐',
};

type ContextState = {
  workspaceId: string;
  tenantId: string;
  userId: string;
};

type NormalizedOption = {
  value: string;
  label: string;
};

function contextKeyFor(providerId?: string) {
  return providerId ? `${CONTEXT_KEY}:${providerId}` : CONTEXT_KEY;
}

function readStoredContext(
  key = CONTEXT_KEY,
  defaults: Partial<ContextState> = {},
): ContextState {
  const fallback = {
    workspaceId: defaults.workspaceId || '',
    tenantId: defaults.tenantId || '',
    userId: defaults.userId || '',
  };
  if (typeof window === 'undefined') return fallback;

  try {
    const raw =
      window.localStorage.getItem(key) ||
      (key !== CONTEXT_KEY ? window.localStorage.getItem(CONTEXT_KEY) : null);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<ContextState>;
    return {
      workspaceId:
        typeof parsed.workspaceId === 'string' && parsed.workspaceId.trim()
          ? parsed.workspaceId
          : fallback.workspaceId,
      tenantId:
        typeof parsed.tenantId === 'string' && parsed.tenantId.trim()
          ? parsed.tenantId
          : fallback.tenantId,
      userId:
        typeof parsed.userId === 'string' && parsed.userId.trim()
          ? parsed.userId
          : fallback.userId,
    };
  } catch {
    return fallback;
  }
}

function labelFor(name: string, schema?: AgentParamSchema) {
  return schema?.label || FIELD_LABELS[name] || name;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function optionToString(value: unknown) {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

function normalizeOption(option: AgentParamOption): NormalizedOption {
  if (isRecord(option)) {
    const value = optionToString(option.value ?? option.label);
    const label = optionToString(option.label ?? option.value) || value;
    return { value, label };
  }

  return { value: String(option), label: String(option) };
}

function defaultValueFor(schema: AgentParamSchema) {
  if (Array.isArray(schema.default)) return schema.default.map(String).join('\n');
  if (schema.default !== undefined) return String(schema.default);
  if (schema.options?.length) return normalizeOption(schema.options[0]).value;
  if (schema.type === 'boolean') return 'false';
  return '';
}

function buildInitialValues(params?: AgentParamMap) {
  return Object.fromEntries(
    Object.entries(params || {}).map(([name, schema]) => [name, defaultValueFor(schema)]),
  );
}

function parseList(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {
      return [trimmed];
    }
  }

  return trimmed
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeValue(name: string, schema: AgentParamSchema, raw: string) {
  const type = schema.type?.toLowerCase() || 'string';

  if (type === 'number') {
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? numeric : raw;
  }

  if (type === 'boolean' || type === 'switch') {
    return raw === 'true';
  }

  if (type === 'array') {
    return parseList(raw);
  }

  if (type === 'upload') {
    const urls = parseList(raw);
    const lowerName = name.toLowerCase();
    if (lowerName.endsWith('url') || lowerName.endsWith('_url')) return urls[0] || '';
    return urls;
  }

  return raw;
}

function normalizeParams(params: AgentParamMap, values: Record<string, string>, skipPrompt: boolean) {
  const normalized: Record<string, unknown> = {};

  Object.entries(params).forEach(([name, schema]) => {
    if (skipPrompt && name === 'prompt') return;
    const raw = values[name] ?? '';
    const isBoolean = schema.type?.toLowerCase() === 'boolean' || schema.type?.toLowerCase() === 'switch';
    if (!raw.trim() && !isBoolean) return;
    normalized[name] = normalizeValue(name, schema, raw);
  });

  Object.entries(values).forEach(([name, raw]) => {
    if (name in params || !raw.trim()) return;
    normalized[name] = raw.includes('\n') ? parseList(raw) : raw;
  });

  return normalized;
}

function getProgressNumber(status: AgentTaskStatus | null) {
  if (!status?.progress) return 0;
  if (typeof status.progress === 'number') return Math.max(0, Math.min(100, status.progress));
  const parsed = Number(status.progress.replace('%', ''));
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 0;
}

function jsonText(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function pickResultUrl(status: AgentTaskStatus) {
  if (status.result_url) return status.result_url;
  if (!isRecord(status.result_data)) return '';

  const values = [
    status.result_data.image_url,
    status.result_data.imageUrl,
    status.result_data.video_url,
    status.result_data.videoUrl,
    status.result_data.audio_url,
    status.result_data.audioUrl,
  ];

  return values.find((value): value is string => typeof value === 'string' && value.length > 0) || '';
}

function detectMediaKind(status: AgentTaskStatus, resultUrl: string) {
  const type = (status.result_type || '').toLowerCase();
  const url = resultUrl.toLowerCase();

  if (type.includes('image') || /\.(png|jpe?g|webp|gif)(\?|$)/.test(url)) return 'image';
  if (type.includes('video') || type.includes('digihuman') || /\.(mp4|webm|mov)(\?|$)/.test(url)) {
    return 'video';
  }
  if (type.includes('audio') || type.includes('music') || type.includes('podcast') || /\.(mp3|wav|m4a|ogg)(\?|$)/.test(url)) {
    return 'audio';
  }

  return 'link';
}

function validateRequiredParams(params: AgentParamMap, values: Record<string, string>, skipPrompt: boolean) {
  for (const [name, schema] of Object.entries(params)) {
    if (skipPrompt && name === 'prompt') continue;
    if (schema.required && !(values[name] || '').trim()) {
      return `请填写 ${labelFor(name, schema)}`;
    }
  }

  return '';
}

function StatusPanel({
  taskId,
  status,
  error,
  polling,
}: {
  taskId: string;
  status: AgentTaskStatus | null;
  error: string;
  polling: boolean;
}) {
  const progress = getProgressNumber(status);

  return (
    <div className="rounded-xl border border-gray-800 bg-black p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.2em] text-gray-600">任务状态</div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-300">
            <span className="font-mono text-green-400">{taskId}</span>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(taskId)}
              className="rounded border border-gray-800 p-1 text-gray-500 hover:text-green-400"
              aria-label="复制任务 ID"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <span className="inline-flex items-center gap-2 rounded border border-green-500/20 bg-green-500/10 px-3 py-1 text-xs font-bold text-green-400">
          {polling && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {status?.status || 'submitted'}
        </span>
      </div>

      <div className="mt-5">
        <div className="mb-2 flex justify-between text-xs text-gray-600">
          <span>{status?.current_step || 'waiting'}</span>
          <span>{progress}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-gray-900">
          <div className="h-full rounded-full bg-green-500 transition-all" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {typeof status?.cost === 'number' && (
        <div className="mt-3 text-xs text-gray-500">
          预计/实际消耗：<span className="font-mono text-yellow-400">{status.cost}</span> credits
        </div>
      )}

      {(error || status?.error) && (
        <div className="mt-4 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
          {error || status?.error}
        </div>
      )}
    </div>
  );
}

function TreeView({ node, depth = 0 }: { node: unknown; depth?: number }) {
  if (!isRecord(node)) return null;

  const data = isRecord(node.data) ? node.data : {};
  const label =
    (typeof data.label === 'string' && data.label) ||
    (typeof node.label === 'string' && node.label) ||
    (typeof node.title === 'string' && node.title) ||
    '未命名节点';
  const children = Array.isArray(node.children) ? node.children : [];

  return (
    <div className={depth === 0 ? '' : 'ml-4 border-l border-gray-800 pl-4'}>
      <div className="rounded border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-300">
        {label}
      </div>
      {children.length > 0 && (
        <div className="mt-2 space-y-2">
          {children.map((child, index) => (
            <TreeView key={index} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function StructuredResult({ data }: { data: unknown }) {
  if (!isRecord(data)) {
    return (
      <pre className="max-h-[520px] overflow-auto rounded-lg border border-gray-800 bg-black p-4 text-xs text-gray-300">
        {jsonText(data)}
      </pre>
    );
  }

  if (Array.isArray(data.cards)) {
    return (
      <div className="space-y-3">
        {data.cards.map((card, index) => {
          const item = isRecord(card) ? card : {};
          return (
            <div key={index} className="rounded-lg border border-gray-800 bg-black p-4">
              <div className="text-sm font-bold text-gray-100">{String(item.front || `卡片 ${index + 1}`)}</div>
              <div className="mt-2 text-sm leading-6 text-gray-400">{String(item.back || '')}</div>
              {Boolean(item.tag) && <div className="mt-3 text-xs text-cyan-400">{String(item.tag)}</div>}
            </div>
          );
        })}
      </div>
    );
  }

  if (data.tree) {
    return <TreeView node={data.tree} />;
  }

  if (isRecord(data.invoice)) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-gray-800 bg-black p-4">
          <div className="mb-3 text-sm font-bold text-gray-100">发票主表</div>
          <pre className="overflow-auto text-xs text-gray-300">{jsonText(data.invoice)}</pre>
        </div>
        {Array.isArray(data.items) && (
          <div className="rounded-lg border border-gray-800 bg-black p-4">
            <div className="mb-3 text-sm font-bold text-gray-100">明细</div>
            <pre className="overflow-auto text-xs text-gray-300">{jsonText(data.items)}</pre>
          </div>
        )}
      </div>
    );
  }

  if (Array.isArray(data.script) || Array.isArray(data.timeline)) {
    const rows: unknown[] = Array.isArray(data.script)
      ? data.script
      : Array.isArray(data.timeline)
        ? data.timeline
        : [];
    return (
      <div className="space-y-3">
        {rows.map((row, index) => (
          <div key={index} className="rounded-lg border border-gray-800 bg-black p-4 text-sm leading-6 text-gray-300">
            {isRecord(row) ? jsonText(row) : String(row)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <pre className="max-h-[520px] overflow-auto rounded-lg border border-gray-800 bg-black p-4 text-xs text-gray-300">
      {jsonText(data)}
    </pre>
  );
}

function ResultPanel({ status }: { status: AgentTaskStatus }) {
  const resultUrl = pickResultUrl(status);
  const kind = resultUrl ? detectMediaKind(status, resultUrl) : 'structured';

  return (
    <div className="rounded-xl border border-gray-800 bg-[#0a0a0a] p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.2em] text-gray-600">执行结果</div>
          <h3 className="mt-1 text-lg font-bold text-gray-100">生成完成</h3>
        </div>
        <CheckCircle2 className="h-5 w-5 text-green-400" />
      </div>

      {kind === 'image' && <img src={resultUrl} alt="生成结果" className="w-full rounded-lg border border-gray-800" />}
      {kind === 'video' && <video src={resultUrl} controls className="w-full rounded-lg border border-gray-800 bg-black" />}
      {kind === 'audio' && <audio src={resultUrl} controls className="w-full" />}
      {kind === 'link' && (
        <a
          href={resultUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-2 text-sm font-bold text-green-400"
        >
          打开结果
          <ExternalLink className="h-4 w-4" />
        </a>
      )}

      {status.result_data !== null && status.result_data !== undefined && (
        <div className={resultUrl ? 'mt-5' : ''}>
          <StructuredResult data={status.result_data} />
        </div>
      )}
    </div>
  );
}

export default function AgentRun() {
  const { id } = useParams();
  const agent = id ? getCatalogItem(id) : null;
  const bootstrapPlugin = useMemo(() => {
    return agent ? resolveAgentMarketPlugin({ agentId: agent.id, agent }) : null;
  }, [agent]);
  const bootstrapProvider = bootstrapPlugin?.manifest.provider;
  const contextStorageKey = contextKeyFor(bootstrapProvider?.id);
  const [directory, setDirectory] = useState<AgentDirectory | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [context, setContext] = useState<ContextState>(() => readStoredContext());
  const [selectedModelName, setSelectedModelName] = useState('');
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [prompt, setPrompt] = useState('');
  const [count, setCount] = useState('1');
  const [taskId, setTaskId] = useState('');
  const [status, setStatus] = useState<AgentTaskStatus | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [polling, setPolling] = useState(false);
  const [runError, setRunError] = useState('');

  useEffect(() => {
    let cancelled = false;

    if (!agent) {
      setDirectory(null);
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setLoading(true);
    loadAgentDirectory(bootstrapProvider)
      .then((data) => {
        if (cancelled) return;
        setDirectory(data);
        setLoadError(data.error || '');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : '加载智能体目录失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [agent, bootstrapProvider]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(contextStorageKey, JSON.stringify(context));
  }, [context, contextStorageKey]);

  useEffect(() => {
    setContext(
      readStoredContext(contextStorageKey, {
        workspaceId: bootstrapProvider?.defaultWorkspaceId,
        tenantId: bootstrapProvider?.defaultTenantId,
        userId: bootstrapProvider?.defaultUserId,
      }),
    );
  }, [
    bootstrapProvider?.defaultTenantId,
    bootstrapProvider?.defaultUserId,
    bootstrapProvider?.defaultWorkspaceId,
    contextStorageKey,
  ]);

  const compatibleModels = useMemo(() => {
    if (!agent || !directory || agent.capability.kind !== 'media') return [];
    return findCompatibleModels(directory, agent.capability.mediaTypes);
  }, [agent, directory]);

  const workflowDefinition = useMemo(() => {
    if (!agent || !directory || agent.capability.kind !== 'workflow') return null;
    return findWorkflowDefinition(directory, agent.capability.workflowType);
  }, [agent, directory]);

  const selectedModel = useMemo(() => {
    return compatibleModels.find((model) => model.name === selectedModelName) || compatibleModels[0] || null;
  }, [compatibleModels, selectedModelName]);

  const currentParams = useMemo<AgentParamMap>(() => {
    if (agent?.capability.kind === 'workflow') return workflowDefinition?.params || {};
    if (agent?.capability.kind === 'media') return selectedModel?.params || {};
    return {};
  }, [agent?.capability.kind, selectedModel?.params, workflowDefinition?.params]);

  const runnable = Boolean(agent && directory && isCatalogItemRunnable(agent, directory));
  const activePlugin = useMemo(() => {
    return agent
      ? resolveAgentMarketPlugin({
          agentId: agent.id,
          agent,
          workflowDefinition,
          compatibleModels,
          selectedModel,
        })
      : null;
  }, [agent, compatibleModels, selectedModel, workflowDefinition]);
  const activeProvider = activePlugin?.manifest.provider || bootstrapProvider;

  useEffect(() => {
    if (!agent || agent.capability.kind !== 'media' || compatibleModels.length === 0) return;
    const preferred = agent.capability.preferredModel;
    const nextModel =
      compatibleModels.find((model) => model.name === preferred)?.name || compatibleModels[0].name;
    setSelectedModelName((current) =>
      compatibleModels.some((model) => model.name === current) ? current : nextModel,
    );
  }, [agent, compatibleModels]);

  useEffect(() => {
    setFormValues(buildInitialValues(currentParams));
    setPrompt('');
  }, [currentParams]);

  const updateField = useCallback((name: string, value: string) => {
    setFormValues((current) => ({ ...current, [name]: value }));
  }, []);

  const handleSubmit = async () => {
    if (!agent || !directory || !runnable) return;

    const workspaceId = context.workspaceId.trim();
    const tenantId = context.tenantId.trim();
    const userId = context.userId.trim();
    if (!workspaceId) {
      setRunError('请先填写 workspaceId。');
      return;
    }

    const skipPrompt = agent.capability.kind === 'media';
    const requiredError = validateRequiredParams(currentParams, formValues, skipPrompt);
    if (requiredError) {
      setRunError(requiredError);
      return;
    }

    if (agent.capability.kind === 'media' && !prompt.trim()) {
      setRunError('请填写提示词。');
      return;
    }

    const parsedCount = Number(count);
    setSubmitting(true);
    setRunError('');
    setTaskId('');
    setStatus(null);

    try {
      if (agent.capability.kind === 'workflow') {
        const params = normalizeParams(currentParams, formValues, false);
        const newTaskId = await createAgentTask({
          type: agent.capability.workflowType,
          params,
          workspaceId,
          tenantId: tenantId || undefined,
          userId: userId || undefined,
          count: Number.isFinite(parsedCount) ? parsedCount : 1,
        }, activeProvider);
        setTaskId(newTaskId);
      }

      if (agent.capability.kind === 'media') {
        const params = normalizeParams(currentParams, formValues, true);
        const type = selectedModel?.type;
        const newTaskId = await createAgentTask({
          type,
          model: selectedModelName,
          prompt: prompt.trim(),
          params,
          workspaceId,
          tenantId: tenantId || undefined,
          userId: userId || undefined,
          count: Number.isFinite(parsedCount) ? parsedCount : 1,
        }, activeProvider);
        setTaskId(newTaskId);
      }
    } catch (err: unknown) {
      setRunError(err instanceof Error ? err.message : '提交任务失败');
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (!taskId || status?.is_final) return;

    let cancelled = false;
    const poll = async () => {
      setPolling(true);
      try {
        const next = await getAgentTaskStatus(taskId, activeProvider);
        if (!cancelled) setStatus(next);
      } catch (err: unknown) {
        if (!cancelled) setRunError(err instanceof Error ? err.message : '查询任务状态失败');
      } finally {
        if (!cancelled) setPolling(false);
      }
    };

    poll();
    const timer = window.setInterval(poll, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeProvider, status?.is_final, taskId]);

  if (!agent) {
    return (
      <div className="mx-auto max-w-3xl rounded-xl border border-gray-800 bg-[#0a0a0a] p-8 text-center">
        <h1 className="m-0 text-2xl font-bold text-gray-100">未找到智能体</h1>
        <Link to="/agent-market" className="mt-6 inline-flex text-green-400">
          返回集市
        </Link>
      </div>
    );
  }

  const style = AGENT_STYLE[agent.color];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <Link
        to="/agent-market"
        className="inline-flex items-center gap-2 rounded-lg border border-gray-800 bg-[#0a0a0a] px-4 py-2 text-sm font-bold text-gray-300 hover:border-green-500 hover:text-green-400"
      >
        <ArrowLeft className="h-4 w-4" />
        返回集市
      </Link>

      <div className="rounded-xl border border-gray-800 bg-[#0a0a0a] p-6">
        <div className="grid gap-5 lg:grid-cols-[auto_1fr_auto] lg:items-center">
          <div
            className="flex h-20 w-20 items-center justify-center rounded-2xl border text-4xl"
            style={{ background: style.bg, borderColor: style.border }}
          >
            {agent.icon}
          </div>
          <div>
            <h1 className="m-0 text-3xl font-bold text-gray-100">{agent.name}</h1>
            <p className="mt-2 text-gray-500">{agent.desc}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {agent.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded border px-2 py-1 text-xs font-bold"
                  style={{ color: style.text, background: style.bg, borderColor: style.border }}
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-gray-800 bg-black p-4">
              <Star className="h-4 w-4" style={{ color: style.text }} />
              <div className="mt-2 text-2xl font-bold text-gray-100">{agent.rating.toFixed(1)}</div>
              <div className="text-xs text-gray-600">评分</div>
            </div>
            <div className="rounded-xl border border-gray-800 bg-black p-4">
              <Zap className="h-4 w-4" style={{ color: style.text }} />
              <div className="mt-2 text-2xl font-bold text-gray-100">{agent.calls.toLocaleString()}</div>
              <div className="text-xs text-gray-600">调用</div>
            </div>
          </div>
        </div>
      </div>

      {loadError && (
        <div className="flex items-start gap-3 rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-4 text-sm text-yellow-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-bold">第三方目录加载不完整，正在使用 fallback schema。</div>
            <div className="mt-1 text-yellow-200/70">{loadError}</div>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-gray-800 bg-[#0a0a0a] p-5">
        <div className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-gray-600">
          <FolderOpen className="h-4 w-4" />
          运行上下文
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <div>
            <label className="mb-2 block text-xs font-bold text-gray-500">workspaceId *</label>
            <input
              value={context.workspaceId}
              onChange={(event) => setContext((current) => ({ ...current, workspaceId: event.target.value }))}
              placeholder={activeProvider?.defaultWorkspaceId || 'workspace_id'}
              className="w-full rounded-lg border border-gray-800 bg-black px-4 py-3 text-sm text-gray-200 outline-none focus:border-green-500"
            />
            <p className="mt-2 text-xs text-gray-600">生成结果会写入第三方后端的这个工作区。</p>
          </div>
          <div>
            <label className="mb-2 block text-xs font-bold text-gray-500">tenantId / X-Tenant-ID</label>
            <input
              value={context.tenantId}
              onChange={(event) => setContext((current) => ({ ...current, tenantId: event.target.value }))}
              placeholder={activeProvider?.defaultTenantId || 'tenant_id'}
              className="w-full rounded-lg border border-gray-800 bg-black px-4 py-3 text-sm text-gray-200 outline-none focus:border-green-500"
            />
            <p className="mt-2 text-xs text-gray-600">用于第三方积分扣费；不填则由后端默认租户处理。</p>
          </div>
          <div>
            <label className="mb-2 block text-xs font-bold text-gray-500">userId</label>
            <input
              value={context.userId}
              onChange={(event) => setContext((current) => ({ ...current, userId: event.target.value }))}
              placeholder={activeProvider?.defaultUserId || 'user_id'}
              className="w-full rounded-lg border border-gray-800 bg-black px-4 py-3 text-sm text-gray-200 outline-none focus:border-green-500"
            />
            <p className="mt-2 text-xs text-gray-600">随任务请求写入 body.user_id 与 X-User-ID。</p>
          </div>
        </div>
        {activeProvider && (
          <div className="mt-4 rounded-lg border border-gray-800 bg-black px-4 py-3 text-xs text-gray-500">
            <span className="font-bold text-gray-400">{activeProvider.name}</span>
            <span className="mx-2 text-gray-700">·</span>
            <span>{activeProvider.restBase}</span>
            {activeProvider.mcpEndpoint && (
              <>
                <span className="mx-2 text-gray-700">·</span>
                <span>{activeProvider.mcpEndpoint}</span>
              </>
            )}
            {activeProvider.authorization && (
              <>
                <span className="mx-2 text-gray-700">·</span>
                <span>Authorization ready</span>
              </>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
        <aside className="space-y-4">
          <div className="rounded-xl border border-gray-800 bg-[#0a0a0a] p-5">
            <div className="text-xs font-bold uppercase tracking-[0.2em] text-gray-600">能力标签</div>
            <div className="mt-4 flex flex-wrap gap-2">
              {agent.tags.map((tag) => (
                <span key={tag} className="rounded border border-gray-800 bg-black px-3 py-2 text-sm text-gray-400">
                  {tag}
                </span>
              ))}
              <span className="rounded border border-gray-800 bg-black px-3 py-2 text-sm text-gray-400">
                {agent.capability.kind === 'workflow'
                  ? 'Agent 工作流'
                  : agent.capability.kind === 'media'
                    ? '媒体生成'
                    : agent.capability.kind === 'local'
                      ? '本地任务包'
                      : '待开放'}
              </span>
            </div>
          </div>

          {taskId && <StatusPanel taskId={taskId} status={status} error={runError} polling={polling} />}
        </aside>

        <main className="rounded-xl border border-gray-800 bg-[#0a0a0a] p-5">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-gray-800 pb-4">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.2em] text-gray-600">执行面板</div>
              <h2 className="mt-2 text-xl font-bold text-gray-100">{agent.name}</h2>
            </div>
            {directory?.usingFallback && (
              <span className="rounded border border-yellow-500/20 bg-yellow-500/10 px-3 py-1 text-xs font-bold text-yellow-300">
                fallback schema
              </span>
            )}
          </div>

          {loading && (
            <div className="flex items-center justify-center gap-3 py-20 text-gray-500">
              <Loader2 className="h-6 w-6 animate-spin text-green-500" />
              加载执行目录...
            </div>
          )}

          {!loading && !runnable && (
            <div className="rounded-xl border border-dashed border-gray-800 bg-black p-8 text-center">
              <AlertTriangle className="mx-auto h-8 w-8 text-yellow-400" />
              <h3 className="mt-4 text-lg font-bold text-gray-100">该模块暂未在第三方 Agent API 中开放</h3>
              <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-gray-500">
                当前集市已为它创建独立页面；当 `/api/v1/agent/agents` 或 `/api/v1/agent/models`
                返回对应能力后，这里会自动切换为可执行面板。
              </p>
            </div>
          )}

          {!loading && runnable && (
            <div className="space-y-5">
              <AgentSpecificPanel
                agentId={agent.id}
                agent={agent}
                accent={style.text}
                formValues={formValues}
                updateField={updateField}
                prompt={prompt}
                setPrompt={setPrompt}
                count={count}
                setCount={setCount}
                onSubmit={handleSubmit}
                submitting={submitting}
                runError={runError}
                taskId={taskId}
                currentParams={currentParams}
                workflowDefinition={workflowDefinition}
                selectedModel={selectedModel}
                compatibleModels={compatibleModels}
                selectedModelName={selectedModelName}
                setSelectedModelName={setSelectedModelName}
              />

              {status?.is_final && status.status === 'done' && <ResultPanel status={status} />}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
