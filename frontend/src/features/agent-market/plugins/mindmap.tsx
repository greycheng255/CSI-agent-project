import { Brain, GitFork, Network, Waypoints } from 'lucide-react';
import type { AgentPanelProps } from './types';
import { ChoicePills, PanelHeader, PanelLabel, PanelTextarea, SubmitBlock } from './shared';

const LAYOUT_OPTIONS = [
  { value: 'mindmap', label: '思维导图', icon: Network },
  { value: 'dendrogram', label: '辐射图', icon: Waypoints },
  { value: 'fishbone', label: '鱼骨图', icon: GitFork },
];

export default function MindmapPlugin(props: AgentPanelProps) {
  return (
    <div className="space-y-3">
      <PanelHeader
        icon={<Brain className="h-5 w-5" />}
        title="思维导图"
        description="把复杂素材提炼成层级节点，输出结构化树和大纲。"
        accent={props.accent}
      />
      <PanelTextarea
        label="素材内容"
        value={props.formValues.source_material || ''}
        onChange={(value) => props.updateField('source_material', value)}
        placeholder="粘贴需要结构化的文档、报告或知识内容..."
        rows={9}
      />
      <div>
        <PanelLabel>布局方式</PanelLabel>
        <div className="grid grid-cols-3 gap-2">
          {LAYOUT_OPTIONS.map((option) => {
            const active = (props.formValues.layout || 'mindmap') === option.value;
            const Icon = option.icon;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => props.updateField('layout', option.value)}
                className="flex min-h-20 flex-col items-center justify-center gap-2 rounded-lg border px-2 py-3 text-[11px] transition-colors"
                style={{
                  color: active ? props.accent : '#6b7280',
                  borderColor: active ? `${props.accent}66` : 'rgb(31 41 55)',
                  background: active ? `${props.accent}15` : 'rgba(255,255,255,0.02)',
                  fontWeight: active ? 700 : 400,
                }}
                aria-pressed={active}
              >
                <Icon className="h-5 w-5" strokeWidth={1.8} />
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      <ChoicePills
        label="展开层级"
        value={props.formValues.depth || '0'}
        accent={props.accent}
        onChange={(value) => props.updateField('depth', value)}
        options={[
          { value: '0', label: '自动' },
          { value: '2', label: '2 层' },
          { value: '3', label: '3 层' },
          { value: '4', label: '4 层' },
        ]}
      />
      <SubmitBlock
        submitting={props.submitting}
        onSubmit={props.onSubmit}
        error={props.runError}
        taskId={props.taskId}
        label="生成导图"
        accent={props.accent}
      />
    </div>
  );
}
