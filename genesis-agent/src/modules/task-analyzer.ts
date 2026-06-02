import { Task, TaskAnalysis } from '../types';
import { getLogger } from '../utils/logger';

const logger = getLogger();

/**
 * 需求分析结果
 */
export interface RequirementAnalysis {
  // 任务类型
  taskType: string;
  taskCategory: 'data_collection' | 'api_development' | 'data_processing' | 'automation' | 'web_development' | 'other';
  
  // 核心需求
  coreRequirements: string[];
  
  // 数据来源/目标
  dataSources: {
    type: string;
    url?: string;
    description: string;
  }[];
  
  // 数据字段
  dataFields: {
    name: string;
    type: string;
    description: string;
    required: boolean;
  }[];
  
  // 约束条件
  constraints: {
    antiCrawl?: boolean;
    loginRequired?: boolean;
    dynamicContent?: boolean;
    rateLimit?: boolean;
    captcha?: boolean;
  };
  
  // 交付物要求
  deliverables: string[];
  
  // 质量标准
  qualityStandards: string[];
}

/**
 * PRD 文档
 */
export interface PRDDocument {
  // 项目概述
  overview: {
    title: string;
    description: string;
    background: string;
    goals: string[];
  };
  
  // 功能需求
  functionalRequirements: {
    id: string;
    title: string;
    description: string;
    priority: 'high' | 'medium' | 'low';
    acceptanceCriteria: string[];
  }[];
  
  // 非功能需求
  nonFunctionalRequirements: {
    category: string;
    requirements: string[];
  }[];
  
  // 数据需求
  dataRequirements: {
    sources: string[];
    fields: string[];
    format: string;
    volume?: string;
  };
  
  // 验收标准
  acceptanceCriteria: string[];
  
  // 交付物清单
  deliverables: {
    name: string;
    description: string;
    format: string;
  }[];
}

/**
 * 技术方案文档
 */
export interface TechnicalSolution {
  // 技术选型
  techStack: {
    category: string;
    technology: string;
    reason: string;
  }[];
  
  // 架构设计
  architecture: {
    components: string[];
    dataFlow: string;
    deployment: string;
  };
  
  // 实现方案
  implementation: {
    module: string;
    description: string;
    steps: string[];
    dependencies: string[];
  }[];
  
  // 风险与对策
  risks: {
    risk: string;
    impact: 'high' | 'medium' | 'low';
    mitigation: string;
  }[];
}

/**
 * 任务拆解
 */
export interface TaskBreakdown {
  // 阶段划分
  phases: {
    name: string;
    duration: string;
    tasks: {
      id: string;
      name: string;
      description: string;
      estimatedHours: number;
      dependencies: string[];
      deliverables: string[];
    }[];
  }[];
  
  // 关键路径
  criticalPath: string[];
  
  // 里程碑
  milestones: {
    name: string;
    description: string;
    criteria: string[];
  }[];
}

/**
 * 任务分析器
 * 使用 Skills 灵活分析任务，生成 PRD、技术方案和任务拆解
 */
export class TaskAnalyzer {
  /**
   * 深度分析任务需求
   */
  analyzeRequirements(task: Task): RequirementAnalysis {
    const description = task.description || '';
    const title = task.title || '';
    const acceptanceCriteria = task.acceptanceCriteria || '';
    const fullText = (title + ' ' + description + ' ' + acceptanceCriteria).toLowerCase();

    // 1. 识别任务类型
    const taskType = this.identifyTaskType(fullText);
    const taskCategory = this.categorizeTask(fullText);

    // 2. 提取核心需求
    const coreRequirements = this.extractCoreRequirements(description, acceptanceCriteria);

    // 3. 识别数据来源
    const dataSources = this.extractDataSources(description);

    // 4. 提取数据字段
    const dataFields = this.extractDataFields(description, acceptanceCriteria);

    // 5. 识别约束条件
    const constraints = this.identifyConstraints(fullText);

    // 6. 提取交付物要求
    const deliverables = this.extractDeliverables(description, acceptanceCriteria);

    // 7. 提取质量标准
    const qualityStandards = this.extractQualityStandards(acceptanceCriteria);

    return {
      taskType,
      taskCategory,
      coreRequirements,
      dataSources,
      dataFields,
      constraints,
      deliverables,
      qualityStandards,
    };
  }

