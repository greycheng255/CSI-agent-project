import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Copy,
  Download,
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
import { FlashcardStudyView } from '../features/agent-market/FlashcardStudyView';
import { MindMapVisualization } from '../features/agent-market/MindMapVisualization';

const CONTEXT_KEY = 'genesis-agent-market-context';

const FIELD_LABELS: Record<string, string> = {
  source_material: '素材内容',
  card_style: '卡片类型',
  count: '生成数量',
  layout: '布局',
  depth: '展开层级',
  style: '风格',
  duration: '时长',
  host_voice: '主持人音色',
  guest_voice: '嘉宾音色',
  text: '票据文本',
  image_urls: '图片 URL',
  pdf_url: 'PDF URL',
  pdf_name: 'PDF 文件名',
  category_hint: '类别提示',
  image_url: '图片 URL',
  audio_url: '音频 URL',
  resolution: '分辨率',
  video_type: '视频类型',
  prompt: '提示词',
  first_frame_url: '首帧 URL',
  last_frame_url: '尾帧 URL',
  size: '画幅/尺寸',
  shot_type: '镜头类型',
  reference_urls: '参考素材 URL',
  audio: '生成声音',
  images: '参考图片 URL',
  quality: '质量',
  voice: '音色',
  voice_name: '音色名称',
  model_id: '模型 ID',
  model_name: '模型名称',
  volume: '音量',
  speed: '语速',
  tags: '风格标签',
  is_music: '音乐模式',
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
    return urls.length === 1 ? urls[0] : urls;
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
    if (name === 'volume' || name === 'speed') {
      const numeric = Number(raw);
      normalized[name] = Number.isFinite(numeric) ? numeric : raw;
      return;
    }
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

function resultFilename(status: AgentTaskStatus, resultUrl: string, kind: string) {
  const fallbackExtensions: Record<string, string> = {
    image: 'png',
    video: 'mp4',
    audio: 'mp3',
    link: 'bin',
    structured: 'json',
  };
  let extension = fallbackExtensions[kind] || 'bin';

  if (resultUrl) {
    try {
      const pathname = new URL(resultUrl, window.location.href).pathname;
      const match = pathname.match(/\.([a-zA-Z0-9]{2,8})$/);
      if (match) extension = match[1].toLowerCase();
    } catch {
      // 使用按结果类型推断的扩展名。
    }
  }

  const resultType = (status.result_type || 'agent-result').replace(/[^a-zA-Z0-9_-]+/g, '-');
  const taskSuffix = status.task_id ? `-${status.task_id.slice(0, 8)}` : '';
  return `${resultType}${taskSuffix}.${extension}`;
}

function saveBlob(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

async function downloadRemoteResult(url: string, filename: string) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    saveBlob(await response.blob(), filename);
  } catch {
    // 某些对象存储未开放 CORS；退回浏览器原生下载/新窗口打开。
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.target = '_blank';
    anchor.rel = 'noreferrer';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }
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

function validateConditionalParams(agentId: string, values: Record<string, string>) {
  if (agentId === 'video') {
    const videoType = values.video_type || 't2v';
    if (videoType === 'i2v' && !values.first_frame_url?.trim()) {
      return '请填写首帧 URL';
    }
    if (videoType === 'r2v' && !values.reference_urls?.trim()) {
      return '请填写至少一个参考素材 URL';
    }
    if (videoType === 'r2v' && parseList(values.reference_urls || '').length > 9) {
      return 'Seedance 2.0 参考生最多支持 9 张参考图片';
    }
  }

  if (
    agentId === 'invoice' &&
    !values.text?.trim() &&
    !values.image_urls?.trim() &&
    !values.pdf_url?.trim()
  ) {
    return '请提供票据文本、图片 URL 或 PDF URL';
  }

  return '';
}

function buildSunoPrompt(lyrics: string, stylePrompt: string, mode: string) {
  const style = stylePrompt.trim();
  const lyricText = lyrics.trim();
  if (mode === 'instrumental') {
    return `纯音乐，无人声。音乐描述：${style}`;
  }
  if (!lyricText) {
    return `根据以下音乐描述生成一首完整歌曲，并自动创作适合的歌词：${style}`;
  }
  return `歌词：\n${lyricText}\n\n音乐描述：\n${style}`;
}

function sanitizeAgentParams(agentId: string, params: Record<string, unknown>) {
  if (agentId === 'music') {
    return {
      mv: params.mv || 'chirp-v4-5',
      make_instrumental: params.make_instrumental || 'song',
      vocal_gender: params.vocal_gender || 'auto',
      sample_rate: params.sample_rate || '44100',
      bitrate: params.bitrate || '192000',
      model_name: 'Suno Music Generation 4.5',
    };
  }

  if (agentId !== 'video') return params;

  const videoType = String(params.video_type || 't2v');
  const rawResolution = String(params.resolution || '720p');
  const common: Record<string, unknown> = {
    version: params.version || '标准',
    duration: params.duration || '5',
    aspect_ratio: params.aspect_ratio || 'adaptive',
    resolution: rawResolution.toLowerCase() === '4k' ? '4K' : rawResolution.toLowerCase(),
  };

  const rawImages = videoType === 'r2v'
    ? params.reference_urls
    : [params.first_frame_url, params.last_frame_url].filter(Boolean);
  const images = Array.isArray(rawImages)
    ? rawImages.filter(Boolean)
    : typeof rawImages === 'string' && rawImages.trim()
      ? [rawImages.trim()]
      : [];
  if (videoType !== 't2v' && images.length > 0) {
    common.images = images.length === 1 ? images[0] : images;
  }

  return common;
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
    <div className="rounded-2xl border border-[color:var(--border)] bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-[var(--text-700)]">任务状态</div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[var(--text-600)]">
            <span className="break-all font-mono text-[var(--brand-600)]">{taskId}</span>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(taskId)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-400)] hover:bg-[var(--brand-50)] hover:text-[var(--brand-600)]"
              aria-label="复制任务 ID"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
          <span className="inline-flex items-center gap-2 rounded-full bg-[var(--state-success-surface)] px-3 py-1 text-xs font-bold text-[var(--state-success-text)]">
          {polling && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {status?.status || 'submitted'}
        </span>
      </div>

      <div className="mt-5">
          <div className="mb-2 flex justify-between text-xs text-[var(--text-500)]">
          <span>{status?.current_step || 'waiting'}</span>
          <span>{progress}%</span>
        </div>
          <div className="h-2 overflow-hidden rounded-full bg-[var(--background-200)]">
            <div className="h-full rounded-full bg-[var(--brand-500)] transition-all" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {typeof status?.cost === 'number' && (
          <div className="mt-3 text-xs text-[var(--text-500)]">
            预计/实际消耗：<span className="font-mono font-semibold text-[var(--state-warning)]">{status.cost}</span> credits
        </div>
      )}

      {(error || status?.error) && (
        <div className="mt-4 rounded-xl bg-[var(--state-error-surface)] p-3 text-sm text-[var(--state-error)]">
          {error || status?.error}
        </div>
      )}
    </div>
  );
}

