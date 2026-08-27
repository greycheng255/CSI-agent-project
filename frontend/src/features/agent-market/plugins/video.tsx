import { Video } from 'lucide-react';
import type { AgentPanelProps, ChoiceOption } from './types';
import {
  AttachmentUpload,
  ChoicePills,
  PanelHeader,
  PanelSelect,
  PanelTextarea,
  SubmitBlock,
} from './shared';

const DURATION_OPTIONS: ChoiceOption[] = [
  { value: 'auto', label: '自动' },
  ...Array.from({ length: 12 }, (_, index) => {
    const seconds = String(index + 4);
    return { value: seconds, label: `${seconds} 秒` };
  }),
];

const ASPECT_RATIO_OPTIONS: ChoiceOption[] = [
  { value: 'adaptive', label: '自适应' },
  { value: '16:9', label: '16:9 横版' },
  { value: '4:3', label: '4:3 横版' },
  { value: '1:1', label: '1:1 方形' },
  { value: '3:4', label: '3:4 竖版' },
  { value: '9:16', label: '9:16 竖版' },
  { value: '21:9', label: '21:9 超宽' },
];

function normalizeResolution(value: string) {
  if (value.toLowerCase() === '4k') return '4K';
  return value.toLowerCase();
}

export default function VideoPlugin(props: AgentPanelProps) {
  const videoType = props.formValues.video_type || 't2v';
  const version = props.formValues.version || '标准';
  const resolution = normalizeResolution(props.formValues.resolution || '720p');
  const supportsHighResolution = version === '标准';
  const modelLabel = videoType === 'r2v' ? 'Seedance 2.0 参考生' : 'Seedance 2.0 首尾帧';

  return (
    <div className="space-y-3">
      <PanelHeader
        icon={<Video className="h-5 w-5" />}
        title={modelLabel}
        description="使用 Seedance 2.0。"
        accent={props.accent}
      />
      <ChoicePills
        label="视频模式"
        value={videoType}
        accent={props.accent}
        onChange={(value) => props.updateField('video_type', value)}
        options={[
          { value: 't2v', label: '文生视频' },
          { value: 'i2v', label: '首尾帧' },
          { value: 'r2v', label: '参考生' },
        ]}
      />
      <PanelTextarea
        label="提示词"
        value={props.prompt}
        onChange={props.setPrompt}
        placeholder="描述场景、动作、镜头、光线、节奏和风格..."
        rows={7}
      />
      {videoType === 'i2v' && (
        <div className="grid gap-4 md:grid-cols-2">
          <AttachmentUpload
            label="首帧图片"
            value={props.formValues.first_frame_url || ''}
            onChange={(value) => props.updateField('first_frame_url', value)}
            accept="image/*"
          />
          <AttachmentUpload
            label="尾帧图片（可选）"
            value={props.formValues.last_frame_url || ''}
            onChange={(value) => props.updateField('last_frame_url', value)}
            accept="image/*"
          />
        </div>
      )}
      {videoType === 'r2v' && (
        <AttachmentUpload
          label="参考图片"
          value={props.formValues.reference_urls || ''}
          onChange={(value) => props.updateField('reference_urls', value)}
          accept="image/*"
          multiple
          maxFiles={9}
        />
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <PanelSelect
          label="速度版本"
          value={version}
          onChange={(value) => {
            props.updateField('version', value);
            if (value !== '标准' && (resolution === '1080p' || resolution === '4K')) {
              props.updateField('resolution', '720p');
            }
          }}
          options={[
            { value: '标准', label: '标准（高质量）' },
            { value: '快速', label: '快速' },
            { value: 'Mini', label: 'Mini' },
          ]}
        />
        <PanelSelect
          label="时长"
          value={props.formValues.duration || '5'}
          onChange={(value) => props.updateField('duration', value)}
          options={DURATION_OPTIONS}
        />
      </div>
      <ChoicePills
        label="分辨率"
        value={resolution}
        accent={props.accent}
        onChange={(value) => props.updateField('resolution', value)}
        options={[
          { value: '480p', label: '480p' },
          { value: '720p', label: '720p' },
          ...(supportsHighResolution
            ? [
                { value: '1080p', label: '1080p' },
                { value: '4K', label: '4K' },
              ]
            : []),
        ]}
      />
      <ChoicePills
        label="画幅比例"
        value={props.formValues.aspect_ratio || 'adaptive'}
        accent={props.accent}
        onChange={(value) => props.updateField('aspect_ratio', value)}
        options={ASPECT_RATIO_OPTIONS}
      />
      <SubmitBlock
        submitting={props.submitting}
        onSubmit={props.onSubmit}
        error={props.runError}
        taskId={props.taskId}
        label="开始生成视频"
        accent={props.accent}
      />
    </div>
  );
}
