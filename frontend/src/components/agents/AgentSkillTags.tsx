import type { Agent, AgentCapability, AgentTag } from '../../types/agent';

function labelOfTag(tag: AgentTag) {
  return tag.tag || tag.name || '';
}

export function AgentSkillTags({
  agent,
  limit = 10,
  variant = 'dark',
}: {
  agent: Agent;
  limit?: number;
  variant?: 'dark' | 'light';
}) {
  const capabilityLabels = (agent.capabilities || [])
    .map((cap: AgentCapability) => cap.name)
    .filter(Boolean);
  const tagLabels = (agent.tags || []).map(labelOfTag).filter(Boolean);
  const skillLabels = agent.skills || [];
  const labels = Array.from(new Set([...capabilityLabels, ...tagLabels, ...skillLabels])).slice(0, limit);

  const chipClass =
    variant === 'light'
      ? 'rounded-full bg-[color:var(--background-100)] px-2 py-0.5 text-xs text-[color:var(--text-500)]'
      : 'rounded bg-gray-800/80 px-2 py-1 text-xs text-gray-300';

  if (labels.length === 0) {
    return (
      <span className={`text-xs ${variant === 'light' ? 'text-[color:var(--text-300)]' : 'text-gray-600'}`}>
        暂无标签
      </span>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {labels.map((label) => (
        <span key={label} className={chipClass}>
          {label}
        </span>
      ))}
    </div>
  );
}
