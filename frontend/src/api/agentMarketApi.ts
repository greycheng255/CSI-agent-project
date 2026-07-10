import { AGENT_REST_BASE, normalizeBaseUrl } from '../config/api';
import { AGENT_CATALOG, type AgentCatalogItem } from '../data/agentMarketCatalog';

type JsonRecord = Record<string, unknown>;
type ParamOptionValue = string | number | boolean;

export type AgentParamOption =
  | ParamOptionValue
  | {
      value?: ParamOptionValue;
      label?: string;
      is_default?: boolean;
    };

export type AgentParamSchema = {
  type?: string;
  label?: string;
  description?: string;
  required?: boolean;
  default?: ParamOptionValue | ParamOptionValue[];
  options?: AgentParamOption[];
};

export type AgentParamMap = Record<string, AgentParamSchema>;

export type ApiAgentDefinition = {
  type: string;
  label: string;
  icon?: string;
  description?: string;
  params?: AgentParamMap;
};

export type ApiModelDefinition = {
  name: string;
  type: string;
  label?: string;
  display_name?: string;
  description?: string;
  params?: AgentParamMap;
  tags?: string[];
};

export type AgentDirectory = {
  agents: ApiAgentDefinition[];
  models: ApiModelDefinition[];
  usingFallback: boolean;
  error?: string;
};

export type GenerateAgentPayload = {
  workspaceId: string;
  tenantId?: string;
  userId?: string;
  type?: string;
  model?: string;
  prompt?: string;
  params?: Record<string, unknown>;
  count?: number;
};

export type AgentRequestProvider = {
  restBase?: string;
  authorization?: string;
  headers?: Record<string, string>;
};

export type AgentTaskStatus = {
  task_id: string;
  status: string;
  is_final: boolean;
  progress?: string | number | null;
  current_step?: string | null;
  result_url?: string | null;
  result_data?: unknown;
  result_type?: string;
  cost?: number;
  error?: string;
};

const FALLBACK_AGENTS: ApiAgentDefinition[] = [
  {
    type: 'mindmap',
    label: '思维导图生成器',
    icon: '🧠',
    description: '把素材提炼为大纲并生成结构化思维导图树。',
    params: {
      source_material: { type: 'string', required: true, description: '原始素材、文章或知识点' },
      layout: {
        type: 'string',
        default: 'mindmap',
        options: ['mindmap', 'dendrogram', 'fishbone'],
        description: '导图布局',
      },
      depth: { type: 'number', default: 0, description: '展开层级，0=自动' },
    },
  },
  {
    type: 'flashcard',
    label: '闪卡生成器',
    icon: '🃏',
    description: '把知识材料整理成可复习的问答闪卡。',
    params: {
      source_material: { type: 'string', required: true, description: '用于生成闪卡的学习材料' },
      card_style: {
        type: 'string',
        options: ['经典问答', '填空补全', '概念配对', '判断正误'],
        default: '经典问答',
      },
      count: { type: 'number', default: 10, description: '生成张数' },
    },
  },
  {
    type: 'podcast',
    label: '播客主理人',
    icon: '🎙️',
    description: '把文档内容转成双人播客或讲解音频。',
    params: {
      source_material: { type: 'string', required: true, description: '播客依据的资料' },
      style: { type: 'string', default: '访谈' },
      duration: { type: 'string', default: '5分钟', options: ['3分钟', '5分钟', '8分钟', '10分钟', '15分钟'] },
      host_voice: { type: 'string', default: 'Cherry', description: '主持人音色' },
      guest_voice: { type: 'string', default: 'Serena', description: '嘉宾音色' },
    },
  },
  {
    type: 'invoice',
    label: '财务发票识别',
    icon: '🧾',
    description: '从文本、图片 URL 或 PDF URL 中提取发票结构化信息。',
    params: {
      text: { type: 'string', required: false, description: '已有票据文本' },
      image_urls: { type: 'array', required: false, description: '发票图片 URL，每行一个' },
      pdf_url: { type: 'string', required: false, description: 'PDF 文件 URL' },
      pdf_name: { type: 'string', default: 'invoice.pdf' },
      category_hint: { type: 'string', default: '通用', description: '费用类别提示' },
    },
  },
  {
    type: 'digihuman',
    label: '数字人生成器',
    icon: '👤',
    description: '用人物图片和音频生成数字人视频。',
    params: {
      image_url: { type: 'string', required: true, description: '人物图片 URL' },
      audio_url: { type: 'string', required: true, description: '音频 URL' },
      resolution: { type: 'string', options: ['480P', '720P'], default: '480P' },
    },
  },
  {
    type: 'videoagent',
    label: '视频生成器',
    icon: '🎬',
    description: 'DashScope 多模式视频生成，支持文生、首尾帧、参考生。',
    params: {
      video_type: { type: 'string', options: ['i2v', 't2v', 'r2v'], required: true, default: 't2v' },
      prompt: { type: 'string', required: false, description: '视频提示词' },
      resolution: { type: 'string', options: ['480P', '720P', '1080P'], default: '720P' },
      first_frame_url: { type: 'string', required: false, description: '首帧图片 URL' },
      last_frame_url: { type: 'string', required: false, description: '尾帧图片 URL' },
      size: { type: 'string', required: false, description: '画面尺寸，例如 1280*720' },
      duration: { type: 'number', default: 5 },
      shot_type: { type: 'string', options: ['single', 'multi'], required: false },
      reference_urls: { type: 'array', required: false, description: '参考图 URL，每行一个' },
      audio: { type: 'boolean', default: true },
    },
  },
  {
    type: 'speech_synth',
    label: '语音合成',
    icon: '🎤',
    description: '文本转 Gemini-3.1-TTS 语音文件。',
    params: {
      text: { type: 'string', required: true, description: '需要合成的文本' },
      voice: { type: 'string', default: 'Achernar', description: 'Gemini 音色英文名' },
      voice_name: { type: 'string', required: false, description: '展示用音色名' },
      model_id: { type: 'string', default: 'gemini-3.1-flash-tts-preview' },
      model_name: { type: 'string', default: 'Gemini-3.1-TTS' },
    },
  },
];

