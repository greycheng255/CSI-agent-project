import { useState } from 'react';
import { Image } from 'lucide-react';
import type { AgentPanelProps } from './types';
import {
  ChoicePills,
  ModelSummary,
  PanelHeader,
  PanelInput,
  PanelTextarea,
  SubmitBlock,
} from './shared';

export default function ImagePlugin(props: AgentPanelProps) {
  const [mode, setMode] = useState<'t2i' | 'i2i'>(props.formValues.images ? 'i2i' : 't2i');

  return (
    <div className="space-y-5">
      <PanelHeader
        icon={<Image className="h-5 w-5" />}
        title="GPT Image 生成"
        description="支持文生图和参考图生成，适合海报、分镜、产品视觉和概念探索。"
        accent={props.accent}
      />
      <ModelSummary
        models={props.compatibleModels}
        selectedModelName={props.selectedModelName}
        selectedModel={props.selectedModel}
        setSelectedModelName={props.setSelectedModelName}
        accent={props.accent}
      />
      <ChoicePills
        label="生成模式"
        value={mode}
        accent={props.accent}
        onChange={(value) => {
          const nextMode = value === 'i2i' ? 'i2i' : 't2i';
          setMode(nextMode);
          if (nextMode === 't2i') props.updateField('images', '');
        }}
        options={[
          { value: 't2i', label: '文生图' },
          { value: 'i2i', label: '图文生图' },
        ]}
      />
      {mode === 'i2i' && (
        <PanelTextarea
          label="参考图片 URL"
          value={props.formValues.images || ''}
          onChange={(value) => props.updateField('images', value)}
          placeholder="每行一个图片 URL，最多 10 张"
          rows={4}
        />
      )}
      <PanelTextarea
        label={mode === 't2i' ? '图片描述' : '图片描述 + 编辑要求'}
        value={props.prompt}
        onChange={props.setPrompt}
        placeholder="描述主体、风格、构图、光线、文字排版和需要保留/改变的细节..."
        rows={7}
      />
      <ChoicePills
        label="图片比例"
        value={props.formValues.size || 'auto'}
        accent={props.accent}
        onChange={(value) => props.updateField('size', value)}
        options={[
          { value: 'auto', label: '自适应' },
          { value: '1024x1024', label: '1:1 正方形' },
          { value: '1536x1024', label: '3:2 横版' },
          { value: '1024x1536', label: '2:3 竖版' },
          { value: '2048x1152', label: '2K 横版' },
          { value: '1152x2048', label: '2K 竖版' },
        ]}
      />
      <ChoicePills
        label="图片质量"
        value={props.formValues.quality || 'auto'}
        accent={props.accent}
        onChange={(value) => props.updateField('quality', value)}
        options={[
          { value: 'auto', label: '自适应' },
          { value: 'high', label: '高' },
          { value: 'medium', label: '中' },
          { value: 'low', label: '低' },
        ]}
      />
      <PanelInput label="生成数量" value={props.count} onChange={props.setCount} type="number" />
      <SubmitBlock
        submitting={props.submitting}
        onSubmit={props.onSubmit}
        error={props.runError}
        taskId={props.taskId}
        label="开始生成图片"
      />
    </div>
  );
}
