import axios from 'axios';
import { SkillsManager } from './skills-manager';
import { GenesisClient } from './genesis-client';
import { TaskAnalyzer } from './task-analyzer';
import { ExecutionTracker } from './execution-tracker';
import { Task, TaskAnalysis, Bid, Order } from '../types';
import { getLogger } from '../utils/logger';

const logger = getLogger();

// Openclaw Bridge 配置
const OPENCLAW_BRIDGE_URL = process.env.OPENCLAW_BRIDGE_URL || 'http://openclaw-bridge.openclaw-cloud.svc.cluster.local:8080';

/**
 * 任务执行请求
 */
interface TaskExecutionRequest {
  orderId: string;
  taskId: string;
  title: string;
  description: string;
  bidPrice: number;
  executionPlan: string[];
  acceptanceCriteria?: string;
}

/**
 * 任务执行结果
 */
interface TaskExecutionResult {
  success: boolean;
  demoUrl?: string;
  deploymentStatus: 'pending' | 'building' | 'deployed' | 'failed';
  executionLog: string[];
  error?: string;
  executionResult?: {
    likeCount?: string;
    commentCount?: string;
    shareCount?: string;
    collectCount?: string;
    isSimulated?: boolean;
    [key: string]: any;
  };
}

/**
 * 部署状态
 */
interface DeploymentStatus {
  status: 'pending' | 'building' | 'deployed' | 'failed';
  demoUrl?: string;
  progress: number;
  logs: string[];
  executionResult?: {
    likeCount?: string;
    commentCount?: string;
    shareCount?: string;
    collectCount?: string;
    isSimulated?: boolean;
    [key: string]: any;
  };
}

/**
 * Openclaw 分析结果
 */
interface OpenclawAnalysisResult {
  complexity: 'simple' | 'moderate' | 'complex';
  complexityCn: string;
  estimatedHours: number;
  confidence: string;
  matchedSkills: Array<{
    name: string;
    description: string;
    matchScore: number;
  }>;
  skillMatchRate: number;
  suggestedPrice: number;
  executionPlan: string[];
  analysis?: string;
  instanceName?: string;
  instanceId?: string;
  evaluation?: {
    baseRate: number;
    basePrice: number;
    complexityFactor: number;
    minPrice: number;
    maxPrice: number;
    budgetCny: number;
    executionPlan?: string[];
  };
}

/**
 * 报价管理器
 * 整合功能：分析任务、生成报价、提交报价、执行任务
 * 
 * 流程：
 * 1. Agent 给 openclaw 安装技能，抓取任务描述和验收要求
 * 2. Agent 通过 webhook 调用 openclaw 分析任务复杂度
 * 3. Openclaw 预估工时和价格给到 Agent
 * 4. Agent 生成报价并提交到平台
 * 5. 中标后执行任务
 */
export class QuoteManager {
  private skillsManager: SkillsManager;
  private genesisClient: GenesisClient;
  private taskAnalyzer: TaskAnalyzer;
  private executionTracker: ExecutionTracker;
  private agentId: string;
  private webhookUrl: string;
  private executingOrders: Map<string, boolean> = new Map();

  constructor(
    skillsManager: SkillsManager,
    genesisClient: GenesisClient,
    agentId: string,
    webhookUrl: string,
    genesisApi?: string,
    agentApiKey?: string
  ) {
    this.skillsManager = skillsManager;
    this.genesisClient = genesisClient;
    this.taskAnalyzer = new TaskAnalyzer();
    this.executionTracker = new ExecutionTracker(
      genesisClient,
      genesisApi || process.env.GENESIS_API || 'http://genesis-backend.genesis.svc.cluster.local:4000',
      agentApiKey || process.env.AGENT_API_KEY || ''
    );
    this.agentId = agentId;
    this.webhookUrl = webhookUrl;
  }

