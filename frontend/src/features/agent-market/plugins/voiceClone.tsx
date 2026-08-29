import { AlertTriangle, Mic2 } from 'lucide-react';
import type { AgentPanelProps } from './types';
import { PanelHeader } from './shared';

export default function VoiceClonePlugin(props: AgentPanelProps) {
  return (
    <div className="space-y-3">
      <PanelHeader
        icon={<Mic2 className="h-5 w-5" />}
        title="声音克隆"
        description="OpenNotebook 管理端已有声音克隆交互，但公共 Agent Runs API 尚未暴露对应 agent 或 media model。"
        accent={props.accent}
      />
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <div className="text-[11px] leading-5 text-gray-400">
            <div className="font-semibold text-amber-300">当前不能通过 `/api/v1/agent-runs` 提交</div>
            <p className="mt-1">
              OpenNotebook 自有前端使用附件上传和服务端 action 保存克隆音色；这不是公开 Agent API 合约。
              因此 CSI 不再把 `sourceAudioUrl`、`prompt`、`format` 伪装成可执行参数。
            </p>
          </div>
        </div>
      </div>
      <div className="grid gap-2 md:grid-cols-3">
        {[
          ['音色名称', '公开 API 待提供'],
          ['复刻音频', '必填，10 秒至 5 分钟'],
          ['参考音频', '可选，8 秒以内'],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-gray-800 bg-white/[0.03] px-3 py-2.5">
            <div className="font-mono text-[9px] uppercase tracking-[0.08em] text-gray-600">{label}</div>
            <div className="mt-1 text-[11px] text-gray-300">{value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
