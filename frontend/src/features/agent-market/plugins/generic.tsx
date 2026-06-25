import { Sparkles } from 'lucide-react';
import type { AgentPanelProps } from './types';
import {
  ModelSummary,
  PanelHeader,
  PanelInput,
  PanelTextarea,
  ParamField,
  SubmitBlock,
} from './shared';

export default function GenericPlugin(props: AgentPanelProps) {
  return (
    <div className="space-y-5">
      {props.selectedModel && (
        <ModelSummary
          models={props.compatibleModels}
          selectedModelName={props.selectedModelName}
          selectedModel={props.selectedModel}
          setSelectedModelName={props.setSelectedModelName}
          accent={props.accent}
        />
      )}
      {props.workflowDefinition?.description && (
        <PanelHeader
          icon={<Sparkles className="h-5 w-5" />}
          title={props.workflowDefinition.label}
          description={props.workflowDefinition.description}
          accent={props.accent}
        />
      )}
      {props.selectedModel && (
        <PanelTextarea
          label="提示词"
          value={props.prompt}
          onChange={props.setPrompt}
          placeholder="输入生成提示词..."
          rows={7}
        />
      )}
      <div className="space-y-5">
        {Object.entries(props.currentParams)
          .filter(([name]) => !(props.selectedModel && name === 'prompt'))
          .map(([name, schema]) => (
            <ParamField
              key={name}
              name={name}
              schema={schema}
              value={props.formValues[name] || ''}
              accent={props.accent}
              onChange={(value) => props.updateField(name, value)}
            />
          ))}
      </div>
      <PanelInput label="生成数量" value={props.count} onChange={props.setCount} type="number" />
      <SubmitBlock
        submitting={props.submitting}
        onSubmit={props.onSubmit}
        error={props.runError}
        taskId={props.taskId}
      />
    </div>
  );
}