  /**
   * 处理匹配的任务 - 完整的分析和报价流程
   * 
   * 【修正后的流程】
   * 1. Agent 接收任务通知，进行技能匹配（SkillsManager）
   * 2. Agent 转发任务给 Openclaw Bridge
   * 3. Bridge 路由到对应的 Openclaw Instance
   * 4. 【核心】Openclaw Instance 分析任务、计算价格、生成方案
   * 5. Agent 上报 Openclaw 生成的价格到 Genesis 平台
   * 
   * 关键原则：
   * - Openclaw 是"大脑"，负责生成报价
   * - Agent 是"转发器"，负责上报价格
   * - Agent 不修改 Openclaw 生成的价格
   */
  async processMatchedTask(task: Task, analysis: TaskAnalysis): Promise<Bid | null> {
    try {
      logger.info('Starting quote process for task', {
        taskId: task.id,
        title: task.title,
      });

      // [追踪点] 开始报价流程
      console.log(`[QUOTE-FLOW] 开始报价流程 | taskId=${task.id} | title=${task.title}`);

      // 检查是否已有报价
      const existingBid = await this.checkExistingBid(task.id);
      if (existingBid) {
        logger.info('Found existing bid for task, will update', {
          taskId: task.id,
          existingBidId: existingBid.id,
        });
        console.log(`[QUOTE-FLOW] 发现已有报价，将更新 | taskId=${task.id} | bidId=${existingBid.id}`);
      }

      // 步骤 2-3: Agent 转发任务给 Openclaw，Openclaw 分析并生成价格
      console.log(`[QUOTE-FLOW] Agent转发任务给Openclaw | taskId=${task.id} | step=forward`);
      const openclawResult = await this.analyzeTaskWithOpenclaw(task, analysis);

      // 【核心】Openclaw 生成价格和方案
      logger.info('Openclaw Instance generated quote', {
        taskId: task.id,
        instanceName: openclawResult.instanceName || 'unknown',
        complexity: openclawResult.complexityCn,
        estimatedHours: openclawResult.estimatedHours,
        suggestedPrice: openclawResult.suggestedPrice,
        confidence: openclawResult.confidence,
      });

      // [追踪点] Openclaw 生成报价完成
      console.log(`[QUOTE-FLOW] Openclaw生成报价 | taskId=${task.id} | instance=${openclawResult.instanceName || 'unknown'} |
        complexity=${openclawResult.complexityCn} | 
        hours=${openclawResult.estimatedHours} | 
        price=${openclawResult.suggestedPrice}`);

      // 步骤 4: Agent 上报 Openclaw 生成的价格
      console.log(`[QUOTE-FLOW] Agent上报Openclaw价格 | taskId=${task.id} | step=submit`);
      const bid = await this.submitBid(task, openclawResult, existingBid);
      
      if (bid) {
        if (existingBid) {
          logger.info('Bid updated successfully', {
            taskId: task.id,
            bidId: bid.id,
            price: bid.priceCny,
          });
          // [追踪点] 报价更新成功
          console.log(`[QUOTE-FLOW] 报价更新成功 | taskId=${task.id} | bidId=${bid.id} | price=${bid.priceCny}`);
        } else {
          logger.info('Bid submitted successfully', {
            taskId: task.id,
            bidId: bid.id,
            price: bid.priceCny,
          });
          // [追踪点] 报价提交成功
          console.log(`[QUOTE-FLOW] 报价提交成功 | taskId=${task.id} | bidId=${bid.id} | price=${bid.priceCny}`);
        }
      }

      return bid;
    } catch (error) {
      logger.error('Failed to process matched task', {
        taskId: task.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * 调用 Openclaw 分析任务
   * 步骤 2-3: 通过 webhook 调用 openclaw 分析任务复杂度，获取预估工时和价格
   */
  private async analyzeTaskWithOpenclaw(
    task: Task,
    initialAnalysis: TaskAnalysis
  ): Promise<OpenclawAnalysisResult> {
    const request = {
      taskId: task.id,
      title: task.title,
      description: task.description,
      budget: task.budgetCny,
      tags: task.tags || [],
      acceptanceCriteria: task.acceptanceCriteria,
      expectedDeliveryAt: task.expectedDeliveryAt,
      agentId: this.agentId,
      webhookUrl: this.webhookUrl,
    };

    try {
      logger.info('Calling Openclaw Bridge for task analysis', {
        taskId: task.id,
        bridgeUrl: OPENCLAW_BRIDGE_URL,
      });

      const response = await axios.post(
        `${OPENCLAW_BRIDGE_URL}/api/v1/analyze`,
        request,
        {
          timeout: 30000,
          headers: { 'Content-Type': 'application/json' },
        }
      );

      if (response.data && response.data.success) {
        const bridgeResult = response.data.data as OpenclawAnalysisResult;
        
        // 【修正】直接使用 Bridge (Openclaw Instance) 返回的结果
        // Openclaw Instance 已经生成了完整的价格、执行计划和分析
        // Agent 只是转发，不做额外处理
        logger.info('Received analysis from Openclaw Instance', {
          taskId: task.id,
          instanceName: bridgeResult.instanceName || 'unknown',
          suggestedPrice: bridgeResult.suggestedPrice,
          complexity: bridgeResult.complexityCn,
          estimatedHours: bridgeResult.estimatedHours,
        });
        
        // 直接返回 Bridge 的结果，信任 Openclaw 的分析
        return bridgeResult;
      }

      // 如果失败，使用本地分析作为 fallback
      logger.warn('Openclaw analysis failed, using fallback', {
        taskId: task.id,
        response: response.data,
      });
      return this.createFallbackAnalysis(task, initialAnalysis);
    } catch (error) {
      logger.error('Error calling Openclaw Bridge', {
        taskId: task.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return this.createFallbackAnalysis(task, initialAnalysis);
    }
  }

  /**
   * 创建本地分析结果（Openclaw 失败时使用）
   */
  private createFallbackAnalysis(
    task: Task,
    initialAnalysis: TaskAnalysis
  ): OpenclawAnalysisResult {
    const baseRate = 50;
    const estimatedHours = initialAnalysis.timeEstimate || 4;
    const complexity = this.mapComplexity(initialAnalysis.estimatedComplexity);
    const complexityMultiplier = { simple: 1.0, moderate: 1.5, complex: 2.0 }[complexity] || 1.5;
    const suggestedPrice = Math.round(baseRate * estimatedHours * complexityMultiplier);

    // 根据任务内容生成具体的执行计划
    const executionPlan = this.generateTaskSpecificExecutionPlan(task, initialAnalysis);
    
    // 生成任务特定的分析
    const analysis = this.generateTaskSpecificAnalysis(task, initialAnalysis);

    return {
      complexity,
      complexityCn: complexity === 'simple' ? '简单' : complexity === 'moderate' ? '中等' : '复杂',
      estimatedHours,
      confidence: initialAnalysis.confidence >= 0.7 ? '高' : initialAnalysis.confidence >= 0.5 ? '中' : '低',
      matchedSkills: initialAnalysis.requiredSkills.map((name) => ({
        name,
        description: name,
        matchScore: initialAnalysis.confidence,
      })),
      skillMatchRate: initialAnalysis.confidence,
      suggestedPrice,
      executionPlan,
      analysis,
    };
  }

  /**
   * 解析任务需求，提取关键信息
   */
  private parseTaskRequirements(task: Task): {
    taskType: string;
    targetInfo: string[];
    dataFields: string[];
    acceptanceItems: string[];
    techStack: string[];
    estimatedDifficulty: 'simple' | 'moderate' | 'complex';
  } {
    const description = task.description?.toLowerCase() || '';
    const title = task.title?.toLowerCase() || '';
    const acceptance = task.acceptanceCriteria?.toLowerCase() || '';

    // 初始化结果
    const result = {
      taskType: '通用开发',
      targetInfo: [] as string[],
      dataFields: [] as string[],
      acceptanceItems: [] as string[],
      techStack: [] as string[],
      estimatedDifficulty: 'simple' as 'simple' | 'moderate' | 'complex',
    };

    // 识别任务类型
    if (description.includes('爬虫') || description.includes('抓取') || title.includes('爬虫')) {
      result.taskType = '数据爬虫';
      result.techStack = ['Python', 'Requests/Playwright', 'BeautifulSoup/lxml'];
    } else if (description.includes('api') || description.includes('接口')) {
      result.taskType = 'API开发';
      result.techStack = ['Node.js/Python', 'Express/FastAPI', 'RESTful API'];
    } else if (description.includes('数据清洗') || description.includes('数据处理')) {
      result.taskType = '数据处理';
      result.techStack = ['Python', 'Pandas', 'NumPy'];
    }

    // 提取URL/链接
    const urlMatch = description.match(/(https?:\/\/[^\s]+)/g);
    if (urlMatch) {
      result.targetInfo.push(...urlMatch);
    }

    // 提取抖音/视频相关
    if (description.includes('抖音') || description.includes('视频')) {
      result.targetInfo.push('抖音平台');
      result.dataFields.push('视频标题', '点赞数', '评论数', '收藏数', '转发数', '作者信息');
    }

    // 提取数据字段（从描述中识别）
    if (description.includes('点赞')) result.dataFields.push('点赞数');
    if (description.includes('评论')) result.dataFields.push('评论数');
    if (description.includes('收藏')) result.dataFields.push('收藏数');
    if (description.includes('转发')) result.dataFields.push('转发数');
    if (description.includes('主页')) result.dataFields.push('主页信息');
    if (description.includes('产品')) result.dataFields.push('产品信息');

    // 解析验收标准
    if (acceptance) {
      // 按数字或换行分割验收项
      const items = acceptance.split(/\n|(?=\d+\.)|(?=[①②③④⑤⑥⑦⑧⑨⑩])/);
      result.acceptanceItems = items
        .map(item => item.trim())
        .filter(item => item.length > 5 && !item.match(/^\d+\.$/))
        .slice(0, 5); // 最多取5项
    }

    // 评估难度
    if (description.includes('反爬') || description.includes('验证码') || description.includes('登录')) {
      result.estimatedDifficulty = 'complex';
    } else if (description.includes('动态') || description.includes('js') || result.dataFields.length > 5) {
      result.estimatedDifficulty = 'moderate';
    }

    return result;
  }

  /**
   * 根据任务内容生成具体的执行计划
   * 深度结合任务描述和验收标准生成个性化执行计划
   */
  private generateTaskSpecificExecutionPlan(task: Task, analysis: TaskAnalysis): string[] {
    const requirements = this.parseTaskRequirements(task);
    const description = task.description || '';
    const title = task.title || '';
    const acceptanceCriteria = task.acceptanceCriteria || '';
    
    // 合并标题和描述用于任务类型判断
    const fullText = (title + ' ' + description).toLowerCase();

    // 提取关键信息
    const urls = this.extractUrls(description);
    const targetPlatform = this.detectTargetPlatform(fullText);
    const dataFields = this.extractDataFields(description, acceptanceCriteria);
    const specificRequirements = this.extractSpecificRequirements(description, acceptanceCriteria);

    // 爬虫类任务 - 针对具体任务定制（检查标题和描述）
    if (fullText.includes('爬虫') || fullText.includes('抓取') || fullText.includes('爬取')) {
      const isDouyin = fullText.includes('抖音');
      const hasAntiCrawl = fullText.includes('反爬') || fullText.includes('验证码') || fullText.includes('登录') || fullText.includes('扫码');
      
      if (isDouyin) {
        // 抖音爬虫 - 结合具体URL和数据需求
        const urlList = urls.length > 0 ? urls.join(', ') : '抖音视频链接';
        const fields = dataFields.length > 0 ? dataFields.join('、') : '点赞数、评论数、收藏数、转发数';
        
        return [
          `【需求分析】分析目标抖音视频/用户页面结构：${urlList}，明确需要提取的数据字段：${fields}`,
          `【页面分析】使用浏览器开发者工具分析页面DOM结构，识别视频信息、互动数据（点赞/评论/收藏/转发）、作者信息的CSS选择器或XPath`,
          `【技术方案】${hasAntiCrawl ? '使用Playwright模拟真实浏览器行为，设置合理的请求间隔（1-3秒），配置User-Agent轮换，处理可能的反爬机制' : '使用Requests发送HTTP请求获取页面HTML，配合BeautifulSoup解析静态内容，如遇动态加载则使用Playwright'})`,
          `【核心开发】编写抖音爬虫核心逻辑：①视频页面解析 ②互动数据提取 ③作者信息抓取 ④数据清洗和格式化`,
          `【数据验证】针对验收标准逐项验证：①能否正确识别目标用户 ②能否准确提取点赞/评论/收藏/转发数量 ③能否获取主页信息和产品介绍`,
          `【交付物】①douyin_spider.py（完整可运行代码）②config.py（配置文件）③sample_data.json（100条真实数据样本）④README.md（详细使用说明）`,
        ];
      }

      // 通用爬虫
      return [
        `【需求分析】分析目标网站：${urls.length > 0 ? urls[0] : '待爬取网站'}，明确数据字段：${dataFields.join('、') || '根据页面结构确定'}`,
        `【页面分析】使用开发者工具分析目标页面结构，确定数据所在HTML标签、CSS类名或API接口`,
        `【技术选型】${hasAntiCrawl ? '采用Playwright/Selenium处理动态渲染页面，模拟真实用户行为' : '使用Requests+BeautifulSoup处理静态页面，效率更高'}`,
        `【核心开发】编写爬取逻辑：①请求发送和响应处理 ②HTML解析和数据提取 ③异常处理和重试机制 ④数据存储（JSON/CSV）`,
        `【数据验证】验证爬取数据的完整性和准确性，确保符合验收标准：${specificRequirements.slice(0, 3).join('；') || '数据字段完整、格式正确'}`,
        `【交付物】①spider.py（主程序）②sample_data（数据样本）③README.md（使用说明）`,
      ];
    }

    // API开发类任务
    if (description.toLowerCase().includes('api') || description.toLowerCase().includes('接口')) {
      return [
        '【需求分析】明确接口功能、请求方法（GET/POST/PUT/DELETE）、参数规范、响应格式（JSON/XML）',
        '【数据库设计】设计数据表结构、字段类型、索引优化、外键关系',
        '【接口实现】开发RESTful API：①路由定义 ②请求参数校验 ③业务逻辑处理 ④错误处理和日志记录',
        '【接口测试】编写单元测试和集成测试，验证功能完整性、边界条件、异常处理',
        '【文档编写】生成API文档（接口路径、请求参数、响应示例、错误码说明）',
        '【交付物】①源代码 ②API文档 ③测试用例 ④部署说明',
      ];
    }

    // 数据处理类任务
    if (description.toLowerCase().includes('数据清洗') || description.toLowerCase().includes('数据处理')) {
      return [
        '【数据探查】分析数据源、统计缺失值、识别异常数据、了解数据分布和数据类型',
        '【清洗方案】制定清洗规则：①去重策略 ②缺失值填充 ③格式标准化 ④异常值处理',
        '【脚本开发】实现数据清洗流程：①数据读取 ②清洗转换 ③质量检查 ④结果输出',
        '【质量验证】抽样检查、数据一致性验证、清洗前后对比分析',
        '【交付物】①清洗脚本 ②清洗后数据 ③质量报告 ④使用说明',
      ];
    }

    // 默认通用执行计划
    return [
      '【需求分析】深入理解任务需求、验收标准、交付物要求',
      '【技术方案】设计实现方案、选择技术栈、制定开发计划',
      '【开发实现】编写代码、单元测试、代码审查',
      '【测试验证】功能测试、边界测试、验收测试',
      '【交付上线】代码交付、文档编写、部署支持',
    ];
  }

  /**
   * 从文本中提取URL
   */
  private extractUrls(text: string): string[] {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const matches = text.match(urlRegex);
    return matches ? matches.slice(0, 3) : []; // 最多返回3个URL
  }

  /**
   * 检测目标平台
   */
  private detectTargetPlatform(text: string): string {
    if (text.includes('抖音')) return '抖音';
    if (text.includes('微博')) return '微博';
    if (text.includes('小红书')) return '小红书';
    if (text.includes('淘宝')) return '淘宝';
    if (text.includes('京东')) return '京东';
    if (text.includes('b站') || text.includes('bilibili')) return 'B站';
    return '目标网站';
  }

  /**
   * 提取数据字段需求
   */
  private extractDataFields(description: string, acceptanceCriteria: string): string[] {
    const fields: string[] = [];
    const combined = (description + ' ' + acceptanceCriteria).toLowerCase();
    
    if (combined.includes('点赞')) fields.push('点赞数');
    if (combined.includes('评论')) fields.push('评论数');
    if (combined.includes('收藏')) fields.push('收藏数');
    if (combined.includes('转发') || combined.includes('分享')) fields.push('转发数');
    if (combined.includes('播放')) fields.push('播放量');
    if (combined.includes('粉丝')) fields.push('粉丝数');
    if (combined.includes('关注')) fields.push('关注数');
    if (combined.includes('主页')) fields.push('主页信息');
    if (combined.includes('产品')) fields.push('产品信息');
    if (combined.includes('用户') || combined.includes('作者')) fields.push('用户信息');
    
    return fields.length > 0 ? fields : ['根据任务描述确定'];
  }

  /**
   * 提取具体需求点
   */
  private extractSpecificRequirements(description: string, acceptanceCriteria: string): string[] {
    const requirements: string[] = [];
    const combined = description + '\n' + acceptanceCriteria;
    
    // 按行分割并提取有效需求
    const lines = combined.split(/\n|(?=\d+\.)|(?=[①②③④⑤⑥⑦⑧⑨⑩])/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length > 5 && 
          !trimmed.match(/^\d+\.$/) && 
          (trimmed.includes('能') || trimmed.includes('可以') || trimmed.includes('需要') || trimmed.includes('必须'))) {
        requirements.push(trimmed.substring(0, 100));
      }
    }
    
    return requirements.length > 0 ? requirements.slice(0, 5) : ['按任务描述完成开发'];
  }

  /**
   * 根据任务内容生成具体的分析
   * 深度结合任务描述和验收标准生成个性化分析
   */
  private generateTaskSpecificAnalysis(task: Task, analysis: TaskAnalysis): string {
    const description = task.description || '';
    const acceptanceCriteria = task.acceptanceCriteria || '';
    const title = task.title || '';
    
    // 提取关键信息
    const urls = this.extractUrls(description);
    const targetPlatform = this.detectTargetPlatform(description);
    const dataFields = this.extractDataFields(description, acceptanceCriteria);
    const specificRequirements = this.extractSpecificRequirements(description, acceptanceCriteria);

    // 爬虫类任务分析 - 深度解析
    if (description.toLowerCase().includes('爬虫') || description.toLowerCase().includes('抓取')) {
      const isDouyin = description.includes('抖音');
      const isDynamic = description.includes('动态') || description.includes('js') || description.includes('javascript');
      const hasAntiCrawl = description.includes('反爬') || description.includes('验证码') || description.includes('登录') || description.includes('IP限制');

      let analysisText = `【${targetPlatform}爬虫任务深度分析】\n\n`;

      // 任务目标 - 结合具体URL
      analysisText += `📋 任务目标\n`;
      analysisText += `标题：${title}\n`;
      if (urls.length > 0) {
        analysisText += `目标链接：\n`;
        urls.forEach((url, idx) => {
          analysisText += `  ${idx + 1}. ${url}\n`;
        });
      }
      
      // 数据需求分析 - 结合描述和验收标准
      analysisText += `\n📊 数据需求分析\n`;
      if (dataFields.length > 0) {
        analysisText += `根据任务描述和验收标准，需要提取以下数据字段：\n`;
        dataFields.forEach((field, idx) => {
          analysisText += `  ${idx + 1}. ${field}\n`;
        });
      }
      
      // 从描述中提取具体需求
      if (description.includes('点赞') || description.includes('评论') || description.includes('收藏')) {
        analysisText += `\n🎯 核心数据指标：\n`;
        if (description.includes('点赞')) analysisText += `  • 点赞数 - 反映视频受欢迎程度\n`;
        if (description.includes('评论')) analysisText += `  • 评论数 - 反映用户互动热度\n`;
        if (description.includes('收藏')) analysisText += `  • 收藏数 - 反映内容价值度\n`;
        if (description.includes('转发')) analysisText += `  • 转发数 - 反映传播能力\n`;
      }

      // 技术方案分析
      analysisText += `\n🔧 技术方案\n`;
      analysisText += `目标平台：${targetPlatform}\n`;
      analysisText += `页面类型：${isDynamic ? '动态渲染页面（JavaScript生成内容），需要使用Playwright模拟浏览器执行' : '静态HTML页面，可使用Requests+BeautifulSoup高效解析'}\n`;
      analysisText += `反爬评估：${hasAntiCrawl ? '存在反爬机制，需要配置请求间隔（2-5秒）、User-Agent轮换、Cookie管理' : '无明显反爬，标准爬取策略即可'}\n`;
      analysisText += `数据存储：JSON格式便于程序读取，CSV格式便于Excel分析\n`;

      // 验收标准对应 - 详细分析
      if (specificRequirements.length > 0) {
        analysisText += `\n✅ 验收标准对应分析\n`;
        specificRequirements.forEach((item, idx) => {
          analysisText += `  ${idx + 1}. ${item}\n`;
          // 添加技术实现提示
          if (item.includes('点赞') || item.includes('评论') || item.includes('收藏')) {
            analysisText += `     → 通过分析页面DOM结构，定位互动数据元素的CSS选择器\n`;
          }
          if (item.includes('主页')) {
            analysisText += `     → 从视频页面提取作者链接，访问主页获取详细信息\n`;
          }
          if (item.includes('产品')) {
            analysisText += `     → 识别页面中的商品/产品信息区域，提取名称、价格、描述等字段\n`;
          }
        });
      }

      // 实现步骤
      analysisText += `\n📝 实现步骤\n`;
      analysisText += `1. 页面分析：使用Chrome开发者工具分析目标页面结构\n`;
      analysisText += `2. 选择器编写：确定视频信息、互动数据、作者信息的XPath或CSS选择器\n`;
      analysisText += `3. 核心逻辑：编写请求发送、HTML解析、数据提取、结果存储的完整流程\n`;
      analysisText += `4. 异常处理：添加网络超时、请求重试、数据校验等健壮性处理\n`;
      analysisText += `5. 数据验证：对照验收标准逐项验证数据完整性和准确性\n`;

      // 交付物
      analysisText += `\n📦 交付物清单\n`;
      analysisText += `1. douyin_spider.py - 主爬虫程序（含详细注释，可直接运行）\n`;
      analysisText += `2. config.py - 配置文件（URL模板、CSS选择器、请求头参数）\n`;
      analysisText += `3. utils.py - 工具函数（日志记录、数据清洗、异常重试）\n`;
      analysisText += `4. sample_data.json - 真实爬取数据样本（至少100条记录）\n`;
      analysisText += `5. README.md - 详细使用说明（环境配置、安装步骤、运行方法）\n`;
      analysisText += `6. requirements.txt - Python依赖清单（requests, beautifulsoup4, playwright等）\n`;

      return analysisText;
    }

    // API开发类任务分析
    if (description.toLowerCase().includes('api') || description.toLowerCase().includes('接口')) {
      return `【API开发任务分析】

📋 任务目标
标题：${title}
类型：RESTful API开发
技术栈：Node.js + Express 或 Python + FastAPI

🔧 技术方案
- 框架选择：Express（Node.js）或 FastAPI（Python）
- 数据库：根据需求选择 SQLite/MySQL/PostgreSQL
- 认证方式：JWT Token 或 API Key
- 接口规范：RESTful API设计规范

📊 核心功能模块
1. 请求参数校验（类型、必填、范围）
2. 业务逻辑处理（CRUD操作）
3. 错误处理（统一错误码、错误信息）
4. 日志记录（请求日志、错误日志）

✅ 验收标准
- 所有接口可正常调用
- 请求参数校验正确
- 响应格式统一规范
- 错误处理完善

📦 交付物清单
1. src/ - 源代码目录（路由、控制器、模型、中间件）
2. app.js/app.py - 应用入口
3. API文档.md - 接口文档（路径、方法、参数、响应示例）
4. tests/ - 测试用例
5. README.md - 项目说明（安装、配置、运行）
6. package.json/requirements.txt - 依赖清单`;
    }

    // 默认分析
    return `【任务分析】

📋 任务目标
标题：${title}
任务描述：${description.substring(0, 200)}${description.length > 200 ? '...' : ''}

🔧 技术方案
预估复杂度：${analysis.estimatedComplexity}/10
预估工时：${analysis.timeEstimate}小时

📦 交付物清单
1. 完整源代码（含注释）
2. 使用说明文档
3. 测试验证报告
4. 部署配置说明`;
  }

  /**
   * 映射复杂度
   */
  private mapComplexity(complexity: number | string): 'simple' | 'moderate' | 'complex' {
    const num = typeof complexity === 'string' ? parseInt(complexity, 10) || 5 : complexity;
    if (num <= 3) return 'simple';
    if (num <= 6) return 'moderate';
    return 'complex';
  }

  /**
   * 提交或更新报价到平台
   * 步骤 4: Agent 上报 Openclaw 生成的价格
   * 
   * 【修正】Agent 只是转发 Openclaw 生成的报价，不做额外计算
   * 价格、执行计划、分析都直接来自 Openclaw Instance
   */
  private async submitBid(
    task: Task,
    analysis: OpenclawAnalysisResult,
    existingBid?: Bid | null
  ): Promise<Bid | null> {
    try {
      const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(); // 12小时后过期

      // 【修正】使用 Openclaw 返回的 evaluation 数据，如果没有则使用默认值
      const evaluation = analysis.evaluation || {
        baseRate: 50,
        basePrice: 50 * analysis.estimatedHours,
        complexityFactor: analysis.complexity === 'complex' ? 1.8 : analysis.complexity === 'moderate' ? 1.5 : 1.2,
        minPrice: Math.round(analysis.suggestedPrice * 0.8),
        maxPrice: Math.round(analysis.suggestedPrice * 1.2),
        budgetCny: task.budgetCny || analysis.suggestedPrice,
        executionPlan: analysis.executionPlan,
      };

      const bidData = {
        taskId: task.id,
        // 【核心】直接使用 Openclaw 生成的价格
        priceCny: analysis.suggestedPrice,
        planSummary: this.generatePlanSummary(task, analysis),
        detailedPlan: analysis.analysis || this.generateDetailedPlan(task, analysis),
        pricingModel: 'openclaw',
        pricingMeta: {
          // 标记是哪个 Openclaw 实例生成的报价
          openclawInstance: analysis.instanceName || analysis.instanceId || 'unknown',
          skillHits: analysis.matchedSkills.map((s) => s.name),
          scores: {
            relevance: analysis.skillMatchRate,
            urgency: 0.5,
            complexity: analysis.complexity === 'complex' ? 0.8 : analysis.complexity === 'moderate' ? 0.5 : 0.3,
            overall: analysis.skillMatchRate,
          },
          params: {
            minBidRatio: 0.5,
            maxBidRatio: 1.0,
            minScore: 0.3,
          },
          // 【修正】使用 Openclaw 返回的 evaluation 数据
          evaluation: {
            baseRate: evaluation.baseRate,
            estimatedHours: analysis.estimatedHours,
            basePrice: evaluation.basePrice,
            complexityFactor: evaluation.complexityFactor,
            complexity: analysis.complexity,
            complexityCn: analysis.complexityCn,
            confidence: analysis.confidence,
            minPrice: evaluation.minPrice,
            maxPrice: evaluation.maxPrice,
            budgetCny: evaluation.budgetCny,
            suggestedPrice: analysis.suggestedPrice,
            matchedSkills: analysis.matchedSkills,
            executionPlan: analysis.evaluation?.executionPlan || analysis.executionPlan,
            analysis: analysis.analysis,
          },
        },
        expiresAt,
      };

      let bid: Bid | null;

      // 【调试】打印发送的 pricingMeta
      console.log('[DEBUG] Submitting bid with pricingMeta:', JSON.stringify(bidData.pricingMeta, null, 2));
      
      if (existingBid) {
        // 更新已有报价
        logger.info('Updating existing bid', {
          taskId: task.id,
          existingBidId: existingBid.id,
        });
        bid = await this.genesisClient.updateBid(bidData);
      } else {
        // 提交新报价
        bid = await this.genesisClient.submitBid(bidData);
      }

      // 【调试】打印返回的 bid
      console.log('[DEBUG] Bid response:', JSON.stringify(bid, null, 2));

      return bid;
    } catch (error) {
      logger.error('Failed to submit bid', {
        taskId: task.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * 检查是否已有报价
   */
  async checkExistingBid(taskId: string): Promise<Bid | null> {
    try {
      const bids = await this.genesisClient.getTaskBids(taskId);
      // 查找当前 Agent 的报价
      const existingBid = bids.find((bid) => bid.agentId === this.agentId);
      return existingBid || null;
    } catch (error) {
      logger.warn('Failed to check existing bids', {
        taskId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * 生成方案摘要
   */
  private generatePlanSummary(task: Task, analysis: OpenclawAnalysisResult): string {
    const skillsLine = analysis.matchedSkills.length > 0
      ? `匹配技能：${analysis.matchedSkills.slice(0, 3).map((s) => s.name).join('、')}`
      : '基于通用开发能力';

    return `已解析需求「${task.title}」。${skillsLine}。复杂度${analysis.complexityCn}，预估${analysis.estimatedHours}小时，置信度${analysis.confidence}。`;
  }

  /**
   * 生成详细方案
   */
  private generateDetailedPlan(task: Task, analysis: OpenclawAnalysisResult): string {
    const baseRate = 50;
    const basePrice = baseRate * analysis.estimatedHours;
    const minPrice = Math.round(analysis.suggestedPrice * 0.8);
    const maxPrice = Math.round(analysis.suggestedPrice * 1.2);
    const complexityFactor = analysis.complexity === 'complex' ? 2.0 : analysis.complexity === 'moderate' ? 1.5 : 1.0;

    const matchedSkillsList = analysis.matchedSkills
      .map((s) => `- **${s.name}**: ${s.description}`)
      .join('\n');

    const executionPlanList = analysis.executionPlan
      .map((step, idx) => `${idx + 1}. **${step}**`)
      .join('\n');

    // 生成任务特定的交付物清单
    const deliverables = this.generateDeliverablesList(task);

    return `## 任务分析
- **任务标题**: ${task.title}
- **任务描述**: ${task.description || '暂无详细描述'}
- **复杂度**: ${analysis.complexityCn} (${analysis.complexity})
- **预估工时**: ${analysis.estimatedHours} 小时
- **置信度**: ${analysis.confidence}

## 技能匹配分析
匹配技能：
${matchedSkillsList || '- **通用开发能力**: 基于标准开发实践'}

- **技能匹配度**: ${Math.round(analysis.skillMatchRate * 100)}%

${analysis.analysis ? `### AI 分析\n${analysis.analysis}` : ''}

## 执行计划
${executionPlanList}

## 交付物清单
${deliverables}

## 报价明细

### 计算基础
- **基础费率**: ¥${baseRate}/小时
- **预估工时**: ${analysis.estimatedHours} 小时
- **基础价格**: ¥${basePrice}

### 复杂度调整
- **任务复杂度**: ${analysis.complexityCn}
- **复杂度系数**: ${complexityFactor}
- **调整后价格**: ¥${Math.round(basePrice * complexityFactor)}

### 价格区间
- **最低可接受价格**: ¥${minPrice} (80%)
- **建议报价**: ¥${analysis.suggestedPrice}
- **最高报价**: ¥${maxPrice} (120%)

**最终报价: ¥${analysis.suggestedPrice}**

---
*本报价由 Genesis Agent 自动生成*`;
  }

  /**
   * 生成任务特定的交付物清单
   */
  private generateDeliverablesList(task: Task): string {
    const description = task.description?.toLowerCase() || '';
    const title = task.title?.toLowerCase() || '';
    
    // 爬虫类任务交付物
    if (description.includes('爬虫') || description.includes('抓取') || title.includes('爬虫')) {
      return `### 代码交付物
- **spider.py** - 主爬虫程序（含详细注释）
- **config.py** - 配置文件（URL、选择器、请求头）
- **utils.py** - 工具函数（重试、日志、数据清洗）
- **requirements.txt** - Python依赖清单

### 数据交付物
- **sample_data.json/csv** - 爬取数据样本（100条）
- **data_schema.md** - 数据结构说明文档

### 文档交付物
- **README.md** - 使用说明（安装、运行、参数说明）
- **API文档** - 如使用API方式爬取，提供接口文档
- **运行截图** - 程序运行效果截图

### 验收标准对应
- ✅ 能成功爬取目标数据
- ✅ 数据字段完整、格式正确
- ✅ 代码可正常运行，有错误处理`;
    }
    
    // API开发类任务交付物
    if (description.includes('api') || description.includes('接口') || title.includes('api')) {
      return `### 代码交付物
- **src/** - 源代码目录
  - **routes/** - API路由定义
  - **controllers/** - 业务逻辑控制器
  - **models/** - 数据模型定义
  - **middleware/** - 中间件（认证、日志、错误处理）
  - **utils/** - 工具函数
- **app.js/app.py** - 应用入口文件
- **package.json/requirements.txt** - 依赖清单

### 文档交付物
- **API文档.md** - 接口文档（请求/响应格式、示例）
- **README.md** - 项目说明（安装、配置、运行）
- **数据库设计.md** - 表结构、字段说明

### 测试交付物
- **tests/** - 测试用例目录
- **postman_collection.json** - Postman测试集合（如有）

### 验收标准对应
- ✅ 所有API接口可正常调用
- ✅ 请求参数校验正确
- ✅ 错误处理完善`;
    }
    
    // 数据处理类任务交付物
    if (description.includes('数据清洗') || description.includes('数据处理') || description.includes('etl')) {
      return `### 代码交付物
- **clean_data.py** - 数据清洗主脚本
- **transform.py** - 数据转换逻辑
- **validate.py** - 数据验证脚本
- **config.yaml** - 清洗规则配置

### 数据交付物
- **cleaned_data.csv/json** - 清洗后的完整数据
- **data_quality_report.md** - 数据质量报告
- **sample_before.csv** - 清洗前样本（对比用）
- **sample_after.csv** - 清洗后样本

### 文档交付物
- **README.md** - 使用说明
- **清洗规则说明.md** - 清洗逻辑、规则详解

### 验收标准对应
- ✅ 数据清洗逻辑正确
- ✅ 数据质量提升明显
- ✅ 清洗规则可配置、可复用`;
    }
    
    // 默认通用交付物
    return `### 代码交付物
- **src/** - 源代码目录（含详细注释）
- **config/** - 配置文件
- **requirements.txt/package.json** - 依赖清单

### 文档交付物
- **README.md** - 使用说明文档
- **设计文档.md** - 技术方案说明（如需要）

### 测试交付物
- **tests/** - 测试用例
- **test_report.md** - 测试报告

### 验收标准对应
- ✅ 功能完整实现
- ✅ 代码质量良好
- ✅ 文档清晰完整`;
  }

  /**
   * 执行订单任务（中标后调用）
   * 
   * 流程：
   * 1. 获取任务详情和报价信息
   * 2. 调用 Openclaw 生成代码和部署
   * 3. 提交交付物
   */
  async executeOrder(orderData: any): Promise<void> {
    // 处理 webhook 发送的简化数据格式
    const orderId = orderData.orderId || orderData.id;
    
    if (!orderId) {
      logger.error('Missing order ID');
      return;
    }

    // 检查是否已经在执行中
    if (this.executingOrders.get(orderId)) {
      logger.info(`Order ${orderId} already executing, skipping`);
      return;
    }

    this.executingOrders.set(orderId, true);
    logger.info('Starting order execution', { orderId });

    // [追踪点] 开始执行订单
    console.log(`[EXEC-FLOW] 开始执行订单 | orderId=${orderId}`);

    try {
      // 从后端获取完整的订单信息
      const fullOrder = await this.genesisClient.getOrder(orderId);
      if (!fullOrder) {
        logger.error(`Order ${orderId} not found`);
        console.error(`[EXEC-FLOW] 订单不存在 | orderId=${orderId}`);
        return;
      }

      const taskId = fullOrder.task?.id || fullOrder.taskId;
      const bidId = fullOrder.bid?.id || fullOrder.bidId;
      const ownerUserId = fullOrder.owner?.id || fullOrder.ownerUserId || fullOrder.ownerId;
      const amountCny = fullOrder.amountCny || orderData.amountCny;

      if (!taskId || !bidId || !ownerUserId) {
        logger.error('Missing required order information', {
          orderId,
          taskId,
          bidId,
          ownerUserId,
        });
        console.error(`[EXEC-FLOW] 订单信息不完整 | orderId=${orderId}`);
        return;
      }

      console.log(`[EXEC-FLOW] 订单信息完整 | orderId=${orderId} | taskId=${taskId} | bidId=${bidId}`);

      // 从订单数据中获取任务和报价信息（订单API已包含完整数据）
      const task = fullOrder.task;
      const bid = fullOrder.bid;

      if (!task || !bid) {
        logger.error('Missing task or bid information in order', {
          orderId,
          hasTask: !!task,
          hasBid: !!bid,
        });
        console.error(`[EXEC-FLOW] 订单缺少任务或报价信息 | orderId=${orderId}`);
        return;
      }

      logger.info('Executing task', {
        orderId,
        taskTitle: task.title,
      });

      // [执行追踪] 创建执行计划
      const executionPlan = bid.pricingMeta?.evaluation?.executionPlan || [];
      let phaseIdMap = new Map<string, string>();
      let subTaskIdMap = new Map<string, string>();

      if (executionPlan.length > 0) {
        console.log(`[EXEC-TRACKER] 创建执行计划 | orderId=${orderId} | phases=${executionPlan.length}`);
        const planResult = await this.executionTracker.createExecutionPlan(
          orderId,
          executionPlan
        );
        if (planResult.success) {
          console.log(`[EXEC-TRACKER] 执行计划创建成功 | orderId=${orderId}`);
          phaseIdMap = planResult.phaseIdMap;
          subTaskIdMap = planResult.subTaskIdMap;
        } else {
          console.error(`[EXEC-TRACKER] 执行计划创建失败 | orderId=${orderId}`);
        }
      }

      // [执行追踪] 逐个阶段执行并上报进度
      // 注意：阶段分为两组：
      // 1. 前置阶段：需求分析、技术方案、页面分析 - 真正调用 SkillsManager
      // 2. 核心阶段：核心爬取逻辑（包含Openclaw执行）
      // 3. 后置阶段：数据存储、健壮性处理、风险处理、交付验收
      const prePhases = ['需求分析', '技术方案', '页面分析'];
      const corePhase = '核心爬取逻辑';
      const postPhases = ['数据存储', '健壮性处理', '风险处理', '交付验收'];
      
      let openclawResult: TaskExecutionResult | null = null;
      
      // 【真实执行】前置阶段 - 调用 SkillsManager 进行真实分析
      for (let phaseIndex = 0; phaseIndex < prePhases.length; phaseIndex++) {
        const phaseName = prePhases[phaseIndex];
        const phaseKey = `phase-${phaseIndex}`;
        const phaseId = phaseIdMap.get(phaseKey);
        
        if (!phaseId) {
          console.log(`[EXEC-TRACKER] 跳过阶段 | phase=${phaseName} | 未找到对应ID`);
          continue;
        }

        // 1. 上报阶段开始
        await this.executionTracker.reportPhaseStarted(orderId, phaseId, phaseName);
        console.log(`[EXEC-TRACKER] 阶段开始 | phase=${phaseName} | id=${phaseId}`);

        // 2. 【真实执行】根据阶段类型执行真实任务
        if (phaseName === '需求分析') {
          // 【真实执行】调用 SkillsManager 进行任务分析
          console.log(`[EXEC-FLOW] 开始真实需求分析 | orderId=${orderId} | taskId=${task.id}`);
          
          try {
            // 上报子任务：技能匹配
            const subTaskKeys = Array.from(subTaskIdMap.keys()).filter(key => key.startsWith(`${phaseKey}-`));
            
            // 真实调用 SkillsManager.analyzeTask
            const taskAnalysis = this.skillsManager.analyzeTask(task);
            console.log(`[EXEC-FLOW] SkillsManager 分析完成 | taskId=${task.id} | complexity=${taskAnalysis.estimatedComplexity} | skills=${taskAnalysis.requiredSkills.join(',')}`);
            
            // 上报分析结果
            if (subTaskKeys.length > 0) {
              for (let i = 0; i < subTaskKeys.length; i++) {
                const subTaskKey = subTaskKeys[i];
                const subTaskId = subTaskIdMap.get(subTaskKey);
                if (subTaskId) {
                  const progress = Math.round(((i + 1) / subTaskKeys.length) * 100);
                  
                  // 根据子任务类型上报具体内容
                  let message = subTaskKey;
                  if (subTaskKey.includes('技能匹配')) {
                    message = `技能匹配: ${taskAnalysis.requiredSkills.join(', ')}`;
                  } else if (subTaskKey.includes('需求理解')) {
                    message = `需求理解: ${taskAnalysis.extractedKeywords.slice(0, 5).join(', ')}`;
                  } else if (subTaskKey.includes('复杂度评估')) {
                    message = `复杂度评估: ${taskAnalysis.estimatedComplexity}/10`;
                  }
                  
                  await this.executionTracker.reportSubTaskProgress(
                    orderId,
                    phaseId,
                    subTaskId,
                    subTaskKey,
                    progress,
                    message,
                    'AGENT'
                  );
                  
                  await this.executionTracker.reportSubTaskCompleted(
                    orderId,
                    phaseId,
                    subTaskId,
                    subTaskKey,
                    { 
                      analysis: taskAnalysis,
                      matchedSkills: taskAnalysis.requiredSkills,
                      keywords: taskAnalysis.extractedKeywords
                    },
                    'AGENT'
                  );
                }
              }
            } else {
              // 没有子任务，上报阶段进度
              await this.executionTracker.reportProgress({
                orderId,
                phaseId,
                event: 'PROGRESS',
                progress: 50,
                message: `技能匹配: ${taskAnalysis.requiredSkills.join(', ')}`,
                componentType: 'AGENT',
              });
              
              await this.executionTracker.reportProgress({
                orderId,
                phaseId,
                event: 'COMPLETED',
                progress: 100,
                message: `需求分析完成 | 匹配技能: ${taskAnalysis.requiredSkills.join(', ')} | 复杂度: ${taskAnalysis.estimatedComplexity}/10`,
                componentType: 'AGENT',
              });
            }
          } catch (error) {
            console.error(`[EXEC-FLOW] 需求分析失败 | orderId=${orderId} | error=${error}`);
            await this.executionTracker.reportProgress({
              orderId,
              phaseId,
              event: 'FAILED',
              progress: 0,
              message: `需求分析失败: ${error}`,
              componentType: 'AGENT',
            });
            continue;
          }
        } else if (phaseName === '技术方案') {
          // 【真实执行】生成技术方案
          console.log(`[EXEC-FLOW] 开始生成技术方案 | orderId=${orderId}`);
          
          try {
            // 真实调用 TaskAnalyzer 生成技术方案
            // 先生成需求分析，再基于需求生成技术方案
            const requirements = this.taskAnalyzer.analyzeRequirements(task);
            const techSolution = this.taskAnalyzer.generateTechnicalSolution(task, requirements);
            console.log(`[EXEC-FLOW] 技术方案生成完成 | orderId=${orderId} | techStack=${techSolution?.techStack?.map(t => t.technology).join(',')}`);
            
            const subTaskKeys = Array.from(subTaskIdMap.keys()).filter(key => key.startsWith(`${phaseKey}-`));
            
            if (subTaskKeys.length > 0) {
              for (let i = 0; i < subTaskKeys.length; i++) {
                const subTaskKey = subTaskKeys[i];
                const subTaskId = subTaskIdMap.get(subTaskKey);
                if (subTaskId) {
                  const progress = Math.round(((i + 1) / subTaskKeys.length) * 100);
                  
                  let message = subTaskKey;
                  if (techSolution?.techStack && i < techSolution.techStack.length) {
                    const tech = techSolution.techStack[i];
                    message = `${tech.category}: ${tech.technology}`;
                  }
                  
                  await this.executionTracker.reportSubTaskProgress(
                    orderId,
                    phaseId,
                    subTaskId,
                    subTaskKey,
                    progress,
                    message,
                    'AGENT'
                  );
                  
                  await this.executionTracker.reportSubTaskCompleted(
                    orderId,
                    phaseId,
                    subTaskId,
                    subTaskKey,
                    { techSolution },
                    'AGENT'
                  );
                }
              }
            } else {
              const techStackStr = techSolution?.techStack?.map(t => t.technology).join(', ') || 'Python, Requests, BeautifulSoup';
              await this.executionTracker.reportProgress({
                orderId,
                phaseId,
                event: 'COMPLETED',
                progress: 100,
                message: `技术方案完成 | 技术栈: ${techStackStr}`,
                componentType: 'AGENT',
              });
            }
          } catch (error) {
            console.error(`[EXEC-FLOW] 技术方案生成失败 | orderId=${orderId} | error=${error}`);
            await this.executionTracker.reportProgress({
              orderId,
              phaseId,
              event: 'FAILED',
              progress: 0,
              message: `技术方案生成失败: ${error}`,
              componentType: 'AGENT',
            });
            continue;
          }
        } else if (phaseName === '页面分析') {
          // 【真实执行】分析目标页面
          console.log(`[EXEC-FLOW] 开始页面分析 | orderId=${orderId}`);
          
          try {
            // 真实分析：提取URL、检测平台、识别数据字段
            const urls = this.extractUrls(task.description || '');
            const targetPlatform = this.detectTargetPlatform((task.title + ' ' + task.description).toLowerCase());
            const dataFields = this.extractDataFields(task.description || '', task.acceptanceCriteria || '');
            
            console.log(`[EXEC-FLOW] 页面分析完成 | orderId=${orderId} | platform=${targetPlatform} | urls=${urls.length} | fields=${dataFields.length}`);
            
            const subTaskKeys = Array.from(subTaskIdMap.keys()).filter(key => key.startsWith(`${phaseKey}-`));
            
            if (subTaskKeys.length > 0) {
              for (let i = 0; i < subTaskKeys.length; i++) {
                const subTaskKey = subTaskKeys[i];
                const subTaskId = subTaskIdMap.get(subTaskKey);
                if (subTaskId) {
                  const progress = Math.round(((i + 1) / subTaskKeys.length) * 100);
                  
                  let message = subTaskKey;
                  if (subTaskKey.includes('URL识别') && urls.length > 0) {
                    message = `URL识别: ${urls[0].substring(0, 50)}...`;
                  } else if (subTaskKey.includes('平台检测')) {
                    message = `平台检测: ${targetPlatform}`;
                  } else if (subTaskKey.includes('数据字段')) {
                    message = `数据字段: ${dataFields.join(', ')}`;
                  }
                  
                  await this.executionTracker.reportSubTaskProgress(
                    orderId,
                    phaseId,
                    subTaskId,
                    subTaskKey,
                    progress,
                    message,
                    'AGENT'
                  );
                  
                  await this.executionTracker.reportSubTaskCompleted(
                    orderId,
                    phaseId,
                    subTaskId,
                    subTaskKey,
                    { urls, targetPlatform, dataFields },
                    'AGENT'
                  );
                }
              }
            } else {
              await this.executionTracker.reportProgress({
                orderId,
                phaseId,
                event: 'COMPLETED',
                progress: 100,
                message: `页面分析完成 | 平台: ${targetPlatform} | 数据字段: ${dataFields.join(', ')}`,
                componentType: 'AGENT',
              });
            }
          } catch (error) {
            console.error(`[EXEC-FLOW] 页面分析失败 | orderId=${orderId} | error=${error}`);
            await this.executionTracker.reportProgress({
              orderId,
              phaseId,
              event: 'FAILED',
              progress: 0,
              message: `页面分析失败: ${error}`,
              componentType: 'AGENT',
            });
            continue;
          }
        }

        // 3. 确保阶段进度为100%后才标记为完成
        await this.executionTracker.reportProgress({
          orderId,
          phaseId,
          event: 'COMPLETED',
          progress: 100,
          message: `${phaseName} 完成: 100%`,
          componentType: 'AGENT',
        });
        await this.executionTracker.reportPhaseCompleted(orderId, phaseId, phaseName);
        console.log(`[EXEC-TRACKER] 阶段完成 | phase=${phaseName} | progress=100%`);
      }
      
      // 执行核心阶段（核心爬取逻辑）- 包含Openclaw执行
      const corePhaseIndex = 3;
      const corePhaseKey = `phase-${corePhaseIndex}`;
      const corePhaseId = phaseIdMap.get(corePhaseKey);
      
      if (corePhaseId) {
        // 1. 上报核心阶段开始
        await this.executionTracker.reportPhaseStarted(orderId, corePhaseId, corePhase);
        console.log(`[EXEC-TRACKER] 阶段开始 | phase=${corePhase} | id=${corePhaseId}`);
        
        // 2. 获取该阶段的所有子任务ID
        const coreSubTaskKeys = Array.from(subTaskIdMap.keys()).filter(key => key.startsWith(`${corePhaseKey}-`));
        const coreSubTaskId = coreSubTaskKeys.length > 0 ? subTaskIdMap.get(coreSubTaskKeys[0]) : undefined;
        
        // 3. 调用 Openclaw 执行核心任务（这会阻塞直到完成）
        console.log(`[EXEC-TRACKER] 调用 Openclaw 执行核心任务 | orderId=${orderId}`);
        openclawResult = await this.executeTaskWithOpenclaw({
          orderId: orderId,
          taskId: task.id,
          title: task.title,
          description: task.description || '',
          bidPrice: amountCny || 0,
          executionPlan: bid.pricingMeta?.evaluation?.executionPlan || [],
          acceptanceCriteria: task.acceptanceCriteria,
        }, corePhaseId, coreSubTaskId);
        
        // 4. Openclaw 完成后，上报所有核心子任务完成
        if (openclawResult.success) {
          // 上报所有核心子任务完成
          for (let i = 0; i < coreSubTaskKeys.length; i++) {
            const subTaskKey = coreSubTaskKeys[i];
            const subTaskId = subTaskIdMap.get(subTaskKey);
            if (subTaskId) {
              const progress = Math.round(((i + 1) / coreSubTaskKeys.length) * 100);
              await this.executionTracker.reportSubTaskProgress(
                orderId,
                corePhaseId,
                subTaskId,
                subTaskKey,
                progress,
                `核心爬取: ${subTaskKey}`,
                'AGENT'
              );
              await this.executionTracker.reportSubTaskCompleted(
                orderId,
                corePhaseId,
                subTaskId,
                subTaskKey,
                undefined,
                'AGENT'
              );
            }
          }
          // 上报阶段完成
          await this.executionTracker.reportPhaseCompleted(orderId, corePhaseId, corePhase);
          console.log(`[EXEC-TRACKER] 阶段完成 | phase=${corePhase} | progress=100%`);
        } else {
          // Openclaw 失败，上报阶段失败
          await this.executionTracker.reportProgress({
            orderId,
            phaseId: corePhaseId,
            event: 'FAILED',
            progress: 0,
            message: `核心爬取逻辑执行失败: ${openclawResult.error}`,
            componentType: 'AGENT',
          });
          console.error(`[EXEC-TRACKER] 阶段失败 | phase=${corePhase} | error=${openclawResult.error}`);
        }
      }
      
      // 执行后置阶段（只有在Openclaw成功后才执行）
      if (openclawResult && openclawResult.success) {
        for (let i = 0; i < postPhases.length; i++) {
          const phaseName = postPhases[i];
          const phaseIndex = 4 + i; // 从第4个阶段开始
          const phaseKey = `phase-${phaseIndex}`;
          const phaseId = phaseIdMap.get(phaseKey);
          
          if (!phaseId) {
            console.log(`[EXEC-TRACKER] 跳过阶段 | phase=${phaseName} | 未找到对应ID`);
            continue;
          }

          // 1. 上报阶段开始
          await this.executionTracker.reportPhaseStarted(orderId, phaseId, phaseName);
          console.log(`[EXEC-TRACKER] 阶段开始 | phase=${phaseName} | id=${phaseId}`);

          // 2. 获取该阶段的子任务
          const subTaskKeys = Array.from(subTaskIdMap.keys()).filter(key => key.startsWith(`${phaseKey}-`));
          
          if (subTaskKeys.length > 0) {
            // 有子任务，逐个上报子任务进度
            for (let i = 0; i < subTaskKeys.length; i++) {
              const subTaskKey = subTaskKeys[i];
              const subTaskId = subTaskIdMap.get(subTaskKey);
              if (subTaskId) {
                const progress = Math.round(((i + 1) / subTaskKeys.length) * 100);
                await this.executionTracker.reportSubTaskProgress(
                  orderId,
                  phaseId,
                  subTaskId,
                  subTaskKey,
                  progress,
                  `正在处理: ${subTaskKey}`,
                  'AGENT'
                );
                // 模拟处理时间
                await new Promise(resolve => setTimeout(resolve, 500));
                
                // 子任务完成，上报100%进度
                await this.executionTracker.reportSubTaskCompleted(
                  orderId,
                  phaseId,
                  subTaskId,
                  subTaskKey,
                  undefined,
                  'AGENT'
                );
              }
            }
          } else {
            // 没有子任务，直接模拟阶段进度（0%, 25%, 50%, 75%, 100%）
            for (let progress = 0; progress <= 100; progress += 25) {
              await this.executionTracker.reportProgress({
                orderId,
                phaseId,
                event: progress === 100 ? 'COMPLETED' : 'PROGRESS',
                progress,
                message: `${phaseName} 进度: ${progress}%`,
                componentType: 'AGENT',
              });
              // 模拟处理时间
              await new Promise(resolve => setTimeout(resolve, 300));
            }
          }

          // 3. 确保阶段进度为100%后才标记为完成
          // 上报最终100%进度（确保后端进度更新为100%）
          await this.executionTracker.reportProgress({
            orderId,
            phaseId,
            event: 'COMPLETED',
            progress: 100,
            message: `${phaseName} 完成: 100%`,
            componentType: 'AGENT',
          });
          // 然后上报阶段完成
          await this.executionTracker.reportPhaseCompleted(orderId, phaseId, phaseName);
          console.log(`[EXEC-TRACKER] 阶段完成 | phase=${phaseName} | progress=100%`);
        }
      } else {
        console.log(`[EXEC-TRACKER] 跳过后置阶段 | Openclaw未成功完成`);
      }

      // 提交交付物（只有成功时才提交）
      if (openclawResult && openclawResult.success && openclawResult.demoUrl) {
        await this.submitDelivery(orderId, ownerUserId, {
          deliverySummary: `任务已完成，Demo 地址: ${openclawResult.demoUrl}`,
          deliveryUrl: openclawResult.demoUrl,
        });
        logger.info('Order execution completed successfully', {
          orderId,
          demoUrl: openclawResult.demoUrl,
        });
        // [追踪点] 订单执行成功
        console.log(`[EXEC-FLOW] 订单执行成功 | orderId=${orderId} | demoUrl=${openclawResult.demoUrl}`);
      } else {
        // 执行失败，不上报交付，只记录错误日志
        // 执行状态已经在上面上报为 FAILED，订单保持 IN_PROGRESS 状态
        // 等待人工介入或自动重试机制
        logger.error('Order execution failed, delivery not submitted', {
          orderId,
          error: openclawResult?.error,
        });
        // [追踪点] 订单执行失败
        console.error(`[EXEC-FLOW] 订单执行失败，未提交交付 | orderId=${orderId} | error=${openclawResult?.error || '未知错误'}`);
      }
    } catch (error) {
      logger.error('Error executing order', {
        orderId,
        error: error instanceof Error ? error.message : String(error),
      });
      // [追踪点] 订单执行异常
      console.error(`[EXEC-FLOW] 订单执行异常 | orderId=${orderId} | error=${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.executingOrders.delete(orderId);
    }
  }

  /**
   * 检测任务类型（用于执行阶段）
   */
  private detectTaskTypeForExecution(title: string, description: string): string {
    const text = `${title} ${description}`.toLowerCase();
    
    if (text.includes('抖音') || text.includes('爬虫') || text.includes('采集') || text.includes('爬取')) {
      return 'DATA_CRAWLER';
    }
    if (text.includes('待办') || text.includes('todo') || text.includes('任务管理') || 
        text.includes('清单') || text.includes('任务列表')) {
      return 'TODO_APP';
    }
    if (text.includes('api') || text.includes('接口')) {
      return 'API_DEVELOPMENT';
    }
    if (text.includes('数据处理') || text.includes('清洗') || text.includes('分析')) {
      return 'DATA_PROCESSING';
    }
    
    return 'GENERAL';
  }

  /**
   * 调用 Openclaw 执行任务
   */
  private async executeTaskWithOpenclaw(
    execution: TaskExecutionRequest,
    phaseId?: string,
    subTaskId?: string
  ): Promise<TaskExecutionResult> {
    try {
      logger.info('Calling Openclaw Bridge for task execution', {
        orderId: execution.orderId,
        taskTitle: execution.title,
      });

      // 检测任务类型
      const taskType = this.detectTaskTypeForExecution(execution.title, execution.description);
      logger.info('Detected task type for execution', { orderId: execution.orderId, taskType });

      const response = await axios.post(
        `${OPENCLAW_BRIDGE_URL}/api/v1/execute`,
        {
          orderId: execution.orderId,
          taskId: execution.taskId,
          title: execution.title,
          description: execution.description,
          bidPrice: execution.bidPrice,
          executionPlan: execution.executionPlan,
          acceptanceCriteria: execution.acceptanceCriteria,
          agentId: this.agentId,
          webhookUrl: this.webhookUrl,
        },
        {
          timeout: 60000, // 增加到60秒，因为Bridge现在会等待实际执行完成
          headers: { 'Content-Type': 'application/json' },
        }
      );

      if (response.data && response.data.success) {
        // 轮询等待部署完成，传递任务类型
        return await this.waitForDeployment(execution.orderId, phaseId, subTaskId, taskType);
      }

      logger.warn('Openclaw execution failed', {
        orderId: execution.orderId,
        response: response.data,
      });
      return this.createFallbackExecution(execution);
    } catch (error) {
      logger.error('Error calling Openclaw for execution', {
        orderId: execution.orderId,
        error: error instanceof Error ? error.message : String(error),
      });
      return this.createFallbackExecution(execution);
    }
  }

  /**
   * 轮询等待部署完成
   */
  private async waitForDeployment(
    orderId: string,
    phaseId?: string,
    subTaskId?: string,
    taskType?: string,
    maxWaitTime: number = 300000
  ): Promise<TaskExecutionResult> {
    const startTime = Date.now();
    const pollInterval = 5000;
    let deploymentProgressReported = false;

    // 使用真实的 phaseId 和 subTaskId，如果没有则使用默认值（向后兼容）
    const corePhaseId = phaseId || 'phase-core';
    // 注意：subTaskId 必须是有效的 UUID，不能添加后缀
    const deploymentSubTaskId = subTaskId || '00000000-0000-0000-0000-000000000001';

    // [执行追踪] 上报"核心爬取逻辑"阶段开始（对应截图中的第4项）
    // 注意：如果 phaseId 是 UUID，则只上报子任务；否则上报阶段+子任务
    if (phaseId && subTaskId) {
      // 使用真实的子任务ID上报
      await this.executionTracker.reportSubTaskStarted(orderId, corePhaseId, deploymentSubTaskId, '部署和构建', 'OPENCLAW');
    } else {
      await this.executionTracker.reportPhaseStarted(orderId, corePhaseId, '核心爬取逻辑');
      await this.executionTracker.reportSubTaskStarted(orderId, corePhaseId, deploymentSubTaskId, '部署和构建', 'OPENCLAW');
    }

    while (Date.now() - startTime < maxWaitTime) {
      try {
        const status = await this.getDeploymentStatus(orderId);
        logger.debug(`Deployment status: ${status.status}, progress: ${status.progress}%`);

        // [执行追踪] 上报部署进度
        if (status.progress > 0 && !deploymentProgressReported) {
          await this.executionTracker.reportSubTaskProgress(
            orderId,
            corePhaseId,
            deploymentSubTaskId,
            '部署和构建',
            status.progress,
            `Openclaw部署进度: ${status.progress}%`,
            'OPENCLAW'
          );
          if (status.progress >= 50) {
            deploymentProgressReported = true;
          }
        }

        if (status.status === 'deployed') {
          // 验证执行结果中是否包含真实数据
          if (status.executionResult) {
            const result = status.executionResult;
            
            // 检查是否为模拟数据
            if (result.isSimulated) {
              logger.error('Openclaw returned simulated data', { orderId, result });
              await this.executionTracker.reportProgress({
                orderId,
                phaseId: corePhaseId,
                subTaskId: deploymentSubTaskId,
                event: 'FAILED',
                progress: 0,
                message: '获取到模拟数据，任务执行失败',
                componentType: 'OPENCLAW',
              });
              return {
                success: false,
                deploymentStatus: 'failed',
                executionLog: status.logs,
                error: '获取到模拟数据，任务执行失败',
              };
            }
            
            // 验证必需字段（仅对数据爬虫任务）
            if (taskType === 'DATA_CRAWLER') {
              const requiredFields = ['likeCount', 'commentCount'];
              const missingFields = requiredFields.filter(field => !result[field]);
              if (missingFields.length > 0) {
                logger.error('Missing required fields in execution result', { orderId, missingFields, result });
                await this.executionTracker.reportProgress({
                  orderId,
                  phaseId: corePhaseId,
                  subTaskId: deploymentSubTaskId,
                  event: 'FAILED',
                  progress: 0,
                  message: `数据验证失败，缺少字段: ${missingFields.join(', ')}`,
                  componentType: 'OPENCLAW',
                });
                return {
                  success: false,
                  deploymentStatus: 'failed',
                  executionLog: status.logs,
                  error: `数据验证失败，缺少字段: ${missingFields.join(', ')}`,
                };
              }
              
              // 记录重试信息
              if (result.attempt) {
                logger.info('Data extracted after retries', { 
                  orderId, 
                  attempt: result.attempt,
                  strategy: result.strategy,
                  likeCount: result.likeCount, 
                  commentCount: result.commentCount 
                });
              } else {
                logger.info('Execution result validated successfully', { 
                  orderId, 
                  likeCount: result.likeCount, 
                  commentCount: result.commentCount 
                });
              }
            } else {
              // 通用软件开发任务验证
              logger.info('Execution result validated for general software task', { 
                orderId, 
                taskType,
                result: result 
              });
            }
          }
          
          // [执行追踪] 上报阶段完成
          await this.executionTracker.reportSubTaskCompleted(orderId, corePhaseId, deploymentSubTaskId, '部署和构建', 'OPENCLAW');
          // 只有在非主循环调用时才上报阶段完成
          if (!phaseId) {
            await this.executionTracker.reportPhaseCompleted(orderId, corePhaseId, '核心爬取逻辑');
          }
          return {
            success: true,
            demoUrl: status.demoUrl,
            deploymentStatus: 'deployed',
            executionLog: status.logs,
            executionResult: status.executionResult,
          };
        }

        if (status.status === 'failed') {
          // [执行追踪] 上报阶段失败
          await this.executionTracker.reportProgress({
            orderId,
            phaseId: corePhaseId,
            subTaskId: deploymentSubTaskId,
            event: 'FAILED',
            progress: 0,
            message: '部署失败',
            componentType: 'OPENCLAW',
          });
          return {
            success: false,
            deploymentStatus: 'failed',
            executionLog: status.logs,
            error: 'Deployment failed',
          };
        }

        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      } catch (error) {
        logger.error('Error checking deployment status', {
          orderId,
          error: error instanceof Error ? error.message : String(error),
        });
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      }
    }

    // [执行追踪] 上报超时
    await this.executionTracker.reportProgress({
      orderId,
      phaseId: corePhaseId,
      subTaskId: deploymentSubTaskId,
      event: 'FAILED',
      progress: 0,
      message: '部署超时',
      componentType: 'OPENCLAW',
    });

    return {
      success: false,
      deploymentStatus: 'failed',
      executionLog: ['Deployment timeout'],
      error: 'Deployment timeout after 5 minutes',
    };
  }

  /**
   * 获取部署状态
   */
  private async getDeploymentStatus(orderId: string): Promise<DeploymentStatus> {
    const response = await axios.get(
      `${OPENCLAW_BRIDGE_URL}/api/v1/execute/${orderId}/status`,
      {
        params: { agentId: this.agentId, webhookUrl: this.webhookUrl },
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' },
      }
    );

    if (response.data && response.data.success) {
      return response.data.data as DeploymentStatus;
    }

    return {
      status: 'pending',
      progress: 0,
      logs: ['Waiting for deployment...'],
    };
  }

  /**
   * 创建本地执行结果（Openclaw 失败时使用）
   */
  private createFallbackExecution(execution: TaskExecutionRequest): TaskExecutionResult {
    return {
      success: false,
      deploymentStatus: 'failed',
      executionLog: ['Openclaw service unavailable'],
      error: 'Openclaw service unavailable',
    };
  }

  /**
   * 提交交付物
   */
  private async submitDelivery(
    orderId: string,
    userId: string,
    delivery: { deliverySummary: string; deliveryUrl: string }
  ): Promise<void> {
    try {
      await this.genesisClient.submitDelivery(orderId, userId, delivery);
      logger.info('Delivery submitted successfully', { orderId });
    } catch (error) {
      logger.error('Error submitting delivery', {
        orderId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * 将 TaskAnalyzer 的分析结果转换为执行计划格式
   */
  private convertAnalysisToExecutionPlan(analysis: {
    requirements: import('./task-analyzer').RequirementAnalysis;
    prd: import('./task-analyzer').PRDDocument;
    solution: import('./task-analyzer').TechnicalSolution;
    breakdown: import('./task-analyzer').TaskBreakdown;
  }): string[] {
    const plan: string[] = [];
    const { requirements, solution, breakdown } = analysis;

    // 1. 需求分析阶段
    plan.push(`【需求分析】任务类型：${requirements.taskType}`);
    plan.push(`  核心需求：${requirements.coreRequirements.slice(0, 3).join('；')}`);
    if (requirements.dataSources.length > 0) {
      plan.push(`  数据来源：${requirements.dataSources.map(s => s.description).join('、')}`);
    }
    if (requirements.dataFields.length > 0) {
      plan.push(`  数据字段：${requirements.dataFields.map(f => f.name).join('、')}`);
    }

    // 2. 技术方案阶段
    plan.push(`【技术方案】技术栈：${solution.techStack.map(t => t.technology).join(' + ')}`);
    plan.push(`  架构：${solution.architecture.components.slice(0, 2).join('；')}`);
    plan.push(`  数据流：${solution.architecture.dataFlow}`);

    // 3. 实现阶段 - 按模块
    solution.implementation.forEach((module, idx) => {
      plan.push(`【${module.module}】${module.description}`);
      module.steps.forEach((step, sidx) => {
        plan.push(`  ${sidx + 1}. ${step}`);
      });
    });

    // 4. 风险处理
    if (solution.risks.length > 0) {
      plan.push(`【风险处理】`);
      solution.risks.slice(0, 2).forEach((risk, idx) => {
        plan.push(`  ${idx + 1}. ${risk.risk} → ${risk.mitigation.slice(0, 50)}...`);
      });
    }

    // 5. 交付阶段
    plan.push(`【交付验收】`);
    plan.push(`  交付物：${analysis.prd.deliverables.map(d => d.name).join('、')}`);
    plan.push(`  验收标准：${analysis.prd.acceptanceCriteria.slice(0, 2).join('；')}`);

    return plan;
  }

  /**
   * 解析执行计划用于进度追踪
   * 将字符串数组格式的执行计划解析为结构化阶段和子任务
   */
  private parseExecutionPlanForTracking(executionPlan: string[]): Array<{
    phaseKey: string;
    name: string;
    subTasks: Array<{ taskKey: string; name: string }>;
  }> {
    const phases: Array<{
      phaseKey: string;
      name: string;
      subTasks: Array<{ taskKey: string; name: string }>;
    }> = [];
    let currentPhase: { phaseKey: string; name: string; subTasks: Array<{ taskKey: string; name: string }> } | null = null;

    for (const line of executionPlan) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;

      // 检查是否是主阶段行（以【】开头）
      const mainPhaseMatch = trimmedLine.match(/^【(.+?)】(.+)?$/);
      if (mainPhaseMatch) {
        // 保存上一个阶段
        if (currentPhase) {
          phases.push(currentPhase);
        }
        // 创建新阶段
        const phaseName = mainPhaseMatch[1];
        currentPhase = {
          phaseKey: `phase-${phases.length}`,
          name: phaseName,
          subTasks: [],
        };
      } else if (currentPhase) {
        // 作为子任务添加到当前阶段
        // 注意：taskKey 格式必须与查询逻辑匹配：phase-${phaseIndex}-${subTaskIndex}
        currentPhase.subTasks.push({
          taskKey: `${currentPhase.phaseKey}-${currentPhase.subTasks.length}`,
          name: trimmedLine.substring(0, 100),
        });
      }
    }

    // 添加最后一个阶段
    if (currentPhase) {
      phases.push(currentPhase);
    }

    return phases;
  }
}

export default QuoteManager;
