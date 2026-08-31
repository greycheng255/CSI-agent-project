export type AgentColor = 'blue' | 'violet' | 'amber' | 'emerald' | 'pink' | 'cyan';

export type AgentCapability =
  | { kind: 'workflow'; workflowType: string }
  | { kind: 'media'; mediaTypes: string[]; preferredModel?: string }
  | { kind: 'unavailable' };

export type AgentCatalogItem = {
  id: string;
  name: string;
  icon: string;
  color: AgentColor;
  desc: string;
  tags: string[];
  calls: number;
  rating: number;
  capability: AgentCapability;
};

export const AGENT_STYLE: Record<AgentColor, { text: string; bg: string; border: string }> = {
  blue: { text: '#60a5fa', bg: 'rgba(96,165,250,0.12)', border: 'rgba(96,165,250,0.38)' },
  violet: { text: '#a78bfa', bg: 'rgba(167,139,250,0.12)', border: 'rgba(167,139,250,0.38)' },
  amber: { text: '#f59e0b', bg: 'rgba(245,158,11,0.13)', border: 'rgba(245,158,11,0.38)' },
  emerald: { text: '#34d399', bg: 'rgba(52,211,153,0.12)', border: 'rgba(52,211,153,0.36)' },
  pink: { text: '#f472b6', bg: 'rgba(244,114,182,0.12)', border: 'rgba(244,114,182,0.38)' },
  cyan: { text: '#22d3ee', bg: 'rgba(34,211,238,0.12)', border: 'rgba(34,211,238,0.36)' },
};

export const AGENT_CATALOG: AgentCatalogItem[] = [
  {
    id: 'voice',
    name: '语音合成',
    icon: '🎤',
    color: 'violet',
    desc: '文字转语音·多音色·多语言旁白',
    tags: ['音频', 'AI声音'],
    calls: 892,
    rating: 4.8,
    capability: { kind: 'workflow', workflowType: 'speech_synth' },
  },
  {
    id: 'clone',
    name: '声音克隆',
    icon: '🎙️',
    color: 'pink',
    desc: '录音克隆专属音色·声音复刻',
    tags: ['音频', '克隆'],
    calls: 376,
    rating: 4.7,
    capability: { kind: 'unavailable' },
  },
  {
    id: 'video',
    name: '视频生成',
    icon: '🎬',
    color: 'amber',
    desc: '图生视频·文生视频·参考生视频',
    tags: ['视频', '生成'],
    calls: 654,
    rating: 4.7,
    capability: { kind: 'workflow', workflowType: 'videoagent' },
  },
  {
    id: 'music',
    name: '配乐生成',
    icon: '🎵',
    color: 'emerald',
    desc: '情感驱动背景音乐·音效包',
    tags: ['音乐', '氛围'],
    calls: 445,
    rating: 4.8,
    capability: { kind: 'media', mediaTypes: ['music', 'audiogen'], preferredModel: 'suno-v3' },
  },
  {
    id: 'storyboard',
    name: '图片生成',
    icon: '🎨',
    color: 'pink',
    desc: '文生图·图文生图·概念图生成',
    tags: ['图像', '生成'],
    calls: 738,
    rating: 4.9,
    capability: { kind: 'media', mediaTypes: ['image', 'imagegen'], preferredModel: 'gpt-image-2' },
  },
  {
    id: 'flashcard',
    name: '速记卡片',
    icon: '🃏',
    color: 'cyan',
    desc: '知识点提取·闪卡·间隔复习',
    tags: ['学习', '记忆'],
    calls: 923,
    rating: 4.8,
    capability: { kind: 'workflow', workflowType: 'flashcard' },
  },
  {
    id: 'mindmap',
    name: '思维导图',
    icon: '🧠',
    color: 'emerald',
    desc: '文档→结构化思维导图·知识图谱',
    tags: ['图表', '结构化'],
    calls: 687,
    rating: 4.9,
    capability: { kind: 'workflow', workflowType: 'mindmap' },
  },
  {
    id: 'podcast',
    name: '音频播客',
    icon: '🎧',
    color: 'violet',
    desc: '文档→双人播客·深度访谈·圆桌讨论',
    tags: ['音频', '播客'],
    calls: 567,
    rating: 4.8,
    capability: { kind: 'workflow', workflowType: 'podcast' },
  },
  {
    id: 'digihuman',
    name: '数字人',
    icon: '👤',
    color: 'blue',
    desc: '驱动图片并结合音频生成数字人视频',
    tags: ['视频', '数字人'],
    calls: 256,
    rating: 4.8,
    capability: { kind: 'workflow', workflowType: 'digihuman' },
  },
  {
    id: 'invoice',
    name: '财务发票识别',
    icon: '🧾',
    color: 'emerald',
    desc: '图片/PDF/文本票据 OCR·主表+明细结构化提取',
    tags: ['财务', 'OCR', '结构化'],
    calls: 148,
    rating: 4.9,
    capability: { kind: 'workflow', workflowType: 'invoice' },
  },
];

export function getCatalogItem(agentId: string) {
  return AGENT_CATALOG.find((agent) => agent.id === agentId) ?? null;
}
