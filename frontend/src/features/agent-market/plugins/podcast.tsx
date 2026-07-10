import { Mic2 } from 'lucide-react';
import type { AgentPanelProps } from './types';
import { ChoicePills, PanelHeader, PanelTextarea, SubmitBlock, VOICE_OPTIONS } from './shared';

export default function PodcastPlugin(props: AgentPanelProps) {
  return (
    <div className="space-y-3">
      <PanelHeader
        icon={<Mic2 className="h-5 w-5" />}
        title="音频播客"
        description="从文档生成播客脚本、时间线和合成音频。"
        accent={props.accent}
      />
      <PanelTextarea
        label="播客素材"
        value={props.formValues.source_material || ''}
        onChange={(value) => props.updateField('source_material', value)}
        placeholder="粘贴文档、访谈提纲、文章或讨论主题..."
        rows={9}
      />
      <div className="grid gap-3 md:grid-cols-2">
        <ChoicePills
          label="节目风格"
          value={props.formValues.style || '访谈'}
          accent={props.accent}
          onChange={(value) => props.updateField('style', value)}
          options={['访谈', '双人对谈', '独白讲解', '圆桌讨论'].map((value) => ({
            value,
            label: value,
          }))}
        />
        <ChoicePills
          label="节目时长"
          value={props.formValues.duration || '5分钟'}
          accent={props.accent}
          onChange={(value) => props.updateField('duration', value)}
          options={['3分钟', '5分钟', '8分钟', '10分钟', '15分钟'].map((value) => ({
            value,
            label: value,
          }))}
        />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <ChoicePills
          label="主持人"
          value={props.formValues.host_voice || 'Cherry'}
          accent={props.accent}
          onChange={(value) => props.updateField('host_voice', value)}
          options={VOICE_OPTIONS}
        />
        <ChoicePills
          label="嘉宾"
          value={props.formValues.guest_voice || 'Serena'}
          accent={props.accent}
          onChange={(value) => props.updateField('guest_voice', value)}
          options={VOICE_OPTIONS}
        />
      </div>
      <SubmitBlock
        submitting={props.submitting}
        onSubmit={props.onSubmit}
        error={props.runError}
        taskId={props.taskId}
        label="生成播客"
        accent={props.accent}
      />
    </div>
  );
}
