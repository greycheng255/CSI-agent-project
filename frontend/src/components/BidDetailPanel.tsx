import { useState } from 'react';
import { ChevronDown, ChevronUp, Bot, Clock, DollarSign, CheckCircle2, BarChart3, Layers, Code, Database, FileText, Play } from 'lucide-react';

interface MatchedSkill {
  name: string;
  description: string;
  matchScore: number;
}

interface Evaluation {
  baseRate: number;
  estimatedHours: number;
  basePrice: number;
  complexityFactor: number;
  complexity: string;
  complexityCn: string;
  confidence: string;
  minPrice: number;
  maxPrice: number;
  budgetCny: number;
  matchedSkills: MatchedSkill[];
  executionPlan: string[];
  analysis?: string;
}

interface PricingMeta {
  scores?: {
    relevance?: number;
    complexity?: number;
    urgency?: number;
    overall?: number;
  };
  skillHits?: string[];
  params?: {
    minBidRatio?: number;
    maxBidRatio?: number;
    minScore?: number;
  };
  budgetCny?: number | null;
  ratio?: number | null;
  evaluation?: Evaluation;
}

interface Bid {
  id: string;
  priceCny: number;
  planSummary?: string;
  agent?: {
    id: string;
    name: string;
  };
  pricingModel?: string | null;
  createdAt?: string;
  pricingMeta?: PricingMeta | null;
}

interface BidDetailPanelProps {
  bid: Bid;
}

// 执行计划阶段类型
interface ExecutionPhase {
  id: string;
  number: number;
  title: string;
  subtitle: string;
  description: string;
  techStack?: string[];
  progress: number;
  status: 'completed' | 'in_progress' | 'pending';
  details: string[];
}

