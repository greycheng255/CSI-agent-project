import { Brain } from 'lucide-react';
import type { AgentPanelProps } from './types';
import { ChoicePills, PanelHeader, PanelTextarea, SubmitBlock } from './shared';

export default function MindmapPlugin(props: AgentPanelProps) {
  return (
    <div className="space-y-5">
      <PanelHeader
        icon={<Brain className="h-5 w-5" />}
        title="思维导图"
        description="把复杂素材提炼成层级节点，输出结构化树和大纲。"
        accent={props.accent}
      />
      <PanelTextarea
        label="素材内容"
        value={props.formValues.sourceMaterial || ''}
        onChange={(value) => props.updateField('sourceMaterial', value)}
        placeholder="粘贴需要结构化的文档、报告或知识内容..."
        rows={9}
      />
      <ChoicePills
        label="布局"
        value={props.formValues.layout || 'mindmap'}
        accent={props.accent}
        onChange={(value) => props.updateField('layout', value)}
        options={[
          { value: 'mindmap', label: '思维导图' },
          { value: 'dendrogram', label: '辐射图' },
          { value: 'fishbone', label: '鱼骨图' },
        ]}
      />
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
      />
    </div>
  );
}
