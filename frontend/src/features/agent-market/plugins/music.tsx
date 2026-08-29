import { Music, WandSparkles } from 'lucide-react';
import type { AgentPanelProps } from './types';
import {
  ChoicePills,
  PanelHeader,
  ModelSelect,
  PanelInput,
  PanelTextarea,
  SubmitBlock,
} from './shared';

function createDraftLyrics(stylePrompt: string) {
  const cue = stylePrompt
    .replace(/\s+/g, ' ')
    .split(/[，,。.；;：:]/)[0]
    .trim()
    .slice(0, 18) || '新的旋律';
  return `[Verse]\n把${cue}写进夜色里\n微光沿着心跳慢慢靠近\n每一个未说出口的名字\n都在风里变成回音\n\n[Chorus]\n让旋律带我穿过人群\n把昨天留给远去的星\n如果明天还有新的风景\n我会唱着歌继续前行`;
}

export default function MusicPlugin(props: AgentPanelProps) {
  const mode = props.formValues.make_instrumental || 'song';
  const instrumental = mode === 'instrumental';

  return (
    <div className="space-y-3">
      <PanelHeader
        icon={<Music className="h-5 w-5" />}
        title={props.selectedModel?.label || props.selectedModel?.name || '音乐生成'}
        description={props.selectedModel?.description || '输入歌词与音乐描述，生成完整歌曲或无人声纯音乐。'}
        accent={props.accent}
      />
      <ModelSelect
        models={props.compatibleModels}
        selectedModel={props.selectedModelName}
        onChange={props.setSelectedModelName}
      />
      <ChoicePills
        label="生成模式"
        value={mode}
        accent={props.accent}
        onChange={(value) => props.updateField('make_instrumental', value)}
        options={[
          { value: 'song', label: '歌曲模式' },
          { value: 'instrumental', label: '纯音乐模式' },
        ]}
      />
      <div className={instrumental ? '' : 'grid gap-3 md:grid-cols-2'}>
        {!instrumental && (
          <div>
            <PanelTextarea
              label="歌词（可选）"
              value={props.formValues.lyrics || ''}
              onChange={(value) => props.updateField('lyrics', value)}
              placeholder="输入完整歌词；留空时由 Suno 自动创作歌词"
              rows={9}
            />
            <button
              type="button"
              onClick={() => props.updateField('lyrics', createDraftLyrics(props.prompt))}
              className="mt-2 inline-flex items-center gap-1 rounded-full border border-gray-800 px-2 py-1 text-[10px] text-gray-500 hover:border-emerald-500/40 hover:text-emerald-400"
            >
              <WandSparkles className="h-3 w-3" />
              生成歌词草稿
            </button>
          </div>
        )}
        <PanelTextarea
          label="音乐描述"
          value={props.prompt}
          onChange={props.setPrompt}
          placeholder="例如：流行音乐，忧郁女声，钢琴与弦乐，适合下雨的夜晚..."
          rows={9}
        />
      </div>
      <PanelInput
        label="风格标签（可选）"
        value={props.formValues.tags || ''}
        onChange={(value) => props.updateField('tags', value)}
        placeholder="例如：流行、钢琴、女声、电影感"
      />
      <SubmitBlock
        submitting={props.submitting}
        onSubmit={props.onSubmit}
        error={props.runError}
        taskId={props.taskId}
        label="开始生成音乐"
        accent={props.accent}
      />
    </div>
  );
}
