import { Music } from 'lucide-react';
import type { AgentPanelProps } from './types';
import {
  ModelSummary,
  PanelHeader,
  PanelInput,
  PanelTextarea,
  SubmitBlock,
  ToggleOption,
} from './shared';

export default function MusicPlugin(props: AgentPanelProps) {
  return (
    <div className="space-y-5">
      <PanelHeader
        icon={<Music className="h-5 w-5" />}
        title="配乐生成"
        description="根据歌词、情绪和风格标签生成音乐、背景配乐或氛围音效。"
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
        label="音乐提示词/歌词"
        value={props.prompt}
        onChange={props.setPrompt}
        placeholder="一首轻松的城市民谣，带吉他，适合夜晚散步..."
        rows={7}
      />
      <PanelInput
        label="风格标签"
        value={props.formValues.tags || ''}
        onChange={(value) => props.updateField('tags', value)}
        placeholder="folk, acoustic, chill"
      />
      <ToggleOption
        label="按歌曲生成"
        value={(props.formValues.is_music || 'true') === 'true'}
        accent={props.accent}
        onChange={(value) => props.updateField('is_music', String(value))}
      />
      <SubmitBlock
        submitting={props.submitting}
        onSubmit={props.onSubmit}
        error={props.runError}
        taskId={props.taskId}
        label="开始生成配乐"
      />
    </div>
  );
}
