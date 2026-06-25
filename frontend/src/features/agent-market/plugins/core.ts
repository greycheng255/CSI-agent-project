import type { ComponentType } from 'react';
import type { AgentPanelProps, AgentPluginManifest, AgentPluginMatchContext } from './types';

export type AgentMarketPlugin = {
  manifest: AgentPluginManifest;
  Panel: ComponentType<AgentPanelProps>;
  match?: (context: AgentPluginMatchContext) => boolean;
};

export function defineAgentPlugin(plugin: AgentMarketPlugin) {
  return plugin;
}

function hasIntersection(left: string[] | undefined, right: string[] | undefined) {
  if (!left?.length || !right?.length) return false;
  return left.some((item) => right.includes(item));
}

export function pluginMatches(plugin: AgentMarketPlugin, context: AgentPluginMatchContext) {
  if (plugin.match) return plugin.match(context);

  const { manifest } = plugin;
  const { agent } = context;

  if (manifest.agentIds?.includes(agent.id)) return true;
  if (!manifest.capabilityKinds?.includes(agent.capability.kind)) return false;

  if (agent.capability.kind === 'workflow') {
    return manifest.workflowTypes?.includes(agent.capability.workflowType) ?? true;
  }

  if (agent.capability.kind === 'media') {
    return hasIntersection(manifest.mediaTypes, agent.capability.mediaTypes) || !manifest.mediaTypes?.length;
  }

  return true;
}

export function resolveAgentPlugin(
  plugins: AgentMarketPlugin[],
  context: AgentPluginMatchContext,
  fallback: AgentMarketPlugin,
) {
  const sortedPlugins = [...plugins].sort(
    (left, right) => (right.manifest.priority ?? 0) - (left.manifest.priority ?? 0),
  );

  return sortedPlugins.find((plugin) => pluginMatches(plugin, context)) || fallback;
}
