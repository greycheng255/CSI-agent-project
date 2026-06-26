import { useState } from 'react';
import { BarChart3, Sparkles } from 'lucide-react';
import type { AgentPanelProps } from './types';
import { ChoicePills, LocalResult, PanelHeader, PanelTextarea } from './shared';

export default function DataPlugin({ accent }: AgentPanelProps) {
  const [data, setData] = useState('');
  const [chartType, setChartType] = useState('dashboard');
  const [result, setResult] = useState('');

  const handleRun = () => {
    setResult(`# 数据可视化任务包

目标图表：${chartType}

## 输入数据
${data.trim() || '请补充 CSV、JSON、表格或指标描述。'}

## 叙事结构
1. 顶部核心指标：总量、变化率、异常。
2. 中部趋势：按时间或阶段呈现变化。
3. 底部拆解：按地区、渠道、类型或负责人分组。

## 视觉规则
- 增长用绿色，风险用红色，其他维度保持灰阶。
- 每张图只突出一个结论。
- 图例和单位必须完整。

## 输出建议
返回 chart spec、管理层摘要和可执行动作清单。`);
  };

  return (
    <div className="space-y-5">
      <PanelHeader
        icon={<BarChart3 className="h-5 w-5" />}
        title="数据可视化"
        description="当前第三方目录未暴露数据图表工作流，先整理成可复制的可视化任务包。"
        accent={accent}
      />
      <PanelTextarea
        label="数据/指标"
        value={data}
        onChange={setData}
        placeholder="粘贴 CSV、JSON、表格或业务指标说明..."
        rows={8}
      />
      <ChoicePills
        label="图表目标"
        value={chartType}
        accent={accent}
        onChange={setChartType}
        options={[
          { value: 'dashboard', label: '仪表盘' },
          { value: 'trend', label: '趋势分析' },
          { value: 'infographic', label: '信息图' },
          { value: 'report', label: '汇报页' },
        ]}
      />
      <button
        type="button"
        onClick={handleRun}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-green-500 px-5 py-3 text-sm font-bold text-black hover:bg-green-400"
      >
        <Sparkles className="h-4 w-4" />
        生成可视化任务包
      </button>
      <LocalResult result={result} />
    </div>
  );
}
