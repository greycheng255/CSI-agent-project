import { useRef, useState, type ReactNode } from 'react';
import { FileCheck2, Loader2, Play, UploadCloud, X } from 'lucide-react';
import type { AgentParamOption, AgentParamSchema, ApiModelDefinition } from '../../../api/agentMarketApi';
import { uploadAgentAttachments, type AgentUploadedAttachment } from '../../../api/agentUploadApi';
import type { ChoiceOption } from './types';

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
  image_urls: '图片附件',
  pdf_url: 'PDF 附件',
  pdf_name: 'PDF 文件名',
  category_hint: '类别提示',
  image_url: '图片附件',
  audio_url: '音频附件',
  resolution: '分辨率',
  video_type: '视频类型',
  prompt: '提示词',
  first_frame_url: '首帧图片',
  last_frame_url: '尾帧图片',
  size: '画幅/尺寸',
  shot_type: '镜头类型',
  reference_urls: '参考素材',
  audio: '生成声音',
  images: '参考图片',
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

const PLACEHOLDERS: Record<string, string> = {
  source_material: '粘贴文档、资料、会议纪要或知识点...',
  prompt: '描述你希望生成的内容、风格、构图、镜头和限制条件...',
  text: '粘贴发票 OCR 文本或票据内容...',
  image_urls: 'https://example.com/invoice-1.png\nhttps://example.com/invoice-2.png',
  reference_urls: 'https://example.com/ref-1.png\nhttps://example.com/ref-2.png',
  images: 'https://example.com/reference.png',
};

export const VOICE_OPTIONS: ChoiceOption[] = [
  { value: 'Cherry', label: '小樱' },
  { value: 'Serena', label: '晓柔' },
  { value: 'Ethan', label: '沐阳' },
  { value: 'Nofish', label: '阿飞' },
  { value: 'Ryan', label: '瑞安' },
  { value: 'Jennifer', label: '珍妮' },
  { value: 'Katerina', label: '曼云' },
  { value: 'Elias', label: '伊莉' },
];

export const GEMINI_VOICE_OPTIONS: ChoiceOption[] = [
  ['Achernar', '雯雯', '明亮'], ['Achird', '棍棍', '欢快'], ['Algenib', '陆琛', '沉稳'],
  ['Algieba', '阳阳', '沉稳'], ['Alnilam', '昊阳', '激昂'], ['Aoede', '瑶瑶', '青春'],
  ['Autonoe', '正言', '公司'], ['Callirrhoe', '盈盈', '轻快'], ['Charon', '舒然', '轻松'],
  ['Despina', '喵喵', '明亮'], ['Enceladus', '江晓', '气声'], ['Erinome', '明哲', '清晰'],
  ['Fenrir', '裴烈', '轻松自在'], ['Gacrux', '泽润', '平滑'], ['Iapetus', '黛黛', '平滑'],
  ['Kore', '樱樱', '清澈'], ['Laomedeia', '孟琛', '沙哑'], ['Leda', '智远', '信息丰富'],
  ['Orus', '柠柠', '欢快'], ['Pulcherrima', '棠棠', '柔和'], ['Puck', '毅恒', '沉稳'],
  ['Rasalgethi', '程砚', '平稳'], ['Sadachbia', '陈明', '成熟'], ['Sadaltager', '玥玥', '直率'],
  ['Schedar', '高驰', '友好'], ['Sulafat', '韩琮', '随意'], ['Umbriel', '栀栀', '温柔'],
  ['Vindemiatrix', '邵衡', '活泼'], ['Zephyr', '彭越', '知识渊博'], ['Zubenelgenubi', '芷芷', '偏高'],
].map(([value, label, description]) => ({ value, label: `${label} (${value})`, description }));

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
    <div
      className="rounded-xl border px-3.5 py-3 text-[11px] leading-5"
      style={{ borderColor: `${accent}4d`, background: `linear-gradient(135deg, ${accent}14, rgba(255,255,255,0.02))` }}
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5" style={{ color: accent }}>
          {icon}
        </span>
        <div>
          <div className="text-xs font-bold" style={{ color: accent }}>
            {title}
          </div>
          <div className="mt-0.5 text-gray-500">{description}</div>
        </div>
      </div>
    </div>
  );
}

export function PanelLabel({ children }: { children: ReactNode }) {
  return (
    <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.08em] text-gray-500">
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
        className="w-full rounded-lg border border-gray-800 bg-white/[0.03] px-3 py-2.5 text-[11px] text-gray-200 outline-none transition-colors placeholder:text-gray-700 focus:border-green-500"
      />
    </div>
  );
}