  /**
   * 生成 PRD 文档
   */
  generatePRD(task: Task, requirements: RequirementAnalysis): PRDDocument {
    const title = task.title || '未命名任务';
    const description = task.description || '';

    // 1. 项目概述
    const overview = {
      title,
      description,
      background: this.generateBackground(description),
      goals: requirements.coreRequirements,
    };

    // 2. 功能需求
    const functionalRequirements = this.generateFunctionalRequirements(requirements);

    // 3. 非功能需求
    const nonFunctionalRequirements = this.generateNonFunctionalRequirements(requirements);

    // 4. 数据需求
    const dataRequirements = {
      sources: requirements.dataSources.map(s => s.description),
      fields: requirements.dataFields.map(f => f.name),
      format: this.determineDataFormat(requirements),
      volume: this.estimateDataVolume(requirements),
    };

    // 5. 验收标准
    const acceptanceCriteria = task.acceptanceCriteria 
      ? task.acceptanceCriteria.split(/\n|;/).filter(s => s.trim())
      : requirements.qualityStandards;

    // 6. 交付物清单
    const deliverables = requirements.deliverables.map((name, idx) => ({
      name,
      description: this.describeDeliverable(name, requirements),
      format: this.determineDeliverableFormat(name),
    }));

    return {
      overview,
      functionalRequirements,
      nonFunctionalRequirements,
      dataRequirements,
      acceptanceCriteria,
      deliverables,
    };
  }

  /**
   * 生成技术方案
   */
  generateTechnicalSolution(task: Task, requirements: RequirementAnalysis): TechnicalSolution {
    // 1. 技术选型
    const techStack = this.selectTechStack(requirements);

    // 2. 架构设计
    const architecture = this.designArchitecture(requirements);

    // 3. 实现方案
    const implementation = this.designImplementation(requirements);

    // 4. 风险与对策
    const risks = this.identifyRisks(requirements);

    return {
      techStack,
      architecture,
      implementation,
      risks,
    };
  }

  /**
   * 生成任务拆解
   */
  generateTaskBreakdown(task: Task, requirements: RequirementAnalysis, solution: TechnicalSolution): TaskBreakdown {
    // 1. 阶段划分
    const phases = this.definePhases(requirements, solution);

    // 2. 关键路径
    const criticalPath = this.identifyCriticalPath(phases);

    // 3. 里程碑
    const milestones = this.defineMilestones(phases);

    return {
      phases,
      criticalPath,
      milestones,
    };
  }

  /**
   * 生成完整的分析报告
   */
  generateFullAnalysis(task: Task): {
    requirements: RequirementAnalysis;
    prd: PRDDocument;
    solution: TechnicalSolution;
    breakdown: TaskBreakdown;
  } {
    const requirements = this.analyzeRequirements(task);
    const prd = this.generatePRD(task, requirements);
    const solution = this.generateTechnicalSolution(task, requirements);
    const breakdown = this.generateTaskBreakdown(task, requirements, solution);

    return {
      requirements,
      prd,
      solution,
      breakdown,
    };
  }

  // ==================== 私有辅助方法 ====================

  /**
   * 识别任务类型
   */
  private identifyTaskType(text: string): string {
    if (text.includes('爬虫') || text.includes('抓取') || text.includes('爬取')) {
      if (text.includes('抖音')) return '抖音数据采集';
      if (text.includes('微博')) return '微博数据采集';
      if (text.includes('小红书')) return '小红书数据采集';
      if (text.includes('淘宝') || text.includes('京东')) return '电商数据采集';
      return '网页数据采集';
    }
    if (text.includes('api') || text.includes('接口')) return 'API开发';
    if (text.includes('数据清洗') || text.includes('数据处理')) return '数据处理';
    if (text.includes('自动化') || text.includes('脚本')) return '自动化脚本';
    if (text.includes('网站') || text.includes('web')) return 'Web开发';
    return '软件开发';
  }

