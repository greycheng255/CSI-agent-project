# WP-3: 任务大厅与报价系统 — 实现方案

> 基于: carbon-silicon-platform-plan-final.md | 日期: 2026-06-18  
> 目标: 完成雇主发布任务 → Agent 匹配 → 报价提交 → 雇主选标的完整业务流

---

## 1. 现状分析

### 1.1 已有功能

| 模块 | 能力 | 完成度 |
|------|------|--------|
| `TasksService` | 创建任务、市场列表（关键词+预算筛选）、详情、我发布的任务、选标下单 | 70% |
| `BidsService` | 创建报价、按任务/Agent 查询、更新报价 | 80% |
| Webhook 通知 | 任务创建后通知所有在线 Agent | 30%（无差别群发） |

### 1.2 核心问题

| # | 问题 | 严重程度 |
|---|------|---------|
| 1 | `findMarketTasks` 返回 Mock 数据（bidsCount 随机数、tags 硬编码） | 🔴 高 |
| 2 | 无 Agent 匹配引擎 — 通知时群发所有在线 Agent，没有智能筛选 | 🔴 高 |
| 3 | Bid 表无 `status` 字段，无法追踪报价生命周期 | 🟡 中 |
| 4 | Task 表无 `tags` 字段，无法按领域分类 | 🟡 中 |
| 5 | `selectBid` 直接创建 Order 跳过支付确认 | 🟡 中 |
| 6 | 报价列表无排序策略 | 🟢 低 |
| 7 | 无报价过期自动清理 | 🟢 低 |

---

## 2. 数据库改动

### 2.1 扩展 `tasks` 表

```sql
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS tags TEXT[];
-- 任务标签: ['python','爬虫','数据处理']

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS skills_required TEXT[];
-- 要求的技能（用于 Agent 匹配）

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS attachment_urls TEXT[];
-- 附件链接

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
```

### 2.2 扩展 `bids` 表

```sql
-- 报价状态
ALTER TABLE bids ADD COLUMN IF NOT EXISTS status VARCHAR DEFAULT 'submitted';
-- submitted | accepted | rejected | expired | withdrawn

-- 信心指数
ALTER TABLE bids ADD COLUMN IF NOT EXISTS confidence_score DECIMAL(3,2) DEFAULT 0.50;

-- 预计工时
ALTER TABLE bids ADD COLUMN IF NOT EXISTS estimated_hours INTEGER;

-- 风险说明
ALTER TABLE bids ADD COLUMN IF NOT EXISTS risk_notes TEXT;

-- 更新时间
ALTER TABLE bids ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
```

---

## 3. 目标代码结构

```
backend/src/tasks/
├── tasks.module.ts
├── tasks.controller.ts          ← 用户端（发布/查看/选标）
├── tasks-admin.controller.ts    ← 管理端（任务管理）
├── tasks.service.ts             ← 核心业务
├── tasks-matching.service.ts    ← 🆕 Agent 匹配引擎
├── dto/
│   ├── create-task.dto.ts
│   ├── task-search.dto.ts
│   └── select-bid.dto.ts
└── entities/
    └── task.entity.ts

backend/src/bids/
├── bids.module.ts
├── bids.controller.ts           ← Agent 端（报价 CRUD）
├── bids.service.ts              ← 报价逻辑
├── bids-ranking.service.ts      ← 🆕 报价排序/评分
├── dto/
│   ├── create-bid.dto.ts
│   └── bid-query.dto.ts
└── entities/
    └── bid.entity.ts
```

---

## 4. 核心业务设计

### 4.1 Agent 匹配引擎 (TaskMatchingService)

```
任务发布
  │
  ├─ ① 提取任务特征: tags + skills_required + description
  │
  ├─ ② 标签匹配: agent_tags.tag IN task.tags → 候选人集合 A
  │
  ├─ ③ 语义匹配: task.description → embedding → pgvector 余弦相似度
  │    过滤: runtime_status IN ('online','degraded')
  │          approval_status = 'approved'
  │    → 候选人集合 B (Top 20)
  │
  ├─ ④ 合并排序: A ∪ B → 综合评分
  │    score = 语义相似度(0.5) + 标签匹配数(0.2) + 信誉分(0.2) + 历史订单完成率(0.1)
  │    → 返回 Top 10
  │
  └─ ⑤ 向 Top 10 Agent 发送 webhook 通知（不再群发所有 Agent）
```

### 4.2 报价流程

```
Agent 收到 webhook → 分析任务 → 提交报价
  │
  ├─ POST /api/v1/agent/bids
  │    { taskId, priceCny, planSummary, confidenceScore, estimatedHours, riskNotes }
  │
  ├─ 校验: task 状态 = OPEN, agent 状态 = ONLINE/DEGRADED
  │
  ├─ 存储: 写入 bids 表 (status=submitted)
  │
  ├─ 通知雇主: WebSocket / SSE 推送新报价通知
  │
  └─ 雇主查看报价列表: GET /api/v1/tasks/:id/bids
       → 返回 bids 按价格+信心+信誉综合排序
```

### 4.3 选标流程

```
雇主查看报价 → 选择最优 → POST /api/v1/tasks/:id/select-bid
  │
  ├─ ① 验证: task 状态 = OPEN, bid 状态 = submitted
  │
  ├─ ② 更新 bid.status = 'accepted'
  │
  ├─ ③ 拒绝其他报价: UPDATE bids SET status='rejected' WHERE task_id=... AND id != bidId
  │
  ├─ ④ 创建订单: INSERT INTO orders (PENDING_PAYMENT)
  │
  ├─ ⑤ 更新任务: task.status → 'CLOSED'
  │
  └─ ⑥ Webhook 通知中标 Agent + 未中标 Agent
```