const MULTI_ATTACHMENT_FIELDS = new Set(['images', 'image_urls', 'reference_urls']);
const ATTACHMENT_FIELDS = new Set([
  ...MULTI_ATTACHMENT_FIELDS,
  'image_url',
  'audio_url',
  'video_url',
  'pdf_url',
  'first_frame_url',
  'last_frame_url',
  'input_reference',
  'reference_url',
]);

function attachmentAccept(name: string) {
  if (name === 'pdf_url') return 'application/pdf';
  if (name.includes('audio')) return 'audio/*';
  if (name.includes('video')) return 'video/*';
  if (name.includes('image') || name === 'images' || name.includes('frame')) return 'image/*';
  return 'image/*,audio/*,video/*,application/pdf';
}

function splitAttachmentUrls(value: string) {
  return value.split(/\r?\n/).map((url) => url.trim()).filter(Boolean);
}

function fallbackAttachmentName(url: string, index: number) {
  try {
    const path = new URL(url).pathname;
    return decodeURIComponent(path.split('/').filter(Boolean).pop() || `附件 ${index + 1}`);
  } catch {
    return `附件 ${index + 1}`;
  }
}

export function AttachmentUpload({
  label,
  value,
  onChange,
  accept,
  multiple = false,
  maxFiles = multiple ? 10 : 1,
  disabled = false,
  onUploaded,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  accept?: string;
  multiple?: boolean;
  maxFiles?: number;
  disabled?: boolean;
  onUploaded?: (files: AgentUploadedAttachment[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [names, setNames] = useState<Record<string, string>>({});
  const urls = splitAttachmentUrls(value);

  const handleFiles = async (selected: FileList | null) => {
    if (!selected || selected.length === 0 || uploading) return;
    const files = Array.from(selected);
    const availableSlots = multiple ? maxFiles - urls.length : 1;
    if (files.length > availableSlots) {
      setError(`最多上传 ${maxFiles} 个附件`);
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    const oversized = files.find((file) => file.size > 100 * 1024 * 1024);
    if (oversized) {
      setError(`${oversized.name} 超过 100MB`);
      if (inputRef.current) inputRef.current.value = '';
      return;
    }

    setUploading(true);
    setError('');
    try {
      const uploaded = await uploadAgentAttachments(files);
      const uploadedUrls = uploaded.map((file) => file.url);
      const nextUrls = multiple
        ? Array.from(new Set([...urls, ...uploadedUrls]))
        : uploadedUrls.slice(0, 1);
      setNames((current) => ({
        ...current,
        ...Object.fromEntries(uploaded.map((file) => [file.url, file.originalName])),
      }));
      onChange(nextUrls.join('\n'));
      onUploaded?.(uploaded);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : '附件上传失败');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div>
      <PanelLabel>{label}</PanelLabel>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled || uploading || (multiple && urls.length >= maxFiles)}
        onChange={(event) => void handleFiles(event.target.files)}
        className="sr-only"
      />
      <button
        type="button"
        disabled={disabled || uploading || (multiple && urls.length >= maxFiles)}
        onClick={() => inputRef.current?.click()}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-gray-700 bg-white/[0.02] px-3 py-3 text-[11px] font-semibold text-gray-400 transition-colors hover:border-green-500/60 hover:text-green-400 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
        {uploading ? '正在上传到 S3...' : multiple ? `选择附件（${urls.length}/${maxFiles}）` : urls.length ? '重新上传' : '选择附件'}
      </button>
      <p className="mt-1.5 text-[10px] text-gray-600">上传后生成最长 7 天有效的签名访问地址。</p>
      {urls.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {urls.map((url, index) => (
            <div key={url} className="flex items-center gap-2 rounded-lg border border-gray-800 bg-black/30 px-2.5 py-2">
              <FileCheck2 className="h-3.5 w-3.5 shrink-0 text-green-400" />
              <span className="min-w-0 flex-1 truncate text-[10px] text-gray-400">
                {names[url] || fallbackAttachmentName(url, index)}
              </span>
              <button
                type="button"
                onClick={() => onChange(urls.filter((item) => item !== url).join('\n'))}
                className="rounded p-0.5 text-gray-600 hover:text-red-400"
                aria-label="移除附件"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      {error && <p className="mt-1.5 text-[10px] text-red-400">{error}</p>}
    </div>
  );
}

export function PanelSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: ChoiceOption[];
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <PanelLabel>{label}</PanelLabel>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-gray-800 bg-[#0a0a0a] px-3 py-2.5 text-[11px] text-gray-200 outline-none focus:border-green-500"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}{option.description ? ` · ${option.description}` : ''}
          </option>
        ))}
      </select>
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
        className="w-full resize-y rounded-lg border border-gray-800 bg-white/[0.03] px-3 py-2.5 text-[11px] leading-5 text-gray-200 outline-none transition-colors placeholder:text-gray-700 focus:border-green-500"
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
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              className="rounded-full border px-2.5 py-1 text-left text-[11px] transition-colors"
              style={{
                color: active ? accent : '#9ca3af',
                borderColor: active ? `${accent}66` : 'rgb(31 41 55)',
                background: active ? `${accent}15` : 'transparent',
                fontWeight: active ? 600 : 400,
              }}
            >
              <span>{option.label}</span>
              {option.description && <span className="ml-1.5 text-[10px] font-normal text-gray-600">{option.description}</span>}
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
      className="flex w-full items-center justify-between rounded-lg border border-gray-800 bg-white/[0.03] px-3 py-2.5 text-left"
    >
      <span className="text-[11px] font-semibold text-gray-300">{label}</span>
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
  accent = '#22c55e',
}: {
  label?: string;
  submitting: boolean;
  onSubmit: () => void;
  error: string;
  taskId: string;
  accent?: string;
}) {
  const taskRunning = submitting && Boolean(taskId);

  return (
    <>
      <button
        type="button"
        onClick={onSubmit}
        disabled={submitting}
        className="flex w-full items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-xs font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        style={{ background: `linear-gradient(135deg, ${accent}, ${accent}cc)` }}
      >
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
        {submitting ? (taskRunning ? '任务执行中...' : '提交中...') : label}
      </button>
      {error && !taskId && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-[11px] text-red-300">
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
        className="w-full rounded-lg border border-gray-800 bg-white/[0.03] px-3 py-2.5 text-[11px] text-gray-200 outline-none focus:border-green-500"
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
        <div className="rounded-lg border px-3 py-2.5 text-[11px] leading-5" style={{ borderColor: `${accent}4d`, background: `${accent}10` }}>
          <div className="font-bold" style={{ color: accent }}>
            {selectedModel.label || selectedModel.display_name || selectedModel.name}
          </div>
          <div className="mt-0.5 text-gray-500">{selectedModel.description}</div>
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
    name === 'source_material' ||
    name === 'prompt' ||
    name === 'text';

  if (type === 'upload' || ATTACHMENT_FIELDS.has(name)) {
    const multiple = MULTI_ATTACHMENT_FIELDS.has(name);
    return (
      <AttachmentUpload
        label={`${label}${schema.required ? ' *' : ''}`}
        value={value}
        onChange={onChange}
        accept={attachmentAccept(name)}
        multiple={multiple}
        maxFiles={name === 'reference_urls' ? 9 : 10}
      />
    );
  }

  if (type === 'boolean' || type === 'switch') {
    const checked = value === 'true';
    return (
      <label className="flex items-center justify-between gap-4 rounded-lg border border-gray-800 bg-white/[0.03] px-3 py-2.5">
        <span>
          <span className="block text-[11px] font-semibold text-gray-300">{label}</span>
          {schema.description && <span className="text-[10px] text-gray-600">{schema.description}</span>}
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
        <div className="flex flex-wrap gap-1.5">
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onChange(option.value)}
                className="rounded-full border px-2.5 py-1 text-[11px] transition-colors"
                style={{
                  color: active ? accent : '#9ca3af',
                  borderColor: active ? `${accent}66` : 'rgb(31 41 55)',
                  background: active ? `${accent}15` : 'transparent',
                  fontWeight: active ? 600 : 400,
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        {schema.description && <p className="mt-1.5 text-[10px] text-gray-600">{schema.description}</p>}
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
          rows={name === 'source_material' || name === 'prompt' || name === 'text' ? 7 : 4}
          placeholder={PLACEHOLDERS[name] || schema.description || label}
          className="w-full resize-y rounded-lg border border-gray-800 bg-white/[0.03] px-3 py-2.5 text-[11px] leading-5 text-gray-200 outline-none transition-colors placeholder:text-gray-700 focus:border-green-500"
        />
      ) : (
        <input
          value={value}
          type={type === 'number' ? 'number' : 'text'}
          onChange={(event) => onChange(event.target.value)}
          placeholder={schema.description || label}
          className="w-full rounded-lg border border-gray-800 bg-white/[0.03] px-3 py-2.5 text-[11px] text-gray-200 outline-none transition-colors placeholder:text-gray-700 focus:border-green-500"
        />
      )}
      {schema.description && <p className="mt-1.5 text-[10px] text-gray-600">{schema.description}</p>}
    </div>
  );
}