  /**
   * 分类任务
   */
  private categorizeTask(text: string): RequirementAnalysis['taskCategory'] {
    if (text.includes('爬虫') || text.includes('抓取') || text.includes('爬取')) return 'data_collection';
    if (text.includes('api') || text.includes('接口')) return 'api_development';
    if (text.includes('数据清洗') || text.includes('数据处理')) return 'data_processing';
    if (text.includes('自动化') || text.includes('脚本')) return 'automation';
    if (text.includes('网站') || text.includes('web')) return 'web_development';
    return 'other';
  }

  /**
   * 提取核心需求
   */
  private extractCoreRequirements(description: string, acceptanceCriteria: string): string[] {
    const requirements: string[] = [];
    const text = description + ' ' + acceptanceCriteria;
    
    // 提取动词+名词结构的需求
    const patterns = [
      /(?:需要|必须|要求|实现|提供|支持|完成|开发|设计|创建|生成|提取|采集|抓取|分析|处理|导出)[^。；\n]*/g,
      /(?:能|可以|支持|实现)[^。；\n]*吗/g,
    ];
    
    for (const pattern of patterns) {
      const matches = text.match(pattern);
      if (matches) {
        requirements.push(...matches.map(m => m.trim()).filter(m => m.length > 5));
      }
    }
    
    return [...new Set(requirements)].slice(0, 8);
  }

  /**
   * 提取数据来源
   */
  private extractDataSources(description: string): RequirementAnalysis['dataSources'] {
    const sources: RequirementAnalysis['dataSources'] = [];
    
    // 提取URL
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urls = description.match(urlRegex) || [];
    
    urls.forEach(url => {
      sources.push({
        type: 'web_page',
        url,
        description: `网页数据源: ${url}`,
      });
    });
    
    // 识别平台
    if (description.includes('抖音')) {
      sources.push({
        type: 'platform',
        description: '抖音平台 - 视频、用户、互动数据',
      });
    }
    if (description.includes('微博')) {
      sources.push({
        type: 'platform',
        description: '微博平台 - 博文、用户、互动数据',
      });
    }
    if (description.includes('小红书')) {
      sources.push({
        type: 'platform',
        description: '小红书平台 - 笔记、用户、互动数据',
      });
    }
    
    return sources;
  }

  /**
   * 提取数据字段
   */
  private extractDataFields(description: string, acceptanceCriteria: string): RequirementAnalysis['dataFields'] {
    const fields: RequirementAnalysis['dataFields'] = [];
    const text = (description + ' ' + acceptanceCriteria).toLowerCase();
    
    // 字段映射
    const fieldMappings = [
      { keywords: ['点赞', 'like'], name: '点赞数', type: 'number' },
      { keywords: ['评论', 'comment'], name: '评论数', type: 'number' },
      { keywords: ['收藏', 'favorite'], name: '收藏数', type: 'number' },
      { keywords: ['转发', '分享', 'share'], name: '转发数', type: 'number' },
      { keywords: ['播放', 'view'], name: '播放量', type: 'number' },
      { keywords: ['粉丝', 'follower'], name: '粉丝数', type: 'number' },
      { keywords: ['关注', 'following'], name: '关注数', type: 'number' },
      { keywords: ['标题', 'title'], name: '标题', type: 'string' },
      { keywords: ['描述', 'description'], name: '描述', type: 'string' },
      { keywords: ['作者', '用户', 'author', 'user'], name: '作者信息', type: 'object' },
      { keywords: ['主页', 'homepage'], name: '主页链接', type: 'string' },
      { keywords: ['产品', '商品', 'product'], name: '产品信息', type: 'object' },
      { keywords: ['价格', 'price'], name: '价格', type: 'number' },
      { keywords: ['链接', 'url', 'link'], name: '链接', type: 'string' },
    ];
    
    for (const mapping of fieldMappings) {
      if (mapping.keywords.some(k => text.includes(k))) {
        fields.push({
          name: mapping.name,
          type: mapping.type,
          description: `从任务描述中提取的${mapping.name}字段`,
          required: true,
        });
      }
    }
    
    return fields;
  }

