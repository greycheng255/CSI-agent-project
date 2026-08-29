/* eslint-disable react-refresh/only-export-components -- registry intentionally exports components and resolvers */
import type { ComponentType } from 'react';
import { OPENNOTEBOOK_AGENT_PROVIDER } from '../../../config/api';
import { defineAgentPlugin, resolveAgentPlugin } from './core';
import DigiHumanPlugin from './digihuman';
import FlashcardPlugin from './flashcard';
import GenericPlugin from './generic';
import ImagePlugin from './image';
import InvoicePlugin from './invoice';
import MindmapPlugin from './mindmap';
import MusicPlugin from './music';
import PodcastPlugin from './podcast';
import VideoPlugin from './video';
import VoicePlugin from './voice';
import VoiceClonePlugin from './voiceClone';
import type { AgentPanelProps, AgentPluginProps } from './types';

const genericPlugin = defineAgentPlugin({
  manifest: {
    id: 'genesis.agent-market.generic',
    displayName: '通用参数面板',
    version: '1.0.0',
    description: '根据第三方 Agent API 参数 schema 自动渲染执行面板。',
    entry: 'agent-market.panel',
    category: 'generic',
    provider: OPENNOTEBOOK_AGENT_PROVIDER,
    capabilityKinds: ['workflow', 'media'],
    priority: -100,
  },
  Panel: GenericPlugin,
});

