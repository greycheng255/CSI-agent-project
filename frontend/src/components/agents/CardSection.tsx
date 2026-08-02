import { useState } from 'react';
import { Check, Copy, FileJson } from 'lucide-react';
import type { AgentCardSummary } from '../../types/agent';
import { AgentCardPreview } from './AgentCardPreview';

type CardSectionAgent = {
  cards?: AgentCardSummary[];
};

type CopyState = 'idle' | 'copied' | 'error';

export function CardSection({ agent }: { agent: CardSectionAgent }) {
  const cards = agent.cards || [];
  const active = cards.find((card) => card.isActive) || cards[0];
  const [copyState, setCopyState] = useState<CopyState>('idle');

  const handleCopy = async () => {
    if (!active) return;

    try {
      await navigator.clipboard.writeText(JSON.stringify(active.cardJson || {}, null, 2));
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1800);
    } catch {
      setCopyState('error');
    }
  };

  if (!active) {
    return (
      <section className="rounded-2xl border border-[color:var(--border)] bg-white p-6">
        <SectionHeading />
        <div className="mt-5 flex min-h-36 flex-col items-center justify-center rounded-xl border border-dashed border-[color:var(--border)] bg-[var(--background-50)] px-6 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--background-100)] text-[var(--text-400)]">
            <FileJson className="h-4 w-4" aria-hidden="true" />
          </span>
          <p className="mt-3 text-sm font-medium text-[var(--text-700)]">暂无 Agent Card</p>
          <p className="mt-1 text-xs text-[var(--text-500)]">生成或同步 Card 后，这里会展示版本、端点与能力配置。</p>
        </div>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-[color:var(--border)] bg-white">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
        <SectionHeading />
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[color:var(--border)] bg-white px-3.5 py-2 text-sm font-medium text-[var(--text-700)] transition-colors hover:border-[var(--brand-300)] hover:bg-[var(--brand-50)] hover:text-[var(--brand-700)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-300)]"
          aria-live="polite"
        >
          {copyState === 'copied' ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
          {copyState === 'copied' ? '已复制' : copyState === 'error' ? '复制失败' : '复制 JSON'}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-px border-y border-[color:var(--border)] bg-[var(--border)] md:grid-cols-4">
        <Meta label="版本" value={active.version || active.schemaVersion || '-'} />
        <Meta label="Schema" value={active.schemaVersion || '-'} />
        <Meta label="来源" value={sourceLabel(active)} />
        <Meta label="状态" value={active.isActive ? '当前生效' : '历史版本'} tone={active.isActive ? 'success' : 'neutral'} />
      </div>

      {active.contentHash && (
        <div className="border-b border-[color:var(--border)] px-5 py-4 sm:px-6">
          <div className="text-xs font-medium text-[var(--text-500)]">内容哈希</div>
          <div className="mt-1 break-all font-mono text-xs leading-5 text-[var(--text-600)]">{active.contentHash}</div>
        </div>
      )}

      <div className="p-5 sm:p-6">
        <AgentCardPreview card={active.cardJson || null} embedded />
      </div>
    </section>
  );
}

function SectionHeading() {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-50)] text-[var(--brand-600)]">
        <FileJson className="h-5 w-5" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <h2 className="text-lg font-bold text-[var(--text-900)]">Agent Card</h2>
        <p className="mt-1 text-sm leading-5 text-[var(--text-500)]">当前版本、服务端点、能力范围与定价配置。</p>
      </div>
    </div>
  );
}

function sourceLabel(card: AgentCardSummary) {
  if (card.source === 'platform') return '平台生成';
  if (card.source === 'remote_fetch') return '远程抓取';
  if (card.source === 'manual') return '手动提交';
  return card.source || '-';
}

function Meta({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'success' }) {
  return (
    <div className="min-w-0 bg-[var(--background-50)] px-4 py-4 sm:px-5">
      <div className="text-xs font-medium text-[var(--text-500)]">{label}</div>
      <div className={`mt-1.5 break-words text-sm font-semibold ${tone === 'success' ? 'text-[var(--state-success-text)]' : 'text-[var(--text-800)]'}`}>
        {value}
      </div>
    </div>
  );
}
