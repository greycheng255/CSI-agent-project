import { Video } from 'lucide-react';
import type { AgentPanelProps } from './types';
import { AttachmentUpload, ChoicePills, PanelHeader, SubmitBlock } from './shared';

export default function DigiHumanPlugin(props: AgentPanelProps) {
  return (
    <div className="space-y-3">
      <PanelHeader
        icon={<Video className="h-5 w-5" />}
        title="数字人"
        description="使用人物图片和音频驱动数字人视频。"
        accent={props.accent}
      />
      <AttachmentUpload
        label="人物图片"
        value={props.formValues.image_url || ''}
        onChange={(value) => props.updateField('image_url', value)}
        accept="image/*"
      />
      <AttachmentUpload
        label="口播音频"
        value={props.formValues.audio_url || ''}
        onChange={(value) => props.updateField('audio_url', value)}
        accept="audio/*"
      />
      <ChoicePills
        label="分辨率"
        value={props.formValues.resolution || '480P'}
        accent={props.accent}
        onChange={(value) => props.updateField('resolution', value)}
        options={[
          { value: '480P', label: '480P' },
          { value: '720P', label: '720P' },
        ]}
      />
      <SubmitBlock
        submitting={props.submitting}
        onSubmit={props.onSubmit}
        error={props.runError}
        taskId={props.taskId}
        label="生成数字人"
        accent={props.accent}
      />
    </div>
  );
}
