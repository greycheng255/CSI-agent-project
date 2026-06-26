import { Video } from 'lucide-react';
import type { AgentPanelProps } from './types';
import { ChoicePills, PanelHeader, PanelInput, SubmitBlock } from './shared';

export default function DigiHumanPlugin(props: AgentPanelProps) {
  return (
    <div className="space-y-5">
      <PanelHeader
        icon={<Video className="h-5 w-5" />}
        title="数字人"
        description="使用人物图片和音频驱动数字人视频。"
        accent={props.accent}
      />
      <PanelInput
        label="人物图片 URL"
        value={props.formValues.imageUrl || ''}
        onChange={(value) => props.updateField('imageUrl', value)}
        placeholder="https://example.com/avatar.png"
      />
      <PanelInput
        label="音频 URL"
        value={props.formValues.audioUrl || ''}
        onChange={(value) => props.updateField('audioUrl', value)}
        placeholder="https://example.com/speech.mp3"
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
      />
    </div>
  );
}
