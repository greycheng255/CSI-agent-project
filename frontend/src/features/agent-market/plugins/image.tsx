import { useState } from 'react';
import { Image } from 'lucide-react';
import type { AgentParamSchema } from '../../../api/agentMarketApi';
import type { AgentPanelProps } from './types';
import {
  AttachmentUpload,
  ChoicePills,
  ModelSelect,
  PanelHeader,
  PanelTextarea,
  SubmitBlock,
} from './shared';

const SIZE_LABELS: Record<string, string> = {
  auto: '自适应',
  '1024x1024': '1:1 正方形',
  '1536x1024': '3:2 横版',
  '1024x1536': '2:3 竖版',
  '2048x1152': '2K 横版',
  '1152x2048': '2K 竖版',
  '2048x2048': '2K 正方形',
  '3840x2160': '4K 横版',
  '2160x3840': '4K 竖版',
  '16:9': '16:9 横版',
  '9:16': '9:16 竖版',
  '3:4': '3:4 竖版',
  '4:3': '4:3 横版',
};

function optionValues(schema: AgentParamSchema | undefined, fallback: string[]) {
  const values = (schema?.options || []).map((option) => {
    if (typeof option === 'object') return option.value ?? option.label ?? '';
    return option;
  }).filter((value) => value !== '');
  return (values.length > 0 ? values : fallback).map(String);
}

export default function ImagePlugin(props: AgentPanelProps) {
  const params = props.selectedModel?.params || {};
  const referenceField = 'images' in params ? 'images' : 'image_url' in params ? 'image_url' : '';
  const [mode, setMode] = useState<'t2i' | 'i2i'>(
    props.formValues.images || props.formValues.image_url ? 'i2i' : 't2i',
  );
  const sizeOptions = optionValues(params.size, ['auto']).map((value) => ({
    value,
    label: SIZE_LABELS[value] || value,
  }));
  const qualityOptions = optionValues(params.quality, ['auto', 'high', 'medium', 'low']).map((value) => ({
    value,
    label: ({ auto: '自适应', high: '高', medium: '中', low: '低' } as Record<string, string>)[value] || value,
  }));
  const modelLabel = props.selectedModel?.label || props.selectedModel?.display_name || props.selectedModel?.name || '图片生成';

  return (
    <div className="space-y-3">
      <PanelHeader
        icon={<Image className="h-5 w-5" />}
        title={modelLabel}
        description={props.selectedModel?.description || '支持文生图和参考图生成，适合海报、分镜、产品视觉和概念探索。'}
        accent={props.accent}
      />
      <ModelSelect
        models={props.compatibleModels}
        selectedModel={props.selectedModelName}
        onChange={props.setSelectedModelName}
      />
      {referenceField && (
        <ChoicePills
          label="生成模式"
          value={mode}
          accent={props.accent}
          onChange={(value) => {
            const nextMode = value === 'i2i' ? 'i2i' : 't2i';
            setMode(nextMode);
            if (nextMode === 't2i') {
              props.updateField('images', '');
              props.updateField('image_url', '');
            }
          }}
          options={[
            { value: 't2i', label: '文生图' },
            { value: 'i2i', label: '图文生图' },
          ]}
        />
      )}
      {referenceField && mode === 'i2i' && (
        <AttachmentUpload
          label="参考图片"
          value={props.formValues[referenceField] || ''}
          onChange={(value) => props.updateField(referenceField, value)}
          accept="image/*"
          multiple={referenceField === 'images'}
          maxFiles={10}
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
        options={sizeOptions}
      />
      {'quality' in params && (
        <ChoicePills
          label="图片质量"
          value={props.formValues.quality || 'auto'}
          accent={props.accent}
          onChange={(value) => props.updateField('quality', value)}
          options={qualityOptions}
        />
      )}
      <SubmitBlock
        submitting={props.submitting}
        onSubmit={props.onSubmit}
        error={props.runError}
        taskId={props.taskId}
        label="开始生成图片"
        accent={props.accent}
      />
    </div>
  );
}
