import type { ReactNode } from 'react';
import { Copy, Loader2, Play } from 'lucide-react';
import type { AgentParamOption, AgentParamSchema, ApiModelDefinition } from '../../../api/agentMarketApi';
import type { ChoiceOption } from './types';

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

const PLACEHOLDERS: Record<string, string> = {
  sourceMaterial: '粘贴文档、资料、会议纪要或知识点...',
  prompt: '描述你希望生成的内容、风格、构图、镜头和限制条件...',
  text: '粘贴发票 OCR 文本或票据内容...',
  imageUrls: 'https://example.com/invoice-1.png\nhttps://example.com/invoice-2.png',
  referenceUrls: 'https://example.com/ref-1.png\nhttps://example.com/ref-2.png',
  images: 'https://example.com/reference.png',
};

export const VOICE_OPTIONS: ChoiceOption[] = [
  { value: 'Cherry', label: '小樱' },
  { value: 'Serena', label: '晓柔' },
  { value: 'Ethan', label: '沐阳' },
  { value: 'Ryan', label: '瑞安' },
  { value: 'Jennifer', label: '珍妮' },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function optionToString(value: unknown) {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

function normalizeOption(option: AgentParamOption): ChoiceOption {
  if (isRecord(option)) {
    const value = optionToString(option.value ?? option.label);
    const label = optionToString(option.label ?? option.value) || value;
    return { value, label };
  }

  return { value: String(option), label: String(option) };
}

function labelFor(name: string, schema?: AgentParamSchema) {
  return schema?.label || FIELD_LABELS[name] || name;
}

export function PanelHeader({
  icon,
  title,
  description,
  accent,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  accent: string;
}) {
  return (
    <div className="rounded-lg border p-4 text-sm leading-6" style={{ borderColor: `${accent}66`, background: `${accent}14` }}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5" style={{ color: accent }}>
          {icon}
        </span>
        <div>
          <div className="font-bold" style={{ color: accent }}>
            {title}
          </div>
          <div className="mt-1 text-gray-400">{description}</div>
        </div>
      </div>
    </div>
  );
}

export function PanelLabel({ children }: { children: ReactNode }) {
  return (
    <label className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-gray-600">
      {children}
    </label>
  );
}

export function PanelInput({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <PanelLabel>{label}</PanelLabel>
      <input
        value={value}
        type={type}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-gray-800 bg-black px-4 py-3 text-sm text-gray-200 outline-none transition-colors placeholder:text-gray-700 focus:border-green-500"
      />
    </div>
  );
}

export function PanelTextarea({
  label,
  value,
  onChange,
  placeholder,
  rows = 6,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <div>
      <PanelLabel>{label}</PanelLabel>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={rows}
        placeholder={placeholder}
        className="w-full resize-y rounded-lg border border-gray-800 bg-black px-4 py-3 text-sm leading-6 text-gray-200 outline-none transition-colors placeholder:text-gray-700 focus:border-green-500"
      />
    </div>
  );
}

export function ChoicePills({
  label,
  value,
  options,
  accent,
  onChange,
}: {
  label: string;
  value: string;
  options: ChoiceOption[];
  accent: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <PanelLabel>{label}</PanelLabel>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              className="rounded-lg border px-3 py-2 text-left text-sm font-bold transition-colors"
              style={{
                color: active ? accent : '#9ca3af',
                borderColor: active ? accent : 'rgb(31 41 55)',
                background: active ? `${accent}18` : '#000',
              }}
            >
              <span>{option.label}</span>
              {option.description && <span className="ml-2 text-xs font-normal text-gray-600">{option.description}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ToggleOption({
  label,
  value,
  accent,
  onChange,
}: {
  label: string;
  value: boolean;
  accent: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className="flex w-full items-center justify-between rounded-lg border border-gray-800 bg-black px-4 py-3 text-left"
    >
      <span className="text-sm font-bold text-gray-300">{label}</span>
      <span
        className="relative h-6 w-11 rounded-full border transition-colors"
        style={{ background: value ? accent : 'rgb(31 41 55)', borderColor: value ? accent : 'rgb(55 65 81)' }}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${value ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </span>
    </button>
  );
}

export function SubmitBlock({
  label = '开始执行',
  submitting,
  onSubmit,
  error,
  taskId,
}: {
  label?: string;
  submitting: boolean;
  onSubmit: () => void;
  error: string;
  taskId: string;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onSubmit}
        disabled={submitting}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-green-500 px-5 py-3 text-sm font-bold text-black transition-colors hover:bg-green-400 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
        {submitting ? '提交中...' : label}
      </button>
      {error && !taskId && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </div>
      )}
    </>
  );
}

export function ModelSelect({
  models,
  selectedModel,
  onChange,
}: {
  models: ApiModelDefinition[];
  selectedModel: string;
  onChange: (modelName: string) => void;
}) {
  return (
    <div>
      <PanelLabel>模型</PanelLabel>
      <select
        value={selectedModel}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-gray-800 bg-black px-4 py-3 text-sm text-gray-200 outline-none focus:border-green-500"
      >
        {models.map((model) => (
          <option key={model.name} value={model.name}>
            {model.label || model.display_name || model.name}
          </option>
        ))}
      </select>
    </div>
  );
}

export function ModelSummary({
  models,
  selectedModelName,
  selectedModel,
  setSelectedModelName,
  accent,
}: {
  models: ApiModelDefinition[];
  selectedModelName: string;
  selectedModel: ApiModelDefinition | null;
  setSelectedModelName: (modelName: string) => void;
  accent: string;
}) {
  if (models.length === 0) return null;

  return (
    <>
      <ModelSelect models={models} selectedModel={selectedModelName} onChange={setSelectedModelName} />
      {selectedModel?.description && (
        <div className="rounded-lg border p-4 text-sm leading-6" style={{ borderColor: `${accent}66`, background: `${accent}12` }}>
          <div className="font-bold" style={{ color: accent }}>
            {selectedModel.label || selectedModel.display_name || selectedModel.name}
          </div>
          <div className="mt-1 text-gray-400">{selectedModel.description}</div>
        </div>
      )}
    </>
  );
}

export function ParamField({
  name,
  schema,
  value,
  accent,
  onChange,
}: {
  name: string;
  schema: AgentParamSchema;
  value: string;
  accent: string;
  onChange: (value: string) => void;
}) {
  const type = schema.type?.toLowerCase() || 'string';
  const label = labelFor(name, schema);
  const options = schema.options?.map(normalizeOption) || [];
  const needsTextarea =
    type === 'array' ||
    type === 'upload' ||
    name === 'sourceMaterial' ||
    name === 'prompt' ||
    name === 'text';

  if (type === 'boolean' || type === 'switch') {
    const checked = value === 'true';
    return (
      <label className="flex items-center justify-between gap-4 rounded-lg border border-gray-800 bg-black px-4 py-3">
        <span>
          <span className="block text-sm font-bold text-gray-300">{label}</span>
          {schema.description && <span className="text-xs text-gray-600">{schema.description}</span>}
        </span>
        <button
          type="button"
          onClick={() => onChange(checked ? 'false' : 'true')}
          className="relative h-6 w-11 rounded-full border transition-colors"
          style={{
            background: checked ? accent : 'rgb(31 41 55)',
            borderColor: checked ? accent : 'rgb(55 65 81)',
          }}
          aria-label={label}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
              checked ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </button>
      </label>
    );
  }

  if (options.length > 0) {
    return (
      <div>
        <PanelLabel>
          {label}
          {schema.required ? ' *' : ''}
        </PanelLabel>
        <div className="flex flex-wrap gap-2">
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onChange(option.value)}
                className="rounded-lg border px-3 py-2 text-sm font-bold transition-colors"
                style={{
                  color: active ? accent : '#9ca3af',
                  borderColor: active ? accent : 'rgb(31 41 55)',
                  background: active ? 'rgba(34,197,94,0.08)' : '#000',
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        {schema.description && <p className="mt-2 text-xs text-gray-600">{schema.description}</p>}
      </div>
    );
  }

  return (
    <div>
      <PanelLabel>
        {label}
        {schema.required ? ' *' : ''}
      </PanelLabel>
      {needsTextarea ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={name === 'sourceMaterial' || name === 'prompt' || name === 'text' ? 7 : 4}
          placeholder={PLACEHOLDERS[name] || schema.description || label}
          className="w-full resize-y rounded-lg border border-gray-800 bg-black px-4 py-3 text-sm leading-6 text-gray-200 outline-none transition-colors placeholder:text-gray-700 focus:border-green-500"
        />
      ) : (
        <input
          value={value}
          type={type === 'number' ? 'number' : 'text'}
          onChange={(event) => onChange(event.target.value)}
          placeholder={schema.description || label}
          className="w-full rounded-lg border border-gray-800 bg-black px-4 py-3 text-sm text-gray-200 outline-none transition-colors placeholder:text-gray-700 focus:border-green-500"
        />
      )}
      {schema.description && <p className="mt-2 text-xs text-gray-600">{schema.description}</p>}
    </div>
  );
}

export function LocalResult({ result }: { result: string }) {
  if (!result) return null;

  return (
    <div className="rounded-xl border border-gray-800 bg-black p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-xs font-bold uppercase tracking-[0.2em] text-gray-600">本地任务包</div>
        <button
          type="button"
          onClick={() => navigator.clipboard.writeText(result)}
          className="inline-flex items-center gap-2 rounded border border-gray-800 px-3 py-1 text-xs text-gray-400 hover:text-green-400"
        >
          <Copy className="h-3.5 w-3.5" />
          复制
        </button>
      </div>
      <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap text-sm leading-6 text-gray-300">{result}</pre>
    </div>
  );
}