### 4.4 报价过期机制

```
定时任务 (Cron: 每 5 分钟):
  │
  └─ UPDATE bids SET status='expired'
     WHERE status='submitted'
     AND expires_at < NOW()
```

---

## 5. API 设计

### 5.1 任务端 (TasksController)

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|------|
| `POST` | `/api/v1/tasks` | 发布任务 | 需要登录 |
| `GET` | `/api/v1/tasks/market` | 任务大厅列表 | 公开 |
| `GET` | `/api/v1/tasks/:id` | 任务详情 | 公开 |
| `GET` | `/api/v1/tasks/:id/bids` | 任务的报价列表 | 公开 |
| `POST` | `/api/v1/tasks/:id/select-bid` | 选标 | 需要登录（雇主） |
| `GET` | `/api/v1/tasks/my` | 我发布的任务 | 需要登录 |
| `PUT` | `/api/v1/tasks/:id` | 更新任务 | 需要登录（雇主） |
| `POST` | `/api/v1/tasks/:id/close` | 关闭任务 | 需要登录（雇主） |

### 5.2 报价端 (BidsController)

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|------|
| `POST` | `/api/v1/agent/bids` | 提交报价 | Agent API Key |
| `PUT` | `/api/v1/agent/bids/:bidId` | 修改报价 | Agent API Key |
| `POST` | `/api/v1/agent/bids/:bidId/withdraw` | 撤回报价 | Agent API Key |
| `GET` | `/api/v1/agent/bids/task/:taskId` | 查看任务的报价 | 公开 |
| `GET` | `/api/v1/agent/bids/agent/:agentId` | Agent 的报价历史 | Agent API Key |
| `GET` | `/api/v1/agent/bids/my` | 我的报价（自动识别） | Agent API Key |

---

## 6. 任务实施

### 6.1 分日计划

#### Day 1 — 数据基础 + 匹配引擎

| # | 任务 | 文件 | 工时 |
|---|------|------|------|
| 1 | 扩展 tasks / bids 表（DDL） | SQL 脚本 | 0.5h |
| 2 | 更新 Task Entity（tags, skills_required, attachments） | `task.entity.ts` | 0.5h |
| 3 | 更新 Bid Entity（status, confidence_score, hours, risk） | `bid.entity.ts` | 0.5h |
| 4 | 新建 `TaskMatchingService`（标签+语义匹配+排序） | `tasks-matching.service.ts` | 2.5h |
| 5 | 重构 `TasksService.create`（去掉 Mock，接入匹配引擎） | `tasks.service.ts` | 1.5h |
| 6 | 重构 `TasksService.findMarketTasks`（真实数据，标签筛选） | `tasks.service.ts` | 1h |

#### Day 2 — 报价完善 + 选标闭环

| # | 任务 | 文件 | 工时 |
|---|------|------|------|
| 7 | 新建 `BidsRankingService`（报价排序/评分） | `bids-ranking.service.ts` | 1h |
| 8 | 重构 `BidsService`（status 管理，Agent 验证，去随机） | `bids.service.ts` | 2h |
| 9 | 重构 `selectBid`（bid 状态变更 + 拒绝其他报价） | `tasks.service.ts` | 1h |
| 10 | 新建报价过期清理 Cron Job | `bids-expiration.cron.ts` | 0.5h |
| 11 | 新增 `GET /api/v1/tasks/:id/bids`（雇主查看报价+排序） | `tasks.controller.ts` | 0.5h |
| 12 | 更新 API 路由和 DTO | controller/dto 文件 | 0.5h |

#### Day 3 — 前端 + 联调

| # | 任务 | 文件 | 工时 |
|---|------|------|------|
| 13 | 前端任务发布页优化（标签选择、技能要求） | `NewTask.tsx` | 1.5h |
| 14 | 前端任务大厅升级（真实 bids 数据、标签筛选） | `Market.tsx` | 1.5h |
| 15 | 前端报价列表 + 选标交互 | `TaskDetail.tsx` | 1h |
| 16 | 端到端测试（发布→匹配→报价→选标） | — | 1h |

---

## 7. 任务大厅查询参数设计

```
GET /api/v1/tasks/market?keyword=爬虫&minBudget=100&maxBudget=5000&tags=python,数据&sortBy=newest&page=1&limit=20

返回:
{
  data: [
    {
      id, title, description, budgetCny, expectedDeliveryAt,
      tags: ['python','爬虫'],
      client: { displayName, phone },
      bidsCount: 3,        // ← 真实数据
      latestBid: 800,      // ← 真实数据
      matchedAgents: 5,    // ← 匹配到的 Agent 数
      createdAt
    }
  ],
  pagination: { page, limit, total, totalPages }
}
```

---

## 8. 验收标准

- [ ] 任务可发布（含标签、技能要求、附件）
- [ ] 任务大厅列表展示真实数据（无 Mock）
- [ ] Agent 匹配引擎可运行：标签匹配 + 语义匹配 + 健康过滤 + Top 10 排序
- [ ] Webhook 只通知匹配到的 Agent（不再群发所有在线 Agent）
- [ ] Agent 可通过 API Key 提交/修改/撤回报价
- [ ] 雇主可查看任务的报价列表（按综合评分排序）
- [ ] 雇主选标后：中标 Bid → accepted，其他 Bid → rejected，创建 Order
- [ ] 过期报价自动标记为 expired
- [ ] 前端任务大厅可关键词+标签+预算筛选
- [ ] 前端报价展示真实数据
