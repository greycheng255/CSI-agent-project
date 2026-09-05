import { useEffect } from 'react';
import { Video } from 'lucide-react';
import type { AgentPanelProps, ChoiceOption } from './types';
import {
  AttachmentUpload,
  ChoicePills,
  PanelHeader,
  PanelSelect,
  PanelTextarea,
  SubmitBlock,
  ToggleOption,
} from './shared';

const DURATION_OPTIONS: ChoiceOption[] = [
  { value: '5', label: '5 秒' },
  { value: '10', label: '10 秒' },
];

export default function VideoPlugin(props: AgentPanelProps) {
  const videoType = props.formValues.video_type || 't2v';
  const updateField = props.updateField;

  useEffect(() => {
    if ((videoType === 't2v' || videoType === 'r2v') && !props.formValues.size) {
      updateField('size', '1280*720');
    }
  }, [props.formValues.size, updateField, videoType]);

  return (
    <div className="space-y-3">
      <PanelHeader
        icon={<Video className="h-5 w-5" />}
        title={props.workflowDefinition?.label || 'OpenNotebook 视频生成器'}
        description={props.workflowDefinition?.description || '支持文生、首尾帧和参考图视频生成。'}
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
        value={props.formValues.prompt || ''}
        onChange={(value) => props.updateField('prompt', value)}
        placeholder="描述场景、动作、镜头、光线、节奏和风格..."
        rows={7}
      />
      {videoType === 'i2v' && (
        <div className="grid gap-4">
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
      <div className="grid gap-3">
        <PanelSelect
          label="时长"
          value={props.formValues.duration || '5'}
          onChange={(value) => props.updateField('duration', value)}
          options={DURATION_OPTIONS}
        />
      </div>
      <ChoicePills
        label="分辨率"
        value={props.formValues.resolution || '720P'}
        accent={props.accent}
        onChange={(value) => props.updateField('resolution', value)}
        options={[
          { value: '480P', label: '480P' },
          { value: '720P', label: '720P' },
          { value: '1080P', label: '1080P' },
        ]}
      />
      {(videoType === 't2v' || videoType === 'r2v') && (
        <PanelSelect
          label="画面尺寸"
          value={props.formValues.size || '1280*720'}
          onChange={(value) => props.updateField('size', value)}
          options={[
            { value: '1280*720', label: '1280 × 720（横版）' },
            { value: '720*1280', label: '720 × 1280（竖版）' },
            { value: '960*960', label: '960 × 960（方形）' },
          ]}
        />
      )}
      <PanelSelect
        label="镜头类型"
        value={props.formValues.shot_type || 'single'}
        onChange={(value) => props.updateField('shot_type', value)}
        options={[
          { value: 'single', label: '单镜头' },
          { value: 'multi', label: '多镜头' },
        ]}
      />
      {videoType === 'r2v' && (
        <ToggleOption
          label="生成声音"
          value={(props.formValues.audio || 'true') === 'true'}
          onChange={(value) => props.updateField('audio', String(value))}
          accent={props.accent}
        />
      )}
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