export function BidDetailPanel({ bid }: BidDetailPanelProps) {
  const [expandedPhases, setExpandedPhases] = useState<string[]>([]);
  const [expandAll, setExpandAll] = useState(false);

  const togglePhase = (phaseId: string) => {
    setExpandedPhases(prev =>
      prev.includes(phaseId)
        ? prev.filter(id => id !== phaseId)
        : [...prev, phaseId]
    );
  };

  const toggleExpandAll = () => {
    if (expandAll) {
      setExpandedPhases([]);
    } else {
      const allPhaseIds = phases.map(p => p.id);
      setExpandedPhases(allPhaseIds);
    }
    setExpandAll(!expandAll);
  };

  // 解析执行计划为结构化数据 - 匹配截图中的格式
  const parseExecutionPlan = (plan: string[]): ExecutionPhase[] => {
    const phases: ExecutionPhase[] = [];
    
    // 定义标准阶段映射
    const phaseMapping: Record<string, { title: string; subtitle: string; techStack?: string[] }> = {
      '需求分析': { 
        title: '需求分析', 
        subtitle: '任务类型：抖音数据采集',
        techStack: []
      },
      '技术方案': { 
        title: '技术方案', 
        subtitle: '技术栈：Python 3.8+ + Requests + BeautifulSoup4 / lxml + JSON / CSV',
        techStack: ['Python 3.8+', 'Requests', 'BeautifulSoup4 / lxml', 'JSON / CSV']
      },
      '页面分析': { 
        title: '页面分析', 
        subtitle: '使用浏览器开发者工具分析目标页面结构',
        techStack: []
      },
      '核心爬取逻辑': { 
        title: '核心爬取逻辑', 
        subtitle: '实现数据抓取和解析',
        techStack: []
      },
      '数据验证': { 
        title: '数据验证', 
        subtitle: '验证爬取数据的完整性和准确性',
        techStack: []
      },
      '交付物': { 
        title: '交付物', 
        subtitle: '提供完整代码、数据样本和使用说明',
        techStack: []
      }
    };
    
    plan.forEach((item, index) => {
      // 匹配 【阶段标题】描述 格式
      const match = item.match(/^【(.+?)】(.+)$/);
      
      if (match) {
        const phaseKey = match[1];
        const phaseContent = match[2];
        
        // 查找映射或使用默认值
        const mapping = phaseMapping[phaseKey] || { 
          title: phaseKey, 
          subtitle: phaseContent.substring(0, 50) + '...',
          techStack: []
        };
        
        // 提取详细步骤（用 ①②③④⑤⑥ 分隔）
        const details: string[] = [];
        const stepMatches = phaseContent.match(/[①②③④⑤⑥⑦⑧][^①②③④⑤⑥⑦⑧]+/g);
        if (stepMatches) {
          stepMatches.forEach(step => {
            const cleanStep = step.trim();
            if (cleanStep) details.push(cleanStep);
          });
        }
        
        phases.push({
          id: `phase-${index}`,
          number: index + 1,
          title: mapping.title,
          subtitle: mapping.subtitle,
          description: phaseContent,
          techStack: mapping.techStack,
          progress: 0, // 报价阶段显示 0%
          status: 'pending',
          details
        });
      } else {
        // 不符合【】格式的，作为简单阶段处理
        phases.push({
          id: `phase-${index}`,
          number: index + 1,
          title: `步骤 ${index + 1}`,
          subtitle: item.substring(0, 40),
          description: item,
          progress: 0,
          status: 'pending',
          details: []
        });
      }
    });
    
    return phases;
  };

  const phases = bid.pricingMeta?.evaluation?.executionPlan
    ? parseExecutionPlan(bid.pricingMeta.evaluation.executionPlan)
    : [];

  // 计算总体进度
  const overallProgress = phases.length > 0 
    ? Math.round(phases.reduce((sum, p) => sum + p.progress, 0) / phases.length)
    : 0;

  return (
    <div className="space-y-6">
      {/* Agent 信息 */}
      <div className="flex items-center gap-4 p-4 bg-gray-900/30 rounded-lg border border-gray-800">
        <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
          <Bot className="w-6 h-6 text-green-500" />
        </div>
        <div className="flex-1">
          <div className="text-lg font-bold text-gray-200">{bid.agent?.name || 'Unknown Agent'}</div>
          <div className="text-xs text-gray-500 font-mono">ID: {bid.agent?.id?.slice(0, 8)}</div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-green-500">¥{bid.priceCny}</div>
          <div className="text-xs text-gray-500">报价金额</div>
        </div>
      </div>

      {/* 评估信息 */}
      {bid.pricingMeta?.evaluation && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-4 bg-gray-900/30 rounded-lg border border-gray-800">
            <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
              <BarChart3 className="w-3 h-3" />
              复杂度
            </div>
            <div className="text-lg font-bold text-gray-200">{bid.pricingMeta.evaluation.complexityCn}</div>
            <div className="text-xs text-gray-500">{bid.pricingMeta.evaluation.complexity}</div>
          </div>
          <div className="p-4 bg-gray-900/30 rounded-lg border border-gray-800">
            <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
              <Clock className="w-3 h-3" />
              预估工时
            </div>
            <div className="text-lg font-bold text-gray-200">{bid.pricingMeta.evaluation.estimatedHours}小时</div>
            <div className="text-xs text-gray-500">约{bid.pricingMeta.evaluation.estimatedHours * 60}分钟</div>
          </div>
          <div className="p-4 bg-gray-900/30 rounded-lg border border-gray-800">
            <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
              <DollarSign className="w-3 h-3" />
              基础费率
            </div>
            <div className="text-lg font-bold text-gray-200">¥{bid.pricingMeta.evaluation.baseRate}/小时</div>
            <div className="text-xs text-gray-500">市场价参考</div>
          </div>
          <div className="p-4 bg-gray-900/30 rounded-lg border border-gray-800">
            <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
              <CheckCircle2 className="w-3 h-3" />
              置信度
            </div>
            <div className="text-lg font-bold text-gray-200">{bid.pricingMeta.evaluation.confidence}</div>
            <div className="text-xs text-gray-500">价格可靠性</div>
          </div>
        </div>
      )}

      {/* 技能匹配 */}
      {bid.pricingMeta?.evaluation?.matchedSkills && bid.pricingMeta.evaluation.matchedSkills.length > 0 && (
        <div className="p-4 bg-gray-900/30 rounded-lg border border-gray-800">
          <h4 className="text-sm font-bold text-gray-300 mb-3 flex items-center gap-2">
            <Code className="w-4 h-4 text-blue-500" />
            匹配技能
          </h4>
          <div className="flex flex-wrap gap-2">
            {bid.pricingMeta.evaluation.matchedSkills.map((skill, idx) => (
              <div key={idx} className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 rounded-full">
                <span className="text-sm text-gray-300">{skill.name}</span>
                <span className="text-xs text-gray-500">{skill.description}</span>
                <span className="text-xs text-green-400">{(skill.matchScore * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 任务执行进度 - 新增 */}
      {phases.length > 0 && (
        <div className="p-4 bg-gray-900/30 rounded-lg border border-gray-800">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-bold text-gray-300 flex items-center gap-2">
              <Clock className="w-4 h-4 text-blue-500" />
              任务执行进度
            </h4>
            <span className="text-sm font-bold text-blue-400">{overallProgress}%</span>
          </div>
          <div className="h-2 bg-gray-800 rounded-full overflow-hidden mb-3">
            <div 
              className="h-full bg-blue-500 rounded-full transition-all duration-500" 
              style={{ width: `${overallProgress}%` }} 
            />
          </div>
          <div className="text-xs text-gray-500">
            预计工时：{bid.pricingMeta?.evaluation?.estimatedHours} 小时 | 复杂度：{bid.pricingMeta?.evaluation?.complexityCn}
          </div>
        </div>
      )}

      {/* 执行计划 - 仿照截图样式 */}
      {phases.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-gray-300 flex items-center gap-2">
              <Layers className="w-4 h-4 text-purple-500" />
              执行计划
              <span className="text-xs text-gray-500 font-normal">({phases.length} 个阶段)</span>
            </h4>
            <button
              onClick={toggleExpandAll}
              className="text-xs text-blue-400 hover:text-blue-300 underline"
            >
              {expandAll ? '全部折叠' : '全部展开'}
            </button>
          </div>
          
          <div className="space-y-2">
            {phases.map((phase) => (
              <div key={phase.id} className="bg-gray-900/30 rounded-lg border border-gray-800 overflow-hidden">
                {/* 阶段头部 - 仿照截图样式 */}
                <button
                  onClick={() => togglePhase(phase.id)}
                  className="w-full p-4 hover:bg-gray-800/50 transition-colors text-left"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 flex-1">
                      <span className="text-sm text-gray-500 mt-0.5">{phase.number}</span>
                      <div className="flex-1">
                        <div className="font-bold text-gray-200">{phase.title}</div>
                        <div className="text-sm text-gray-400 mt-1">{phase.subtitle}</div>
                        
                        {/* 技术栈标签 */}
                        {phase.techStack && phase.techStack.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {phase.techStack.map((tech, idx) => (
                              <span key={idx} className="text-xs px-2 py-0.5 bg-gray-800 text-gray-400 rounded">
                                {tech}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {/* 状态标签 */}
                      <span className={`px-2 py-1 text-xs rounded border ${
                        phase.status === 'completed' 
                          ? 'bg-green-500/10 text-green-400 border-green-500/20' 
                          : phase.status === 'in_progress'
                          ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                          : 'bg-gray-800 text-gray-400 border-gray-700'
                      }`}>
                        {phase.status === 'completed' ? '已完成' : phase.status === 'in_progress' ? '进行中' : '待开始'}
                      </span>
                      
                      {/* 进度 */}
                      <span className="text-xs text-gray-500 w-8 text-right">{phase.progress}%</span>
                      
                      {/* 展开/折叠图标 */}
                      {expandedPhases.includes(phase.id) ? (
                        <ChevronUp className="w-4 h-4 text-gray-500" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-gray-500" />
                      )}
                    </div>
                  </div>
                </button>

                {/* 阶段详情 */}
                {expandedPhases.includes(phase.id) && (
                  <div className="border-t border-gray-800 px-4 pb-4">
                    {/* 阶段进度条 */}
                    <div className="py-3">
                      <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                        <span>阶段进度</span>
                        <span>{phase.progress}%</span>
                      </div>
                      <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-blue-500 rounded-full" 
                          style={{ width: `${phase.progress}%` }} 
                        />
                      </div>
                    </div>

                    {/* 详细步骤 */}
                    {phase.details.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-xs text-gray-500 mb-2">详细步骤</div>
                        {phase.details.map((detail, idx) => (
                          <div key={idx} className="flex items-start gap-2 text-sm text-gray-400">
                            <Play className="w-3 h-3 text-gray-600 mt-0.5 flex-shrink-0" />
                            <span>{detail}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    
                    {/* 完整描述 */}
                    <div className="mt-3 pt-3 border-t border-gray-800">
                      <div className="text-xs text-gray-500 mb-1">完整说明</div>
                      <div className="text-sm text-gray-400">{phase.description}</div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 报价计算明细 */}
      {bid.pricingMeta?.evaluation && (
        <div className="p-4 bg-gray-900/30 rounded-lg border border-gray-800">
          <h4 className="text-sm font-bold text-gray-300 mb-3 flex items-center gap-2">
            <Database className="w-4 h-4 text-yellow-500" />
            报价计算明细
          </h4>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between py-1 border-b border-gray-800">
              <span className="text-gray-500">基础价格计算</span>
              <span className="text-gray-300">
                ¥{bid.pricingMeta.evaluation.baseRate} × {bid.pricingMeta.evaluation.estimatedHours}h = ¥{bid.pricingMeta.evaluation.basePrice}
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-gray-800">
              <span className="text-gray-500">复杂度系数</span>
              <span className="text-gray-300">{bid.pricingMeta.evaluation.complexityFactor}x</span>
            </div>
            <div className="flex justify-between py-1 border-b border-gray-800">
              <span className="text-gray-500">调整后价格</span>
              <span className="text-gray-300">
                ¥{bid.pricingMeta.evaluation.basePrice} × {bid.pricingMeta.evaluation.complexityFactor} = ¥{Math.round(bid.pricingMeta.evaluation.basePrice * bid.pricingMeta.evaluation.complexityFactor)}
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-gray-800">
              <span className="text-gray-500">价格区间</span>
              <span className="text-gray-300">
                ¥{bid.pricingMeta.evaluation.minPrice} - ¥{bid.pricingMeta.evaluation.maxPrice}
              </span>
            </div>
            <div className="flex justify-between py-2 text-base font-bold">
              <span className="text-green-400">最终报价</span>
              <span className="text-green-400 text-xl">¥{bid.priceCny}</span>
            </div>
          </div>
        </div>
      )}

      {/* 技术方案分析 */}
      {bid.pricingMeta?.evaluation?.analysis && (
        <div className="p-4 bg-gray-900/30 rounded-lg border border-gray-800">
          <h4 className="text-sm font-bold text-gray-300 mb-3 flex items-center gap-2">
            <FileText className="w-4 h-4 text-blue-500" />
            技术方案分析
          </h4>
          <div className="text-sm text-gray-400 whitespace-pre-wrap leading-relaxed">
            {bid.pricingMeta.evaluation.analysis.split('\n').map((line, idx) => {
              if (line.startsWith('【') && line.endsWith('】')) {
                return <div key={idx} className="text-green-400 font-bold mt-3 mb-2">{line}</div>;
              }
              if (line.startsWith('### ')) {
                return <div key={idx} className="text-yellow-400 font-semibold mt-2 mb-1">{line.replace('### ', '')}</div>;
              }
              if (line.startsWith('- ')) {
                return <div key={idx} className="ml-4 text-gray-300">• {line.replace('- ', '')}</div>;
              }
              if (/^\d+\./.test(line)) {
                return <div key={idx} className="ml-4 text-gray-300">{line}</div>;
              }
              if (line.trim() === '') {
                return <div key={idx} className="h-2"></div>;
              }
              return <div key={idx} className="text-gray-400">{line}</div>;
            })}
          </div>
        </div>
      )}

      {/* 报价说明 */}
      {bid.planSummary && (
        <div className="p-4 bg-gray-900/30 rounded-lg border border-gray-800">
          <h4 className="text-sm font-bold text-gray-300 mb-2">报价说明</h4>
          <p className="text-sm text-gray-400">{bid.planSummary}</p>
        </div>
      )}
    </div>
  );
}
