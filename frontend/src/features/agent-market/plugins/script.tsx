import { useState } from 'react';
import { FileText, Sparkles } from 'lucide-react';
import type { AgentPanelProps } from './types';
import { ChoicePills, LocalResult, PanelHeader, PanelTextarea } from './shared';

export default function ScriptPlugin({ accent }: AgentPanelProps) {
  const [topic, setTopic] = useState('');
  const [format, setFormat] = useState('short-video');
  const [tone, setTone] = useState('sharp');
  const [result, setResult] = useState('');

  const handleRun = () => {
    const title = topic.trim() || '未命名脚本需求';
    setResult(`# 脚本任务包

主题：${title}

形式：${format}
语气：${tone}

## 开场 Hook
用一个结果、冲突或问题切入，前 3 秒给出明确收益。

## 主体结构
1. 背景：交代受众正在遇到的问题。
2. 转折：给出关键洞察或解决路径。
3. 展示：拆成 3 个镜头/段落，每段只保留一个信息点。

## 结尾 CTA
给出下一步动作，并预留字幕重点词。

## 可交付格式
- 口播稿
- 镜头脚本
- 字幕重点词
- B-roll/素材建议`);
  };

  return (
    <div className="space-y-5">
      <PanelHeader
        icon={<FileText className="h-5 w-5" />}
        title="脚本大师"
        description="当前第三方目录未暴露脚本工作流，先生成可复制的脚本任务包。"
        accent={accent}
      />
      <PanelTextarea
        label="脚本需求"
        value={topic}
        onChange={setTopic}
        placeholder="例如：把产品发布会写成 60 秒短视频脚本..."
        rows={7}
      />
      <ChoicePills
        label="脚本形式"
        value={format}
        accent={accent}
        onChange={setFormat}
        options={[
          { value: 'short-video', label: '短视频' },
          { value: 'article', label: '长文' },
          { value: 'ad', label: '广告' },
          { value: 'talk', label: '演讲' },
        ]}
      />
      <ChoicePills
        label="语气"
        value={tone}
        accent={accent}
        onChange={setTone}
        options={[
          { value: 'sharp', label: '直接锋利' },
          { value: 'warm', label: '温和可信' },
          { value: 'funny', label: '轻松幽默' },
          { value: 'premium', label: '高级克制' },
        ]}
      />
      <button
        type="button"
        onClick={handleRun}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-green-500 px-5 py-3 text-sm font-bold text-black hover:bg-green-400"
      >
        <Sparkles className="h-4 w-4" />
        生成脚本任务包
      </button>
      <LocalResult result={result} />
    </div>
  );
}
