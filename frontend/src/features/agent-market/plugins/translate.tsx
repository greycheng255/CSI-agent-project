import { useState } from 'react';
import { Languages, Sparkles } from 'lucide-react';
import type { AgentPanelProps } from './types';
import { ChoicePills, LocalResult, PanelHeader, PanelTextarea } from './shared';

export default function TranslatePlugin({ accent }: AgentPanelProps) {
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('English');
  const [tone, setTone] = useState('professional');
  const [result, setResult] = useState('');

  const handleRun = () => {
    setResult(`# 翻译任务包

目标语言：${target}
语气：${tone}

## 待翻译文本
${source.trim() || '请补充原文。'}

## 翻译要求
- 保留原文含义，不逐字硬译。
- 专有名词和品牌名保持一致。
- 数字、日期、单位和引用需逐项校对。
- 如有文化语境，改写为目标语言自然表达。

## 输出格式
1. 译文
2. 术语表
3. 易误译点说明`);
  };

  return (
    <div className="space-y-5">
      <PanelHeader
        icon={<Languages className="h-5 w-5" />}
        title="多语翻译"
        description="当前第三方目录未暴露翻译工作流，先生成专业翻译任务包。"
        accent={accent}
      />
      <PanelTextarea label="原文" value={source} onChange={setSource} placeholder="粘贴需要翻译的文本..." rows={8} />
      <ChoicePills
        label="目标语言"
        value={target}
        accent={accent}
        onChange={setTarget}
        options={[
          { value: 'English', label: 'English' },
          { value: '中文', label: '中文' },
          { value: '日本語', label: '日本語' },
          { value: 'Español', label: 'Español' },
        ]}
      />
      <ChoicePills
        label="语气"
        value={tone}
        accent={accent}
        onChange={setTone}
        options={[
          { value: 'professional', label: '专业' },
          { value: 'natural', label: '自然' },
          { value: 'marketing', label: '营销' },
          { value: 'academic', label: '学术' },
        ]}
      />
      <button
        type="button"
        onClick={handleRun}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-green-500 px-5 py-3 text-sm font-bold text-black hover:bg-green-400"
      >
        <Sparkles className="h-4 w-4" />
        生成翻译任务包
      </button>
      <LocalResult result={result} />
    </div>
  );
}