export const agentMarketPlugins = [
  defineAgentPlugin({
    manifest: {
      id: 'genesis.agent-market.image',
      displayName: '图片生成',
      version: '1.0.0',
      description: '文生图、图文生图和图片质量/比例控制面板。',
      entry: 'agent-market.panel',
      category: 'media',
      provider: OPENNOTEBOOK_AGENT_PROVIDER,
      agentIds: ['storyboard'],
      capabilityKinds: ['media'],
      mediaTypes: ['image', 'imagegen'],
      tags: ['image', 'generation'],
      priority: 100,
    },
    Panel: ImagePlugin,
  }),
  defineAgentPlugin({
    manifest: {
      id: 'genesis.agent-market.video',
      displayName: '视频生成',
      version: '1.0.0',
      description: '文生视频、首尾帧视频和参考生视频执行面板。',
      entry: 'agent-market.panel',
      category: 'workflow',
      provider: OPENNOTEBOOK_AGENT_PROVIDER,
      agentIds: ['video'],
      capabilityKinds: ['workflow'],
      workflowTypes: ['videoagent'],
      tags: ['video', 'generation'],
      priority: 100,
    },
    Panel: VideoPlugin,
  }),
  defineAgentPlugin({
    manifest: {
      id: 'genesis.agent-market.voice',
      displayName: '语音合成',
      version: '1.0.0',
      description: 'Gemini TTS 文字转语音、音色、音量和语速面板。',
      entry: 'agent-market.panel',
      category: 'workflow',
      provider: OPENNOTEBOOK_AGENT_PROVIDER,
      agentIds: ['voice'],
      capabilityKinds: ['workflow'],
      workflowTypes: ['speech_synth'],
      tags: ['audio', 'tts'],
      priority: 100,
    },
    Panel: VoicePlugin,
  }),
  defineAgentPlugin({
    manifest: {
      id: 'genesis.agent-market.voice-clone',
      displayName: '声音克隆',
      version: '1.0.0',
      description: 'OpenNotebook 公共 Agent API 尚未开放声音克隆能力。',
      entry: 'agent-market.panel',
      category: 'unavailable',
      provider: OPENNOTEBOOK_AGENT_PROVIDER,
      agentIds: ['clone'],
      capabilityKinds: ['unavailable'],
      tags: ['audio', 'clone'],
      priority: 100,
    },
    Panel: VoiceClonePlugin,
  }),
  defineAgentPlugin({
    manifest: {
      id: 'genesis.agent-market.music',
      displayName: '配乐生成',
      version: '1.0.0',
      description: '音乐提示词、风格标签和音乐模式面板。',
      entry: 'agent-market.panel',
      category: 'media',
      provider: OPENNOTEBOOK_AGENT_PROVIDER,
      agentIds: ['music'],
      capabilityKinds: ['media'],
      mediaTypes: ['music', 'audiogen'],
      tags: ['music', 'audio'],
      priority: 100,
    },
    Panel: MusicPlugin,
  }),
  defineAgentPlugin({
    manifest: {
      id: 'genesis.agent-market.flashcard',
      displayName: '速记卡片',
      version: '1.0.0',
      description: '学习材料转闪卡执行面板。',
      entry: 'agent-market.panel',
      category: 'workflow',
      provider: OPENNOTEBOOK_AGENT_PROVIDER,
      agentIds: ['flashcard'],
      capabilityKinds: ['workflow'],
      workflowTypes: ['flashcard'],
      tags: ['learning', 'memory'],
      priority: 100,
    },
    Panel: FlashcardPlugin,
  }),
  defineAgentPlugin({
    manifest: {
      id: 'genesis.agent-market.mindmap',
      displayName: '思维导图',
      version: '1.0.0',
      description: '素材内容转结构化导图执行面板。',
      entry: 'agent-market.panel',
      category: 'workflow',
      provider: OPENNOTEBOOK_AGENT_PROVIDER,
      agentIds: ['mindmap'],
      capabilityKinds: ['workflow'],
      workflowTypes: ['mindmap'],
      tags: ['diagram', 'structure'],
      priority: 100,
    },
    Panel: MindmapPlugin,
  }),
  defineAgentPlugin({
    manifest: {
      id: 'genesis.agent-market.podcast',
      displayName: '音频播客',
      version: '1.0.0',
      description: '素材转播客脚本和音频任务面板。',
      entry: 'agent-market.panel',
      category: 'workflow',
      provider: OPENNOTEBOOK_AGENT_PROVIDER,
      agentIds: ['podcast'],
      capabilityKinds: ['workflow'],
      workflowTypes: ['podcast'],
      tags: ['podcast', 'audio'],
      priority: 100,
    },
    Panel: PodcastPlugin,
  }),
  defineAgentPlugin({
    manifest: {
      id: 'genesis.agent-market.digihuman',
      displayName: '数字人',
      version: '1.0.0',
      description: '人物图片和音频驱动数字人视频面板。',
      entry: 'agent-market.panel',
      category: 'workflow',
      provider: OPENNOTEBOOK_AGENT_PROVIDER,
      agentIds: ['digihuman'],
      capabilityKinds: ['workflow'],
      workflowTypes: ['digihuman'],
      tags: ['video', 'avatar'],
      priority: 100,
    },
    Panel: DigiHumanPlugin,
  }),
  defineAgentPlugin({
    manifest: {
      id: 'genesis.agent-market.invoice',
      displayName: '财务发票识别',
      version: '1.0.0',
      description: '文本、图片 URL 和 PDF URL 发票识别面板。',
      entry: 'agent-market.panel',
      category: 'workflow',
      provider: OPENNOTEBOOK_AGENT_PROVIDER,
      agentIds: ['invoice'],
      capabilityKinds: ['workflow'],
      workflowTypes: ['invoice'],
      tags: ['finance', 'ocr'],
      priority: 100,
    },
    Panel: InvoicePlugin,
  }),
];

export const agentPanelPlugins: Record<string, ComponentType<AgentPanelProps>> = Object.fromEntries(
  agentMarketPlugins.flatMap((plugin) =>
    (plugin.manifest.agentIds || []).map((agentId) => [agentId, plugin.Panel]),
  ),
) as Record<string, ComponentType<AgentPanelProps>>;

export function resolveAgentMarketPlugin({
  agentId,
  agent,
  workflowDefinition = null,
  compatibleModels = [],
  selectedModel = null,
}: {
  agentId: string;
  agent: AgentPluginProps['agent'];
  workflowDefinition?: AgentPluginProps['workflowDefinition'];
  compatibleModels?: AgentPluginProps['compatibleModels'];
  selectedModel?: AgentPluginProps['selectedModel'];
}) {
  return resolveAgentPlugin(
    agentMarketPlugins,
    {
      agentId,
      agent,
      workflowDefinition,
      compatibleModels,
      selectedModel,
    },
    genericPlugin,
  );
}

export function AgentSpecificPanel({ agentId, agent, ...props }: AgentPluginProps) {
  const plugin = resolveAgentMarketPlugin({ agentId, agent, ...props });
  const Plugin = plugin.Panel;
  return <Plugin {...props} provider={plugin.manifest.provider} />;
}
