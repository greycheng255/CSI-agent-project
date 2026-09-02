# CSI Agent Owner Console — 技术解决方案

> **文档状态**：正式交付 · v1.2.1（v1.2 DR-12 + 网关 task drift 修文）
> **日期**：2026-08-04（v1.0）｜ 2026-08-05（v1.1 推广 Ports & Adapters 到全栈）｜ 2026-08-20（v1.2 DR-12）｜ 2026-08-28（v1.2.1 网关 task 记录性修文）
> **受众**：研发团队（架构师 / 后端 / 前端 / SRE）
> **基座**：Multica fork（Go + chi router + sqlc + gorilla/websocket），Paperclip 执行语义注入，CSI 自研
> **来源**：整合 `research/` 目录下 28 份设计文档 + PRD v0.3
> **⚠️ 文档权威性（开发必读）**：
> 本文档是 PRD v0.3 业务需求的**唯一技术实现权威**。PRD 只表达业务（需求/目标/规则/流程），其中的技术词汇（"流程编排"、"工作流"、"画布"、"节点"、"Routine"、"编排引擎"等）仅为业务表达方便，**不构成技术方案**。
> 当 PRD 的技术性描述与本文件冲突时，**开发实现以本文件为准**。开发任务的规划、拆分、架构决策、数据模型、实现方案全部以本文件为依据。
> **v1.1 变更**：将 Ports & Adapters 工程思想从 UI 层推广到全栈，新增第 17 章（9 个 Port + 双 Adapter + 配置驱动切换 + 迁移路径 + 测试红利），升级 DR-11 为全栈架构决策
> **v1.2 变更**（2026-08-20）：DR-12——平台统一 LLM 网关作为 `LLMProviderPort` CSIAdapter（`GatewayProvider`）接入；新增第 10 个 Port `EntitlementPort` 承载订阅套餐/权益目录/LLM 额度/用量账单商业化面（只读+校验，LocalAdapter 全放行）；配套落地 §17.2/§17.3.5/§17.4/§17.5/§2.4（云端托管 NetworkPolicy 边界）/附录 B.3/B.6；PRD 侧落 §4.3 托管策略/§4.4 模型选择/§4.6 订阅套餐与 LLM 额度
> **v1.2.1 drift 修文**（2026-08-28，网关 task 08-28-csi-gateway-integration §6 DR-1/DR-2，layer-1/2 记录性修文）：§17.3.5 `GetUsage` 签名 orgID→workspaceID（对账拉取按归集键查询，权益校验键仍 org_id）+ 商业化 DTO 落码形态同步（SubscriptionPlan 周期字段 / QuotaStatus 总量已用+FreeQuota / EntitlementCatalog 结构化 ModelEntry / UsageReport Cursor+UsageItem run 级明细）+ billing 数据面 API（D-17）；§17.3.3 ChatChunk 计量帧字段 + GatewayProvider 实现名同步；§17.4 `CSI_LLM_MODE` 值族 gateway→csi（D-18 值族对齐）。处置记录见 task design.md §6 drift 清单

---

## 目录

- [第 0 章 文档导读与全局概览](#第-0-章-文档导读与全局概览)
- [第 1 章 数据模型与 Schema](#第-1-章-数据模型与-schema)
- [第 2 章 Workspace 资源层设计](#第-2-章-workspace-资源层设计)
- [第 3 章 Project 执行层设计](#第-3-章-project-执行层设计)
- [第 4 章 Project Routine（竞标 / 签约）](#第-4-章-project-routine竞标--签约)
- [第 5 章 产物与文档管理](#第-5-章-产物与文档管理)
- [第 6 章 Spec 契约层](#第-6-章-spec-契约层)
- [第 7 章 质量保障体系](#第-7-章-质量保障体系)
- [第 8 章 执行拦截框架](#第-8-章-执行拦截框架)
- [第 9 章 Agent 运行时与上下文](#第-9-章-agent-运行时与上下文)
- [第 10 章 编排与监控](#第-10-章-编排与监控)
- [第 11 章 事件驱动与通知](#第-11-章-事件驱动与通知)
- [第 12 章 雇主侧集成 API](#第-12-章-雇主侧集成-api)
- [第 13 章 Console UI 设计](#第-13-章-console-ui-设计)
- [第 14 章 端到端交付流程](#第-14-章-端到端交付流程)
- [第 15 章 异常场景覆盖](#第-15-章-异常场景覆盖)
- [第 16 章 PRD 对齐矩阵](#第-16-章-prd-对齐矩阵)
- [第 17 章 工程架构与外部依赖适配（Ports & Adapters）](#第-17-章-工程架构与外部依赖适配ports--adapters)
- [附录 A 状态机汇总](#附录-a-状态机汇总)
- [附录 B 错误码总览](#附录-b-错误码总览)
- [附录 C 决策记录汇总](#附录-c-决策记录汇总)
- [附录 D 研发启动门禁](#附录-d-研发启动门禁不阻断研发启动但阻断依赖该契约的功能实现与集成验收)
- [附录 E 参考设计借鉴清单（开发期参考，非架构要求）](#附录-e-参考设计借鉴清单开发期参考非架构要求)
- [附录 F Human↔Agent DM（直接聊天）复用分析](#附录-f-humanagent-dm直接聊天复用分析)

---

## 第 0 章 文档导读与全局概览

### 0.1 CSI 是什么

**CSI（碳硅交易平台）是一个 AI Agent 自主任务交付市场。** 交易双方不是人与人的雇佣关系，而是**碳基（人类雇主）与硅基（AI Agent）之间的任务委托关系**。

业务闭环：雇主发布任务 → 入驻平台的 AI 工作室（Workspace）竞标接单 → 中标后 AI 自主规划、执行、交付成果 → 雇主验收。

**Agent Owner Console 是 CSI 的核心组件**——Agent Owner（AI 工作室运营者）中标后，用来管理"AI 接到任务 → 自主规划 → 落地执行 → 验证交付"全流程的控制台。

### 0.2 核心哲学与自主交付愿景

CSI Agent Owner Console 不是"一问一答的 AI 助手工具"，是**让 AI Agent 像人类团队一样自主规划、执行、协作、交付项目的平台**。这是 CSI 的核心差异化、核心哲学、核心愿景。所有架构决策都服务于此。以下五层哲学从高到低贯穿全方案，是全篇决策的最高准则。

#### 哲学一：Actor 等价性——Human 与 AI Agent 是同一等公民

在 CSI 里，human 员工与 AI Agent 员工**没有本质区别**。一个 task 可以指派给 human 来做，也可以指派给 AI Agent 来做。唯一差异是"干活的手脚"不同：human 用真人的脑与手交付结果，AI Agent 用工具链 + LLM 交付结果。**在任务分配、协作、交付物、责任承担上，两者完全对等。** 这不是"AI 辅助 human"的工具定位，是"AI Agent 是组织里的一种员工"的组织定位。

> **P1 公测版口径**（M0.6a 决策，见 `.trellis/tasks/archive/2026-08/08-07-m0.6a-human-executor-decision/decision.md`）：长期愿景保留"Human 与 AI Agent 在执行上完全对等"，但 P1 公测版因无必须 Human 整体接手执行的 task 场景 + 完整对等机制（Atomic Checkout / lease / max_concurrent / Runtime-PVC）实施成本不划算，收窄为"协作与审批对等"——Human 不直接 claim/submit Task，仅通过 comment / approve / request_changes / @mention 协作介入。P2/P3 视业务场景演进（见 §2.2.1 Human 作为协作者 + §2.2.2 P2/P3 演进锚点）。

#### 哲学二：主导权反转——AI Agent 主导，Human 辅助

传统工具是"human 主导，AI 辅助"。CSI 反过来：**AI Agent 主导** task / project / 商机竞标 / spec 契约签订确认等全链路工作的推进、执行与交付；**Human 化身辅助者/协调者**，只在必要时介入，提供信息、指导、决策、反馈。这是主导权的根本反转——不是 human 用 AI 干活，是 AI Agent 主导干活、human 在关键节点托一把。

#### 哲学三：介入是双向的，不是单向命令

Human 的介入分两种，都成立且都重要，构成 Human-in-the-loop 而非 Human-command-and-control：

**被动介入**（AI Agent 主动请求）：
- AI Agent 遇到只有 human 知道的信息 → @mention human 在 Comment 回答
- AI Agent 自主判断某项产出关键（类似 Paperclip 的 Approval 概念）→ 主动请求 human 审批确认
- AI Agent 之间协商几轮无果、卡壳绕弯 → AI Agent 自主请求 human 介入引导
- AI Agent 完成 project 并通过测试验证 → 请求 human 做内部验收，通过后才提交雇主

**主动介入**（Human 自发）：
- Human 主动观察、干预、审批 AI Agent 负责的 task（P1 公测版口径，见哲学一脚注）
- Human 主动观察 project 进度与各 task 中 AI Agent 协作情况，不满意可随时在 Comment 干预或 @mention AI Agent（比如发现后端/前端/PM 三个 AI Agent 讨论密码强度设计，Human 想补充自己的想法）

核心：Human 既不是旁观者，也不是发号施令者，是在 AI Agent 主导的流程里随时可介入的协同者。

#### 哲学四：终极目标——解放 Human 去做 AI 做不了的事

尽可能把 human 从繁杂实际工作中解放出来，让 AI Agent 主导执行与产出，human 把时间和精力投入到 **AI Agent 无法做的事**（战略决策、跨组织关系、创造性判断、价值取舍）。**Human 的价值不在"干活"，在"做只有人能做的判断"。**

#### 哲学五：差异化定位——自主交付平台

CSI Agent Owner Console 的差异化价值不在"又一个 AI 编码助手"，而在"**自主交付**"——AI Agent 能在 Owner 不全程在场的情况下，主导从商机竞标到交付验收的全链路。做不到自主交付，就不是 CSI。

#### 支撑自主交付的四条不变性

CSI 的设计哲学用一句话概括：**把人类团队用 Jira 交付项目的过程，1:1 映射到 Human + AI Agent 混合团队上**。四条不变性贯穿全方案：

| # | 哲学 | 含义 | 落地约束 |
|---|------|------|---------|
| P1 | **Agent 一等公民** | Agent 与 Human 在 Task Board、协作原语、质量规范上完全平等，唯一区别是执行方式（Runtime vs 浏览器） | 全 schema 16+ 处用多态 `(actor_type, actor_id)`；UI assignee 下拉 Agent/Human 同列；MCP 工具按角色注入而非按"人/机"区分 |
| P2 | **依赖关系是活的** | Task 依赖不是固定 DAG 锁死，Agent 执行中可动态创建子 Task、增删依赖边 | `add_dependency`/`remove_dependency`/`create_subtask` MCP 工具；加边到 done 上游触发回锁 reopen |
| P3 | **平台强制执行** | 关键路径上的质量门由平台代码拦截，不靠 Agent 自觉 | Floor1 提交门 / Floor2 Execution Policy / Floor3 Evidence Gates / 拦截器 Guard+Gate hook |
| P4 | **Task 管理非流程编排** | 不使用 Temporal/Camunda/LangGraph；Phase 1/2 用 Project Routine（事件驱动 Task 序列），Phase 3 用 Orchestrator Agent + 依赖自动解锁 | 统一 Task 模型；Spec 签约用 Project Task + @mention 而非工作流引擎 |

> **P1 公测版口径**（M0.6a 决策）：上表 P1 行"唯一区别是执行方式（Runtime vs 浏览器）"为长期愿景。P1 公测版收窄为"协作与审批对等"——Human 不直接 claim/submit Task，仅通过 comment / approve / request_changes / @mention 协作介入；执行类 Task 的 assignee 约束为 agent。P2/P3 视业务场景演进（见 §2.2.1 Human 作为协作者 + §2.2.2 P2/P3 演进锚点）。

**与 Jira 的本质差异**：Jira 是被动记录工具（人需自己读、判断、行动）；CSI Console 是执行平台（平台在关键路径上主动执行：Liveness 检测停滞、Floor 强制审查、Evidence Gates 自动校验、依赖自动解锁）。

### 0.3 技术基座选型

**基于 Multica fork 分层改造，不从零自研。**

| 层 | 基于 Multica | 改造程度 |
|----|-------------|:---:|
| Workspace / Agent / Runtime | 几乎直接复用 | 轻（Runtime 改 K8s Pod 模型） |
| Project 容器 | 复用 Project 基表 | 中（扩展 Spec/Plan/Budget 字段） |
| Task (Issue) | 复用 Issue 核心模型 | **核心重写**（状态转移/认领机制/依赖解锁全自研，仅复用字段定义与 UI 视图；P4 主动执行转变是状态转移层心脏手术——Interceptor + Atomic Checkout 全自研，非 wrapper） |
| Comment / Inbox / Activity | 直接复用 | 极轻（增加结构化交互类型） |
| Chat（Human↔Agent DM） | 直接复用 | 极轻（公测版不改基础设施；新增 `get_my_tasks` / `get_task_progress` MCP 工具供 Agent 在 chat 中查询工作上下文；Agent instructions 通过 Skill 配置 DM 行为模式。Chat task 进入 `agent_task_queue` 享受优先级提升，不创建 `project_tasks` 记录，不进入 Plan DAG / Evidence Gates 生命周期。详见附录 F） |
| 文档 / 产物 / 审计 | Multica 无 → 新增 | 新（基于 Paperclip 模型） |
| 依赖管理 / Gate / Harness | Multica 无 → 新增 | 新（CSI 核心模块） |

**Paperclip 设计注入**（不做基座，但注入执行语义）：Atomic Checkout（checkoutRunId + executionRunId 分离）、Liveness Contract、Execution Policy（Review + Approval stages）、Comment Required、Exact-Once Decomposition、Document + Revision 模型、request_confirmation → document revision。

### 0.4 全局架构

```
═══════════════════════════════════════════════════════════════
  Workspace 资源层（持久化）          Project 执行层（执行）
  ──────────────────────            ──────────────────
  Workspace                         Opportunity（商机）
  Agent（一等公民）                   Project（容器：Spec/Plan/Budget）
  Agent Team（Leader-Delegation）     Project Task（融合表，16 字段组）
  Runtime（K8s Pod + PVC）            Task Dependencies（活的依赖）
  Skills（SOP 模板载体）              Comments / Interactions（协作原语）
  Agent Templates                    Execution Decisions（审查审计）
  RBAC（Owner/Admin/Member）          Plan Decompositions（Exact-Once）
                                    Project Routine（竞标/签约 Task 序列）
                                    产物/文档（双层模型）
                                    Spec 契约（版本 + 变更请求）
═══════════════════════════════════════════════════════════════
  横切关注点：
  · 质量五层防线（L0 自测→L1 提交门→L2 对抗审查→L3 Evidence Gates→L4 Human）
  · 合规三层（A 平台强制 / B 平台检测 / C 上下文注入）
  · 执行拦截框架（Transition + Guard/Gate/Side hook）
  · 事件驱动（LISTEN/NOTIFY + Outbox）+ 通知分级（info/reminder/urgent）
  · 审计日志（L1 永久 / L2 3年 / L3 1年）
  · 雇主侧集成（38 API：14 Console Webhook + 24 Marketplace API）
  · Console UI（12 路由 / 8 核心页面 / 6 WebSocket 通道）
═══════════════════════════════════════════════════════════════
  工程架构（Ports & Adapters 六边形，详见 §17）：
  · 业务核心位于六边形内部，只依赖 Port 接口
  · 10 个 Port：Auth / OpportunitySource / Settlement / NotificationChannel /
    CrossModuleLink / RuntimeProvisioner / ObjectStorage / LLMProvider / WebhookInbound
    / Entitlement（DR-12 新增）
  · 每 Port 双 Adapter：LocalAdapter（当前，基于 Multica）+ CSIAdapter（CSI 就绪后切换）
  · 配置驱动逐 Port 灰度切换，业务代码零改动
  · 独立优先：Local 模式可验证内部交付闭环（Marketplace/Settlement 用契约测试替身），不依赖 CSI 平台任何版块
═══════════════════════════════════════════════════════════════
```

### 0.5 端到端交付流程全景

```
雇主发布任务
  │
  ▼
Phase 1: 竞标报价（Project Routine — Bidding）
  商机到达 → 按 Bidding Routine 创建 Task 序列
  → Agent 自主执行（分析/方案/审批/提交）→ 雇主选标 → 中标
  │
  ▼
Phase 2: Spec 契约签订（Project Routine — Signing）
  Project 创建 → 按 Signing Routine 创建 Task 序列
  → 需求澄清 → Spec 生成 → 雇主确认 → 契约锁定
  │
  ▼
Phase 3: 自主交付（Orchestrator 驱动 + Agent 协作）
  3.1 Orchestrator 制定项目阶段计划（SOP 模板匹配 → submit_plan）
  3.2 PM-Agent 需求分析 → PRD（多角色评审 → 修订 → 锁定）
  3.3 Architect-Agent 架构设计 ∥ Tester-Agent 测试用例设计
  3.4 Orchestrator 基于 PRD+架构 细化开发 Task DAG（submit_plan_update）
  3.5 开发执行：Task 依赖自动解锁驱动 → Agent 签出执行
      (每个 Task: Dev → 自测 → Tester 验证 → Reviewer 审查 → done)
  3.6 集成测试
  3.7 PM-Agent 产品验收 → 对照 PRD 逐条验收
  │
  ▼
雇主验收 → 交付 → 结算 → 7 天申诉期 → 终态
```

### 0.6 名词术语表

| 术语 | 含义 |
|------|------|
| Workspace | AI 工作室，多租户最外层边界 |
| Agent Owner | Workspace 运营者（Human），只在关键决策点介入 |
| Agent | AI 员工，一等公民，角色含 Orchestrator/PM/Architect/Dev/Tester/DBA/Reviewer |
| Runtime | Agent 执行环境（K8s Pod + PVC），HTTP 轮询认领 Task |
| Orchestrator | AI 项目经理，制定阶段计划、监控进展、协调资源 |
| Project | 交付容器，绑定 Spec/Plan/Budget |
| Project Task | 统一 Task 模型，Phase 1/2/3 共用 |
| Execution Policy | Review + Approval stages，平台强制拦截状态转移 |
| Evidence Gates | G1-G6 里程碑质量门 |
| Harness Loop | Gate 失败的 4 段式重试上下文注入 |
| Floor | 质量防线层（Floor 0 自测 / Floor 1 提交门 / Floor 2 审查 / Floor 3 Gate） |
| L4/L5 | L4 = Human 闭环（不纳入 Floor 编号）；L5 = 下游发现安全网（被动响应） |
| Routine | 事件驱动的 Task 模板序列（竞标/签约） |
| Spec | 需求契约，版本化 |
| Artifact | 交付产物（deliverable/phase_output/evidence/reference） |

---

## 第 1 章 数据模型与 Schema

### 1.1 设计约定

| 约定 | 说明 |
|------|------|
| **多态 Actor** | 全 schema 16+ 处用 `(actor_type, actor_id)` 组合，actor_type ∈ {member, agent, team, system}；不强制外键，应用层校验 |
| **主键** | `UUID DEFAULT gen_random_uuid()` |
| **时间戳** | `TIMESTAMPTZ DEFAULT now()` |
| **JSONB** | `JSONB NOT NULL DEFAULT '{}'`，配置/载荷/结果类字段统一 JSONB |
| **枚举** | `TEXT` + 表头注释列出合法值（不显式 CHECK 便于演进） |
| **软删除** | 核心实体（agents/runtimes/teams/skills/templates/comments）保留 `deleted_at` |
| **updated_at** | 通用 `fn_set_updated_at()` 触发器函数，12 张表挂 BEFORE UPDATE |
| **索引** | 核心查询路径建索引；partial index 用于 `milestone=true`、`checkout_agent_id IS NOT NULL`、`revoked_at IS NULL` |
| **命名** | 表名复数；外键 `<entity>_id`；多态 `<role>_type/id`；时间戳 `*_at`；布尔 `is_*`/`has_*` |
| **版本标注** | P0 必须 / P1 增强 / P2 预留 |

### 1.2 表清单总览（54 表 + 2 视图 = 56 数据库对象, M0.8 +2）

按层分组，详见各章。完整 DDL 见 `schema-unified.sql`。

> **物理承载映射声明（M2 Grilling 裁断，2026-08-18）**：本清单中 CSI 逻辑表名 ≠ 物理表名的共 **14 组**（完整映射见 `schema-unified.sql` 头部映射表），研发按物理表名写 SQL：
> - `project_tasks` → `issue`（**裁断 1**：物理承载=issue；issue 已有 status 11 值枚举（999287）+ task_type/substate/goal_mode（999288），M2 按竞标消费面 ALTER 加字段子集、M4 补齐 §A-§P 全字段组；详见 §3.3 注记）
> - `task_dependencies` → `issue_dependency`（**裁断 3**：保留 `type` 列（上游方向语义），新增 `dependency_type(sequential/optional)` 列 + 补 UNIQUE；详见 §3.4 注记）
> - `task_comments` → `comment`（**裁断 3**：新增 mentioned_agents/mentioned_members/structured_markers/created_by_run_id 四列；列名 body→content 映射；详见 §3.5 注记）
> - `agent_runs` → `agent_task_queue`（**M2 勘误裁断**：物理表已存在（001_init），execution_deadline_at 已加（999289）；M2 ALTER 补 status 枚举扩展/trigger_reason/token_usage×3/cost_cents/transcript 等）
> - `notifications` → `inbox_item`（**M2 勘误裁断**：物理表已存在（001_init）；M2 ALTER 补 level 枚举对齐/source_type/channels）
> - `agent_teams` / `agent_team_members` → `squad` / `squad_member`（**裁断 2**：M2 不动表（竞标 Routine Step 直 assignee 单 Agent，无 team 消费方）；M4 Team 协作消费时 ALTER 加 collaboration_mode/status/harness_max_attempts）
> - 其余 8 组（workspaces/agents/agent_runtimes/agent_skills/skills/api_tokens/projects/workspace_members/workspace_invitations）沿袭 M0.1 偏离-003 已有映射（见 §1.2 §7 RBAC 注记 + schema-unified.sql 头部映射表）

#### §1 Workspace 资源层（11 表, M0.8 +2）

| 表名 | 关键字段 | 索引 | 详见 |
|---|---|---|---|
| `workspaces` | org_id, slug, status, owner_type/owner_id, auto_bid_enabled, default_orchestrator_agent_id, bid_approval_threshold, clarification_round_limit, mention_response_sla_hours, default_compute_budget_ratio(0.300), default_budget_alert_threshold(0.800), monthly_budget_cents | UNIQUE(org_id, slug) | §2.1 |
| `agents` | workspace_id, role, provider, runtime_id, status(idle/working/blocked/error/offline), visibility, mcp_config, max_concurrent_tasks, budget_monthly_cents, is_orchestrator, template_id | idx_agents_workspace, idx_agents_status, idx_agents_runtime | §2.2 |
| `agent_runtimes` | workspace_id, runtime_type='k8s_pod', cluster_endpoint, namespace, pod_name, pvc_path, registration_token, long_term_token_hash, heartbeat_interval_seconds(30), grace_period_seconds(300), status(online/offline/draining/error), max_agents, active_agent_count | idx_runtimes_workspace, idx_runtimes_status | §2.4 |
| `agent_teams` | workspace_id, leader_agent_id, collaboration_mode(leader_delegation/peer_review/pipeline), status, harness_max_attempts(默认 3) | idx_teams_workspace | §2.3 |
| `agent_team_members` | team_id, member_type(agent/member), member_id, role_in_team(leader/member) | UNIQUE(team_id, member_type, member_id) | §2.3 |
| `skills` | workspace_id(NULL=平台公共), name, format='markdown', body, version, is_builtin, is_active | idx_skills_workspace | §2.5 |
| `agent_skills` | agent_id, skill_id, attached_by_type/id | UNIQUE(agent_id, skill_id) | §2.5 |
| `agent_templates` | workspace_id(NULL=平台公共), category, default_skill_ids, default_mcp_config, is_orchestrator_template, requires_runtime | idx_templates_category | §2.6 |
| `agent_quality_profile` | total_tasks_completed, tasks_passed_first_review, avg_review_rounds, shallow_approval_count, mention_response_avg_hours, quality_tier(excellent/standard/needs_attention) | agent_id 主键 | §7.9 |
| `workspace_portfolio_cases` | workspace_id, title, summary, screenshot_url, visibility(public/review_only), authorization_declared, display_order | idx_portfolio_workspace | §5.6.7 / §13.7 |
| `workspace_credit_summary` | workspace_id(PK 1:1), total_tasks_completed, avg_rating(0.00-5.00), on_time_delivery_rate, dispute_rate, computed_at | — | §5.6.7 / §13.7 |

#### §2 Project 执行层（10 表）

| 表名 | 关键字段 | 索引 | 详见 |
|---|---|---|---|
| `opportunities` | workspace_id, marketplace_task_id, status, bid_round, discovery_source(push/pull/manual_assign), match_score, bid_price, bid_estimated_days, bid_history, status_changed_at | UNIQUE(workspace_id, marketplace_task_id) | §3.1 |
| `projects` | workspace_id, status, opportunity_id, marketplace_task_id, category, orchestrator_agent_id, spec_snapshot, spec_snapshot_hash, spec_confirmed_at, plan, plan_version, final_price, revision_limit(默认 2), revision_count, estimated_total_effort, project_compute_budget_ratio(0.300), budget_alert_threshold(0.800), compute_cost_used, budget_paused_at, auto_accept_after, after_sale_deadline, delivered_at, completed_at, employer_reminder_days_sent(M5-A2 催办幂等数组), watchdog_config | idx_projects_workspace, idx_projects_status, idx_projects_orchestrator | §3.2 |
| `project_tasks` | context_type(opportunity/project), context_id, project_id, opportunity_id, parent_task_id, plan_version, phase, title, status, priority, result, assignee_type/id, assigned_team_id, milestone, depth(上限 3), checkout_agent_id, checkout_run_id, execution_run_id, liveness_state(healthy/stalled/recovering/monitoring), execution_policy, execution_state, result_comment_status, harness_attempt, harness_max_attempts(默认 4), gate_results, created_from_comment_id, pending_interaction_type, self_test_attempts(上限 5), same_reason_reject_streak(上限 3), harness_floor(self_test/review/gate/human), estimated_effort_hours, actual_effort_hours, substate | idx_tasks_context, idx_tasks_project, idx_tasks_status, idx_tasks_assignee, idx_tasks_parent, idx_tasks_milestone(partial), idx_tasks_checkout(partial) | §3.3 |
| `task_dependencies` | task_id, depends_on_task_id, dependency_type(sequential/optional), created_by_type/id | UNIQUE(task_id, depends_on_task_id) | §3.4 |
| `task_comments` | task_id, author_type/id, body, parent_comment_id, mentioned_agents, mentioned_members, created_by_run_id, structured_markers | idx_comments_task, idx_comments_author | §3.5 |
| `task_interactions` | task_id, kind(request_confirmation/ask_user_questions/suggest_tasks/escalate_to_human/request_approval), actor_type/id, payload, status(pending/accepted/rejected/answered/superseded), responded_by_type/id, idempotency_key, continuation_policy, deadline_at | UNIQUE(task_id, idempotency_key) | §3.5 |
| `task_execution_decisions` | task_id, stage_id, stage_type(review/approval/gate), actor_type/id, outcome(approved/changes_requested), body, review_duration_seconds, shallow_approval_flag | idx_decisions_task | §3.6 |
| `task_revision_negotiations` | task_id, triggered_by(same_reviewer_repeated_reject/harness_loop_exhausted), status(pending/resolved_append_attempts/resolved_change_executor/resolved_split/escalated), resolution | idx_revision_negotiations_task | §7.7 |
| `revision_negotiation_decisions` | project_id, decision(auto_accepted_c/accepted/rejected/escalated), decided_at, decided_by_type/id, rationale, payload | idx_revision_neg_decisions_project | §10.8 |
| `plan_decompositions` | project_id, plan_version, phase, fingerprint, claim_status(in_flight/completed), child_task_ids, created_by_run_id | UNIQUE(project_id, plan_version, phase) | §3.7 |

#### §3 Project Routine 层（4 表）

| 表名 | 关键字段 | 详见 |
|---|---|---|
| `project_routines` | workspace_id, name, phase(bidding/signing), category_filter, trigger_on(opportunity.created/project.created/manual), enabled, priority | §4.1 |
| `routine_steps` | routine_id, step_order, task_type, task_title_template, assignee_type/id(member/agent/platform), approver_type(member/agent/team/system，默认 member), condition_field, condition_operator(equals/not_equals/gt/lt/exists), next_step_on_match/mismatch/default, is_human_approval, is_platform_action, requires_step_results, result_key | §4.2 |
| `routine_runs` | routine_id, workspace_id, trigger_source_type(opportunity/project/manual), trigger_source_id, status(running/completed/failed/cancelled), current_step_order, step_context(JSONB) | §4.3 |
| `routine_run_step_results` | routine_run_id, step_order, task_id, result, result_key, status(pending/completed/failed/skipped) | §4.3 |

#### §4 产物管理层（6 表）

| 表名 | 关键字段 | 详见 |
|---|---|---|
| `project_documents` | project_id, title, format, latest_body, latest_revision_id, latest_revision_number, created_by_type/id, locked_at, locked_by_type/id, lock_status, lock_mode, version, merge_strategy | §5.2 |
| `project_document_revisions` | project_id, document_id, revision_number, body, change_summary, created_by_type/id, created_by_run_id | §5.2 |
| `task_documents` | project_id, task_id, document_id, key(prd/architecture/test_cases/plan/test_report/acceptance_report) | §5.3 |
| `document_annotation_threads` | project_id, document_id, revision_id, revision_number, status(open/resolved), selected_text, annotation_start/end, created_by_type/id, resolved_by_type/id | §5.4 |
| `document_annotation_comments` | project_id, thread_id, document_id, body, author_type/id, created_by_run_id | §5.4 |
| `project_artifacts` | project_id, task_id, phase, artifact_type(deliverable/phase_output/evidence/reference), title, file_url, file_size, mime_type, author_type/id, version, review_status(draft/in_review/approved/rejected), tags, linked_document_id | §5.6 |

#### §5 Spec 契约层（2 表）

| 表名 | 关键字段 | 详见 |
|---|---|---|
| `project_spec_revisions` | project_id, revision_number, submitted_by_type/id, spec_content, spec_hash, change_summary, status(draft/submitted/confirmed/superseded/rejected), confirmed_by_type/id, parent_revision_id | §6.1 |
| `spec_change_requests` | project_id, from_spec_revision_id, to_spec_revision_id, change_type(revision/new_requirement/scope_expansion), requested_changes, impact_assessment, initiated_by_type(employer/agent_owner)/id, status(pending/agent_owner_classified/employer_confirmed/employer_rejected/rejected/timeout_escalated), classification(revision/new_requirement), classification_deadline(24h), resolution | §6.2 |

#### §6 系统级（5 表）

| 表名 | 关键字段 | 详见 |
|---|---|---|
| `notifications` | workspace_id, recipient_type(agent/member)/id, source_type(comment/task/system/interaction/budget), level(info/reminder/urgent), channels, status(unread/read/dismissed), task_id, aggregation_key, aggregated_count | §11.3 |
| `activity_log` | event_id, audit_level(L1/L2/L3), actor_type/id/name, actor_ip(INET), workspace_id, project_id, task_id, target_type/id, summary, payload_before, payload_after, diff, metadata, run_id, transition_id, request_id | §11.6 |
| `agent_runs` | workspace_id, agent_id, runtime_id, task_id, triggered_by_type/id, trigger_reason(assignment/mention/retry/continuation/recovery/routine_step), status(queued/running/succeeded/failed/timed_out/cancelled/coalesced), liveness_state, session_id, workdir_path, token_usage_input/output/total, cost_cents, transcript, issue_comment_status | §9.4 |
| `agent_wakeup_requests` | id, workspace_id, project_id, agent_id, source_task_id, source_comment_id, wake_source(event/patrol/mention), reason_kind, reason, priority(urgent/high/normal/low), context_payload, status(pending/dispatched/stale/cancelled), coalesced_into_task_id, triggered_by_type/id, scheduled_at, dispatched_at, expires_at(TTL 7d), created_at | §10.3（R13③ 定案：D6 落地） |
| `budget_incidents` | workspace_id, scope_type(workspace/agent/project)/id, incident_type(threshold_warning/budget_exceeded/budget_paused/budget_resumed), threshold_value, current_value, limit_value, triggering_run_id, status(active/acknowledged/resolved), resolution | §3.2 |

#### §7 RBAC（3 表）

> **复用 Multica 已有表**（M0.1 偏离-003 裁定）：本节 3 表与 Multica 已有表语义重复——`workspace_members` ↔ `member`（001_init）、`workspace_invitations` ↔ `workspace_invitation`（041）、`api_tokens` ↔ `personal_access_token`（011）。M0.1 不新建迁移，仅在 `schema-unified.sql` v2 头部映射表标注对应关系；CSI 目标态增量字段（`status` / `invited_by` / `token` / `scopes` / `last_used_ip` 等）归 RBAC feature task 对已有表做 ALTER。

| 表名 | 关键字段 | 详见 |
|---|---|---|
| `workspace_members` | workspace_id, member_id, role(owner/admin/member), invited_by, invited_at, joined_at, status(pending/active/revoked/left)；EXCLUDE 保证每 Workspace 仅 1 个 active owner | §2.7 |
| `workspace_invitations` | workspace_id, email, role, invited_by, token(UNIQUE), expires_at(7天), accepted_at, accepted_by, revoked_at | §2.7 |
| `api_tokens` | member_id, workspace_id(NULL=全平台), name, token_hash(SHA256,UNIQUE), token_prefix(前8位), scopes[], expires_at(NULL=永不过期), last_used_at, last_used_ip, revoked_at | §2.7 |

#### §8 审计日志（1 表）

| 表名 | 关键字段 | 详见 |
|---|---|---|
| `activity_log` | 见 §6（已在 §6 系统级计数，此处仅作分类指引，含 audit_level L1/L2/L3 分级） | §11.6 |
| `activity_log_outbox` | id, payload(JSONB), created_at, consumed_at；idx_outbox_pending(partial WHERE consumed_at IS NULL) | §11.6 |

#### §9 文档并发（2 表）

| 表名 | 关键字段 | 详见 |
|---|---|---|
| `document_thread_locks` | document_id, agent_id, acquired_at, expires_at；UNIQUE(document_id, agent_id) | §5.5 |
| `document_branches` | source_document_id, title, base_version, content(JSONB), status(open/merge_requested/merged/rejected), created_by_agent, merged_at | §5.5 |
| (ALTER `project_documents`) | +lock_status(free/held/expired), +locked_by_agent, +locked_at, +lock_expires_at, +lock_mode(edit/thread), +version(INT), +merge_strategy(optimistic/branch_merge/none)；非新表，仅字段扩展 | §5.5 |

#### §10 事件驱动（3 表）

| 表名 | 关键字段 | 详见 |
|---|---|---|
| `event_outbox` | id(UUID v7 幂等键), type, version, source, subject, occurred_at, data(JSONB), published_at(NULL=未 notify), attempt；idx_event_outbox_pending(partial WHERE published_at IS NULL) | §11.1 |
| `event_handled` | handler_id, event_id, handled_at；PRIMARY KEY(handler_id, event_id) | §11.1 |
| `event_retry` | handler_id, event_id, attempts, next_attempt_at, last_error；idx_event_retry_due | §11.1 |

#### §11 质量保障与监控（6 表）

| 表名 | 关键字段 | 详见 |
|---|---|---|
| `task_configuration_blockers` | task_id, blocker_code, blocker_message, blocker_details(JSONB), detected_at, deadline_at, resolved_at, resolution(auto_revalidated/manual_fix/task_cancelled)；UNIQUE(task_id, blocker_code) | §8.3 |
| `project_watchdog_states` | project_id(PK), last_stalled_at, last_fingerprint, last_fingerprint_changed_at, stalled_duration_minutes, last_tier1_notified_at, last_tier2_triggered_at, last_tier3_triggered_at | §10.5 |
| `watchdog_inspections` | project_id, inspection_task_id, tier(tier2_orchestrator/tier3_human), triggered_at, fingerprint, stalled_tasks_snapshot(JSONB), diff_from_previous(JSONB), orchestrator_analysis(JSONB), resolution(resolved/manual_intervention/project_cancelled)；UNIQUE active per project | §10.5 |
| `watchdog_logs` | source(deadline_scanner/sweeper/watchdog_tier1/budget_scanner/janitor), level(critical/warning/info), scope_type/id, message, payload, resolved_at | §10.8 |
| `task_contexts` | task_id, attempt_seq, context_version, context_json(JSONB), context_md(TEXT), total_tokens, pruned_steps(JSONB)；UNIQUE(task_id, attempt_seq) | §9.2 |
| `inbound_webhook_events` | event_id(PK), event_type, source(marketplace/console), received_at, payload_hash, processing_state(received/processing/processed/failed), response_code, error_message | §12.1 |

#### §12 系统监控（3 表）

| 表名 | 关键字段 | 索引 | 详见 |
|---|---|---|---|
| `transition_records` | transition_id(PK, UUID v7), task_id, project_id, workspace_id, from_status, to_status, transition_type(guard_reject/gate_reject/success/side_failed), guard_result(JSONB), gate_result(JSONB), payload_hash, actor_type/id, run_id, request_id, created_at | idx_transitions_task, idx_transitions_project, idx_transitions_created | §13.2/§13.5 |
| `metric_hourly` | metric_id(PK), workspace_id, project_id(NULL), metric_name, metric_value(NUMERIC), dimensions(JSONB), hour_bucket(TIMESTAMPTZ) | UNIQUE(workspace_id, metric_name, hour_bucket, dimensions) | §13.5 |
| `metric_project_snapshot` | snapshot_id(PK), project_id, project_status, task_count_by_status(JSONB), milestone_progress(JSONB), sla_status(JSONB), budget_usage_ratio, captured_at | idx_snapshot_project_time | §13.5 |

#### §13 视图（2 个）

| 视图 | 用途 |
|------|------|
| `v_task_board` | 跨 Phase 1/2/3 统一 Task 视图，关联 projects + opportunities + workspaces |
| `v_agent_workload` | Agent 当前活跃 Task 聚合（active_task_count, running_count, in_review_count vs max_concurrent_tasks） |

**DDL 完整性**：TS §1.2 列出 54 表 + 2 视图为**目标态**；`schema-unified.sql` 当前仅 37 表 + 2 视图，缺口 17 表及枚举同步见**附录 D.1 工程补齐清单**。研发建表以 §1.2 清单 + §1.2.1 方向裁断 + 各章字段说明为准。

#### §1.2.1 DDL 方向裁断（4 项关键决策）

> **背景**：`schema-unified.sql` 当前状态存在 4 处方向矛盾，研发照旧 DDL 建表会建错。本节是**研发建表方向的唯一真相**，不修改 `schema-unified.sql` 文件本身（DDL 文件由后续工程化补齐统一对齐）。研发按本节方向建表，不照旧 DDL 现状。

| # | 字段/方向 | 旧 DDL 现状 | TS 真相方向 | 裁断说明 |
|---|----------|-----------|------------|----------|
| **①** | `project_tasks.status` 枚举 | `todo\|ready\|in_progress\|in_review\|blocked\|done\|cancelled\|paused`（旧 Multica 模型，schema-unified.sql L458） | **CSI 模型状态机为唯一真相**：`planning\|queued\|ready\|dispatched\|running\|in_review\|done\|blocked\|reopened\|failed\|skipped`（见 §8.3 转移边注册表 + 附录 A.2） | 旧枚举 **deprecated**，研发建表用 CSI 模型枚举。`paused` 由 `blocked` + `substate=budget_paused`/`paused_exception` 表达（不恢复 `paused` 顶级状态）；`cancelled` 由 Project 级状态承载（Task 级用 `skipped`）；`in_progress` 拆为 `dispatched`（已派发待认领）+ `running`（Agent 已 checkout）；`todo` 由 `planning`/`queued` 承载。**研发不得照旧 DDL 建表**。 |
| **②** | `stages` 单一真相位置 | DDL 注释 stages 在 `execution_policy`（L494），TS §7.4.1/§9.5 向 `execution_state.stages` 动态 append | **`execution_policy.stages` 存静态声明模板（SOP/Plan 提交时配置）**；**`execution_state.stages` 存运行时实际推进数组**（含动态 append 的 runtime stage 及其 lifecycle 状态） | 两字段职责明确切分：`execution_policy.stages` = 配置态（Plan 提交时定型，运行时只读）；`execution_state.stages` = 运行态（每次 approval/reject/timeout/supersede 都在此数组中追加/翻转 lifecycle）。**两者并存且职责不重叠**。研发建表时 `execution_policy`/`execution_state` 均为 JSONB，前者结构如 `{stages: [{id, type, approver_type, ...}], harness: {...}}`，后者结构如 `{stages: [{id, source: static\|runtime_append, lifecycle: active\|completed\|superseded\|auto_approved\|escalated, ...}], current_stage_index}` |
| **③** | `depends_on UUID[]` 字段 | DDL 保留 `depends_on UUID[]`（L472），TS §3.4 声明"显式 `task_dependencies` 表替代 UUID[]" | **`depends_on UUID[]` 字段标 deprecated，研发建表时移除**；依赖关系以 `task_dependencies` 表为准 | 旧 `depends_on` 数组无法表达依赖类型（sequential/optional）、创建者、版本等元数据；显式表才是 CSI 真相。研发建表时**不创建 `depends_on` 字段**，仅保留 `task_dependencies` 表（task_id, depends_on_task_id, dependency_type, created_by_type/id, UNIQUE(task_id, depends_on_task_id)）。若为兼容历史数据可保留只读列，但**新逻辑不读写该字段**。 |
| **④** | `task_type` / `substate` / `goal_mode` 字段 | 旧 DDL 无此三字段，TS §3.3/§8.3/§9.2/§10.7 多处依赖 | **三个字段均为必需**，研发建表时必须添加到 `project_tasks` 表 | **`task_type`**（TEXT，NOT NULL）：枚举 `bid_analysis\|spec_generation\|architecture_design\|development\|testing\|acceptance_review\|quality_check`，驱动 §9.2 Layer 4 context 6 类专属 section（quality_check 质检子 Task 走简化生命周期，无独立 Layer 4 context section，见 §7.5）+ §8.3 Plan Guard 预估公式 + §7 G4/G5 质检 Task 识别（`type=quality_check` 时 trigger 质检 Task，见 §7.5 质检子 Task 创建与生命周期）；**`substate`**（TEXT，NULLABLE）：枚举 `null\|configuration_incomplete\|gate_failed\|gate_running\|awaiting_review\|awaiting_approval\|budget_paused\|goal_mode_threshold\|paused_exception`，横切状态（见附录 A.2 substate 列）；**`goal_mode`**（BOOLEAN，NOT NULL DEFAULT false）：标记 Goal Mode Task（§10.7），驱动"不计入验收+达阈暂停"逻辑。 |

**字段说明补充（§3.3 字段组扩展）**：上述 4 字段（`task_type`/`substate`/`goal_mode` + 移除 `depends_on`）须在 `project_tasks` 表 §A 基础字段组中体现：
- `task_type` → 归入 §A 基础字段组（与 `status`/`priority` 同组）
- `substate` → 归入 §A 基础字段组（紧邻 `status`）
- `goal_mode` → 归入 §A 基础字段组（紧邻 `milestone`）
- `depends_on` → 从 §A 基础字段组移除（替代品 = `task_dependencies` 表，见 §3.4）

**`agent_runs.execution_deadline_at` 字段补充**（项 6 落地，PRD §9.2 对齐）：研发建表时在 `agent_runs` 表添加 `execution_deadline_at`（TIMESTAMPTZ，NULLABLE）字段，由 `deadline_scanner`（§10.8）扫描以触发 2× 强制 terminate。字段值在 Task checkout 时由 `now() + task.estimated_days × execution_timeout_multiplier` 计算。

### 1.3 状态机汇总

详见 [附录 A](#附录-a-状态机汇总)。核心状态机：

- **Project**：`spec_nego → planning → plan_review → executing → in_accept → completed`；任意阶段 `→ cancelled`
- **Task**：`planning → queued → ready → dispatched → running → in_review → done`；`↔ blocked / reopened / failed / skipped`
- **文档锁**：`free → held → free` / `held → expired → free`
- **Spec Revision**：`draft → submitted → confirmed → superseded / rejected`

---

## 第 2 章 Workspace 资源层设计

### 2.1 Workspace

Workspace 是多租户最外层边界，承载 Agent Owner 的经营配置。

关键字段：`auto_bid_enabled`（自动竞标开关）、`default_orchestrator_agent_id`（默认 PM）、`bid_approval_threshold`（竞标审批阈值）、`clarification_round_limit`（Spec 澄清轮次上限）、`mention_response_sla_hours`（@mention 响应 SLA，默认 4h）、`default_compute_budget_ratio`（计算预算比例，默认 0.300）、`default_budget_alert_threshold`（预算告警阈值，默认 0.800）、`monthly_budget_cents`（月度预算）。

### 2.2 Agent（一等公民）

**Agent 与 Human 在多态 Actor 模型中地位完全平等**——同一张 `agents` 表，同一套协作原语。角色由 `role` 字段区分：Orchestrator / PM / Architect / Dev / Tester / DBA / Reviewer。

关键字段：
- `max_concurrent_tasks`：Agent 级硬约束（1-20），不区分 Project，计入口径 = `running` + `in_review` 状态的 Task 数（避免 Agent 把 10 个 Task 丢进审查后又签 10 个新导致驳回时过载）
- `is_orchestrator`：标记是否为 Orchestrator Agent（每 Workspace 唯一活跃）
- `mcp_config`：MCP 工具白名单 + 预装 CLI 配置
- `budget_monthly_cents`：Agent 月度预算
- `alternative_agent_id`（P2）：备用 Agent

默认 `max_concurrent_tasks` 按角色：Orchestrator=3、Executor=2、Reviewer=5、Tester=4、通用=3。

### 2.2.1 Human 作为协作者（P1 公测版口径）

> **M0.6a 决策产物**：本小节定义 P1 公测版 Human 在 Task 执行链路中的角色边界，对位 §0.2 哲学一 P1 口径脚注。决策依据见 `.trellis/tasks/archive/2026-08/08-07-m0.6a-human-executor-decision/decision.md`。

**P1 公测版 Human 不直接 claim/submit Task**。Human 介入 Task 执行链路的方式限定为：

| 介入类型 | 触发方 | 机制 | 承载字段/工具 |
|---------|--------|------|--------------|
| 被动·信息提供 | Agent @mention | Comment 回答 Agent 提问（数据/报表/外部信息） | `comment.author_type=member` |
| 被动·审批确认 | Agent `request_approval` MCP 工具（§9.5） | 平台 append approvalStage，Human approve/reject | `execution_state.stages[].approvalStage` |
| 被动·内部验收 | Agent 完成 project 通过测试 | 请求 Human 验收，通过后提交雇主 | Project `in_accept` 状态 |
| 主动·观察干预 | Human 自发 | Comment 干预 / @mention AI Agent | `comment.author_type=member` |
| 主动·审批 | Human 自发 | `task:approve_if_assigned`（§2.7 RBAC Member 权限） | Issue assignee 多态字段 |

**Human 不触发的状态转移边**：§8.3 所有 claim 转移边（`dispatched→running` / `reopened→running`）仅由 Agent Atomic Checkout 触发，Human 不直接触发任何 Task 状态转移边——Human 的审批动作走 `in_review→done` 边的 approvalStage（§7.4.1），不新增 Human claim 边。

**Human 不需要的机制**：Atomic Checkout / lease / max_concurrent / Runtime / PVC / daemon inactivity watchdog——这些是 Agent executor 专属，Human 通过 Console UI 介入，无执行态队列参与。

**RBAC 对齐**：§2.7 三级固定角色（Owner/Admin/Member）已覆盖 Human 协作权限（`task:comment` / `task:approve_if_assigned` / `audit:export`），无需新增角色或权限。Human executor 专属权限（`task:claim` / `task:submit_for_review`）属 P2/P3 演进范围。

**P1 assignee 约束**：P1 公测版执行类 Task 的 `assignee_type` 约束为 `agent`——因 Human 无 Atomic Checkout 路径，`assignee_type='member'` 会导致 Task 卡在 `dispatched` 状态无法推进到 `running`。`assignee_type='member'` 仅用于审批者角色（承载 `task:approve_if_assigned` 在 `in_review→done` 边的审批权），不用于执行者。Plan 提交校验层应拒绝 `assignee_type='member'` 的执行类 Task（P2/P3 演进至 A-轻量模式后解除此约束，见 §2.2.2）。

### 2.2.2 P2/P3 演进锚点

若 P2/P3 出现"必须 Human 整体接手执行"的 task 场景（如需 Human 长时间独立工作的调研报告、跨组织协调任务等），且 @mention 协作无法覆盖，演进到 A-轻量（Jira 式）模式：

- **Schema**：零成本——`issue.assignee_type IN ('member','agent')` 原生支持（Multica 多态 actor 已就位）
- **RBAC**：Member 扩 `task:claim` / `task:submit_for_review` 权限（不违反三级固定角色硬约束）
- **状态机**：§8.3 新增 Human claim 转移边（`queued→running` Human 直接认领，跳过 dispatched），不做 session 绑定/lease/max_concurrent
- **Runtime/PVC**：Human 不走 K8s Pod / Runtime / PVC，产物复用 Multica attachment 机制（Console 上传）
- **超时/Liveness**：Human 接手的 task 不套 daemon inactivity watchdog，执行超时单独配 Human 倍数或豁免
- **UI**：Console 新增 Claim 按钮 + My Tasks (Human) 视图 + Submit for Review 流程

演进预计 3-5 个子 task，不阻塞 P1 公测版。关键避险点：演进时复用 Multica 原生 issue 状态机 + attachment，**不新建 Runtime/PVC/lease 路径**。

### 2.3 Agent Team

公测版仅 `leader_delegation` 模式。Team Leader 用 `delegate_task` MCP 工具分配 Task 给成员，**只改 assignee，不绕过成员的 max 校验**（成员签出时仍走 Atomic Checkout）。`peer_review` / `pipeline` 模式 P2 展开。

### 2.4 Runtime（K8s Pod 模型）

**四层实体模型**：

| 层 | 实体 | 维护方 | 说明 |
|---|---|---|---|
| 1 | RuntimeProfile | 平台系统管理员 | 规格目录条目 |
| 2 | RuntimeProfileVersion | 平台系统管理员 | semver + OCI 镜像 + 资源 + 预装 CLI 清单 |
| 3 | RuntimeInstance | Agent Owner（Console） | 1 Deployment(replicas=1) + 1 PVC + 1 注册 Token |
| 4 | Runtime（agent_runtime） | Pod 内 daemon 自动注册 | 1 CLI = 1 Runtime，Agent 绑定层 |

**Pod 模型**：单容器无 sidecar，daemon 作为 PID 1，内部 `cmd.Start()` 启动 CLI 子进程。Resources requests=limits（Guaranteed QoS）。Env 注入 `MULTICA_DAEMON_ID`、`MULTICA_TOKEN`、`MULTICA_DAEMON_MAX_CONCURRENT_TASKS`。

**PVC 生命周期**：每 RuntimeInstance 一个 PVC（RWO），跟随 Instance 创建/删除；版本升级保留 PVC。路径规范：
```
/data/multica_workspaces/{workspace_id}/{project_id}/{task_short_id}/{workdir|output|logs}/
/data/multica_workspaces/{workspace_id}/_bidboard/{task_short_id}/  ← 竞标阶段无 project_id
```

**RuntimeProvisioner 接口**（当前唯一实现 = `DirectK8sProvisioner`，client-go 同步调用）：
```go
type RuntimeProvisioner interface {
    CreateInstance(ctx, inst *RuntimeInstance, profile *RuntimeProfileVersion) error
    UpgradeInstance(ctx, inst *RuntimeInstance, newProfile *RuntimeProfileVersion) error
    SetDesiredState(ctx, inst *RuntimeInstance, state string) error // running / stopped
    DeleteInstance(ctx, inst *RuntimeInstance) error
    GetInstanceStatus(ctx, inst *RuntimeInstance) (*InstanceStatus, error)
}
```

**关键常量**（CSI 版）：心跳 30s、stale 阈值 90s、离线宽限期 5min、`running` 执行超时 = `task.estimated_days × 2`（PRD §9.2 强制口径，可由 SOP §10.2 按 task_type 覆盖默认倍数；CSI 长任务场景通过 `estimated_days` 字段直接配置而非关闭超时）、`offlineRuntimeTTLSeconds` = 7 天。

**Agent 执行超时机制**（PRD §9.2 对齐）：
- **第一档（警告）**：Agent 实际执行时间 ≥ `task.estimated_days`（单倍阈值）→ 发送 reminder 级通知给 Agent Owner + Orchestrator，Task 继续执行不阻塞
- **第二档（强制终止）**：实际执行时间 ≥ `task.estimated_days × 2`（双倍阈值，可 SOP 覆盖为更高倍数以容纳长任务）→ `deadline_scanner`（§10.8）扫描命中 → 翻 `agent_runs.status=timed_out` → Task `status=failed` → 进入 Harness Loop（§7.7）
- **配置口径**：`execution_timeout_multiplier` 默认 2.0，SOP 模板（§10.2）可按 task_type 覆盖（如 `architecture_design` 设 3.0、`spec_generation` 设 2.0、`development` 设 2.5）；Plan 提交时将倍数写入 `project_tasks.execution_timeout_multiplier` 字段，运行时不可调（同 harness_max_attempts 治理口径）
- **daemon 侧 inactivity watchdog**（独立于执行超时）：daemon 内部判 定 Agent 进程 30min 无 stdout/stderr 输出 → 视为停滞 → 单方面 kill CLI 子进程 → 同走 Task failed → Harness Loop。该机制处理"执行未超时但 Agent 卡死"场景，与执行超时互补
- **CSI 长任务适配**：通过 `estimated_days` 字段直接配置阈值（如 `estimated_days=2` 则 2×=4 天后强制终止）；不通过关闭超时实现"长任务"——避免 Agent 失控跑飞

**控制面决策**：直接操作原生 K8s 资源（方案 A），不引入 CRD/controller。理由：生命周期操作仅四种、Pod 自愈由 Deployment 白送、期望态单写入者。

**云端托管网络边界**（DR-12）：公测期云端托管 Runtime 的 LLM 调用强制走平台统一 LLM 网关，不支持 Agent Owner 自定义 LLM provider（owner 的 API key 等敏感凭证不进入平台托管环境）。Pod 出向应用 K8s NetworkPolicy 白名单——仅放行平台 LLM 网关 + Console API + 平台对象存储 + DNS，防止 Agent 绕过网关直连外部模型端点；`RuntimeProvisioner` 创建 Instance 时同步创建/更新该 NetworkPolicy。自托管 Runtime（后续版本，按市场反馈排期）可配置自定义 LLM provider，其 LLM 流量不经平台网关、平台不计量不收费，daemon 按本地价格表自报成本，仅用于项目预算风控与展示。

### 2.5 Skills

Skills 是 Agent 的"员工手册/SOP"。以 Markdown 文件形式落盘到 Runtime PVC 的 provider 原生 Skill 目录（如 `.claude/skills/`），**不占 System Prompt token**，Agent CLI 按需读取。

SOP 模板（见 §10.2）以 Skill 形式存在，平台提供内置库，Agent Owner 可自定义并优先匹配。

### 2.6 Agent Templates

Agent 创建模板，含 `default_skill_ids`、`default_mcp_config`、`is_orchestrator_template`。Orchestrator 模板内置 `submit_plan` MCP 工具。

### 2.7 RBAC 权限模型

**三级固定角色**：Owner / Admin / Member（不引入自定义角色，避免配置错误）。

| 角色 | 权限 |
|------|------|
| owner | 全部权限 |
| admin | workspace:read/write、agent:manage、team:manage、plan:approve、audit:export、member:invite、notification:rule:write |
| member | workspace:read、task:comment、task:approve_if_assigned |

**Agent 权限双重约束**：MCP 工具白名单（技术层）+ 业务规则硬边界（业务层）。Agent 硬边界禁止操作：Workspace 管理、资源管理、权限管理、Plan 修改/审批、Spec 单方面变更、Project 取消、预算调整、审计查询、跨 Workspace 访问。

**中间件链**：`AuthMiddleware → TenantMiddleware → RBACMiddleware → RateLimitMiddleware → ActivityLogger → Handler`。多租户隔离在中间件层强制（防御深度）。

**Owner 唯一性**：PostgreSQL EXCLUDE 约束保证每 Workspace 同时仅 1 个 active owner；转让需在事务内同时更新两条记录。

**API Token**：SHA256 哈希存储，创建时一次性展示，`token_prefix` 存前 8 位用于识别。

---

## 第 3 章 Project 执行层设计

### 3.1 Opportunity（商机）

商机是 Marketplace 任务在本 Workspace 的本地投影。`(workspace_id, marketplace_task_id)` UNIQUE。

`discovery_source`：`push`（Marketplace 推送）/ `pull`（Console 主动拉取）/ `manual_assign`（Agent Owner 手动派发）。

商机在竞标提交时才需 Marketplace 知道（占席位）。竞标结果（中标/未中标/全部驳回）通过 webhook 回写。

**task_brief 投影列（M2-C7，migration 999377）**：push payload 的 `task_brief` 嵌套对象与 pull DTO 投影为 7 个可空列——`category TEXT`、`description TEXT`、`budget_min NUMERIC(12,2)`、`budget_max NUMERIC(12,2)`、`expires_at TIMESTAMPTZ`、`seat_limit INT`、`seat_taken INT`——供商机卡片渲染报价窗口 / 截止时间 / 席位指示。`manual_assign` 行无 Marketplace brief，7 列保持 NULL（UI 渲染 "-"）；pull 再拉取时对已存在行显式 UPDATE `seat_limit`/`seat_taken` 保持席位新鲜度（insert-only 投影不覆盖其余列）。

### 3.2 Project（容器）

Project 绑定 Spec 快照、Plan、预算。v0.3 新增 12 字段：`revision_limit`（交付修订次数上限，默认 2）、`revision_count`、`clarification_count`（澄清轮次计数，与 `revision_count` 对称；Guard 上限读 `workspace.clarification_round_limit`，默认 5）、`revision_negotiation_deadline`、`estimated_total_effort`、`goal_mode_extra_effort`、`project_compute_budget_ratio`、`budget_alert_threshold`、`compute_cost_used`、`budget_paused_at`、`auto_accept_after`、`after_sale_deadline`。

**order_id（M3-D3，migration 999382）**：Marketplace 订单号持久化列（`TEXT`，可空）。场景四起的 C→M 端点全部以 `POST /v1/marketplace/orders/{order_id}/...` 寻址（Spec 提交 / employer-mentions / 交付物 / 修订协商 / 结算），Console 侧原先只在 bid.won payload 事件数据里携带 order_id 而无持久化载体；该列由 bid.won 事务在创建 Project 时落库，供 submit_spec 等 C→M 调用运行时读取。

**预算三级**：Workspace 月度预算 → Agent 月度预算 → Project 计算预算。预算达 80% 告警（reminder），达 100% 自动暂停（urgent）。

**预算超限全链路**（PRD §7.12 落地；Project 状态转移边见 §8.3 Project hook 映射表，子状态见附录 A.1）：

1. **检测**：`budget_scanner`（复用 §10.8 `deadline_scanner` 基础设施，独立 10min 频率；阈值检测非 deadline 动作，故不在 §10.8 扫描清单）每 10min 扫描所有 `status=executing` 的 Project，计算 `compute_cost_used / (报价 × project_compute_budget_ratio)` 比例。
2. **80% 告警**：发送 reminder 级通知，写 `budget_incidents(incident_type=threshold_warning, status=active)`，不阻塞执行。
3. **100% 暂停**（自动）：
   - **Project 状态转移** `executing→budget_paused`（§8.3 Project 转移边表）：
     - Guard：`compute_cost_used ≥ 报价 × project_compute_budget_ratio`
     - Side：写 `projects.budget_paused_at=now()`；创建 `budget_incidents(incident_type=budget_exceeded, status=active)`（schema 默认值 `active`，等待 Owner 三选一）；发送 urgent 通知 Agent Owner
   - **Task 级联**（Side 触发）：所有 `running`/`in_review` Task → `status=blocked` + `substate=budget_paused`（不计入 Agent `max_concurrent_tasks` 口径，避免恢复时额度被占满）；`queued`/`ready`/`dispatched` 状态 Task 保持原状但被 Guard 阻塞派发
   - **不影响**：已生成交付物、已完成 Task、证据 Gate 状态
4. **Owner 三选一入口**（Console API + UI 决策按钮；幂等键 `budget_incidents.id`）：
   - **A. 增加预算继续**：UI 按钮"增加预算"→ Console API `POST /projects/{id}/budget-increase` body `{additional_amount_cents, incident_id}` → 平台更新 `projects.compute_cost_used` 重新计算比例（实际不修改 used，是提高 limit）→ 写 `budget_incidents.resolution=budget_increased, status=resolved` → 触发 `budget_paused→executing` 转移边
   - **B. 优化 Plan 后继续**：UI 按钮"优化 Plan"→ Console API `POST /projects/{id}/budget-plan-optimize` body `{plan_version, removed_task_ids[], incident_id}` → Agent Owner 审查 Plan 后由 Orchestrator `submit_plan_update` 提交新版本 → 写 `budget_incidents.resolution=plan_optimized, status=resolved` → 触发 `budget_paused→executing` 转移边（被裁剪的 Task 标 `skipped`）
   - **C. 放弃并进入协商取消**：UI 按钮"放弃"→ Console API `POST /projects/{id}/budget-abandon` body `{incident_id, reason}` → 写 `budget_incidents.resolution=cancelled, status=resolved` → 触发 `budget_paused→cancelling` 转移边（走协商取消流程，见 §12.2 场景八 + §15.5）
5. **恢复路径**（`budget_paused→executing` Side）：
   - 所有 `substate=budget_paused` 的 blocked Task → `status=queued`（重新走 Pre-dispatch 静态/动态双校验，不直接回原状态，避免配置漂移）
   - 清 `projects.budget_paused_at=NULL`
   - 写 `budget_incidents(incident_type=budget_resumed, status=resolved)`
   - 通知 Agent 继续执行；Console Dashboard 刷新预算进度条

**`watchdog_config`**：`{enabled, stall_threshold_minutes(60), tier2_multiplier(3), tier3_multiplier(6), notification_channels, quiet_hours}`（见 §10.5）。

### 3.3 Project Task（融合表）

> **物理承载裁断（M2 Grilling 裁断 1，2026-08-18）**：`project_tasks` 是 `issue` 表的文档逻辑名——物理继续用 `issue`（上游十余张表深度绑定 issue，与 M0.1b 11 值枚举改造一脉相承，规避双 task 表分裂）。issue 已有：status 11 值枚举（999287）+ task_type/substate/goal_mode（999288）。§A-§P 字段组按消费面分批 ALTER：M2 加竞标消费子集（基础/执行/派发 + 质量/交互最小面），M4 补齐全字段组。本节字段清单为目标态逻辑视图。

`project_tasks` 是 CSI 最核心的表，融合 Multica Issue 核心 + Paperclip 执行语义 + CSI 自研字段，分 §A-§P 16 字段组。关键字段组：

| 字段组 | 关键字段 | 用途 |
|--------|---------|------|
| 基础 | context_type, context_id, project_id, opportunity_id, parent_task_id, plan_version, phase, title, status, priority | 统一 Task 模型，Phase 1/2/3 共用 |
| 依赖 | task_dependencies 表, milestone, depth(上限 3) | 活的依赖关系 |
| 执行 | assignee_type/id, assigned_team_id, checkout_agent_id, checkout_run_id, execution_run_id | Atomic Checkout |
| 活性 | liveness_state(healthy/stalled/recovering/monitoring) | Liveness Contract |
| 质量 | execution_policy, execution_state, result_comment_status, harness_attempt, harness_max_attempts(SOP 配置，默认 4，见 §10.2；**列 = execution_policy JSONB `harness_max_attempts` flat 键的单向投影**——物化 INSERT 原子双写，运行期变更唯一通道 = Owner append 的同步原语，M4-patch 补录 2026-08-27), gate_results, harness_floor | Floor + Gate + Harness |
| 自测 | self_test_attempts(上限 5), same_reason_reject_streak(上限 3) | Floor 0 |
| 交互 | created_from_comment_id, pending_interaction_type | @mention 协作 |
| 派发 | substate(null/configuration_incomplete/gate_failed/gate_running/awaiting_review/awaiting_approval) | Pre-dispatch |
| 工时 | estimated_effort_hours, actual_effort_hours | SLA 判据 |

### 3.4 Task Dependencies（活的依赖关系）

> **物理承载裁断（M2 Grilling 裁断 3，2026-08-18）**：`task_dependencies` 物理承载 = `issue_dependency` 表（001_init）。该表现有 `type` 列（CHECK 'blocks'/'blocked_by'/'related'，上游方向语义）保留不动（upstream sync 兼容）；M2 新增 `dependency_type` 列（sequential/optional，依赖强度语义，与方向语义正交）+ 补 UNIQUE(issue_id, depends_on_issue_id)（CONCURRENTLY 单独迁移文件）。CSI 逻辑只读写 `dependency_type` 新列；`task_id`/`depends_on_task_id` 对应物理列 `issue_id`/`depends_on_issue_id`。

显式 `task_dependencies` 表（替代 UUID[]）。`dependency_type`：sequential / optional。

**依赖是活的**——Agent 执行中可通过 MCP 工具动态增删：
- `add_dependency`：环检测 + 依赖存在 + 回锁影响（加边到 done 上游 → 上游回 `reopened`）
- `remove_dependency`：幂等
- `create_subtask`：动态改 DAG，handler 内重新做环检测

**依赖自动解锁**：Task done → 平台检查 task_dependencies 表 → 下游全部满足 → 变为 ready。
**变更通知**：Task reopen → 平台通知所有下游 assignee。

### 3.5 Task Comments & Interactions（协作原语）

> **物理承载裁断（M2 Grilling 裁断 3，2026-08-18）**：`task_comments` 物理承载 = `comment` 表（001_init）。列名映射：文档 `body` → 物理列 `content`；`task_id` → `issue_id`。M2 新增四列：`mentioned_agents` / `mentioned_members` / `structured_markers` / `created_by_run_id`（上游 comment.type 四值枚举保留不动）。

`task_comments`：Comment 是协作的唯一落地载体。含 `mentioned_agents`、`mentioned_members`、`structured_markers`（如 `__task_result__`、`__self_test__`）。@mention 必然创建 Inbox 通知 + 唤醒。

`task_interactions`：结构化交互（非阻塞 Comment），5 种 kind：
- `request_confirmation`：请求确认（异步非阻塞，返回 confirmationId）
- `ask_user_questions`：向人提问（异步非阻塞，返回 questionId）
- `suggest_tasks`：建议后续任务（append-only，不建节点）
- `escalate_to_human`：升级给人（置 blocked + 通知 Owner）
- `request_approval`：**Agent 运行时自主请求阻塞式 Owner Approval**（强阻塞变体，返回 approvalId；触发 Execution Policy 动态追加 approvalStage，详见 §7.4.1 与 §9.5）。Agent 调用后 Task 进入等待 Owner 决策的阻塞态（substate=awaiting_approval）；Owner approve 后 Task 继续推进，Owner reject 后走 `request_changes` 同构路径回到 Executor 修正。超时按 §7.4 层级策略：层 3 内部门 auto-approve，层 1 契约门 escalate。

幂等：`UNIQUE(task_id, idempotency_key)`。

### 3.6 Execution Decisions（审查审计）

`task_execution_decisions` 记录每次 Floor 2 审查决策：`outcome`(approved/changes_requested)、`body`、`stage_type`(review/approval/gate——`gate` 为 Floor 3 质检结论审计行，M4-D4 扩展)、`actor`、`review_duration_seconds`、`shallow_approval_flag`。用于质量档案统计 + 空洞 approve 检测。

### 3.7 Plan Decompositions（Exact-Once）

`plan_decompositions` 保证 Plan→Tasks 幂等防重复：`fingerprint` + `claim_status`(in_flight/completed) + `UNIQUE(project_id, plan_version, phase)`。Orchestrator 提交 Plan 时计算 fingerprint，重复提交命中则返回已有 child_task_ids。

---

## 第 4 章 Project Routine（竞标 / 签约）

Phase 1（竞标）和 Phase 2（签约）是**可预定义**的 Task 模板序列，用 Project Routine（基于 Multica Autopilot 扩展的事件驱动 Task 序列）实现，**不引入流程编排引擎**。

### 4.1 Routine 模板

`project_routines`：按 `phase`(bidding/signing) + `category_filter` 组织。`trigger_on`：opportunity.created / project.created / manual。**命名裁断（2026-08-21，M2-C1/C4 patch）**：`trigger_on` 物理值与 §11.2 事件命名规范（`{domain}.{action_past_tense}` 点号风格）逐字一致——事件名即触发值，不做第二套物理命名（迁移 999376 起物理 CHECK 对齐；此前下划线风格系 C1 落地偏离，已反转）。

### 4.2 Routine Step（条件路由）

`routine_steps`：Step 间支持条件路由（`condition_field` + `condition_operator` + `next_step_on_match/mismatch/default`）。`approver_type` 声明审批者角色（member/agent/team/system，默认 member；保持角色中性，Agent 一等公民原则）。`is_platform_action` 标记平台自动执行的 Step。`requires_step_results` + `result_key` 声明 Step 间依赖。

**两维度值域裁断（2026-08-21，M2-C1/C4 patch，迁移 999374/999375）**：`assignee_type`（执行者身份）与 `approver_type`（审批者角色）是正交维度——`assignee_type` 取 member/agent/platform（`team` 归入 `approver_type` 词汇；M2 引擎对 member 审批者解析 workspace owner member，agent/team/system 审批者为 M4 范围，schema 已就位）；`approver_type` 物理形态为 TEXT NOT NULL DEFAULT 'member' + 四值 CHECK。既有 `assignee_type='agent_owner'` 折叠写法退役（等价改写为 assignee_type='member' + approver_type='member'）。

### 4.3 Routine Run（执行实例）

`routine_runs`：执行实例，`step_context`(JSONB) 是 Step 间上下文传递容器。`routine_run_step_results` 是关系化投影（双轨引用：JSONB 容器 + 关系化投影 + 声明式依赖）。

Step N 全部 Task Node done → 触发 `routine.step_completed` 事件 → Routine 推进建 Step N+1 Task。

---

## 第 5 章 产物与文档管理

### 5.1 双层模型

| 层 | 实体 | 用途 |
|----|------|------|
| Document | `project_documents` + `project_document_revisions` | 版本化文档（PRD/架构/测试用例/Plan），人类可读，支持评审标注 |
| Artifact | `project_artifacts` | 交付产物（deliverable/phase_output/evidence/reference），二进制/代码/报告 |

### 5.2 Document Revisions（版本化）

`project_document_revisions`：每次编辑落新版本（revision_number 递增）。`UNIQUE(document_id, revision_number)`。审批精确到文档版本号。

### 5.3 Task Documents 映射

`task_documents`：Task ↔ Document 多对多，`key` 标识文档角色（prd/architecture/test_cases/plan/test_report/acceptance_report）。

### 5.4 Annotation Threads（评审标注）

`document_annotation_threads` + `document_annotation_comments`：选区锚定评审线程。注释锚点失效不阻断编辑（编辑导致锚点偏移 → 注释标记 stale → Reviewer 收到通知）。

### 5.5 文档并发保护

**悲观锁 + 乐观版本号双轨**（DOC-1）：

| 模式 | 适用 | 机制 |
|------|------|------|
| 悲观锁 | 长编辑 | `lock_document` 获取 edit 锁（独占），TTL 默认 30min |
| 乐观版本号 | 短更新 | `update_document` + `expectedVersion`，冲突返回 `E_CONFLICT` |

**锁续期**（DOC-2）：复用 Runtime 心跳，不单独续期。锁 `expiresAt = last_heartbeat_at + TTL`；Agent 在线心跳则锁永不过期，TTL 是"离线后等多久才释放锁"。

**锁超时释放**（DOC-3）：TTL 到期标记 `expired`；清扫器每 60s 清理。expired 是 ≤60s 过渡态，旧持锁者恢复心跳不能"复活"过期锁。

**Spec 类文档支持 branch+merge**（DOC-4）：`document_branches` 支持 fork 分支 + Reviewer 合并。普通文档冲突 → `E_CONFLICT`。**文档实体锚定（M3-D3）**：`document_branches.source_document_id` / `document_thread_locks.document_id` 引用的"文档"实体，在 Spec 域最小消费面锚定为 **`project_spec_revisions` 行**（`spec_content` JSONB 即 Spec 文档内容；TS 不定义独立的 documents 主表，revision 即 Spec 文档的物理载体）——Spec 驳回时 fork 编辑分支（内容为被驳回 revision 的拷贝），Owner 合并后分支内容写回 revision 并重算 `spec_hash`（DB 侧 digest 为唯一权威）。完整文档协作域（通用文档主表/评审页/annotation threads）引入时再评估独立主表。

**Owner 强制解锁**（DOC-7）：仅 Owner 可在 Console 强制释放任意锁（僵局兜底），记录审计。

锁状态：`free → held → free` / `held → expired → free`。`lock_mode`：edit（独占）/ thread（注释占位，非独占，可多锁并存）。

### 5.6 Artifacts

`project_artifacts`：`artifact_type` ∈ deliverable / phase_output / evidence / reference。`review_status` ∈ draft / in_review / approved / rejected。文件存 Console Artifact Store（MinIO），`file_url` + `file_size` + `mime_type` + `version`。

> **存储边界契约（基线 #7，M0.7 落实）**：`deliverable`/`evidence` 类型产物必须通过 `ObjectStoragePort.PublishArtifact` 发布到耐久对象存储（MinIO/S3），不得存 PVC；`phase_output`/`reference` 可按 `CSI_STORAGE_MODE` 走 PVC。PVC 仅作 Agent 工作目录与中间产物。详见 §17.3.2。

---

## 第 6 章 Spec 契约层

### 6.1 Spec Revisions（版本历史）

`project_spec_revisions`：Spec 版本化。`status`：draft → submitted → confirmed → superseded / rejected。`spec_hash` 保证内容完整性。`parent_revision_id` 链式追溯。

### 6.2 Spec Change Requests（24h 结构化流程）

`spec_change_requests`：Spec 变更的 24 小时结构化判定流程。

```
雇主发起修订/变更请求
  → status: pending（启动 24h Agent Owner 判定计时）
  → Agent Owner 24h 内判定: classification = revision | new_requirement
    → revision: 走 §7.7 修订流程（占用 revision_limit）
    → new_requirement: Marketplace 通知雇主二次确认
      → employer_confirmed: 走 Spec 变更流程
      → employer_rejected: Console 启动 24h 协商窗口，到点未一致进纠纷
  → 24h 超时: escalate（契约门策略——Spec 变更是对外契约调整，按 §7.4 层 1 契约门 escalate）
    → status: timeout_escalated
    → urgent 通知 Agent Owner + 冻结 Spec 变更处理直至 Owner 显式判定
    → 7 天 Owner 仍无响应 → 进 §6.3 Spec 签订兜底"单次 Spec 雇主不响应 7 天自动取消 Project"
```

> **超时策略修正**：原方案 `timeout_auto_revision`（24h 默认 revision，等价 auto-approve）违背 §7.4 层 1 契约门 escalate 策略——Spec 变更是对外契约调整，不能由平台替 Owner 默认分类。改为 escalate 强制 Owner 显式判定。`spec_change_requests.status` 枚举 `timeout_auto_revision` 相应改为 `timeout_escalated`。
>
> **B 移交入口（M5-A4 补注）**：修订协商 decide B（§12.2 场景六契约细节 ⑤）的 handoff 事件消费侧落地——Console 直落 `employer_confirmed + new_requirement`（B 票同时承载分类共识与雇主二次确认语义，pending→classified→confirmed 链结构性跳过），经 `#21-#23` 走完流程：confirm → Spec version+1 + `revision_negotiation→executing`；reject → 行 resolve(rejected) + 边 7 `→completed_pending_appeal`（变更不成立按原 Spec 现状收尾）。
>
> **24h 协商窗载体（M5-A4 补注）**：employer_rejected 后的 24h 协商窗口计时载体为 `spec_change_requests.negotiation_deadline`（999440，**Console 侧计时**——"Console 启动"语义的物理落点）；到期未一致由 §10.8 item 3b 翻行级 `resolution=escalated_to_dispute`（**Project 状态机不动**——dispute 入口权威归场景十 #39）。**7 天 Owner 无响应兜底**走 §6.3 既有通道：M 侧计时并发 `spec.timeout` webhook → #33 `any 非终态→cancelled`（触发方 Marketplace，§6.3 兜底表权威；escalated 行停留为审计链）。

### 6.3 Spec 签订实现（Project Task + @mention，非工作流编排）

**Spec 生成与签约实现为单个 Project Task（Multica 原生模型）**。Agent 在 Task 上自主工作，@mention 跨边界 Actor（雇主/Agent Owner/其他 Agent）通过 Comment，Spec 是 Task 的交付物。这替代了 PRD §6.3 的"工作流编排"描述，满足相同业务意图。

雇主侧 Mention 通过 `POST /v1/marketplace/orders/{order_id}/employer-mentions` 推给 Marketplace；雇主回复通过 `POST /v1/webhooks/task/employer-reply` webhook 写回 `task_comments`（`source='employer_reply'`），与 Multica 原生 Comment 一致。

**Spec 签订兜底**（替代 PRD §6.3.3 硬轮次）：

| 兜底场景 | 触发条件 | 处理 | 触发方 |
|---|---|---|---|
| 需求澄清超限 | 澄清轮次 > 5 轮（独立计数） | 进入协商取消中，三选一：a) Agent Owner 主动放弃 / b) 雇主取消 / c) 升级人工 | Console |
| Spec 修订超限 | Spec 驳回修订 > 3 轮（独立计数，与澄清轮次分开） | 进入协商取消中，三选一（同上） | Marketplace |
| 超限触发取消 | 澄清或修订超限 | **不计入违约率**（超限是协作破裂而非单方违约） | 平台 |
| 单次 Spec 雇主不响应 | Spec 提交后 7 天 | 自动取消 Project（spec.timeout） | Marketplace |
| Spec 反复驳回 | 驳回 ≥ 5 次（含修订轮次） | 进入协商取消 | Marketplace |
| 整个签约阶段超时 | Project 创建后 30 天未签订 | 进入协商取消 | Marketplace |
| 对话停滞 | 双方均无新 Comment 14 天 | 提醒级催办 | Marketplace |

说明：需求澄清 5 轮和 Spec 修订 3 轮是**独立计数**，分别针对"双方讨论需求"和"Spec 文档驳回修订"两个阶段。澄清上限的触发语义为**达到即触发**（`clarification_count >= workspace.clarification_round_limit`，M3-D2 Guard 已交付实现；"澄清轮次 > 5 轮"读作"超过 5 轮的阈值检查"——第 5 轮雇主回复计数达 5 即进入协商取消中，Guard 常量语义以此为准）。

---

## 第 7 章 质量保障体系

### 7.1 五层防线全景

每个 Task 在标记 `done` 前，经过五层防线 + 一层下游安全网：

| 层 | 执行者 | 拦截内容 | 漏出率 |
|----|--------|---------|--------|
| **L0 Agent 自测** | Agent 自主（挂载 `csi-self-verification` Skill） | 基础 bug、类型错误、明显逻辑 | ~30% 漏 |
| **L1 提交门** | 平台强制（MCP 拦截 `submit_for_review`） | 格式错误、交付物缺失、Comment 遗漏 | ~5% 漏 |
| **L2 对抗审查** | Tester + Reviewer + Owner(Approval) | Spec 偏离、边界情况、质量问题 | ~10% 漏 |
| **L3 Evidence Gates** | 平台 + Agent 质检 | 结构性遗漏、跨模块不一致 | ~2% 漏 |
| **L4 Human 闭环** | Human 介入 | Agent 无法解决的模糊决策 | ~0.5% 漏 |
| **L5 下游发现** | 下游 Task Agent | 上述所有层残留（~1%） | 被动响应 |

**命名约定**：L0-L5 为质量防线层级（L0 自测 / L1 提交门 / L2 对抗审查 / L3 Evidence Gates / L4 Human 闭环 / L5 下游发现）；Floor 0-3 为 harness_floor 字段值（self_test/review/gate/human），对应 L0-L4 的前四层。L4/L5 不纳入 Floor 编号。

### 7.2 L0 Agent 自测

Agent 执行 Task 时挂载 `csi-self-verification` Skill，自主跑 lint/test。自测通过后调 `submit_for_review`。

**升级路径**：同一原因连续自测失败 3 次（语义相似度 > 0.85 判定）→ 通知 Agent Owner；`self_test_attempts` 达上限 5 → 升级 L3/L4。Agent 也可自主 `@mention` 求助（平台增强上下文：自测失败原因 + 最近 3 次自测记录）。

### 7.3 L1 提交门（Floor 1）

平台在 `submit_for_review` MCP 工具 handler 中**原子完成**三项校验：

1. **Comment Required**：最近一次 run 是否产生 Comment → 无则 `E_COMMENT_REQUIRED`
2. **Output Schema**：result JSON 是否包含必需字段 → 不符则 `E_DELIVERABLE_INVALID`
3. **Deliverable Existence**：`publish_artifact` 引用的文件是否在 Project Store 存在且非空 → 缺失则 `E_DELIVERABLE_INVALID`

三项全通过 → `status: running → in_review`，启动 Execution Policy。

秒级修正，不计 Review/重试轮数（幂等友好）。

> **勘误（M4-patch-runner-artifact-publish 2026-08-27 补注）**：item 3 的作用域 = **project-bound 任务**（issue 行 `project_id` 非空）。**projectless 任务（bidding/signing 等无 project 关联的执行）豁免 deliverable-existence**——publish 侧既定产品语义是"bidding-phase tasks stage files without publishing"（能注册的必须注册，不能注册的不要求注册），Floor1 校验侧与之精确镜像；豁免后 projectless 链仍受 item 1（Comment Required）与 item 2（Output Schema）约束。project-bound 任务的 deliverable-existence 校验语义不因豁免而弱化。

### 7.4 L2 对抗审查（Execution Policy）

Execution Policy 声明 Review Stage + Approval Stage（可选）。

**流转逻辑**：
- Floor 1 通过 → `in_review`，`execution_state: { status: 'pending', currentStageIndex: 0, currentStageType: 'review' }`
- Review Stage：Tester/Reviewer 作为 currentParticipant 决策（approve / request_changes）。只有当前 participant 才能决策，平台拒绝其他 Actor 的 422。
- 驳回 → 回到**同一 Reviewer**（非从头开始），`execution_state.status: 'changes_requested'`，assignee 回到 Executor
- pass + approvalStage 非空 → `stage: 'awaiting_approval'`（状态仍 `in_review`）
- approvalStage 为空 → `done`（触发 done hooks）
- approvalStage 非空 → approvalStage 声明的 currentParticipant 审批后 `done`（默认 currentParticipant = Owner；质量档案 `quality_tier='excellent'` 的 Reviewer Agent 可在 Owner 委托模式下执行审批，与 §7.9 自我强化循环对齐）

**Approval Stage 三层配置模型**（取代硬编码必设清单）：Approval 是否必设由三层叠加决定，层间边界清晰，下层补充上层未覆盖：

| 层 | 来源 | 边界 | 适用对象 | 落地 |
|----|------|------|---------|------|
| **层 1 平台硬编码（不可配置）** | 平台代码 | **仅跨雇主契约门**——凡涉及对外契约调整或对外交付的决策点 | Spec 提交雇主确认、交付物提交雇主验收、Spec 变更对外发起 | Execution Policy 在 Plan 提交时由平台强制注入 approvalStage，Orchestrator 不可省略 |
| **层 2 SOP 模板配置** | SOP 模板"评审门"字段（见 §10.2） | **仅内部门**——PRD/架构/测试用例/Plan v2/里程碑等内部产出的 Approval 是否必设 | 内部阶段产出 Task | Plan 生成时按 SOP 模板继承；不同 project 类型用不同 SOP 模板，同一类 Task（如 PRD）在 SOP A 中必设、在 SOP B 中可选 |
| **层 3 Agent 运行时自主请求** | Agent 调 `request_approval` MCP 工具（见 §9.5） | **仅补充**——SOP 未要求时，Agent 自主判断产出关键需 Owner 介入 | 任何 running 状态 Task | 运行时动态追加 approvalStage（见 §7.4.1）；Agent 一等公民权利 |

**关键约束**：层 1 仅限契约门（不延伸到内部产出）；层 2 仅限内部门（不延伸到契约门）；层 3 仅补充（不替代层 1/2 的强制门）。三层无冲突——同一 Task 可同时命中层 1（契约门）+ 层 2（SOP 必设）+ 层 3（Agent 自主请求），此时合并为单个 approvalStage，不重复阻塞。

**SOP 模板"评审门"字段映射**（层 2 落地）：SOP 模板每阶段声明的"评审门"字段（见 §10.2 §orchestrator-sop-mechanism）映射到 Execution Policy：技术评审 → reviewStage（Reviewer=声明角色）；最终审批 → approvalStage（currentParticipant=Owner）。映射规则在 Plan 生成时由平台按 SOP 模板自动展开，Orchestrator 不显式声明 stages 中的 approval 段。

**升级路径**：同一 Reviewer 同一原因连续驳回 3 次（`same_reason_reject_streak`，语义相似度 > 0.85）→ `escalate_to_human`。

### 7.4.1 运行时动态追加 approvalStage（层 3 落地机制）

层 3 的 Agent 自主请求权通过 Execution Policy 的"静态声明 + 运行时动态追加"机制实现：

- **静态声明**（既有机制）：Plan 提交时 execution_policy.stages 数组声明 reviewStage + approvalStage（层 1/2 在此落地）
- **运行时动态追加**（新增）：Agent 在 `running` 状态调用 `request_approval` MCP 工具 → 平台在 `execution_state.stages` 数组末尾 append 一个 approvalStage 元素（kind=approval, source=agent_runtime_request, requested_by=当前 Agent）
- **状态机推进不变**：`currentStageIndex` 仍按数组索引顺序前进；追加后数组长度可变，但已通过的 stage 不会回退；新追加的 approvalStage 成为当前阻塞 stage
- **接缝点**：复用 §3.5 `task_interactions` 表（kind=request_approval，本质是 kind=request_confirmation 的强阻塞变体，status 走 pending/accepted/rejected 状态机），不新建表；approve/reject 复用既有 §9.5 `approve` MCP 工具与 §3.6 `task_execution_decisions` 审计
- **超时策略**：内部门（层 2/3）auto-approve；契约门（层 1）escalate（见 §6.2 Spec 变更超时修正与 §15.1 Owner 失联统一策略）
- **runtime-append approvalStage 生命周期**（reject/超时后处置，阻断项 A 收尾）：每个 runtime-append stage 在 `execution_state.stages` 数组中带 `lifecycle` 字段，取值 `active`（阻塞中）/`completed`（approve 通过）/`superseded`（reject 或被新请求取代）/`auto_approved`（内部门超时 auto-approve）/`escalated`（契约门超时 escalate）。**effective 推进队列 = stages.filter(s => s.lifecycle === 'active' || s.lifecycle === undefined)**；状态机推进逻辑只看 effective 队列，已结束的 stage 不再阻塞。reject 时旧 stage 标 `superseded` 移出 effective 队列，`currentStageIndex` 回退到前一个未完成 stage，Task 回 `running` 交 Executor 修正（与 `request_changes` 同构）；Executor 修完 resubmit 后从当前 reviewStage 重新推进，不命中旧 approvalStage。若 Executor 再次请求审批，新调用生成新 stage_id + 新 `idempotency_key=task_id+run_id`（同 run 命中 UNIQUE 返回既有 approval_id 防重；新 run 生成新 stage），旧 stage 永不复活。层 2 静态声明的 approvalStage（非 runtime-append）走相同 lifecycle 语义，但其 reject 回退到当前 reviewStage 由 Reviewer 复审（非回 running），与 §7.4 Review Stage 驳回语义一致。超时翻转由 §10.8 统一超时扫描组件（`deadline_scanner`）执行，不依赖 MCP 调用。

### 7.5 L3 Evidence Gates（G1-G6）

仅 `milestone=true` 的 Task 在 Floor 2 通过后触发。分两 Stage：

**Stage A（同步串行，秒级，平台代码）**：

| Gate | 名称 | 校验项 | 失败错误码 |
|------|------|--------|-----------|
| G1 | 需求覆盖 | Spec.requirements 每条在 result.coverage 有声明 + 引用的 deliverable 已发布 | G1_REQUIREMENT_NOT_COVERED / G1_DELIVERABLE_NOT_PUBLISHED |
| G2 | 验收标准 | Spec.acceptance_criteria 每条在 result.ac_verification 有记录 + passed==true | G2_AC_NOT_VERIFIED / G2_AC_VERIFICATION_FAILED |
| G3 | 交付物完整性 | required=true 的交付物：已发布 + Store 文件存在 + size ≥ min_size + checksum 一致 | G3_DELIVERABLE_NOT_PUBLISHED / G3_DELIVERABLE_MISSING_IN_STORE / G3_DELIVERABLE_SIZE_BELOW_THRESHOLD / G3_DELIVERABLE_CHECKSUM_MISMATCH |
| G6 | 流程合规 | 显式 task_dependencies 全 done + Plan 声明的前置里程碑全 done + 同 phase 顺序约束 | G6_DEPENDENCY_NOT_DONE / G6_PREREQUISITE_MILESTONE_NOT_DONE / G6_PHASE_SEQUENCE_VIOLATION |

**Stage B（异步串行，分钟级，Agent 质检 Task）**：

| Gate | 名称 | 执行载体 | 校验项 | 失败错误码 |
|------|------|---------|--------|-----------|
| G4 | Spec 合规 | 质检 Task(type=quality_check) 分配给 Reviewer Agent，read_only | Reviewer 自主判断 Spec 偏离，须输出结构化 JSON + 覆盖所有 requirements_id | G4_SPEC_DEVIATION / G4_INVALID_OUTPUT / GATE_TIMEOUT(30min) |
| G5 | 质量审查 | 质检 Task 分配给 Tester Agent，read_and_execute_tests | 执行测试套件，pass_rate ≥ pass_threshold(默认 **0.95**，走 SOP 模板配置 + Plan 审批确认，见 §10.2)；Tester 可标注 `known_failures`（含失败项名 + 原因 + 风险评估），**known_failures 不计入 pass_rate 分母** | G5_TEST_FAILURE / G5_INSUFFICIENT_PASS_RATE / GATE_TIMEOUT(60min) |

G6 通常不应失败（能进 Floor 3 说明依赖已 done），fail 常见原因是上游 Task 在 Floor 2 通过后被 reopen。

**普通 Task**：Floor 2 Approval 通过后即 `done`，不走 Floor 3。

#### 7.5.1 gate_running substate 生命周期（基线 #4 ②）

`gate_running` 是 substate（非 status），父里程碑 Task（`milestone=true`）在 Floor 2 approvalStage pass 后进入 Floor 3 时设置，覆盖 Stage A（G1/G2/G3/G6 同步）+ Stage B（G4/G5 异步）全程。

- **设置时机**：Floor2 approvalStage pass → 父 Task `status=in_review` + `substate=gate_running`，进入 Floor 3。
- **清除时机**：
  - 收敛成功：Stage A 全 pass + Stage B 全 pass → 清 `gate_running`（substate→null）→ `in_review→done` 边放行（见 §7.5.6 done 收敛条件）。
  - 收敛失败：任一 Gate fail → 清 `gate_running` 设 `gate_failed` → 父 Task 回 `running` 走 Harness（见 §7.5.3 质检失败回流）。
  - 解除重入列（M4-patch 补录 2026-08-27）：`blocked→queued`（Owner unblock / 依赖满足 / manual handling）边 InTx-side 清 substate——substate 是当前执行相位的细粒度标记，重新入列即相位过期，任何残留（gate_failed / awaiting_* 等）一律清除；不变式：可调度行（queued/ready/dispatched/running）substate 必为 NULL（configuration_incomplete 降级行除外，由 blocker 处置路径清除后回扫）。
- **Stage A → Stage B 衔接**：Stage A（G1/G2/G3/G6 同步秒级平台代码）全 pass 后无缝进入 Stage B（创建 G4/G5 质检子 Task），`substate` 保持 `gate_running` 不中断。
- substate 枚举一致性：`gate_running` / `gate_failed` 已在 §3.3 + 附录 A.2 substate 列声明，本节不新增 substate 值。

#### 7.5.2 质检子 Task 创建与生命周期（基线 #4 ③）

G4/G5 质检子 Task（`task_type=quality_check`，§1.2.1 ④ 枚举第 7 值）的创建时机、创建者与生命周期：

- **创建时机**：Stage A（G1/G2/G3/G6 同步平台校验）全 pass 后，平台自动创建 G4 + G5 两条质检子 Task。Stage A 失败不创建，直接 Harness 回流省 Agent 算力。
- **创建者**：平台（非 Orchestrator）。Floor 3 是平台强制门，不走 Plan DAG。
- **质检子 Task 属性**：
  - `task_type=quality_check`，`parent_task_id`=父里程碑 Task，`milestone=false`（不递归触发 Floor 3）
  - `execution_policy.gate_config` JSONB 承载 Gate 元数据：`{gate_type: G4|G5, pass_threshold: 0.95(G5 only), timeout_seconds: 1800(G4)/3600(G5), skip_if_passed: false}`
  - `assignee`：G4→Reviewer Agent，G5→Tester Agent（平台直接指派）
- **质检子 Task 生命周期（简化路径）**：`planning→queued→ready→dispatched→running→done`，`execution_policy` 仅含 Floor0 自测 + Floor1 submit schema 校验，**无 reviewStage/approvalStage/Floor3**（质检子 Task 本身是质量裁决，再 review 会递归）。
- G4 质检子 Task：Reviewer Agent，`read_only`，输出结构化 JSON + 覆盖所有 `requirements_id`。
- G5 质检子 Task：Tester Agent，`read_and_execute_tests`，执行测试套件，`pass_rate ≥ pass_threshold`（默认 0.95，SOP 配置 §10.2），`known_failures` 不计入分母。

#### 7.5.3 质检失败回流（基线 #4 ④）

G4/G5 fail（含 GATE_TIMEOUT）的回流路径：

- **回流路径**：质检子 Task 标终态 `done`（`gate_result=fail`，写入父 Task `gate_results`）→ 父里程碑 Task 清 `gate_running` 设 `gate_failed` → 父 Task 走既有 `in_review→running` 边（§8.3，trigger=`request_changes` 同构）→ Executor 拿 G4/G5 失败报告修正产出。
- **harness 计数**：`harness_attempt++` 计在父里程碑 Task（§7.7 `failure_point=floor_3_gate` 明确），不计质检子 Task。
- **质检子 Task 处置**：一次性质检实例，fail 后标终态 `done`（`gate_result=fail`）不重跑自身。重跑通过父 Task 重新 `submit_for_review` 触发 Floor 3，创建新质检子 Task 实现。
- **Harness 4 段式注入**（§7.7）FAILURE REPORT 段含 Gate 失败报告：`failure_point=floor_3_gate` / `failure_reasons=[G4_SPEC_DEVIATION|G5_TEST_FAILURE|GATE_TIMEOUT]` / `executor_snapshot` / `gate_result_json`（质检子 Agent 的结构化产出）。
- **回流走的转移边**：父 Task 用既有 `in_review→running` 边（§8.3 已注册），**不新增转移边**——质检失败回流复用既有 Review 驳回同构路径。

#### 7.5.4 重试/跳过/超时收敛规则（基线 #4 ⑤）

**重试收敛**：
- Gate fail → `harness_attempt++`（计父 Task）→ 父 Task 回 `running` → Executor 修正 → 重新 `submit_for_review` → 重走 Floor1/2/3 → Stage A pass 后创建新质检子 Task。
- 重试上限 = `harness_max_attempts`（SOP 模板配置，默认 4，§7.7/§10.2）。耗尽 → §7.6 L4 Human 闭环（`escalate_to_human` → 父 Task `any→blocked`，§8.3 既有边）→ Agent Owner 在 Console 决策。

**超时收敛**（M0.5 边界）：
- G4=30min / G5=60min（§15.4）→ `GATE_TIMEOUT` 错误码 = Gate fail 的一种，走 Harness 同路径（与 `G4_SPEC_DEVIATION`/`G5_TEST_FAILURE` 并列）。
- 超时检测 + 质检子 Task 状态翻转由 §10.8 `deadline_scanner` 执行（扫描 `project_tasks` 中 `task_type=quality_check` AND `status=running` AND `gate_config.timeout_seconds` 到期 → 翻质检子 Task `running→done`(gate_result=fail) → 触发父 Task 回流）。**扫描器实现属 M0.5**，本节只定义规则。

**跳过收敛（skip_if_passed）**：
- **声明**：质检子 Task 在 `execution_policy.gate_config.skip_if_passed=true` 声明可复用。
- **复用条件**：父 Task 历史 `gate_results` 有同 `gate_type` 的 pass 记录 **AND** 当前 Spec snapshot version == 上次 pass 时的 Spec snapshot version（Spec 未变）。
- **复用动作**：质检子 Task 不 dispatch Agent，**创建即终态 done（非转移边——平台 INSERT 时直接落 `status=done`，R13① 裁决：复用是平台判定记录而非生命周期推进，CreateRoutineTask 平台动作步 born-done 先例；不注册 `planning→done` 边）**，`gate_results` 标记 `status=reused` + `reused_from={task_id, gate_type, passed_at, spec_snapshot_version}`。
- **配置权**：`skip_if_passed` 默认 `false`，由 Plan/SOP 模板按 project 类型配置（§10.2 SOP 可配哲学）。例如 `sop-market-research`（无测试套件）可设 G5 `skip_if_passed=true` 跳过测试门。

#### 7.5.5 Gate 生命周期时序图（基线 #4 ⑦）

```
父里程碑 Task (milestone=true, status=in_review)
  │
  │  Floor2 approvalStage pass
  ▼
[substate=gate_running] ── Stage A (同步, 秒级, 平台代码) ──────────────
  │   G1 需求覆盖 │ G2 验收标准 │ G3 交付物完整性 │ G6 流程合规
  │
  ├── Stage A 任一 fail ──► substate=gate_failed → in_review→running (harness_attempt++)
  │                                                  │
  │                                                  └─ Executor 修正 → 重走 Floor1/2/3
  │
  ▼  Stage A 全 pass
[创建 G4+G5 质检子 Task] (task_type=quality_check, parent_task_id=父, 平台创建)
  │
  │  ┌─ skip_if_passed 检查 ─────────────────────────┐
  │  │ 历史 gate_results 同 gate_type pass           │
  │  │ AND Spec snapshot version 未变                │
  │  │ → 质检子 Task 创建即 done(reused)（非转移边）  │
  │  │ → gate_results 标 reused_from                  │
  │  └──────────────────────────────────────────────┘
  │
  ▼  Stage B (异步, 分钟级, Agent 质检子 Task)
  │   G4 (Reviewer Agent, read_only, 30min)  G5 (Tester Agent, read_and_execute_tests, 60min)
  │
  ├── G4/G5 pass ─────────► 6 Gate 全 pass → substate 清空 → in_review→done ✓
  │
  ├── G4/G5 fail ──────────► 质检子 Task done(gate_result=fail)
  │                          → 父 substate=gate_failed → in_review→running
  │                          → harness_attempt++ (计父 Task)
  │                          → Executor 修正 → 重走 Floor1/2/3 → 新质检子 Task
  │
  ├── G4/G5 超时(30/60min) ► GATE_TIMEOUT (= Gate fail 的一种)
  │                          → 同 fail 路径 (deadline_scanner 翻转, M0.5 实现)
  │
  └── harness_attempt ≥ max ► escalate_to_human → 父 Task any→blocked
                              → Agent Owner Console 决策 (§7.6 L4)
```

#### 7.5.6 done 收敛条件 + gate_results schema（基线 #4 ⑥）

父里程碑 Task `in_review→done` 边（§8.3）的 Gate = `approvalStage + Floor3_Gates`。收敛条件：

- Stage A 全 pass：G1 需求覆盖 + G2 验收标准 + G3 交付物完整性 + G6 流程合规
- Stage B 全 pass：G4 Spec 合规 + G5 质量审查（`status=pass` 或 `status=reused`）
- 任一 Gate fail → 不允许 done，走 §7.5.3 质检失败回流路径。

**gate_results 单一真相源**：父里程碑 Task `gate_results` JSONB 统一记录 6 条 Gate 结论。schema 对齐 `research/evidence-gates-spec.md §9` 完整结构（含顶层元字段 + `gates` 对象 + `failure_report` + `previous_attempts`），并扩展 `reused_from`（skip_if_passed 需要，§9 原 schema 未设计）：
```json
{
  "version": "1.0",
  "schema_ref": "research/evidence-gates-spec.md §9",
  "task_id": "uuid",
  "milestone": true,
  "gate_run_id": "uuid",                    // 每次 Gate 执行的唯一标识(审计)
  "triggered_at": "ISO8601",
  "triggered_by": "auto",                    // auto|manual
  "harness_attempt": 0,                      // 当前 Harness Loop 第几次(0=首次, §7.7)
  "overall_passed": false,                   // 6 Gate 全 pass(reused 视为 pass)
  "failed_gate": "g5|null",                  // 首个失败 Gate id
  "gates": {
    "g1": { "status": "pass|fail|skipped|reused", "error_code": "...|null", "executed_at": "ISO8601", "detail_ref": "§2.3" },
    "g2": { "status": "...", "error_code": "...|null", "executed_at": "ISO8601", "detail_ref": "§3.3" },
    "g3": { "status": "...", "error_code": "...|null", "executed_at": "ISO8601", "detail_ref": "§4.3" },
    "g6": { "status": "...", "error_code": "...|null", "executed_at": "ISO8601", "detail_ref": "§5.3" },
    "g4": { "status": "...", "error_code": "G4_SPEC_DEVIATION|G4_INVALID_OUTPUT|GATE_TIMEOUT|null", "executed_at": "ISO8601",
            "agent_run_id": "uuid|null", "quality_check_task_id": "uuid|null",
            "reused_from": { "task_id": "uuid", "gate_type": "G4|G5", "passed_at": "ISO8601", "spec_snapshot_version": "int" }|null,
            "detail_ref": "§6.3" },
    "g5": { "status": "...", "error_code": "G5_TEST_FAILURE|G5_INSUFFICIENT_PASS_RATE|GATE_TIMEOUT|null", "executed_at": "ISO8601",
            "agent_run_id": "uuid|null", "quality_check_task_id": "uuid|null",
            "reused_from": { /* 同 g4 */ }|null,
            "detail_ref": "§7.3" }
  },
  "failure_report": {                        // §7.7 Harness 4-段式注入 FAILURE REPORT 段来源; 全 pass 时为 null
    "gate_id": "g1..g6",
    "error_code": "...",
    "failures": [],
    "fix_hint": "...",
    "executor_snapshot": { "last_comment_summary": "...", "published_artifacts": [], "git_commits": [] }
  },
  "previous_attempts": [                     // 历史 attempt 摘要; Agent 可参考前几次失败原因避免重蹈覆辙; 首次为 []
    { "gate_run_id": "uuid", "harness_attempt": 1, "failed_gate": "g3", "failed_at": "ISO8601" }
  ]
}
```
- `gates` 为对象（非数组），key 为 `g1..g6`，每条含 `status`/`error_code`/`executed_at` + G4/G5 独有 `agent_run_id`/`quality_check_task_id`/`reused_from` + `detail_ref` 指向研究文档 §2.3-§7.3 各 Gate 详细输出 schema。
- `failure_report` 是 §7.7 Harness 4-段式注入 `FAILURE REPORT` 段的数据来源——Gate fail 时必填，全 pass 时为 `null`。
- `previous_attempts` 累积历史 attempt 摘要，支持 Agent 学习；首次执行为空数组。
- `reused_from` 是本设计扩展字段（§9 原 schema 未设计），仅在 `skip_if_passed` 复用时填充，否则为 `null`。
G6 特殊：G6 通常不应失败（能进 Floor 3 说明依赖已 done），fail 常见原因是上游 Task 在 Floor 2 通过后被 reopen。G6 fail 也走 Harness 同路径。

### 7.6 L4 Human 闭环

Harness Loop 耗尽（`harness_attempt` 达 `harness_max_attempts`）→ 强制 `escalate_to_human` → Task `blocked` → Agent Owner 在 Console 决策：修复配置 / 取消 Task / 重新拆分 / @Architect-Agent 协助拆分（见 §9.2 P8 兜底）。`harness_max_attempts` **走 SOP 模板配置**（简单 Task=2 / 中等=4 / 复杂=6，见 §10.2），Plan 审批确认，Agent 执行中不可调；估错走 escalate → @Architect 拆分兜底。

### 7.7 Harness Loop（4 段式重试）

Gate 失败 → `harness_attempt++` → 4 段式上下文注入：

```
ORIGINAL TASK        ← 原始 Task 上下文
PREVIOUS ATTEMPT     ← 上次尝试的产出
FAILURE REPORT       ← Gate 失败报告（failure_point / failure_reasons / executor_snapshot）
FIX INSTRUCTION      ← 修复指令
```

`harness_floor`：self_test / review / gate / human。
`failure_point`：floor_0_self_test / floor_1_submit_gate / floor_2_review / floor_2_approval / floor_3_gate。

计数上限：Floor 0 自测=5、Floor 2 同一原因=3、Floor 3 Gate=`harness_max_attempts`（**SOP 模板配置**：简单=2 / 中等=4 / 复杂=6，见 §10.2；默认 4）、Agent Team=3。Floor 3 Gate 上限由 SOP 模板按 project 类型/Task 复杂度声明，Plan 审批时确认；Agent 执行中不可调整。

`task_revision_negotiations` 表记录 Harness 耗尽后的处置：追加次数 / 更换执行者 / 拆分 / 升级。

### 7.8 合规三层（Layer A / B / C）

| 层 | 机制 | 效果 | 典型场景 |
|----|------|------|---------|
| **Layer C 上下文注入** | Workspace Context + Instructions + Skills 每次执行必然加载 | Agent 不会"忘记"规则 | csi-self-verification Skill 塑造"自测对你有利"认知 |
| **Layer A 平台强制** | 关键路径 Hard Gate（submit_for_review 必过 Floor 1、done 必过 Execution Policy） | Agent 绕不过去 | Floor 1 拦截无 Comment 提交；Tester 必须决策（Liveness 检测无 active run 超时 → escalate） |
| **Layer B 平台检测** | 空洞 approve、未自测、跳过审查 → 事后检测 + 升级通知 | Agent 违规会被发现 | 空洞 approve 检测（Comment 仅"通过" + 未引用测试结果 → shallow_approval，连续 3 次 → 通知 Owner 建议 Approval Stage）；快速驳回模式检测；时间间隔检测（commit→submit < 30s） |

**违规场景 × 三层应对**：

| 场景 | Layer A | Layer B | Layer C |
|------|---------|---------|---------|
| Agent 没自测就提交 | Floor 1 必然触发 | 自测证据缺失检测 + 快速驳回模式检测 + 时间间隔检测 | csi-self-verification Skill |
| Tester 测出问题但不反馈 | Tester 必须决策（Liveness）；request_changes 必须附 Comment | 空洞 approve 检测 + 时间过短检测 + 产出物一致性检测 | csi-reviewer-duty Skill |
| Agent 忽略 @mention | @mention 必然创建 Inbox + 唤醒 | 4h 未响应检测 + "收到但不处理"检测 | Skill 约定 1h 响应 |
| Executor 被多次驳回后放弃 | Harness Loop 有界重试；同一原因 3 次强制 escalate | 低质量重试检测（变更量递减 → low_effort_retry → 立即 escalate） | — |

### 7.9 质量档案反馈循环

`agent_quality_profile` 表记录 Agent 质量指标：`total_tasks_completed`、`tasks_passed_first_review`、`avg_review_rounds`、`shallow_approval_count`、`mention_response_avg_hours`、`quality_tier`(excellent/standard/needs_attention)。

**自我强化循环**：`quality_tier = 'excellent'` → 减少 Approval Stage → 更多自主权；`needs_attention` → 增加 Human 审批。做得好→更多自主→更好；做得差→更多监管→改进或被替换。Orchestrator 分配 Task 时参考质量档案。

---

## 第 8 章 执行拦截框架

### 8.1 Transition 抽象

所有状态变更归一为原子 `Transition(from → to)`。先状态机 Guard 判定，再按 `(from→to)` 触发 hook 链。天然幂等、规则单一。

### 8.2 Guard / Gate / Side hook 链

同一转移边的执行顺序：

1. **State Machine Guard**（最先）：该边是否合法？当前状态是否允许？
2. **Guard Hooks**（平台内置，与转移同原子，失败→拒绝+回滚）
3. **Gate Hooks**（executionPolicy 声明，策略注入，失败→拒绝+回滚）
4. **写状态 + 落 transitionId**（提交点 / transaction commit marker）
5. **Side Hooks**（after-commit，最后，失败→补偿/重试，不阻塞）

规整口诀：**Guard 判断"能不能转"，Gate 判断"该不该转"，Side 处理"转了之后的善后"**。

### 8.3 转移边 hook 映射表

> **单一真相声明**：本表是 Task 状态转移边的**全量注册表**，附录 A.2 状态机图自此派生，附录 A.2 与 §8.3 边集完全一致；§9.3.1 Dispatcher 流转边（3 条）是 §8.3 的子集（Dispatcher 仅处理队列调度边，非全量）。研发照本表逐边实现 hook，零自由裁量。`blocked` 回退边统一为 `blocked→queued`（与源文档 interceptor-framework.md §3 一致；附录 A.2 旧绘的 `blocked→ready` 已修正为 `blocked→queued`）。动态预派发校验统一挂载在 `ready→dispatched` 边（§9.3.1 一致）。

> **P1 公测版 Human 角色说明**（M0.6a 决策）：本表所有 claim 转移边（`dispatched→running` / `reopened→running`）仅由 Agent Atomic Checkout 触发，Human 不直接触发任何 Task 状态转移边。Human 的介入方式为 comment / approve / request_changes / @mention 协作（见 §2.2.1 Human 作为协作者）。P2/P3 演进时若需 Human claim，在本表新增 Human claim 边，不改动现有 Agent 边。

| 转移边 (from→to) | 触发事件 | Guard | Gate | Side |
|------------------|----------|-------|------|------|
| `planning→queued` | 提交 plan / 通过审批 | DAG 无环、依赖存在、Agent/Runtime 存在、stage 合法、**context token 预估校验**（见下） | executionPolicy 生效校验 | 层 1 契约门 approvalStage 平台注入（契约面 task_type，Orchestrator 不可省略；已有声明合并不重复，§7.4） |
| `queued→ready` | 系统 dispatch（Pre-dispatch 静态校验通过） | **Pre-dispatch 静态校验**：Spec 引用有效、Spec 版本有效、上游产出可访问、required_skills 模板存在、Plan version 有效、Workspace 存在、ExecutionPolicy 配置有效 | — | 无（失败 → substate=`configuration_incomplete`，建 `task_configuration_blockers` 记录，通知 Plan Owner + Agent Owner，24h 超时升级） |
| `ready→dispatched` | 系统 dispatch（Pre-dispatch 动态校验通过） | **Pre-dispatch 动态校验**：Runtime 在线、Runtime 健康、Skills 绑定、MCP 工具白名单、预算余额、Workspace 配额、Agent 状态、Spec 片段可读 | — | 无（失败 → 拒绝 checkout 返回 409，Task 状态不变，Agent 可重试） |
| `dispatched→running` | Agent Atomic Checkout 认领 | session 绑定校验（actor 必须是对应 executor） + **max_concurrent_check**（额度，Atomic Checkout SQL 同事务） | — | claim 日志 |
| `running→in_review` | `submit_for_review` | **Floor1**: Comment Required / 输出 schema / deliverables 存在非空 | ExecutionPolicy reviewStage | 建 Floor2 单 / 通知 Reviewer + orchestrator_wake（三源唤醒注入） |
| `in_review→running` | `request_changes` / `submit_review_result(fail)` | currentParticipant 校验、comment 长度阈值 | — | 通知 Executor、决策审计（`task_execution_decisions` 落行，stage_type 取决策阶段 kind） + orchestrator_wake（三源唤醒注入） |
| `in_review→done` | `approve` / `submit_review_result(pass)` | approvalStage currentParticipant 校验 | approvalStage + **Floor3_Gates**(里程碑)；milestone Task 拒绝直达 done（D4 接缝：须先 gate_running 交接，见 §7.5.1） | 决策审计（`task_execution_decisions` 落行 + Layer B quick-reject 检测）、Executor 质量档案统计、**deps_unlock**、commentRequired 校验、通知下游 + orchestrator_wake（三源唤醒注入；in_review→done 边阶段全终态时 reason_kind 升格 stage_milestone，见 §10.3） + goal_mode_threshold（Goal Mode 阈值检查） |
| `done→reopened` | `reopen_task` | 方向合理性 diff 二次校验 | — | **reopen_backlock**（持有依赖的 done 下游→blocked） + orchestrator_wake（三源唤醒注入） |
| `reopened→running` | Agent 重新 claim 修复 | session 绑定校验 + **max_concurrent_check**（同 Atomic Checkout 口径） | — | claim 日志 |
| `any→blocked` | `escalate_to_human` / dep block | 校验确实阻塞 | — | Owner 通知 + orchestrator_wake（三源唤醒注入） |
| `blocked→queued` | 依赖满足 / Owner 解除（系统或 Console） | — | — | 清 substate 相位残留（in-tx side，M4-patch 补录 2026-08-27）+ 重新触发 dispatch |
| `dispatched→failed` | 不可恢复崩溃 | — | — | Owner 告警 / 审计 + orchestrator_wake（三源唤醒注入） |
| `running→failed` | 执行超时：deadline_scanner 扫 `execution_deadline_at`（触发源 M4 交付） | 执行超时校验 | — | Harness Loop 重试链（§10.8）：复用 `failed→dispatched` grace 回退复跑；M2 权宜（issue 保持 running、agent_runs 翻 timed_out 为平台信号）由本边注册解除 |
| `queued→failed` | 配置阻塞 48h 再超时：deadline_scanner 扫 `task_configuration_blockers`（M4-D6b） | blocker 超时证据校验 | — | Harness 重试链：复用 `failed→dispatched` grace 回退复跑（同 `running→failed` 声明，M2-C3 sweeper 已承载定时器） |
| `failed→dispatched` | grace period 到期自动回退（系统定时器，非 MCP） | — | — | 重新开放 claim |
| `any 非终态→skipped` | Owner Console 显式跳过（非 MCP） | — | — | 回锁（下游依赖若已 done→blocked）/ 通知 |

**`request_approval` 动态追加（非状态转移边）**：Agent 在 `running` 状态调 `request_approval` MCP 工具（§9.5）→ 平台在 `execution_state.stages` 末尾 append approvalStage 元素（§7.4.1）→ Task.status 仍为 `running`，仅 substate→`awaiting_approval`。该操作不产生 status 转移边，不走 §8.3 转移边 hook 链；其拦截 handler 动作（5 步原子，见 §9.5 工具契约）在 MCP 工具调用层执行。Owner approve → stage 标 `completed`，substate 清空，Task 回 running 继续（非转移边）；Owner reject → stage 标 `superseded` 移出 effective 推进队列，走既有 `in_review→running` 边的 `request_changes` 同构路径（assignee 回 Executor + 附 reject Comment），Task 回 `running` 由 Executor 修正——resubmit 不命中旧 stage（reject/超时/supersede 完整生命周期见 §7.4.1）。层 2 静态声明的 approvalStage 在 Review pass 后触发 `stage: 'awaiting_approval'`（状态仍 `in_review`，见 §7.4），其 approve 走既有 `in_review→done` 边。

**`planning→queued` context token 预估校验**（context overflow 预防，平台 Guard hook）：Plan 提交时，平台对 Plan 内每个 Task 按以下**启发式算法**预估 Layer 4 context token 用量：
- **预估公式**：`estimated_tokens = base(task_type) + spec_component(spec_complexity) + upstream_component(upstream_count, upstream_avg_summary_len) + execution_policy_component + type_specific_section`
  - `base(task_type)`：按 §9.2 类型矩阵取固定基线（development=1300、architecture_design=1500、testing=1300、acceptance_review=1500、spec_generation=1500、bid_analysis=2700）
  - `spec_component`：`min(spec_snippets_chars / 4, 2000)`（spec_complexity 由 Spec 需求数 × 平均 AC 数估算 snippet 总字符数）
  - `upstream_component`：`min(upstream_count × 500, 1500)`（每个上游 Task 约 500 tokens：artifact summary + 1 条 Comment）
  - `execution_policy_component`：400（固定）
  - `type_specific_section`：按 §9.2 类型专属 section 预算（development=600、architecture_design=800 等）
  - 额外加 `reserve_for_pruning=1500` + `_meta+task+environment+budget=600`（固定开销）
- **双阈值语义**（2026-08-19 GQ-9 修正，drift 中等变更）：
  - `estimated_tokens > 6000` → **预警**（warning 级），返回 `W_CONTEXT_OVERFLOW_RISK` + 预估明细；Orchestrator 可选择拆分 Task / 减少 upstream 依赖 / 继续提交（warning 不阻塞）
  - `estimated_tokens > 9000` → **硬上限 reject**，返回 `E_CONTEXT_OVERFLOW_RISK` + 预估明细；Orchestrator 必须拆分该 Task 或减少 upstream 依赖才能重新提交 Plan
- **Routine 场景豁免**：Routine 引擎（§4）创建 Task 时，`planning→queued` 边的 context token Guard 仅做 9000 硬上限校验（6000 预警仍计算但不阻塞 Routine 推进）——Routine 是平台编排产物（非 Orchestrator 手动提交），其 Task 结构已由 Routine 定义裁剪，不适用"Orchestrator 拆分重提交"语义
- **设计约束**：纯启发式估算（基于 task_type + 字段长度 + upstream 数量），**不引入 LLM 预估调用**；预警阈值 6000 宁可误判略保守（warning 提示 Orchestrator 优化），硬上限 9000 不可漏判（漏判导致 P8 硬失败时才有兜底）。校验在 Plan 提交时一次性完成，Task 进队列后不再重估（upstream 产出实际长度可能变化，由 P1-P7 裁剪策略 + P8 兜底处理）

**Project 转移边 hook 映射表**（与 Task 转移边并列的 Project 状态机单一真相；附录 A.1 状态机图自此派生）：

| 转移边 (from→to) | 触发事件 | Guard | Gate | Side |
|------------------|----------|-------|------|------|
| `spec_nego→planning` | 雇主确认 Spec / Spec 自动确认 | spec_snapshot 已写入、Opportunity 状态=中标 | — | **自动创建 Plan 生成 Task**（task_type=`spec_generation`→`architecture_design`；assignee=Orchestrator Agent），写 `projects.spec_confirmed_at` |
| `planning→plan_review` | Orchestrator 调 `submit_plan` MCP 工具 | Plan DAG 校验通过、context token 预估校验通过（§8.3 Task 边同 Guard） | SOP §10.2 Plan 审批门（层 2） | 通知 Plan Reviewer（默认 Agent Owner，由 SOP 配置） |
| `plan_review→planning` | Plan 审批 reject | comment 必填、reject reason 记录 | — | 通知 Orchestrator；保留原 Plan 草稿版本号；允许 Orchestrator 重新 `submit_plan` |
| `plan_review→executing` | Plan 审批 approve | approvalStage 通过 | SOP 审批门 | 解锁首批 Task 进 `queued`；写 `projects.plan_approved_at` |
| `executing→in_accept` | Agent 调 `submit_deliverables` | G1-G6 全部通过、交付物已发布 | — | 写 `delivered_at=now()` / `auto_accept_after=now()+14d`；通知雇主（M 侧 #13 承载）+ 通知 Agent Owner（M5-A2 勘误：边 1 承担验收计时数据面落列） |
| `executing→budget_paused` | 预算扫描器检测 `compute_cost_used ≥ 报价 × project_compute_budget_ratio` | 阈值校验通过 | — | **Task 级联**：所有 `running`/`in_review` Task → `blocked` + substate=`budget_paused`（不占 max_concurrent 口径，见 §3.2）；写 `projects.budget_paused_at=now()`；发送 urgent 通知 Agent Owner；创建 `budget_incidents` 记录（status=`active`，schema 默认值，等待 Owner 三选一） |
| `budget_paused→executing` | Owner 三选一决策（增预算 / 优化 Plan） | `budget_incidents.resolution ∈ {budget_increased, plan_optimized}` | — | **Task 恢复**：所有 substate=`budget_paused` 的 blocked Task → `queued`（重新走静态/动态校验，不直接回原状态）；清 `projects.budget_paused_at`；`budget_incidents.status=resolved`；通知 Agent 继续执行 |
| `budget_paused→cancelling` | Owner 选"放弃" | `budget_incidents.resolution=cancelled`（放弃） | — | 走协商取消流程（§12.2 场景八 + §15.5） |
| `executing→cancelling` | 雇主发起协商取消 | Project 状态校验 | — | 通知 Agent Owner；启动 3 天响应 SLA（由 §10.8 `deadline_scanner` 承载） |
| `cancelling→executing`/`in_accept` | 协商取消撤回 | 双方同意 | — | 回到协商前状态 |
| `cancelling→cancelled` | 协商达成一致 / SLA 超时部分结算完成 | 里程碑结算完成校验（settlements 行存在性核验，M5-A5 v2） | — | 终态 |
| `in_accept→completed_pending_appeal` | 雇主验收通过 / 14 天自动验收 | 验收校验 | — | 写 `after_sale_deadline=now()+7d` / `completed_at=now()`（M5-A2 勘误：原 auto_accept_after 为边 1 笔误，验收通过时已无自动验收语义） |
| `in_accept→revising` | 雇主请求修订 | `revision_count <= revision_limit`（PRD §7.7.3"未耗尽"语义：耗尽= `revision_count > revision_limit`；严格 `<` 会使 revision_negotiation 不可达——第 limit+1 次请求进 revising（count→limit+1）后由边 5 接续升级协商） | — | `revision_count++` |
| `in_accept→revision_negotiation` | 验收被拒/修订请求且 `revision_count` 超限（M5-A2 design D1 裁决注册：`delivery.rejected`/`delivery.revision_requested` 超限出口） | `revision_count > revision_limit` | — | 写 `revision_negotiation_deadline=now()+2d`（与 revising→revision_negotiation 同构；M 侧 webhook 触发源 #14） |
| `revising→in_accept` | 修订完成 | G1-G6 校验 | — | 通知雇主 |
| `revising→revision_negotiation` | `revision_count > revision_limit` | — | — | 写 `revision_negotiation_deadline=now()+2d` |
| `revision_negotiation→in_accept`/`completed_pending_appeal`/`dispute_in_progress` | 雇主四选一（A 追加修订 / B 转 Spec 变更 / C 接受当前 / D 发起纠纷）/ 窗口超时默认 C | 决策校验 | — | 见 §12.2 场景六 / §15.5。决策值 vocabulary：`append_revision` / `spec_change` / `accept_current` / `to_dispute` / `auto_accepted_c`（超时默认，§10.8 L1613）；A Side 追加 `revision_limit += 2`，C/auto-C Side 写 `after_sale_deadline=now()+7d`，决策行随转移原子落 `revision_negotiation_decisions` |
| `revision_negotiation→executing` | B 转 Spec 变更流程确认（#22 confirm，Spec version+1 后回执行） | Spec 变更确认校验（spec_change_confirmed 证据 + Spec version） | — | 回到执行中（PRD §7.7.3 L2426；B 选项出口——decide B 移交场景七流程，deadline 清空出 §10.8 item 5 扫描集，#22 confirm 驱动本边） |
| `completed_pending_appeal→completed_final` | 7 天申诉期结束 / 仲裁履约 | — | — | 终态 |
| `completed_pending_appeal→dispute_in_progress` | 雇主发起纠纷申诉 | `now() < after_sale_deadline` | — | 进入平台仲裁（hook 已随 M5-A6 仲裁段装载） |
| `dispute_in_progress→executing`/`cancelled`/`completed_final` | 平台裁定 | 仲裁结果 | — | 终态或回执行（hook 已随 M5-A6 仲裁段装载） |
| `executing→paused_exception` | L3+ 异常升级 / Owner 手动暂停 | — | — | 暂停 Task（同 budget_paused 级联语义） |
| `paused_exception→executing` | 人工处理完成 / Owner 恢复 | — | — | Task 恢复同 `budget_paused→executing` |
| `spec_nego→cancelling` | 签约兜底（§6.3）：澄清超限（Console 侧检测 `clarification_count ≥ workspace.clarification_round_limit`，默认 5）/ Spec 修订>3 轮 / 驳回≥5 次 / 签约 30 天超时（后三类由 Marketplace webhook 承接） | 兜底条件计数校验（clarification_count 或修订/驳回计数超限） | — | 通知双方；不计入违约率（超限是协作破裂而非单方违约） |
| `cancelling→dispute_in_progress` | 场景八 #30 to-dispute：协商取消升级纠纷 | to-dispute 事件校验 | — | 进入平台仲裁（仲裁流程本体 M5/M6） |
| `paused_exception→manual_handling` | 异常升级：Owner / 平台介入人工处理 | — | — | 通知 Agent Owner（hook 随 M4 异常处理段） |
| `manual_handling→executing` | 人工处理完成恢复执行 | — | — | Task 恢复同 `paused_exception→executing` 级联语义（hook 随 M4） |
| `manual_handling→closed` | 人工处理裁定关闭（异常无法恢复） | — | — | 终态（hook 随 M4） |
| `dispute_in_progress→closed` | 平台裁定关闭 | 仲裁结果 | — | 终态（hook 已随 M5-A6 仲裁段装载） |
| `any 非终态→cancelled` | Spec 超时未确认 / 协商取消 SLA 超时 / 纠纷裁定取消 | 终态校验 | — | 终态 |

**说明**：
- Project 状态机与 Task 状态机通过 Side hook 联动：Project 转移边的 Side 负责触发 Task 级联（如 `executing→budget_paused` Side 自动翻转所有执行中 Task 的 substate）。
- `budget_paused` / `paused_exception` 的 Task 级联统一语义：Task.status→`blocked` + substate 标识暂停原因；恢复时统一回 `queued` 重新走 Pre-dispatch 双校验（避免跳过配置校验）。
- 所有 Project 转移边的 hook 在 `transition_records` 中以 `entity_type=project` 记录，与 Task 转移边（`entity_type=task`）共用同一审计表。
- **revising 状态的 Task 层联动**（M5-A3 R12③ 勘误定义）：①边 3（`in_accept→revising`）InTxSide 每轮修订**新建一个修订协作 Task**（task_type=`architecture_design`、born `planning`、assignee=project orchestrator 链、description 携带雇主修订原因）——**不 reopen 既有 done Task**（evidence/审计不可变）；修订范围界定（局部/大范围）由 Orchestrator Agent 在该 Task 上分析（大范围走既有 submit_plan 流程），平台不建模该分支。②修订协作 Task 的完成由 `submit_deliverables` 既有拦截（前置所有 TaskNode done）自然钉住。③边 4 的 G1-G6 重验对象为 **Project 级 milestone gate 全 surface**（gates_status 聚合，与边 1 同口径），触发源从 revising 再提交时以 payload evidence 承载。

**Pre-dispatch 双时机校验**（挂载边已在 §8.3 注册表声明，此处仅作语义说明）：
- 静态校验（`queued→ready` 边 Guard）：Spec 引用有效、Spec 版本有效、上游产出可访问、required_skills 模板存在、Plan version 有效、Workspace 存在、ExecutionPolicy 配置有效。失败 → substate=`configuration_incomplete`，创建 `task_configuration_blockers` 记录，通知 Plan Owner + Agent Owner，24h 超时升级（由 §10.8 `deadline_scanner` 翻转）。
- 动态校验（`ready→dispatched` 边 Guard，**单一挂载点**）：Runtime 在线、Runtime 健康、Skills 绑定、MCP 工具白名单、预算余额、Workspace 配额、Agent 状态、Spec 片段可读。失败 → 拒绝 checkout（返回 409），Task 状态不变，Agent 可重试。`dispatched→running` 边仅做 Atomic Checkout（session 绑定 + max_concurrent_check），不再承载动态校验。

### 8.4 幂等与重放

以 `transitionId` 记录"该转移已执行"。重放命中 `payloadHash` → 返回上次结果，跳过全部 hook（Guard/Gate/Side 都不重跑），杜绝副作用重复（重复解锁/重复通知）。若已推进到下游 → `E_STATE_INVALID`（no-op）。

### 8.5 失败处理

| 类型 | 处理 |
|------|------|
| **Guard/Gate 失败（强一致）** | 返回 `Reject` → 整个转移不写状态、无 transitionId，返回 `accepted:false` + 错误码；Agent 修正后重调 = 全新合法转移，不计 Review/重试轮数 |
| **Side 失败（最终一致）** | 不阻塞转移（状态已提交），进入 `event_outbox`（§11.1 权威真相源）：重试（指数退避，§11.1 `event_retry` 表）、补偿（多次失败走补偿动作）、可观测（记审计展示在 Console，不静默）。**注**：`side_outbox` 是历史概念别名，已统一到 §11.1 `event_outbox`，不另建 `side_outbox` 表 |

## 第 9 章 Agent 运行时与上下文

### 9.1 四层上下文注入

Agent 每次 run 时，平台按四层组装上下文。System Prompt 实际体积上限 = 8500 tokens。

| Layer | 来源 | 注入位置 | Token 预算 | 维护方 |
|-------|------|----------|-----------|--------|
| Layer 1 Workspace Context | `workspaces.context` | System Prompt 最前 | ≤ 500 | Agent Owner |
| Layer 2 Agent Instructions | `agents.instructions` | System Prompt 中间 | ≤ 2000 | Agent Owner |
| Layer 3 Skills | Skills 库（Workspace 级） | Runtime PVC 的 provider 原生 Skill 目录 | 0（按需读取） | 平台内置 + Agent Owner |
| Layer 4 Task Context | 平台签出 Task 后自动组装 | Task 工作目录 `CONTEXT.md` + `.context.json` | ≤ 6000 | 平台自动 |

Layer 1+2 必须保持简洁（≤ 2500 tokens）避免上下文稀释；Layer 3 以文件形式落盘不内联；Layer 4 由平台自动组装无需 Agent Owner 干预。Layer 4 的 token 占用**不计入 Project 计算预算**（平台组装成本不应由 Agent Owner 买单）。

### 9.2 Layer 4 Task Context Schema

单一 JSON 文档落盘为 `CONTEXT.md`（人类可读 Markdown）+ `.context.json`（机器可读 JSON），由 `AssembleTaskContext` 函数产出。8 个 section：`_meta` / `task` / `spec` / `upstream` / `execution_policy` / `team` / `environment` / `budget`。另有 1 个**条件 section**：`failure_report`（M4-patch 补录 2026-08-27，§7.7 四段式注入的 FAILURE REPORT / FIX INSTRUCTION / PREVIOUS ATTEMPT 承载）——仅当 `gate_results.failure_report != null`（Harness 重试态）时出现，插在 `execution_policy` 之后；内容含 `failure_point` / 失败 `gate` + `error_code` + `failures` 明细 / `fix_hint`（修复指令锚）/ `executor_snapshot` / `previous_attempts` / harness 计数。该 section **P1-P7 裁剪豁免**（retry 关键信息不可裁，超预算走 P8 拒绝）。

**Token 预算分配（总 ≤ 6000）**：

| Section | 默认预算 | 说明 |
|---------|---------|------|
| `_meta` | 100 | 固定 |
| `task` | 300 | 标题/描述/AC/依赖摘要 |
| `spec` | 2000 | snippets 注入 + full_spec_ref 引用 |
| `upstream` | 1500 | 最多 3 个上游 Task 产物摘要 |
| `execution_policy` | 400 | stages + harness 状态 |
| `failure_report`（条件） | 典型 ≤300 | 仅 retry 态携带（§7.7 四段式）；P1-P7 裁剪豁免，超预算走 P8 拒绝（M4-patch 补录） |
| `team` | 200 | 仅 team 模式填充 |
| `environment` | 100 | 固定 |
| `budget` | 100 | 固定 |
| 类型专属 section | 见下表 | 因 task_type 而异 |
| **reserve_for_pruning** | **1500** | 裁剪缓冲 |

**6 种 task_type 专属 section**：

| task_type | 专属 section | 预算 | 挤出位置 |
|-----------|--------------|-----|---------|
| bid_analysis | `opportunity` | 2500 | spec=0 + upstream=0 |
| spec_generation | `spec_generation` | 1500 | upstream=0 |
| architecture_design | `architecture_design` | 800 | spec 降至 1500 |
| development | `development` | 600 | spec 降至 1500 |
| testing | `testing` | 600 | upstream 降至 1000 |
| acceptance_review | `acceptance_review` | 800 | upstream 降至 800 |

**裁剪策略 P1-P8**（仅当 total_tokens > 6000 触发，按"对 Agent 影响由低到高"逐级裁剪，每步重算 token，达标即停）：

| 优先级 | 裁剪动作 | 节省 tokens |
|:------:|----------|------------|
| P1 | upstream.comments 仅保留 milestone Task 的 Comment | 200-500 |
| P2 | upstream.artifacts 每个 summary 截断至 100 字符 | 100-300 |
| P3 | spec.snippets 每个 snippet 截断至 500 字符 | 300-800 |
| P4 | upstream.artifacts 仅保留 milestone=true 上游 | 400-800 |
| P5 | spec.snippets 仅保留与 AC 直接匹配的 1 条 | 500-1000 |
| P6 | team.members 仅保留 Leader + 当前 Agent | 100-200 |
| **P7** | **spec.snippets 置空，仅保留 full_spec_ref** | **1500-2500** |
| P8 | 拒绝组装，返回 `context_too_large` 错误（**兜底路径**：Owner 通过 `@Architect-Agent` 在 Task Comment 指派 Architect 协助拆分，或 `create_subtask` 将过载 Task 拆为多个子 Task 后重派；复用现有原语，无需新机制） | — |

裁剪记录写入 `_meta.pruned`，Agent 可通过 `read_task_file` MCP 工具按 `recover_via` 取回完整内容（裁剪 = 延迟加载，不丢信息）。

**组装触发时机**：Agent 签出 Task（checkout 成功）、Harness Loop 重试（attempt_seq+1）、Task 状态转移（review→submit 退回）、Agent 主动 `refresh_context`。Task 完成/取消时不组装。

`task_contexts` 审计表记录每次组装结果（`UNIQUE(task_id, attempt_seq)`）。

### 9.3 Agent 调度与并发控制

**硬闸门 max_concurrent_tasks**：Agent 级硬约束（1-20），不区分 Project。计入口径 = `running` + `in_review` 状态的 Task 数。`in_review` 计入是关键——避免 Agent 把 10 个 Task 丢进审查后又签 10 个新导致驳回时过载。

**带额度判断的 Atomic Checkout**（同一 UPDATE 事务，原子无 TOCTOU）：

```sql
UPDATE project_tasks
SET checkout_agent_id = $agentId, checkout_run_id = $runId,
    execution_run_id = $runId, checkout_at = now(), status = 'running'
WHERE id = $taskId
  AND status = 'dispatched'
  AND (checkout_agent_id IS NULL OR checkout_agent_id = $agentId)
  AND (
    SELECT count(*) FROM project_tasks
    WHERE checkout_agent_id = $agentId AND status IN ('running','in_review')
  ) < (SELECT max_concurrent_tasks FROM agents WHERE id = $agentId)
RETURNING *;
```

**四维加权优先级**（仅用于"额度释放时排序签出"，不抢占已 running 的 Task）：

```
priorityScore = 0.4·criticalPathFactor + 0.3·projectPriority + 0.2·taskPriority + 0.1·slaUrgencyFactor
effectivePriority = priorityScore + min(0.5, waitHours / 48)
```

| 维度 | 取值 | 权重 |
|------|------|------|
| criticalPathFactor | 0.0/1.0（下游有依赖=1.0） | 0.4 |
| projectPriority | 1-5 | 0.3 |
| taskPriority | 1-5（PlanNode 字段） | 0.2 |
| slaUrgencyFactor | 0.0-1.0，`min(1, actual_days/estimated_days - 1)` | 0.1 |

权重在 Workspace Settings 可配。同分 tiebreaker：FIFO → Project 优先级 → nodeId 字典序。

**关键决策**：并发控制在签出时校验（checkout-time gate）不抢占（non-preemptive）；优先级仅排序签出队列；Team Leader 用 `delegate_task` 只改 assignee 不绕过成员 max 校验。

### 9.3.1 Dispatcher（队列调度器）

Dispatcher 是从 queue 选取 Task 并推进到 `ready`/`dispatched` 的平台组件。

**混合调度模型**：
- 事件触发（主）：`task.status_changed` 事件（如上游 Task done 触发依赖解锁）→ 即时评估下游 Task 是否可推进
- 周期扫描（辅）：每 10s 扫描 `queued` 状态 Task，执行 Pre-dispatch 静态校验
- Agent pull（辅）：Agent Runtime 心跳时附带"我有 N 个空闲槽位"，Dispatcher 按四维优先级推送 `ready` Task

**流转逻辑**：
1. `queued → ready`：Pre-dispatch 静态校验通过（Spec 引用有效、上游产出可访问、Skills 模板存在、Plan version 有效）。失败 → substate=`configuration_incomplete`，创建 `task_configuration_blockers` 记录
2. `ready → dispatched`：动态校验通过（Runtime 在线、Skills 绑定、MCP 工具白名单、预算余额）。失败 → 拒绝 checkout（返回 409），Task 状态不变
3. `dispatched → running`：Agent Atomic Checkout（见 §9.3 SQL）

**幂等保证**：每个转移边记录 transitionId，重放命中 payloadHash 直接返回上次结果。

### 9.4 Runtime 生命周期与异常处理

**Runtime 崩溃处理矩阵**：

| 场景 | 处理 |
|------|------|
| Pod 内单个 CLI 进程崩溃 | daemon 的 `handleTask` 捕获 exit code；`shouldRetryWithFreshSession` 判断（resume 失败且 tools==0 → 新 session 重跑；tools>0 → 不重试避免副作用重复）。其他 CLI 不受影响。**零改动**。 |
| Pod 崩溃 → K8s 自动重启 | 10-30s 重建。daemon_id 来自 env 不变 → `agent_runtime` upsert 命中同一行 → session_id/workdir 自动复用。grace period 内恢复则无缝；到期 → sweeper 标 failed → 自动回退 `dispatched` → 重新认领。 |
| Pod 不可恢复（节点故障/PVC 丢失） | 90s 后 offline → 5min grace 到期 → Task failed → 回退 dispatched → K8s 新节点重建 Pod → 挂载同一 PVC 恢复。**PVC 真丢失 = 基础设施故障，应用层不解决**。 |

**离线/grace 时间线**：

```
T=0       心跳停止 → T=90s sweeper 标 offline → 进 grace_period（不立即 fail task）
T=90s~5min30s  daemon 恢复心跳 → runtime online，task 继续
T=5min30s grace 到期 → FailTasksForOfflineRuntimes → Task failed → 自动回退 dispatched → 释放 checkout_run_id 锁 → Pod 重建 → 重新认领
```

**sweeper 常量**：`sweepInterval`=30s、`staleThresholdSeconds`=90、`gracePeriodSeconds`=300、`dispatchTimeoutSeconds`=300、`runningTimeoutSeconds` 不在 sweeper（执行超时由 `deadline_scanner` §10.8 按 `task.estimated_days × 2` 扫描，见 §2.4）、`offlineRuntimeTTLSeconds`=7 天、`queuedTTLSeconds`=2h。

**Janitor 兜底**：Server 内低频 goroutine（每 5min），扫 `ready` 状态实例，发现 Deployment 不存在则重建——兜住带外删除事故。

### 9.5 MCP 工具契约

Agent 与平台交互通过 MCP 工具。**拦截模型落在 MCP 工具 handler**（拒绝即返回，不写状态）。拦截/透传两分法判据 = "是否在关键状态路径上 / 是否影响下游正确性"。

#### 计划类

| 工具 | 用途 | 权限 | 拦截 |
|------|------|------|:---:|
| `submit_plan` | Orchestrator 提交整 DAG 计划 | O | 拦截（DAG 无环/依赖存在/Agent 存在/stage 合法） |
| `submit_plan_update` | 版本化替换计划（整体替换非 diff） | O | 拦截（同上 + 版本号乐观并发） |

#### 审查/交付类

| 工具 | 用途 | 权限 | 拦截 |
|------|------|------|:---:|
| `submit_for_review` | Executor 内部质量门入口（Floor0→1→2） | E | 拦截（Floor1：Comment/Schema/Files） |
| `submit_review_result` | Floor2 退出裁决（pass/fail） | R/T | 拦截（comment 必填+长度） |
| `submit_quality_check_result` | Floor3 Stage B 质检结论提交（G4 Reviewer / G5 Tester 的结构化 gate_output；M4-D4 扩展，drift 登记） | R/T（质检子 Task assignee） | 拦截（task_type=quality_check + running + assignee 校验 + G4/G5 OUTPUT_SCHEMA——schema 不符 = G4/G5_INVALID_OUTPUT fail 回流） |
| `submit_deliverables` | 雇主交付（Project 级 handoff） | O/E | 拦截（前置所有 TaskNode done + Evidence 校验 + revision_limit） |
| `request_changes` | Floor2 驳回改回 Executor | R/T/👤(http) | 拦截（comment 必填+引用 AC） |
| `approve` | Approval Stage 审批签收 | R*/T*/👤(http) | 拦截 |

#### 子任务/委托/依赖/Task DAG 演进类

| 工具 | 用途 | 权限 | 拦截 |
|------|------|------|:---:|
| `create_subtask` | 拆子节点 | O/E | 拦截（环检测 + 依赖存在） |
| `delegate_task` | 委托他人 | O/E | 拦截（target 在线，不绕过成员 max） |
| `add_dependency` / `remove_dependency` | 依赖边增删 | O/E | 拦截（环检测 + 回锁影响） |
| `reopen_task` | 重新打开（回锁） | R/T/👤(http) | 拦截（diff 二次校验） |

#### 升级/协商类

| 工具 | 用途 | 权限 | 拦截 |
|------|------|------|:---:|
| `escalate_to_human` | 升级给人 | O/E/R/T | 拦截（轻，校验确有阻塞） |
| `request_confirmation` | 请求确认（异步非阻塞） | O/E | 透传 |
| `ask_user_questions` | 向人提问（异步非阻塞） | O/E | 透传 |
| `suggest_tasks` | 建议后续任务（记录型） | E/R | 透传 |
| `request_approval` | **Agent 运行时自主请求阻塞式 Owner Approval**（层 3 落地机制，见 §7.4.1） | O/E/R/T | 拦截（强阻塞，影响状态路径：校验 Task 当前 `running` 状态 + execution_policy.stages 动态追加 approvalStage + 写 task_interactions[kind=request_approval] 记录 + Task substate=awaiting_approval） |

**`request_approval` 工具契约**：
- **入参**：`{ task_id, reason, evidence_refs[], requested_stage?: { participant_type?: 'member', participant_id?: uuid } }`（reason 必填，evidence_refs 至少 1 条引用 Comment/产物/Spec 片段）
- **返回**：`{ approval_id, status: 'pending', blocking: true }`（Agent 收到后主动进入等待，平台不再推进 Task）
- **拦截 handler 动作**（原子）：
  1. 校验 Task.status == 'running'（非 running 状态拒绝，返回 `E_STATE_INVALID`）
  2. 校验 reason 非空 + evidence_refs 非空（防空洞请求，返回 `E_VALIDATION`）
  3. 在 `execution_state.stages` 数组末尾 append `{ kind: 'approval', source: 'agent_runtime_request', requested_by: {type:'agent', id: $agentId}, stage_id: 'runtime_approval_'+uuid, participant: requested_stage.participant ?? workspace.owner }`
  4. 插入 `task_interactions` 行（kind=request_approval, status=pending, idempotency_key=task_id+run_id）
  5. Task substate → `awaiting_approval`，触发 Owner 通知（reminder 级，24h 响应窗口）
- **Owner 决策路径**：approve → 走既有 `approve` MCP 工具（§9.5），task_interactions.status=accepted，stages 推进，substate 清空，Task 回 running 继续；reject → 走既有 `request_changes` 同构路径（§9.5），task_interactions.status=rejected，assignee 回 Executor，附 reject Comment + evidence_refs。**runtime-append approvalStage 的 reject 生命周期**（阻断项 A 收尾，消除双重审批循环）：reject 时平台将该 runtime-append stage 在 `execution_state.stages` 数组中标记 `lifecycle='superseded'`（与 `task_interactions.status='superseded'` 枚举一致，复用既有值不新建枚举），并从 effective 推进队列移除——`currentStageIndex` 回退到该 stage 之前最近一个未完成 stage（通常是当前 reviewStage 或 running 态），Task 回 `running` 由 Executor 修正。Executor 修完 resubmit（`running→in_review`）时，Execution Policy 从当前 reviewStage 重新推进，**不会**再次命中已被 superseded 的旧 approvalStage。若 Executor 修正后仍认为需 Owner 审批，须发起新的 `request_approval` 调用——新调用生成全新 stage_id（`runtime_approval_`+新 uuid），`idempotency_key=task_id+run_id`（同 run 内重复调用命中 UNIQUE 约束返回既有 approval_id，防重复；新 run 生成新 key 即新 stage），旧 superseded stage 永不复活。
- **超时**：默认 24h；层 3 内部门 auto-approve（quality_tier='excellent' 的 Agent 请求可降至 4h auto-approve 强化 P1 自主性）；层 1 契约门 escalate（不 auto-approve）。超时 auto-approve 时 stage 标 `lifecycle='auto_approved'`（推进完成）；超时 escalate 时 stage 标 `lifecycle='escalated'` 并冻结，由 §10.8 `deadline_scanner` 统一翻转（见 §10.8）。所有终态 stage（completed/superseded/auto_approved/escalated）均从 effective 推进队列移除，不阻塞后续推进。
- **可被任何角色 Agent 调用**（O/E/R/T，非仅 Orchestrator）——强化 P1 Agent 一等公民：Tester 觉得测试结果关键可请求 Owner 确认，Reviewer 觉得审查发现影响重大可请求 Owner 介入，Dev 觉得架构决策需 Owner 拍板可请求审批

#### 文档协作类

| 工具 | 用途 | 拦截 |
|------|------|:---:|
| `create_or_get_document` | 创建/获取文档 | 透传 |
| `update_document` | 更新文档（持锁免版本号，否则需 expectedVersion） | 透传（冲突 → E_CONFLICT/E_LOCKED） |
| `lock_document` / `unlock_document` | 加/解锁文档 | 透传 |
| `create_branch` / `request_merge` / `merge_branch` / `reject_merge` | Spec 类文档分支合并 | merge_branch 轻拦截 |

#### 注释/产物类

| 工具 | 用途 | 权限 | 拦截 |
|------|------|------|:---:|
| `create_annotation_thread` | Reviewer 标注注解线程 | R | 透传 |
| `publish_artifact` | 发布产物 | E | 拦截（Evidence 校验文件存在） |
| `list_artifacts` / `get_artifact` | 列出/获取产物 | O/E/R/T | 透传 |

> **勘误（M4-patch-runner-artifact-publish 2026-08-27 补注）**：`publish_artifact` 是**两条注册通道之一**。通道 1 = 上表 MCP 工具（Agent 直调，executor 自注册）；通道 2 = **daemon HTTP publish 端点**（`POST /api/daemon/artifacts`，multipart 内容上传——真实 daemon 模式下 executor 的 workdir 与 server 文件系统隔离，MCP 通道物理不可达，故由 runner 在 complete 前经此端点代注册）。两通道语义等价：产物注册后 Floor1 deliverable-existence 校验（§7.3 item 3）对 project-bound 任务生效。runner 注册时序：execute → collect workdir deliverables → daemon publish（project-bound）→ complete → submit-review。
>
> **补注（M4 治理第二批 2026-08-28，D-05 Replay 陈旧性修复）**：daemon 面失败 run 的注册行随 `FailCSITaskRun` 清除（`created_by_run_id = run` 谓词的删除，handler fail 上报与 sweeper grace 失败链两处接线）——失败 run 的产物注册是失败尝试的中间态记录，回滚后 harness 重试 run 对同 (task, path) 的再发布走全新 insert+重传（内容新鲜），消除"replay 返回失败 run 旧对象、新内容不达 storage"的窄窗口；MCP 通道的幂等 replay 契约不受影响（其 `created_by_run_id` 为 NULL，不在删除谓词内）。超时路径同款回滚（M4-patch-timeout-artifact-rollback 2026-08-28）：`deadline_scanner` 将 run 翻 `timed_out` 后（含 salvage 面对存量 timed_out 行的收敛）同样清除该 run 的注册行——接线于 fresh-expiry 与 salvage 双通道汇合点（`failTaskAfterRunTimeout`），删除幂等，超时即失败的一种，语义与 `FailCSITaskRun` 面完全一致。

#### 进度类

| 工具 | 用途 | 权限 | 拦截 |
|------|------|------|:---:|
| `report_progress` | 进度上报 | E | 透传 |

#### 上下文类（M4-D2 补，勘误登记 R13② 裁决落地）

> 勘误记录：§9.2 原文引用 `refresh_context`（L1211 组装触发时机）与 `read_task_file`（L1209 裁剪取回）但本表未收录；mcp-tools-spec.md（附录 D.2 #9 来源文档）全文核对亦无此二工具（2026-08-25 三步交叉法验证）。裁决：**补工具契约**（不改机制——四时机含"Agent 主动 refresh_context"已是 parent prd R2 已裁决项）。来源：M4-D2 task（`.trellis/tasks/08-24-m4-d2-task-context/design.md` §7）。

| 工具 | 用途 | 权限 | 拦截 |
|------|------|------|:---:|
| `refresh_context` | Agent 主动请求重新组装 Task Context（§9.2 组装触发时机之四；返回新 `CONTEXT.md`/`.context.json`，attempt_seq+1 落审计行；终态 Task 拒绝 `E_STATE_INVALID`；超限返回 `context_too_large`） | O/E/R/T | 透传（不写任务状态；组装副作用=审计行） |
| `read_task_file` | 读取 Task Context 文件（`CONTEXT.md`/`.context.json`）或按 step id 取回 P1-P7 被裁剪完整内容（`recover_via` 通道；从 `task_contexts` 审计行读取，形态无关） | O/E/R/T | 透传 |

**两工具 inputSchema**（JSON Schema，G5 强校验）：

```json
{
  "refresh_context": {
    "type": "object",
    "properties": {
      "task_id": {"type": "string", "format": "uuid"},
      "reason":  {"type": "string"}
    },
    "required": ["task_id"]
  },
  "read_task_file": {
    "type": "object",
    "properties": {
      "task_id":     {"type": "string", "format": "uuid"},
      "attempt_seq": {"type": "integer", "description": "组装序号；缺省取最新审计行"},
      "file":        {"type": "string", "enum": ["CONTEXT.md", ".context.json"], "description": "缺省 CONTEXT.md"},
      "step":        {"type": "string", "pattern": "^P[1-7]$", "description": "被裁剪步骤 id，命中返回 full_content"}
    },
    "required": ["task_id"]
  }
}
```

**全局约定**：G1 拦截即 handler（拒绝不写状态）；G2 全局幂等（Write 类隐式幂等）；G3 异步问询不阻塞会话；G4 角色即注入工具集，handler 二次断言身份；G5 inputSchema 用 JSON Schema 强校验。

**权限角色**：O=Orchestrator、E=Executor、R=Reviewer、T=Tester、👤=Owner/Employer（走 Console 非 MCP）。

---

## 第 10 章 编排与监控

### 10.1 Orchestrator 角色（AI PM）

**Orchestrator 是 AI 项目经理，不是 Plan 生成器**。它制定项目阶段计划、安排各角色执行、跟踪进展与风险、协调资源、在阻塞时升级给 Human。按 需求分析→架构设计→测试用例→开发执行→集成验收 完整项目阶段组织团队协作，而非直接从 Spec 跳到开发 Task。

### 10.2 SOP 模板库与 Plan 生成

**SOP 模板以 Skill 文件形式存在**，按 Marketplace 类目组织，6 大类：软件开发、商业咨询、数据分析、设计创意、内容创作、AI/ML。平台提供内置库，Agent Owner 可自定义并优先匹配。

**模板内部结构**（以 `sop-enterprise-app` 为例）：适用类目 + 适用条件 + 6 阶段（需求分析→PRD / 架构设计 / 测试用例设计 / 开发执行 / 集成测试与验收 / 交付）+ 每阶段字段（负责人角色、前置条件、产出物、参与者、评审门、预估工期公式、并行度）。

**SOP 模板字段映射到 Execution Policy**（层 2 落地规则，详见 §7.4 三层 Approval 配置）：

| SOP 模板字段 | Execution Policy 落地 | Plan 生成时动作 |
|-------------|---------------------|---------------|
| `评审门.技术评审` (必须/可选/无) | reviewStage（participant=声明角色） | 必须/可选 → Plan 中该阶段 Task 的 execution_policy.stages 注入 reviewStage；无 → 不注入 |
| `评审门.最终审批` (必须/可选/无) | approvalStage（currentParticipant=Owner） | 必须 → 注入 approvalStage（层 2 SOP 必设）；可选 → 不注入（层 3 Agent 可运行时 `request_approval` 自主请求）；无 → 不注入 |
| `评审门.覆盖评审` (必须/可选/无) | reviewStage（participant=声明角色，可与技术评审并存） | 同上，多 reviewer 并存时 stages 数组追加多个 reviewStage 元素 |

**映射规则**：
- "必须" → Plan 提交时平台按 SOP 模板自动展开到 execution_policy.stages，Orchestrator 不可省略
- "可选" → 不强制注入；Agent 在 running 状态可调 `request_approval`（层 3）自主请求追加 approvalStage
- "无" → 不注入；Agent 也不可绕过层 1 契约门

**跨 SOP 模板差异示例**：同一 PRD Task，在 `sop-enterprise-app`（企业应用）模板中"最终审批=必须"（Owner 审批 PRD）；在 `sop-market-research`（市场调研）模板中"最终审批=可选"（分析师自主决策，Owner 仅在 Agent 主动请求时介入）。这是层 2 SOP 灵活配置的体现，避免"所有 project 类型一刀切必设 Approval"。

**SOP 模板质量门配置项**（层 2 落地，G5/harness 可配，避免 coding 类复杂场景频繁硬失败）：

| SOP 模板字段 | 落地 | 默认值 | Plan 生成时动作 |
|-------------|------|--------|---------------|
| `质量门.pass_threshold` | G5 pass_rate 阈值（§7.5） | **0.95**（取代原硬编码 1.0） | Plan 中 testing/acceptance_review 类 Task 的 execution_policy.gate_config 注入 pass_threshold；Tester Agent 执行时读取此值 |
| `质量门.harness_max_attempts` | Floor 3 Gate 重试上限（§7.7） | **4**（中等复杂度默认） | Plan 中所有 Task 的 execution_policy.harness 注入 max_attempts；按 Task 复杂度可声明不同值 |
| `质量门.complexity_hint` | Task 复杂度提示（简单/中等/复杂） | 中等 | Plan 生成时按 SOP 模板阶段声明，驱动 harness_max_attempts 默认值（简单=2 / 中等=4 / 复杂=6） |

**配置示例**：`sop-enterprise-app`（企业应用，含集成测试）→ `pass_threshold=0.95, harness_max_attempts=6, complexity_hint=复杂`（容忍 flaky test + 长收敛链）；`sop-market-research`（市场调研，无测试套件）→ `pass_threshold` 不适用（无 G5），`harness_max_attempts=2, complexity_hint=简单`（调研报告类 Task 失败多为方向偏差，2 次不收敛即 escalate）。Agent Owner 在 Plan 审批时确认这些值，Agent 执行中不可调整。

**Plan 节点 execution_policy 声明词汇表**（plan→policy 物化注入通道，M4-patch 补录 2026-08-27）：Orchestrator 提交 Plan 时每个节点可声明以下 execution_policy 字段，平台物化为 child Task 行时全量注入（SOP 层 2 注入与节点声明合并，"必须"级 stage 不可省略）：

| 字段 | 形状 | 语义 |
|------|------|------|
| `milestone` | bool | 里程碑标记——Floor2 通过后交接 Floor3 Evidence Gates（§7.5.1）；plan 节点声明面（此前仅运行时写入） |
| `gate_config` | 顶层 agent 键 + 门键对象混合形 | 里程碑节点的门配置：顶层键 `reviewer_agent_id`（G4 质检 Agent，UUID string）/ `tester_agent_id`（G5 质检 Agent，UUID string）——`resolveGateAgent` 消费面（无声明时回退 Floor2 review stage participant）；门键对象 `G5: {pass_threshold, skip_if_passed}`——`readGateConfig` 消费面（pass_threshold 为 SOP/声明值物化的消费投影；skip_if_passed 见 §7.5.4 复用声明） |
| `complexity_hint` | 简单/中等/复杂 | SOP 模板按 category 注入（§10.2 质量门表），驱动 harness_max_attempts 默认值（简单=2 / 中等=4 / 复杂=6） |
| `harness_max_attempts` | int | 重试上限；解析优先级=节点覆盖 > SOP 值 > complexity 默认（§10.2）；物化时**同点原子双写**——JSONB flat 键（声明快照）+ `issue.harness_max_attempts` 列（Floor3 计数消费面，见 §3.3 投影注） |
| `pass_threshold` | float | 声明快照落 JSONB flat 键，物化同点投影至 `gate_config.G5.pass_threshold`（Floor3 `readGateConfig` 唯一消费面）；仅 testing / acceptance_review 类节点注入 |

**known_failures 机制**（G5_OUTPUT_SCHEMA 扩展，§7.5）：Tester Agent 在 G5 质检 Task 产出中可标注 `known_failures` 数组（每项含 `test_name` / `reason` / `risk_assessment`），平台校验 pass_rate 时将 known_failures 从分母剔除——`pass_rate = passed / (total - known_failures_count)`。known_failures 需附风险评估（低/中/高），高风险 known_failures 不计入分母（仍算 fail），低/中风险可豁免。这解决 flaky test 偶发失败导致 G5 fail → Harness 耗尽 → escalate 的连锁硬失败。

**5 步匹配与定制化**：
1. 读取输入：Project.category + Spec 全文 + Workspace Context（Agent/Team + 已安装 SOP Skills）
2. 匹配 SOP 模板：按 category 精确匹配 → Spec 特征筛选 → 无匹配取父类目或通用方法论推理
3. 检查 Workspace 能力：对照 SOP 所需角色核对 Agent 是否存在；缺失时标注"需要创建/兼任"
4. Spec 驱动定制化：需求数 × 0.3 天估 PRD 工期、验收标准数 × 0.08 天估测试用例工期、Spec 特殊要求增加子步骤、校验总工期 vs Spec 交付期
5. 生成定制化项目计划：调用 `submit_plan` → 平台校验 → Agent Owner 审批

**关键决策**：阶段 4 的开发 Task 列表**不在初始 Plan 中生成**（此时未做架构设计，不知模块依赖；PRD 尚未锁定）。阶段 4 DAG 通过 `submit_plan_update` 在阶段 2 完成后做第二次 Plan 细化（Agent Owner 二次审批）。

**Plan v2 reconcile 语义**（`submit_plan_update` 提交时已有 Task 的迁移规则，最小迁移策略）：
- **已 running/in_review 的 v1 Task**：**保留**，不中断当前执行（已在执行的 Task 强行取消会造成 WIP 损失）
- **已 queued/ready 的 v1 Task**：**取消**（status → skipped），由 v2 Plan 中对应的新 Task 替代（尚未被认领，无 WIP 损失）
- **v2 新增 Task**：正常进队列，依赖自动解锁机制驱动
- **修改 v1 Task 的处理**：不精确 reconcile（不原地修改 v1 Task 的 spec/acceptance_criteria），走"v2 新增引用型 Task + reopen 回锁"路径——v2 中新建一个 Task 引用 v1 Task 的产出，v1 Task 如已 done 则 reopen 并触发 `reopen_backlock`（§8.3 `done→reopened` 边）。这避免在 Plan 层做复杂的 Task diff/merge，复用既有 reopen 机制兜底
- **不做精确 reconcile 的理由**：Plan v2 提交是低频事件（每 Project 1-2 次），精确 reconcile 需 Task 级 diff 引擎，违反 P4（不引入编排引擎）；最小迁移 + reopen 回锁兜底已满足业务需求

### 10.3 持续监控（三源唤醒 + SLA+活性双判据）

Orchestrator **不是常驻进程轮询**，而是"被反复唤醒 + 上下文注入"。每次唤醒读 Project 看板、阶段 SLA 状态、最近 transitions，判断正常/卡顿/阻塞。

**三源归一唤醒**：

| 源 | 说明 |
|---|---|
| 事件驱动（主源） | interceptor Side hook 在转移提交后注入，仅注入"对节奏有意义的转移"：running→in_review、in_review→done、in_review→running、done→reopened、any→blocked、dispatched→failed、阶段里程碑。不为 report_progress/Comment 新增唤醒。 |
| 定时巡检（辅源） | 默认每 4h（可配），平台确定性代码执行扫描。正常仅刷新 Dashboard 快照不打扰 Orchestrator，异常才注入 wake。检测无 transition 但超 SLA 的阶段、长时间无 Comment/progress 的活跃节点。 |
| @mention（兜底） | Owner 或 Agent 在 Comment `@Orchestrator-Agent` → 注入 wake。 |

**卡顿判定（SLA + 活性双判据）**：

宏观 SLA 判据（`actual_days = now - phase_started_at` vs `estimated_days`）：

| 实际工期 vs 估算 | 状态 | 触发动作 |
|---|---|---|
| `actual ≤ estimated` | 绿 | 无 |
| `estimated < actual ≤ 1.3 × estimated` | 黄 | 巡检注入 wake |
| `1.3 × estimated < actual ≤ 1.5 × estimated` | 橙 | 强制注入 wake + Owner 看板标橙 |
| `actual > 1.5 × estimated` | 红 | 强制注入 wake + Owner 通知 + Orchestrator 必须在 Comment 记录处置 |

微观活性判据：活跃节点无 transition 6h / 无 Comment 12h / 无 report_progress 6h / in_review 无人认领 24h / blocked 持续 48h。

组合判定（任一命中即标记"卡顿"）：SLA 红区 / 阶段内有节点命中活性红线 / 阶段内 blocked 节点占比 > 40%。

活性判定**完全由平台确定性代码执行**（不跑 LLM），结果作为 wake 的 `reason` 字段注入。

### 10.4 协调动作分级（L1-L4，全部走 Comment @mention）

| 级别 | 触发条件 | 动作 | 落地 |
|---|---|---|---|
| L1 催办 | 黄/橙区，活性异常 | @mention 责任 Agent 询问进展 | Comment on 责任节点 |
| L2 协调 | 跨节点依赖卡顿 | @mention 上游推进 + 通知下游等待 | Comment on 相关节点 |
| L3 升级 Owner | 红区 / blocked 48h / Agent 无响应 | @mention Agent Owner 请求介入 | Comment on Project 主 Task |
| L4 阻塞 | 无法自动恢复 | `escalate_to_human` | 节点 → blocked |

**关键约束**：Orchestrator 不能修改责任 Agent 的 Task 状态（不代为 submit_for_review/approve）；不能重新分配 Task（delegate_task 需 Owner 同意）；催办 Comment 限频（同节点同原因 24h 内最多 1 条）。

### 10.5 Project Watchdog（Project 级兜底）

Watchdog 是**最后的 Project 级兜底机制**。所有单 Task 级机制（Liveness/Stranded/Pre-dispatch/Floor 2/Harness）都在它之前触发。

**检测对象**：Project 级（而非子树）。

**单 Task stalled 判定**（6 个 live path 全不满足才 stalled）：active run / queued retry / pending review 未超时 / pending approval 未超时 / pending interaction / configuration_incomplete（不算 stalled，避免与 pre-dispatch 重复）。

**Project stalled 判定**："所有非 done Task 都 stalled" 才触发。单 Task stalled 由 Liveness/Stranded 处理，Watchdog 只关心"全停滞"。

**fingerprint 抑制**：对每个 stalled Task 计算 stall_snapshot，Project 级 fingerprint = SHA256(JSON.stringify({project_id, project_status, stalled_count, snapshot_time_minute, snapshots_sortedBy_task_id}))。current_fp == last_fp → 抑制告警；不同 → 触发告警并保存 diff。snapshot_time_minute 口径（R13.4③ D6 勘误登记）：取 stalled 集内 MAX(last_status_change_at) 的分钟截断——状态派生锚而非扫描时钟，保证同状态未变时抑制生效（research/project-watchdog-spec.md §7.3 示例语义）。

**分层响应（不自动修复）**：

| Tier | 持续时间 | 动作 | 通知 |
|---|---|---|---|
| Tier 1 | 1×N（默认 60min） | 通知 Agent Owner | Console Inbox + Email |
| Tier 2 | 3×N（默认 180min） | 创建 watchdog_inspection Task 给 Orchestrator | priority=high |
| Tier 3 | 6×N（默认 360min）或 Orchestrator 无法解决 | 创建 watchdog_inspection Task 给 Agent Owner (Human) | priority=urgent，SMS |

**不自动修复的原因**：停滞原因多样（Spec 缺陷/Agent 失败循环/Reviewer 失联/预算耗尽/上游反复 reopen），误判代价高。与 Paperclip 原则一致（保持所有权，重试一次，显式标记，通知 Human）。

`watchdog_inspection` Task 权限：可读所有 stalled Task 详情/Plan/Spec；可 Comment + @mention；**不能直接修改 stalled Task 状态、不能修改 Spec/Plan**。

### 10.7 Goal Mode（目标模式）

Goal Mode 允许 Agent 在 Spec 范围外自主探索优化（如重构、性能调优、体验增强），但有严格边界。

**触发**：Agent 在 Task 执行中通过 `suggest_tasks` 建议额外工作，或 Orchestrator 识别到优化机会，标记 Task 为 `goal_mode=true`。

**20% 工时阈值**：累计 Goal Mode Task 的 `actual_effort_hours` ÷ `projects.estimated_total_effort` > 20% 时触发阈值。
- 计算时机：每个 Goal Mode Task done 时累加并检查
- 字段：`projects.goal_mode_extra_effort`（累计 Goal Mode 工时）

**达阈处理**：
1. Project 保持 `executing` 状态（不暂停整个 Project）
2. 所有 `goal_mode=true` 且未 done 的 Task 自动暂停（status → blocked，substate = goal_mode_threshold）
3. 通知 Agent Owner 审批（reminder 级，24h 响应窗口）

**Owner 决策**：
- **批准继续**：`goal_mode_extra_effort` 重置为 0，暂停的 Task 恢复 → `ready`，继续累积
- **停止**：暂停的 Task → `skipped`，后续 Goal Mode Task 不再创建，回到 Spec 范围
- **超时 auto-approve**（内部门策略，§7.4 层 2/3 + §15.1 Owner 离线统一策略）：24h 响应窗口超时 → 默认 auto-approve（批准继续），`goal_mode_extra_effort` 重置为 0，暂停的 Task 恢复。Goal Mode 属内部门（非契约门），Owner 失联时不 escalate 而 auto-approve，强化 Agent 主导（P1）。Owner 恢复后可随时调 `escalate_to_human` 回滚 Goal Mode Task

**验收边界**：Goal Mode Task 的产出**不计入验收标准**（G1 需求覆盖、G2 验收标准验证仅校验 Spec 范围内 Task）。Goal Mode 成果作为 phase_output 类 artifact 保留。

### 10.6 Orchestrator 离线兜底

**平台兜底不换主体**（DR-05）：

- **Runtime 离线**（心跳丢失 > 90s）：Wake Queue 持续累积（TTL 7 天），平台启动兜底监控（确定性代码复用卡顿判定规则），命中红区/blocked 48h/failed 直接 @mention Owner（绕过 Orchestrator）。**不转交给另一个 Agent 充当 Orchestrator**（避免双项目经理冲突）。恢复后累积 wake 按时间顺序消费（合并同原因）。
- **Orchestrator 忙碌**（达 max_concurrent_tasks）：唤醒排队，按优先级消费，监控延迟但不丢失。监控类 wake 占用并发槽与 Plan 生成 Task 共享配额。

**Wake Queue 物理载体** = `agent_wakeup_requests` 表（R13③ D6 裁决定案：TTL 7 天经 `expires_at`、超期翻 stale、按优先级+时间序消费、同原因合并消费为编排监控 Task）。

**兜底期间语义保证**：卡顿不漏报 / 不重复处置 / 不状态冲突 / wake 不丢失（TTL 7 天，超期标记 stale，恢复后只看最新快照）。

### 10.8 超时调度组件（统一 deadline 扫描器）

> **职责单一真相**：全篇所有"X 小时超时自动 Y"动作统一由 `deadline_scanner` 承载。该组件是 P3 平台强制执行在超时路径上的代码主体；不在 §15.4 表格的"超时后果"列、§7.4.1 超时策略、§10.7 Goal Mode、§9.3.1 Pre-dispatch、§6.2 Spec 变更等任何单点落地——所有这些都只是 `deadline_scanner` 的扫描对象。

**组件契约**：

| 字段 | 值 |
|------|----|
| 名称 | `deadline_scanner`（Go 长跑 goroutine，复用 Server 进程，不引入新 worker 部署） |
| 扫描频率 | 每 60s 一轮（常量 `deadlineScanIntervalSeconds=60`） |
| 扫描对象 | `task_interactions`、`spec_change_requests`、`task_configuration_blockers`、`projects`（revision_negotiation）、`agent_runs`（执行超时）、`budget_incidents`（Owner 三选一超时）、`projects`（in_accept 雇主催办，item 8 M5-A2 裁决落地） |
| 幂等保证 | 每个扫描对象表按下方"字段映射表"适配 `deadline` / `resolved` / `status` 字段；扫描 SQL 按映射表条件，UPDATE 时带乐观锁版本号 |
| 到期动作 | 翻转 `task_interactions.status` / 推进 `execution_state.stages` / 恢复 Task / 升级通知；每条动作写 `activity_log` + `transition_records` |

**扫描对象字段映射表**（M0.5 修正）：7 个扫描对象的字段命名采用混合策略——新表用 `deadline_at`，已有语义化命名的表保留原名（`classification_deadline` / `revision_negotiation_deadline` / `execution_deadline_at` / `created_at` 偏移）。扫描 SQL 不再"一律"，按下表逐项适配：

| # | 扫描对象 | deadline 字段 | resolved 字段 | status 字段 | status 待扫值 | 完整 SQL 条件 |
|---|---------|--------------|--------------|------------|-------------|-------------|
| 1 | `task_interactions` (kind=request_approval) | `deadline_at` | `resolved_at` | `status` | `pending` | `kind='request_approval' AND status='pending' AND deadline_at < now() AND resolved_at IS NULL` |
| 2 | `task_interactions` (kind=mention/question) | `deadline_at` | `resolved_at` | `status` | `pending` | `kind IN ('mention','question') AND status='pending' AND deadline_at < now() AND resolved_at IS NULL` |
| 3 | `spec_change_requests` | `classification_deadline` | `resolved_at` | `status` | `pending` | `status='pending' AND classification_deadline < now() AND resolved_at IS NULL` |
| 4 | `task_configuration_blockers` | `deadline_at` | `resolved_at` | （无，用 `resolved_at IS NULL`） | — | `resolved_at IS NULL AND deadline_at < now()` |
| 5 | `projects` (revision_negotiation) | `revision_negotiation_deadline` | （无，用 `status`） | `status` | `revision_negotiation` | `status='revision_negotiation' AND revision_negotiation_deadline < now()` |
| 6 | `agent_runs` | `execution_deadline_at` | （无，用 `status`） | `status` | `running` | `status='running' AND execution_deadline_at < now()` |
| 7 | `budget_incidents` | （无，用 `created_at` 72h 偏移） | `resolved_at` | `status` | `active` | `incident_type='budget_exceeded' AND status='active' AND created_at < now() - INTERVAL '72 hours'` |
| 8 | `projects` (in_accept 雇主催办，M5-A2 design D2 裁决落地) | （无，用 `delivered_at` + 天数偏移，elapsed ≥ offset 补发语义） | （无，用 `employer_reminder_days_sent` 幂等数组） | `status` | `in_accept` | `status='in_accept' AND delivered_at IS NOT NULL AND order_id IS NOT NULL` | 第 5/9/13 天（`CSI_ACCEPTANCE_REMINDER_DAYS` 可配）经 #9 employer-mentions 通道提醒雇主（§11.3 `employer.reminder`）；先 push 后记列（at-least-once）|
| 3b | `spec_change_requests` (employer_rejected 24h 协商窗，M5-A4 design D4/D14 裁决落地) | `negotiation_deadline`（999440） | `resolved_at` | `status` | `employer_rejected` | `status='employer_rejected' AND negotiation_deadline < now() AND resolved_at IS NULL` | 翻行级 `resolution=escalated_to_dispute`；**Project 状态机不动**（dispute 入口权威归场景十 #39，行态是 A6 可消费信号）；NULL-deadline 行结构性出集 |

**扫描对象 SQL 与到期动作清单**（7 处超时全部挂在此处）：

| # | 扫描对象 | SQL 条件（WHERE 子句） | 到期动作 |
|---|---------|----------------------|----------|
| 1 | `task_interactions` (kind=request_approval) | `kind='request_approval' AND status='pending' AND deadline_at < now() AND resolved_at IS NULL` | 翻 `status=auto_approved`（内部门）或 `status=escalated`（契约门，§7.4.1）；推进 `execution_state.stages` 对应 stage.lifecycle=`auto_approved`/`escalated`；Task substate 清空回 running（auto_approved）或触发契约门 escalate 流程（escalated） |
| 2 | `task_interactions` (kind=mention/question) | `kind IN ('mention','question') AND status='pending' AND deadline_at < now() AND resolved_at IS NULL`（4h SLA） | 翻 `status=escalated`；@mention Reviewer 升级（如 Plan Reviewer → Owner → 平台管理员逐级） |
| 3 | `spec_change_requests` | `status='pending' AND classification_deadline < now() AND resolved_at IS NULL`（24h） | 翻 `status=timeout_escalated`（resolved_at 保持 NULL——classify CAS 接受 timeout_escalated 作解冻输入，item 1 契约门同构）；urgent 通知 Agent Owner + #9 通道通告雇主（M5-A4 落地注记）；**7 天 Owner 无响应兜底走 §6.3 既有 spec.timeout→#33 通道（M 侧计时）** |
| 3b | `spec_change_requests` (employer_rejected) | `status='employer_rejected' AND negotiation_deadline < now() AND resolved_at IS NULL`（24h 协商窗，M5-A4 D4 裁决落地） | 翻行级 `resolution=escalated_to_dispute` + 通知；Project 状态机不动（dispute 入口权威归 #39/A6） |
| 4 | `task_configuration_blockers` | `resolved_at IS NULL AND deadline_at < now()`（24h） | 翻 `status=escalated`；@mention Plan Owner + Agent Owner 升级为 urgent 通知；若 48h 再超时 → Task 标 `failed` 走 Harness |
| 5 | `projects` (revision_negotiation) | `status='revision_negotiation' AND revision_negotiation_deadline < now()` | 默认执行 C 选项（接受当前）→ Project 状态 `revision_negotiation→completed_pending_appeal`；写 `revision_negotiation_decisions(decision=auto_accepted_c)` |
| 6 | `agent_runs` (执行超时，口径决策见 §2.4 / §9.4) | `status='running' AND execution_deadline_at < now()` | 2× terminate（PRD §9.2 强制口径，§2.4 已决策对齐，CSI 长任务经 `estimated_days` 配置阈值而非关闭超时）→ 翻 `agent_runs.status=timed_out` → Task status=failed → Harness Loop |
| 7 | `budget_incidents` (Owner 三选一 72h 超时) | `incident_type='budget_exceeded' AND status='active' AND created_at < now() - INTERVAL '72 hours'`（Owner 三选一超时） | 翻 `status=escalated`；urgent 通知平台管理员介入；Project 保持 `budget_paused`（不自动放弃，需人工裁定） |

**与已有组件的边界**：
- `sweeper`（§9.4）只管 Runtime 心跳离线（30s 间隔），不管 interaction/approval 超时
- `watchdog`（§10.5）只管 Project 整体停滞（10min 间隔），不管单个 interaction 超时
- `DeliveryWorker`（§11.4）只管通知投递，不管状态翻转
- `Janitor`（§9.4）只管 Runtime Pod 重建兜底
- `budget_scanner`（§3.2）复用本组件基础设施但以独立 10min 频率做预算**阈值检测**（80% 告警 / 100% 触发 `executing→budget_paused`），非 deadline 动作，不在上表；上表 item 7 仅承载 Owner 三选一 72h 超时
- **`deadline_scanner` 是 interaction/approval/budget 超时状态翻转的唯一执行者**，不与上述组件重叠

**失败处理**：扫描失败（DB 错误等）→ 写 `watchdog_logs` critical 告警 → 平台运维介入；单条扫描对象处理失败不影响其他对象（隔离 + 重试 + 死信告警）。

---

## 第 11 章 事件驱动与通知

### 11.1 事件机制（LISTEN/NOTIFY + Outbox）

**机制选型**：PostgreSQL LISTEN/NOTIFY + Outbox Pattern。复用 Multica 现有 PG/sqlc，零新组件，at-least-once + 幂等。**不是事件总线**——轻量约定，无 topic 管理、无消息排序保证，仅 CSI 单进程内模块解耦。

**权威真相源**：`event_outbox` 表。事件先写入 outbox（与业务写同事务提交），保证"事件绝不丢失"。

**即时 vs 兜底**：LISTEN/NOTIFY（低延迟最优路径）+ outbox 轮询（必达兜底，每 5s 扫 `published_at IS NULL`）。

**投递语义**：at-least-once + `event_handled` 幂等账本（per handler × event）。处理器必须幂等，重入命中直接返回。

**调度**：状态转移同步，善后 Side 异步。改状态同步；状态变更后的善后异步。

**失败重试**：指数退避（5s/30s/2m/10m/1h，最多 5 次）+ 死信告警。重试载体是 `event_retry` 表，不靠 `published_at`。

### 11.2 事件类型清单（19 类）

| 事件类型 | 触发 | 处理者 |
|---------|------|--------|
| `task.status_changed` | TaskNode 状态转移后 | deps_unlock / Routine / Gate / Compliance / Notifier |
| `comment.created` | 新 Comment 落库 | Notifier / Agent 唤醒 |
| `mention.created` | Comment 内 @mention | Notifier |
| `routine.step_completed` | Routine Step N 全部 Task Node done | Routine 推进建 Step N+1 Task |
| `gate.check_needed` | 里程碑 Task 全部 Execution Policy 通过 | Evidence Gate 校验 G1..G6 |
| `liveness.check_due` | 定时器扫描到 running 超时无心跳 | 合规/告警/回滚 |
| `budget.threshold_reached` | Task 预算消耗达阈值 | 告警/暂停/通知 Owner |
| `inbox.item_created` | 用户级收件箱条目生成 | WebSocket 推送（UI） |
| `opportunity.created` | 商机创建后 | Bidding Routine 推进 |
| `project.created` | Project 创建后 | Signing Routine 推进 |
| `project.status_changed` | Project 状态转移后 | Notifier / Dashboard 更新 |
| `plan.submitted` / `plan.approved` | Plan 提交/审批后 | Orchestrator wake |
| `task.approval_requested` | Floor2 review pass 物化 approvalStage（非转移边，§7.4） | Notifier（审批参与者）/ 审计 |
| `task.gate_running` | 里程碑 Task Floor2→Floor3 交接（substate=gate_running，§7.5.1） | Floor3 Evidence Gates（D4 消费）/ 审计 |
| `task.review_recheck_requested` | 层 2 静态 approvalStage reject 回退 Reviewer 复审（§7.4.1） | Notifier（Reviewer）/ 审计 |
| `task.suspicious_submit` | Layer B 时间间隔检测命中（checkout→submit < 30s，§7.8） | 质量档案统计 / 审计 |
| `quality.quick_reject_streak` | Layer B 快速驳回模式检测命中（§7.8） | Owner 通知（建议 Approval Stage）/ 审计 |
| `quality.shallow_approval_streak` | Layer B 空洞 approve 连续 3 次（§7.8） | Owner 通知（建议 Approval Stage）/ 审计 |
| `quality.low_effort_retry` | Layer B 低质量重试检测命中（变更量递减，§7.8） | 立即 escalate / 审计 |

**事件命名规范**：`{domain}.{action_past_tense}`（事实陈述类）；定时触发信号类用 `_needed`/`_due`/`_reached`。

**命名一致性说明**：§11.3 通知级事件和 §11.6 审计日志使用业务语义命名（如 `task.completed`、`project.created`），本质是 `task.status_changed`（to=done）和 `project.status_changed` 的语义化别名，handler 路由时归并处理。

**事件触发时机铁律**：仅在 interceptor transition 提交点之后（Guard/Gate 全过、状态已写、transitionId 已落）发出；失败/被拒转移不发事件。

### 11.3 通知分级（info / reminder / urgent）

| 级别 | 渠道 | 接收者 | 语义 |
|------|------|--------|------|
| **信息级** `info` | Inbox | Agent Owner | 知晓即可 |
| **提醒级** `reminder` | Inbox + 邮件 | Agent Owner / 雇主 | 需在 SLA 内行动 |
| **紧急级** `urgent` | Inbox + 邮件 + App Push | Agent Owner | 需立即行动，否则自动触发后果 |

**信息级事件**：opportunity.delivered、opportunity.bid_result、project.status_changed、task.completed、task.checkout、comment.received。

**提醒级事件**：spec.employer_confirmation_required（7天）、human_approval.pending（24h）、employer.reminder（5/9/13天）、spec.clarification_needed（48h/轮）、budget.alert_80、mention.sla_warning（4h）。

**紧急级事件**：task.l4_intervention、harness.exhausted、employer.timeout_imminent（剩24h）、runtime.offline_grace_exceeded、budget.paused_100、orchestrator.plan_timeout（30min）。

**sms 渠道公测版不启用**（预留接口）；app_push 通过 PWA Web Push 实现。

### 11.4 聚合与投递

**聚合维度**：`(recipient_id, aggregation_key)` 在 1h 窗口内合并。聚合 key = `{scope}:{scope_id}:{event_category}`，scope ∈ ws/proj/task/agent/runtime。

**延迟投递分级**：urgent 1min / reminder 5min / info 30min。pending delivery 延后让后续事件并入，让用户收到"完整聚合版"。

**不参与聚合**（aggregation_key=null）：opportunity.bid_result、spec.employer_confirmation_required、human_approval.pending、budget.paused_100。

**投递队列**：DeliveryWorker（Go goroutine 池，4 worker）轮询 pending delivery。失败重试：指数退避（10s/1min/10min）。投递幂等：`SELECT ... FOR UPDATE SKIP LOCKED`。

**静默时段**：reminder 在静默时段内延后投递；urgent 不受限制（`urgent_override=true`）。

### 11.5 WebSocket 实时推送

UI 推送 = 事件机制 → WebSocket 网关 → 增量推送；REST 兜底。WS Gateway 作为 `inbox.item_created` 的注册 handler。

6 个 WebSocket 通道详见 [第 13 章 §13.3](#133-6-个-websocket-通道)。

### 11.6 审计日志

**分级审计 L1/L2/L3**：

| 级别 | 保留期 | 内容 |
|------|--------|------|
| L1 | 永久 | 资金/契约/交付：opportunity.bid_submitted/won/lost、spec.generated/confirmed/rejected、deliverable.submitted/accepted/rejected、project.cancelled/closed、settlement.triggered、payment.released |
| L2 | 3 年 | 业务状态流转：project.created/status_changed、plan.generated/approved、task.created/checkout/status_changed、harness.retried/exhausted、budget.alert/paused、runtime.registered/offline |
| L3 | 1 年 | 配置/权限变更：workspace.created/updated、agent.created/deleted、rbac.role_assigned、notification.preferences_updated、mcp.tool_granted、api_token.issued |

**outbox 模式异步写入**：业务事务仅写 outbox，后台 worker 每 100ms 轮询批量消费。审计日志写入失败不阻塞业务，~100ms 延迟。

**不可修改约束**：`CREATE RULE no_update AS ON UPDATE TO activity_log DO INSTEAD NOTHING`；应用层 ActivityLogger 仅 INSERT。`actor_name` 冗余存储（Agent/Member 删除后审计日志仍可读）。

**归档作业**（每日凌晨 cron）：L1 超 3 年转冷存储；L2 超 3 年软删除；L3 超 1 年软删除；软删除超 1 年物理删除。`metadata.legal_hold=true` 不受保留期限制。

---

## 第 12 章 雇主侧集成 API

### 12.1 集成模式与通用约定

**集成模式**：混合模式（同步 RPC + 异步 Webhook），不引入消息总线。

**方向标识**：M→C = Marketplace 调 Console（Console 提供 Webhook）；C→M = Console 调 Marketplace（Marketplace 提供 API）。

**鉴权**：服务级长期 Token + HMAC 签名（K8s Secret 注入，提前 7 天双发轮换，旧 token 24h 过渡）。

**通用请求头**：`Authorization: Bearer <service_token>` / `X-Signature: t=<unix_ts>,v1=<hmac_sha256(body+ts)>` / `X-Request-Id: <uuid-v7>` / `Idempotency-Key: <uuid-v7>`（写操作）。

**接收方验证流程**：Bearer 比对 → timestamp 偏差 ≤ 5min → nonce 唯一 → HMAC-SHA256 重算。

**Webhook 投递语义**：At-least-once；HTTP 2xx 成功，4xx 不重试，5xx 重试；重试策略 5s/30s/2min/10min/1h 共 5 次；死信 5 次失败进死信表 + 告警。

**幂等机制**：`(event_id, event_type)` 去重 + `Idempotency-Key` 头兜底 + 业务自然键 DB UNIQUE。

**超时分级**：短 5s（GET、轻量写）/ 中 15s（一般写）/ 长 60s（大文件、批量）。

**一致性模型**：最终一致性 + 四层兜底（Webhook 重试 / 主动对账每 10min / 死信告警 / 业务容忍）。

**错误响应体**：RFC 7807 + 业务扩展（`type/title/status/detail/instance/request_id/error_code/details/retry_after_seconds`）。

### 12.2 10 大场景 API 清单（43 endpoint：17 Console Webhook + 26 Marketplace API，24 event_type）

#### 场景一：商机投递

| # | 方向 | 端点 | 说明 |
|---|------|------|------|
| 1 | M→C | `POST /v1/webhooks/opportunity/pushed` | 商机 Push（event_type: opportunity.pushed） |
| 2 | C→M | `GET /v1/marketplace/tasks` | 商机 Pull（每 5min 定时器/手动） |
| 3 | C→M | `GET /v1/marketplace/tasks/{task_id}` | 任务详情查询 |

#### 场景二：竞标方案提交

| # | 方向 | 端点 | 说明 |
|---|------|------|------|
| 4 | C→M | `POST /v1/marketplace/tasks/{task_id}/bids` | 提交竞标方案（占席位；409 CONFLICT_SEAT_FULL） |

#### 场景三：雇主选标通知（按 workspace 拆分）

| # | 方向 | 端点 | event_type |
|---|------|------|-----------|
| 5 | M→C | `POST /v1/webhooks/bid/result` | bid.won（中标，先 200 ACK 异步创建 Project） |
| 6 | C→M | `PATCH /v1/marketplace/orders/{order_id}` | 回填 project_id |
| 7 | M→C | `POST /v1/webhooks/bid/result` | bid.lost（未中标） |
| 8 | M→C | `POST /v1/webhooks/bid/result` | bid.batch_rejected（全部驳回/席位满 72h 超时） |

#### 场景四：Spec 签订（Project Task + @mention Comment 唯一真相源）

| # | 方向 | 端点 | 说明 |
|---|------|------|------|
| 9 | C→M | `POST /v1/marketplace/orders/{order_id}/employer-mentions` | 推 Mention 通知给雇主 |
| 10 | M→C | `POST /v1/webhooks/task/employer-reply` | 雇主回复 Mention（写回 task_comments，source=employer_reply） |
| 11 | C→M | `POST /v1/marketplace/orders/{order_id}/spec` | 提交 Spec 给雇主确认（7天计时） |
| 12 | M→C | `POST /v1/webhooks/spec/employer-action` | 雇主对 Spec 操作（spec.confirmed / spec.rejected / spec.timeout） |

#### 场景五：交付验收

| # | 方向 | 端点 | event_type |
|---|------|------|-----------|
| 13 | C→M | `POST /v1/marketplace/orders/{order_id}/deliverables` | 提交交付物（gates_status 全 passed 才提交；14天验收计时） |
| 14 | M→C | `POST /v1/webhooks/delivery/employer-review` | 雇主验收结果（delivery.accepted / rejected / revision_requested / auto_accepted） |

#### 场景六：修订协商

| # | 方向 | 端点 | 说明 |
|---|------|------|------|
| 15 | C→M | `POST /v1/marketplace/orders/{order_id}/revision-negotiation/start` | 启动修订协商窗口（2天） |
| 16 | 双向 | `POST /v1/marketplace/orders/{order_id}/revision-negotiation/{negotiation_id}/decide` | 4 选项决策（A追加修订/B Spec变更/C按现状验收/D转纠纷；A/B 需双方同意） |
| 17 | M→C | `POST /v1/webhooks/revision/negotiation-action` | 修订协商通知（negotiation_started / decided / auto_accepted 2天超时默认C） |

> **契约细节（M5-A3 勘误补注）**：①`#17` 的三 event_type 字面值为 `revision.negotiation_started` / `revision.negotiation_decided` / `revision.negotiation_auto_accepted`（§12.4 L1880 实证值推广，域.动作Past 命名规范）。②`#15` 响应携带 `{negotiation_id, deadline}`；negotiation_id 为 M 签发不透明 ID，Console 持久化于 `projects.revision_negotiation_id`（999439）——`#16` 路径参数必需。③`#16` 的 option 值域即 §8.3 决策值 vocabulary（`append_revision`/`spec_change`/`accept_current`/`to_dispute`）；A/B 双方同意由 M 侧聚合，生效后以 `#17 decided`（`effective=true`）通知 Console 驱动出口边；悬置提案（`effective=false`）仅通知不转移。④Console 发起架构：Console 检测 revision_count 超限（#14 `delivery.revision_requested` 处理链边 3 落地后）调 `#15` 开窗；`#17 negotiation_started` 为幂等 backstop（crash 窗口收敛）。⑤B 选项 decide 不立即转移——决策行 + deadline 清空（出 item 5 扫描集）移交场景七流程，`#22 confirm` 后经 `revision_negotiation→executing` 边（§8.3）回执行。

#### 场景七：Spec 变更

| # | 方向 | 端点 | 说明 |
|---|------|------|------|
| 18 | M→C | `POST /v1/webhooks/spec-change/request` | 雇主发起修订/变更请求（spec_change.requested，启动 24h Agent Owner 判定） |
| 19 | C→M | `POST /v1/marketplace/orders/{order_id}/revision-requests/{request_id}/classify` | 修订/新增需求判定（revision / new_requirement；24h 超时 escalate 契约门，见 §6.2） |
| 20 | M→C | `POST /v1/webhooks/spec-change/employer-confirmation` | 雇主二次确认（spec_change.employer_confirmed / rejected） |
| 21 | 双向 | `POST /v1/marketplace/orders/{order_id}/spec-changes` | Spec 变更提案（3天对方响应计时） |
| 22 | 双向 | `POST /v1/marketplace/orders/{order_id}/spec-changes/{change_id}/confirm` | 确认 Spec 变更（Spec version+1） |
| 23 | 双向 | `POST /v1/marketplace/orders/{order_id}/spec-changes/{change_id}/reject` | 拒绝 Spec 变更 |

> **契约细节（M5-A4 勘误补注）**：①`#18` payload 携带 M 签发 `request_id`，Console 持久化于 `spec_change_requests.marketplace_request_id`（999440）——`#19` 路径参数必需（B 移交进入为 NULL，结构跳过 #19）；`#20` payload 经同一 request_id 定位 Console 行。②`#21` 的 `change_id` 由 **Console 签发**（= `spec_change_requests.id`，提案发起方自带行 ID——区别于场景六 negotiation_id 的 M 签发模式：协商开窗由 M 主动，提案由 Console 发起）；提案内容载体为 Console 侧 Spec revision draft（v N+1，父链 from_spec_revision_id 基线）。③`#22/#23` 的 effective 聚合镜像场景六 A/B：双方同向票才 effective（M 侧聚合），Console 仅在 effective 时落 version+1 / 行终局并驱动 B 移交出口边。④B 移交衔接（场景六契约细节 ⑤ 的消费侧落地）：decide B 的 handoff 事件由 Console worker 消费建行——**直落 `employer_confirmed` + `new_requirement`**（B 票同时承载分类共识与雇主确认语义，24h 判定与 #20 二次确认结构性跳过）。⑤B 移交后 `#22 confirm`（effective）→ Spec version+1 + `revision_negotiation→executing` 边（§8.3）；`#23 reject`（effective）→ 行 resolve(rejected) + `revision_negotiation→completed_pending_appeal`（边 7 复用——变更不成立按原 Spec 现状收尾，C 语义近似；payload `source=spec_change.rejected` 审计区分）。⑥3 天提案计时主体在 M 侧（Q3 裁决精神），Console 不落本地计时列。

#### 场景八：协商取消与结算

| # | 方向 | 端点 | 说明 |
|---|------|------|------|
| 24 | M→C | `POST /v1/webhooks/project/cancel-request` | 雇主发起协商取消（含 Spec 驳回 5 次自动触发；3天 Agent Owner 响应计时） |
| 25 | C→M | `POST /v1/marketplace/orders/{order_id}/cancel-requests/{request_id}/respond` | Agent Owner 响应（accept/counter_proposal/reject） |
| 26 | C→M | `POST /v1/marketplace/orders/{order_id}/cancel-requests/{request_id}/auto-resolve` | Agent Owner 3天超时自动处理（执行中→同意取消+部分结算；待验收→拒绝）；签约段（spec_nego 经 G1 进入 cancelling）3 天超时=同意取消（零结算） |
| 27 | M→C | `POST /v1/webhooks/project/cancel-counter-response` | 雇主对部分结算方案响应 |
| 28 | C→M | `POST /v1/marketplace/orders/{order_id}/cancel-requests/{request_id}/finalize` | 最终确认取消结算 |
| 29 | M→C | `POST /v1/webhooks/project/cancel-resolution` | 取消协商结果（auto_settled / to_dispute） |
| 30 | C→M | `POST /v1/marketplace/orders/{order_id}/cancel-requests/{request_id}/to-dispute` | 转纠纷（无可结算里程碑） |

**里程碑结算金额公式**：`结算金额 = Σ(里程碑权重 × Spec.final_price) for each 里程碑 where status="verified_passed"`。所有 milestones weight 之和必须 = 100%（Spec 生成时校验）。

> **verified_passed 数据面（M5-A5 勘误补注，design D1）**：`verified_passed` 为**派生聚合态**——里程碑 Task（`execution_policy->>'milestone'='true'`）满足 `status='done' AND gate_results.overall_passed=true` 即为该里程碑的 verified_passed；零新列、零新表，结算时由 `statemachine.AggregateMilestoneSettlement` 纯函数聚合计算（无 DB IO，DB 读取在调用方）。**权重关联机制**：结算公式的"里程碑权重"读自 `project.spec_snapshot` JSONB 的 `milestones` 数组（`{"name","weight"}`，weight 为 0-100 百分数）；task ↔ spec milestone 按 **task title ↔ milestone name 精确匹配**（大小写敏感）——两侧无生产端强约束关联字段，name 匹配是唯一零 writer 变更的关联机制（Orchestrator 按 Spec 里程碑建 milestone Task 时命名对齐）。未匹配的里程碑 Task 结算权重为 0（不进结算金额，breakdown 如实暴露 plan/spec 漂移——钱面只结契约能锚定的金额，fail-visible）。**WeightsValid 校验**：聚合返回 `WeightsValid`（Σ spec milestones weight == 100，浮点容差）；全量结算（#31）时 WeightsValid=false → 触发失败重试（fail-closed）；部分结算（counter/仲裁）时仅报告。上句正文"（Spec 生成时校验）"由 M5-A5 调整承载面：生成端 writer 校验未落，校验的权威承载是聚合侧 `WeightsValid`——fail-closed 同时覆盖存量 Spec 与落库后漂移（比生成端拒绝更强的钱面方向）；drift 自裁记录于 M5-A5 task design D1/§13。快照不持久化缓存：落点为 counter_plan wire payload（M 侧与面板消费）+ settlements 行（本地台账）+ transition_records/通知正文（审计与人读面）。

> **契约细节（M5-A5 勘误补注）**：①`#25` counter_proposal 分支携带 `counter_plan` 子对象：`{amount, currency, milestones:[{name, weight, amount}]}`——由 Console 侧聚合计算（上注派生聚合），非雇主侧输入；decision 值域 `accept / reject / counter_proposal`。②`#27` 雇主响应 decision 值域 `accepted / rejected`：`accepted` 触发 Console 自动 finalize 链（#28 → 本地结算行落账（`settlements`，invoice_ref 幂等键 `cancel:<request_row_id>`）→ `cancelling→cancelled` 终态转移 → 行翻 `finalized`）；`rejected` 使请求行回 `pending`（协商回合重开，3 天 SLA 计时不变）。请求行状态机扩展 `counter_proposed`（#25 counter 已发待 #27）与 `withdrawn`（#29 撤回闭档）。③`#29` result 值域扩展 `withdrawn`：M 权威断言双方同意撤回取消请求 → Console 按 origin_status 分派回退边——`executing` → 边 10 `cancelling→executing`、`in_accept` → 边 11 `cancelling→in_accept`（payload 双同意证据）；**`spec_nego` / `budget_paused` origin 无注册回边（TS 缺口如实登记）——仅请求行闭档，项目留 cancelling**（其收敛走 #33 通配边/放弃路径）。

#### 场景九：结算与申诉

| # | 方向 | 端点 | 说明 |
|---|------|------|------|
| 31 | C→M | `POST /v1/marketplace/orders/{order_id}/settlement/trigger` | 触发结算（Project 完成时；7天托管期） |
| 32 | M→C | `POST /v1/webhooks/settlement/result` | 结算完成通知（settlement.completed） |
| 33 | M→C | `POST /v1/webhooks/project/dispute-raised` | 纠纷发起通知（7天申诉期内） |
| 34 | M→C | `POST /v1/webhooks/settlement/appeal-period-closed` | 申诉期关闭（7天未申诉→最终认可→终态） |

> **契约细节（M5-A5 勘误补注）**：①`#31` 触发挂点：Console 侧挂在状态机边 2/边 7（`in_accept→completed_pending_appeal` 与 `revision_negotiation→completed_pending_appeal`，§8.3）的 **PostCommitSide**——任何进入 `completed_pending_appeal` 的路径都自动携带结算触发（挂 processor 会漏边）；Side 失败走 side_failed 重放轨道 + 对账 reconcile 自愈扫描（`completed_pending_appeal` 且无 `settlements` 行 → 补触发）。`#31` wire body `{project_id, amount, currency, milestones[]}`（派生聚合结果，见场景八公式注）；幂等键约定：请求头 `Idempotency-Key`（M 侧重放首次结果）+ Console 侧 `settlements.invoice_ref = settlement:<project_id>`（本地台账幂等，999443 `(project_id)` UNIQUE 兜底）。触发前置门禁：仅 `completed_pending_appeal` 态触发；聚合 WeightsValid=false → fail-closed 拒绝触发重试。②`#32` 承接：Console 定位项目 `settlements` 行（`pending→paid`，TriggerPayout 语义）；**行缺失时容错 Record**（amount 取 payload 回显、缺省 0，invoice_ref 同 `settlement:<project_id>`）后翻转——#31 本地腿丢失不阻断放款记账；已 paid 的重放为幂等 no-op。③`#34` → 边 9（`completed_pending_appeal→completed_final`，trigger `appeal_period_closed`）：**completed_at 已于边 2 落列（M5-A2 勘误）——边 9 为终态 emit only（`project.completed_final` 事件），不重复写 completed_at**；Console 侧 Rejection 优雅消费（已终态/已 dispute 的重放为 warn no-op）。

#### 场景十：纠纷仲裁

| # | 方向 | 端点 | 说明 |
|---|------|------|------|
| 39 | M→C | `POST /v1/webhooks/project/dispute-raised` | 雇主发起纠纷（7天申诉期内；Project → 纠纷处理中，冻结后续动作） |
| 40 | C→M | `POST /v1/marketplace/orders/{order_id}/disputes/{dispute_id}/evidence` | Agent Owner 提交举证（交付记录/Spec 对比/Comment 历史） |
| 41 | M→C | `POST /v1/webhooks/dispute/arbitration-started` | 平台受理纠纷，启动仲裁 |
| 42 | M→C | `POST /v1/webhooks/dispute/arbitration-result` | 仲裁结果（dispute.resolved：仲裁取消/仲裁履约/仲裁部分结算/仲裁退款） |
| 43 | C→M | `POST /v1/marketplace/orders/{order_id}/disputes/{dispute_id}/acknowledge` | Agent Owner 确认仲裁结果（终态） |

**仲裁流程**：纠纷发起 → 双方举证（3 天窗口）→ 平台仲裁（最多 7 天）→ 仲裁结果 → 终态。
**仲裁结果四选项**：(A) 仲裁取消 — Project → 已取消；(B) 仲裁履约 — Project → 已完成（终态），全额结算；(C) 仲裁部分结算 — 按里程碑权重部分结算；(D) 仲裁退款 — Project → 已取消，退款给雇主。
**状态机出口**：纠纷处理中 → 已取消（A/D）/ 已完成终态（B）/ 部分结算（C）。

> **契约细节（M5-A6 勘误补注）**：①`#42` payload `outcome` 值域为六值：四选项 `arbitration_cancelled` / `fulfilled` / `partial_settlement` / `refund` + 两项触发源补全——`resume_execution`（仲裁裁定取消不成立回执行，驱动 `dispute_in_progress→executing`，G6 取消升级路径的主案例）与 `closed`（平台裁定关闭，驱动 G3 `dispute_in_progress→closed`）——§8.3 边表 L1131/L1139 两条边的触发源词汇补全。②仲裁金额落点：出钱选项（B/C）经 `SettlementPort.RecordArbitration`（upsert 三态：行缺 → INSERT `invoice_ref=arbitration:<dispute_id>`；行在且 pending → UPDATE 金额与 invoice_ref 至仲裁裁定额；行在且 paid → 幂等 no-op）——appeal 路径项目在边 2/7 已落全额 pending 行（`#31` 链），单语句 Record 会因 999443 单行约束幂等回取全额旧行致部分结算金额漂移，upsert 是该约束下唯一正确形态；B 金额 = `final_price`（全履约），C 金额 = `AggregateMilestoneSettlement().TotalAmount`（派生聚合，M5-A5 勘误）；A/D 不落金额（appeal 路径 pending 行悬置为正确台账语义——托管未放款，划拨回 M 侧）。③processor 时序：先 `RecordArbitration` 后出口边转移（转移重试幂等无害；反向顺序在转移成功金额失败时 `#32` 到达会按旧全额 payout 多付）。④`#39`（=`#33` 同端点同事件）承接后 dispute_id 载体 = `project.dispute_started` outbox 事件行 payload（转移同事务写，append-only；transition_records 仅存 payload_hash 无 payload 列）——Console 侧回取面 `GetProjectDisputeContext`；G6 路径（#30 取消升级）payload 无 dispute_id，面板侧从 M 上下文传入。⑤`#40`/`#43` 的 Agent Owner 操作面为 Console HTTP 端点（`POST /api/projects/{project_id}/disputes/{dispute_id}/evidence` 与 `.../acknowledge`），三类举证材料为摘要组装非副本存储（M 是仲裁权威）。

#### 对账 API

| # | 方向 | 端点 | 说明 |
|---|------|------|------|
| 35 | C→M | `GET /v1/marketplace/orders/{order_id}/settlement` | 查询结算状态 |
| 36 | C→M | `GET /v1/marketplace/workspaces/{workspace_id}/settlements` | 查询 Workspace 结算列表 |
| 37 | C→M | `GET /v1/marketplace/orders/{order_id}/status` | 查询 Order 状态（Console 每 10min 对账） |
| 38 | C→M | `GET /v1/marketplace/workspaces/{workspace_id}/orders` | 查询 Workspace Order 列表 |

### 12.3 业务幂等键清单

| 操作 | 业务幂等键 | 实现方式 |
|---|---|---|
| 商机 Push / Pull | `(workspace_id, marketplace_task_id)` | DB UNIQUE |
| 提交竞标方案 | `(marketplace_task_id, bid_round, workspace_id)` | DB UNIQUE |
| Spec 推送 | `(project_id, spec_version)` | DB UNIQUE |
| 交付物提交 | `(project_id, submission_seq)` | DB UNIQUE |
| 验收回调 | `(project_id, review_round)` | DB UNIQUE |
| Spec 变更请求 | `(project_id, change_seq)` | DB UNIQUE |
| 修订请求 | `(project_id, revision_round)` | DB UNIQUE |
| 取消协商 | `(project_id, cancel_proposal_seq)` | DB UNIQUE |
| 触发结算 | `(project_id)` | DB UNIQUE（一个 Project 仅一次结算） |

### 12.4 自动超时归属（"各管各的"原则）

| 超时场景 | 超时 | 归属方 | 处理 |
|---|---|---|---|
| Spec 雇主未确认 | 7 天 | Marketplace | 自动取消 Project（spec.timeout） |
| 14 天自动验收 | 14 天 | Marketplace | delivery.auto_accepted |
| 协商窗口默认 C | 2 天 | Marketplace | revision.negotiation_auto_accepted |
| 24h 修订判定超时 | 24h | Console | escalate（urgent 通知 Owner + 冻结直至判定；属 §7.4 层 1 契约门） |
| 3 天取消响应默认 | 3 天 | Console | 按阶段自动处理 |
| 席位满雇主决策 | 72h | Marketplace | 自动全部驳回 |
| Spec 驳回 5 次 | — | Marketplace | 触发协商取消 |
| 签约阶段总超时 | 30 天 | Marketplace | 触发协商取消 |

> **双通道收敛注记（M5-A3）**：协商窗口默认 C 是 M 侧计时（上表归属）与 Console 侧 `deadline_scanner` item 5（§10.8 L1613，扫 `status='revision_negotiation' AND revision_negotiation_deadline < now()`）的**幂等双通道**——M 管雇主侧计时与 `#17 auto_accepted` 通知，Console scanner 管 Project 状态收敛（lost-webhook 对账兜底，§12.5 四层兜底精神）；两通道驱动同一 `revision_negotiation→completed_pending_appeal` 边转移 + `revision_negotiation_decisions(decision=auto_accepted_c)` 落档，竞态由边 Guard 拒绝幂等收敛（第二驱动者 benign，决策行随转移原子单次落档）。

### 12.5 四层兜底

| 层 | 机制 | 覆盖 |
|---|---|---|
| 层 1 | Webhook 重试（at-least-once + 5 次退避） | 瞬时故障 |
| 层 2 | 主动对账（Console 每 10min 跑状态同步，与本地 Project 状态对比修复） | 长时间不一致 |
| 层 3 | 死信告警（5 次重试失败进死信表，告警人工介入） | 重试耗尽 |
| 层 4 | 业务容忍（中间状态业务可接受，关键操作必须等 webhook ACK 后才对外展示"已完成"） | 设计原则 |

---

## 第 13 章 Console UI 设计

### 13.1 信息架构（12 顶级路由）

| # | 路由 | 名称 | 子路由 |
|---|---------|------|-------|
| 1 | `/dashboard` | Workspace 经营驾驶舱 | — |
| 2 | `/opportunities` | 商机 Inbox | `/:oppId`（Overview / 竞标分析 Task / Bid History） |
| 3 | `/projects` | 项目列表 | `/:projectId`（`/plan`、`/activity`、`/artifacts`、`/spec`、`/delivery`、`/settlement`、`/plans/:planId/approve`） |
| 4 | `/tasks` | Task Board | `?view=board|list`；`/:taskId`（概览/Comment/产物/执行日志/决策审计） |
| 5 | `/agents` | Agent 管理 | `/new`、`/:agentId`（8 tab）、`/:agentId/edit` |
| 6 | `/runtimes` | Runtime 管理 | `/:runtimeId`、`/new` |
| 7 | `/routines` | Routine 模板 | `/new`、`/:routineId/edit`、`/runs/:runId` |
| 8 | `/skills` | Skill（复用 Multica） | — |
| 9 | `/teams` | Team（复用 Multica） | — |
| 10 | `/notifications` | 通知中心 | `?level=urgent|reminder|info&unread=true` |
| 11 | `/settings` | Workspace 设置 | `/workspace`、`/notifications`、`/billing`、`/api-tokens`、`/members` |
| 12 | `/search` | 全局搜索（⌘K 命令面板） | — |
| 13 | `/showcase` | Workspace 展示页（店铺门面） | `/:workspaceSlug`（公开预览）/ `/edit`（Agent Owner 管理编辑） |

**路由策略**：Project 子 tab 用 path segment（可深链/独立刷新）；状态/视图切换用 query；Task 详情用 Drawer 而非全屏（保持 Board 上下文）。

### 13.2 9 核心页面（M0.8 +1: Workspace 展示页）

| # | 页面 | 路由 | 关键元素 | 数据来源 | WS 通道 |
|---|------|------|---------|---------|---------|
| ① | Workspace Dashboard | `/dashboard` | 4 指标卡 + Project 健康度 + Agent Top/Bottom + 待介入清单 | dashboard API + metric_hourly | workspace |
| ② | 商机 Inbox | `/opportunities` | 状态分栏 + 商机卡片 + 手动竞标表单 | opportunities（task_brief 已投影为列：category/description/budget_min~max/expires_at/seat_limit/seat_taken，§3.1） | workspace |
| ③ | Project 详情 | `/projects/:id` | 6 tab：Plan DAG / Activity / Artifacts / Spec / Delivery / Settlement | artifacts + documents + settlements | project |
| ④ | Task Board | `/tasks` | 看板（列=CSI 状态）+ 列表 + Task 详情 Drawer（5 tab） | v_task_board + task_comments | board + task |
| ⑤ | Agent 管理 | `/agents` | 列表卡片 + 8 步创建向导 + 详情多 tab + 运行日志 | agents + quality_profile + v_agent_workload | agent_run |
| ⑥ | Routine 编辑器 | `/routines/:id/edit` | 左 Step 列表（拖拽）+ 右配置面板 + 条件路由 + 变量 | routines + steps + runs.step_context | routine_run |
| ⑦ | Plan 审批 | `/projects/:id/plans/:planId/approve` | DAG 只读预览 + 校验报告 + 执行策略摘要 + 审批 Comment | transition_records + Guard 输出 | project |
| ⑧ | 文档评审 | `/projects/:id/documents/:docId/review` | TipTap 只读正文 + 选区锚定线程 + 锁定/解锁 + 版本 diff | annotation_threads + revisions | project |
| ⑨ | Workspace 展示页 | `/showcase` | 能力标签编辑 + 服务承诺配置 + 案例上传 + 信用数据展示 + 公告编辑 + 新店标识 | workspaces + workspace_portfolio_cases + workspace_credit_summary | workspace |

### 13.3 6 个 WebSocket 通道

| 通道 | 订阅粒度 | 事件类型 | 生命周期 |
|------|---------|---------|---------|
| `workspace` | per workspace | inbox:new（通知复用 inbox 事件族——同一物理表 inbox_item 单事件族，避免双真相源；2026-08-22 M2-C7 patch Owner 裁定，原 notification.new/updated 废弃）、dashboard.metric.changed、opportunity.pushed、project:status_changed（2026-08-24 M3-D5 增补：Project 列表页实时状态刷新消费面——低频事件广播给 workspace 全体，project 通道的单项目订阅不受影响） | 登录后常驻 |
| `project` | per project | task.transitioned、task.comment.created、artifact.published、plan.submitted/approved、project.status_changed、activity.new | 进入 /projects/:id 时订阅；切换先 unsubscribe 旧 |
| `task` | per task | task.transitioned、comment.created、review.result、harness.exhausted | 打开 Task Drawer 时叠加；关闭 unsubscribe |
| `agent_run` | per run | run.transcript（流式）、run.liveness.changed、run.completed | 打开运行日志页订阅 |
| `routine_run` | per run | routine.step.completed/started | 打开 Routine Run 详情订阅 |
| `board` | per workspace（筛选感知） | task.transitioned（按筛选推送）、task.created | Task Board 页订阅；切换筛选刷新订阅 |

**WS 工程实现**：单 WSS 连接（`/api/v1/ws?workspace_id=...&token=...`），断线指数退避重连（1s/2s/5s/10s/30s），重连后调 `GET /notifications/since?last_event_id` 补拉；4401 鉴权过期跳登录续期；多标签页独立连接 + BroadcastChannel 同步未读计数。

**WS 事件 → React Query 失效分层**：列表/聚合用 `invalidateQueries`；高频/追加（comment/transcript）用 `setQueryData` 乐观；Dashboard 60s 节流。

### 13.4 组件清单（~85% 复用 Multica）

**[REUSE] 直接复用（~55%）**：60 个原子组件（packages/ui）+ ~30 个业务视图（packages/views）+ 12 个 common（含 `actor-avatar.tsx` P1 多态 Actor 核心）。

**[ADAPT] 改造复用（~30%）**：CsiAppSidebar、GlobalSearch、DashboardPage、OpportunitiesPage、ProjectDetailPage、TaskBoardPage、AgentsPage、RoutinesPage、DocumentReviewPage、NotificationsPage 等。

**[NEW] 全新（~15%，~30 个）**：
- **Dashboard**：MetricCard、ProjectHealthList、ActionItemsList、SlaBadge（全 Console 统一 🟢🟡🟠🔴）
- **商机**：OpportunityCard、OpportunityDetailPage、BidForm、SeatIndicator
- **Project 详情**：PlanDagView（react-flow + dagre，核心新组件）、DagNode、DagEdge、SpecVersionHistory、DeliveryTimeline、SettlementBreakdown、EvidenceGateStatus
- **Task Board**：TaskDetailDrawer、TaskActionBar（MCP 工具按钮组按权限矩阵驱动）、TransitionConfirmDialog（显示 Guard/Gate 校验项 + 拒绝回弹）、DecisionAuditList
- **Agent**：QualityProfileCard
- **Runtime**：HeartbeatStatus
- **Routine**：RoutineStepList、RoutineStepConfigPanel、ConditionRouterEditor、StepRefChip
- **Plan 审批 + 文档评审**：PlanApprovalPage、ValidationReport、ExecutionPolicySummary、AnnotationThreadPanel
- **通知**：NotificationPreferencesForm
- **共享**：TaskStatusBadge、ProjectStatusBadge、OpportunityStatusBadge、Countdown（席位/Spec 7d/验收 14d/协商 2d/取消 3d）、WsConnectionBanner

### 13.5 Dashboard 指标（三层）

| 层 | 指标类 | 示例 |
|---|--------|------|
| Workspace 经营 | 经营规模 / 营收 / 产能健康 | 活跃 Project 数、累计交付数、中标率、在投商机数、在途金额、已结算金额、Agent 利用率、Runtime 在线率、异常 Project 数、待 Owner 介入项 |
| Project 执行 | 进度 / 质量 / 健康度 | 当前阶段、阶段完成度、关键路径剩余、SLA 状态、总进度、一次通过率、平均返工次数、reopen 率、阻塞节点数、卡顿节点数 |
| Agent 产能 | 吞吐负载 / 速度 / 质量 / 成本 | 在手 Task 数、可用槽位、累计完成数、平均周期时间、平均审查耗时、平均响应时间、一次通过率、被驳回率、Token 消耗、单 Task 成本 |

**三档聚合**：实时（Dashboard 查询时计算，60s 缓存）/ 滚动窗口（定时任务每小时聚合，存 `metric_hourly` 表）/ 快照（Project 状态变更时，存 `metric_project_snapshot` 表）。

**数据源单一真相**：以 `transition_records` 为单一真相派生聚合，不直接扫 `project_tasks` 全表（避免锁竞争 + 数据漂移）。

### 13.6 UI 关键交互

- **拖拽看板 = MCP 工具 + 确认对话框 + 拒绝回弹**：拖拽先弹确认框显示转移边 + Guard/Gate 校验项；拒绝时卡片回弹 + Toast 错误码。
- **Plan DAG 用 react-flow + dagre**：>30 节点切缩略图模式；>100 节点无压力。
- **Routine 编辑器基于 Multica Autopilot 扩展**：不引入 Temporal/Camunda/LangGraph；扩展多 Step + 条件路由 + Step 间上下文。
- **Ports & Adapters 六边形架构**：5 个 Port（Auth/OpportunitySource/Settlement/NotificationChannel/CrossModuleLink），逐 Port 灰度切换。当前 LocalAuthAdapter（Multica 本地账户），CSI IDP 就绪后切 CSOAuthAdapter。

### 13.7 Workspace 展示页（店铺门面）[M0.8, PRD §5.6.7]

**背景**：PRD §5.6.7。CSI Workspace 是"AI 工作室"，雇主需要可信载体了解每个 Workspace 的能力与信誉。Agent Owner 侧需要"店铺门面"沉淀品牌资产。Phase 1 必做。

**路由**：`/showcase`（Agent Owner 管理编辑）/ `/showcase/:workspaceSlug`（公开预览，雇主侧）

**字段规范**：

| 模块 | 存储 | 字段 | 类型 | 约束 | 编辑权 |
|------|------|------|------|------|--------|
| 能力标签 | `workspaces.capability_tags` | JSONB 数组 | `["电商文案", "SaaS 官网"]` | ≤5 个标签（应用层校验） | Agent Owner |
| 服务承诺 | `workspaces.service_commitments` | JSONB 对象 | `{response_hours: 24, revision_count: 2, refund_policy: "..."}` | 结构化枚举（应用层校验） | Agent Owner |
| 首页公告 | `workspaces.showcase_announcement` | TEXT | 品牌主张/近期活动 | `CHECK (length ≤ 200)` | Agent Owner |
| 历史交付案例 | `workspace_portfolio_cases` 表 | 10 字段 | id, workspace_id, title, summary, screenshot_url, visibility, authorization_declared, display_order, created_at, updated_at | ≤6 个/Workspace（应用层 COUNT 校验） | Agent Owner |
| 信用数据 | `workspace_credit_summary` 表 | 6 字段 | workspace_id(PK 1:1), total_tasks_completed, avg_rating(0.00-5.00), on_time_delivery_rate, dispute_rate, computed_at | 平台自动生成 | 平台 job |
| 新店标识 | 派生（不持久化） | `total_tasks_completed < 3` | BOOLEAN | — | 平台派生 |

**权限与合规**：
- 案例上传需 Agent Owner 声明 `authorization_declared=true`（已获客户授权公开或已充分脱敏），平台保留下架权
- 信用数据（`avg_rating`/`dispute_rate`）由平台自动计算，Agent Owner 不可修改
- 展示页 Phase 1 竞标阶段对雇主可见；未参与竞标的第三方无法访问（避免品牌被恶意爬取）
- 信用数据刷新由定时 job 负责（类似 `metric_hourly` 聚合，M0.8 仅建表，job 实现归后续 feature task）

---

## 第 14 章 端到端交付流程

### 14.1 Phase 1：竞标报价

商机到达（Push/Pull/Manual）→ 创建 Opportunity 记录 → 按 Bidding Routine 创建 Task 序列 → Agent 自主执行（商机分析 / 方案生成 / Agent Owner 审批 / 提交竞标）→ Marketplace 占席位 → 雇主选标。

竞标结果通过 webhook 回写：中标（bid.won → 异步创建 Project + 回填 project_id）/ 未中标（bid.lost）/ 全部驳回（bid.batch_rejected，含席位满 72h 超时）。

bid.won webhook handler 内部流程：创建 `projects` 行（status=spec_nego）+ 初始 `project_spec_revisions` 行（status=draft）+ 写 `project.created` 事件到 event_outbox → 回填 project_id（PATCH order）→ Signing Routine 由 `project.created` 事件触发启动。

### 14.2 Phase 2：Spec 契约签订

Project 创建（status=契约签订中）→ 按 Signing Routine 创建 Task 序列 → Agent 自主需求澄清（@mention 雇主通过 employer-mentions API）→ Spec 生成（Project Task 交付物）→ Agent Owner 审阅 → 提交雇主确认（7天计时）→ 雇主 confirmed / rejected / timeout。

Spec 签订实现为单个 Project Task + @mention Comment，**不使用工作流编排引擎**。

spec.confirmed webhook handler 内部流程：更新 `project_spec_revisions.status=confirmed` + 写 `projects.spec_snapshot`/`spec_snapshot_hash`/`spec_confirmed_at` + Project 状态 `spec_nego → planning` 转移的 Side hook 自动创建"制定项目计划"Task（assignee=orchestrator_agent_id）。

### 14.3 Phase 3：自主交付（5 阶段）

> **演练案例声明**：本节叙事以 `sop-enterprise-app`（企业级应用交付 SOP 模板）为示例，文中"Owner 审批"是**该 SOP 模板在层 2 静态声明的 approvalStage**，**不是平台硬编码规则**。是否在每个阶段必设 Owner 审批门由 SOP §10.2 决定（详见 §7.4 三层配置：层 1 平台契约门 + 层 2 SOP 模板 + 层 3 Agent 运行时自主请求）。PRD / 架构 / 测试用例 / Plan v2 等**内部门审批不得在平台层硬编码**为必设 approvalStage——内部门是否必设完全由 SOP 模板决定，Workspace 可切换不同 SOP 改变内部门审批强度。下方每处"Owner 审批"均应理解为"按 `sop-enterprise-app` 模板配置的 approvalStage"。

#### 阶段 1：Orchestrator 制定项目计划

Project 进入"契约已签订" → 系统自动创建"制定项目计划"Task（Assignee: Orchestrator）→ Orchestrator 读 Spec + 匹配 SOP 模板 + 检查 Workspace 能力 + Spec 驱动定制化 → 调用 `submit_plan`（多阶段 Plan，**非开发 Task DAG**）→ Project 状态 → plan_review → Agent Owner 审批（**是否必设由 SOP §10.2 决定**；契约门层 1 始终生效，内部门 Plan 审批强度按 SOP）。

#### 阶段 2：需求分析与 PRD

Orchestrator 创建阶段 Task：Task-PRD（PM-Agent，4 评审人 + Owner 审批）+ Task-TEST-PLAN（Tester-Agent，可并行）。PM-Agent 分析 Spec → 遇模糊点 @mention Orchestrator → 产出 PRD 初稿 → `submit_for_review` → 多角色异步评审（Architect/Tester/Dev）→ `request_changes` → 修订 → 多角色 approve → Owner 审批（**是否必设由 SOP §10.2 决定，PRD 属内部门非契约门**）→ Task-PRD: done。**PRD 正式锁定为后续阶段的单一真相源**。

#### 阶段 3：架构设计 + 测试用例设计（并行）

Task-ARCH（Architect-Agent）：技术选型 + 模块拆分 + @DBA 协作 + 产出 ARCHITECTURE.md/API-SPEC/DB-SCHEMA/MODULE-BREAKDOWN → 评审 → Owner 审批（**是否必设由 SOP §10.2 决定，架构属内部门**）→ done。**架构设计锁定**。

Task-TESTCASE（Tester-Agent，并行）：@PM 澄清 + 产出测试用例（功能+边界+集成，覆盖 18 条 AC）→ 评审 → done。**测试用例锁定**。

#### 阶段 4：开发执行

Orchestrator 基于 PRD+架构细化开发 Task DAG（`submit_plan_update`，Agent Owner 二次审批，**是否必设由 SOP §10.2 决定**）。开发 Task 依赖自动解锁驱动 → Agent 签出执行。每个 Task：开发 → 自测 → @Tester 验证 → @Reviewer 审查 → done。

#### 阶段 5：集成测试与产品验收

Orchestrator 创建 Task-ACCEPT（PM-Agent，前置：全部开发 Task + 集成测试完成）→ PM-Agent 逐条验收 AC → 不满足 `request_changes` + @Orchestrator 建议 → 修复 → 再次验收 → 全部满足 `approve` → done。**Project 全部 Task 完成；Project status: 待验收**。

### 14.4 CRM 端到端演练案例

以 ABC 公司 CRM 系统（6 需求 / 18 验收标准 / 报价 ¥50,000 / 预计 30 天）为例，9 个 Agent 团队（Orchestrator-PM / PM-Agent / Architect-Agent / Tester-Agent / Dev-Agent-BE / Dev-Agent-FE / DBA-Agent / Reviewer-Agent）协作完成：

- Day 1：Orchestrator 制定 5 阶段计划 → Owner 审批
- Day 1-2：PM-Agent 产出 PRD v2（多角色评审修订）→ Owner 审批锁定
- Day 2-4：Architect 产出架构 + DBA 协作 ∥ Tester 产出测试用例 → 并行锁定
- Day 4-18：9 个开发 Task DAG 执行（依赖自动解锁驱动）
- Day 18-20：PM-Agent 产品验收 18 条 AC（17 ✓ + 1 修复）→ 全部满足
- 交付：`submit_deliverables`（源代码 6 模块 + 部署文档 + 用户手册 + 测试报告 + PRD 终版 + 架构文档 + 验收对照表 18/18 ✓）

**v2 修正的核心认知**：Orchestrator = 项目负责人（PM），按完整项目阶段组织，而非直接从 Spec 跳到开发 Task。关键成功因素：PM-Agent 通过 PRD 评审确保理解正确；Architect 在开发前确保技术可行性；Tester 先设计用例后测试；Orchestrator 全程协调；PRD 是单一真相源。**审批门由 `sop-enterprise-app` 模板配置（同 §14.3 声明），非平台硬编码**。

### 14.5 交付验收与结算

Agent 完成所有 Project Task + Evidence Gates（G1/G2/G3/G6 + G4/G5）全 passed → Console 调 `POST /v1/marketplace/orders/{order_id}/deliverables`（仅传 metadata + 签名 URL）→ Marketplace 启动 14 天验收计时 → 第 5/9/13 天催办 → 雇主验收 / 驳回 / 要求修订 / 14 天自动验收。

验收通过 → Project 状态"已完成" → Console 调 `POST /settlement/trigger` → Marketplace 处理结算 → `settlement.completed` webhook → Project"已完成（待申诉期结束）"→ 7 天申诉期 → `settlement.appeal_period_closed` → Project 终态（不可逆）。

> **settlements 本地台账注记（M5-A5）**：Console 侧结算台账 `settlements` 表（§17.3 SettlementPort 本地实现）的 `(project_id)` UNIQUE 已落迁移 999443（`uq_settlements_project`，CREATE UNIQUE INDEX CONCURRENTLY 单语句文件）——每项目一条结算行，是 #31 触发链 invoice_ref `settlement:<project_id>` 应用级幂等之下的 DB 级兜底，与 `idx_settlements_invoice_ref`（999303）构成两级幂等；#32 承接与对账补偿 pass 依赖该行定位（见 §12.2 场景九契约细节注）。999444 随后清除被 UNIQUE 完全覆盖的旧非唯一索引 `idx_settlements_project`（999302，纯写放大，review-r1 发现②）。

---

## 第 15 章 异常场景覆盖

### 15.1 离线

| 场景 | 处理 |
|------|------|
| **Runtime 离线**（心跳 > 90s） | 进 grace_period（5min，不立即 fail task）；恢复则无缝继续；到期 → Task failed → 回退 dispatched → Pod 重建 → 重新认领 |
| **Orchestrator Runtime 离线** | Wake Queue 持续累积（TTL 7 天）；平台兜底监控直接 @mention Owner（绕过 Orchestrator）；**不切换监控主体**；恢复后累积 wake 按时间顺序消费 |
| **Agent 离线** | 其 Task 在 grace_period 后 failed → 回退 dispatched → 被其他 Agent 或恢复后的原 Agent 重新认领 |
| **雇主离线** | Spec 7天/交付14天/协商2天/席位72h 等各超时由 Marketplace 自动触发对应后果（取消/自动验收/默认C/全部驳回）；雇主长时离线但 Marketplace 可用时，Console 通过 5/9/13 天催办提醒级通知雇主，超时后按各阶段规则自动处理 |
| **Owner 离线**（统一策略） | **分级处理**：契约门（Spec 提交雇主确认、交付物提交雇主验收、Spec 变更对外发起）→ escalate（urgent 通知 Owner + 冻结直至 Owner 显式判定，§6.2/§7.4 层 1）；内部门（PRD/架构/Goal Mode 审批）→ 24h 超时 auto-approve（§7.4 层 2/3，§10.7 Goal Mode）。**长期失联死局**：Spec 变更 escalate 后 Owner 7 天仍无响应 → 进 §6.3 Spec 签订兜底"单次 Spec 雇主不响应 7 天自动取消 Project"，接受死局。Owner 离线期间 Orchestrator/Agent 可继续推进非阻塞 Task（Agent 主导不因 Owner 离线停滞） |

### 15.2 崩溃

| 场景 | 处理 |
|------|------|
| **Pod 内单个 CLI 进程崩溃** | daemon `handleTask` 捕获 exit code；resume 失败且 tools==0 → 新 session 重跑；tools>0 → 不重试避免副作用重复。其他 CLI 不受影响 |
| **Pod 崩溃 → K8s 自动重启** | 10-30s 重建。daemon_id 来自 env 不变 → session_id/workdir 自动复用。grace period 内恢复无缝 |
| **Pod 不可恢复**（节点故障） | 90s offline → 5min grace → Task failed → 回退 dispatched → 新节点重建 Pod → 挂载同一 PVC 恢复 |
| **PVC 丢失** | 基础设施故障，应用层不解决 |
| **PVC 丢失**（业务恢复） | Spec/Plan/Task 状态等业务数据持久化在 PG（不依赖 PVC）；PVC 仅存 Agent 工作目录和中间产物。PVC 丢失时：① Task 标记 failed → 回退 dispatched → 新 Pod 重建 → Agent 从 PG 读取 Task Context 重新组装 → 从头执行；② 已 publish_artifact 的交付物存 MinIO 不丢失；③ Owner 收到 urgent 通知，可选择取消 Task 或等待重跑 |
| **数据库故障**（PG 主库宕机） | 主备切换 RTO ≤ 30s，LISTEN/NOTIFY 自动重连；outbox 表随 PG 主备同步，切换后未消费事件继续投递；agent_wakeup_requests TTL 7 天覆盖切换窗口；切换期间 Agent 无法认领 Task（checkout 依赖 PG）但已 running Task 不受影响（Runtime 独立运行）；超过 RTO 仍无恢复 → 所有 webhook 接收返回 503 + 重试 |
| **Marketplace 不可用** | 同步 RPC 超时重试（5s/30s/2min 最多 3 次）；Webhook at-least-once + 5 次退避；层 2 主动对账每 10min |

> **产物存储边界契约（基线 #7，M0.7 落实）**：`publish_artifact` 发布的 `deliverable`/`evidence` 类型产物强制存 MinIO/S3（耐久对象存储），PVC 仅作 Agent 工作目录与中间产物。`CSI_STORAGE_MODE=local` 仅影响工作目录后端，**不影响** publish_artifact 路径。因此 PVC 丢失时，已发布的交付物/证据不丢失（存 MinIO/S3）。`ObjectStoragePort.PublishArtifact` 契约见 §17.3.2。

### 15.3 卡住

| 场景 | 检测 | 处理 |
|------|------|------|
| **单 Task stalled**（无 live path） | Liveness Contract 检测 running 无 active run 超时 | 重试 1 次 → Stranded Recovery → escalate to Human |
| **单 Task 配置不完整** | Pre-dispatch 静态校验失败（substate=configuration_incomplete） | 平台周期重检（60s）+ 事件触发即时重检；24h 超时升级 |
| **Task in_review 无人认领** | 活性判据 24h | Orchestrator L1 催办 → L3 升级 Owner |
| **Task blocked 持续** | 活性判据 48h | Orchestrator L3 升级 Owner |
| **同一 Reviewer 同一原因驳回 3 次** | `same_reason_reject_streak` | 强制 `escalate_to_human` |
| **Harness Loop 耗尽**（达 `harness_max_attempts`，SOP 配置默认 4） | `harness_attempt` 上限 | 强制 `escalate_to_human` → Task blocked → Owner 可 @Architect 协助拆分（§9.2 P8 兜底） |
| **Orchestrator 误判卡顿** | Comment 纠正 | 平台不重置 SLA 但抑制同原因 24h wake |
| **Project 全停滞** | Watchdog：所有非 done Task 都 stalled | Tier 1 通知 Owner → Tier 2 Orchestrator inspection → Tier 3 Human inspection |

### 15.4 超时

详见 [§12.4 自动超时归属](#124-自动超时归属各管各的原则)。关键超时：

| 超时 | 时长 | 后果 |
|------|------|------|
| Spec 雇主确认 | 7 天 | 自动取消 Project |
| 交付验收 | 14 天 | 自动验收（delivery.auto_accepted） |
| 修订协商 | 2 天 | 默认 C（按现状验收完成） |
| Spec 变更判定 | 24h | escalate（urgent 通知 Owner + 冻结直至判定） |
| 取消响应 | 3 天 | 按阶段自动处理 |
| 席位满雇主决策 | 72h | 自动全部驳回 |
| Spec 驳回 | 5 次 | 触发协商取消 |
| 签约阶段总超时 | 30 天 | 触发协商取消 |
| 对话停滞 | 14 天 | 提醒级催办 |
| @mention 响应 | 4h | 升级通知 Owner |
| **Agent 执行超时（PRD §9.2）** | `task.estimated_days × 2`（默认倍数 2.0，SOP 可按 task_type 覆盖；超时由 `deadline_scanner` §10.8 扫描 `agent_runs.execution_deadline_at`） | 强制 terminate → `agent_runs.status=timed_out` → Task `failed` → Harness Loop（§7.7） |
| **Agent 执行警告**（PRD §9.2 第一档） | `task.estimated_days × 1`（单倍阈值） | reminder 通知 Agent Owner + Orchestrator，Task 继续执行 |
| G4 质检 | 30min | GATE_TIMEOUT |
| G5 测试 | 60min | GATE_TIMEOUT |
| Orchestrator Plan 生成 | 30min | Project 回到"契约已签订" |
| Watchdog 扫描 | 10min（间隔） | — |
| 巡检 | 4h（默认间隔） | — |

### 15.5 协商

| 场景 | 流程 |
|------|------|
| **Spec 变更** | 雇主发起 → 24h Agent Owner 判定（revision/new_requirement）→ new_requirement 雇主二次确认 → Spec 变更提案（3天对方响应）→ 确认（version+1）/ 拒绝（24h 协商窗口）→ 未一致进纠纷 |
| **修订协商**（revision_limit 耗尽） | 2 天协商窗口 → 4 选项（A追加修订/B Spec变更/C按现状验收/D转纠纷）→ A/B 需双方同意 → 2 天超时默认 C |
| **协商取消** | 雇主发起 → 3 天 Agent Owner 响应（accept/counter_proposal/reject）→ 3 天超时按阶段自动 → 部分结算方案雇主响应 → finalize / to_dispute |
| **纠纷** | 7 天申诉期内雇主发起 → Project"纠纷处理中"→ 冻结后续动作 → 等待平台仲裁 |

### 15.6 Agent Owner 中途退出

| 场景 | 处理 |
|------|------|
| **Agent Owner 主动退出 Project** | Project 暂停 → 通知雇主（urgent 级）；已产生交付物归属雇主（不收回）；未完成结算按平台规则处理（部分结算/退款）；违规封禁由平台介入仲裁 |
| **Agent Owner 被封禁** | 平台介入 → Project 进入纠纷处理中 → 等待平台仲裁 → 按 §12.2 场景十仲裁流程处理 |

---

## 第 16 章 PRD 对齐矩阵

### 16.1 业务规则覆盖对照

| PRD 章节 | 业务规则 | 技术方案落地 |
|---------|---------|-------------|
| §5 商机 | 商机 Push/Pull/Manual | §3.1 Opportunity + §12.2 场景一 |
| §5.1 商机匹配 | 推送匹配度算法、60 分阈值、30 天冷启动保底 | §3.1 Opportunity（match_score 字段）；匹配算法由 Marketplace 负责，Console 接收已过滤商机 |
| §5.3 席位 | 全局最大席位数配置 | §12.1 通用约定（Marketplace 全局配置） |
| §5 竞标 | 席位、竞标方案、选标 | §12.2 场景二/三；席位满 409；72h 超时全部驳回 |
| §5.6 选标 | 综合分排序、平台推荐标签、再次竞标资格矩阵、强制终止 | §12.2 场景二/三（排序/标签由 Marketplace 负责）；§3.1 Opportunity 状态机（再次竞标资格由状态守卫） |
| §5.6.5 选标不可反悔 | Marketplace Order 已 contract_signing 不回滚 | §12.2 Project 创建失败兜底（webhook 重试 + 死信告警，Order 不回滚） |
| §6 Spec | 需求澄清、Spec 生成、雇主确认 | §6 Spec 契约层 + §12.2 场景四；Project Task + @mention 替代工作流编排 |
| §6 Spec 兜底 | 7天/5次/30天/14天 | §6.3 Spec 签订兜底表 |
| §6.3 Spec 澄清 | 需求澄清 5 轮 + Spec 修订 3 轮独立计数、超限三选一、不计违约率 | §6.3 Spec 签订兜底表（独立计数 + 三选一） |
| §7.3 Plan 校验 | DAG 无环/依赖存在/孤立节点/断裂节点/子 Task 层级 5 项校验 | §8.3 执行拦截框架（Guard hook：DAG 无环 + 依赖存在；软警告项在 Plan 审批页展示） |
| §7.5 Harness | 第 3 次重试可更换 Agent | §7.7 Harness Loop（task_revision_negotiations 表 resolution=change_executor） |
| §7.6 Goal Mode | 20% 工时阈值、达阈暂停、Owner 审批、不计验收 | §10.7 Goal Mode 完整流程 |
| §7.7 修订 | revision_limit、修订协商 4 选项 | §12.2 场景六；2 天超时默认 C |
| §7.7 Spec 变更 | 24h 判定、二次确认 | §6.2（24h 超时 escalate 契约门）+ §12.2 场景七 + §7.4 层 1 |
| §7.8 Owner 边界 | Agent Owner 不可单方面关闭执行中+ Project | §2.7 RBAC（Agent 硬边界：Project 取消禁止） |
| §7.9 通知 | 三级通知、聚合 | §11.3 通知分级 + §11.4 聚合 |
| §7.10 Agent Team | Team 模式 Harness 计数差异 | §7.7 Harness Loop（Team 层级默认 3 次） |
| §7.12 预算超限 | 80% 告警 / 100% 自动暂停 / Owner 三选一（增预算/优化 Plan/放弃）/ Task 级联 / 恢复边 | §3.2 预算超限全链路（检测/告警/暂停/三选一入口/恢复）+ §8.3 Project 转移边表（`executing→budget_paused` / `budget_paused→executing` / `budget_paused→cancelling`）+ 附录 A.1（`budget_paused` 子状态） |
| §8 实体 | Workspace/Agent/Runtime/Project/Task/Spec | §1.2 54 表 + 2 视图 |
| §8 状态机 | Project/Task 状态机 | 附录 A |
| §9 交付 | 交付物、14 天验收、自动验收 | §12.2 场景五；gates_status 全 passed 才提交 |
| §9.2 Agent 超时 | 单倍警告 + 2 倍强制终止 → Task failed → Harness Loop | §2.4 Agent 执行超时机制（双档处理 + SOP 可配 multiplier + daemon 侧 inactivity watchdog）+ §15.4 超时表（Agent 执行超时 / 执行警告 两行）+ §10.8 deadline_scanner 扫描 `agent_runs.execution_deadline_at` |
| §9.4 申诉 | 7 天申诉期、纠纷 | §12.2 场景九；appeal_period_closed → 终态 |
| §9.5 并发选标 | 实时快照、以 DB 当前状态为准 | §12.2 场景三（选标以 DB 为准，已失效竞标返回 410） |
| §9.6 结算 | 里程碑权重结算 | §14.5 交付验收与结算 + §12.2 场景九（结算公式）；`(project_id)` UNIQUE（已落 999443） |
| §9.6.1 协商取消 | 部分结算、3 天响应 | §12.2 场景八 + §15.5；auto-resolve 按阶段 |
| §9.7 Owner 退出 | Project 暂停、交付物归属、结算规则 | §15.6 Agent Owner 中途退出 |
| 场景十 纠纷仲裁 | 仲裁流程、四选项结果、状态机出口 | §12.2 场景十 + 附录 A.1（dispute_in_progress 状态机出口） |
| SMS 偏差 | PRD 提到短信，公测版不启用 | §11.3（sms 渠道公测版预留接口不启用，P2 启用） |

### 16.2 哲学一致性自检

| 哲学 | 自检项 | 结论 |
|------|--------|------|
| **P1 Agent 一等公民** | 全 schema 16+ 处多态 `(actor_type, actor_id)`；UI assignee 下拉 Agent/Human 同列；MCP 工具按角色注入；无任何硬编码"只有 Human 能做"的操作（除 RBAC 硬边界：Workspace 管理/权限管理/Plan 审批/预算调整等治理操作，这些是 Owner 治理权而非 Agent 能力限制） | ✅ 通过（P1 口径见下） |
| **P2 依赖关系是活的** | `add_dependency`/`remove_dependency`/`create_subtask` MCP 工具；加边到 done 上游触发回锁 reopen；无固定 DAG 锁死；Agent 执行中可动态演化 | ✅ 通过 |
| **P3 平台强制执行** | Floor1 提交门 / Floor2 Execution Policy / Floor3 Evidence Gates / 拦截器 Guard+Gate hook 全部平台代码拦截；不靠 Agent 自觉 | ✅ 通过 |
| **P4 Task 管理非流程编排** | 无 Temporal/Camunda/LangGraph；Phase 1/2 用 Project Routine（事件驱动 Task 序列）；Phase 3 用 Orchestrator Agent + 依赖自动解锁；Spec 签约用 Project Task + @mention | ✅ 通过 |

> **P1 公测版口径**（M0.6a 决策）：自检项"UI assignee 下拉 Agent/Human 同列"指 schema 多态字段 + UI 展示层面 Agent/Human 平等；P1 公测版 Human 不直接 claim/submit Task（无 Atomic Checkout 路径），执行类 Task 的 assignee 约束为 agent，Human 仅通过 comment / approve / request_changes / @mention 协作介入。长期愿景"Runtime vs 浏览器执行对等"保留，P2/P3 演进（见 §2.2.1 + §2.2.2）。

### 16.3 端到端可追溯性自检

| 链路 | 覆盖 |
|------|------|
| 商机 → 竞标 → 中标 → Project 创建 | §12.2 场景一/二/三 + §14.1 |
| Project 创建 → Spec 签订 → 契约锁定 | §6 + §12.2 场景四 + §14.2 |
| 契约锁定 → Plan 生成 → 开发执行 → 验收 | §10.2 + §14.3 + §7 质量保障 |
| 验收 → 交付 → 雇主验收 → 结算 → 申诉期 → 终态 | §12.2 场景五/九 + §14.5 |
| 异常：Spec 变更 / 修订 / 取消 / 纠纷 | §6.2 + §12.2 场景六/七/八 + §15.5 |
| 异常：离线 / 崩溃 / 卡住 / 超时 | §9.4 + §10.5 + §15.1-15.4 |

### 16.4 数据模型完整性自检

所有实体有表结构：54 表 + 2 视图，覆盖 Workspace 资源层（9）、Project 执行层（10）、Project Routine 层（4）、产物管理层（6）、Spec 契约层（2）、系统级（5）、RBAC（3）、审计日志（1，activity_log 已在系统级计数）、文档并发（2，ALTER project_documents 不计新表）、事件驱动（3）、质量保障与监控（6）、系统监控（3）。完整 DDL 见 `schema-unified.sql`（公测版补齐 54 表 + 2 视图，部分表 DDL 在后续迭代补齐）。

---

## 第 17 章 工程架构与外部依赖适配（Ports & Adapters）

> **核心目标**：将"独立优先 + 适配器对接"工程思想从 UI 层推广到全栈。业务核心（自主交付五层哲学 + 四条不变性 + 状态机 + Interceptor + Floor + Gate）位于六边形内部，所有外部依赖通过 Port 接口注入，确保：
> 1. Console 当前独立可运行（不阻塞于 CSI 平台任何版块）
> 2. CSI 平台就绪后逐 Port 灰度切换，业务代码零改动
> 3. 局部重构安全（外部演进在 Adapter 内消化，核心不被动摇）
>
> **决策依据**：[DR-11](#dr-11-全栈-ports--adapters-六边形架构)（从 UI 决策升级为全栈架构决策）。
>
> **配套文档**：[console-ui-design.md §17](console-ui-design.md)（前端 5 Port 已落地定义）。

### 17.1 全局架构视图（六边形）

```
       ┌─────────────────────────────────────────────────────────┐
       │                                                         │
       │            CSI Agent Owner Console 业务核心              │
       │           （Hexagon / 自主交付核心，纯 Go）              │
       │                                                         │
       │   ┌───────────────────────────────────────────────┐    │
       │   │  自主交付五层哲学（不可妥协）                    │    │
       │   │  P1 Agent 一等公民 / P2 活依赖 /               │    │
       │   │  P3 平台强制 / P4 Task 管理非流程编排           │    │
       │   └───────────────────────────────────────────────┘    │
       │                                                         │
       │   核心模块（不 Port 化，是 hexagon 内部）：              │
       │   · Workspace / Agent / Runtime 实体模型                │
       │   · Project / Project Task / Task Dependencies          │
       │   · Spec 契约 / Plan Decomposition                      │
       │   · Interceptor 框架（Guard / Gate / Side Hook）        │
       │   · Floor 0-4 质量防线 / Evidence Gates G1-G6           │
       │   · Harness Loop / Liveness Contract                    │
       │   · Routine 引擎（事件驱动 Task 序列）                  │
       │   · 状态机（Project / Task / Spec / Opportunity）       │
       │   · 事件 Outbox + LISTEN/NOTIFY（已有抽象）             │
       │                                                         │
       └──┬──────┬──────┬──────┬──────┬──────┬──────┬──────┬───┘
          │      │      │      │      │      │      │      │
       ┌──▼──┐┌──▼──┐┌──▼──┐┌──▼──┐┌──▼──┐┌──▼──┐┌──▼──┐┌──▼──┐
       │Auth ││Opp  ││Settl││Notif││Cross││Runtm││ObjSt││LLM  │
       │Port ││Port ││Port ││Port ││Port ││Port ││Port ││Port │
       └─┬─┬─┘└─┬─┬─┘└─┬─┬─┘└─┬─┬─┘└─┬─┬─┘└─┬─┬─┘└─┬─┬─┘└─┬─┬─┘
         │ │    │ │    │ │    │ │    │ │    │ │    │ │    │ │
    Local│ │CSI │ │CSI │ │CSI │ │CSI │ │CSI │ │CSI │ │CSI │ │多模型
    Adapt│ │Adapt│ │Adapt│ │Adapt│ │Adapt│ │Adapt│ │Adapt│ │Adapt
         │ │    │ │    │ │    │ │    │ │    │ │    │ │    │ │
       ✅ 🟡  ✅ 🟡  ✅ 🟡  ✅ 🟡  ✅ 🟡  ✅ 🟡  ✅ 🟡  ✅ 🟡
       默认 预留 默认 预留 默认 预留 默认 预留 默认 预留 默认 预留 默认 预留 默认 路由

       ✅ = 当前启用（LocalAdapter，基于 Multica fork）
       🟡 = 预留骨架（CSIAdapter / 可替换 Adapter，CSI 平台就绪后切换）
```

**六边形铁律**：
- 业务核心**只依赖 Port 接口**（`interfaces` 包），不 import 任何 Adapter 实现
- Adapter 实现**只实现 Port 接口**，不被业务核心感知
- 启动时通过 DI 容器（Go wire / 手写 factory）按环境变量注入对应 Adapter
- Port 接口定义在 `internal/ports/`，Adapter 实现在 `internal/adapters/{local,csi}/`

### 17.2 10 个 Port 清单（全栈，DR-12 增补第 10 个）

| # | Port | 职责 | LocalAdapter（当前） | CSIAdapter / 可替换 | 现有方案章节 |
|---|------|------|---------------------|--------------------|----|
| 1 | `AuthPort` | 用户登录 / 会话 / 深链 token | Multica 本地账户（JWT） | CSI IDP SSO（OIDC） | UI §2.4 |
| 2 | `OpportunitySourcePort` | 商机来源 / 创建 / 同步 | 手动新建（`manual_assign`） | Marketplace API（Push/Pull） | 第 12 章场景一 |
| 3 | `SettlementPort` | 结算记录 / 查询 / 触发 | 本地 `settlements` 表 | Marketplace 结算单同步 | 第 12 章场景八 |
| 4 | `NotificationChannelPort` | 外部通知渠道（邮件/短信/Push） | Console 内置 SMTP + PWA Push | CSI 平台通知服务 | 第 11 章 §11.3 |
| 5 | `CrossModuleLinkPort` | 跨版块链接生成 | 返回 null（隐藏入口） | 一次性 sid 跨站链接 | UI §17.5 |
| 6 | `RuntimeProvisionerPort` | Runtime 创建/销毁/扩缩容 | K8s API（client-go） | K8s API（不变）/ Docker（测试） | 第 9 章 §9.3-9.4 |
| 7 | `ObjectStoragePort` | 产物/附件/Spec 文档存储 | 本地 PVC / MinIO | S3 / OSS / CSI 对象存储 | 第 5 章 |
| 8 | `LLMProviderPort` | LLM 调用（Layer 1 系统 Prompt + Agent 推理） | OpenAI API | Anthropic / 本地模型 / **平台统一 LLM 网关（`GatewayProvider`，DR-12）** | 第 9 章 §9.1 |
| 9 | `WebhookInboundPort` | 接收外部 Webhook（M→C 方向） | Console HTTP Webhook 端点 | CSI 平台 webhook 路由分发 | 第 12 章 §12.1 |
| 10 | `EntitlementPort` | 订阅套餐 / 权益目录 / LLM 额度 / 用量账单（只读 + 校验） | 全放行（无限额度、全目录开放） | 平台 LLM 网关与计费服务 | §17.3.5（DR-12） |

> **新增 Port（相对 UI §17 的 5 个）**：6-9 是后端推广新增的 Port。其中 `RuntimeProvisionerPort` 第 9 章已存在 interface，本次规范化；`ObjectStoragePort` / `LLMProviderPort` / `WebhookInboundPort` 是新抽象。
>
> **DR-12（2026-08-20）**：第 10 个 Port `EntitlementPort` 承载"owner↔平台"订阅计费的商业化面（套餐/权益/额度/账单，只读+校验）；LLM 调用与计量面不新增 Port——平台统一 LLM 网关作为 `LLMProviderPort` 的 CSIAdapter（`GatewayProvider`）接入。权益校验键 = `org_id`（Org/账号级订阅），计量归集键 = `workspace_id`（`TenantID`）。

### 17.3 后端 Port 接口定义（Go）

#### 17.3.1 RuntimeProvisionerPort（规范化第 9 章已有 interface）

```go
// internal/ports/runtime_provisioner_port.go
package ports

type RuntimeProvisionerPort interface {
    // 创建 RuntimeInstance（K8s Deployment + PVC + Service）
    Provision(ctx context.Context, req ProvisionRequest) (RuntimeInstance, error)

    // 销毁 RuntimeInstance（级联删除 PVC）
    Destroy(ctx context.Context, instanceID string) error

    // 扩缩容（调整 replicas）
    Scale(ctx context.Context, instanceID string, replicas int) error

    // 健康检查（Pod 状态 + 心跳）
    Health(ctx context.Context, instanceID string) (RuntimeHealth, error)

    // 能力声明（运维层据此决定可用功能）
    Capabilities() RuntimeCapabilities
}

type RuntimeCapabilities struct {
    SupportsAutoScale   bool
    SupportsGPU         bool
    SupportsSidecar     bool  // false = DR-2(Runtime) 单容器模型
}
```

**实现**：
- `K8sRuntimeProvisioner`（`internal/adapters/local/k8s_provisioner.go`）：直接 client-go 调原生 K8s 资源（DR-1 Runtime 不引入 CRD）
- `MockRuntimeProvisioner`（`internal/adapters/test/mock_provisioner.go`）：单元测试用，模拟 Pod 生命周期

#### 17.3.2 ObjectStoragePort

```go
// internal/ports/object_storage_port.go
package ports

type ObjectStoragePort interface {
    // 上传对象（产物中间件/附件草稿/Spec 文档草稿，工作目录 scratch 写入）
    // local 模式下可走 LocalObjectStorage(PVC)。
    Put(ctx context.Context, bucket, key string, reader io.Reader, contentType string) (ObjectRef, error)

    // PublishArtifact 发布产物到耐久对象存储。
    // 当 artifact_type ∈ {deliverable, evidence} 时，实现必须路由到 MinIO/S3
    // adapter，不得使用 LocalObjectStorage(PVC)，不受 CSI_STORAGE_MODE=local 影响。
    // artifact_type ∈ {phase_output, reference} 时按 CSI_STORAGE_MODE 指定后端。
    PublishArtifact(ctx context.Context, req PublishArtifactRequest) (ObjectRef, error)

    // 下载对象
    Get(ctx context.Context, bucket, key string) (io.ReadCloser, error)

    // 生成签名 URL（给雇主/Agent 临时访问）
    SignedURL(ctx context.Context, bucket, key string, ttl time.Duration) (string, error)

    // 删除对象
    Delete(ctx context.Context, bucket, key string) error

    Capabilities() StorageCapabilities
}

// PublishArtifactRequest 是发布产物的请求。
type PublishArtifactRequest struct {
    ArtifactType string    // deliverable | phase_output | evidence | reference
    Bucket       string
    Key          string
    Reader       io.Reader
    ContentType  string
    TaskID       string    // 关联 Task，用于审计
}

type StorageCapabilities struct {
    SupportsVersioning bool
    SupportsLifecycle  bool  // 自动过期归档
    MaxObjectSize      int64
}
```

> **publish_artifact 路径强制约束（基线 #7，M0.7 落实）**：当 `artifact_type ∈ {deliverable, evidence}` 时，`PublishArtifact` 实现必须路由到 `MinIOStorage`/`S3Storage`，**不得**使用 `LocalObjectStorage`（PVC），**不受** `CSI_STORAGE_MODE=local` 影响。`Put` 方法保留用于工作目录 scratch 写入（local 模式下走 PVC）。`artifact_type ∈ {phase_output, reference}` 时按 `CSI_STORAGE_MODE` 指定后端。

**实现**：
- `LocalObjectStorage`（`internal/adapters/local/pvc_storage.go`）：本地 PVC 路径挂载（公测版默认，零外部依赖）—— **仅用于 `Put`（工作目录 scratch 写入）**，不承接 `deliverable`/`evidence` 的 `PublishArtifact`
- `MinIOStorage`（`internal/adapters/local/minio_storage.go`）：MinIO 自托管（开发/测试环境，承接 `PublishArtifact` 强制耐久路径）
- `S3Storage`（`internal/adapters/csi/s3_storage.go`）：AWS S3 / 阿里云 OSS（CSI 平台生产环境，承接 `PublishArtifact` 强制耐久路径）

**配置切换**：`CSI_STORAGE_MODE=local|minio|s3`（仅影响工作目录后端与 `phase_output`/`reference` 的 `PublishArtifact`；`deliverable`/`evidence` 的 `PublishArtifact` 始终走 MinIO/S3，local 模式下需配置开发环境 MinIO 实例）

#### 17.3.3 LLMProviderPort

```go
// internal/ports/llm_provider_port.go
package ports

type LLMProviderPort interface {
    // 同步对话（Layer 1 系统 Prompt + Agent 推理）
    // 取消语义：ctx.Err()==context.Canceled 时返回 ChatResponse{Cancelled:true, FinishReason:"cancelled"}
    Chat(ctx context.Context, req ChatRequest) (ChatResponse, error)

    // 流式对话（Agent Run transcript 流式推送）
    ChatStream(ctx context.Context, req ChatRequest) (<-chan ChatChunk, error)

    // Embedding（质量档案相似度计算 / 文档检索）
    Embed(ctx context.Context, text string) ([]float32, error)

    // 能力声明（Orchestrator 据此分配 Agent 任务）
    Capabilities() LLMCapabilities
}

// ChatResponse 是同步对话的完整返回（D.2#17 补全：用量/成本/模型版本/租户归属/取消语义）
type ChatResponse struct {
    Content      string         // 模型输出文本
    Model        string         // 实际响应的模型版本（如 "gpt-4-0613"）
    Usage        TokenUsage     // 用量
    Cost         CostBreakdown  // 成本（USD，由 Adapter 基于 Usage + 定价表计算）
    TenantID     string         // 租户归属（多租户成本归集）
    FinishReason string         // "stop"|"length"|"tool_call"|"cancelled"|"content_filter"
    Cancelled    bool           // 取消语义（ctx.Done() 或客户端取消）；为 true 时 FinishReason 必须为 "cancelled"
}

type TokenUsage struct {
    Prompt     int  // 输入 token
    Completion int  // 输出 token
    Total      int
}

type CostBreakdown struct {
    Input  float64
    Output float64
    Total  float64
}

// ChatChunk 是流式对话的增量帧（网关 task 08-28 DR-2 记录性修文：计量帧字段）。
type ChatChunk struct {
    Delta        string // 增量文本
    FinishReason string
    // 计量字段（对接文档 §1.2 硬性要求 #1）：仅流式最终 usage 帧（Metered=true）
    // 携带——网关权威 usage/cost/model 落在最终帧，消费方汇聚为完整 ChatResponse
    // 语义（daemon 本地代理消费同帧，同源 D-15）。Local OpenAI provider 的流
    // 不携带 usage 帧，这些字段为零（缺计量 = 零值，非错误）。
    Usage   TokenUsage
    Cost    CostBreakdown
    Model   string
    Metered bool
}

type LLMCapabilities struct {
    MaxContextTokens  int
    SupportsStreaming bool
    SupportsToolCall  bool
    SupportsVision    bool
    ModelTier         string  // "flagship" | "standard" | "lite"
}
```

**实现**：
- `OpenAIProvider`（`internal/adapters/local/openai_provider.go`）：OpenAI API（公测版默认）
- `AnthropicProvider`（`internal/adapters/local/anthropic_provider.go`）：Claude 系列
- `GatewayProvider`（`internal/adapters/csi/gateway_provider.go`）：平台统一 LLM 网关（DR-12；网关 task 08-28 落地——L1/L2/L3 经 `GatewayClient`，多模型路由由网关服务端承担，`llm_router.go` skeleton 已删）

**配置切换**：`CSI_LLM_MODE=openai|csi`（`router`/`anthropic` 为 legacy 别名值，均落 GatewayProvider 语义）

> **关键意义**：`LLMProviderPort` 让 CSI 不绑定单一 LLM 厂商，未来可按角色/成本/质量动态路由。Orchestrator 通过 `Capabilities()` 感知模型能力，决定任务分配策略。

#### 17.3.4 WebhookInboundPort

```go
// internal/ports/webhook_inbound_port.go
package ports

type WebhookInboundPort interface {
    // 接收外部 Webhook（Marketplace / CSI 平台 / 第三方）
    Handle(ctx context.Context, event WebhookEvent) (WebhookAck, error)

    // 注册 Webhook 路由（启动时各业务模块注册自己关心的事件类型）
    Register(eventType string, handler WebhookHandler) error

    // Webhook 重放（死信恢复 / 手动重试）
    Replay(ctx context.Context, eventID string) error
}
```

**实现**：
- `LocalWebhookReceiver`（`internal/adapters/local/webhook_receiver.go`）：Console 直接暴露 HTTP Webhook 端点（第 12 章 17 个 M→C 端点）
- `CSIWebhookRouter`（`internal/adapters/csi/webhook_router.go`）：CSI 平台统一 Webhook 路由分发（Console 订阅 CSI 事件总线，而非直接暴露端点）

**配置切换**：`CSI_WEBHOOK_MODE=local|csi`

#### 17.3.5 EntitlementPort（DR-12，2026-08-20 新增第 10 个 Port）

```go
// internal/ports/entitlement_port.go
package ports

// EntitlementPort 承载"owner ↔ 平台"订阅计费的商业化面：套餐/权益目录/额度/账单。
// 订阅主体 = Org/账号级；权益校验键 = org_id；计量归集键 = workspace_id（TenantID）。
// 只读 + 校验语义：购买/升级/充值等写操作走平台侧界面，不经 Console。
type EntitlementPort interface {
    // 查询当前订阅套餐（含免费额度状态、周期边界 PeriodStart/PeriodEnd 与
    // 重置锚点 ResetAt，E1）
    GetPlan(ctx context.Context, orgID string) (SubscriptionPlan, error)

    // 权益目录：可用 LLM 模型清单（结构化 ModelEntry：ID/Tier/旗舰标记，E2）/
    // 可部署 RuntimeProfile/Version 范围 / 云端 RuntimeInstance 数上限
    // （Console 创建页可选列表与创建前校验的数据源）
    GetCatalog(ctx context.Context, orgID string) (EntitlementCatalog, error)

    // LLM 额度状态（余额/周期总量/已用/周期边界/免费额度信封，E3）——
    // Pre-dispatch 动态校验与 /settings/billing 展示共用
    GetQuota(ctx context.Context, orgID string) (QuotaStatus, error)

    // 用量与账单报告（/settings/billing 数据源 + 对账拉取，E4）。
    // 键 = 计量归集键 workspace_id（网关 task D-03 演进：对账拉取按归集键查询；
    // 权益校验键仍是 org_id——两类键并存于同一 Port，按调用面区分：
    // E1-E3 走 org_id，E4 走 workspace_id）；支持增量拉取（返回 Cursor 由
    // 调用方持久化续传）并携带 run 级明细 Items。
    GetUsage(ctx context.Context, workspaceID string, period Period) (UsageReport, error)

    Capabilities() EntitlementCapabilities
}
```

商业化 DTO 落码形态（网关 task 08-28-csi-gateway-integration DR-1/DR-2 记录性修文——M4 骨架最小面按对接文档 E1-E4 契约补全，字段语义以 `server/internal/ports/entitlement_port.go` 为准）：

```go
type SubscriptionPlan struct {
    ID                 string    // 平台侧套餐标识（Local: "local"）
    Name               string
    Status             string    // active | trial | expired（网关可透传 cancelled）
    FreeQuotaRemaining int64     // 剩余免费额度积分（Local: -1 = 无限）
    PeriodStart        time.Time // 当前订阅周期起点（零值 = 无周期约束，Local）
    PeriodEnd          time.Time // 当前订阅周期终点（E1）
    ResetAt            time.Time // 下次额度周期重置锚点（E1；零值 = 无重置排程）
}

type ModelEntry struct { // E2 结构化模型条目（"*" 通配仅 Local 语义）
    ID       string // 平台模型标识（与 L1 chat 的 model 参数同一命名空间）
    Tier     string // "lite" | "standard" | "flagship"（网关无 tier 时为空）
    Flagship bool   // 套餐旗舰模型（创建页高亮）
}

type EntitlementCatalog struct {
    Models                   []ModelEntry
    RuntimeProfiles          []string // "*" = 通配
    MaxCloudRuntimeInstances int      // -1 = 无上限
}

type FreeQuotaState struct { // 公测免费额度信封（E3）
    Active     bool
    ValidUntil time.Time
}

type QuotaStatus struct {
    Exhausted       bool          // 4xx 业务态（PREDISPATCH_LLM_QUOTA_EXHAUSTED）
    RemainingTokens int64         // -1 = 无限
    PeriodStart     time.Time
    PeriodEnd       time.Time
    TotalTokens     int64         // 周期总量额度（-1 = 无限，Local）
    UsedTokens      int64         // 周期内已用量
    FreeQuota       FreeQuotaState
}

type UsageItem struct { // E4 run 级明细行（K2 run 关联——对账比对的明细粒度）
    AgentRunID    string // 关联的 agent_task_queue run id（空 = 网关无法归属 run——滥用检测信号）
    InputTokens   int64
    OutputTokens  int64
    TotalTokens   int64
    CostCents     int64 // 网关计价的整数分
    Model         string
}

type UsageReport struct {
    Period       Period
    Requests     int64
    InputTokens  int64
    OutputTokens int64
    CostCents    int64
    Cursor       string      // 网关增量游标（csi_entitlement_reconcile_state 持久化续传；形态由网关定义，Console 视为不透明）
    Items        []UsageItem // run 级用量明细（E4；空 = 仅聚合）
}
```

**错误语义**：额度耗尽 / 套餐外模型或规格 / 实例数超限 = **4xx 业务态拒绝（不可重试）**，错误码族见附录 B.6；不得落入 `UPSTREAM_*` / `INTERNAL_*` 可重试族。Pre-dispatch 侧对应 `PREDISPATCH_LLM_QUOTA_EXHAUSTED` / `PREDISPATCH_MODEL_NOT_ENTITLED`（附录 B.3）。

**缓存口径**：权益目录（GetCatalog）Console 侧可缓存（TTL ≤ 5min）；额度（GetQuota）与写路径校验（创建 RuntimeInstance / 创建 Agent 选模型）必须实时查询。

**对账**：网关计量为唯一权威；Console `agent_runs`（物理 `agent_task_queue`）`token_usage_*`/`cost_cents` 为落账副本。Console 周期性拉取 `GetUsage`（键 = workspace 归集键）与本地比对（每小时增量 + 每日全量），偏差超阈值（默认 0.5%，可配置）写 `watchdog_logs` + reminder 通知 Owner；run 级差值（网关计量到 Console 未落账的 run）触发 urgent + K3 key 轮换（滥用检测）。

**实现**：
- `LocalEntitlement`（`internal/adapters/local/entitlement.go`）：全放行——无限额度、全目录开放、用量返回空报告；Local 模式独立闭环不被新版块阻塞
- `CSIEntitlementAdapter`（`internal/adapters/csi/entitlement.go`）：平台 LLM 网关与计费服务（DR-12；网关 task 08-28 落地——E1-E6/K1/K3 经 `GatewayClient`，org 键翻译在 dispatcher checker，D-04）
- billing 数据面 API（D-17）：`GET /api/workspaces/{id}/entitlement/plan|quota|usage`（数据面 only；`/settings/billing` 前端页面留 M5/M6）

**配置切换**：`CSI_ENTITLEMENT_MODE=local|csi`

### 17.4 配置驱动切换（环境变量矩阵）

```bash
# .env.local（当前阶段，全部 Local，Console 独立运行）
CSI_AUTH_MODE=local
CSI_OPPORTUNITY_MODE=local
CSI_SETTLEMENT_MODE=local
CSI_NOTIFICATION_MODE=local
CSI_CROSS_MODULE_MODE=local
CSI_RUNTIME_MODE=k8s                  # Runtime 始终 K8s，无 Local 替代
CSI_STORAGE_MODE=local                # local | minio | s3
CSI_LLM_MODE=openai                   # openai | csi（平台统一 LLM 网关，DR-12；router/anthropic 为 legacy 别名值，网关 task D-18 值族对齐 local|csi）
CSI_WEBHOOK_MODE=local
CSI_ENTITLEMENT_MODE=local            # local（全放行）| csi（平台订阅权益计费，DR-12）

# .env.csi（CSI 平台就绪后，逐项切换）
CSI_AUTH_MODE=csi
CSI_OPPORTUNITY_MODE=csi
CSI_SETTLEMENT_MODE=csi
CSI_NOTIFICATION_MODE=csi
CSI_CROSS_MODULE_MODE=csi
CSI_RUNTIME_MODE=k8s                  # 不变
CSI_STORAGE_MODE=s3
CSI_LLM_MODE=csi                      # 平台统一 LLM 网关（DR-12，GatewayProvider）；多模型路由由网关服务端承担
CSI_WEBHOOK_MODE=csi
CSI_ENTITLEMENT_MODE=csi              # 平台订阅权益计费（DR-12）
```

**DI 容器组装**（Go wire / 手写 factory）：

```go
// internal/container/container.go
func NewContainer(cfg Config) *Container {
    return &Container{
        AuthPort:           newAuthAdapter(cfg.AuthMode),
        OpportunityPort:    newOppAdapter(cfg.OppMode),
        SettlementPort:     newSettlementAdapter(cfg.SettlementMode),
        NotificationPort:   newNotificationAdapter(cfg.NotificationMode),
        CrossModulePort:    newCrossModuleAdapter(cfg.CrossModuleMode),
        RuntimePort:        newRuntimeAdapter(cfg.RuntimeMode),  // 始终 k8s
        StoragePort:        newStorageAdapter(cfg.StorageMode),
        LLMPort:            newLLMAdapter(cfg.LLMMode),
        WebhookPort:        newWebhookAdapter(cfg.WebhookMode),
        EntitlementPort:    newEntitlementAdapter(cfg.EntitlementMode),  // DR-12
    }
}
```

### 17.5 独立运行边界（Local 模式功能矩阵）

| 功能 | Local 模式 | 说明 |
|------|-----------|------|
| 账户登录 | ✅ | Multica 本地账户 |
| 手动新建商机 | ✅ | 独立闭环核心（UI §4.6） |
| Marketplace 竞标 | ❌ 跳过 | 手动创建直接 won |
| Spec 签约 | ✅ | Owner 自代雇主角色 |
| Plan 生成与执行 | ✅ | Agent 自主，不依赖外部 |
| 交付与验收 | ✅ | Owner 手动验收 |
| 结算 | ⚠️ 本地记录 | 仅 Console 内部，无真实付款 |
| 邮件通知 | ✅ | Console 内置 SMTP |
| 短信/Push | ⚠️ 仅 PWA Push | 短信需 CSI 平台 |
| 跨版块跳转 | ❌ 隐藏入口 | `CrossModuleLinkPort` 返回 null |
| Runtime 创建 | ✅ | K8s API（始终可用） |
| Agent 工作目录存储 | ✅ | 本地 PVC |
| 发布产物存储 (deliverable/evidence) | ✅ | MinIO（强制，不受 local 模式影响） |
| LLM 推理 | ✅ | OpenAI / Anthropic |
| Webhook 接收 | ✅ | Console 直接暴露端点 |
| 权益/额度校验 | ✅ | `EntitlementPort` LocalAdapter 全放行（无限额度、全目录开放，DR-12） |

> **结论**：Local 模式覆盖可验证内部交付闭环（跳过真实竞标/支付，Owner 同时扮演雇主）。Marketplace/Settlement 走契约测试替身。仅缺真实竞标竞争、真实付款、跨版块协同。足以支撑内部演示、测试、Agent 训练、流程验证、CI/CD 全链路验证。

### 17.6 迁移路径（从扁平集成到 Port 化）

现有 Technical-Solution.md 是"扁平集成"视角（第 9/11/12 章直接描述外部依赖实现）。迁移路径：

| 阶段 | 动作 | 业务影响 |
|------|------|---------|
| 1. 定义 Port 接口 | 在 `internal/ports/` 定义 9 个 Port interface（DR-12 后增补第 10 个 `EntitlementPort`） | 零影响（纯新增） |
| 2. 提取 LocalAdapter | 将第 9/11/12 章现有实现包装为 LocalAdapter | 零影响（重命名/移动） |
| 3. 业务核心改依赖 Port | 业务模块 import `ports.XxxPort` 而非具体实现 | 编译期改动，运行时零影响 |
| 4. DI 容器组装 | 启动时按环境变量注入 Adapter | 零影响（默认全 Local） |
| 5. 预留 CSIAdapter 骨架 | 实现空壳 CSIAdapter，方法返回 `NotImplemented` | 零影响（未启用） |
| 6. CSI 就绪后逐 Port 切换 | 实现 CSIAdapter 方法，环境变量切换 | 逐 Port 灰度，业务零改动 |

> **关键**：阶段 1-5 在公测版前完成，零业务影响。阶段 6 是 CSI 平台就绪后的渐进式切换。

### 17.7 Port 化的反模式（避免过度抽象）

以下情况**不 Port 化**，避免过度抽象增加维护成本：

| 反模式 | 说明 | 理由 |
|--------|------|------|
| PostgreSQL Port 化 | ❌ | sqlc 已是 ORM 抽象，再 Port 化多此一举 |
| LISTEN/NOTIFY Port 化 | ❌ | PG 原生功能，基础设施层稳定 |
| 状态机 Port 化 | ❌ | 是 hexagon 内部核心规则，非外部依赖 |
| Interceptor / Floor / Gate Port 化 | ❌ | 是 hexagon 内部核心规则 |
| MCP 工具 Port 化 | ❌ | 是 Agent 与平台的契约，非外部依赖 |
| K8s client-go Port 化 | ❌ | `RuntimeProvisionerPort` 已封装，不再下沉 |
| HTTP Router Port 化 | ❌ | chi router 是 Multica 基座，稳定 |

> **判断准则**：Port 化的对象必须是"有切换/演进需求的外部依赖"。基础设施（DB/Cache/Queue）已有成熟抽象，核心业务规则不是外部依赖，都不 Port 化。

### 17.8 测试策略（Port 化带来的可测试性红利）

Port 化让核心业务可完全脱离外部依赖测试：

| 测试层 | 工具 | 范围 |
|--------|------|------|
| **单元测试** | Go testing + Mock Adapter | 业务核心（状态机/Interceptor/Routine/Gate）用 Mock Adapter，零外部依赖 |
| **集成测试** | Testcontainers + LocalAdapter | 启动 PG + MinIO + Mock LLM，跑完整业务流程 |
| **E2E 测试** | Local 模式全栈 | `CSI_*_MODE=local` 启动 Console，跑端到端交付流程 |
| **契约测试** | CSIAdapter Mock | 模拟 CSI 平台响应，验证 CSIAdapter 实现符合 Port 契约 |

> **关键红利**：E2E 测试无需 CSI 平台、无需真实 Marketplace、无需真实 LLM 厂商，Local 模式全栈独立运行即可验证完整业务闭环。这对 CI/CD 流水线尤其重要。

---

## 附录 A 状态机汇总

### A.1 Project 状态机

> **边集单一真相**：本图边集与 §8.3 Project 转移边 hook 映射表完全一致（同源派生）。研发以 §8.3 表为施工依据，本图作可视化辅助。子状态集与 PRD 附录 D.3 一致。

```
spec_nego → planning → plan_review → executing → in_accept → completed_pending_appeal → completed_final
    │           ↑            ↓             │ │            │                    │
    │           └─ reject ───┘             │ │            │                    │
    │                                      │ │            └──→ dispute_in_progress ──→ completed_final
    │                                      │ ↓                                   │
    │                                      ↓ cancelling ←───────────── 协商取消  │
    │                                 budget_paused                            │
    │                                      │ ↑                                  │
    │                                      ↓ │                                  ↓
    │                                      executing (恢复)                    cancelled
    │                                                                            ↑
    └──→ cancelled（任意非终态阶段，Spec 超时/协商 SLA 超时/纠纷裁定取消）──────────┘

待验收 ↔ 修订中 → 修订协商中
待验收 → 修订协商中（验收被拒/修订请求且 revision_count 超限直连——M5-A2 D1 裁决注册，与 revising 入口同构成双入口）
执行中 → 预算超限暂停 / 异常已暂停
预算超限暂停 → 执行中（Owner 增预算或优化 Plan）/ 协商取消中
契约签订中 → 协商取消中（签约兜底：澄清/修订/驳回超限或签约超时）
异常已暂停 → 人工处理中 → 执行中 / 已关闭
待验收 → 已完成 / 修订中
修订中 → 待验收 / 修订协商中
修订协商中 → 待验收（追加修订）/ 已完成（接受当前或 Spec 变更）/ 纠纷处理中
协商取消中 → 执行中 / 待验收 / 已取消 / 纠纷处理中
纠纷处理中 → 执行中 / 已取消 / 已完成终态 / 已关闭
终态：completed_final、cancelled、closed
```

**业务标签 ↔ 状态符号映射表**（与 PRD D.3 一致）：

| 业务标签（中文 prose） | 状态符号 | 是否终态 | 说明 |
|----------------------|---------|:------:|------|
| 契约签订中 | spec_nego | 否 | Spec 协商/生成/确认阶段 |
| 契约已签订 | planning | 否 | Spec 锁定，Orchestrator 制定 Plan（自动创建 Plan 生成 Task） |
| Plan 待审批 | plan_review | 否 | Agent Owner 审批 Plan（SOP 配置是否必设） |
| 执行中 | executing | 否 | 开发执行阶段 |
| 待验收 | in_accept | 否 | 雇主验收阶段 |
| 修订中 | revising | 否 | 雇主请求修订，回到 Spec 范围内交付内容修正 |
| 修订协商中 | revision_negotiation | 否 | 修订次数超限进入 2 天结构化协商窗口 |
| **预算超限暂停** | **budget_paused** | 否 | `compute_cost_used ≥ 报价 × project_compute_budget_ratio` 自动进入；由 Owner 三选一恢复（见 §7.12） |
| 异常/已暂停 | paused_exception | 否 | Task 异常 L3+ 升级或 Owner 手动暂停 |
| 人工处理中 | manual_handling | 否 | 从异常/已暂停升级，由 Owner 或平台介入处理 |
| 协商取消中 | cancelling | 否 | 协商取消流程中 |
| 纠纷处理中 | dispute_in_progress | 否 | 平台仲裁中 |
| 已完成待申诉 | completed_pending_appeal | 否 | 验收通过，7 天申诉期内（`after_sale_deadline`） |
| 已完成终态 | completed_final | 是 | 申诉期结束/仲裁履约，不可逆 |
| 已取消 | cancelled | 是 | Spec 超时未确认；协商取消达成；纠纷裁定取消；预算超限后放弃 |
| 已关闭 | closed | 是 | 平台裁定关闭 / 异常无法恢复 |

**v0.3 新增子状态字段写入规则**（与 PRD D.3 一致）：

| 子状态 | 触发字段 | 时限字段 | 关联章节 |
|--------|---------|---------|---------|
| 修订协商中 | 进入时刻写 `revision_negotiation_deadline = now() + 2d` | 到期无操作默认 C（接受当前） | §12.2 场景六 / §15.5 |
| 预算超限暂停 | 进入时刻写 `budget_paused_at = now()` | 无自动到期；由 Owner 主动决策 | §7.12 |

### A.2 Task 状态机（CSI 唯一真相）

> **边集单一真相**：本图边集与 §8.3 转移边 hook 映射表完全一致（同源派生）。研发以 §8.3 表为施工依据，本图作可视化辅助。

```
planning → queued → ready → dispatched → running → in_review → done
              │                   │           │          │
              │                   ↓           ↓          ↓
              │               failed      blocked    running（request_changes 驳回）
              │                   ↑           ↑
              │                   │           │
              └──→ skipped ←─── any 非终态（Owner Console 显式跳过）
                                  │
done → reopened → running（Agent 重新 claim 修复）
any → blocked（escalate_to_human / dep block）
blocked → queued（依赖满足 / Owner 解除；统一回 queued 重新走静态/动态校验）
failed → dispatched（grace period 到期自动回退）
running → failed（执行超时：deadline_scanner 扫 execution_deadline_at，触发源 M4；复用 failed→dispatched grace 回退构成 Harness Loop 重试链）
queued → failed（配置阻塞 48h 再超时：deadline_scanner 扫 task_configuration_blockers，M4-D6b；复用 failed→dispatched grace 回退复跑）
```

**完整合法边清单**（与 §8.3 注册表一一对应）：`planning→queued`、`queued→ready`、`ready→dispatched`、`dispatched→running`、`running→in_review`、`in_review→running`、`in_review→done`、`done→reopened`、`reopened→running`、`any→blocked`、`blocked→queued`、`dispatched→failed`、`running→failed`、`queued→failed`、`failed→dispatched`、`any 非终态→skipped`。

说明：`queued` = 刚入队待静态校验；`ready` = 静态校验通过待动态校验+认领；`dispatched` = 动态校验通过待 Agent checkout。`blocked→queued`（非 `blocked→ready`）——回 queued 重新走静态/动态双校验，避免跳过配置校验直接认领。

substate（横切）：`null` / `configuration_incomplete`（pre-dispatch 静态失败）/ `gate_failed` / `gate_running` / `awaiting_review` / `awaiting_approval` / `budget_paused`（预算超限级联，见 §3.2/附录 A.1）/ `goal_mode_threshold`（Goal Mode 达阈暂停，§10.7）/ `paused_exception`（Project paused_exception Task 级联，§8.3 统一级联语义）——【M2-C1 勘误 2026-08-19：本行原缺 goal_mode_threshold/paused_exception，与 §1.2.1④ substate 枚举不一致；按 §8.3 paused_exception Task 级联语义补齐为 9 值，物理 CHECK 已按 9 值落地（999356）】

### A.3 其他状态机

| 实体 | 状态机 |
|------|--------|
| 文档锁 | `free → held → free` / `held → expired → free` |
| Routine Run | `running → completed / failed / cancelled` |
| Agent Run | `queued → running → succeeded / failed / timed_out / cancelled / coalesced` |
| Spec Revision | `draft → submitted → confirmed → superseded / rejected` |
| Spec Change Request | `pending → agent_owner_classified → employer_confirmed / employer_rejected / rejected / timeout_escalated` |
| 修订协商 | `started → decided(auto_accepted) / accepted` |
| 取消协商 | `requested → responded → finalized / to_dispute` |
| Agent status | `idle / working / blocked / error / offline` |
| Runtime status | `online / offline / draining / error` |
| Liveness state | `healthy / stalled / recovering / monitoring` |
| SLA 状态色 | 绿 / 黄 / 橙 / 红（看板展示色，非状态机字段） |

---

## 附录 B 错误码总览

### B.1 拦截器 / MCP 工具错误码

| 错误码 | 含义 |
|--------|------|
| E_COMMENT_REQUIRED | 提交未附 Comment |
| E_DELIVERABLE_INVALID | 交付物缺失/格式不符 |
| E_PLAN_CYCLE | DAG 有环 |
| E_PLAN_DEPS_MISSING | 依赖不存在 |
| E_PLAN_AGENT_MISSING | Agent 不存在 |
| E_PLAN_STAGE_INVALID | stage 非法 |
| E_STATE_INVALID | 状态不允许转移（幂等冲突归此类 no-op） |
| E_FORBIDDEN | 角色无权 |
| E_CONFLICT | 并发/版本冲突 |
| E_LOCKED | 文档被锁 |
| E_EXHAUSTED | 重试/修订/审批轮数耗尽，须 escalate |
| E_SYSTEM | 平台异常 |
| E_HUMAN_PENDING | 问询重复 |
| E_VALIDATION | inputSchema 校验失败 |

### B.2 Evidence Gates 错误码

G1_REQUIREMENT_NOT_COVERED / G1_DELIVERABLE_NOT_PUBLISHED / G2_AC_NOT_VERIFIED / G2_AC_VERIFICATION_FAILED / G3_DELIVERABLE_NOT_PUBLISHED / G3_DELIVERABLE_MISSING_IN_STORE / G3_DELIVERABLE_SIZE_BELOW_THRESHOLD / G3_DELIVERABLE_CHECKSUM_MISMATCH / G4_SPEC_DEVIATION / G4_INVALID_OUTPUT / G5_TEST_FAILURE / G5_INSUFFICIENT_PASS_RATE / G5_INVALID_OUTPUT / G6_DEPENDENCY_NOT_DONE / G6_PREREQUISITE_MILESTONE_NOT_DONE / G6_PHASE_SEQUENCE_VIOLATION / GATE_TIMEOUT / GATE_QA_AGENT_FAILED / GATE_INTERNAL_ERROR

### B.3 Pre-dispatch 错误码

PREDISPATCH_SPEC_NOT_FOUND / PREDISPATCH_SPEC_DEPRECATED / PREDISPATCH_UPSTREAM_ARTIFACT_INACCESSIBLE / PREDISPATCH_SKILL_TEMPLATE_MISSING / PREDISPATCH_PLAN_SUPERSEDED / PREDISPATCH_WORKSPACE_MISSING / PREDISPATCH_EXECUTION_POLICY_INVALID / PREDISPATCH_DEPENDENCY_NOT_DONE / PREDISPATCH_RUNTIME_OFFLINE / PREDISPATCH_RUNTIME_UNHEALTHY / PREDISPATCH_SKILL_NOT_BOUND / PREDISPATCH_TOOL_NOT_PERMITTED / PREDISPATCH_BUDGET_INSUFFICIENT / PREDISPATCH_STORAGE_QUOTA_EXCEEDED / PREDISPATCH_AGENT_NOT_ACTIVE / PREDISPATCH_SPEC_NOT_MOUNTED / TASK_IN_SUBSTATE / PREDISPATCH_STALLED_TIMEOUT / PREDISPATCH_LLM_QUOTA_EXHAUSTED（DR-12：平台 LLM 额度耗尽，处置=充值/升级套餐，区别于项目预算不足的 PREDISPATCH_BUDGET_INSUFFICIENT） / PREDISPATCH_MODEL_NOT_ENTITLED（DR-12：所选模型不在订阅套餐目录内，处置=换模型/升级套餐）

### B.4 雇主侧集成错误码

- **AUTH_***（401/403，不可重试）：AUTH_TOKEN_INVALID / AUTH_HMAC_SIGNATURE_MISMATCH / AUTH_TIMESTAMP_EXPIRED
- **VALIDATION_***（400/422）：VALIDATION_PAYLOAD_INVALID / VALIDATION_SPEC_SCHEMA_INVALID / VALIDATION_MILESTONE_WEIGHT_INVALID / VALIDATION_GATE_NOT_PASSED / VALIDATION_INVALID_OPTION / VALIDATION_IDEMPOTENCY_CONFLICT
- **NOT_FOUND_***（404）：NOT_FOUND_TASK / NOT_FOUND_ORDER / NOT_FOUND_PROJECT / NOT_FOUND_CANCEL_REQUEST
- **CONFLICT_***（409）：CONFLICT_SEAT_FULL / CONFLICT_SPEC_VERSION_CONFLICT / CONFLICT_BID_ALREADY_SUBMITTED / CONFLICT_SUBMISSION_SEQ_CONFLICT / CONFLICT_SPEC_CHANGE_ALREADY_PROPOSED / CONFLICT_SETTLEMENT_ALREADY_TRIGGERED / CONFLICT_PROCESSING_IN_PROGRESS
- **STATE_***（422）：STATE_OPPORTUNITY_NOT_BIDDABLE / STATE_PROJECT_NOT_CANCELLABLE / STATE_PROJECT_NOT_SPEC_SIGNING / STATE_PROJECT_NOT_DELIVERABLE / STATE_PROJECT_NOT_EXECUTING / STATE_PROJECT_NOT_COMPLETED / STATE_SPEC_ALREADY_CONFIRMED / STATE_CANCEL_REQUEST_RESOLVED / STATE_NEGOTIATION_NOT_ACTIVE / STATE_TASK_NOT_BIDDABLE / STATE_WORKSPACE_NOT_ELIGIBLE
- **RATE_LIMIT_***（429，可重试）：RATE_LIMIT_EXCEEDED
- **UPSTREAM_***（502/503，可重试）：UPSTREAM_MARKETPLACE_UNAVAILABLE / UPSTREAM_CONSOLE_UNAVAILABLE
- **INTERNAL_***（500，可重试）：INTERNAL_DB_ERROR / INTERNAL_UNKNOWN

### B.5 Watchdog 错误码

WATCHDOG_PROJECT_STALLED_TIER1(warning) / WATCHDOG_PROJECT_STALLED_TIER2(major) / WATCHDOG_PROJECT_STALLED_TIER3(critical) / WATCHDOG_SCAN_FAILED(critical 运维) / WATCHDOG_FINGERPRINT_RESET(info)

### B.6 平台订阅权益错误码（DR-12，2026-08-20 新增）

`EntitlementPort` / 平台 LLM 网关业务拒绝语义——**全部 4xx 业务态，不可重试**；不得落入 `UPSTREAM_*` / `INTERNAL_*` 可重试族：

| 错误码 | 含义 | 处置 |
|--------|------|------|
| ENTITLEMENT_PLAN_NOT_FOUND | 订阅主体（Org）无有效套餐 | 引导订阅/激活公测免费额度 |
| ENTITLEMENT_LIMIT_REACHED | 云端 RuntimeInstance 数超套餐上限 | 释放实例或升级套餐 |
| ENTITLEMENT_CATALOG_DENIED | 所选模型 / RuntimeProfile 不在套餐目录内 | 换目录内选项或升级套餐 |
| ENTITLEMENT_QUOTA_EXHAUSTED | LLM 额度耗尽（公测硬断；正式版可选按量溢价） | 充值/升级；urgent 通知 Owner |

---

## 附录 C 决策记录汇总

### C.1 核心哲学决策

| # | 决策 | 选择 | 理由 |
|---|------|------|------|
| P1 | Agent 地位 | 一等公民，多态 Actor | 1:1 映射人类团队 |
| P2 | 依赖关系 | 活的，可演化 | 真实项目不可预定义 |
| P3 | 质量保障 | 平台强制 | 不靠 Agent 自觉 |
| P4 | 流程模型 | Task 管理非流程编排 | Phase 3 不可预定义 |

### C.2 架构决策

| # | 决策 | 选择 |
|---|------|------|
| DB-1 | 基座 | Multica fork + Paperclip 注入 + CSI 自研 |
| DB-2 | Actor 模型 | 多态 `(actor_type, actor_id)` |
| DB-6 | project_tasks | 融合策略（§A-§P 16 字段组） |
| DR-1(Runtime) | 控制面 | 直接操作原生 K8s 资源（不引入 CRD） |
| DR-2(Runtime) | Pod 模型 | 单容器无 sidecar |
| DR-3(Runtime) | PVC | RWO + 每 instance 一个 |
| DR-1(MCP) | 拦截模型 | 落在 MCP 工具 handler |
| DR-1(Interceptor) | Hook 挂载 | 收敛为状态转移抽象 |
| DR-1(Event) | 机制 | PG LISTEN/NOTIFY + Outbox |
| DR-1(Watchdog) | 检测粒度 | Project 级 |
| DR-4(Watchdog) | 触发动作 | 分层通知 + inspection Task，不自动修复 |
| DR-5(Orchestrator) | 离线兜底 | 平台兜底不换主体 |
| **DR-11** | **工程架构** | **全栈 Ports & Adapters 六边形**（详见 [§17](#第-17-章-工程架构与外部依赖适配ports--adapters)） |
| **DR-12** | **平台 LLM 网关与订阅权益计费适配** | **网关走 `LLMProviderPort` CSIAdapter；商业化面新增第 10 个 Port（`EntitlementPort`）**（详见 [§17](#第-17-章-工程架构与外部依赖适配ports--adapters)） |

#### DR-11: 全栈 Ports & Adapters 六边形架构

**决策**：将"独立优先 + 适配器对接"工程思想从 UI 层（5 Port）推广到全栈（9 Port）。业务核心（自主交付五层哲学 + 四条不变性 + 状态机 + Interceptor + Floor + Gate）位于六边形内部，所有外部依赖通过 Port 接口注入。

**9 个 Port**：AuthPort / OpportunitySourcePort / SettlementPort / NotificationChannelPort / CrossModuleLinkPort（前端 5 Port）+ RuntimeProvisionerPort / ObjectStoragePort / LLMProviderPort / WebhookInboundPort（后端新增 4 Port）。

**理由**：
1. **现实约束已验证**：CSI 各版块同步研发、集成契约暂不可得，独立优先策略已在前端落地验证可行
2. **业务核心稳定性**：自主交付核心与外部依赖解耦，核心不受外部演进影响
3. **演进友好**：未来 Marketplace API 协议演进、对象存储切换、LLM Provider 替换等，都能在 Adapter 内消化，业务层零改动
4. **测试性红利**：E2E 测试无需 CSI 平台/Marketplace/真实 LLM 厂商，Local 模式全栈独立运行即可验证完整业务闭环（对 CI/CD 尤其重要）
5. **不 Port 化边界明确**：基础设施（PG/LISTEN-NOTIFY）、核心业务规则（状态机/Interceptor/Floor/Gate）、MCP 工具契约不 Port 化，避免过度抽象

**推广方式**：新增第 17 章作为工程架构总章，不重写第 9/11/12 章（业务流程视角保持），新章节从工程架构视角聚合 Port 定义。

**与 UI DR-11 关系**：UI 文档（console-ui-design.md）原 DR-11 定义 5 个前端 Port；本决策升级为全栈 9 Port，覆盖前后端。

#### DR-12: 平台 LLM 网关与订阅权益计费适配

**决策日期**：2026-08-20。**决策人**：Owner + Console 团队（跨版块对接契约裁决）。

**决策**：①平台统一 LLM 网关作为 `LLMProviderPort` 的新 CSIAdapter（`GatewayProvider`）接入——调用面（`Chat`/`ChatStream`/`Embed`）与计量面（`ChatResponse.Usage`/`Cost`/`TenantID`）零新增契约，`CSI_LLM_MODE` 增加 `gateway` 模式值；`MultiModelRouter` 预研的角色路由策略由网关服务端吸收。②订阅套餐/权益目录/免费额度/用量账单属**商业化面**，不经过 `LLMProviderPort` 四个方法，新增第 10 个 Port——`EntitlementPort`（只读 + 校验语义）。③不并入 `SettlementPort`：其语义是"雇主↔工作室的项目结算"，与"owner↔平台的订阅计费"是两个领域，混用会污染结算契约。

**配套裁决**（同日生效）：
- **订阅主体**：Org/账号级订阅，额度全 Org 共享；计量按 `workspace_id` 落账（`TenantID`）便于成本拆解，权益校验键 = `org_id`。
- **公测免费额度**：入驻即赠、有有效期、不可转让、耗尽即停；数值与有效期为平台运营参数配置化，不写死契约。
- **额度耗尽处置**：公测硬断（网关返回 4xx 业务态拒绝 + urgent 通知 Owner）；正式版支持 owner 可选按量溢价。
- **升降级口径**：升级即时生效（按剩余周期折算差价），降级下个计费周期生效；套餐额度按订阅周期滚动（Console `monthly_budget_cents` 自然月重置为内部风控口径，两者独立）。
- **云端托管网络边界**：公测期云端托管 Runtime 的 LLM 调用强制走平台网关，不支持 owner 自定义 LLM provider（敏感凭证不进入平台托管环境）；Pod 出向 NetworkPolicy 白名单 = 平台 LLM 网关 + Console API + 平台对象存储 + DNS（§2.4）。自托管 Runtime（后续版本）可自定义 provider，平台不计量不收费，daemon 自报成本仅用于项目预算风控与展示。
- **错误语义**：额度耗尽/套餐外模型为 4xx 业务态拒绝（不可重试），新增附录 B.6 `ENTITLEMENT_*` 错误码族 + 附录 B.3 两个 Pre-dispatch 错误码。

**理由**：六边形既定演进路径吸收新外部依赖；商业化面与调用面生命周期不同（计费规则独立演进），独立 Port 防止 `LLMProviderPort` 契约污染；`EntitlementPort` LocalAdapter 全放行（无限额度、全目录开放）保持"独立优先"哲学——Console 不依赖新版块即可运行完整内部闭环。

**落地章节**：§17.2（Port 表第 10 行）/ §17.3.5（接口定义）/ §17.4（切换矩阵）/ §17.5（Local 矩阵）/ §2.4（NetworkPolicy）/ 附录 B.3 / 附录 B.6；PRD §4.3 / §4.4 / §4.6；跨版块契约见 `docs/design/CSI-Agent-Owner-Console-Integration-Guide.md` §3.7。

### C.3 质量决策

| # | 决策 | 选择 |
|---|------|------|
| QD-01 | 多层防线 | 五层叠加，漏到下游 ~1% |
| QD-03 | 同一原因检测 | 语义相似度 > 0.85 |
| QD-04 | Harness 重试 | 4 段式上下文注入 |
| CD-01 | 合规框架 | 三层（A 强制 / B 检测 / C 注入） |
| CD-03 | 质量档案 | 自我强化循环 |
| DR-01(Gates) | 执行模式 | G1/G2/G3/G6 同步 + G4/G5 异步 |
| DR-01(Pre-dispatch) | 校验时机 | 双时机（ready 静态 + checkout 动态） |

### C.4 雇主集成决策

| # | 决策 | 选择 |
|---|------|------|
| 1 | 集成模式 | 混合（同步 RPC + 异步 Webhook） |
| 5 | 幂等 | Idempotency-Key + 业务自然键 DB UNIQUE |
| 11 | Spec 签约 | Project Task + @mention（非工作流引擎） |
| 17 | 结算触发 | Console 主动 trigger |
| 19 | 一致性 | 最终一致性 + 四层兜底 |

### C.5 UI 决策

| # | 决策 | 选择 |
|---|------|------|
| DR-02 | Task 详情 | Drawer（保持 Board 上下文） |
| DR-04 | Plan DAG | react-flow + dagre |
| DR-06 | WS | 单连接多频道 |
| DR-09 | 独立优先 | Multica 本地账户先行 + AuthPort 适配器（详见 UI 文档 §2.4） |

> **DR-11 升级说明**：原 C.5 的 DR-11（Ports & Adapters 六边形）已升级为全栈架构决策，移至 [C.2 架构决策](#c2-架构决策)，详见 [§17](#第-17-章-工程架构与外部依赖适配ports--adapters)。

---

## 附录 D 研发启动门禁（不阻断研发启动，但阻断依赖该契约的功能实现与集成验收）

> **本清单性质**（终审 v2 调整，2026-08-05）：原表述"开发期补，非签收阻断"易被误读为"各研发任务可边做边定"。经终审复核确认：本清单分两类——**架构契约基线**（多团队共享的跨模块行为契约，必须先于依赖它的功能并行开工）与**工程实现补齐**（DDL/枚举/字段等机械同步，单 Owner 完成即可）。两者均**不阻断研发启动**，但**阻断依赖该契约的功能实现与集成验收**：Sprint 0 基线任务通过架构评审后，UI/Runtime/集成/质量门等工作流方可并行开发。8 项图纸级问题（request_approval reject 生命周期 / Interceptor 边集 / Project 状态机 / 预算超限 / 超时调度组件 / Agent 执行超时 / §14 措辞 / DDL 方向裁断）已补齐，详见各章。
>
> **研发读图指引**：TS §1.2 列出 54 表 + 2 视图的完整清单为**目标态**；`schema-unified.sql` 当前仅 37 表 + 2 视图，缺口 17 表归本附录 D.1 项 1。研发建表时以 TS §1.2 清单 + §1.2.1 方向裁断 + 各章字段说明为准，`schema-unified.sql` 现状仅作起点参考（部分枚举/字段需按 D.1 项 1 + D.3 同步修正）。

### D.1 Sprint 0 架构基线任务（研发启动门禁）

> 每项必须完成"唯一产物 + 验收测试 + 解除哪些下游任务阻塞"三件套，通过架构评审后解除对应下游并行阻塞。基线项分两类：**契约修正**（解决文档/SQL 自相矛盾，零自由裁量）与**契约补全**（补齐跨模块生命周期设计，需 Owner 产出设计文档）。

| # | 基线项 | 类型 | 唯一产物 | 验收测试 | 解除哪些下游任务阻塞 | 建议 Owner |
|---|---|---|---|---|---|---|
| 1 | 数据模型 migration（合并旧 #1/#2/#5/#6） | 实现 | `schema-unified.sql` v2（52 表 + 2 视图，含 §1.2.1 四项方向裁断落地 + `spec_change_requests.status` 枚举同步 `timeout_escalated` + `task_interactions.kind` 加 `request_approval` + Runtime 相关表设计文档补齐）+ 迁移脚本 | 全表 DDL 校验脚本 + 枚举一致性校验 + §1.2.1 四项方向裁断落地点检查 | 解除所有依赖 DB 的后端/Runtime/Scanner/Console 开发阻塞 | 后端基础组 |
| 2 | 状态机与依赖真相源一致性（旧 #5/#6 衍生 + 终审新发现） | 契约修正 | TS §1.2/§3.3/§10.2 文档对齐：①§1.2/§3.3 移除 `depends_on` 字段引用（§1.2.1 ③ 已裁断 deprecated）；②§10.2 L1186 `status → cancelled` 改为 `status → skipped`（§1.2.1 ① 已裁断 Task 级用 skipped）；③生成机器可测试的状态转移边注册表 | 状态转移边测试套件（每边可单独测试，附录 A.2 与 §8.3 边集一致性 + §9.3.1 子集校验） | 解除 Task 状态机/Runtime/Dispatcher/Plan reconcile 开发阻塞 | 后端架构组 |
| 3 | Atomic Checkout SQL 契约修正（终审新发现） | 契约修正 | TS §9.3 SQL 修正：`WHERE status = 'dispatched'`（移除 `'ready'`），或在同一原子命令内纳入动态 Guard（Runtime 健康/预算/Skills/工具白名单校验） | SQL 拒绝 `ready` 直接 `running` 的测试用例；动态 Guard 被跳过的负向测试 | 解除 Runtime/Dispatcher/Pre-dispatch/Atomic Checkout 开发阻塞 | 后端架构组 |
| 4 | G4/G5 质检 Task 完整生命周期（旧 #3 升级 + 终审新发现） | 契约补全 | TS §7.5 补全：①`task_type` 枚举加 `quality_check`（§1.2.1 ④ 同步）；②父里程碑进入 `gate_running` 的触发条件；③G4/G5 质检子任务创建时机；④质检失败回流执行者路径；⑤重试/跳过/超时收敛规则；⑥父 Task 允许 `done` 的收敛条件；⑦生命周期时序图 | Gate 生命周期测试用例（覆盖正常 pass / 失败回流 / 重试耗尽 / 超时 / skip_if_passed 复用 5 条路径） | 解除质量门/状态机/Harness Loop/Reviewer Agent 开发阻塞 | 质量架构组 |
| 5 | 超时扫描器 schema 规范化（终审新发现） | 契约补全 | TS §1.2/§10.8 对齐：①`task_interactions` 加 `deadline_at`/`resolved_at` 字段（§10.8 L1297 假定存在但 §1.2 未列）；②`revision_negotiation_decisions` 表纳入 §1.2 目标 54 表（或合并入既有表）；③`watchdog_logs` 表纳入 §1.2（§10.8 L1320 引用）；④`side_outbox` 表定位（确认是否 = `event_outbox`） | 扫描对象字段完整性校验脚本（7 处扫描对象的 `deadline_at`/`resolved_at`/`status` 字段全部存在） | 解除 `deadline_scanner`/超时自动化/升级审批自动化开发阻塞 | 后端基础组 |
| 6 | Human 执行路径契约（终审新发现） | 契约补全 | **已决策：方案 B（M0.6a，P1 临时收窄 + 演进声明）**。方案 A（定义 `HumanExecutor` 的 claim/submit/review/审计/并发模型，与 Agent Atomic Checkout 对等）已弃（P1 成本不划算）；方案 B 收窄 P1 愿景为"协作与审批对等"（Human 不直接 claim/submit Task，仅 comment/approve/审计），并修正 §0.2/§2.2 表述。TS §0.2/§2.2.1/§2.2.2/§8.3/§16.2 文档同步已由 M0.6b 落实 | 决策文档（M0.6a 已归档至 `.trellis/tasks/archive/2026-08/`）+ 愿景表述一致性校验（M0.6b 已落实：§0.2/§2.2/§2.7/§8.3/§16.2 五处表述无矛盾） | 解除 RBAC/Console UI 任务分配/成员协作开发阻塞 | 架构组 |
| 7 | 产物存储边界契约（终审新发现） | 契约修正 | TS §15.2/§17.3.2 对齐：**发布产物（`project_artifacts.artifact_type=deliverable/evidence`）必须进耐久对象存储（MinIO/S3），PVC 仅工作目录**。`ObjectStoragePort` 契约明确 `publish_artifact` 路径强制走 MinIO/S3，不受 `CSI_STORAGE_MODE=local` 影响 | 产物持久性测试（PVC 丢失后 `deliverable`/`evidence` 类 artifact 仍可从 MinIO/S3 恢复） | 解除交付物管理/证据 Gate/结算依据开发阻塞 | 架构组 |
| 8 | Workspace 展示页 + Opportunity v0.3 字段（旧 #4） | 实现 | TS §13 + `schema-unified.sql` 字段补齐 | 字段完整性校验 | 解除 Console Workspace/Opportunity 页面开发阻塞 | 前端组 |

> **基线 #5 状态**：已由 M0.5 落实（TS §1.2/§3.2/§8.3/§8.5/§10.8 对齐 + `docs/design/research/schema-unified.sql` DDL 补全 + 迁移 290-295 + `server/internal/migrations/deadline_scanner_schema_test.go` 字段完整性校验测试）。实际范围从原 4 项扩展到 §10.8 全部 7 个扫描对象（drift handling 小调整路径），表数从 52 更新为 54（§2 Project 执行层 +1 `revision_negotiation_decisions`、§11 质量保障层 +1 `watchdog_logs`）；`side_outbox` 确认为 `event_outbox` deprecated 别名（§8.5 已修正），未建表。

> **基线 #7 状态**：已由 M0.7 落实（TS §5.6/§15.2/§17.3.2/§17.5 对齐 + `docs/design/research/artifact-storage-boundary.json` 注册表 + `server/internal/statemachine/artifact_storage_boundary_test.go` 契约一致性测试）。`ObjectStoragePort` 接口新增 `PublishArtifact` 方法，`deliverable`/`evidence` 强制 MinIO/S3，不受 local 模式影响。

### D.2 P1 开发期补齐（基线通过后并行开发中补齐）

| # | 缺什么 | 来源 | 补到哪 |
|---|---|---|---|
| 9 | MCP inputSchema（23 个工具补完整契约，当前仅 `request_approval` 有完整契约） | `mcp-tools-spec.md` §5 | TS §9.5 |
| 10 | 文档协作 API 契约 | `document-concurrency.md` §2-3 | TS §5 |
| 11 | Pre-dispatch Owner 干预 API | `pre-dispatch-spec.md` §4.4 | TS §8 |
| 12 | Watchdog payload | `project-watchdog-spec.md` §2/§5 | TS §10.5 |
| 13 | Console 内部 REST API consolidated 清单 | `console-ui-design.md` / `workspace-dashboard.md` / `notification-system.md` inline 引用 | TS §13 |
| 14 | `notification_deliveries` 表 + 通知偏好表 | `notification-system.md` L350 | `schema-unified.sql` + TS §1.2 |
| 15 | 预算"增加预算"独立授权实体（终审新发现） | §3.2 L480 不能靠修改 `compute_cost_used` 表达上调额度 | TS §3.2 新增 `budget_authorizations` 不可变实体 + 雇主合同价/结算影响说明 |
| 16 | 9 个 Port 契约补齐（终审新发现，当前仅 4 个有后端接口；DR-12 新增的第 10 个 `EntitlementPort` 契约已随 §17.3.5 完整落地，不在本项缺口范围） | §17.2 L1937 Auth/商机/结算/通知/跨模块链接缺方法/错误/幂等/降级契约 | TS §17.2 + OpenAPI 契约测试 |
| 17 | LLMProviderPort 返回值补齐（终审新发现） | §17.3.3 缺用量/成本/模型版本/租户归属/取消语义 | TS §17.3.3 `ChatResponse` 结构补全 |
| 18 | "Local 模式覆盖 95% 完整闭环"表述修正（终审新发现） | §17.3.2 过强，跳过真实竞标/支付，Owner 同时扮演雇主 | TS §17.3.2 改为"可验证内部交付闭环" + Marketplace/Settlement 契约测试替身 |

### D.3 P2 文档修正（随补随发）

| # | 缺什么 | 补到哪 |
|---|---|---|
| 19 | API 计数标签统一（§0.4 / §12.2 / §16.1 三处与源文档 `employer-integration-api.md` 不一致；清单本身可用，计数标签错） | TS §0.4 / §12.2 / §16.1 |
| 20 | §16.1 矩阵补 PRD §4（Phase 0 入驻）/ §5.5 / §6.3（工作流编排 → Routine/Project Task 替代映射）/ §10（NFR）显式 trace 行 | TS §16.1 |
| 21 | 附录 A.2 Task 状态机 ASCII 重绘（或改表格化边清单，与 §8.3 转移边注册表合一） | TS 附录 A.2 |
| 22 | §14.4 "9 个 Agent 团队" vs 实际 8 角色修正 | TS §14.4 |
| 23 | `substate` 枚举三处统一（§3.3 六值 / §10.7 `goal_mode_threshold` / 附录 A.2） | TS 各处 |
| 24 | §10 章节编号乱序（§10.7 排在 §10.6 之前） | TS §10 |
| 25 | §1.2 与文档结尾措辞修正（"完整 DDL 见 schema-unified.sql" 与实际 35 表矛盾，改为指向本附录 D） | TS §1.2 + 文档结尾 |

### D.4 已降级（不再补）

| # | 项 | 原因 |
|---|---|---|
| 26 | "无 Agent 间结构化协商协议"（原清单报告 Major M-08 / Critical C-11） | grilling 验证为想象缺口——现有原语（@mention + Comment + request_changes + same_reason_reject_streak=3 + escalate_to_human）已覆盖协商四要素（分歧表达 / 异步讨论 / 有界交锋 / 升级裁决），与人类团队"讨论 → 分歧 → 交锋 → lead 裁决"同构。降级 Minor，不再作为补齐项 |

---

## 附录 E 参考设计借鉴清单（开发期参考，非架构要求）

> **来源**：Omnigent 项目 Contextual Policies 设计调研（`.tmp/omnigent/`、`.tmp/omnigent-site/`）。
> **定位**：以下内容为开发期实现参考，不改变本 TS 已敲定的架构骨架。研发团队在实现对应模块时可借鉴这些设计模式，但不强制要求照搬。
> **与已敲定架构的关系**：Omnigent 与 CSI 独立演化出了相同的三层配置模型（运行时动态 → 配置模板 → 平台兜底），验证了 CSI 三层 Approval 模型的架构正确性。两者差异在于粒度——Omnigent 在 Agent 执行内部 per-action 拦截（微观），CSI 在 Task 生命周期 per-transition 拦截（宏观）。

### E.1 可借鉴设计模式

| # | 借鉴模式 | Omnigent 来源 | CSI 落点 | 优先级 | 对自主性的影响 |
|---|---------|-------------|---------|--------|--------------|
| 1 | **Quality Gate Registry**：builtin gate + custom gate 注册发现，handler + params_schema 参数化校验 | `POLICY_REGISTRY` + `registry.py` + `validate_factory_params` | §10.2 SOP 模板增强：SOP 引用 registry 中的 gate handler + factory_params，替代纯 Markdown 描述 | P0 | Agent Owner 更灵活配置质量门，结构化参数校验替代手写 Markdown |
| 2 | **Stateful Guard**：policy 跨调用维护 session 级状态（risk_score、failure_rate、burn_rate），每次评估读取累积状态 | `session_state` + `state_updates` (SET/INCREMENT/DELETE/APPEND) | §8.3 Interceptor 增强：Guard 从无状态升级为有状态，支持累积风险评估 | P1 | 平台能检测累积风险/失败模式，更早自主干预（补三审 S3 超时扫描缺口） |
| 3 | **Fail 策略显式声明**：每个拦截点声明 fail-closed（DENY）或 fail-open（ALLOW） | `FAIL_CLOSED_PHASES = ("PHASE_TOOL_CALL", "PHASE_REQUEST")` | §8.3 Interceptor 补充：每条转移边 Guard 显式声明异常时 DENY 还是 ALLOW | P1 | 研发知道 Guard 执行异常时的兜底行为，消除临场猜测 |
| 4 | **LLM-backed Gate**：用 LLM 评估复杂语义场景（"PRD 是否完整"、"架构是否可行"），超越规则校验 | `prompt_policy`（LLM as policy evaluator） | §7.5 Evidence Gates 增强：G1（Spec 完整性）、G2（Plan 可行性）可选 LLM-backed 语义评估 | P2 | 质量门从字段校验升级为语义级评估 |
| 5 | **数据变换**：policy 在 ALLOW 时返回 `data` 字段替换原始内容（PII 脱敏、敏感信息过滤），多 policy 链式变换 | `PolicyResult.data` + engine 链式 feed-back | §7.5 Evidence Gates 增强：Gate 返回 sanitized evidence（脱敏交付物），而非仅 pass/fail | P2 | 交付物自动脱敏/过滤，扩展质量门能力 |
| 6 | **执行内部拦截点**：在 Agent 执行内部的 tool_call、llm_request、tool_result 等粒度拦截 | 6 个 Phase（request/tool_call/tool_result/response/llm_request/llm_response） | §9 Runtime 增强：Daemon 层增加 per-action policy 评估（Interceptor 宏观 + Runtime 微观双层） | P2 | 微观层面行为控制，补全 Interceptor 宏观粒度的盲区 |

### E.2 不借鉴的设计

| Omnigent 设计 | 不借鉴原因 |
|---|---|
| Session 级配置（chat 里临时加 policy） | CSI 是 Agent 主导，不是 Human 临时指挥；CSI 层 3 是 Agent 运行时 `request_approval`，不是用户临时加门 |
| OS Sandbox（bubblewrap/seatbelt + egress_rules + credential_proxy） | CSI 由 K8s Pod + NetworkPolicy + PVC 隔离替代；credential_proxy 的 secretless auth 思路可启发 Runtime 凭证管理但不直接引入 |
| 三层优先级 Session > Spec > Server | CSI 三层模型已对齐，但优先级语义不同：CSI 是 Agent(runtime) > SOP(template) > Platform(hardcoded)，Omnigent 是 User > Developer > Admin |

### E.3 三层配置模型对照

| 维度 | Omnigent | CSI | 差异本质 |
|------|---------|-----|---------|
| 最高优先层 | Session（最终用户临时加） | 层 3 Agent 运行时 `request_approval` | Omnigent=Human-in-the-loop，CSI=Agent-in-the-loop |
| 中间层 | Agent spec（开发者声明） | 层 2 SOP 模板配置 | 两者都是"配置模板"层 |
| 最低优先层 | Server-wide（管理员全局兜底） | 层 1 平台硬编码契约门 | 两者都是"平台兜底"层 |
| 决策模型 | ALLOW / ASK / DENY | Guard 放行 / Gate 拦截 / Guard 阻止 | 本质同构 |
| 组合语义 | DENY 短路；ASK 合并；None 传递 | Guard 链短路；Gate 链合并；无 hook 传递 | 本质同构 |
| 有状态评估 | ✅ session_state + state_updates | ❌ 当前无状态（建议增强，见 E.1 #2） | CSI 待补 |
| 数据变换 | ✅ PolicyResult.data 链式变换 | ❌ 当前仅 pass/fail（建议增强，见 E.1 #5） | CSI 待补 |

---

## 附录 F Human↔Agent DM（直接聊天）复用分析

> **来源**：Multica 原生 chat 基础设施调研（`.tmp/multica/server/`）。
> **定位**：公测版直接复用 Multica 原生 chat 基础设施，仅做配置层适配，不改基础设施。
> **设计类比**：类比人类现实世界——你的同事或领导可以直接找你 DM 私聊，通过 DM 方式直接找到你对话：询问工作进展、聊一些非实际工作的技术探讨、让你临时做一件小事等。CSI 也是一样：Agent Owner 或其它 Human 人类员工通过在 Console 与指定的 AI Agent 员工直接 chat 对话，来向 AI Agent 员工询问 Project/Task 的处理情况和进展、日常讨论、工作督促等。

### F.1 Multica 原生 chat 基础设施清单

| 能力 | Multica 实现 | 源码位置 |
|------|-------------|---------|
| 持久化会话 | `chat_sessions` 表（会话生命周期管理、标题编辑、已读标记） | `db/queries/agent.sql` |
| 消息存储 | `chat_messages` 表（消息持久化 + 附件关联） | `db/queries/attachment.sql` |
| 实时通信 | WebSocket 事件：`chat:message` / `chat:done` / `chat:cancel_finalized` / `chat:session_read` / `chat:session_deleted` / `chat:session_updated` | `pkg/protocol/events.go` |
| 直接发消息 | `SendDirectChatMessage()` — Human 向 Agent 发 DM，含附件上传 | `internal/service/task.go#L1619` |
| Agent 处理 | `EnqueueChatTask()` — chat 消息创建 `agent_task_queue` 条目，Agent 通过 LLM loop 处理 | `internal/service/task.go#L1456` |
| 优先级提升 | chat task 自动提升优先级：`CASE WHEN chat_session_id IS NOT NULL THEN GREATEST(priority, 3) ELSE priority END` | `db/queries/agent.sql#L419` |
| 附件支持 | chat 消息可带附件（`attachment.chat_session_id` / `attachment.chat_message_id`） | `db/queries/attachment.sql` |
| 取消/恢复 | chat 取消有 finalize 流程 + draft restore（取消后可恢复草稿） | `internal/service/task.go#L1907` |
| 频道绑定 | chat session 可绑定 Slack 等外部频道（`channel_chat_session_binding`） | `db/queries/channel.sql` |
| LLM 集成 | `Chat()` / `ChatStream()` 方法，支持流式输出 | `pkg/llm/client.go` |
| 并发串行化 | 同一 `chat_session_id` 的 chat task 串行执行，防止同一会话并发 | `db/queries/agent.sql#L513-L537` |

### F.2 CSI 需求与 Multica 能力对照

#### 设计类比：现实世界 ↔ CSI

| 现实世界 | CSI 对应 | Multica 原生支持 |
|---------|---------|-----------------|
| 同事找你 DM 问工作进展 | Owner 在 Console 与 Agent DM，问 Task 进度 | ✅ `SendDirectChatMessage` |
| 你回答"目前做到哪了" | Agent 用 MCP 工具查 Task 状态后回复 | ✅ chat → LLM loop（需配 MCP 工具） |
| 领导督促你"抓紧" | Owner 在 DM 中催促 Agent | ✅ DM 消息，Agent instructions 中加响应策略 |
| 闲聊技术探讨 | Owner 与 Agent 自由对话 | ✅ LLM 原生能力 |
| 让你临时做件小事 | Owner 在 DM 中让 Agent 做非正式任务 | ✅ chat task，不创建 `project_tasks` |
| 你正在开会（执行 Task），同事 DM 你 | Agent 正在执行 Task，Owner 发 DM | ✅ DM 排队（chat task 入 `agent_task_queue`），Task 完成后响应 |

#### 结论：全部场景 Multica 原生已覆盖

公测版**不需要改动 chat 基础设施**。CSI 侧仅做配置层适配。

### F.3 CSI 配置层适配项

| 适配项 | 本质 | 改动量 | 优先级 |
|--------|------|--------|--------|
| **Agent 工作上下文感知** | Agent 在 chat 中被问"CRM 项目进度如何"时，需查询自己的 Task 列表和状态 | 新增 2 个 MCP 工具：`get_my_tasks`（返回当前 Agent 的 running/in_review Task 列表）/ `get_task_progress`（返回指定 Task 的 execution_state + gate_results + harness_attempt） | P0 |
| **Agent chat 行为指令** | CSI Agent 在 DM 中的行为模式（如何汇报进展、如何拒绝超出范围请求、被催促时的响应策略） | Skill（Markdown）配置："你是 CSI Agent，被问及工作进展时，使用 `get_my_tasks` / `get_task_progress` 工具查询后汇报；被要求做非正式小事时，在 chat 中直接完成，不创建 project_task；被催促时，报告当前阻塞点和预计完成时间" | P0 |
| **Chat task 并发口径** | Chat task 进入 `agent_task_queue`，需确认是否计入 `max_concurrent_tasks` | 决策：**计入**（沿用 Multica 原生行为，零改动）。Agent 正在执行 Task 时 DM 排队等待，chat task 优先级提升（≥3）保证合理响应速度 | P0（决策项，零代码） |

### F.4 关键架构决策：Chat task 与 Project task 的关系

#### Multica 原生模型

```
Human 发 DM
    ↓
SendDirectChatMessage()
    ↓
EnqueueChatTask() → agent_task_queue (chat_session_id 非空, issue_id 空)
                        ↓
                   Agent LLM loop 处理（受 max_concurrent_tasks 限制）
                        ↓
                   chat:message / chat:done（WebSocket 推送）
```

#### CSI 决策：直接沿用，不做分离

| 决策点 | 选择 | 理由 |
|--------|------|------|
| chat task 是否进 `agent_task_queue` | ✅ 是 | Multica 原生行为，零改动 |
| chat task 是否计入 `max_concurrent_tasks` | ✅ 计入 | 防止 Agent 被 DM 淹没影响正式 Task 执行；chat task 优先级提升（≥3）保证 DM 不被饿死 |
| chat task 是否创建 `project_tasks` 记录 | ❌ 否 | chat task 的 `issue_id` 为 NULL，不进入 Plan DAG / Evidence Gates / Harness 生命周期 |
| chat task 优先级 | 沿用 Multica（≥3） | 零改动，保证 DM 响应速度 |
| Agent 正在执行 Task 时收到 DM | 排队等待 | "你正在开会，同事 DM 你"——会后回复，合理语义 |

#### 为什么不分离 chat 与 task queue？

1. **最小改动**——不改 `agent_task_queue` 结构，不改 Task Service 逻辑
2. **并发保护**——chat task 计入并发限制，Agent 不会被 DM 淹没
3. **优先级保证**——chat task 自动优先级提升，DM 不被长 Task 饿死
4. **与项目工作分离**——chat task 不创建 `project_tasks`，不污染 Plan DAG / Evidence Gates
5. **已验证**——Multica 生产环境已验证此模型可行

### F.5 不改动清单（公测版直接复用）

| Multica 能力 | CSI 复用方式 |
|-------------|-------------|
| `chat_sessions` 表 | 直接继承，不改 schema |
| `chat_messages` 表 | 直接继承，不改 schema |
| WebSocket 事件协议 | 直接继承（`chat:message` / `chat:done` / `chat:cancel_finalized` / `chat:session_read` / `chat:session_updated`） |
| `SendDirectChatMessage()` | 直接继承 |
| `EnqueueChatTask()` | 直接继承 |
| 优先级提升逻辑 | 直接继承（`CASE WHEN chat_session_id IS NOT NULL THEN GREATEST(priority, 3)`） |
| 附件支持 | 直接继承 |
| 取消/finalize/draft restore | 直接继承 |
| 频道绑定（Slack 等） | 直接继承（公测版不启用，架构预留） |

### F.6 未来增强方向（非公测版）

| 增强方向 | 场景 | 优先级 |
|---------|------|--------|
| Chat 内引用 Task | Owner 在 DM 中 @TaskID，Agent 自动拉取 Task 上下文 | P1 |
| Chat 转 Task | Owner 在 DM 中说"这个做成正式 Task"，将 chat 中的讨论转为 `project_tasks` | P1 |
| Agent 主动 DM | Agent 遇到阻塞时主动向 Owner 发 DM（而非 Comment） | P2 |
| Chat 摘要 | 长会话自动摘要，Agent 可回顾之前讨论 | P2 |

## 附录 G 引用文档注册表（agent 阅读单一入口）

> **定位**：本表登记本 TS 引用的全部外部设计/契约文档——正文 inline 引用（契约性，立即约束实现）、附录 D 缺口注册表的补齐来源（正文尚未转载，实现前须展开原文）、以及项目硬约束指定的机器可测注册表。**阅读法（agent 纪律，spec：technical-solution-drift-handling.md）**：调研/设计期判断"TS 是否说明某事"必须三步交叉——①正文关键词 grep ②附录 D 缺口注册表 ③本附录 G 引用注册表——两处注册表都空才能下"TS 未说明"结论；命中引用域后展开对应文档核对，不得只凭正文转述实现。
>
> **排除口径**（下列出现于正文但不属引用文档，守护测试豁免）：Task 执行产物（`CONTEXT.md` / `.context.json`、Architect-Agent 产出的 `ARCHITECTURE.md`）；附录 F.1 的源码位置指针（`db/queries/*.sql` 等，指向上游代码非设计文档）；本文件自引用。未被 TS 引用的 `research/` 纯背景文档不收录（可经目录枚举发现）。
>
> **守护测试**：`server/internal/migrations/ts_reference_registry_test.go` 双向断言——TS 全文新出现的 `.md`/`.sql`/`.json` 引用（排除口径外）必须登记本表（防漏登）；本表登记路径必须真实存在（防 stale）。

| # | 引用文档（仓库相对路径） | TS 引用点 | 内容域 | 引用性质 |
|---|------------------------|----------|--------|---------|
| 1 | `docs/design/research/schema-unified.sql` | §1.2 及全文（17+ 处） | 54 表目标态完整 DDL（§1.2 表清单的 DDL 真相源） | 契约已生效（分 milestone 落地，缺口见附录 D.1） |
| 2 | `docs/design/research/state-transition-edges.json` | §8.3 单一真相声明（正文不点名文件，路径由项目硬约束指定） | Task 状态转移边机器可测注册表（from/to/trigger/guard/gate/side） | 契约已生效（M0.2 建立，M2-C2 引擎逐字段对齐） |
| 3 | `docs/design/research/artifact-storage-boundary.json` | 附录 D.1 #7 状态注记 | 产物存储边界注册表（deliverable/evidence 强制对象存储） | 契约已生效（M0.7） |
| 4 | `docs/design/research/evidence-gates-spec.md` | §9.4 gate_results `schema_ref`（§9） | Gate 结果 JSONB schema 契约 | 契约已生效 |
| 5 | `docs/design/research/interceptor-framework.md` | §8.3 边集一致性声明 | 拦截框架研究契约（边集/hook 链） | 契约已生效（M2-C2 实现） |
| 6 | `docs/design/research/mcp-tools-spec.md` | 附录 D.2 #9 | MCP 23 工具完整 inputSchema 契约（MCP 2.0 协议 + 工程化 SDK；统一输出信封 + 错误码表） | D.2 待合并（M2-C2 已按此实现 10 工具竞标子集） |
| 7 | `docs/design/research/document-concurrency.md` | 附录 D.2 #10 | 文档协作 API 契约（§2-3） | D.2 待合并 |
| 8 | `docs/design/research/pre-dispatch-spec.md` | 附录 D.2 #11 | Pre-dispatch Owner 干预 API（§4.4） | D.2 待合并 |
| 9 | `docs/design/research/project-watchdog-spec.md` | 附录 D.2 #12 | Watchdog payload（§2/§5） | D.2 待合并 |
| 10 | `docs/design/research/console-ui-design.md` | §13 配套文档（§17 前端 5 Port）、§17.2 与 UI DR-11 关系、附录 D.2 #13 | Console UI 设计 + 内部 REST API 清单 | 部分生效（Port 契约已升级全栈，DR-12 后共 10 Port），REST 清单 D.2 待合并 |
| 11 | `docs/design/research/workspace-dashboard.md` | 附录 D.2 #13 | Workspace 仪表盘 API | D.2 待合并 |
| 12 | `docs/design/research/notification-system.md` | 附录 D.2 #13/#14（L350 通知表） | 通知系统 API + `notification_deliveries` 表设计 | D.2 待合并 |
| 13 | `docs/design/research/employer-integration-api.md` | 附录 D.3 #19 | 雇主侧集成 API（计数标签的源文档） | D.3 待修正 |
| 14 | `.trellis/tasks/archive/2026-08/08-07-m0.6a-human-executor-decision/decision.md` | §0.2 P1 口径脚注、§2.2 M0.6a 决策产物 | Human 执行路径 P1 收窄决策（方案 B：协作与审批对等） | 决策已归档（M0.6a/b 落实） |
| 15 | `.trellis/spec/engineering/technical-solution-drift-handling.md` | 附录 G 定位声明（阅读纪律指针） | agent TS 阅读三步法 + 偏离处理三层载体/三路径 | 纪律指针（spec 为权威落点） |
| 16 | `docs/design/CSI-Agent-Owner-Console-Integration-Guide.md` | 附录 C.2 DR-12 落地章节声明 | 跨版块对接集成指南（§3.7 = LLM 网关与计费版块契约面） | 契约已生效（2026-08-20 裁决，DR-12 配套） |
| 17 | `.trellis/tasks/08-24-m4-d2-task-context/design.md` | §9.5 上下文类工具勘误记录 | M4-D2 裁决记录（refresh_context/read_task_file 工具契约、attempt_seq 语义、落盘边界、P1-P4 milestone 判据） | 契约已生效（2026-08-25 落地，勘误登记 R13②） |

---

> **文档结束**。本技术解决方案整合自 `research/` 目录下 28 份设计文档，覆盖全局架构、数据模型（目标态 54 表 + 2 视图，当前 `schema-unified.sql` 37 表 + 2 视图，缺口见附录 D.1）、质量保障（五层防线 + 合规三层）、执行拦截、Agent 运行时、编排监控、事件驱动、雇主侧集成、Console UI（12 路由 / 8 页面 / 6 WS 通道）、端到端流程、异常场景、PRD 对齐。8 项图纸级问题已补齐（详见各章），研发启动门禁与工程补齐项见附录 D（Sprint 0 基线任务不阻断研发启动，但阻断依赖该契约的功能实现与集成验收）。参考设计借鉴清单见附录 E（开发期参考，非架构要求）。Human↔Agent DM 复用分析见附录 F（公测版直接复用 Multica 原生 chat 基础设施）。**引用文档全景见附录 G（agent 阅读 TS 的单一引用入口，含阅读三步法）**。各专题详见对应研究文档。
