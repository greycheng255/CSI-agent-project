import { Copy, FileJson } from 'lucide-react';
import type { AgentCardSummary } from '../../types/agent';
import { AgentCardPreview } from './AgentCardPreview';

type CardSectionAgent = {
  cards?: AgentCardSummary[];
};

export function CardSection({ agent }: { agent: CardSectionAgent }) {
  const cards = agent.cards || [];
  const active = cards.find((card) => card.isActive) || cards[0];

  if (!active) {
    return (
      <section className="rounded-xl border border-gray-800 bg-[#0a0a0a] p-6">
        <h2 className="flex items-center gap-2 text-lg font-bold text-gray-200">
          <FileJson className="h-5 w-5 text-purple-400" />
          Agent Card
        </h2>
        <div className="mt-4 rounded-lg border border-dashed border-gray-800 p-8 text-center text-sm text-gray-500">
          暂无 Agent Card 记录。
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-gray-800 bg-[#0a0a0a] p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-gray-200">
            <FileJson className="h-5 w-5 text-purple-400" />
            Agent Card
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            当前 Card 版本、端点、能力、定价与原始 JSON。
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigator.clipboard.writeText(JSON.stringify(active.cardJson || {}, null, 2))}
          className="inline-flex items-center gap-2 rounded border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:border-gray-500"
        >
          <Copy className="h-4 w-4" />
          复制 JSON
        </button>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-4">
        <Meta label="版本" value={active.version || active.schemaVersion || '-'} />
        <Meta label="Schema" value={active.schemaVersion || '-'} />
        <Meta label="来源" value={sourceLabel(active)} />
        <Meta label="状态" value={active.isActive ? '当前生效' : '历史版本'} />
      </div>

      {active.contentHash && (
        <div className="mt-4">
          <div className="text-xs text-gray-500">内容哈希</div>
          <div className="mt-1 break-all font-mono text-xs text-gray-400">{active.contentHash}</div>
        </div>
      )}

      <div className="mt-5">
        <AgentCardPreview card={active.cardJson || null} compact />
      </div>
    </section>
  );
}

function sourceLabel(card: AgentCardSummary) {
  if (card.source === 'platform') return '平台生成';
  if (card.source === 'remote_fetch') return '远程抓取';
  if (card.source === 'manual') return '手动提交';
  return card.source || '-';
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-black/30 p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 break-all text-sm font-semibold text-gray-200">{value}</div>
    </div>
  );
}