function StructuredResult({ data }: { data: unknown }) {
  if (!isRecord(data)) {
    return (
      <pre className="max-h-[520px] overflow-auto rounded-xl bg-[var(--background-100)] p-4 text-xs leading-6 text-[var(--text-600)]">
        {jsonText(data)}
      </pre>
    );
  }

  if (Array.isArray(data.cards)) {
    return <FlashcardStudyView cards={data.cards} cardStyle={data.card_style} />;
  }

  if (data.tree) {
    return <MindMapVisualization tree={data.tree} initialLayout={data.layout} />;
  }

  if (isRecord(data.invoice)) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl bg-[var(--background-100)] p-4">
          <div className="mb-3 text-sm font-bold text-[var(--text-800)]">发票主表</div>
          <pre className="overflow-auto text-xs leading-6 text-[var(--text-600)]">{jsonText(data.invoice)}</pre>
        </div>
        {Array.isArray(data.items) && (
          <div className="rounded-xl bg-[var(--background-100)] p-4">
            <div className="mb-3 text-sm font-bold text-[var(--text-800)]">明细</div>
            <pre className="overflow-auto text-xs leading-6 text-[var(--text-600)]">{jsonText(data.items)}</pre>
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
        <div key={index} className="rounded-xl bg-[var(--background-100)] p-4 text-sm leading-6 text-[var(--text-600)]">
            {isRecord(row) ? jsonText(row) : String(row)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <pre className="max-h-[520px] overflow-auto rounded-xl bg-[var(--background-100)] p-4 text-xs leading-6 text-[var(--text-600)]">
      {jsonText(data)}
    </pre>
  );
}

function ResultPanel({ status }: { status: AgentTaskStatus }) {
  const resultUrl = pickResultUrl(status);
  const kind = resultUrl ? detectMediaKind(status, resultUrl) : 'structured';
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const hasResultData = status.result_data !== null && status.result_data !== undefined;
  const canDownload = Boolean(resultUrl || hasResultData);

  const handleDownload = async () => {
    if (!canDownload || downloading) return;

    setDownloading(true);
    setDownloadError('');
    try {
      if (resultUrl) {
        await downloadRemoteResult(resultUrl, resultFilename(status, resultUrl, kind));
      } else {
        const blob = new Blob([jsonText(status.result_data)], {
          type: 'application/json;charset=utf-8',
        });
        saveBlob(blob, resultFilename(status, '', 'structured'));
      }
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : '结果下载失败，请稍后重试。');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="rounded-2xl border border-[color:var(--border)] bg-white p-5 md:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-[var(--brand-600)]">执行结果</div>
          <h3 className="mt-1 text-xl font-bold text-[var(--text-900)]">生成完成</h3>
        </div>
        <div className="flex items-center gap-2">
          {canDownload && (
            <button
              type="button"
              onClick={() => void handleDownload()}
              disabled={downloading}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm font-semibold text-[var(--text-700)] transition-colors hover:border-[var(--brand-300)] hover:bg-[var(--brand-50)] hover:text-[var(--brand-700)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {downloading ? '下载中...' : '下载结果'}
            </button>
          )}
          <CheckCircle2 className="h-5 w-5 text-[var(--state-success-text)]" />
        </div>
      </div>

      {downloadError && (
        <div className="mb-4 rounded-xl bg-[var(--state-error-surface)] p-3 text-sm text-[var(--state-error)]">
          {downloadError}
        </div>
      )}

      {kind === 'image' && <img loading="lazy" src={resultUrl} alt="生成结果" className="w-full rounded-xl border border-[color:var(--border)]" />}
      {kind === 'video' && <video src={resultUrl} controls className="w-full rounded-xl border border-[color:var(--border)] bg-black" />}
      {kind === 'audio' && <audio src={resultUrl} controls className="w-full" />}
      {kind === 'link' && (
        <a
          href={resultUrl}
          target="_blank"
          rel="noreferrer"
          className="btn-cs btn-primary inline-flex items-center gap-2"
        >
          打开结果
          <ExternalLink className="h-4 w-4" />
        </a>
      )}

      {hasResultData && (
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
  const taskRunning = Boolean(taskId && !status?.is_final);

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
    if (!agent || !directory || !runnable || submitting || taskRunning) return;

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

    const conditionalError = validateConditionalParams(agent.id, formValues);
    if (conditionalError) {
      setRunError(conditionalError);
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
        const params = sanitizeAgentParams(
          agent.id,
          normalizeParams(currentParams, formValues, false),
        );
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
        const params = sanitizeAgentParams(
          agent.id,
          normalizeParams(currentParams, formValues, true),
        );
        const type = agent.id === 'music' ? 'music' : selectedModel?.type;
        const model = agent.id === 'video'
          ? formValues.video_type === 'r2v' ? 'kwvideo-v2-ref' : 'kwvideo-v2'
          : agent.id === 'music' ? 'suno-v4.5' : selectedModelName;
        const taskPrompt = agent.id === 'music'
          ? buildSunoPrompt(
              formValues.lyrics || '',
              prompt,
              formValues.make_instrumental || 'song',
            )
          : prompt.trim();
        const newTaskId = await createAgentTask({
          type,
          model,
          prompt: taskPrompt,
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
      <div className="mx-auto max-w-3xl rounded-2xl border border-[color:var(--border)] bg-white p-8 text-center">
        <h1 className="m-0 text-2xl font-bold text-[var(--text-900)]">未找到智能体</h1>
        <Link to="/agent-market" className="mt-6 inline-flex font-semibold text-[var(--brand-600)] hover:text-[var(--brand-700)]">
          返回集市
        </Link>
      </div>
    );
  }

  const style = AGENT_STYLE[agent.color];

  return (
    <div className="mx-auto max-w-[1440px] space-y-5">
      <Link
        to="/agent-market"
        className="inline-flex min-h-10 items-center gap-2 rounded-lg px-1 text-sm font-semibold text-[var(--brand-600)] hover:text-[var(--brand-700)]"
      >
        <ArrowLeft className="h-4 w-4" />
        返回集市
      </Link>

      <div className="grid items-start gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="space-y-4 xl:sticky xl:top-24">
          <section className="rounded-2xl border border-[color:var(--border)] bg-white p-5">
            <div className="flex items-start gap-4">
              <div
                className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl text-3xl"
                style={{ background: style.bg }}
              >
                {agent.icon}
              </div>
              <div className="min-w-0">
                <h1 className="text-xl font-bold text-[var(--text-900)]">{agent.name}</h1>
                <p className="mt-1 text-sm leading-6 text-[var(--text-500)]">{agent.desc}</p>
              </div>
            </div>

            <dl className="mt-5 divide-y divide-[color:var(--border)] border-y border-[color:var(--border)]">
              <div className="flex items-center justify-between py-3 text-sm">
                <dt className="flex items-center gap-2 text-[var(--text-500)]"><Star className="h-4 w-4" />评分</dt>
                <dd className="font-semibold text-[var(--text-800)]">{agent.rating.toFixed(1)}</dd>
              </div>
              <div className="flex items-center justify-between py-3 text-sm">
                <dt className="flex items-center gap-2 text-[var(--text-500)]"><Zap className="h-4 w-4" />累计调用</dt>
                <dd className="font-semibold text-[var(--text-800)]">{agent.calls.toLocaleString()}</dd>
              </div>
            </dl>

            <div className="mt-5">
              <h2 className="text-sm font-semibold text-[var(--text-700)]">能力标签</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {agent.tags.map((tag) => (
                  <span key={tag} className="rounded-full bg-[var(--background-100)] px-3 py-1.5 text-xs font-medium text-[var(--text-600)]">
                    {tag}
                  </span>
                ))}
                <span className="rounded-full bg-[var(--brand-50)] px-3 py-1.5 text-xs font-medium text-[var(--brand-700)]">
                  {agent.capability.kind === 'workflow' ? 'Agent 工作流' : agent.capability.kind === 'media' ? '媒体生成' : '待开放'}
                </span>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-[color:var(--border)] bg-white p-5">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--brand-50)] text-[var(--brand-600)]">
                <FolderOpen className="h-4 w-4" />
              </span>
              <div>
                <h2 className="text-base font-bold text-[var(--text-900)]">运行设置</h2>
                <p className="mt-0.5 text-xs text-[var(--text-500)]">设置结果归属与使用身份</p>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              <div>
                <label htmlFor="agent-run-workspace" className="mb-2 block text-[13px] font-semibold text-[var(--text-600)]">工作区 ID *</label>
                <input id="agent-run-workspace" value={context.workspaceId} onChange={(event) => setContext((current) => ({ ...current, workspaceId: event.target.value }))} placeholder={activeProvider?.defaultWorkspaceId || 'workspace_id'} className="min-h-11 w-full rounded-xl border border-[color:var(--border)] bg-white px-4 py-3 text-sm text-[var(--text-800)] outline-none placeholder:text-[var(--text-500)] focus:border-[var(--brand-500)] focus:ring-4 focus:ring-blue-500/10" />
                <p className="mt-2 text-xs leading-5 text-[var(--text-500)]">生成结果会写入第三方后端的这个工作区。</p>
              </div>
              <div>
                <label htmlFor="agent-run-tenant" className="mb-2 block text-[13px] font-semibold text-[var(--text-600)]">租户 ID</label>
                <input id="agent-run-tenant" value={context.tenantId} onChange={(event) => setContext((current) => ({ ...current, tenantId: event.target.value }))} placeholder={activeProvider?.defaultTenantId || 'tenant_id'} className="min-h-11 w-full rounded-xl border border-[color:var(--border)] bg-white px-4 py-3 text-sm text-[var(--text-800)] outline-none placeholder:text-[var(--text-500)] focus:border-[var(--brand-500)] focus:ring-4 focus:ring-blue-500/10" />
              </div>
              <div>
                <label htmlFor="agent-run-user" className="mb-2 block text-[13px] font-semibold text-[var(--text-600)]">用户 ID</label>
                <input id="agent-run-user" value={context.userId} onChange={(event) => setContext((current) => ({ ...current, userId: event.target.value }))} placeholder={activeProvider?.defaultUserId || 'user_id'} className="min-h-11 w-full rounded-xl border border-[color:var(--border)] bg-white px-4 py-3 text-sm text-[var(--text-800)] outline-none placeholder:text-[var(--text-500)] focus:border-[var(--brand-500)] focus:ring-4 focus:ring-blue-500/10" />
              </div>
            </div>

            {activeProvider && (
              <div className="mt-5 break-all rounded-xl bg-[var(--background-100)] p-3 text-xs leading-5 text-[var(--text-500)]">
                <div className="font-semibold text-[var(--text-700)]">{activeProvider.name}</div>
                <div className="mt-1">{activeProvider.restBase}</div>
                {activeProvider.mcpEndpoint && <div className="mt-1">{activeProvider.mcpEndpoint}</div>}
                {activeProvider.authorization && <div className="mt-1 text-[var(--state-success-text)]">Authorization ready</div>}
              </div>
            )}
          </section>

          {taskId && <StatusPanel taskId={taskId} status={status} error={runError} polling={polling} />}
        </aside>

        <main className="min-w-0 space-y-4">
          {loadError && (
            <div className="flex items-start gap-3 rounded-xl bg-[var(--state-warning-surface)] p-4 text-sm text-[var(--state-warning)]">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div><div className="font-bold">第三方目录加载不完整，正在使用备用配置。</div><div className="mt-1 leading-6">{loadError}</div></div>
            </div>
          )}

          <section className="rounded-2xl border border-[color:var(--border)] bg-white p-5 md:p-6">
            <div className="mb-6 flex flex-wrap items-start justify-between gap-3 border-b border-[color:var(--border)] pb-5">
              <div>
                <div className="text-sm font-semibold text-[var(--brand-600)]">任务配置</div>
                <h2 className="mt-1 text-2xl font-bold text-[var(--text-900)]">使用 {agent.name}</h2>
                <p className="mt-1 text-sm text-[var(--text-500)]">填写必要参数后即可开始执行。</p>
              </div>
              {directory?.usingFallback && <span className="rounded-full bg-[var(--state-warning-surface)] px-3 py-1 text-xs font-semibold text-[var(--state-warning)]">备用配置</span>}
            </div>

            {loading && <div className="space-y-4 py-8"><div className="h-11 animate-pulse rounded-xl bg-[var(--background-100)]" /><div className="h-28 animate-pulse rounded-xl bg-[var(--background-100)]" /><div className="h-11 animate-pulse rounded-xl bg-[var(--background-100)]" /></div>}

            {!loading && !runnable && agent.capability.kind !== 'unavailable' && (
              <div className="rounded-xl bg-[var(--background-100)] p-8 text-center">
                <AlertTriangle className="mx-auto h-8 w-8 text-[var(--state-warning)]" />
                <h3 className="mt-4 text-lg font-bold text-[var(--text-900)]">该智能体暂未开放使用</h3>
                <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[var(--text-500)]">能力接入完成后，本页面会自动开放任务配置与执行入口。</p>
              </div>
            )}

            {!loading && (runnable || agent.capability.kind === 'unavailable') && (
              <AgentSpecificPanel agentId={agent.id} agent={agent} accent={style.text} formValues={formValues} updateField={updateField} prompt={prompt} setPrompt={setPrompt} count={count} setCount={setCount} onSubmit={handleSubmit} submitting={submitting || taskRunning} runError={runError} taskId={taskId} currentParams={currentParams} workflowDefinition={workflowDefinition} selectedModel={selectedModel} compatibleModels={compatibleModels} selectedModelName={selectedModelName} setSelectedModelName={setSelectedModelName} />
            )}
          </section>

          {runnable && status?.is_final && status.status === 'done' && <ResultPanel status={status} />}
        </main>
      </div>
    </div>
  );
}
