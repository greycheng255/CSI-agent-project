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

export type AgentWorkspace = {
  id: string;
  name: string;
  description?: string;
  status?: string;
};

export type GenerateAgentPayload = {
  workspaceId: string;
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

export type AgentRunHistoryItem = AgentTaskStatus & {
  agent: string;
  workspace_id: string;
  input?: unknown;
  created_at?: string;
  completed_at?: string;
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

function firstString(...values: unknown[]) {
  return values.find(isString) as string | undefined;
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
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = text;
    }
  }

  if (!res.ok) {
    const record = asRecord(payload);
    const nestedError = asRecord(record.error);
    const nestedMessage = asRecord(record.message);
    const nestedDetail = asRecord(record.detail);
    const message =
      (isString(record.message) && record.message) ||
      (isString(record.detail) && record.detail) ||
      (isString(record.error) && record.error) ||
      (isString(nestedMessage.message) && nestedMessage.message) ||
      (isString(nestedDetail.message) && nestedDetail.message) ||
      (isString(nestedError.message) && nestedError.message) ||
      (isString(payload) && payload) ||
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
  let directoryPayload: unknown = null;
  let failure = '';
  try {
    directoryPayload = await requestJson(
      '/agents',
      { headers: buildHeaders(provider) },
      provider,
    );
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }

  const root = asRecord(directoryPayload);
  const agents = Array.isArray(root.data)
    ? root.data as ApiAgentDefinition[]
    : readArray<ApiAgentDefinition>(directoryPayload, 'agents');
  const models = readArray<ApiModelDefinition>(directoryPayload, 'models');
  const availableModels = models.length > 0 ? models : FALLBACK_MODELS;

  return {
    agents: agents.length > 0 ? agents : FALLBACK_AGENTS,
    models: availableModels,
    usingFallback: agents.length === 0 || models.length === 0,
    error: failure || undefined,
  };
}

export async function loadAgentWorkspaces(
  provider?: AgentRequestProvider,
): Promise<AgentWorkspace[]> {
  const payload = await requestJson(
    '/workspaces?limit=500',
    { headers: buildHeaders(provider) },
    provider,
  );
  const root = asRecord(payload);
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(root.data)
      ? root.data
      : Array.isArray(root.workspaces)
        ? root.workspaces
        : [];

  return rows.flatMap((row) => {
    const workspace = asRecord(row);
    const id = firstString(workspace.id, workspace.workspace_id);
    if (!id) return [];
    return [{
      id,
      name: firstString(workspace.name, workspace.title) || id,
      description: firstString(workspace.description),
      status: firstString(workspace.status),
    }];
  });
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
  if (!payload.type) throw new Error('缺少智能体类型。');

  const idempotencyKey =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const input = {
    ...(payload.params || {}),
    ...(payload.prompt ? { prompt: payload.prompt } : {}),
    ...(payload.count && payload.count !== 1 ? { count: payload.count } : {}),
  };
  const headers = buildHeaders(provider, {
    'Content-Type': 'application/json',
    'Idempotency-Key': idempotencyKey,
  });
  const body = {
    agent: payload.type,
    agent_version: 'v1',
    workspace_id: payload.workspaceId,
    input,
    ...(payload.model ? { model: payload.model } : {}),
  };

  const response = await requestJson('/agent-runs', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }, provider);

  const root = asRecord(response);
  const data = asRecord(root.data);
  const taskId = firstString(
    data.id,
    data.record_id,
    data.run_id,
    data.task_id,
    root.id,
    root.record_id,
    root.run_id,
    root.task_id,
  );

  if (!isString(taskId)) {
    throw new Error('智能体运行已提交，但响应中没有运行记录 ID。');
  }

  return taskId;
}

export async function getAgentTaskStatus(
  taskId: string,
  provider?: AgentRequestProvider,
): Promise<AgentTaskStatus> {
  const response = await requestJson(
    `/agent-runs/${encodeURIComponent(taskId)}`,
    { headers: buildHeaders(provider) },
    provider,
  );
  const root = asRecord(response);
  const data = asRecord(root.data);
  const source = Object.keys(data).length > 0 ? data : root;
  return normalizeAgentTaskStatus(source, taskId);
}

function normalizeAgentTaskStatus(
  sourceValue: unknown,
  fallbackTaskId: string,
): AgentTaskStatus {
  const source = asRecord(sourceValue);
  const output = source.output ?? source.result_data ?? source.result ?? null;
  const outputRecord = asRecord(output);
  const status = firstString(source.status) || 'running';
  const normalizedStatus = status.toLowerCase();
  const errorRecord = asRecord(source.error);
  const usageRecord = asRecord(source.usage);

  return {
    task_id:
      firstString(source.id, source.record_id, source.run_id, source.task_id) || fallbackTaskId,
    status,
    is_final:
      typeof source.is_final === 'boolean'
        ? source.is_final
        : ['succeeded', 'failed', 'cancelled', 'canceled'].includes(normalizedStatus),
    progress:
      typeof source.progress === 'string' || typeof source.progress === 'number'
        ? source.progress
        : null,
    current_step: firstString(source.current_step, source.step) || null,
    result_url: firstString(
      source.result_url,
      outputRecord.result_url,
      outputRecord.url,
      outputRecord.image_url,
      outputRecord.video_url,
      outputRecord.audio_url,
    ) || null,
    result_data: output,
    result_type: firstString(source.result_type, outputRecord.result_type, outputRecord.type),
    cost:
      typeof source.cost === 'number'
        ? source.cost
        : typeof source.actual_credits === 'number'
          ? source.actual_credits
          : typeof usageRecord.actual_credits === 'number'
            ? usageRecord.actual_credits
            : typeof usageRecord.estimated_credits === 'number'
              ? usageRecord.estimated_credits
          : undefined,
    error: firstString(
      source.error_message,
      source.message,
      source.error,
      errorRecord.message,
      source.error_code,
    ),
  };
}

export async function loadAgentRunHistory(
  workspaceId: string,
  provider?: AgentRequestProvider,
  limit = 50,
): Promise<AgentRunHistoryItem[]> {
  const params = new URLSearchParams({
    workspace_id: workspaceId,
    limit: String(Math.max(1, Math.min(100, limit))),
  });
  const payload = await requestJson(
    `/agent-runs?${params.toString()}`,
    { headers: buildHeaders(provider) },
    provider,
  );
  const root = asRecord(payload);
  const rows = Array.isArray(root.data) ? root.data : [];

  return rows.flatMap((row) => {
    const source = asRecord(row);
    const taskId = firstString(source.id, source.record_id, source.run_id, source.task_id);
    if (!taskId) return [];
    return [{
      ...normalizeAgentTaskStatus(source, taskId),
      agent: firstString(source.agent, source.agent_type) || '',
      workspace_id: firstString(source.workspace_id) || workspaceId,
      input: source.input ?? source.input_params,
      created_at: firstString(source.created_at),
      completed_at: firstString(source.completed_at),
    }];
  });
}

export function getRunnableCatalogItems(directory: AgentDirectory) {
  return AGENT_CATALOG.filter((agent) => isCatalogItemRunnable(agent, directory));
}