  /**
   * 识别约束条件
   */
  private identifyConstraints(text: string): RequirementAnalysis['constraints'] {
    return {
      antiCrawl: text.includes('反爬') || text.includes('防护'),
      loginRequired: text.includes('登录') || text.includes('账号'),
      dynamicContent: text.includes('动态') || text.includes('js') || text.includes('javascript'),
      rateLimit: text.includes('限制') || text.includes('频率') || text.includes('ip'),
      captcha: text.includes('验证码') || text.includes('captcha') || text.includes('扫码'),
    };
  }

  /**
   * 提取交付物要求
   */
  private extractDeliverables(description: string, acceptanceCriteria: string): string[] {
    const deliverables: string[] = [];
    const text = (description + ' ' + acceptanceCriteria).toLowerCase();
    
    // 代码相关
    if (text.includes('代码') || text.includes('脚本') || text.includes('程序')) {
      deliverables.push('源代码');
    }
    
    // 数据相关
    if (text.includes('数据') || text.includes('采集') || text.includes('抓取')) {
      deliverables.push('数据文件');
      deliverables.push('数据样本');
    }
    
    // 文档相关
    if (text.includes('文档') || text.includes('说明')) {
      deliverables.push('使用文档');
    }
    
    // 配置相关
    if (text.includes('配置')) {
      deliverables.push('配置文件');
    }
    
    // 默认交付物
    if (deliverables.length === 0) {
      deliverables.push('源代码', '使用文档', '测试报告');
    }
    
    return deliverables;
  }

