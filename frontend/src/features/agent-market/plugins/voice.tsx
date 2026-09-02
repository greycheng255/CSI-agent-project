import { useEffect } from 'react';
import { Mic2 } from 'lucide-react';
import type { AgentPanelProps } from './types';
import {
  GEMINI_VOICE_OPTIONS,
  PanelHeader,
  PanelInput,
  PanelSelect,
  PanelTextarea,
  SubmitBlock,
} from './shared';

export default function VoicePlugin(props: AgentPanelProps) {
  const voice = props.formValues.voice || 'Achernar';
  const updateField = props.updateField;

  useEffect(() => {
    if (!props.formValues.volume) updateField('volume', '50');
    if (!props.formValues.speed) updateField('speed', '1');
    if (!props.formValues.voice_name) {
      const option = GEMINI_VOICE_OPTIONS.find((item) => item.value === voice);
      updateField('voice_name', option?.label || voice);
    }
  }, [props.formValues.speed, props.formValues.voice_name, props.formValues.volume, updateField, voice]);

  return (
    <div className="space-y-3">
      <PanelHeader
        icon={<Mic2 className="h-5 w-5" />}
        title={props.formValues.model_name || 'Gemini-3.1-TTS'}
        description="通过 OpenNotebook speech_synth 工作流把文本合成为旁白、播报、短视频配音或有声阅读素材。"
        accent={props.accent}
      />
      <PanelTextarea
        label="合成文本"
        value={props.formValues.text || ''}
        onChange={(value) => props.updateField('text', value)}
        placeholder="输入需要朗读的文本..."
        rows={6}
      />
      <PanelSelect
        label="音色"
        value={voice}
        onChange={(value) => {
          const option = GEMINI_VOICE_OPTIONS.find((item) => item.value === value);
          props.updateField('voice', value);
          props.updateField('voice_name', option?.label || value);
        }}
        options={GEMINI_VOICE_OPTIONS}
      />
      <div className="grid gap-3">
        <PanelInput
          label="音量（0-100）"
          value={props.formValues.volume || '50'}
          onChange={(value) => props.updateField('volume', value)}
          type="number"
        />
        <PanelInput
          label="语速（0.5-2.0）"
          value={props.formValues.speed || '1'}
          onChange={(value) => props.updateField('speed', value)}
          type="number"
        />
      </div>
      <SubmitBlock
        submitting={props.submitting}
        onSubmit={props.onSubmit}
        error={props.runError}
        taskId={props.taskId}
        label="开始合成语音"
        accent={props.accent}
      />
    </div>
  );
}
