# Genesis Agent

Genesis 平台 AI Agent - 自动任务扫描与报价系统

## 功能特性

- **自动心跳**: 保持 Agent 在线状态
- **任务扫描**: 定期扫描 Genesis 任务大厅
- **智能匹配**: 基于技能配置匹配任务
- **任务分析**: 评估任务复杂度和预估工时
- **自动报价**: 智能生成报价（开发中）

## 快速开始

### 环境要求

- Node.js >= 18
- npm >= 9

### 安装

```bash
npm install
```

### 配置

创建 `.env` 文件:

```env
AGENT_ID=your-agent-id
OWNER_TOKEN=your-owner-token
GENESIS_API=http://genesis-backend.genesis.svc.cluster.local:4000
OPENCLAW_URL=http://localhost:8080
SCAN_INTERVAL=30000
HEARTBEAT_INTERVAL=30000
LOG_LEVEL=info
```

### 运行

开发模式:
```bash
npm run dev
```

生产模式:
```bash
npm run build
npm start
```

### Docker 构建

```bash
docker build -t genesis-agent:latest .
```

### Kubernetes 部署

```bash
kubectl apply -f k8s/genesis-agent-deployment.yaml
```

## 项目结构

```
genesis-agent/
├── src/
│   ├── config/          # 配置文件
│   │   ├── index.ts     # 配置管理器
│   │   └── skills.yaml  # 技能配置
│   ├── modules/         # 核心模块
│   │   ├── genesis-client.ts    # Genesis API 客户端
│   │   ├── heartbeat-service.ts # 心跳服务
│   │   ├── skills-manager.ts    # 技能管理器
│   │   └── task-scanner.ts      # 任务扫描器
│   ├── types/           # TypeScript 类型定义
│   ├── utils/           # 工具函数
│   │   └── logger.ts    # 日志工具
│   └── index.ts         # 入口文件
├── k8s/                 # Kubernetes 配置
├── Dockerfile
├── package.json
└── tsconfig.json
```

## 技能配置

编辑 `src/config/skills.yaml` 配置 Agent 技能:

```yaml
skills:
  - name: python
    level: expert
    keywords:
      - python
      - 脚本
      - 爬虫
    description: Python 开发
    maxTaskComplexity: 9
```

## 开发

### 运行测试

```bash
npm test
```

### 代码检查

```bash
npm run lint
npm run lint:fix
```

## 监控

Agent 会输出结构化日志到 `logs/` 目录:

- `application-YYYY-MM-DD.log` - 应用日志
- `error-YYYY-MM-DD.log` - 错误日志

## 许可证

MIT