const SEEDANCE_MODELS: ApiModelDefinition[] = [
  {
    name: 'kwvideo-v2',
    type: 'video',
    label: 'Seedance 2.0 首尾帧',
    description: '支持文生视频、首帧图生视频和首尾帧视频，自动生成有声视频。',
    params: {
      prompt: { type: 'string', required: true },
      version: { type: 'string', required: true, default: '标准', options: ['Mini', '快速', '标准'] },
      duration: {
        type: 'string',
        required: true,
        default: '5',
        options: ['auto', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'],
      },
      aspect_ratio: {
        type: 'string',
        default: 'adaptive',
        options: ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'],
      },
      resolution: { type: 'string', required: true, default: '720p', options: ['480p', '720p', '1080p', '4K'] },
      images: { type: 'upload', required: false, description: '0 张为文生视频，1 张为首帧，2 张为首尾帧' },
    },
  },
  {
    name: 'kwvideo-v2-ref',
    type: 'video',
    label: 'Seedance 2.0 参考生',
    description: '支持 1–9 张参考图生成风格和主体一致的视频。',
    params: {
      prompt: { type: 'string', required: true },
      version: { type: 'string', required: true, default: '标准', options: ['Mini', '快速', '标准'] },
      duration: {
        type: 'string',
        required: true,
        default: '5',
        options: ['auto', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'],
      },
      aspect_ratio: {
        type: 'string',
        default: 'adaptive',
        options: ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'],
      },
      resolution: { type: 'string', required: true, default: '720p', options: ['480p', '720p', '1080p', '4K'] },
      images: { type: 'upload', required: true, description: '1–9 张参考图片 URL' },
    },
  },
];

const SUNO_MUSIC_MODEL: ApiModelDefinition = {
  name: 'suno-v4.5',
  type: 'music',
  label: 'Suno Music Generation 4.5',
  description: '根据歌词与音乐描述生成完整人声歌曲或无人声纯音乐，最长支持约 4 分钟。',
  params: {
    mv: {
      type: 'string',
      default: 'chirp-v4-5',
      options: ['chirp-v4-5', 'chirp-v4', 'chirp-v3-5', 'chirp-bluejay'],
    },
    make_instrumental: { type: 'string', default: 'song', options: ['song', 'instrumental'] },
    vocal_gender: { type: 'string', default: 'auto', options: ['auto', 'm', 'f'] },
    sample_rate: { type: 'string', default: '44100', options: ['44100', '48000'] },
    bitrate: { type: 'string', default: '192000', options: ['128000', '192000', '256000'] },
  },
};

const REQUIRED_MEDIA_MODELS = [...SEEDANCE_MODELS, SUNO_MUSIC_MODEL];

const FALLBACK_MODELS: ApiModelDefinition[] = [
  {
    name: 'midjourney',
    type: 'image',
    label: 'Midjourney V6',
    description: '高质量图像生成模型，支持文生图和图生图。',
    params: {
      prompt: { type: 'string', required: true },
      size: { type: 'string', default: '1024x1024', options: ['1024x1024', '16:9', '9:16', '3:4', '4:3'] },
      image_url: { type: 'string', required: false, description: '参考图 URL' },
    },
  },
  {
    name: 'gpt-image-2',
    type: 'image',
    label: 'GPT Image 2',
    description: '支持文生图、参考图 + 文字生成图，适合海报、分镜、产品图与视觉概念探索。',
    params: {
      prompt: { type: 'string', required: true },
      size: {
        type: 'string',
        default: 'auto',
        options: [
          '1152x2048', '2048x1152', '2048x2048', 'auto', '1024x1024',
          '1536x1024', '1024x1536', '2160x3840', '3840x2160',
        ],
      },
      images: { type: 'upload', required: false, description: '参考图片 URL，每行一个，最多 10 张' },
      quality: { type: 'string', default: 'auto', options: ['auto', 'high', 'medium', 'low'] },
    },
  },
  {
    name: 'kling-v1',
    type: 'video',
    label: 'Kling V1',
    description: '高质量短视频生成，支持文本提示和首帧参考图。',
    params: {
      prompt: { type: 'string', required: true },
      duration: { type: 'number', options: [5, 10], default: 5 },
      image_url: { type: 'string', required: false, description: '首帧参考图 URL' },
    },
  },
  ...SEEDANCE_MODELS,
  SUNO_MUSIC_MODEL,
  {
    name: 'suno-v3',
    type: 'music',
    label: 'Suno V3',
    description: '根据歌词或音乐提示生成歌曲、配乐与氛围音乐。',
    params: {
      prompt: { type: 'string', required: true },
      is_music: { type: 'boolean', default: true },
      tags: { type: 'string', required: false, description: '音乐风格标签' },
    },
  },
];

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function apiUrl(path: string, provider?: AgentRequestProvider) {
  const restBase = normalizeBaseUrl(provider?.restBase) || AGENT_REST_BASE;
  return `${restBase}${path}`;
}

function buildHeaders(provider?: AgentRequestProvider, headers?: Record<string, string>) {
  const nextHeaders: Record<string, string> = {
    ...(provider?.headers || {}),
    ...(headers || {}),
  };

  if (provider?.authorization) {
    nextHeaders.Authorization = provider.authorization;
  }

  return nextHeaders;
}

async function requestJson(path: string, init?: RequestInit, provider?: AgentRequestProvider) {
  const res = await fetch(apiUrl(path, provider), init);
  const text = await res.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;

  if (!res.ok) {
    const record = asRecord(payload);
    const message =
      (isString(record.message) && record.message) ||
      (isString(record.detail) && record.detail) ||
      (isString(record.error) && record.error) ||
      `请求失败 (${res.status})`;
    throw new Error(message);
  }

  return payload;
}

function readArray<T>(payload: unknown, key: string): T[] {
  const root = asRecord(payload);
  const data = asRecord(root.data);
  const direct = root[key];
  const nested = data[key];

  if (Array.isArray(direct)) return direct as T[];
  if (Array.isArray(nested)) return nested as T[];
  return [];
}

export async function loadAgentDirectory(provider?: AgentRequestProvider): Promise<AgentDirectory> {
  const [agentsResult, modelsResult] = await Promise.allSettled([
    requestJson('/agents', { headers: buildHeaders(provider) }, provider),
    requestJson('/models', { headers: buildHeaders(provider) }, provider),
  ]);

  const agents =
    agentsResult.status === 'fulfilled'
      ? readArray<ApiAgentDefinition>(agentsResult.value, 'agents')
      : [];
  const models =
    modelsResult.status === 'fulfilled'
      ? readArray<ApiModelDefinition>(modelsResult.value, 'models')
      : [];
  const availableModels = models.length > 0
    ? [
        ...REQUIRED_MEDIA_MODELS.map((requiredModel) => {
          const discovered = models.find((model) => model.name === requiredModel.name);
          return discovered ? { ...discovered, type: requiredModel.type } : requiredModel;
        }),
        ...models.filter((model) =>
          !REQUIRED_MEDIA_MODELS.some((requiredModel) => requiredModel.name === model.name),
        ),
      ]
    : FALLBACK_MODELS;

  const failures = [agentsResult, modelsResult]
    .filter((result) => result.status === 'rejected')
    .map((result) => (result as PromiseRejectedResult).reason)
    .map((reason) => (reason instanceof Error ? reason.message : String(reason)));

  return {
    agents: agents.length > 0 ? agents : FALLBACK_AGENTS,
    models: availableModels,
    usingFallback: agents.length === 0 || models.length === 0,
    error: failures.length > 0 ? failures.join(' / ') : undefined,
  };
}

export function findWorkflowDefinition(directory: AgentDirectory, workflowType: string) {
  return directory.agents.find((agent) => agent.type === workflowType) ?? null;
}

export function findCompatibleModels(directory: AgentDirectory, mediaTypes: string[]) {
  const allowed = new Set(mediaTypes.map((type) => type.toLowerCase()));
  return directory.models.filter((model) => allowed.has(model.type.toLowerCase()));
}

export function isCatalogItemRunnable(agent: AgentCatalogItem, directory: AgentDirectory) {
  if (agent.capability.kind === 'workflow') {
    return Boolean(findWorkflowDefinition(directory, agent.capability.workflowType));
  }
  if (agent.capability.kind === 'media') {
    return findCompatibleModels(directory, agent.capability.mediaTypes).length > 0;
  }
  return false;
}

export async function createAgentTask(payload: GenerateAgentPayload, provider?: AgentRequestProvider) {
  const headers: Record<string, string> = buildHeaders(provider, { 'Content-Type': 'application/json' });
  if (payload.tenantId) headers['X-Tenant-ID'] = payload.tenantId;
  if (payload.userId) headers['X-User-ID'] = payload.userId;

  const body = {
    ...payload,
    tenant_id: payload.tenantId || undefined,
    user_id: payload.userId || undefined,
  };

  const response = await requestJson('/generate', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }, provider);

  const root = asRecord(response);
  const data = asRecord(root.data);
  const taskId = data.task_id ?? data.taskId ?? root.task_id ?? root.taskId;

  if (!isString(taskId)) {
    throw new Error('生成任务已提交，但响应中没有 task_id。');
  }

  return taskId;
}

export async function getAgentTaskStatus(
  taskId: string,
  provider?: AgentRequestProvider,
): Promise<AgentTaskStatus> {
  const response = await requestJson(
    `/status?task_id=${encodeURIComponent(taskId)}`,
    { headers: buildHeaders(provider) },
    provider,
  );
  const root = asRecord(response);
  const data = asRecord(root.data);
  const source = Object.keys(data).length > 0 ? data : root;

  return {
    task_id: isString(source.task_id) ? source.task_id : taskId,
    status: isString(source.status) ? source.status : 'running',
    is_final: typeof source.is_final === 'boolean' ? source.is_final : false,
    progress:
      typeof source.progress === 'string' || typeof source.progress === 'number'
        ? source.progress
        : null,
    current_step: isString(source.current_step) ? source.current_step : null,
    result_url: isString(source.result_url) ? source.result_url : null,
    result_data: source.result_data ?? null,
    result_type: isString(source.result_type) ? source.result_type : undefined,
    cost: typeof source.cost === 'number' ? source.cost : undefined,
    error: isString(source.error) ? source.error : undefined,
  };
}

export function getRunnableCatalogItems(directory: AgentDirectory) {
  return AGENT_CATALOG.filter((agent) => isCatalogItemRunnable(agent, directory));
}
