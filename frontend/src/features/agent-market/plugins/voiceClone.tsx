import { Mic2 } from 'lucide-react';
import type { AgentPanelProps } from './types';
import {
  ChoicePills,
  ModelSummary,
  PanelHeader,
  PanelInput,
  PanelTextarea,
  SubmitBlock,
} from './shared';

export default function VoiceClonePlugin(props: AgentPanelProps) {
  return (
    <div className="space-y-5">
      <PanelHeader
        icon={<Mic2 className="h-5 w-5" />}
        title="声音克隆"
        description="提交参考录音 URL 和目标文本，生成贴近参考音色的语音任务。"
        accent={props.accent}
      />
      <ModelSummary
        models={props.compatibleModels}
        selectedModelName={props.selectedModelName}
        selectedModel={props.selectedModel}
        setSelectedModelName={props.setSelectedModelName}
        accent={props.accent}
      />
      <PanelInput
        label="参考录音 URL"
        value={props.formValues.sourceAudioUrl || ''}
        onChange={(value) => props.updateField('sourceAudioUrl', value)}
        placeholder="https://example.com/voice.wav"
      />
      <PanelTextarea
        label="目标文本"
        value={props.prompt}
        onChange={props.setPrompt}
        placeholder="输入需要用参考音色朗读的文本..."
        rows={7}
      />
      <ChoicePills
        label="输出格式"
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
        label="开始克隆声音"
      />
    </div>
  );
}
