import { FileText } from 'lucide-react';
import type { AgentPanelProps } from './types';
import { ChoicePills, PanelHeader, PanelTextarea, SubmitBlock } from './shared';

export default function FlashcardPlugin(props: AgentPanelProps) {
  return (
    <div className="space-y-5">
      <PanelHeader
        icon={<FileText className="h-5 w-5" />}
        title="速记卡片"
        description="把学习材料拆成可复习的问答、填空、配对或判断卡片。"
        accent={props.accent}
      />
      <PanelTextarea
        label="学习材料"
        value={props.formValues.sourceMaterial || ''}
        onChange={(value) => props.updateField('sourceMaterial', value)}
        placeholder="粘贴教材、文章、课程笔记或会议纪要..."
        rows={9}
      />
      <ChoicePills
        label="卡片类型"
        value={props.formValues.cardStyle || '经典问答'}
        accent={props.accent}
        onChange={(value) => props.updateField('cardStyle', value)}
        options={['经典问答', '填空补全', '概念配对', '判断正误'].map((value) => ({
          value,
          label: value,
        }))}
      />
      <ChoicePills
        label="张数"
        value={props.formValues.count || '10'}
        accent={props.accent}
        onChange={(value) => props.updateField('count', value)}
        options={['5', '10', '20', '30'].map((value) => ({ value, label: `${value} 张` }))}
      />
      <SubmitBlock
        submitting={props.submitting}
        onSubmit={props.onSubmit}
        error={props.runError}
        taskId={props.taskId}
        label="生成闪卡"
      />
    </div>
  );
}
