import { Video } from 'lucide-react';
import type { AgentPanelProps } from './types';
import {
  ChoicePills,
  PanelHeader,
  PanelInput,
  PanelTextarea,
  SubmitBlock,
  ToggleOption,
} from './shared';

export default function VideoPlugin(props: AgentPanelProps) {
  const videoType = props.formValues.videoType || 't2v';

  return (
    <div className="space-y-5">
      <PanelHeader
        icon={<Video className="h-5 w-5" />}
        title="多模式视频生成"
        description="支持文生视频、首尾帧视频和参考生视频，结果按工作区写入任务记录。"
        accent={props.accent}
      />
      <ChoicePills
        label="视频模式"
        value={videoType}
        accent={props.accent}
        onChange={(value) => props.updateField('videoType', value)}
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
        <div className="grid gap-4 md:grid-cols-2">
          <PanelInput
            label="首帧图片 URL"
            value={props.formValues.firstFrameUrl || ''}
            onChange={(value) => props.updateField('firstFrameUrl', value)}
          />
          <PanelInput
            label="尾帧图片 URL"
            value={props.formValues.lastFrameUrl || ''}
            onChange={(value) => props.updateField('lastFrameUrl', value)}
          />
        </div>
      )}
      {videoType === 'r2v' && (
        <PanelTextarea
          label="参考图片 URL"
          value={props.formValues.referenceUrls || ''}
          onChange={(value) => props.updateField('referenceUrls', value)}
          placeholder="每行一个参考图 URL"
          rows={4}
        />
      )}
      <div className="grid gap-4 md:grid-cols-2">
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
        <ChoicePills
          label="时长"
          value={props.formValues.duration || '5'}
          accent={props.accent}
          onChange={(value) => props.updateField('duration', value)}
          options={[
            { value: '5', label: '5s' },
            { value: '10', label: '10s' },
            { value: '15', label: '15s' },
          ]}
        />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <PanelInput
          label="画幅/尺寸"
          value={props.formValues.size || ''}
          onChange={(value) => props.updateField('size', value)}
          placeholder="16:9 / 9:16 / 自适应"
        />
        <ChoicePills
          label="镜头"
          value={props.formValues.shotType || 'single'}
          accent={props.accent}
          onChange={(value) => props.updateField('shotType', value)}
          options={[
            { value: 'single', label: '单镜头' },
            { value: 'multi', label: '多镜头' },
          ]}
        />
      </div>
      <ToggleOption
        label="生成声音"
        value={(props.formValues.audio || 'true') === 'true'}
        accent={props.accent}
        onChange={(value) => props.updateField('audio', String(value))}
      />
      <SubmitBlock
        submitting={props.submitting}
        onSubmit={props.onSubmit}
        error={props.runError}
        taskId={props.taskId}
        label="开始生成视频"
      />
    </div>
  );
}
