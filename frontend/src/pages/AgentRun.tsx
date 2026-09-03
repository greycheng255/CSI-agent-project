import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Copy,
  Download,
  Eye,
  ExternalLink,
  FolderOpen,
  History as HistoryIcon,
  KeyRound,
  Loader2,
  LogOut,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
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
  loadAgentRunHistory,
  loadAgentWorkspaces,
  type AgentDirectory,
  type AgentParamMap,
  type AgentParamOption,
  type AgentParamSchema,
  type AgentRunHistoryItem,
  type AgentTaskStatus,
  type AgentWorkspace,
} from '../api/agentMarketApi';
import { AGENT_STYLE, getCatalogItem } from '../data/agentMarketCatalog';
import {
  AgentSpecificPanel,
  resolveAgentMarketPlugin,
} from '../features/agent-market/plugins/registry';
import { FlashcardStudyView } from '../features/agent-market/FlashcardStudyView';
import { MindMapVisualization } from '../features/agent-market/MindMapVisualization';
import {
  beginOpenNotebookAuthorization,
  clearLegacyOpenNotebookApiKey,
  disconnectOpenNotebookOAuth,
  getOpenNotebookOAuthAuthorization,
  getValidOpenNotebookOAuthSession,
  readOpenNotebookOAuthSession,
  type OpenNotebookOAuthSession,
} from '../features/agent-market/openNotebookOAuth';
import { useAuthStore } from '../store/authStore';

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
};

type NormalizedOption = {
  value: string;
  label: string;
};

function contextKeyFor(providerId: string | undefined, accountId: string) {
  return `${CONTEXT_KEY}:${providerId || 'default'}:${accountId}`;
}

