import type { Agent, AgentCapability, AgentTag } from '../../types/agent';

function labelOfTag(tag: AgentTag) {
  return tag.tag || tag.name || '';
}

export function AgentSkillTags({ agent, limit = 10 }: { agent: Agent; limit?: number }) {
  const capabilityLabels = (agent.capabilities || [])
    .map((cap: AgentCapability) => cap.name)
    .filter(Boolean);
  const tagLabels = (agent.tags || []).map(labelOfTag).filter(Boolean);
  const skillLabels = agent.skills || [];
  const labels = Array.from(new Set([...capabilityLabels, ...tagLabels, ...skillLabels])).slice(0, limit);

  if (labels.length === 0) {
    return <span className="text-xs text-gray-600">暂无标签</span>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {labels.map((label) => (
        <span key={label} className="rounded bg-gray-800/80 px-2 py-1 text-xs text-gray-300">
          {label}
        </span>
      ))}
    </div>
  );
}
