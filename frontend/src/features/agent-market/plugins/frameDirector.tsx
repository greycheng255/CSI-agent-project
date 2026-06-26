import { Sparkles } from 'lucide-react';
import type { AgentPanelProps } from './types';
import {
  ChoicePills,
  ModelSummary,
  PanelHeader,
  PanelInput,
  PanelTextarea,
  SubmitBlock,
  ToggleOption,
} from './shared';

export default function FrameDirectorPlugin(props: AgentPanelProps) {
  return (
    <div className="space-y-5">
      <PanelHeader
        icon={<Sparkles className="h-5 w-5" />}
        title="FrameDirector"
        description="一句话生成 brief、脚本、分镜素材、HTML 预览并可继续渲染视频。"
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
        label="视频需求"
        value={props.prompt}
        onChange={props.setPrompt}
        placeholder="为一款国产精品咖啡做 20 秒社交媒体宣传片..."
        rows={7}
      />
      <div className="grid gap-4 md:grid-cols-2">
        <ChoicePills
          label="画面比例"
          value={props.formValues.aspect_ratio || '16:9'}
          accent={props.accent}
          onChange={(value) => props.updateField('aspect_ratio', value)}
          options={[
            { value: '16:9', label: '16:9' },
            { value: '9:16', label: '9:16' },
            { value: '1:1', label: '1:1' },
          ]}
        />
        <PanelInput
          label="视频秒数"
          type="number"
          value={props.formValues.duration_s || '20'}
          onChange={(value) => props.updateField('duration_s', value)}
        />
      </div>
      <ChoicePills
        label="视觉预设"
        value={props.formValues.visual_preset || 'cinematic-promo'}
        accent={props.accent}
        onChange={(value) => props.updateField('visual_preset', value)}
        options={[
          { value: 'cinematic-promo', label: '电影宣传' },
          { value: 'product-demo', label: '产品演示' },
          { value: 'social-kinetic', label: '社媒快剪' },
          { value: 'documentary', label: '纪录片' },
        ]}
      />
      <div className="grid gap-4 md:grid-cols-2">
        <ToggleOption
          label="先生成预览"
          value={(props.formValues.preview_only || 'true') === 'true'}
          accent={props.accent}
          onChange={(value) => props.updateField('preview_only', String(value))}
        />
        <ToggleOption
          label="包含配乐"
          value={(props.formValues.include_bgm || 'true') === 'true'}
          accent={props.accent}
          onChange={(value) => props.updateField('include_bgm', String(value))}
        />
      </div>
      <SubmitBlock
        submitting={props.submitting}
        onSubmit={props.onSubmit}
        error={props.runError}
        taskId={props.taskId}
        label="启动 AI 导演"
      />
    </div>
  );
}