function readStoredContext(
  key = CONTEXT_KEY,
): ContextState {
  const fallback = {
    workspaceId: '',
  };
  if (typeof window === 'undefined') return fallback;

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<ContextState>;
    return {
      workspaceId:
        typeof parsed.workspaceId === 'string' && parsed.workspaceId.trim()
          ? parsed.workspaceId
          : fallback.workspaceId,
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
  const result = isRecord(status.result_data) ? status.result_data : {};

  if (
    type.includes('image') ||
    typeof result.image_url === 'string' ||
    typeof result.imageUrl === 'string' ||
    /\.(png|jpe?g|webp|gif)(\?|$)/.test(url)
  ) return 'image';
  if (
    type.includes('video') ||
    type.includes('digihuman') ||
    typeof result.video_url === 'string' ||
    typeof result.videoUrl === 'string' ||
    /\.(mp4|webm|mov)(\?|$)/.test(url)
  ) {
    return 'video';
  }
  if (
    type.includes('audio') ||
    type.includes('music') ||
    type.includes('podcast') ||
    typeof result.audio_url === 'string' ||
    typeof result.audioUrl === 'string' ||
    /\.(mp3|wav|m4a|ogg)(\?|$)/.test(url)
  ) {
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
    if (!values.prompt?.trim()) {
      return '请填写视频提示词';
    }
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
      is_music: typeof params.is_music === 'boolean' ? params.is_music : true,
      ...(typeof params.tags === 'string' && params.tags.trim() ? { tags: params.tags } : {}),
    };
  }

  return params;
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

function historyStatusStyle(status: string) {
  const normalized = status.toLowerCase();
  if (['succeeded', 'done'].includes(normalized)) {
    return 'bg-[var(--state-success-surface)] text-[var(--state-success-text)]';
  }
  if (['failed', 'error', 'cancelled', 'canceled'].includes(normalized)) {
    return 'bg-[var(--state-error-surface)] text-[var(--state-error)]';
  }
  if (normalized === 'running') {
    return 'bg-[var(--brand-50)] text-[var(--brand-700)]';
  }
  return 'bg-[var(--background-200)] text-[var(--text-600)]';
}

function formatHistoryTime(value?: string) {
  if (!value) return '时间未知';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function historySummary(item: AgentRunHistoryItem) {
  if (!isRecord(item.input)) return item.agent || '智能体任务';
  const candidates = [
    item.input.prompt,
    item.input.source_material,
    item.input.text,
    item.input.topic,
  ];
  const summary = candidates.find(
    (value): value is string => typeof value === 'string' && value.trim().length > 0,
  );
  return summary?.trim() || item.agent || '智能体任务';
}

function HistoryPanel({
  items,
  loading,
  error,
  selectedTaskId,
  onSelect,
  onRefresh,
}: {
  items: AgentRunHistoryItem[];
  loading: boolean;
  error: string;
  selectedTaskId: string;
  onSelect: (item: AgentRunHistoryItem) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-5xl rounded-2xl border border-[color:var(--border)] bg-white p-4 shadow-sm md:p-5">
      <div className="flex items-center justify-between gap-3 border-b border-[color:var(--border)] pb-4">
        <div>
          <h3 className="text-base font-bold text-[var(--text-900)]">运行历史</h3>
          <p className="mt-1 text-xs text-[var(--text-500)]">当前授权账号、工作区和智能体的最近任务</p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-[color:var(--border)] bg-white px-3 text-xs font-semibold text-[var(--text-600)] hover:bg-[var(--background-100)] disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-xl bg-[var(--state-error-surface)] p-3 text-sm text-[var(--state-error)]">
          {error}
        </div>
      )}

      {loading && items.length === 0 && (
        <div className="space-y-3 py-4">
          {[0, 1, 2].map((item) => (
            <div key={item} className="h-20 animate-pulse rounded-xl bg-[var(--background-100)]" />
          ))}
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="flex min-h-72 flex-col items-center justify-center px-6 text-center">
          <HistoryIcon className="h-9 w-9 text-[var(--text-300)]" />
          <h4 className="mt-4 font-bold text-[var(--text-800)]">还没有运行记录</h4>
          <p className="mt-2 text-sm text-[var(--text-500)]">在左侧提交任务后，历史会自动出现在这里。</p>
        </div>
      )}

      {items.length > 0 && (
        <div className="mt-4 space-y-2">
          {items.map((item) => (
            <button
              key={item.task_id}
              type="button"
              onClick={() => onSelect(item)}
              className={`w-full rounded-xl border p-3 text-left transition-colors ${
                selectedTaskId === item.task_id
                  ? 'border-[var(--brand-300)] bg-[var(--brand-50)]'
                  : 'border-[color:var(--border)] bg-white hover:border-[var(--brand-200)] hover:bg-[var(--background-50)]'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-[var(--text-800)]">
                    {historySummary(item)}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-400)]">
                    <span>{formatHistoryTime(item.created_at)}</span>
                    <span className="font-mono">{item.task_id.slice(0, 8)}</span>
                    {typeof item.cost === 'number' && <span>{item.cost} credits</span>}
                  </div>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${historyStatusStyle(item.status)}`}>
                  {item.status}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
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
  const accountId = useAuthStore(
    (state) => state.user?.id || state.admin?.id || 'anonymous',
  );
  const agent = id ? getCatalogItem(id) : null;
  const bootstrapPlugin = useMemo(() => {
    return agent ? resolveAgentMarketPlugin({ agentId: agent.id, agent }) : null;
  }, [agent]);
  const bootstrapProvider = bootstrapPlugin?.manifest.provider;
  const [oauthSession, setOAuthSession] = useState<OpenNotebookOAuthSession | null>(() =>
    readOpenNotebookOAuthSession(accountId),
  );
  const [oauthBusy, setOAuthBusy] = useState(false);
  const [oauthMessage, setOAuthMessage] = useState('');
  const oauthConnected = Boolean(oauthSession);
  const bootstrapRequestProvider = useMemo(() => {
    if (!bootstrapProvider) return undefined;
    return {
      ...bootstrapProvider,
      getAuthorization: () => getOpenNotebookOAuthAuthorization(accountId),
    };
  }, [accountId, bootstrapProvider]);
  const contextStorageKey = contextKeyFor(bootstrapProvider?.id, accountId);
  const [directory, setDirectory] = useState<AgentDirectory | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [context, setContext] = useState<ContextState>(() =>
    readStoredContext(contextStorageKey),
  );
  const [hydratedContextKey, setHydratedContextKey] = useState(contextStorageKey);
  const [workspaces, setWorkspaces] = useState<AgentWorkspace[]>([]);
  const [workspacesLoading, setWorkspacesLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState('');
  const [selectedModelName, setSelectedModelName] = useState('');
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [prompt, setPrompt] = useState('');
  const [count, setCount] = useState('1');
  const [taskId, setTaskId] = useState('');
  const [status, setStatus] = useState<AgentTaskStatus | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [polling, setPolling] = useState(false);
  const [runError, setRunError] = useState('');
  const [stageTab, setStageTab] = useState<'result' | 'history'>('result');
  const [historyItems, setHistoryItems] = useState<AgentRunHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const taskRunning = Boolean(taskId && !status?.is_final);

  useEffect(() => {
    let cancelled = false;
    clearLegacyOpenNotebookApiKey(accountId);
    setOAuthMessage('');
    const storedSession = readOpenNotebookOAuthSession(accountId);
    setOAuthSession(storedSession);
    if (!storedSession) return () => {
      cancelled = true;
    };

    getValidOpenNotebookOAuthSession(accountId)
      .then((session) => {
        if (!cancelled) setOAuthSession(session);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setOAuthMessage(error instanceof Error ? error.message : '刷新 OpenNotebook 授权失败。');
      });

    return () => {
      cancelled = true;
    };
  }, [accountId]);

  useEffect(() => {
    let cancelled = false;

    if (!agent) {
      setDirectory(null);
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    if (!oauthConnected) {
      setDirectory(null);
      setLoadError('');
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setLoading(true);
    loadAgentDirectory(bootstrapRequestProvider)
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
  }, [agent, bootstrapRequestProvider, oauthConnected]);

  useEffect(() => {
    if (typeof window === 'undefined' || hydratedContextKey !== contextStorageKey) return;
    window.localStorage.setItem(contextStorageKey, JSON.stringify(context));
  }, [context, contextStorageKey, hydratedContextKey]);

  useEffect(() => {
    setContext(readStoredContext(contextStorageKey));
    setHydratedContextKey(contextStorageKey);
  }, [contextStorageKey]);

  useEffect(() => {
    let cancelled = false;
    if (!oauthConnected) {
      setWorkspaces([]);
      setContext({ workspaceId: '' });
      setWorkspaceError('');
      setWorkspacesLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setWorkspacesLoading(true);
    setWorkspaceError('');

    loadAgentWorkspaces(bootstrapRequestProvider)
      .then((items) => {
        if (cancelled) return;
        setWorkspaces(items);
        setContext((current) => ({
          workspaceId: items.some((item) => item.id === current.workspaceId)
            ? current.workspaceId
            : items[0]?.id || '',
        }));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setWorkspaces([]);
        setContext({ workspaceId: '' });
        setWorkspaceError(
          error instanceof Error ? error.message : '读取 OpenNotebook 工作区失败',
        );
      })
      .finally(() => {
        if (!cancelled) setWorkspacesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [bootstrapRequestProvider, oauthConnected]);

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

  const historyAgentType = useMemo(() => {
    if (!agent) return '';
    if (agent.capability.kind === 'workflow') return agent.capability.workflowType;
    if (agent.capability.kind === 'media') return selectedModel?.type || '';
    return '';
  }, [agent, selectedModel?.type]);

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
  const activeProviderBase = activePlugin?.manifest.provider || bootstrapProvider;
  const activeProvider = useMemo(() => {
    if (!activeProviderBase) return undefined;
    return {
      ...activeProviderBase,
      getAuthorization: () => getOpenNotebookOAuthAuthorization(accountId),
    };
  }, [accountId, activeProviderBase]);

  const refreshHistory = useCallback(async () => {
    const workspaceId = context.workspaceId.trim();
    if (!oauthConnected || !workspaceId || !activeProvider || !historyAgentType) {
      setHistoryItems([]);
      setHistoryError('');
      setHistoryLoading(false);
      return;
    }

    setHistoryLoading(true);
    setHistoryError('');
    try {
      const items = await loadAgentRunHistory(workspaceId, activeProvider);
      setHistoryItems(items.filter((item) => item.agent === historyAgentType));
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : '读取运行历史失败');
    } finally {
      setHistoryLoading(false);
    }
  }, [activeProvider, context.workspaceId, historyAgentType, oauthConnected]);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

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

  const handleConnectOpenNotebook = async () => {
    if (oauthBusy || taskRunning || submitting) return;
    setOAuthBusy(true);
    setOAuthMessage('');
    try {
      await beginOpenNotebookAuthorization(
        accountId,
        `${window.location.pathname}${window.location.search}`,
      );
    } catch (error) {
      setOAuthMessage(error instanceof Error ? error.message : '启动 OpenNotebook 授权失败。');
      setOAuthBusy(false);
    }
  };

  const handleDisconnectOpenNotebook = async () => {
    if (oauthBusy || taskRunning || submitting) return;
    setOAuthBusy(true);
    setOAuthMessage('');
    try {
      await disconnectOpenNotebookOAuth(accountId);
      setOAuthSession(null);
      setOAuthMessage('OpenNotebook 授权已撤销。');
      setTaskId('');
      setStatus(null);
      setHistoryItems([]);
      setRunError('');
    } catch (error) {
      setOAuthMessage(error instanceof Error ? error.message : '撤销 OpenNotebook 授权失败。');
    } finally {
      setOAuthBusy(false);
    }
  };

  const handleWorkspaceChange = (workspaceId: string) => {
    setContext({ workspaceId });
    setTaskId('');
    setStatus(null);
    setRunError('');
  };

  const handleHistorySelect = (item: AgentRunHistoryItem) => {
    setTaskId(item.task_id);
    setStatus(item);
    setRunError('');
    setStageTab('result');
  };

  const handleSubmit = async () => {
    if (!agent || !directory || !runnable || submitting || taskRunning) return;

    if (!oauthConnected) {
      setRunError('请先授权连接你的 OpenNotebook 账号。');
      return;
    }

    const workspaceId = context.workspaceId.trim();
    if (workspacesLoading) {
      setRunError('正在读取 OpenNotebook 工作区，请稍候。');
      return;
    }
    if (!workspaceId || !workspaces.some((workspace) => workspace.id === workspaceId)) {
      setRunError('请先选择 OpenNotebook 工作区。');
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
    setStageTab('result');
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
          count: Number.isFinite(parsedCount) ? parsedCount : 1,
        }, activeProvider);
        setTaskId(newTaskId);
      }

      if (agent.capability.kind === 'media') {
        const params = sanitizeAgentParams(
          agent.id,
          normalizeParams(currentParams, formValues, true),
        );
        const type = selectedModel?.type;
        const model = selectedModelName;
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

  useEffect(() => {
    if (!status?.is_final) return;
    void refreshHistory();
  }, [refreshHistory, status?.is_final, status?.task_id]);

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

      <div className="grid min-h-[calc(100vh-9rem)] overflow-hidden rounded-2xl border border-[color:var(--border)] bg-white shadow-sm lg:grid-cols-[minmax(360px,430px)_minmax(0,1fr)]">
        <aside className="min-w-0 space-y-4 border-b border-[color:var(--border)] bg-[var(--background-50)] p-4 lg:max-h-[calc(100vh-9rem)] lg:overflow-y-auto lg:border-b-0 lg:border-r">
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
                <p className="mt-0.5 text-xs text-[var(--text-500)]">设置结果归属工作区</p>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              <div className="rounded-xl border border-[color:var(--border)] bg-[var(--background-50)] p-4">
                <div className="flex items-start gap-3">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${oauthConnected ? 'bg-[var(--state-success-surface)] text-[var(--state-success-text)]' : 'bg-[var(--brand-50)] text-[var(--brand-600)]'}`}>
                    {oauthConnected ? <ShieldCheck className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-bold text-[var(--text-800)]">OpenNotebook 账号授权</h3>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${oauthConnected ? 'bg-[var(--state-success-surface)] text-[var(--state-success-text)]' : 'bg-[var(--background-200)] text-[var(--text-500)]'}`}>
                        {oauthConnected ? '已连接' : '未连接'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-[var(--text-500)]">
                      {oauthConnected
                        ? '已通过 OAuth 2.1 + PKCE 授权，可读取该账号可访问的工作区。'
                        : '跳转到 OpenNotebook 完成授权，无需复制或粘贴 API Key。'}
                    </p>
                    {oauthConnected && oauthSession?.scope && (
                      <p className="mt-1 text-[11px] text-[var(--text-400)]">授权范围：{oauthSession.scope}</p>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void handleConnectOpenNotebook()}
                    disabled={oauthBusy || submitting || taskRunning}
                    className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-[var(--brand-600)] px-3 py-2 text-xs font-semibold text-white hover:bg-[var(--brand-700)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {oauthBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
                    {oauthConnected ? '重新授权' : '授权连接 OpenNotebook'}
                  </button>
                  {oauthConnected && (
                    <button
                      type="button"
                      onClick={() => void handleDisconnectOpenNotebook()}
                      disabled={oauthBusy || submitting || taskRunning}
                      className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-[color:var(--border)] bg-white px-3 py-2 text-xs font-semibold text-[var(--text-600)] hover:bg-[var(--background-100)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      断开连接
                    </button>
                  )}
                </div>
                {oauthMessage && (
                  <p className={`mt-2 text-xs leading-5 ${oauthMessage.includes('已撤销') ? 'text-[var(--state-success-text)]' : 'text-[var(--state-error)]'}`}>
                    {oauthMessage}
                  </p>
                )}
                <p className="mt-2 text-[11px] leading-5 text-[var(--text-400)]">
                  OAuth Token 仅保存在当前浏览器会话中，不会发送到 CSI 后端。
                </p>
              </div>

              <div>
                <label htmlFor="agent-run-workspace" className="mb-2 block text-[13px] font-semibold text-[var(--text-600)]">工作区 *</label>
                <select
                  id="agent-run-workspace"
                  value={context.workspaceId}
                  onChange={(event) => handleWorkspaceChange(event.target.value)}
                  disabled={!oauthConnected || workspacesLoading || workspaces.length === 0}
                  className="min-h-11 w-full rounded-xl border border-[color:var(--border)] bg-white px-4 py-3 text-sm text-[var(--text-800)] outline-none focus:border-[var(--brand-500)] focus:ring-4 focus:ring-blue-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {!oauthConnected && <option value="">请先授权 OpenNotebook</option>}
                  {oauthConnected && workspacesLoading && <option value="">正在读取工作区...</option>}
                  {oauthConnected && !workspacesLoading && workspaces.length === 0 && <option value="">没有可用工作区</option>}
                  {workspaces.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>
                      {workspace.name}
                    </option>
                  ))}
                </select>
                {context.workspaceId && (
                  <p className="mt-2 break-all font-mono text-[11px] text-[var(--text-400)]">{context.workspaceId}</p>
                )}
                {oauthConnected && workspaceError ? (
                  <p className="mt-2 text-xs leading-5 text-[var(--state-error)]">
                    {workspaceError}。请重新授权或确认该账号可以访问工作区。
                  </p>
                ) : oauthConnected ? (
                  <p className="mt-2 text-xs leading-5 text-[var(--text-500)]">工作区由当前 OpenNotebook 授权账号自动读取。</p>
                ) : null}
              </div>
            </div>

            {activeProvider && (
              <div className="mt-5 break-all rounded-xl bg-[var(--background-100)] p-3 text-xs leading-5 text-[var(--text-500)]">
                <div className="font-semibold text-[var(--text-700)]">{activeProvider.name}</div>
                <div className="mt-1">{activeProvider.restBase}</div>
                {oauthConnected ? (
                  <div className="mt-1 text-[var(--state-success-text)]">OAuth 2.1 + PKCE 已授权</div>
                ) : (
                  <div className="mt-1 text-[var(--state-warning)]">等待用户授权 OpenNotebook</div>
                )}
              </div>
            )}
          </section>

          {loadError && (
            <div className="flex items-start gap-3 rounded-xl bg-[var(--state-warning-surface)] p-4 text-sm text-[var(--state-warning)]">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div><div className="font-bold">第三方目录加载不完整，正在使用备用配置。</div><div className="mt-1 leading-6">{loadError}</div></div>
            </div>
          )}

          <section className="rounded-2xl border border-[color:var(--border)] bg-white p-5">
            <div className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-[color:var(--border)] pb-4">
              <div>
                <div className="flex items-center gap-2 text-xs font-semibold text-[var(--brand-600)]">
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  编写与配置
                </div>
                <h2 className="mt-1 text-lg font-bold text-[var(--text-900)]">{agent.name} 参数</h2>
                <p className="mt-1 text-xs text-[var(--text-500)]">填写参数并从这里启动任务。</p>
              </div>
              {directory?.usingFallback && <span className="rounded-full bg-[var(--state-warning-surface)] px-3 py-1 text-xs font-semibold text-[var(--state-warning)]">备用配置</span>}
            </div>

            {loading && <div className="space-y-4 py-8"><div className="h-11 animate-pulse rounded-xl bg-[var(--background-100)]" /><div className="h-28 animate-pulse rounded-xl bg-[var(--background-100)]" /><div className="h-11 animate-pulse rounded-xl bg-[var(--background-100)]" /></div>}

            {!loading && !runnable && agent.capability.kind !== 'unavailable' && (
              <div className="rounded-xl bg-[var(--background-100)] p-8 text-center">
                {oauthConnected ? (
                  <AlertTriangle className="mx-auto h-8 w-8 text-[var(--state-warning)]" />
                ) : (
                  <KeyRound className="mx-auto h-8 w-8 text-[var(--brand-500)]" />
                )}
                <h3 className="mt-4 text-lg font-bold text-[var(--text-900)]">
                  {oauthConnected ? '该智能体暂未开放使用' : '请先授权 OpenNotebook 账号'}
                </h3>
                <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[var(--text-500)]">
                  {oauthConnected
                    ? '请确认当前账号有权使用该能力，或 OpenNotebook 已开放对应智能体。'
                    : '在左侧运行设置中点击授权，页面会自动读取可用智能体、模型和工作区。'}
                </p>
              </div>
            )}

            {!loading && (runnable || agent.capability.kind === 'unavailable') && (
              <AgentSpecificPanel agentId={agent.id} agent={agent} accent={style.text} formValues={formValues} updateField={updateField} prompt={prompt} setPrompt={setPrompt} count={count} setCount={setCount} onSubmit={handleSubmit} submitting={submitting || taskRunning} runError={runError} taskId={taskId} currentParams={currentParams} workflowDefinition={workflowDefinition} selectedModel={selectedModel} compatibleModels={compatibleModels} selectedModelName={selectedModelName} setSelectedModelName={setSelectedModelName} />
            )}
          </section>
        </aside>

        <main className="flex min-w-0 flex-col bg-[var(--background-50)]">
          <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[color:var(--border)] bg-white px-5 py-4 md:px-6">
            <div className="flex items-center gap-3">
              <span
                className="flex h-10 w-10 items-center justify-center rounded-xl text-xl"
                style={{ background: style.bg, color: style.text }}
              >
                {agent.icon}
              </span>
              <div>
                <div className="text-xs font-semibold text-[var(--brand-600)]">实时工作台</div>
                <h2 className="mt-0.5 text-lg font-bold text-[var(--text-900)]">历史与执行结果</h2>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold text-[var(--text-500)]">
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--border)] bg-white px-2.5 py-1.5">
                <Star className="h-3.5 w-3.5" style={{ color: style.text }} />
                {agent.rating.toFixed(1)}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--border)] bg-white px-2.5 py-1.5">
                <Zap className="h-3.5 w-3.5" style={{ color: style.text }} />
                {agent.calls.toLocaleString()} 次调用
              </span>
            </div>
          </header>

          <div className="border-b border-[color:var(--border)] bg-white px-5 md:px-6">
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setStageTab('result')}
                className={`relative inline-flex min-h-12 items-center gap-2 px-3 text-sm font-semibold transition-colors ${
                  stageTab === 'result'
                    ? 'text-[var(--brand-700)]'
                    : 'text-[var(--text-500)] hover:text-[var(--text-800)]'
                }`}
              >
                <Eye className="h-4 w-4" />
                当前执行
                {taskRunning && <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--brand-500)]" />}
                {stageTab === 'result' && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[var(--brand-500)]" />}
              </button>
              <button
                type="button"
                onClick={() => setStageTab('history')}
                className={`relative inline-flex min-h-12 items-center gap-2 px-3 text-sm font-semibold transition-colors ${
                  stageTab === 'history'
                    ? 'text-[var(--brand-700)]'
                    : 'text-[var(--text-500)] hover:text-[var(--text-800)]'
                }`}
              >
                <HistoryIcon className="h-4 w-4" />
                运行历史
                {historyItems.length > 0 && (
                  <span className="rounded-full bg-[var(--background-200)] px-1.5 py-0.5 text-[10px] text-[var(--text-600)]">
                    {historyItems.length}
                  </span>
                )}
                {stageTab === 'history' && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[var(--brand-500)]" />}
              </button>
            </div>
          </div>

          <div className="min-h-[620px] flex-1 overflow-y-auto p-4 md:p-6">
            {stageTab === 'history' ? (
              <HistoryPanel
                items={historyItems}
                loading={historyLoading}
                error={historyError}
                selectedTaskId={taskId}
                onSelect={handleHistorySelect}
                onRefresh={() => void refreshHistory()}
              />
            ) : taskId ? (
              <div className="mx-auto w-full max-w-5xl space-y-4">
                <StatusPanel taskId={taskId} status={status} error={runError} polling={polling} />
                {runnable && status?.is_final && ['done', 'succeeded'].includes(status.status.toLowerCase()) && (
                  <ResultPanel status={status} />
                )}
              </div>
            ) : (
              <div className="flex min-h-[570px] flex-col items-center justify-center rounded-2xl border border-dashed border-[color:var(--border)] bg-white px-6 py-12 text-center">
                <span
                  className="flex h-20 w-20 items-center justify-center rounded-3xl border text-4xl shadow-sm"
                  style={{ background: style.bg, borderColor: style.border }}
                >
                  {agent.icon}
                </span>
                <h3 className="mt-5 text-xl font-bold text-[var(--text-900)]">{agent.name} 已准备就绪</h3>
                <p className="mt-2 max-w-lg text-sm leading-6 text-[var(--text-500)]">
                  在左侧授权 OpenNotebook、选择工作区并配置参数，任务进度和生成结果会在这里实时显示。
                </p>
                <div className="mt-8 grid w-full max-w-2xl gap-3 text-left sm:grid-cols-3">
                  {[
                    ['01', '连接账号', '授权 OpenNotebook 并选择工作区'],
                    ['02', '调整参数', '设置内容、模型与生成选项'],
                    ['03', '查看结果', '跟踪进度并浏览历史产物'],
                  ].map(([step, title, description]) => (
                    <div key={step} className="rounded-xl border border-[color:var(--border)] bg-[var(--background-50)] p-4">
                      <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[10px] font-extrabold" style={{ color: style.text, background: style.bg }}>
                        {step}
                      </span>
                      <strong className="mt-3 block text-sm text-[var(--text-800)]">{title}</strong>
                      <small className="mt-1 block text-xs leading-5 text-[var(--text-500)]">{description}</small>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