  /**
   * 提取质量标准
   */
  private extractQualityStandards(acceptanceCriteria: string): string[] {
    if (!acceptanceCriteria) return [];
    
    return acceptanceCriteria
      .split(/\n|;/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
  }

  /**
   * 生成项目背景
   */
  private generateBackground(description: string): string {
    return `基于业务需求，需要${description.slice(0, 100)}...`;
  }

  /**
   * 生成功能需求
   */
  private generateFunctionalRequirements(reqs: RequirementAnalysis): PRDDocument['functionalRequirements'] {
    const requirements: PRDDocument['functionalRequirements'] = [];
    
    // 根据任务类型生成对应的功能需求
    switch (reqs.taskCategory) {
      case 'data_collection':
        requirements.push(
          {
            id: 'FR-001',
            title: '数据采集',
            description: `从${reqs.dataSources.map(s => s.description).join('、')}采集数据`,
            priority: 'high',
            acceptanceCriteria: reqs.qualityStandards.slice(0, 3),
          },
          {
            id: 'FR-002',
            title: '数据解析',
            description: `提取字段：${reqs.dataFields.map(f => f.name).join('、')}`,
            priority: 'high',
            acceptanceCriteria: ['数据字段完整', '格式正确'],
          },
          {
            id: 'FR-003',
            title: '数据存储',
            description: '将采集的数据保存到指定格式',
            priority: 'medium',
            acceptanceCriteria: ['数据可读取', '格式规范'],
          }
        );
        break;
        
      case 'api_development':
        requirements.push(
          {
            id: 'FR-001',
            title: 'API接口实现',
            description: '实现RESTful API接口',
            priority: 'high',
            acceptanceCriteria: ['接口可调用', '返回格式正确'],
          }
        );
        break;
        
      default:
        requirements.push(
          {
            id: 'FR-001',
            title: '功能实现',
            description: '完成核心功能开发',
            priority: 'high',
            acceptanceCriteria: reqs.qualityStandards.slice(0, 3),
          }
        );
    }
    
    return requirements;
  }

  /**
   * 生成非功能需求
   */
  private generateNonFunctionalRequirements(reqs: RequirementAnalysis): PRDDocument['nonFunctionalRequirements'] {
    const nfRequirements: PRDDocument['nonFunctionalRequirements'] = [];
    
    // 性能需求
    const performanceReqs: string[] = [];
    if (reqs.taskCategory === 'data_collection') {
      performanceReqs.push('采集速度：根据目标网站限制合理设置请求频率');
      performanceReqs.push('数据完整性：确保关键字段100%采集成功');
    }
    if (performanceReqs.length > 0) {
      nfRequirements.push({ category: '性能', requirements: performanceReqs });
    }
    
    // 可靠性需求
    const reliabilityReqs: string[] = [];
    reliabilityReqs.push('异常处理：网络错误、超时等情况需要重试机制');
    reliabilityReqs.push('日志记录：关键操作需要记录日志便于排查问题');
    nfRequirements.push({ category: '可靠性', requirements: reliabilityReqs });
    
    // 可维护性需求
    const maintainabilityReqs: string[] = [];
    maintainabilityReqs.push('代码注释：核心逻辑需要添加注释');
    maintainabilityReqs.push('配置化：关键参数需要可配置');
    nfRequirements.push({ category: '可维护性', requirements: maintainabilityReqs });
    
    return nfRequirements;
  }

  /**
   * 确定数据格式
   */
  private determineDataFormat(reqs: RequirementAnalysis): string {
    if (reqs.taskCategory === 'data_collection') {
      return 'JSON/CSV 格式，便于程序读取和人工查看';
    }
    return '根据实际需求确定';
  }

  /**
   * 估算数据量
   */
  private estimateDataVolume(reqs: RequirementAnalysis): string | undefined {
    if (reqs.taskCategory === 'data_collection') {
      return '根据实际采集范围确定，建议提供样本数据验证格式';
    }
    return undefined;
  }

  /**
   * 描述交付物
   */
  private describeDeliverable(name: string, reqs: RequirementAnalysis): string {
    const descriptions: Record<string, string> = {
      '源代码': '完整可运行的程序代码，包含详细注释',
      '数据文件': '采集的数据结果，按约定格式存储',
      '数据样本': '用于验证格式的样本数据（建议100条）',
      '使用文档': '环境配置、安装步骤、使用方法说明',
      '配置文件': '可调整的参数配置，便于灵活使用',
      '测试报告': '功能测试结果和验证记录',
    };
    return descriptions[name] || `${name}交付物`;
  }

  /**
   * 确定交付物格式
   */
  private determineDeliverableFormat(name: string): string {
    const formats: Record<string, string> = {
      '源代码': 'Python/Node.js 源码文件',
      '数据文件': 'JSON/CSV',
      '数据样本': 'JSON/CSV',
      '使用文档': 'Markdown/PDF',
      '配置文件': 'JSON/YAML',
      '测试报告': 'Markdown/PDF',
    };
    return formats[name] || '根据需求确定';
  }

  /**
   * 选择技术栈
   */
  private selectTechStack(reqs: RequirementAnalysis): TechnicalSolution['techStack'] {
    const techStack: TechnicalSolution['techStack'] = [];
    
    switch (reqs.taskCategory) {
      case 'data_collection':
        techStack.push(
          {
            category: '编程语言',
            technology: 'Python 3.8+',
            reason: '丰富的爬虫库支持，开发效率高',
          },
          {
            category: 'HTTP请求',
            technology: reqs.constraints.dynamicContent ? 'Playwright/Selenium' : 'Requests',
            reason: reqs.constraints.dynamicContent 
              ? '需要处理JavaScript动态渲染的页面'
              : '轻量级，适合静态页面抓取',
          },
          {
            category: 'HTML解析',
            technology: 'BeautifulSoup4 / lxml',
            reason: '解析HTML提取数据，支持CSS选择器和XPath',
          },
          {
            category: '数据存储',
            technology: 'JSON / CSV',
            reason: '便于程序读取和人工查看',
          }
        );
        
        if (reqs.constraints.antiCrawl || reqs.constraints.rateLimit) {
          techStack.push({
            category: '反爬处理',
            technology: '请求间隔控制 + User-Agent轮换',
            reason: '降低被封禁风险',
          });
        }
        break;
        
      case 'api_development':
        techStack.push(
          {
            category: '编程语言',
            technology: 'Node.js / Python',
            reason: '适合快速开发RESTful API',
          },
          {
            category: 'Web框架',
            technology: 'Express / FastAPI',
            reason: '轻量级，性能优秀',
          }
        );
        break;
        
      default:
        techStack.push(
          {
            category: '编程语言',
            technology: 'Python / Node.js',
            reason: '根据具体需求选择',
          }
        );
    }
    
    return techStack;
  }

  /**
   * 设计架构
   */
  private designArchitecture(reqs: RequirementAnalysis): TechnicalSolution['architecture'] {
    const components: string[] = [];
    
    switch (reqs.taskCategory) {
      case 'data_collection':
        components.push('请求模块：发送HTTP请求获取页面内容');
        components.push('解析模块：提取目标数据字段');
        components.push('存储模块：保存数据到文件');
        components.push('配置模块：管理请求参数和选择器');
        if (reqs.constraints.antiCrawl) {
          components.push('反爬模块：处理请求间隔、User-Agent轮换');
        }
        break;
      case 'api_development':
        components.push('路由层：定义API端点');
        components.push('控制器层：处理请求参数和业务逻辑');
        components.push('数据层：数据库操作');
        break;
      default:
        components.push('核心模块：实现主要功能');
        components.push('工具模块：辅助函数');
    }
    
    return {
      components,
      dataFlow: this.describeDataFlow(reqs),
      deployment: '本地运行，提供使用说明',
    };
  }

  /**
   * 描述数据流
   */
  private describeDataFlow(reqs: RequirementAnalysis): string {
    switch (reqs.taskCategory) {
      case 'data_collection':
        return '目标网站 → HTTP请求 → HTML解析 → 数据提取 → 数据清洗 → 文件存储';
      case 'api_development':
        return '客户端请求 → 路由 → 控制器 → 数据库 → 响应返回';
      default:
        return '输入 → 处理 → 输出';
    }
  }

  /**
   * 设计实现方案
   */
  private designImplementation(reqs: RequirementAnalysis): TechnicalSolution['implementation'] {
    const implementation: TechnicalSolution['implementation'] = [];
    
    switch (reqs.taskCategory) {
      case 'data_collection':
        implementation.push(
          {
            module: '页面分析',
            description: '使用浏览器开发者工具分析目标页面结构',
            steps: [
              '打开目标页面',
              '使用Chrome DevTools检查元素',
              '确定数据所在HTML标签和CSS选择器',
              '验证选择器是否能正确定位目标数据',
            ],
            dependencies: [],
          },
          {
            module: '核心爬取逻辑',
            description: '实现数据抓取和解析',
            steps: [
              '发送HTTP请求获取页面HTML',
              '使用BeautifulSoup解析HTML',
              '根据CSS选择器提取数据字段',
              '处理分页或滚动加载（如有）',
            ],
            dependencies: ['页面分析'],
          },
          {
            module: '数据存储',
            description: '将提取的数据保存到文件',
            steps: [
              '定义数据结构和字段映射',
              '实现JSON/CSV导出功能',
              '添加数据验证和清洗',
            ],
            dependencies: ['核心爬取逻辑'],
          },
          {
            module: '健壮性处理',
            description: '添加异常处理和反爬策略',
            steps: [
              '实现请求重试机制',
              '添加请求间隔控制',
              '处理网络超时和异常',
              '记录操作日志',
            ],
            dependencies: ['核心爬取逻辑'],
          }
        );
        break;
        
      default:
        implementation.push({
          module: '功能实现',
          description: '根据需求实现核心功能',
          steps: ['需求分析', '方案设计', '编码实现', '测试验证'],
          dependencies: [],
        });
    }
    
    return implementation;
  }

  /**
   * 识别风险
   */
  private identifyRisks(reqs: RequirementAnalysis): TechnicalSolution['risks'] {
    const risks: TechnicalSolution['risks'] = [];
    
    if (reqs.constraints.antiCrawl) {
      risks.push({
        risk: '目标网站有反爬机制，可能导致IP被封禁',
        impact: 'high',
        mitigation: '设置合理的请求间隔（2-5秒），使用User-Agent轮换，必要时使用代理IP',
      });
    }
    
    if (reqs.constraints.dynamicContent) {
      risks.push({
        risk: '页面使用JavaScript动态渲染，静态请求无法获取完整数据',
        impact: 'medium',
        mitigation: '使用Playwright/Selenium模拟浏览器行为，等待页面完全加载后再提取数据',
      });
    }
    
    if (reqs.constraints.loginRequired) {
      risks.push({
        risk: '需要登录才能访问目标数据',
        impact: 'medium',
        mitigation: '使用Cookie或Session维持登录状态，或提供扫码登录功能',
      });
    }
    
    // 通用风险
    risks.push({
      risk: '目标网站结构变更导致选择器失效',
      impact: 'medium',
      mitigation: '使用相对稳定的属性作为选择器，添加异常处理和日志记录便于快速定位问题',
    });
    
    return risks;
  }

  /**
   * 定义阶段
   */
  private definePhases(reqs: RequirementAnalysis, solution: TechnicalSolution): TaskBreakdown['phases'] {
    const phases: TaskBreakdown['phases'] = [];
    
    // 阶段1：需求分析与技术准备
    const phase1Tasks: TaskBreakdown['phases'][0]['tasks'] = [];
    phase1Tasks.push({
      id: 'T-001',
      name: '需求分析',
      description: '深入理解任务需求，明确数据字段和验收标准',
      estimatedHours: 1,
      dependencies: [],
      deliverables: ['需求理解文档'],
    });
    phase1Tasks.push({
      id: 'T-002',
      name: '技术调研',
      description: '分析目标网站结构，确定技术方案',
      estimatedHours: 1,
      dependencies: ['T-001'],
      deliverables: ['技术分析报告'],
    });
    
    phases.push({
      name: '需求分析与技术准备',
      duration: '0.5天',
      tasks: phase1Tasks,
    });
    
    // 阶段2：开发实现
    const phase2Tasks: TaskBreakdown['phases'][0]['tasks'] = [];
    let taskId = 3;
    
    for (const module of solution.implementation) {
      phase2Tasks.push({
        id: `T-${String(taskId).padStart(3, '0')}`,
        name: module.module,
        description: module.description,
        estimatedHours: 2,
        dependencies: module.dependencies.map(d => {
          // 找到依赖任务的ID
          const depTask = phase2Tasks.find(t => t.name.includes(d));
          return depTask?.id || 'T-002';
        }),
        deliverables: [`${module.module}代码`],
      });
      taskId++;
    }
    
    phases.push({
      name: '开发实现',
      duration: '1-2天',
      tasks: phase2Tasks,
    });
    
    // 阶段3：测试与交付
    const phase3Tasks: TaskBreakdown['phases'][0]['tasks'] = [];
    phase3Tasks.push({
      id: `T-${String(taskId).padStart(3, '0')}`,
      name: '功能测试',
      description: '验证功能完整性，测试边界条件',
      estimatedHours: 1,
      dependencies: [`T-${String(taskId - 1).padStart(3, '0')}`],
      deliverables: ['测试报告'],
    });
    taskId++;
    
    phase3Tasks.push({
      id: `T-${String(taskId).padStart(3, '0')}`,
      name: '文档编写',
      description: '编写使用说明和部署文档',
      estimatedHours: 1,
      dependencies: [],
      deliverables: ['README.md'],
    });
    
    phases.push({
      name: '测试与交付',
      duration: '0.5天',
      tasks: phase3Tasks,
    });
    
    return phases;
  }

  /**
   * 识别关键路径
   */
  private identifyCriticalPath(phases: TaskBreakdown['phases']): string[] {
    const path: string[] = [];
    
    for (const phase of phases) {
      for (const task of phase.tasks) {
        if (task.dependencies.length === 0 || path.length === 0) {
          path.push(task.id);
        }
      }
    }
    
    return path;
  }

  /**
   * 定义里程碑
   */
  private defineMilestones(phases: TaskBreakdown['phases']): TaskBreakdown['milestones'] {
    return [
      {
        name: '需求确认',
        description: '完成需求分析，确认技术方案',
        criteria: ['需求理解无误', '技术方案可行'],
      },
      {
        name: '开发完成',
        description: '核心功能开发完毕',
        criteria: ['代码可运行', '基本功能正常'],
      },
      {
        name: '项目交付',
        description: '完成测试和文档，正式交付',
        criteria: ['功能测试通过', '文档完整', '验收标准达成'],
      },
    ];
  }

  /**
   * 将分析结果格式化为文本
   */
  formatAnalysisToText(analysis: {
    requirements: RequirementAnalysis;
    prd: PRDDocument;
    solution: TechnicalSolution;
    breakdown: TaskBreakdown;
  }): string {
    const { requirements, prd, solution, breakdown } = analysis;
    
    let text = '';
    
    // 1. 需求分析
    text += `【需求分析】\n\n`;
    text += `任务类型：${requirements.taskType}\n`;
    text += `核心需求：\n`;
    requirements.coreRequirements.forEach((req, idx) => {
      text += `  ${idx + 1}. ${req}\n`;
    });
    
    if (requirements.dataSources.length > 0) {
      text += `\n数据来源：\n`;
      requirements.dataSources.forEach((src, idx) => {
        text += `  ${idx + 1}. ${src.description}\n`;
      });
    }
    
    if (requirements.dataFields.length > 0) {
      text += `\n数据字段：\n`;
      requirements.dataFields.forEach((field, idx) => {
        text += `  ${idx + 1}. ${field.name} (${field.type})\n`;
      });
    }
    
    // 2. 技术方案
    text += `\n【技术方案】\n\n`;
    text += `技术栈：\n`;
    solution.techStack.forEach((tech, idx) => {
      text += `  ${idx + 1}. ${tech.category}：${tech.technology}\n`;
      text += `     原因：${tech.reason}\n`;
    });
    
    text += `\n架构设计：\n`;
    solution.architecture.components.forEach((comp, idx) => {
      text += `  ${idx + 1}. ${comp}\n`;
    });
    
    text += `\n数据流：${solution.architecture.dataFlow}\n`;
    
    // 3. 实现步骤
    text += `\n【实现步骤】\n\n`;
    solution.implementation.forEach((module, idx) => {
      text += `${idx + 1}. ${module.module}\n`;
      text += `   ${module.description}\n`;
      text += `   步骤：\n`;
      module.steps.forEach((step, sidx) => {
        text += `     ${sidx + 1}) ${step}\n`;
      });
      text += `\n`;
    });
    
    // 4. 风险与对策
    if (solution.risks.length > 0) {
      text += `【风险与对策】\n\n`;
      solution.risks.forEach((risk, idx) => {
        text += `${idx + 1}. ${risk.risk} (影响：${risk.impact})\n`;
        text += `   对策：${risk.mitigation}\n\n`;
      });
    }
    
    // 5. 交付物
    text += `【交付物清单】\n\n`;
    prd.deliverables.forEach((del, idx) => {
      text += `${idx + 1}. ${del.name}\n`;
      text += `   ${del.description}\n`;
      text += `   格式：${del.format}\n\n`;
    });
    
    return text;
  }
}
