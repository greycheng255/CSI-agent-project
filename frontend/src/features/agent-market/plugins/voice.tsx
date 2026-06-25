import { Mic2 } from 'lucide-react';
import type { AgentPanelProps } from './types';
import {
  ChoicePills,
  ModelSummary,
  PanelHeader,
  PanelTextarea,
  SubmitBlock,
  VOICE_OPTIONS,
} from './shared';

export default function VoicePlugin(props: AgentPanelProps) {
  return (
    <div className="space-y-5">
      <PanelHeader
        icon={<Mic2 className="h-5 w-5" />}
        title="语音合成"
        description="把文本合成为旁白、播报、短视频配音或有声阅读素材。"
        accent={props.accent}
      />
      <ModelSummary
        models={props.compatibleModels}
        selectedModelName={props.selectedModelName}
        selectedModel={props.selectedModel}
        setSelectedModelName={props.setSelectedModelName}
        accent={props.accent}
      />
      <PanelTextarea
        label="合成文本"
        value={props.prompt}
        onChange={props.setPrompt}
        placeholder="输入需要朗读的文本..."
        rows={8}
      />
      <ChoicePills
        label="音色"
        value={props.formValues.voice || 'Cherry'}
        accent={props.accent}
        onChange={(value) => props.updateField('voice', value)}
        options={VOICE_OPTIONS}
      />
      <ChoicePills
        label="音频格式"
        value={props.formValues.format || 'mp3'}
        accent={props.accent}
        onChange={(value) => props.updateField('format', value)}
        options={[
          { value: 'mp3', label: 'MP3' },
          { value: 'wav', label: 'WAV' },
        ]}
      />
      <SubmitBlock
        submitting={props.submitting}
        onSubmit={props.onSubmit}
        error={props.runError}
        taskId={props.taskId}
        label="开始合成语音"
      />
    </div>
  );
}
