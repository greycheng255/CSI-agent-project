-- ============================================================================
-- CSI Agent Owner Console — 统一数据库 Schema (DDL)
-- ----------------------------------------------------------------------------
-- 文件: research/schema-unified.sql
-- 数据库: PostgreSQL 15+ (扩展: pgcrypto / uuid-ossp)
-- ORM:   Drizzle ORM (TypeScript)
-- 来源标注约定（出现在每张表头注释与字段行尾注释里）:
--   [M]    = Multica 原有
--   [P]    = Paperclip 注入
--   [C]    = CSI 新增 / 自研
--   [PRD]  = PRD v0.3 §x.y 明确定义
-- 版本标注:
--   P0 = 公测版必须 (MVP/Beta 必须实现)
--   P1 = 公测版增强 (Beta 内上线, 非阻断)
--   P2 = 后续版本预留 (公测版可为空 / 不强制)
-- DB 映射标注 (M0.1 新增, 见 design.md §2):
--   每张表头注释新增 [DB:<actual>] 或 [DB:NEW] 标注, 明确该表在实际 PG DB 中的归属。
--   [DB:NEW]  = 实际 DB 尚不存在, 需建表迁移 (M0.1 或 feature task)
--   [DB:<x>]  = 实际 DB 已存在, 表名为 <x> (CSI 逻辑名 ≠ 实际表名, 研发勿重名建表)
-- ============================================================================
--
-- CSI 逻辑名 → 实际 DB 表名 映射表 (design.md §2.1 + §2.2 + M2 Grilling 裁断 2026-08-18)
-- ────────────────────────────────────────────────────────────────────────────
--   CSI 逻辑名                  实际 DB 表名              存在性 / 动作
--   project_tasks               issue                     已存在 (001_init); M0.1 ALTER status 枚举 + ADD task_type/substate/goal_mode (999287/999288); [M2 裁断1] 物理承载确认=issue, M2 按竞标消费面 ALTER 加字段子集, M4 补齐 §A-§P
--   task_dependencies           issue_dependency          已存在 (001_init); [M2 裁断3] ALTER ADD dependency_type(sequential/optional) 列 (保留 type 列) + ADD UNIQUE(issue_id, depends_on_issue_id) CONCURRENTLY
--   agent_runs                  agent_task_queue          已存在 (001_init); M0.1 ADD execution_deadline_at (999289); [M2 勘误裁断] ALTER 扩展 status 枚举/trigger_reason/token_usage×3/cost_cents/transcript 等
--   workspaces                  workspace                 已存在 (001_init)
--   agents                      agent                     已存在 (001_init)
--   agent_runtimes              agent_runtime             已存在 (004)
--   runtime_profile             runtime_profile           已存在 (120); M0.1 仅补设计文档
--   skills                      skill                     已存在 (008)
--   agent_skills                agent_skill               已存在 (008)
--   projects                    project                   已存在 (034); [M2] 核验 CSI 字段差距后 ALTER 加 M2 子集 (status CSI 枚举/opportunity_id/marketplace_task_id 等), v0.3 11 字段按消费面分批
--   task_comments               comment                   已存在 (001_init); [M2 裁断3] ALTER ADD mentioned_agents/mentioned_members/structured_markers/created_by_run_id 四列 (文档 body → 物理列 content)
--   notifications               inbox_item                已存在 (001_init); [M2 勘误裁断] ALTER 扩展 level 枚举对齐(info/reminder/urgent)/source_type/channels
--   agent_teams                 squad                     已存在 (084); [M2 裁断2] M2 不动表 (无 team 消费方), M4 Team 协作消费时 ALTER 加 collaboration_mode/status/harness_max_attempts
--   agent_team_members          squad_member              已存在 (084); 同上
--   activity_log                activity_log              已存在 (001_init)  (注: design.md §2.2 误记为 activity, 实际表名 activity_log)
--   workspace_members           member                    已存在 (001_init); M0.1 跳过建表 (语义重复, 映射到 member)
--   workspace_invitations       workspace_invitation      已存在 (041);     M0.1 跳过建表 (映射到 workspace_invitation)
--   api_tokens                  personal_access_token     已存在 (011);     M0.1 跳过建表 (映射到 personal_access_token)
--   workspace_portfolio_cases   workspace_portfolio_cases [DB:NEW] M0.8 新建迁移 (999297); Workspace 展示页历史交付案例
--   workspace_credit_summary    workspace_credit_summary  [DB:NEW] M0.8 新建迁移 (999298); Workspace 信用数据 (平台自动生成)
--   其余 CSI 新增设计表          —                         实际 DB 不存在, 建表归各 feature task (M1-M5); [M2-C1 已建 2026-08-19, 999330-999367] M2 新表 7 张: project_routines(999330)/routine_steps(999331)/routine_runs(999332)/routine_run_step_results(999333)/task_interactions(999334)/budget_incidents(999335)/project_spec_revisions(999336), 六表 ALTER: issue(999356)/issue_dependency(999357)/comment(999358)/project(999359)/agent_task_queue(999360)/inbox_item(999361), 索引 25 个均单独 CONCURRENTLY 文件(999337-999355, 999362-999367)
--   agent_wakeup_requests       agent_wakeup_requests     [M4-D6 已建 2026-08-26, 999430] R13③ 裁决 Wake Queue 物理载体 (§6.4 重构: 三源 wake_source/reason_kind/priority/TTL 7 天/status 四值); 同批 999429 落 project 表 Watchdog/Goal Mode 5 列 (watchdog_config/goal_mode_extra_effort/estimated_total_effort/goal_mode_pending_since/goal_mode_stopped)
--   M0.1 17 缺口表中 14 张       <同名>                    M0.1 新建迁移 (999261+); 见 §7 各表 [DB:NEW]
-- ────────────────────────────────────────────────────────────────────────────
-- ============================================================================

-- 启用扩展
CREATE EXTENSION IF NOT EXISTS "pgcrypto";       -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";       -- uuid_generate_v4() 备用

-- ============================================================================
-- 通用枚举类型 (使用 TEXT + CHECK 约束, 便于演进; 此处集中声明可读性更好)
-- ============================================================================
-- 多态 Actor 类型: 沿用 Multica 习惯 (member / agent 二态)
--   - 'member' = Human (Agent Owner / Org Member)
--   - 'agent'  = AI Agent
--   - 'team'   = Agent Team (作为整体被分配任务时使用, 仅在 assignee_type 中出现)
-- 所有 actor_id 字段为 UUID, 不强制外键 (因为是多态)

-- ============================================================================
-- §1  Workspace 层 — 资源层 (持久化, 跨 Project 复用)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1.1  workspaces — Workspace 多租户隔离的最外层边界 [M] + [C] 扩展
--      来源: Multica workspace 表; CSI 扩展竞标/签约工作流相关配置
-- ----------------------------------------------------------------------------
CREATE TABLE workspaces (
  -- [M] 基础字段
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                      UUID NOT NULL,                  -- [M] 所属 Org (顶层组织)
  name                        TEXT NOT NULL,                  -- [M] Workspace 名称 (如 "Zhiran AI Studio")
  slug                        TEXT NOT NULL,                   -- [M] URL 友好标识
  description                 TEXT,                            -- [M] 简介
  logo_url                    TEXT,                            -- [M] Logo
  status                      TEXT NOT NULL DEFAULT 'active', -- [M] active | suspended | archived

  -- [M] 多态所有者 (沿用 Multica 习惯: actor_type + actor_id)
  owner_type                  TEXT NOT NULL DEFAULT 'member', -- [M] 'member' (人类 Owner)
  owner_id                    UUID NOT NULL,                   -- [M] Owner UUID

  -- [C] CSI 业务配置 (公测版必须)
  auto_bid_enabled            BOOLEAN NOT NULL DEFAULT false,  -- [C] P0 是否自动参与竞标
  default_orchestrator_agent_id UUID,                          -- [C] P0 默认 Orchestrator Agent (FK agents.id)
  bid_approval_threshold      DECIMAL(12,2) NOT NULL DEFAULT 0,-- [C] P0 报价审批阈值 (超过需 Agent Owner 审批)
  sign_routine_enabled        BOOLEAN NOT NULL DEFAULT true,   -- [C] P0 启用标准签约流程
  clarification_round_limit    INT NOT NULL DEFAULT 5,         -- [C] P0 Spec 澄清循环上限
  mention_response_sla_hours  INT NOT NULL DEFAULT 4,          -- [C] P1 @mention 响应 SLA (小时)

  -- [C] 计算预算默认配置 (Project 级可覆盖, 见 PRD §7.12)
  default_compute_budget_ratio DECIMAL(4,3) NOT NULL DEFAULT 0.300, -- [C] P0 默认 30%
  default_budget_alert_threshold DECIMAL(4,3) NOT NULL DEFAULT 0.800, -- [C] P0 默认 80%

  -- [C] Workspace 展示页（店铺门面）字段 [PRD §5.6.7, M0.8]
  capability_tags             JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [PRD §5.6.7] 能力标签 (≤5 个, 应用层校验)
  service_commitments         JSONB NOT NULL DEFAULT '{}'::jsonb,   -- [PRD §5.6.7] 服务承诺 {response_hours, revision_count, refund_policy}
  showcase_announcement       TEXT,                                 -- [PRD §5.6.7] 首页公告 (≤200 字, CHECK 放迁移脚本)

  -- [P] Agent 月度预算 (Paperclip 模型, Workspace 级兜底)
  monthly_budget_cents        INT,                              -- [P] P1 Workspace 月度预算 (分)
  monthly_budget_used_cents   INT NOT NULL DEFAULT 0,            -- [P] P1 已用月度预算 (分)

  -- [M] 元数据 + 审计
  metadata                    JSONB NOT NULL DEFAULT '{}'::jsonb, -- [M] 扩展元数据
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(), -- [M]
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(), -- [M]

  UNIQUE(org_id, slug)
);

-- ----------------------------------------------------------------------------
-- 1.2  agents — Agent 一等公民 (多态 Actor 模型) [M] + [P] 预算注入
--      来源: Multica agents 表; Paperclip budget_monthly_cents 字段
--      注: Orchestrator 与普通 Agent 同表, 差异仅在 role + MCP 工具集
-- ----------------------------------------------------------------------------
CREATE TABLE agents (
  -- [M] 基础字段
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id                UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, -- [Multica 原生 FK, fork 继承, CSI 不新增]
  name                        TEXT NOT NULL,                   -- [M] Agent 显示名
  role                        TEXT NOT NULL DEFAULT 'general', -- [M] orchestrator | pm | architect | tester | dev | reviewer | dba | general
  provider                    TEXT NOT NULL,                   -- [M] claude | codex | opencode | hermes | ...
  runtime_id                  UUID,                            -- [M] 绑定的 Runtime (FK agent_runtimes.id)
  status                      TEXT NOT NULL DEFAULT 'idle',    -- [M] idle | working | blocked | error | offline
  visibility                  TEXT NOT NULL DEFAULT 'workspace', -- [M] workspace | private

  -- [M] 行为配置
  instructions                TEXT,                             -- [M] Agent Owner 自定义系统提示词
  mcp_config                  JSONB NOT NULL DEFAULT '{}'::jsonb, -- [M] MCP 工具白名单与配置
  env_vars                    JSONB NOT NULL DEFAULT '{}'::jsonb, -- [M] 环境变量
  cli_args                    JSONB NOT NULL DEFAULT '{}'::jsonb, -- [M] CLI 启动参数

  -- [M] 并发控制
  max_concurrent_tasks        INT NOT NULL DEFAULT 1,           -- [M] 最大并发 Task 数

  -- [P] 预算控制 (Paperclip budget 系统, Agent 级)
  budget_monthly_cents        INT,                              -- [P] P1 月度预算上限 (分)
  budget_used_cents           INT NOT NULL DEFAULT 0,            -- [P] P1 已用 (分)
  budget_alert_threshold      DECIMAL(4,3) NOT NULL DEFAULT 0.800, -- [P] P1 预算告警阈值
  budget_paused_at            TIMESTAMPTZ,                      -- [P] P1 预算超限暂停时间

  -- [C] Orchestrator 标记 (technical-design §4.2)
  is_orchestrator             BOOLEAN NOT NULL DEFAULT false,   -- [C] P0 是否充当 Orchestrator
  template_id                 UUID,                             -- [C] P0 创建来源模板 (FK agent_templates.id)

  -- [C] 备用 Agent (Harness Loop 第 3 次尝试切换)
  alternative_agent_id        UUID,                             -- [C] P2 Harness 切换备选 Agent

  -- [M] 元数据 + 审计
  metadata                    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at                  TIMESTAMPTZ                       -- [M] 软删除
);

CREATE INDEX idx_agents_workspace  ON agents(workspace_id);
CREATE INDEX idx_agents_status      ON agents(status);
CREATE INDEX idx_agents_runtime     ON agents(runtime_id);

-- ----------------------------------------------------------------------------
-- 1.3  agent_runtimes — Runtime 资源池 (Multica Daemon → CSI K8s Pod)  [DB: agent_runtime]
--      来源: Multica runtime 表; CSI 改造为 K8s Pod 模型
--      §2.4 四层实体模型: 此表对应 RuntimeInstance 层 (运行实例)
-- ----------------------------------------------------------------------------
CREATE TABLE agent_runtimes (
  -- [M] 基础字段
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id                UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, -- [Multica 原生 FK, fork 继承, CSI 不新增]
  name                        TEXT NOT NULL,                    -- [M] Runtime 名称 (如 "pod-3x7a")
  runtime_type                TEXT NOT NULL DEFAULT 'k8s_pod',  -- [C] P0 k8s_pod (后续可扩展)

  -- [C] K8s Pod 模型 (改造自 Multica Daemon 轮询模型)
  cluster_endpoint            TEXT,                              -- [C] P0 K8s API endpoint
  namespace                   TEXT,                              -- [C] P0 K8s namespace
  pod_name                    TEXT,                              -- [C] P0 实际 Pod 名
  pvc_path                    TEXT,                              -- [C] P0 Agent 工作目录 PVC 挂载点
  -- 通信采用 Multica 原版 HTTP 轮询机制，无需 gRPC。K8s Pod 内运行 Multica Daemon 容器即可。

  -- [M] 注册与心跳
  registration_token          TEXT,                              -- [M] 一次性注册 Token (首次注册后失效)
  long_term_token_hash        TEXT,                              -- [M] 长期 Token 哈希
  public_key                  TEXT,                              -- [M] Runtime 公钥 (验签)
  heartbeat_interval_seconds  INT NOT NULL DEFAULT 30,           -- [C] 心跳间隔 (Multica 15s, CSI 30s)
  grace_period_seconds        INT NOT NULL DEFAULT 300,          -- [C] 离线宽限期 5 分钟

  -- [M] 状态
  status                      TEXT NOT NULL DEFAULT 'offline',   -- [M] online | offline | draining | error
  last_heartbeat_at           TIMESTAMPTZ,                       -- [M] 最近心跳时间
  registered_at               TIMESTAMPTZ,                       -- [M] 注册成功时间

  -- [M] 容量与并发
  max_agents                  INT NOT NULL DEFAULT 5,            -- [M] 该 Runtime 可承载 Agent 数
  active_agent_count          INT NOT NULL DEFAULT 0,            -- [M] 当前活跃 Agent 数

  -- [M] 元数据 + 审计
  metadata                    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at                  TIMESTAMPTZ
);

CREATE INDEX idx_runtimes_workspace ON agent_runtimes(workspace_id);
CREATE INDEX idx_runtimes_status     ON agent_runtimes(status);

-- ----------------------------------------------------------------------------
-- 1.3b  Runtime 四层实体模型 (§2.4; runtime_profile_version / runtime_instance
--       已由 M1-B4 migrations 999305-999309 落地)
--       层级: RuntimeProfile (模板) → RuntimeProfileVersion (版本) →
--             RuntimeInstance (provisioning 记录, 见下) → agent_runtimes (Pod 内
--             daemon 注册行, 见 1.3; runtime_instance.runtime_id 回填指向)
-- ----------------------------------------------------------------------------
-- runtime_profile — Runtime 配置模板 (workspace 级, 团队共享)  [DB: runtime_profile] (已存在 120)
CREATE TABLE runtime_profile (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id                UUID NOT NULL,                    -- [M] 所属 Workspace (无 DB FK, 应用层校验)
  display_name                TEXT NOT NULL,                    -- [M] 显示名
  protocol_family             TEXT NOT NULL,                    -- [M] claude | codex | opencode | hermes | gemini | ... (与 agent.New() switch 同步)
  command_name                TEXT NOT NULL,                    -- [M] 启动命令
  description                 TEXT,                             -- [M] 描述
  fixed_args                  JSONB NOT NULL DEFAULT '[]',      -- [M] 固定继承参数 (非 per-agent args)
  visibility                  TEXT NOT NULL DEFAULT 'workspace' CHECK (visibility IN ('workspace','private')),
  created_by                  UUID,                             -- [M] 创建者 (无 DB FK)
  enabled                     BOOLEAN NOT NULL DEFAULT true,    -- [M] 是否启用
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, display_name)
);

-- runtime_profile_version — Runtime 配置版本 (CSI 自研, §2.4)  [DB:NEW → migration 999305, M1-B4 落地]
--      用途: runtime_profile 的版本化快照, 支持灰度回滚; runtime_instance.profile_version_id 指向当前版本
--      §2.4 层2 语义 (semver + OCI 镜像 + 资源 + 预装 CLI 清单) 落为结构化列; config_snapshot 保留完整快照
CREATE TABLE runtime_profile_version (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id                  UUID NOT NULL,                    -- [C] 关联 runtime_profile (无 DB FK)
  version                     INT NOT NULL,                     -- [C] 内部单调递增版本号
  semver                      TEXT NOT NULL,                    -- [C] §2.4 层2 semver (人读版本)
  image                       TEXT NOT NULL,                    -- [C] OCI 镜像
  resources                   JSONB NOT NULL DEFAULT '{}',      -- [C] {"cpu":"2","memory":"4Gi"} (零值 => provisioner 默认)
  preinstalled_clis           JSONB NOT NULL DEFAULT '[]',      -- [C] §2.4 层2 预装 CLI 清单
  config_snapshot             JSONB NOT NULL,                    -- [C] 完整配置快照 (protocol_family / command_name / fixed_args / env ...)
  change_summary              TEXT,                             -- [C] 变更摘要
  created_by                  UUID,                             -- [C] 发布者
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);  -- UNIQUE(profile_id, version) => migration 999307 (CONCURRENTLY)

-- runtime_instance — Runtime 运行实例 (CSI 自研, §2.4 层3)  [DB:NEW → migration 999306, M1-B4 落地]
--      用途: provisioning-first 形态 — §2.4 层3 = "1 Deployment(replicas=1) + 1 PVC + 1 注册 Token",
--      由 Console 在 daemon 注册前创建; runtime_id 可空, daemon 注册后由应用层回填 (M2)
--      (M0.1 快照的 runtime_id NOT NULL 形态无法承载注册前创建, 见 B4 design.md 偏离-001)
CREATE TABLE runtime_instance (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id                UUID NOT NULL,                    -- [C] 所属 Workspace (无 DB FK)
  profile_version_id          UUID NOT NULL,                    -- [C] 当前绑定的 runtime_profile_version
  registration_token_hash     TEXT NOT NULL,                    -- [C] 一次性注册 Token (哈希; 注入 Pod env MULTICA_TOKEN)
  namespace                   TEXT NOT NULL,                    -- [C] K8s namespace
  deployment_name             TEXT NOT NULL,                    -- [C] "rt-<instance-id>" (UNIQUE => migration 999308)
  pvc_name                    TEXT NOT NULL,                    -- [C] "pvc-<instance-id>" (与 image/version 无关 => 升级保留)
  desired_state               TEXT NOT NULL DEFAULT 'running'
                              CHECK (desired_state IN ('running','stopped')), -- [C] 期望态
  status                      TEXT NOT NULL DEFAULT 'pending',  -- [C] pending|running|stopped|failed (ports.RuntimeInstance.Status)
  runtime_id                  UUID,                             -- [C] daemon 注册后回填 agent_runtimes.id (可空)
  health_state                TEXT NOT NULL DEFAULT 'unknown',  -- [C] healthy | degraded | unreachable | unknown
  last_probe_at               TIMESTAMPTZ,                      -- [C] 最近健康探针时间
  metadata                    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);  -- UNIQUE(deployment_name) => migration 999308; idx(workspace_id) => migration 999309

-- ----------------------------------------------------------------------------
-- 1.4  agent_teams — Agent Team (Multica Squad) [M]
--      来源: Multica squad 表
--      注: 公测版仅 Leader-Delegation 模式 (PRD §7.10.1)
-- ----------------------------------------------------------------------------
CREATE TABLE agent_teams (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id                UUID NOT NULL, -- (无 FK, 应用层清理, AGENTS.md 硬规则)
  name                        TEXT NOT NULL,                     -- [M] Team 名称
  description                 TEXT,                               -- [M] 简介
  leader_agent_id             UUID NOT NULL, -- (无 FK, 应用层清理, AGENTS.md 硬规则) [M] Leader Agent
  collaboration_mode          TEXT NOT NULL DEFAULT 'leader_delegation', -- [C] P0 leader_delegation | peer_review | pipeline
  status                      TEXT NOT NULL DEFAULT 'active',     -- [M] active | disbanded

  -- [C] Team 级 Harness 预算 (task-quality-defense.md §6.3)
  harness_max_attempts        INT NOT NULL DEFAULT 3,             -- [C] P0 Team 层级失败上限 (与单 Agent 4 不同)

  metadata                    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at                  TIMESTAMPTZ
);

CREATE INDEX idx_teams_workspace ON agent_teams(workspace_id);

-- ----------------------------------------------------------------------------
-- 1.5  agent_team_members — Team 成员关系 (多态, Agent + Human) [M]
--      来源: Multica squad_members 表
-- ----------------------------------------------------------------------------
CREATE TABLE agent_team_members (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id                     UUID NOT NULL, -- (无 FK, 应用层清理, AGENTS.md 硬规则)
  -- 多态成员 (沿用 Multica actor_type + actor_id 模型)
  member_type                 TEXT NOT NULL,                     -- [M] 'agent' | 'member' (Human)
  member_id                   UUID NOT NULL,                     -- [M] Agent ID 或 Member ID
  role_in_team                TEXT NOT NULL DEFAULT 'member',    -- [M] leader | member
  joined_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at                     TIMESTAMPTZ,                       -- [M] 离队时间
  metadata                    JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(team_id, member_type, member_id)
);

CREATE INDEX idx_team_members_team ON agent_team_members(team_id);

-- ----------------------------------------------------------------------------
-- 1.6  skills — Skill 库 [M]
--      来源: Multica skill 表 (Markdown 指令 + 配套文件)
--      注: 平台市场导入 / Workspace 自定义
-- ----------------------------------------------------------------------------
CREATE TABLE skills (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id                UUID REFERENCES workspaces(id) ON DELETE CASCADE, -- [M] NULL = 平台市场公共 Skill -- [Multica 原生 FK, fork 继承, CSI 不新增]
  name                        TEXT NOT NULL,                     -- [M] Skill 名称 (如 "csi-collaboration")
  display_name                TEXT NOT NULL,                     -- [M] 显示名
  description                 TEXT,                               -- [M] Skill 描述
  category                    TEXT,                               -- [M] 分类 (collaboration | self-verification | domain | ...)
  format                      TEXT NOT NULL DEFAULT 'markdown',   -- [M] markdown (后续可扩展)

  -- [M] Skill 文件内容 (Markdown 指令)
  body                        TEXT NOT NULL,                      -- [M] Skill 正文
  version                     TEXT NOT NULL DEFAULT '1.0.0',      -- [M] Skill 版本
  checksum                    TEXT,                                -- [M] 内容校验和

  -- [C] CSI 内置 Skill 标记
  is_builtin                  BOOLEAN NOT NULL DEFAULT false,     -- [C] P0 平台内置 (csi-self-verification 等)
  is_active                   BOOLEAN NOT NULL DEFAULT true,       -- [M] 是否启用

  metadata                    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at                  TIMESTAMPTZ
);

CREATE INDEX idx_skills_workspace ON skills(workspace_id);
CREATE INDEX idx_skills_name      ON skills(name);

-- agent_skills 多对多关联表 [M]
CREATE TABLE agent_skills (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id                    UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE, -- [Multica 原生 FK, fork 继承, CSI 不新增]
  skill_id                    UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE, -- [Multica 原生 FK, fork 继承, CSI 不新增]
  attached_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  attached_by_type            TEXT NOT NULL,                    -- [M] 多态: member | agent
  attached_by_id              UUID NOT NULL,
  UNIQUE(agent_id, skill_id)
);

CREATE INDEX idx_agent_skills_agent ON agent_skills(agent_id);
CREATE INDEX idx_agent_skills_skill ON agent_skills(skill_id);

-- ----------------------------------------------------------------------------
-- 1.7  agent_templates — Agent 模板库 [C]
--      来源: technical-design.md §4.2.2 (Agent Owner 从模板创建 Agent)
-- ----------------------------------------------------------------------------
CREATE TABLE agent_templates (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id                UUID, -- (无 FK, 应用层清理, AGENTS.md 硬规则) [C] NULL = 平台公共模板
  name                        TEXT NOT NULL,                     -- [C] 模板名 (如 "全栈开发 Orchestrator")
  display_name                TEXT NOT NULL,
  description                 TEXT,                              -- [C] 模板说明
  category                    TEXT,                              -- [C] orchestrator | dev | tester | reviewer | general

  -- [C] 预填字段 (Agent Owner 创建 Agent 时的默认值, 可覆盖)
  default_name                TEXT,                              -- [C] 预填 Agent 名
  default_role                TEXT,                              -- [C] 预填 role
  default_instructions        TEXT,                              -- [C] 预填系统提示词
  default_skill_ids           UUID[] NOT NULL DEFAULT '{}',      -- [C] 预填挂载的 Skill
  default_provider            TEXT,                              -- [C] 推荐 Provider
  default_mcp_config          JSONB NOT NULL DEFAULT '{}'::jsonb, -- [C] 预填 MCP 工具集
  recommended_budget_cents    INT,                                -- [C] 推荐月度预算
  requires_runtime            BOOLEAN NOT NULL DEFAULT true,     -- [C] 是否必须绑定 Runtime

  -- [C] 模板来源 ( Orchestrator 模板包含 submit_plan MCP 工具)
  is_orchestrator_template    BOOLEAN NOT NULL DEFAULT false,    -- [C] 标记 Orchestrator 模板
  is_builtin                  BOOLEAN NOT NULL DEFAULT false,     -- [C] 平台内置
  is_active                   BOOLEAN NOT NULL DEFAULT true,

  metadata                    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at                  TIMESTAMPTZ
);

CREATE INDEX idx_templates_workspace ON agent_templates(workspace_id);
CREATE INDEX idx_templates_category ON agent_templates(category);

-- ----------------------------------------------------------------------------
-- 1.8  agent_quality_profile — Agent 质量档案 [C]
--      来源: quality-compliance-enforcement.md §3.3
--      用途: 给 Orchestrator 分配决策提供信任度依据
-- ----------------------------------------------------------------------------
CREATE TABLE agent_quality_profile (
  agent_id                     UUID PRIMARY KEY, -- (无 FK, 应用层清理, AGENTS.md 硬规则)

  -- [C] 提交质量
  total_tasks_completed        INT NOT NULL DEFAULT 0,            -- [C] P0 累计完成 Task 数
  tasks_passed_first_review    INT NOT NULL DEFAULT 0,            -- [C] P0 一次 Review 通过数
  avg_review_rounds            REAL NOT NULL DEFAULT 0,            -- [C] P0 平均 Review 轮数
  avg_self_test_issues_found   REAL NOT NULL DEFAULT 0,            -- [C] P1 自测平均发现问题数

  -- [C] 审查质量 (仅 Reviewer/Tester)
  total_reviews_done           INT NOT NULL DEFAULT 0,             -- [C] P0
  shallow_approval_count       INT NOT NULL DEFAULT 0,             -- [C] P0 空洞 approve 次数
  issues_caught_in_review      INT NOT NULL DEFAULT 0,             -- [C] P0 审查中拦截的问题数
  issues_missed_by_review      INT NOT NULL DEFAULT 0,             -- [C] P1 审查通过后被下游发现的问题数

  -- [C] 协作质量
  mention_response_avg_hours   REAL,                               -- [C] P0 @mention 平均响应时间
  mention_ignored_count        INT NOT NULL DEFAULT 0,             -- [C] P0 未响应 @mention 次数

  -- [C] 评估结果
  quality_tier                 TEXT NOT NULL DEFAULT 'standard',   -- [C] P0 excellent | standard | needs_attention
  last_evaluated_at            TIMESTAMPTZ,                        -- [C] P0
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 1.10  workspace_portfolio_cases — Workspace 展示页历史交付案例 [C] [PRD §5.6.7, M0.8]
--      Agent Owner 上传, 最多 6 个 (应用层 COUNT 校验)
-- ----------------------------------------------------------------------------
CREATE TABLE workspace_portfolio_cases (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id                UUID NOT NULL,                     -- [PRD §5.6.7] 所属 Workspace (无 FK, 应用层清理)
  title                       TEXT NOT NULL,                     -- [PRD §5.6.7] 案例标题
  summary                     TEXT,                              -- [PRD §5.6.7] 案例简介
  screenshot_url              TEXT,                              -- [PRD §5.6.7] 脱敏截图/摘要 URL
  visibility                  TEXT NOT NULL DEFAULT 'public',    -- [PRD §5.6.7] public | review_only
  authorization_declared      BOOLEAN NOT NULL DEFAULT false,    -- [PRD §5.6.7] Agent Owner 声明已获授权或已脱敏
  display_order               INT NOT NULL DEFAULT 0,            -- 展示顺序
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_portfolio_workspace ON workspace_portfolio_cases(workspace_id);

-- ----------------------------------------------------------------------------
-- 1.11  workspace_credit_summary — Workspace 信用数据 (平台自动生成) [C] [PRD §5.6.7, M0.8]
--      Agent Owner 不可修改; 由定时 job 写入/刷新; 新店标识 = total_tasks_completed < 3 (派生)
-- ----------------------------------------------------------------------------
CREATE TABLE workspace_credit_summary (
  workspace_id                UUID PRIMARY KEY,                  -- 1:1 关联 workspaces (无 FK, 应用层保证)
  total_tasks_completed       INT NOT NULL DEFAULT 0,            -- [PRD §5.6.7] 完成任务数
  avg_rating                   DECIMAL(3,2),                      -- [PRD §5.6.7] 平均评分 (0.00-5.00 星级)
  on_time_delivery_rate        DECIMAL(5,4),                      -- [PRD §5.6.7] 按时交付率 (0.0000-1.0000)
  dispute_rate                 DECIMAL(5,4),                      -- [PRD §5.6.7] 纠纷率 (0.0000-1.0000)
  computed_at                  TIMESTAMPTZ NOT NULL DEFAULT now()  -- 最近计算时间
);

-- ============================================================================
-- §2  Project 层 — 执行层 (有始有终)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 2.1  opportunities — 商机 (CSI 独有) [C] [PRD §8.2]
--      来源: PRD v0.3 §8.2 商机实体定义
-- ----------------------------------------------------------------------------
CREATE TABLE opportunities (
  -- [C] 基础字段
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id                UUID NOT NULL, -- (无 FK, 应用层清理, AGENTS.md 硬规则) [PRD §8.2]
  marketplace_task_id         UUID NOT NULL,                     -- [PRD §8.2] 关联的 CSI 大厅任务（manual_assign 由应用层生成本地 UUID 占位，B6）
  title                       TEXT NOT NULL,                     -- [B6] manual_assign 商机标题（OpportunitySourcePort 幂等键 workspace_id+title 依赖）
  status                      TEXT NOT NULL DEFAULT 'pending',   -- [PRD §8.2 + §5.4] 见 §8.7 状态机
  bid_round                   INT NOT NULL DEFAULT 1,            -- [PRD §8.2] 当前竞标轮次

  -- [PRD §8.2] 商机来源
  discovery_source            TEXT NOT NULL,                     -- [PRD §8.2] push | pull | manual_assign
  source                      TEXT NOT NULL,                     -- [PRD §8.2] platform_push | workspace_pull | manual_assign
  match_score                 REAL,                              -- [PRD §8.2] 匹配度分数 (仅 push 时有值)
  is_platform_recommended_bid BOOLEAN NOT NULL DEFAULT false,    -- [PRD §8.2] 平台推荐竞标标志

  -- [PRD §8.2] 竞标内容
  bid_content                 TEXT,                              -- [PRD §8.2] 竞标方案文本
  bid_price                   DECIMAL(12,2),                    -- [PRD §8.2] 报价金额
  bid_estimated_days          INT,                               -- [PRD §8.2] 预计交付天数
  bid_history                 JSONB,                             -- [PRD §8.2] 历史竞标轮次记录
  reject_reason               TEXT,                              -- [PRD §8.2] 不予竞标原因

  -- [PRD §8.2] 时间戳
  status_changed_at           TIMESTAMPTZ NOT NULL DEFAULT now(), -- [PRD §8.2]
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(workspace_id, marketplace_task_id)                     -- [PRD §8.2] 唯一约束
);

CREATE INDEX idx_opp_workspace ON opportunities(workspace_id);
CREATE INDEX idx_opp_status    ON opportunities(status);
CREATE INDEX idx_opp_market    ON opportunities(marketplace_task_id);

-- ----------------------------------------------------------------------------
-- 2.2  projects — Project 容器 (核心实体) [M] + [C] 扩展 + [PRD v0.3 §8.3] 新增 11 字段
--      来源: Multica project 基表 + CSI Spec/Plan/Budget 扩展 + PRD v0.3 §8.3
--      [M2-C1 落地注记 2026-08-19, 迁移 999359]: 物理表 project 已落 M2 子集 —
--        status: CSI 16 值超集 CHECK(∪上游旧值 planned/in_progress/paused/completed/cancelled,
--          M2 过渡期双写入方共存, M3 Project 转移边落地时收缩) + DEFAULT 'spec_nego' + 存量行映射
--          (planned→spec_nego, in_progress→executing, paused→paused_exception, completed→completed_pending_appeal);
--        加列: opportunity_id / marketplace_task_id / category / orchestrator_agent_id;
--        索引: idx_projects_status(999363) / idx_projects_opportunity(999364)。
--      [M3-D1 落地注记 2026-08-23, 迁移 999378/999379]:
--        999378 落地 M3 签约列子集 11 列 (spec_snapshot/spec_snapshot_hash/spec_confirmed_at/plan/
--          plan_version/final_price/revision_limit/revision_count/revision_negotiation_deadline/
--          budget_paused_at/clarification_count——G4 裁决的澄清轮次计数, 与 revision_count 对称,
--          Guard 上限读 workspace.clarification_round_limit 默认 5, TS §3.2 已同步 12 字段口径);
--        999379 status CHECK 由 20 值超集收缩为精确 16 值 (附录 A.1 口径, 存量 legacy 值已映射),
--          上游写入面 (Go handler/CLI/前端类型与表单/测试 fixture) 同批收敛到 16 值;
--      [M4-D6b 落地注记 2026-08-26, 迁移 999425]: 预算扫描 3 列
--          (project_compute_budget_ratio/budget_alert_threshold/compute_cost_used) 已落地
--          (budget_scanner 触发器输入, TS §3.2);
--      [M4-D6 落地注记 2026-08-26, 迁移 999429]:
--        999429 落地 Watchdog/Goal Mode 5 列 (watchdog_config JSONB 默认值=research §4.1 口径 /
--          goal_mode_extra_effort / estimated_total_effort / goal_mode_pending_since /
--          goal_mode_stopped——Goal Mode 20% 阈值链 + Owner 三支载体, TS §10.5/§10.7);
--        剩余差距: M5 验收链路(4列: auto_accept_after/after_sale_deadline/delivered_at/completed_at)。
--      现状多出列 icon/priority/lead_type/lead_id 为上游 console 消费, 保留不动 (物理超集)。
--      列名映射注记: 文档 name → 物理列 title (034 起); 研发按物理列名写 SQL (同 body→content 先例)。
-- ----------------------------------------------------------------------------
CREATE TABLE projects (
  -- [M] 基础字段 (Multica Project 基表)
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id                UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, -- [M] -- [Multica 原生 FK, fork 继承, CSI 不新增]
  name                        TEXT NOT NULL,                     -- [M] Project 名称
  description                 TEXT,                               -- [M] Project 简介
  status                      TEXT NOT NULL DEFAULT 'spec_nego', -- [C] PRD §8.7 状态机 (spec_nego | planning | plan_review | executing | in_accept | completed | cancelled | ...)

  -- [C] PRD §8.3 关联实体
  opportunity_id              UUID REFERENCES opportunities(id), -- [PRD §8.3] 中标商机 -- [Multica 原生 FK, fork 继承, CSI 不新增]
  marketplace_task_id         UUID,                               -- [PRD §8.3] 关联的 CSI 大厅任务
  category                    TEXT NOT NULL,                      -- [C] 类目 (来自 Marketplace, 如 "软件开发/企业应用")

  -- [C] Orchestrator 编排
  orchestrator_agent_id       UUID REFERENCES agents(id),        -- [C] P0 负责编排的 Agent -- [Multica 原生 FK, fork 继承, CSI 不新增]

  -- [C] Spec 契约
  spec_snapshot               JSONB,                              -- [C] P0 Spec 锁定快照 (见 §8.5)
  spec_snapshot_hash           TEXT,                               -- [C] P0 Spec 内容哈希 (防篡改)
  spec_confirmed_at           TIMESTAMPTZ,                        -- [PRD §8.3] P0 Spec 签订时间

  -- [C] Plan
  plan                        JSONB,                              -- [C] P0 当前 Plan (多阶段 DAG)
  plan_version                INT NOT NULL DEFAULT 1,             -- [C] P0 Plan 版本号

  -- [C] 价格 / 预算
  final_price                 DECIMAL(12,2),                     -- [C] P0 最终报价 (Spec 签订后锁定)

  -- [PRD §8.3 v0.3 新增] 修订协商 (共 2 字段)
  revision_limit              INT NOT NULL DEFAULT 2,             -- [PRD §8.3 v0.3] P0 修订次数上限 (从 Spec 继承)
  revision_count              INT NOT NULL DEFAULT 0,             -- [PRD §8.3 v0.3] P0 已使用修订次数
  revision_negotiation_deadline TIMESTAMPTZ,                      -- [PRD §8.3 v0.3] P0 修订超限协商窗口截止时间 (PRD §7.7.3)
  revision_negotiation_id     TEXT,                               -- [M5-A3 999439 已落] 活跃修订协商的 M 签发 id (#16 decide 路径参数载体, TS §12.2 场景六)

  -- [PRD §8.3 v0.3 新增] Goal Mode 工时 (共 2 字段) [M4-D6 999429 已落]
  estimated_total_effort       INT,                                -- [PRD §8.3 v0.3] P0 Plan 生成时锁定的预估总工时 (小时)
  goal_mode_extra_effort       INT NOT NULL DEFAULT 0,             -- [PRD §8.3 v0.3] P0 Goal Mode 累计额外工时 (达 20% 触发暂停)

  -- [M4-D6 / TS §10.5+§10.7, 迁移 999429] Watchdog 配置 + Goal Mode 达阈状态 (共 3 字段)
  watchdog_config              JSONB NOT NULL DEFAULT '{"enabled":true,"stall_threshold_minutes":60,"tier2_multiplier":3,"tier3_multiplier":6,"notification_channels":["console","email"]}', -- [C] P0 Watchdog 配置 (research §4.1 默认口径, 应用层防御性解析回落)
  goal_mode_pending_since      TIMESTAMPTZ,                        -- [C] P0 Goal Mode 达阈待 Owner 决策起点 (24h 窗口, 超时 auto-approve)
  goal_mode_stopped            BOOLEAN NOT NULL DEFAULT false,     -- [C] P0 Owner 裁定停止后后续 Goal Task 不再创建 (create_subtask 硬闸)

  -- [PRD §8.3 v0.3 新增] 计算预算 (共 4 字段)
  project_compute_budget_ratio DECIMAL(4,3) NOT NULL DEFAULT 0.300, -- [PRD §8.3 v0.3] P0 Project 计算预算上限占报价比例 (默认 30%, 10%-80%)
  budget_alert_threshold        DECIMAL(4,3) NOT NULL DEFAULT 0.800, -- [PRD §8.3 v0.3] P0 预算提醒阈值 (默认 80%)
  compute_cost_used             DECIMAL(12,4) NOT NULL DEFAULT 0,    -- [PRD §8.3 v0.3] P0 已累计计算成本 (Token + Runtime)
  budget_paused_at              TIMESTAMPTZ,                        -- [PRD §8.3 v0.3] P0 预算超限暂停时间

  -- [PRD §8.3 v0.3 新增] 验收 / 售后 (共 2 字段) [M5-A1 999433 已落]
  auto_accept_after             TIMESTAMPTZ,                       -- [PRD §8.3 v0.3] P0 14 天自动验收到期时间 (进入"待验收"时写入, §9.4)
  after_sale_deadline            TIMESTAMPTZ,                       -- [PRD §8.3 v0.3] P0 售后申诉期截止时间 (验收通过 +7 天)

  -- [PRD §8.3] 时间戳 [M5-A1 999433 已落]
  delivered_at                  TIMESTAMPTZ,                       -- [PRD §8.3] P0 交付物提交时间
  completed_at                  TIMESTAMPTZ,                       -- [PRD §8.3] P0 验收通过时间
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_projects_workspace    ON projects(workspace_id);
CREATE INDEX idx_projects_status       ON projects(status);
CREATE INDEX idx_projects_orchestrator ON projects(orchestrator_agent_id);
CREATE INDEX idx_projects_opportunity  ON projects(opportunity_id);

-- ----------------------------------------------------------------------------
-- 2.3  project_tasks — 核心任务表 [M] + [P] + [C] (融合表)  [DB: issue]
--      基础来源: complete-technical-solution.md §5 (完整版)
--      字段合并: technical-design.md §4.3.1 + task-quality-defense.md §8 (ALTER TABLE 扩展)
--      PRD §8.4 字段亦已对齐
--      §1.2.1 四项方向裁断落地点 (M0.1): ① status 11 值 / ② stages 切分 / ③ 移除 depends_on / ④ task_type+substate+goal_mode
--      [M2-C1 落地注记 2026-08-19, 迁移 999356]: 物理表 issue 已落 M2 竞标消费子集 (12 列):
--        §A 容器 context_type/context_id/opportunity_id (NULLABLE——存量上游行无 CSI context,
--          CSI 写入方保证非空, 与 999288 substate 同款哲学) + result (C4 step_context 投影源);
--        §F 执行锁 checkout_agent_id/checkout_run_id/execution_run_id/checkout_at (C3 Atomic Checkout);
--        §H stages 切分 execution_policy/execution_state (C2 Gate hook + request_approval append);
--        §I result_comment_status (C2 Floor1) + §K gate_results (G1-G6 单一真相源, M4 写入);
--        substate CHECK 9 值 (issue_substate_check, §1.2.1④ 枚举=附录 A.2 勘误后并集)。
--        索引: idx_tasks_context(999365) / idx_tasks_checkout partial(999366)。
--      未落列归 M4: assigned_team_id/milestone/depth/liveness 族/harness 族/self_test 族/
--        same_reason_reject 族/plan_version/phase/工时列/§L 协作溯源列。
-- ----------------------------------------------------------------------------
CREATE TABLE project_tasks (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ============================================================
  -- §A 多态容器 (Task 归属: Opportunity 或 Project)  [C] technical-design §5.2
  -- ============================================================
  context_type                TEXT NOT NULL,                     -- [C] 'opportunity' | 'project'
  context_id                  UUID NOT NULL,                     -- [C] opportunity_id 或 project_id (多态)
  project_id                  UUID REFERENCES projects(id),      -- [C] context_type='project' 时填充 -- [Multica 原生 FK, fork 继承, CSI 不新增]
  opportunity_id              UUID REFERENCES opportunities(id), -- [C] context_type='opportunity' 时填充 -- [Multica 原生 FK, fork 继承, CSI 不新增]
  parent_task_id              UUID REFERENCES project_tasks(id), -- [M] 父 Task (子 Task 时填充) -- [Multica 原生 FK, fork 继承, CSI 不新增]

  -- ============================================================
  -- §B Plan 关联  [C]
  -- ============================================================
  plan_version                INT,                                -- [C] P0 Phase 3 时填充 (Plan 版本号)
  phase                       INT,                                -- [C] P0 所属阶段 (Phase 3: 1-5)

  -- ============================================================
  -- §C 基本信息 (Multica Issue 核心字段)  [M]
  -- ============================================================
  title                       TEXT NOT NULL,                     -- [M] [PRD §8.4]
  description                 TEXT,                               -- [M] [PRD §8.4]
  status                      TEXT NOT NULL DEFAULT 'planning',   -- [M] [PRD §8.4 + §8.7] §1.2.1 ① CSI 11 值: planning | queued | ready | dispatched | running | in_review | done | blocked | reopened | failed | skipped (旧 8 值已移除)
  priority                    TEXT,                                -- [M] P1 P0-P3 / critical / high / medium / low
  result                      JSONB,                              -- [M] [PRD §8.4 deliverables] Agent 完成时的结构化输出

  -- ============================================================
  -- §C2 Task 类型与目标模式 (CSI §1.2.1 ④)  [C]
  -- ============================================================
  task_type                   TEXT NOT NULL DEFAULT 'development',-- [C] P0 development | review | research | planning | routine (任务类型, 驱动执行策略)
  substate                    TEXT,                               -- [C] P0 子状态 (细粒度执行态, 如 review 内 awaiting_approval; NULL 表示无子态)
  goal_mode                   BOOLEAN NOT NULL DEFAULT false,     -- [C] P0 是否目标模式 (自主达成目标而非按步骤执行)

  -- ============================================================
  -- §D 分配 (Multica 多态 assignee)  [M]
  -- ============================================================
  assignee_type               TEXT NOT NULL DEFAULT 'agent',     -- [M] agent | team | member | agent_owner | platform
  assignee_id                 UUID,                                -- [M] 多态: agent_id / team_id / member_id
  assigned_team_id            UUID REFERENCES agent_teams(id),    -- [M] 显式 Team 引用 (assignee_type='team' 时填充) -- [Multica 原生 FK, fork 继承, CSI 不新增]

  -- ============================================================
  -- §E DAG 依赖  [C]
  --      §1.2.1 ③: depends_on UUID[] 已移除 — 依赖关系由 task_dependencies
  --      表 (实际 DB: issue_dependency) 承载, 便于查询与反向索引
  -- ============================================================
  milestone                   BOOLEAN NOT NULL DEFAULT false,     -- [C] P0 [PRD §8.4] 是否里程碑节点 (触发 Evidence Gate)
  depth                       INT NOT NULL DEFAULT 0,             -- [C] P0 [PRD §8.4] 层级深度 (根=0, 子=1, 孙=2, 上限=3)

  -- ============================================================
  -- §F 执行锁 (Paperclip Atomic Checkout)  [P]
  -- ============================================================
  checkout_agent_id           UUID,                               -- [P] P0 签出 Agent (谁拥有执行权)
  checkout_run_id             UUID,                               -- [P] P0 签出 Run (签出锁)
  execution_run_id            UUID,                               -- [P] P0 当前活跃执行 Run (执行锁, 与签出锁分离)
  checkout_at                 TIMESTAMPTZ,                        -- [P] P0 签出时间

  -- ============================================================
  -- §G Liveness 跟踪 (Paperclip)  [P]
  -- ============================================================
  liveness_state              TEXT NOT NULL DEFAULT 'healthy',   -- [P] P0 healthy | stalled | recovering | monitoring
  last_liveness_check_at      TIMESTAMPTZ,                        -- [P] P0
  recovery_attempts           INT NOT NULL DEFAULT 0,             -- [P] P0 已尝试恢复次数

  -- ============================================================
  -- §H Execution Policy (Paperclip 强制执行)  [P]
  --      §1.2.1 ②: stages 单一真相位置切分 —
  --        execution_policy.stages = 配置态 (Plan 落地时写入, 定义有哪些阶段)
  --          例: { stages: [{ id, type: review|approval, participants, sla_hours }] }
  --        execution_state.stages  = 运行态 (执行引擎推进时更新, 记录每阶段实时进度)
  --          例: { currentStageIndex, currentStageType, currentParticipant,
  --                stages: [{ id, status, started_at, decided_at, decision }] }
  --      配置态只读于 Plan, 运行态由执行引擎 (M4) 独占写入, 二者不交叉覆盖。
  --      注: 此二列归 M4 执行引擎 task 范围; M0.1 仅在设计文档固化语义切分, 不 ADD COLUMN。
  -- ============================================================
  execution_policy            JSONB,                              -- [P] P0 配置态: execution_policy.stages 定义阶段清单
  execution_state             JSONB,                              -- [P] P0 运行态: execution_state.stages 记录实时进度

  -- ============================================================
  -- §I Comment Required (Paperclip)  [P]
  -- ============================================================
  result_comment_status       TEXT,                               -- [P] P0 satisfied | retry_queued | retry_exhausted
  result_comment_id           UUID,                               -- [P] P0 关联的完成说明 Comment ID

  -- ============================================================
  -- §J Harness Loop (CSI 自研)  [C] complete-technical-solution §5
  -- ============================================================
  harness_attempt             INT NOT NULL DEFAULT 0,             -- [C] P0 [PRD §8.4] 当前 Harness Loop 尝试次数
  harness_max_attempts        INT NOT NULL DEFAULT 4,             -- [C] P0 [PRD §8.4] 最大尝试次数 (默认 4)
  last_failure_report         JSONB,                              -- [C] P0 最近一次失败报告
  previous_attempt_snapshot   JSONB,                              -- [C] P0 上一次尝试的 Executor 快照

  -- ============================================================
  -- §K Evidence Gates (CSI 自研)  [C]
  -- ============================================================
  gate_results                JSONB,                              -- [C] P0 [PRD §8.4 evidence_gate_results] { gate_id: { passed, failures[] } }

  -- ============================================================
  -- §L 协作溯源  [C] technical-design §4.8.8
  -- ============================================================
  created_from_comment_id     UUID,                               -- [C] P0 从哪个 @mention/Comment 创建
  created_from_interaction_type TEXT,                              -- [C] P0 mention | suggest_tasks | goal_mode
  pending_interaction_type    TEXT,                                -- [C] P1 当前阻塞的交互类型 (request_confirmation | ask_user_questions)
  pending_interaction_payload JSONB,                               -- [C] P1 当前阻塞的交互负载

  -- ============================================================
  -- §M Floor 0 自测追踪 (task-quality-defense.md §8)  [C]
  -- ============================================================
  self_test_attempts          INT NOT NULL DEFAULT 0,             -- [C] P0 自测尝试次数 (上限 5)
  self_test_last_failure      JSONB,                              -- [C] P0 { reason, evidence, timestamp }

  -- ============================================================
  -- §N Floor 2 同一原因驳回追踪 (task-quality-defense.md §8)  [C]
  -- ============================================================
  same_reason_reject_streak   INT NOT NULL DEFAULT 0,             -- [C] P0 同一 Reviewer 同一原因连续驳回计数 (上限 3)
  last_reject_reason_hash     TEXT,                                -- [C] P0 上一次驳回原因的语义哈希

  -- ============================================================
  -- §O 跨层 Harness 追踪 (task-quality-defense.md §8)  [C]
  -- ============================================================
  harness_floor               TEXT,                                -- [C] P0 当前卡在哪一层: self_test | review | gate | human
  harness_floor_attempts      INT NOT NULL DEFAULT 0,             -- [C] P0 当前层重试次数
  last_failure_floor          TEXT,                                -- [C] P0 上一次失败的层
  last_failure_fingerprint    TEXT,                                -- [C] P0 失败指纹 (同一原因检测)

  -- ============================================================
  -- §P 时间追踪  [M] + [C]
  -- ============================================================
  estimated_effort_hours      INT,                                 -- [C] P0 预估工时
  actual_effort_hours         INT,                                 -- [C] P0 实际工时
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(), -- [M] [PRD §8.4]
  started_at                  TIMESTAMPTZ,                         -- [M] [PRD §8.4]
  completed_at                TIMESTAMPTZ                         -- [M] [PRD §8.4]
);

-- 关键索引
CREATE INDEX idx_tasks_context     ON project_tasks(context_type, context_id);
CREATE INDEX idx_tasks_project     ON project_tasks(project_id);
CREATE INDEX idx_tasks_status       ON project_tasks(status);
CREATE INDEX idx_tasks_assignee    ON project_tasks(assignee_type, assignee_id);
CREATE INDEX idx_tasks_parent      ON project_tasks(parent_task_id);
CREATE INDEX idx_tasks_milestone   ON project_tasks(milestone) WHERE milestone = true;
CREATE INDEX idx_tasks_checkout    ON project_tasks(checkout_agent_id) WHERE checkout_agent_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2.4  task_dependencies — Task 依赖关系 (显式表, 替代 UUID[] 便于查询)  [M]
--      来源: Multica issue_dependency 表 (扩展 done→unlock / reopen→notify)
--      [M2-C1 落地注记 2026-08-19, 迁移 999357/999362]: 物理表 issue_dependency 已加
--        dependency_type(sequential/optional, NOT NULL DEFAULT 'sequential', CSI 只读写此列);
--        上游 type 列 (blocks/blocked_by/related 方向语义) 保留不动;
--        UNIQUE(issue_id, depends_on_issue_id) 走 CONCURRENTLY 单独文件 (uq_issue_dependency_pair, 999362)。
--        列名映射: task_id→issue_id / depends_on_task_id→depends_on_issue_id。
-- ----------------------------------------------------------------------------
CREATE TABLE task_dependencies (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id                     UUID NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE, -- [Multica 原生 FK, fork 继承, CSI 不新增]
  depends_on_task_id          UUID NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE, -- [Multica 原生 FK, fork 继承, CSI 不新增]
  dependency_type             TEXT NOT NULL DEFAULT 'sequential', -- [C] P0 sequential | optional
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_type             TEXT NOT NULL,                     -- [M] 多态: agent | member
  created_by_id               UUID NOT NULL,
  UNIQUE(task_id, depends_on_task_id)
);

CREATE INDEX idx_deps_task    ON task_dependencies(task_id);
CREATE INDEX idx_deps_depends ON task_dependencies(depends_on_task_id);

-- ----------------------------------------------------------------------------
-- 2.5  task_comments — Task 评论 (Multica)  [M]
--      [M2-C1 落地注记 2026-08-19, 迁移 999358]: 物理表 comment 已加四列
--        mentioned_agents/mentioned_members (UUID[] NOT NULL DEFAULT '{}') /
--        structured_markers (JSONB) / created_by_run_id (UUID)。
--        列名映射: body→content / task_id→issue_id / parent_comment_id→parent_id(017);
--        上游 type 四值枚举保留不动。
-- ----------------------------------------------------------------------------
CREATE TABLE task_comments (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id                     UUID NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE, -- [Multica 原生 FK, fork 继承, CSI 不新增]
  -- [M] 多态作者 (沿用 Multica actor_type + actor_id)
  author_type                 TEXT NOT NULL,                     -- [M] agent | member
  author_id                   UUID NOT NULL,
  body                        TEXT NOT NULL,                     -- [M] 评论正文 (Markdown)

  -- [M] 嵌套回复
  parent_comment_id           UUID REFERENCES task_comments(id),  -- [M] 父 Comment (嵌套回复) -- [Multica 原生 FK, fork 继承, CSI 不新增]

  -- [M] @mention 解析结果
  mentioned_agents            UUID[] NOT NULL DEFAULT '{}',       -- [M] 解析出的 @mention Agent IDs
  mentioned_members           UUID[] NOT NULL DEFAULT '{}',       -- [M] 解析出的 @mention Member IDs

  -- [P] Run 关联
  created_by_run_id           UUID,                               -- [P] 关联的 Agent Run

  -- [C] 结构化标记 (task-quality-defense §2.3)
  structured_markers          JSONB NOT NULL DEFAULT '{}'::jsonb, -- [C] P0 { __task_result__, __self_test__, ... }

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at                  TIMESTAMPTZ
);

CREATE INDEX idx_comments_task    ON task_comments(task_id);
CREATE INDEX idx_comments_author  ON task_comments(author_type, author_id);

-- ----------------------------------------------------------------------------
-- 2.6  task_interactions — 结构化交互 (Paperclip issue_thread_interactions)  [P]
--      来源: Paperclip issue_thread_interactions; complete-technical-solution §5
--      [M2-C1 已建 2026-08-19, 迁移 999334]: 表已落地 (零 FK; 表内 UNIQUE/索引不内联,
--        全部 CONCURRENTLY 单独文件 999347-999350); kind/status/continuation_policy CHECK 齐备;
--        守护测试 TestTaskInteractionsKindEnum/TestTaskInteractionsIdempotencyUnique 已转正。
--      [M4-D6b 落地注记 2026-08-26, 迁移 999426]: status CHECK 扩为七值
--        (+auto_approved: item1 内部门超时自动通过; +escalated: item1 契约门超时升级 /
--        item2 ask_user_questions 4h SLA 升级); deadline_scanner 到期翻转消费。
-- ----------------------------------------------------------------------------
CREATE TABLE task_interactions (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id                     UUID NOT NULL, -- (无 FK, 应用层清理, AGENTS.md 硬规则)
  kind                        TEXT NOT NULL,                     -- [P] P0 request_confirmation | ask_user_questions | suggest_tasks | escalate_to_human | request_approval (§枚举同步: 新增 request_approval)
  -- 多态发起者 (沿用 actor_type + actor_id)
  actor_type                  TEXT NOT NULL,                     -- [P] P0 agent | member
  actor_id                    UUID NOT NULL,
  payload                     JSONB NOT NULL,                    -- [P] P0 交互负载 (kind 不同结构不同)
  status                      TEXT NOT NULL DEFAULT 'pending',   -- [P] P0 pending | accepted | rejected | answered | superseded
  response                    JSONB,                              -- [P] P0 响应内容
  -- 多态响应者
  responded_by_type           TEXT,                               -- [P] P0
  responded_by_id             UUID,                               -- [P] P0
  idempotency_key             TEXT,                               -- [P] P0 幂等键 (防重复交互)
  continuation_policy         TEXT,                               -- [P] P1 accept_on_timeout | reject_on_timeout | escalate
  deadline_at                 TIMESTAMPTZ,                        -- [C] P0 §10.8 deadline_scanner 超时扫描依据 (M0.5 ADD)
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at                 TIMESTAMPTZ,
  UNIQUE(task_id, idempotency_key)
);

CREATE INDEX idx_interactions_task   ON task_interactions(task_id);
CREATE INDEX idx_interactions_status ON task_interactions(status);
-- M0.5: deadline_scanner 扫描索引 (建表迁移时单独 CONCURRENTLY 文件)
CREATE INDEX idx_interactions_deadline ON task_interactions(deadline_at) WHERE resolved_at IS NULL AND deadline_at IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2.7  task_execution_decisions — 执行决策审计 (Paperclip)  [P]
--      来源: Paperclip issue_execution_decisions; complete-technical-solution §5
-- ----------------------------------------------------------------------------
CREATE TABLE task_execution_decisions (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id                     UUID NOT NULL, -- (无 FK, 应用层清理, AGENTS.md 硬规则)
  stage_id                    TEXT NOT NULL,                     -- [P] P0 Execution Policy stage 标识
  stage_type                  TEXT NOT NULL,                     -- [P] P0 review | approval
  -- 多态决策者
  actor_type                  TEXT NOT NULL,                     -- [P] P0 agent | member
  actor_id                    UUID NOT NULL,
  outcome                     TEXT NOT NULL,                     -- [P] P0 approved | changes_requested
  body                        TEXT NOT NULL,                     -- [P] P0 审查意见 / 批准理由
  created_by_run_id           UUID,                               -- [P] P0 关联 Run
  -- [C] 质量合规检测附加字段
  review_duration_seconds     INT,                                -- [C] P1 审查耗时 (用于"过短检测")
  shallow_approval_flag       BOOLEAN NOT NULL DEFAULT false,    -- [C] P0 标记为空洞 approve
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_decisions_task  ON task_execution_decisions(task_id);
CREATE INDEX idx_decisions_actor ON task_execution_decisions(actor_type, actor_id);

-- ----------------------------------------------------------------------------
-- 2.8  task_revision_negotiations — 修订协商记录 (CSI 自研)  [C]
--      来源: task-quality-defense.md §8
-- ----------------------------------------------------------------------------
CREATE TABLE task_revision_negotiations (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id                     UUID NOT NULL, -- (无 FK, 应用层清理, AGENTS.md 硬规则)
  triggered_by                TEXT NOT NULL,                     -- [C] P0 same_reviewer_repeated_reject | harness_loop_exhausted
  status                      TEXT NOT NULL DEFAULT 'pending',   -- [C] P0 pending | resolved_append_attempts | resolved_change_executor | resolved_split | escalated
  resolution                 JSONB,                              -- [C] P0 协商决议详情
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at                 TIMESTAMPTZ
);

CREATE INDEX idx_revision_negotiations_task ON task_revision_negotiations(task_id);

-- ----------------------------------------------------------------------------
-- 2.8a revision_negotiation_decisions — 修订协商决策记录  [C]  [DB:NEW]
--      来源: CSI §10.8 L1504 + §A.1 L2453 修订协商状态机
--      用途: deadline_scanner 超时自动决策(auto_accepted_c) + 人工决策审计
-- ----------------------------------------------------------------------------
CREATE TABLE revision_negotiation_decisions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL,                                -- [C] P0 关联 project (无 DB FK, 遵守 AGENTS.md)
  decision        TEXT NOT NULL,                                -- [C] P0 auto_accepted_c | accepted | rejected | escalated
  decided_at      TIMESTAMPTZ NOT NULL DEFAULT now(),           -- [C] P0 决策时间
  decided_by_type TEXT,                                         -- [C] P0 system (自动超时) | member (人工)
  decided_by_id   UUID,                                         -- [C] P0 (decided_by_type=member 时填充)
  rationale       TEXT,                                         -- [C] P0 决策依据 (auto: "超时默认C选项"; 人工: Owner 备注)
  payload         JSONB NOT NULL DEFAULT '{}'                   -- [C] P0 决策快照 (协商前状态/选项快照/revision_count 等)
);

-- M0.5: 查询 project 的协商决策历史 (建表迁移时单独 CONCURRENTLY 文件)
CREATE INDEX idx_revision_neg_decisions_project ON revision_negotiation_decisions(project_id);

-- ----------------------------------------------------------------------------
-- 2.9  plan_decompositions — Plan→Tasks 分解幂等 (Paperclip)  [P]
--      来源: Paperclip issue_plan_decompositions; complete-technical-solution §5
-- ----------------------------------------------------------------------------
CREATE TABLE plan_decompositions (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                  UUID NOT NULL, -- (无 FK, 应用层清理, AGENTS.md 硬规则)
  plan_version                INT NOT NULL,                      -- [P] P0
  phase                       INT NOT NULL,                      -- [C] P0 (Plan 阶段)
  fingerprint                 TEXT NOT NULL,                     -- [P] P0 (project_id, plan_version, phase) 唯一指纹
  claim_status                TEXT NOT NULL DEFAULT 'in_flight', -- [P] P0 in_flight | completed
  child_task_ids              UUID[] NOT NULL DEFAULT '{}',      -- [P] P0 已创建的子 Task IDs
  created_by_run_id           UUID,                               -- [P] P0
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, plan_version, phase)
);

-- ----------------------------------------------------------------------------
-- 2.10  project_cancel_requests — Marketplace 协商取消请求台账 (CSI 自研)  [C]
--      来源: TS §12.2 场景八 (#24-#30) / §12.3 业务幂等键 (project_id, cancel_proposal_seq) /
--        §12.4 3 天取消响应 SLA 归 Console
--      用途: M 侧协商取消请求的本地台账 — #24 webhook 幂等落行锚点 (行先于转移)、
--        3 天 auto-resolve SLA 计时 (deadline_scanner 扫描面)、#25/#26/#28/#30 的
--        marketplace_request_id 寻址映射、层 2 对账扫描集
--      [M3-D4 已建 2026-08-23, 迁移 999391; M5-A5 已扩 2026-08-29, 迁移 999442]:
--        status 九值 pending | accepted | rejected | auto_resolved | finalized |
--        settled | disputed | counter_proposed (#25 counter 方案已发等 #27 裁决,
--        open 决策态) | withdrawn (#29 撤回决议, 行闭档); origin_status
--        记录请求到达时 project.status (#26 auto-resolve 按阶段分派依据:
--        spec_nego/executing/budget_paused → agree, in_accept → reject);
--        source 三值 employer_initiated | spec_reject_5 | timeout_30d;
--        budget_abandon (Console 侧发起) 不建行 (TS 无 C→M 发起取消端点)。
--        UNIQUE(project_id, cancel_proposal_seq) 与 UNIQUE(marketplace_request_id)
--        走 CONCURRENTLY 单独文件 (uq_project_cancel_requests_seq, 999392;
--        uq_project_cancel_requests_marketplace, 999393);
--        idx_project_cancel_requests_deadline (999394, partial WHERE status='pending')。
-- ----------------------------------------------------------------------------
CREATE TABLE project_cancel_requests (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                  UUID NOT NULL, -- (无 FK, 应用层清理, AGENTS.md 硬规则)
  workspace_id                UUID NOT NULL, -- (无 FK, 应用层清理, AGENTS.md 硬规则)
  opportunity_id              UUID,    -- (无 FK, 应用层清理, AGENTS.md 硬规则) [C] P0 inbox 通知链接用, 可空
  marketplace_order_id        TEXT NOT NULL,                       -- [C] P0 bid.won payload 的 order_id (M 侧权威)
  marketplace_request_id      TEXT NOT NULL,                       -- [C] P0 #25/#26/#28/#30 寻址键
  cancel_proposal_seq         INT NOT NULL,                        -- [C] P0 TS §12.3 幂等键成员
  origin_status               TEXT NOT NULL,                       -- [C] P0 请求到达时 project.status, auto-resolve 分派依据
  source                      TEXT NOT NULL CHECK (source IN ('employer_initiated','spec_reject_5','timeout_30d')), -- [C] P0
  reason                      TEXT,                                -- [C] P0 雇主取消理由
  deadline_at                 TIMESTAMPTZ NOT NULL,                -- [C] P0 created + 3d (Owner 响应 SLA)
  status                      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','auto_resolved','finalized','settled','disputed','counter_proposed','withdrawn')), -- [C] P0 [M5-A5 扩 999442: +counter_proposed +withdrawn]
  resolved_at                 TIMESTAMPTZ,                         -- [C] P0
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_project_cancel_requests_seq ON project_cancel_requests(project_id, cancel_proposal_seq);
CREATE UNIQUE INDEX uq_project_cancel_requests_marketplace ON project_cancel_requests(marketplace_request_id);
CREATE INDEX idx_project_cancel_requests_deadline ON project_cancel_requests(deadline_at) WHERE status = 'pending';

-- ============================================================================
-- §3  Project Routine (基于 Multica Autopilot 扩展)  [M] + [C]
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 3.1  project_routines — Routine 模板 (基于 Multica autopilot 表)  [M] + [C]
--      来源: technical-design.md §5.3
--      [M2-C1 已建 2026-08-19, 迁移 999330]: 表已落地 (零 FK; 索引 CONCURRENTLY 单独文件
--        999337-999338)。trigger_on 物理值 = TS §4.1 事件名逐字一致 (opportunity.created/
--        project.created/manual, 点号风格, 命名裁断见 TS §4.1; 999376 前曾为下划线风格,
--        C4 引擎层的映射 shim 已随 08-21 patch 退役)。
-- ----------------------------------------------------------------------------
CREATE TABLE project_routines (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id                UUID NOT NULL, -- (无 FK, 应用层清理, AGENTS.md 硬规则)
  name                        TEXT NOT NULL,                     -- [C] P0 "全栈项目竞标"
  phase                       TEXT NOT NULL,                     -- [C] P0 'bidding' | 'signing'
  category_filter             TEXT[] NOT NULL DEFAULT '{}',      -- [C] P0 适用类目 {"软件开发/*"}
  trigger_on                  TEXT NOT NULL,                     -- [C] P0 opportunity.created | project.created | manual (999376 点号对齐)
  enabled                     BOOLEAN NOT NULL DEFAULT true,     -- [C] P0
  priority                    INT NOT NULL DEFAULT 0,            -- [C] P0 匹配优先级
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_routines_workspace ON project_routines(workspace_id);
CREATE INDEX idx_routines_phase     ON project_routines(phase);

-- ----------------------------------------------------------------------------
-- 3.2  routine_steps — Routine 步骤模板 (CSI 扩展 Multica Autopilot)  [C]
--      来源: technical-design.md §5.3
--      [M2-C1 已建 2026-08-19, 迁移 999331]: 表已落地; UNIQUE(routine_id, step_order)
--        走 CONCURRENTLY 单独文件 (uq_steps_routine_order, 999339); idx_steps_routine (999340)。
-- ----------------------------------------------------------------------------
CREATE TABLE routine_steps (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  routine_id                  UUID NOT NULL, -- (无 FK, 应用层清理, AGENTS.md 硬规则)
  step_order                  INT NOT NULL,                      -- [C] P0 步骤顺序
  step_name                   TEXT NOT NULL,                     -- [C] P0

  -- [C] Task 模板 (支持变量插值)
  task_title_template         TEXT NOT NULL,                     -- [C] P0 "分析商机: {opportunity.title}"
  task_description_template   TEXT,                               -- [C] P0
  task_type                   TEXT NOT NULL DEFAULT 'development', -- [C] P0 §9.2 类型矩阵 (M2-C4 补列 999373: bid_analysis/...)
  assignee_type               TEXT NOT NULL,                     -- [C] P0 member | agent | platform (999375 收紧: 执行者身份维度; agent_owner 折叠退役, team 归入 approver_type)
  assignee_id                 UUID,                               -- [C] P0
  approver_type               TEXT NOT NULL DEFAULT 'member',    -- [C] P0 member | agent | team | system (审批者角色维度, TS §4.2; M2-C1/C4 patch 补列 999374)

  -- [C] 条件路由
  condition_field             TEXT,                               -- [C] P0 从 Task result JSONB 中取哪个字段
  condition_operator          TEXT,                               -- [C] P0 equals | not_equals | gt | lt | exists
  condition_value             TEXT,                               -- [C] P0

  -- [C] 分支跳转
  next_step_on_match          INT,                               -- [C] P0 条件满足 → 跳到 step_order
  next_step_on_mismatch       INT,                               -- [C] P0 条件不满足 → 跳到 step_order
  next_step_on_default        INT,                               -- [C] P0 无条件下一步

  -- [C] 特殊步骤类型
  is_human_approval           BOOLEAN NOT NULL DEFAULT false,    -- [C] P0 Human 审批步骤
  is_platform_action          BOOLEAN NOT NULL DEFAULT false,    -- [C] P0 平台自动执行 (如提交方案到大厅)

  -- [C] Step 间上下文传递声明 (本 Step 需要引用哪些前置 Step 的 result)
  --      数组元素: step_order (引用同 Routine 内 step_order 的 Task result JSONB)
  requires_step_results       INT[] NOT NULL DEFAULT '{}',      -- [C] P0 依赖哪些前置 Step 的结果
  result_key                  TEXT,                               -- [C] P0 本 Step result 在 Routine 上下文中的暴露键 (供后续 Step 引用)

  UNIQUE(routine_id, step_order)
);

CREATE INDEX idx_steps_routine ON routine_steps(routine_id);

-- ----------------------------------------------------------------------------
-- 3.3  routine_runs — Routine 执行实例 (CSI 自研)  [C]
--      支持事件触发 → 创建 Step 1 Task → 根据 Task 结果匹配条件 → 创建下一个 Task
--      [M2-C1 已建 2026-08-19, 迁移 999332]: 表已落地; status CHECK 4 值与附录 A.3/
--        state-transition-edges.json routine_run 边集一致 (守护测试 TestRoutineRunStatusEnum);
--        索引 4 个 CONCURRENTLY 单独文件 (999341-999344)。
-- ----------------------------------------------------------------------------
CREATE TABLE routine_runs (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  routine_id                  UUID NOT NULL, -- (无 FK, 应用层清理, AGENTS.md 硬规则)
  workspace_id                UUID NOT NULL, -- (无 FK, 应用层清理, AGENTS.md 硬规则)

  -- [C] 触发来源 (多态)
  trigger_source_type         TEXT NOT NULL,                     -- [C] P0 'opportunity' | 'project' | 'manual'
  trigger_source_id           UUID NOT NULL,                     -- [C] P0 Opportunity ID 或 Project ID

  -- [C] 执行状态
  status                      TEXT NOT NULL DEFAULT 'running',   -- [C] P0 running | completed | failed | cancelled
  current_step_order          INT,                                -- [C] P0 当前执行的 step_order
  -- [C] Step 间上下文传递: 当前 Routine 内各 Step 的 Task result 快照
  --      结构: { "1": { task_id, result_json, completed_at }, "2": { ... } }
  --      下一个 Step 创建 Task 时, 平台从此字段读取并注入 Step N+1 的工作上下文
  step_context                JSONB NOT NULL DEFAULT '{}'::jsonb, -- [C] P0 Step 结果上下文传递容器
  started_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at                TIMESTAMPTZ,
  error_message               TEXT,
  metadata                    JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_runs_routine   ON routine_runs(routine_id);
CREATE INDEX idx_runs_workspace ON routine_runs(workspace_id);
CREATE INDEX idx_runs_trigger   ON routine_runs(trigger_source_type, trigger_source_id);
CREATE INDEX idx_runs_status    ON routine_runs(status);

-- ----------------------------------------------------------------------------
-- 3.4  routine_run_step_results — Step 执行结果明细 (用于审计 + Step 间引用)  [C]
--      用途: routine_runs.step_context 的关系化投影, 便于查询和审计
--      [M2-C1 已建 2026-08-19, 迁移 999333]: 表已落地; UNIQUE(routine_run_id, step_order)
--        走 CONCURRENTLY 单独文件 (uq_step_results_run_order, 999345); idx_step_results_run (999346)。
-- ----------------------------------------------------------------------------
CREATE TABLE routine_run_step_results (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  routine_run_id             UUID NOT NULL, -- (无 FK, 应用层清理, AGENTS.md 硬规则)
  step_order                  INT NOT NULL,                      -- [C] P0
  task_id                     UUID NOT NULL, -- (无 FK, 应用层清理, AGENTS.md 硬规则) [C] P0 该 Step 创建的 Task
  result                      JSONB,                              -- [C] P0 Task 完成时的 result JSONB
  -- [C] 后续 Step 引用本 Step result 的方式: 通过 (routine_run_id, step_order) 或 result_key
  result_key                  TEXT,                               -- [C] P0 与 routine_steps.result_key 对应
  status                      TEXT NOT NULL,                     -- [C] P0 pending | completed | failed | skipped
  started_at                  TIMESTAMPTZ,
  completed_at                TIMESTAMPTZ,
  UNIQUE(routine_run_id, step_order)
);

CREATE INDEX idx_step_results_run ON routine_run_step_results(routine_run_id);

-- ============================================================================
-- §4  产物管理 — Paperclip 文档 + 文件双层体系  [P]
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 4.1  project_documents — 版本化文档 (Paperclip documents 表)  [P]
--      来源: complete-technical-solution.md §3.2; Paperclip documents
-- ----------------------------------------------------------------------------
CREATE TABLE project_documents (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                  UUID NOT NULL, -- (无 FK, 应用层清理, AGENTS.md 硬规则)
  title                       TEXT,                               -- [P] P0 文档标题
  format                      TEXT NOT NULL DEFAULT 'markdown',   -- [P] P0 文档格式
  latest_body                 TEXT NOT NULL,                     -- [P] P0 最新版本正文
  latest_revision_id          UUID,                               -- [P] P0 最新 revision ID (FK project_document_revisions.id, 延迟添加)
  latest_revision_number      INT NOT NULL DEFAULT 1,             -- [P] P0 最新 revision 号
  -- 多态创建者 (沿用 actor_type + actor_id)
  created_by_type             TEXT NOT NULL,                     -- [P] P0 agent | member
  created_by_id               UUID NOT NULL,
  -- 多态锁定者 (并发编辑保护)
  locked_at                   TIMESTAMPTZ,                        -- [P] P0 锁定时间
  locked_by_type              TEXT,                               -- [P] P0
  locked_by_id                UUID,                               -- [P] P0
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_documents_project ON project_documents(project_id);

-- ----------------------------------------------------------------------------
-- 4.2  project_document_revisions — 文档版本历史 (Paperclip)  [P]
-- ----------------------------------------------------------------------------
CREATE TABLE project_document_revisions (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                  UUID NOT NULL, -- (无 FK, 应用层清理, AGENTS.md 硬规则)
  document_id                 UUID NOT NULL, -- (无 FK, 应用层清理, AGENTS.md 硬规则)
  revision_number             INT NOT NULL,                      -- [P] P0
  title                       TEXT,                               -- [P] P0
  format                      TEXT NOT NULL DEFAULT 'markdown',   -- [P] P0
  body                        TEXT NOT NULL,                     -- [P] P0 该版本完整正文
  change_summary              TEXT,                               -- [P] P0 变更摘要
  -- 多态作者
  created_by_type             TEXT NOT NULL,                     -- [P] P0
  created_by_id               UUID NOT NULL,
  created_by_run_id           UUID,                               -- [P] P0 关联的 Agent Run
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(document_id, revision_number)
);

CREATE INDEX idx_revisions_document ON project_document_revisions(document_id);

-- project_documents.latest_revision_id: 无 DB FK (应用层清理, AGENTS.md 硬规则; 循环依赖后置 FK 不创建)

-- ----------------------------------------------------------------------------
-- 4.3  task_documents — 文档↔Task 关联 (Paperclip issue_documents)  [P]
--      来源: complete-technical-solution.md §3.2; Paperclip issue_documents
-- ----------------------------------------------------------------------------
CREATE TABLE task_documents (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                  UUID NOT NULL, -- (无 FK, 应用层清理, AGENTS.md 硬规则)
  task_id                     UUID NOT NULL, -- (无 FK, 应用层清理, AGENTS.md 硬规则)
  document_id                 UUID NOT NULL, -- (无 FK, 应用层清理, AGENTS.md 硬规则)
  key                         TEXT NOT NULL,                     -- [P] P0 'prd' | 'architecture' | 'test_cases' | 'plan' | 'test_report' | 'acceptance_report'
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, task_id, key),                              -- [P] P0 同 Task 下 key 唯一
  UNIQUE(document_id)                                              -- [P] P0 一个文档只能关联到一个 Task
);

CREATE INDEX idx_task_docs_task ON task_documents(task_id);

-- ----------------------------------------------------------------------------
-- 4.4  document_annotation_threads — 文档评审注释线程 (Paperclip)  [P]
--      来源: complete-technical-solution.md §3.2; Paperclip document_annotation_threads
-- ----------------------------------------------------------------------------
CREATE TABLE document_annotation_threads (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                  UUID NOT NULL, -- (无 FK, 应用层清理, AGENTS.md 硬规则)
  document_id                 UUID NOT NULL, -- (无 FK, 应用层清理, AGENTS.md 硬规则)
  revision_id                 UUID NOT NULL, -- (无 FK, 应用层清理, AGENTS.md 硬规则)
  revision_number             INT NOT NULL,                      -- [P] P0 锚定的 revision
  status                      TEXT NOT NULL DEFAULT 'open',      -- [P] P0 open | resolved
  selected_text               TEXT,                               -- [P] P0 选中的文本
  annotation_start            INT,                                -- [P] P0 锚定起始位置
  annotation_end              INT,                                -- [P] P0 锚定结束位置
  -- 多态创建者
  created_by_type             TEXT NOT NULL,                     -- [P] P0
  created_by_id               UUID NOT NULL,
  -- 多态解决者
  resolved_by_type            TEXT,                               -- [P] P0
  resolved_by_id              UUID,                               -- [P] P0
  resolved_at                 TIMESTAMPTZ,                        -- [P] P0
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_threads_document ON document_annotation_threads(document_id);
CREATE INDEX idx_threads_status   ON document_annotation_threads(status);

-- ----------------------------------------------------------------------------
-- 4.5  document_annotation_comments — 文档评审回复 (Paperclip)  [P]
-- ----------------------------------------------------------------------------
CREATE TABLE document_annotation_comments (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                  UUID NOT NULL, -- (无 FK, 应用层清理, AGENTS.md 硬规则)
  thread_id                   UUID NOT NULL, -- (无 FK, 应用层清理, AGENTS.md 硬规则)
  document_id                 UUID NOT NULL, -- (无 FK, 应用层清理, AGENTS.md 硬规则)
  body                        TEXT NOT NULL,                     -- [P] P0 回复正文
  -- 多态作者
  author_type                 TEXT NOT NULL,                     -- [P] P0
  author_id                   UUID NOT NULL,
  created_by_run_id           UUID,                               -- [P] P0
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_anno_comments_thread ON document_annotation_comments(thread_id);

-- ----------------------------------------------------------------------------
-- 4.6  project_artifacts — 文件附件 (Paperclip issue_attachments + work_products)  [P]
--      来源: complete-technical-solution.md §3.2; Paperclip issue_attachments
-- ----------------------------------------------------------------------------
CREATE TABLE project_artifacts (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                  UUID NOT NULL, -- (无 FK, 应用层清理, AGENTS.md 硬规则)
  task_id                     UUID, -- (无 FK, 应用层清理, AGENTS.md 硬规则)
  phase                       INT,                                -- [C] P0 所属阶段
  artifact_type               TEXT NOT NULL,                     -- [P] P0 deliverable | phase_output | evidence | reference
  title                       TEXT NOT NULL,                     -- [P] P0
  description                 TEXT,                               -- [P] P0
  file_url                    TEXT,                               -- [P] P0 MinIO/S3 URL
  file_size                   INT,                                -- [P] P0 字节
  mime_type                   TEXT,                               -- [P] P0
  -- 多态作者
  author_type                 TEXT NOT NULL,                     -- [P] P0
  author_id                   UUID NOT NULL,
  version                     INT NOT NULL DEFAULT 1,            -- [P] P0
  review_status               TEXT,                               -- [P] P0 draft | in_review | approved | rejected
  tags                        TEXT[] NOT NULL DEFAULT '{}',      -- [C] P0
  linked_document_id          UUID, -- (无 FK, 应用层清理, AGENTS.md 硬规则) [P] P0 关联文档 (导出物)
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_artifacts_project ON project_artifacts(project_id);
CREATE INDEX idx_artifacts_task    ON project_artifacts(task_id);

-- ============================================================================
-- §5  Spec 契约管理 (CSI 自研 — Spec 变更与版本历史)  [C]
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 5.1  project_spec_revisions — Spec 版本历史 (CSI 自研)  [C]
--      用途: PRD §9.6 Spec 变更流程中, 每次 Spec 修订生成新版本
--      [M2-C1 已建 2026-08-19, 迁移 999336]: M2 scope = schema only (C5 bid.won handler
--        插 draft 行); Spec 签订流程归 M3。UNIQUE(project_id, revision_number) 走
--        CONCURRENTLY 单独文件 (uq_spec_revisions_project_number, 999354);
--        idx_spec_revisions_project (999355)。
-- ----------------------------------------------------------------------------
CREATE TABLE project_spec_revisions (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                  UUID NOT NULL, -- (无 FK, 应用层清理, AGENTS.md 硬规则)
  revision_number             INT NOT NULL,                      -- [C] P0 Spec 版本号 (v1, v2, ...)
  -- 多态提交者
  submitted_by_type           TEXT NOT NULL,                     -- [C] P0 agent | member
  submitted_by_id             UUID NOT NULL,
  spec_content                JSONB NOT NULL,                     -- [C] P0 Spec 完整内容 (结构见 PRD §8.5)
  spec_hash                   TEXT NOT NULL,                     -- [C] P0 内容哈希 (防篡改)
  change_summary              TEXT,                               -- [C] P0 变更摘要
  status                      TEXT NOT NULL DEFAULT 'draft',     -- [C] P0 draft | submitted | confirmed | superseded | rejected
  -- 多态确认者 (雇主 / Agent Owner)
  confirmed_by_type           TEXT,                               -- [C] P0
  confirmed_by_id             UUID,                               -- [C] P0
  confirmed_at                TIMESTAMPTZ,                        -- [C] P0
  parent_revision_id          UUID, -- (无 FK, 应用层清理, AGENTS.md 硬规则) [C] P0 上一版本 (链式)
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, revision_number)
);

CREATE INDEX idx_spec_revisions_project ON project_spec_revisions(project_id);

-- ----------------------------------------------------------------------------
-- 5.2  spec_change_requests — Spec 变更请求 (CSI 自研)  [C]
--      用途: PRD §9.6 Spec 签订后雇主想改需求, 走 Spec 变更流程
--      注: [M5-A1 落地注记 2026-08-29, 迁移 999434-999436] 物理表已落 (Grilling Q2
--      裁决场景七归 M5, 旧 "[DB:NEW → 不建表 (P2 排除)]" 标记失效; 对账测试白名单已移出)。
--      落地 DDL 与本段一致, 关键枚举列加 CHECK (status 六值 / change_type / classification /
--      resolution); status 枚举按 TS §6.2 超时策略修正: timeout_auto_revision 废弃改
--      timeout_escalated, 并补 employer_rejected (§6.2 L721 拒绝后 24h 协商窗口停留态)。
-- ----------------------------------------------------------------------------
CREATE TABLE spec_change_requests (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                  UUID NOT NULL, -- (无 FK, 应用层清理, AGENTS.md 硬规则)
  from_spec_revision_id       UUID NOT NULL, -- (无 FK, 应用层清理, AGENTS.md 硬规则) [C] P0 基于哪个 Spec 版本
  to_spec_revision_id         UUID,          -- (无 FK, 应用层清理, AGENTS.md 硬规则) [C] P0 生成的目标版本 (变更通过后填充)

  -- [C] 变更内容
  change_type                 TEXT NOT NULL,                     -- [C] P0 revision (修订) | new_requirement (新增需求) | scope_expansion (范围扩大)
  requested_changes           JSONB NOT NULL,                    -- [C] P0 具体变更项
  impact_assessment           JSONB,                              -- [C] P0 Orchestrator 评估影响 { price_delta, days_delta, affected_tasks }

  -- [C] 24 小时结构化流程 (PRD §9.6)
  -- 多态发起者 (雇主 / Agent Owner)
  initiated_by_type           TEXT NOT NULL,                     -- [C] P0 employer | agent_owner
  initiated_by_id             UUID NOT NULL,
  status                      TEXT NOT NULL DEFAULT 'pending',   -- [C] P0 pending | agent_owner_classified | employer_confirmed | employer_rejected | rejected | timeout_escalated (§6.2 超时策略修正: timeout_auto_revision 废弃; employer_rejected = 拒绝后 24h 协商窗口停留态 L721)
  marketplace_request_id      TEXT,                              -- [C] M5-A4 (999440) M 侧签发请求 ID (#18 payload 携带, #19 classify 路径参数; B 移交进入为 NULL)
  negotiation_deadline        TIMESTAMPTZ,                        -- [C] M5-A4 (999440) employer_rejected 后 24h 协商窗口截止 (scanner item 3b; 其他状态恒 NULL 结构性出扫描集)
  -- 多态分类者 (Agent Owner 判定是修订还是新增需求)
  classified_by_type         TEXT,                                -- [C] P0
  classified_by_id            UUID,                                -- [C] P0
  classification              TEXT,                                -- [C] P0 revision | new_requirement
  classified_at               TIMESTAMPTZ,                        -- [C] P0
  classification_deadline     TIMESTAMPTZ,                        -- [C] P0 24 小时截止时间
  -- 多模最终决策者
  resolved_by_type            TEXT,                                -- [C] P0
  resolved_by_id              UUID,                                -- [C] P0
  resolved_at                 TIMESTAMPTZ,                        -- [C] P0
  resolution                  TEXT,                                -- [C] P0 accepted | rejected | escalated_to_dispute
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_spec_changes_project ON spec_change_requests(project_id);
CREATE INDEX idx_spec_changes_status  ON spec_change_requests(status);

-- ============================================================================
-- §6  系统级: 通知 / 审计 / Agent 执行追踪 / 预算事件  [M] + [P]
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 6.1  notifications — Inbox 通知 (Multica inbox_item)  [M]
--      来源: Multica inbox_item 表
--      [M2-C1 落地注记 2026-08-19, 迁移 999361]: 物理表 inbox_item 已加四列 —
--        level (info/reminder/urgent 独立新列, 上游 severity 枚举保留不动, 物理双列并存;
--          写入方映射 info=info / attention≈reminder / action_required≈urgent) /
--        source_type (comment/task/system/interaction/budget) + source_id (成对) /
--        channels (TEXT[] DEFAULT '{inbox}', sms 公测版不启用)。
--      未落: status(unread/read/dismissed) 枚举列 (read BOOLEAN 保留, C7 消费) /
--        aggregation_key/aggregated_count (聚合投递 M4+, §11.4)。
-- ----------------------------------------------------------------------------
CREATE TABLE notifications (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id                UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, -- [Multica 原生 FK, fork 继承, CSI 不新增]
  -- 多态接收者 (沿用 actor_type + actor_id)
  recipient_type              TEXT NOT NULL,                     -- [M] agent | member
  recipient_id                UUID NOT NULL,
  -- 多态来源
  source_type                 TEXT,                               -- [M] comment | task | system | interaction | budget
  source_id                   UUID,                               -- [M] 关联实体 ID
  -- 通知级别 (PRD §7.9)
  level                       TEXT NOT NULL DEFAULT 'info',      -- [C] P0 info | reminder | urgent
  -- 渠道
  channels                    TEXT[] NOT NULL DEFAULT '{inbox}', -- [C] P0 inbox | email | sms | push
  -- 内容
  title                       TEXT NOT NULL,                     -- [M]
  body                        TEXT,                               -- [M]
  payload                     JSONB NOT NULL DEFAULT '{}'::jsonb, -- [M] 结构化负载
  -- 状态
  status                      TEXT NOT NULL DEFAULT 'unread',    -- [M] unread | read | dismissed
  read_at                     TIMESTAMPTZ,                        -- [M]
  -- 关联 Task (便于聚合视图)
  task_id                     UUID,                               -- [C] P0
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_recipient ON notifications(recipient_type, recipient_id, status);
CREATE INDEX idx_notifications_task      ON notifications(task_id);
CREATE INDEX idx_notifications_workspace ON notifications(workspace_id);

-- ----------------------------------------------------------------------------
-- 6.2  activity_log — 活动日志 (Multica)  [M]
--      来源: Multica activity_log 表
-- ----------------------------------------------------------------------------
CREATE TABLE activity_log (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id                UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, -- [Multica 原生 FK, fork 继承, CSI 不新增]
  -- 多态操作者 (沿用 actor_type + actor_id)
  actor_type                  TEXT NOT NULL,                     -- [M] agent | member | system
  actor_id                    UUID NOT NULL,
  -- 操作目标 (多态)
  target_type                 TEXT NOT NULL,                     -- [M] task | project | document | artifact | agent | ...
  target_id                   UUID NOT NULL,
  -- 操作内容
  action                      TEXT NOT NULL,                     -- [M] created | updated | status_changed | checked_out | submitted | approved | rejected | ...
  description                 TEXT,                               -- [M] 可读描述
  diff                        JSONB,                              -- [M] 变更详情 (前后对比)
  -- 关联上下文 (用于聚合查询)
  project_id                  UUID,                               -- [C] P0
  task_id                     UUID,                               -- [C] P0
  -- 关联 Run
  run_id                      UUID,                               -- [P] P1 关联 Agent Run
  -- IP / User Agent (审计)
  ip_address                  TEXT,                               -- [M]
  user_agent                  TEXT,                               -- [M]
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_activity_workspace ON activity_log(workspace_id);
CREATE INDEX idx_activity_actor     ON activity_log(actor_type, actor_id);
CREATE INDEX idx_activity_target    ON activity_log(target_type, target_id);
CREATE INDEX idx_activity_project   ON activity_log(project_id);
CREATE INDEX idx_activity_task      ON activity_log(task_id);
CREATE INDEX idx_activity_created   ON activity_log(created_at);

-- ----------------------------------------------------------------------------
-- 6.3  agent_runs — Agent 执行记录 (融合 Multica task_queue + Paperclip heartbeat_runs)  [M] + [P]  [DB: agent_task_queue]
--      用途: 记录 Agent 每次实际执行 (签出 Task → 运行 → 完成或失败)
--      §1.2.1 footer: M0.1 ADD execution_deadline_at (deadline_scanner §10.8 超时扫描依据)
--      [M2-C1 落地注记 2026-08-19, 迁移 999360]: 物理表 agent_task_queue 已加 —
--        trigger_reason (assignment/mention/retry/continuation/recovery/routine_step) /
--        token_usage_input/output/total + cost_cents / transcript (JSONB);
--        status CHECK 换超集 11 值 (CSI 7 值附录 A.3 ∪ 上游全集 8 值: 001_init 6 值
--        + waiting_local_directory(109) + deferred(128)——M2 过渡期上游 daemon/dispatcher
--        仍写旧值, C3 CSI 路径写新值, M4 收缩); 索引 idx_atq_task(issue_id) (999367)。
--      未落 (M4 执行引擎): workspace_id/runtime_id/triggered_by_*/liveness_state/
--        output_summary/issue_comment_status/queued_at/last_heartbeat_at/metadata。
-- ----------------------------------------------------------------------------
CREATE TABLE agent_runs (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 关联
  workspace_id                UUID NOT NULL, -- (无 FK, 应用层清理, AGENTS.md 硬规则)
  agent_id                    UUID NOT NULL, -- (无 FK, 应用层清理, AGENTS.md 硬规则)
  runtime_id                  UUID, -- (无 FK, 应用层清理, AGENTS.md 硬规则) [M]
  task_id                     UUID, -- (无 FK, 应用层清理, AGENTS.md 硬规则) [M] 关联 Task (与 checkout_run_id / execution_run_id 对应)
  -- 多态触发者
  triggered_by_type           TEXT NOT NULL DEFAULT 'system',     -- [P] system | agent | member
  triggered_by_id             UUID,                                -- [P]
  -- 触发原因 (Paperclip wake source 模型)
  trigger_reason              TEXT NOT NULL DEFAULT 'assignment', -- [P] P0 assignment | mention | retry | continuation | recovery | routine_step
  -- 状态机 (Paperclip heartbeat_runs 状态)
  status                      TEXT NOT NULL DEFAULT 'queued',    -- [P] P0 queued | running | succeeded | failed | timed_out | cancelled | coalesced
  -- [P] Liveness 状态
  liveness_state              TEXT NOT NULL DEFAULT 'healthy',   -- [P] P0 healthy | stalled | recovering
  -- [P] Session 恢复 (Multica 机制)
  session_id                  TEXT,                               -- [M] P0 跨 run 复用 session (同 agent + task)
  workdir_path                TEXT,                               -- [M] P0 工作目录路径 (PVC 内)
  -- [P] Token 用量与成本
  token_usage_input           INT NOT NULL DEFAULT 0,             -- [P] P0 输入 Token
  token_usage_output          INT NOT NULL DEFAULT 0,             -- [P] P0 输出 Token
  token_usage_total           INT NOT NULL DEFAULT 0,             -- [P] P0 总 Token
  cost_cents                  INT NOT NULL DEFAULT 0,             -- [P] P0 成本 (分)
  -- [P] Run 输出
  transcript                  JSONB,                              -- [P] P0 完整 transcript (prompt + output + tool calls)
  output_summary              TEXT,                               -- [P] P0 输出摘要
  error_message               TEXT,                               -- [P] P0 失败原因
  -- [P] Comment Required 状态
  issue_comment_status        TEXT NOT NULL DEFAULT 'pending',   -- [P] P0 pending | satisfied | retry_queued | retry_exhausted
  -- 时间戳
  queued_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at                  TIMESTAMPTZ,
  completed_at                TIMESTAMPTZ,
  last_heartbeat_at           TIMESTAMPTZ,
  execution_deadline_at       TIMESTAMPTZ,                        -- [C] P0 §1.2.1 footer: 执行截止时间 (deadline_scanner §10.8 超时扫描依据; M0.1 ADD COLUMN)
  metadata                    JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_runs_workspace ON agent_runs(workspace_id);
CREATE INDEX idx_runs_agent    ON agent_runs(agent_id);
CREATE INDEX idx_runs_task      ON agent_runs(task_id);
CREATE INDEX idx_runs_status   ON agent_runs(status);

-- ----------------------------------------------------------------------------
-- 6.4  agent_wakeup_requests — Agent 唤醒队列 (Paperclip)  [P] + [C] 重构
--      来源: Paperclip agent_wakeup_requests 表
--      用途: Wake Queue 物理载体——Orchestrator 的唤醒请求队列 (三源唤醒的消费侧)
--      [M4-D6 落地注记 2026-08-26, 迁移 999430, R13③ 裁决]: 独立表为 Wake Queue
--        载体 (否决 event_outbox 扩展 kind / agent_task_queue 衍生两候选, 理由见
--        task 08-24-m4-d6-orchestration-monitoring design.md §1.1)。
--        与 Paperclip 原草图差异: +project_id (project 级 wake 锚点) /
--        +reason_kind+reason (TS §10.3 reason 字段, 同原因合并键) /
--        +priority (Orchestrator 忙碌时按优先级排队消费) / +expires_at (TTL 7 天) /
--        status 收窄为 pending|dispatched|stale|cancelled (原 coalesced 并入
--        dispatched——同原因多行统一标记 dispatched 到同一监控 Task) /
--        coalesced_into_run_id → coalesced_into_task_id (消费产物是编排监控
--        Task 而非裸 run 行) / wake_source 收窄为 event|patrol|mention (三源)。
--        二级索引后置: M4 消费查询按 agent_id+status 过滤走 seq scan 可接受
--        (同 watchdog 族先表后索引先例 999268/999269), 需要时按迁移纪律单文件
--        CONCURRENTLY 补。stale 行超 14 天由 TTL 扫描删除 (防无界增长)。
-- ----------------------------------------------------------------------------
CREATE TABLE agent_wakeup_requests (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id                UUID NOT NULL, -- (无 FK, 应用层清理, AGENTS.md 硬规则)
  project_id                  UUID NOT NULL, -- (无 FK, 应用层清理, AGENTS.md 硬规则) [C] P0 project 级 wake 锚点
  agent_id                    UUID NOT NULL, -- (无 FK, 应用层清理, AGENTS.md 硬规则) [P] P0 被唤醒的 Orchestrator
  -- 唤醒来源 (三源: 事件驱动主源 / 定时巡检辅源 / @mention 兜底)
  wake_source                 TEXT NOT NULL CHECK (wake_source IN ('event','patrol','mention')), -- [C] P0
  source_task_id              UUID, -- (无 FK, 应用层清理, AGENTS.md 硬规则) [P] P0 关联 Task (NULL = project 级 wake)
  source_comment_id           UUID, -- (无 FK, 应用层清理, AGENTS.md 硬规则) [P] P0 @mention 来源 Comment
  -- 唤醒原因 (reason_kind = 同原因合并的"原因"粒度, 词表见 task design.md §1.3)
  reason_kind                 TEXT NOT NULL,                      -- [C] P0 task_transition | stage_milestone | sla_yellow | sla_orange | sla_red | liveness_violation | stalled_project | mention | offline_bypass
  reason                      TEXT NOT NULL,                      -- [C] P0 人类可读原因 (TS §10.3 wake 的 reason 字段)
  priority                    TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('urgent','high','normal','low')), -- [C] P0 忙碌排队按优先级消费
  -- 注入上下文 (消费时组装进监控 Task 的结构化快照)
  context_payload             JSONB,                              -- [C] P0
  -- 消费状态 (TTL 7 天: pending 超 expires_at 翻 stale, 恢复后只看最新快照)
  status                      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','dispatched','stale','cancelled')), -- [C] P0
  coalesced_into_task_id      UUID,     -- (无 FK, 应用层清理, AGENTS.md 硬规则) [C] P0 消费时物化的编排监控 Task
  -- 多态触发者
  triggered_by_type           TEXT,                               -- [P] P0
  triggered_by_id             UUID,                                -- [P] P0
  -- 调度
  scheduled_at                TIMESTAMPTZ NOT NULL DEFAULT now(),  -- [P] P0 计划唤醒时间
  dispatched_at               TIMESTAMPTZ,                        -- [P] P0 实际派发时间
  expires_at                  TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'), -- [C] P0 TTL 7 天
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- [M4-D6 索引后置] idx_wakeup_agent(agent_id,status) / idx_wakeup_task(source_task_id)
--   不随建表落 (design §1.2 裁决); 需要时按迁移纪律单文件 CONCURRENTLY 补。

-- ----------------------------------------------------------------------------
-- 6.5  budget_incidents — 预算事件 (Paperclip)  [P]
--      来源: Paperclip budget_incidents 表
--      用途: Workspace / Agent / Project 预算超限事件记录
--      [M2-C1 已建 2026-08-19, 迁移 999335]: M2 scope = schema + 契约测试验证可写性
--        (TestBudgetIncidentsWritableContract, 事务内 INSERT 正例+约束负例+ROLLBACK——
--        "最小写入口"裁断形态, 不加 Go helper); budget_scanner/三选一决策 API 归 M4,
--        executing→budget_paused 边归 M3。索引 3 个 CONCURRENTLY 单独文件 (999351-999353)。
--      [M4-D6b 落地注记 2026-08-26, 迁移 999427]: status CHECK 扩为四值 (+escalated:
--        item7 budget_exceeded 72h 无 Owner 三选一决策的 deadline_scanner 升级翻转,
--        urgent 通知平台管理员, Project 保持 budget_paused 不自动放弃)。
-- ----------------------------------------------------------------------------
CREATE TABLE budget_incidents (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id                UUID NOT NULL, -- (无 FK, 应用层清理, AGENTS.md 硬规则)
  -- 多态所属 (Workspace / Agent / Project 三级预算)
  scope_type                  TEXT NOT NULL,                     -- [P] P0 workspace | agent | project
  scope_id                    UUID NOT NULL,                     -- [P] P0
  -- 事件类型
  incident_type               TEXT NOT NULL,                     -- [P] P0 threshold_warning | budget_exceeded | budget_paused | budget_resumed
  -- 触发数值
  threshold_value             DECIMAL(12,2),                     -- [P] P0 触发的阈值
  current_value               DECIMAL(12,2),                     -- [P] P0 当前实际值
  limit_value                 DECIMAL(12,2),                     -- [P] P0 上限值
  -- 关联 Run (成本来源)
  triggering_run_id           UUID,    -- (无 FK, 应用层清理, AGENTS.md 硬规则) [P] P0
  -- 多态决策者 (谁恢复的)
  resolved_by_type            TEXT,                               -- [P] P0
  resolved_by_id              UUID,                               -- [P] P0
  -- 状态
  status                      TEXT NOT NULL DEFAULT 'active',    -- [P] P0 active | acknowledged | resolved
  resolution                  TEXT,                               -- [P] P0 budget_increased | plan_optimized | cancelled | auto_resumed
  notes                       TEXT,                               -- [P] P0
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at                 TIMESTAMPTZ
);

CREATE INDEX idx_budget_incidents_scope    ON budget_incidents(scope_type, scope_id);
CREATE INDEX idx_budget_incidents_workspace ON budget_incidents(workspace_id);
CREATE INDEX idx_budget_incidents_status    ON budget_incidents(status);

-- ============================================================================
-- §7  CSI 基础设施扩展层 — RBAC / 审计 / 文档并发 / 事件驱动 / 质量保障 / 系统监控 (M0.1 补齐)
--      17 缺口表 (技术方案 §7-§12): 14 张 M0.1 新建迁移 [DB:NEW] + 3 张映射到已有 Multica 表 [DB:<existing>]
--      硬规则: 实际迁移无 FK/级联 (关系应用层做); 每个索引用 CREATE [UNIQUE] INDEX CONCURRENTLY 单语句单文件
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 7.1  RBAC (技术方案 §7) — 3 表, 均映射到已有 Multica 表, M0.1 跳过建表
-- ----------------------------------------------------------------------------

-- 7.1a  workspace_members — Workspace 成员 RBAC (CSI §7)  [DB: member] (已存在 001_init, M0.1 跳过建表)
--      实际 DB: member 表 (workspace_id + user_id + role owner/admin/member + UNIQUE(workspace_id, user_id))
--      CSI 目标态增量字段 (status / invited_by / invited_at / joined_at + 每 workspace 仅 1 active owner
--      的偏唯一索引) 归 RBAC feature task 对 member 表做 ALTER, M0.1 不建新表避免成员关系双真相。
CREATE TABLE workspace_members (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id                UUID NOT NULL,                    -- [C] (无 DB FK, 应用层校验)
  member_id                   UUID NOT NULL,                    -- [C] 对应 user_id
  role                        TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
  invited_by                  UUID,                             -- [C] 邀请人
  invited_at                  TIMESTAMPTZ,                      -- [C]
  joined_at                   TIMESTAMPTZ,                      -- [C]
  status                      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','revoked','left')),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, member_id)
);
-- 偏唯一索引: 每 workspace 仅 1 个 active owner (实际迁移: CREATE UNIQUE INDEX CONCURRENTLY ... ON workspace_members(workspace_id) WHERE role='owner' AND status='active')
CREATE UNIQUE INDEX idx_workspace_members_active_owner ON workspace_members(workspace_id) WHERE role = 'owner' AND status = 'active';
CREATE INDEX idx_workspace_members_lookup ON workspace_members(workspace_id, member_id);

-- 7.1b  workspace_invitations — Workspace 邀请 (CSI §7)  [DB: workspace_invitation] (已存在 041, M0.1 跳过建表)
--      实际 DB: workspace_invitation 表 (workspace_id + inviter_id + invitee_email + role + status + expires_at)
--      CSI 目标态增量 (token 驱动接受 + accepted_at/accepted_by/revoked_at) 归 feature task ALTER, M0.1 不建新表。
CREATE TABLE workspace_invitations (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id                UUID NOT NULL,                    -- [C] (无 DB FK)
  email                       TEXT NOT NULL,                    -- [C] 被邀请邮箱
  role                        TEXT NOT NULL DEFAULT 'member',   -- [C]
  invited_by                  UUID NOT NULL,                    -- [C] 邀请人
  token                       TEXT NOT NULL,                    -- [C] 一次性接受 token (UNIQUE, 实际迁移单独 CONCURRENTLY 文件)
  expires_at                  TIMESTAMPTZ NOT NULL,             -- [C]
  accepted_at                 TIMESTAMPTZ,                      -- [C]
  accepted_by                 UUID,                             -- [C]
  revoked_at                  TIMESTAMPTZ,                      -- [C]
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_workspace_invitations_token ON workspace_invitations(token);

-- 7.1c  api_tokens — API Token (CSI §7)  [DB: personal_access_token] (已存在 011, M0.1 跳过建表)
--      实际 DB: personal_access_token 表 (user_id + name + token_hash + token_prefix + expires_at + last_used_at + revoked)
--      CSI 目标态增量 (workspace_id / scopes JSONB / last_used_ip INET / revoked_at) 归 feature task ALTER, M0.1 不建新表。
CREATE TABLE api_tokens (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id                   UUID NOT NULL,                    -- [C] (无 DB FK)
  workspace_id                UUID,                             -- [C] 可空 (workspace 级或个人级 token)
  name                        TEXT NOT NULL,                    -- [C]
  token_hash                  TEXT NOT NULL,                    -- [C] (UNIQUE, 实际迁移单独 CONCURRENTLY 文件)
  token_prefix                TEXT NOT NULL,                    -- [C] 展示用前缀
  scopes                      JSONB NOT NULL DEFAULT '[]',      -- [C] 权限范围
  expires_at                  TIMESTAMPTZ,                      -- [C] 可空 = 永不过期
  last_used_at                TIMESTAMPTZ,                      -- [C]
  last_used_ip                INET,                             -- [C]
  revoked_at                  TIMESTAMPTZ,                      -- [C]
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_api_tokens_token_hash ON api_tokens(token_hash);

-- ----------------------------------------------------------------------------
-- 7.2  审计 (技术方案 §8 / §11.6) — 1 表  [DB:NEW]
-- ----------------------------------------------------------------------------
-- activity_log_outbox — 活动日志投递箱 (事务一致的 outbox 模式)
CREATE TABLE activity_log_outbox (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payload                     JSONB NOT NULL,                   -- [C] 待投递的活动事件负载
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(), -- [C]
  consumed_at                 TIMESTAMPTZ                       -- [C] NULL = 未投递
);
-- 偏索引: 扫描未投递记录 (实际迁移单独 CONCURRENTLY 文件)
CREATE INDEX idx_activity_log_outbox_unconsumed ON activity_log_outbox(consumed_at) WHERE consumed_at IS NULL;

-- ----------------------------------------------------------------------------
-- 7.3  文档并发 (技术方案 §9 / §5.5) — 2 表  [DB: 物理同名表已建 (M0.1: 999262/999263, UNIQUE 索引 999276)]
--      [M3-D1 注记 2026-08-23]: 两表 DDL 与 UNIQUE 索引已由 M0.1 落地, 结构与本目标态逐列一致;
--      守护测试 (schema_reconciliation_test.go TestDocumentTablesPinned) 已钉住列级契约。
--      DDL 无需再落迁移; 最小消费链路 (Spec 驳回→Agent fork→Owner 合并, DOC-4) 归 M3-D3。
-- ----------------------------------------------------------------------------
-- document_thread_locks — 文档线程锁 (Atomic Checkout 防并发编辑)
CREATE TABLE document_thread_locks (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id                 UUID NOT NULL,                    -- [C] (无 DB FK)
  agent_id                    UUID NOT NULL,                    -- [C] (无 DB FK)
  acquired_at                 TIMESTAMPTZ NOT NULL DEFAULT now(), -- [C]
  expires_at                  TIMESTAMPTZ                       -- [C] 锁过期时间
);
-- UNIQUE(document_id, agent_id): 同一 agent 对同一文档仅持有一把锁 (实际迁移单独 CONCURRENTLY 文件)
CREATE UNIQUE INDEX idx_document_thread_locks_doc_agent ON document_thread_locks(document_id, agent_id);

-- document_branches — 文档分支 (merge_request 风格的并发编辑分支)
CREATE TABLE document_branches (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_document_id          UUID NOT NULL,                    -- [C] (无 DB FK)
  title                       TEXT NOT NULL,                    -- [C]
  base_version                INT NOT NULL,                     -- [C] 基于 source 的版本号
  content                     JSONB NOT NULL DEFAULT '{}',      -- [C] 分支内容
  status                      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','merge_requested','merged','rejected')),
  created_by_agent            UUID,                             -- [C] (无 DB FK)
  merged_at                   TIMESTAMPTZ,                      -- [C]
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 7.4  事件驱动 (技术方案 §10 / §11.1) — 3 表  [DB:NEW]
-- ----------------------------------------------------------------------------
-- event_outbox — 事件投递箱 (至少一次投递)
CREATE TABLE event_outbox (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type                        TEXT NOT NULL,                    -- [C] 事件类型
  version                     INT NOT NULL DEFAULT 1,           -- [C] schema 版本
  source                      TEXT,                             -- [C] 事件源
  subject                     TEXT,                             -- [C] 事件主体标识
  occurred_at                 TIMESTAMPTZ NOT NULL DEFAULT now(), -- [C]
  data                        JSONB NOT NULL DEFAULT '{}',      -- [C] 事件负载
  published_at                TIMESTAMPTZ,                      -- [C] NULL = 未发布
  attempt                     INT NOT NULL DEFAULT 0            -- [C] 已尝试投递次数
);
-- 偏索引: 扫描未发布事件 (实际迁移单独 CONCURRENTLY 文件)
CREATE INDEX idx_event_outbox_unpublished ON event_outbox(published_at) WHERE published_at IS NULL;

-- event_handled — 事件处理记录 (handler 幂等去重)
CREATE TABLE event_handled (
  handler_id                  TEXT NOT NULL,                    -- [C] handler 标识
  event_id                    UUID NOT NULL,                    -- [C] (无 DB FK, 对应 event_outbox.id)
  handled_at                  TIMESTAMPTZ NOT NULL DEFAULT now(), -- [C]
  PRIMARY KEY(handler_id, event_id)
);

-- event_retry — 事件重试调度
CREATE TABLE event_retry (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handler_id                  TEXT NOT NULL,                    -- [C]
  event_id                    UUID NOT NULL,                    -- [C]
  attempts                    INT NOT NULL DEFAULT 0,           -- [C]
  next_attempt_at             TIMESTAMPTZ NOT NULL,             -- [C] 下次重试时间
  last_error                  TEXT,                             -- [C]
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_event_retry_due ON event_retry(next_attempt_at);

-- ----------------------------------------------------------------------------
-- 7.5  质量保障 (技术方案 §11 / §8.3 §10.5 §9.2 §12.1) — 5 表  [DB:NEW]
-- ----------------------------------------------------------------------------
-- task_configuration_blockers — Task 配置阻塞记录 (Floor -1 配置门禁)
--      [M4-D6b 落地注记 2026-08-26, 迁移 999428]: 新增 status 列 (open|escalated,
--        DEFAULT 'open' 存量行全部未解决口径)——blocker 生命周期状态机: open --24h-->
--        escalated (deadline_scanner urgent 升级) --再 24h--> Task queued→failed 走
--        新注册边; InsertConfigurationBlocker 同批加 ON CONFLICT DO UPDATE (refresh
--        闭环的重降级活路径, deadline 刷新即 24h 窗重计)。
CREATE TABLE task_configuration_blockers (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id                     UUID NOT NULL,                    -- [C] (无 DB FK)
  blocker_code                TEXT NOT NULL,                    -- [C] 阻塞码 (机读)
  blocker_message             TEXT,                             -- [C] 阻塞说明 (人读)
  blocker_details             JSONB,                            -- [C] 阻塞详情
  detected_at                 TIMESTAMPTZ NOT NULL DEFAULT now(), -- [C]
  deadline_at                 TIMESTAMPTZ,                      -- [C] P0 §10.8 deadline_scanner 超时扫描依据 (M0.5 ADD)
  resolved_at                 TIMESTAMPTZ,                      -- [C] NULL = 未解决
  resolution                  TEXT CHECK (resolution IN ('auto_revalidated','manual_fix','task_cancelled'))
);
-- UNIQUE(task_id, blocker_code): 同一 task 同一阻塞码仅一条 (实际迁移单独 CONCURRENTLY 文件)
CREATE UNIQUE INDEX idx_task_config_blockers_task_code ON task_configuration_blockers(task_id, blocker_code);
-- M0.5: deadline_scanner 扫描索引 (实际迁移单独 CONCURRENTLY 文件)
CREATE INDEX idx_task_config_blockers_deadline ON task_configuration_blockers(deadline_at) WHERE resolved_at IS NULL AND deadline_at IS NOT NULL;

-- project_watchdog_states — Project 看门狗状态 (每 project 一行)
CREATE TABLE project_watchdog_states (
  project_id                  UUID PRIMARY KEY,                 -- [C] (无 DB FK)
  last_stalled_at             TIMESTAMPTZ,                      -- [C] 最近判定 stalled 时间
  last_fingerprint            TEXT,                             -- [C] 最近进度指纹
  last_fingerprint_changed_at TIMESTAMPTZ,                      -- [C] 指纹最近变化时间
  stalled_duration_minutes    INT NOT NULL DEFAULT 0,           -- [C] 累计 stalled 分钟
  last_tier1_notified_at      TIMESTAMPTZ,                      -- [C] tier1 通知时间
  last_tier2_triggered_at     TIMESTAMPTZ,                      -- [C] tier2 触发时间
  last_tier3_triggered_at     TIMESTAMPTZ,                      -- [C] tier3 触发时间
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- watchdog_inspections — 看门狗检查任务 (tier2 编排 / tier3 人工)
CREATE TABLE watchdog_inspections (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                  UUID NOT NULL,                    -- [C] (无 DB FK)
  inspection_task_id          UUID,                             -- [C] 触发的检查任务 id
  tier                        TEXT NOT NULL CHECK (tier IN ('tier2_orchestrator','tier3_human')),
  triggered_at                TIMESTAMPTZ NOT NULL DEFAULT now(), -- [C]
  fingerprint                 TEXT,                             -- [C] 触发时指纹
  stalled_tasks_snapshot      JSONB,                            -- [C] stalled 任务快照
  diff_from_previous          JSONB,                            -- [C] 与上次指纹差异
  orchestrator_analysis       JSONB,                            -- [C] tier2 编排分析结果
  resolution                  TEXT CHECK (resolution IN ('resolved','manual_intervention','project_cancelled')),
  resolved_at                 TIMESTAMPTZ
);
-- 偏唯一索引: 每 project 仅一条 active (未解决) 检查 (实际迁移单独 CONCURRENTLY 文件)
CREATE UNIQUE INDEX idx_watchdog_inspections_active_project ON watchdog_inspections(project_id) WHERE resolution IS NULL;

-- ----------------------------------------------------------------------------
-- watchdog_logs — 组件级运维告警日志  [C]  [DB:NEW]
--      来源: CSI §10.8 L1516 (deadline_scanner 扫描失败 critical 告警)
--      边界: 通用告警日志, 不限 project watchdog; 与 activity_log(审计) 职责不同
-- ----------------------------------------------------------------------------
CREATE TABLE watchdog_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source        TEXT NOT NULL,                                  -- [C] P0 deadline_scanner | sweeper | watchdog_tier1 | budget_scanner | janitor
  level         TEXT NOT NULL,                                  -- [C] P0 critical | warning | info
  scope_type    TEXT,                                            -- [C] P0 project | task | agent_run | workspace | system
  scope_id      UUID,                                            -- [C] P0 多态 scope (scope_type=system 时为 NULL)
  message       TEXT NOT NULL,                                   -- [C] P0 人读告警消息
  payload       JSONB NOT NULL DEFAULT '{}',                     -- [C] P0 机读详情 (错误码/堆栈/上下文快照)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at   TIMESTAMPTZ                                      -- [C] P0 NULL=未确认; 告警确认后填充
);

-- M0.5: 扫描未确认告警 (建表迁移时单独 CONCURRENTLY 文件)
CREATE INDEX idx_watchdog_logs_unresolved ON watchdog_logs(created_at) WHERE resolved_at IS NULL;

-- task_contexts — Task 执行上下文快照 (按 attempt + version 版本化)
CREATE TABLE task_contexts (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id                     UUID NOT NULL,                    -- [C] (无 DB FK)
  attempt_seq                 INT NOT NULL,                     -- [C] 第几次尝试
  context_version             INT NOT NULL DEFAULT 1,           -- [C] 同 attempt 内上下文版本
  context_json                JSONB NOT NULL DEFAULT '{}',      -- [C] 完整上下文
  context_md                  TEXT,                             -- [C] 上下文 markdown (可读副本)
  total_tokens                INT NOT NULL DEFAULT 0,           -- [C] 上下文 token 估算
  pruned_steps                JSONB NOT NULL DEFAULT '[]',      -- [C] 已裁剪步骤记录
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- UNIQUE(task_id, attempt_seq): 同一 task 同一 attempt 仅一份上下文 (实际迁移单独 CONCURRENTLY 文件)
CREATE UNIQUE INDEX idx_task_contexts_task_attempt ON task_contexts(task_id, attempt_seq);

-- inbound_webhook_events — 入站 webhook 事件 (幂等去重)
CREATE TABLE inbound_webhook_events (
  event_id                    UUID PRIMARY KEY,                 -- [C] 外部事件 id (幂等键)
  event_type                  TEXT NOT NULL,                    -- [C]
  source                      TEXT NOT NULL CHECK (source IN ('marketplace','console')),
  received_at                 TIMESTAMPTZ NOT NULL DEFAULT now(), -- [C]
  payload_hash                TEXT,                             -- [C] 负载哈希 (去重辅助)
  processing_state            TEXT NOT NULL DEFAULT 'received' CHECK (processing_state IN ('received','processing','processed','failed')),
  response_code               INT,                              -- [C] 处理响应码
  error_message               TEXT                              -- [C]
);

-- ----------------------------------------------------------------------------
-- 7.6  系统监控 (技术方案 §12 / §13.2 §13.5) — 3 表  [DB:NEW]
-- ----------------------------------------------------------------------------
-- transition_records — 状态转换审计 (guard/gate 决策 + success/side_failed)
-- [M3-D1 落地注记 2026-08-23, 迁移 999380]: 补 entity_type VARCHAR(32) NOT NULL DEFAULT 'task'
--   (Task/Project 转移共表判别, TS §8.3 说明行); task_id 放宽 NULLABLE (Project 转移记录无 task_id,
--   project_id 为锚); 行级 anchor CHECK 保证 entity_type 与锚列一致 (task→task_id / project→project_id)。
CREATE TABLE transition_records (
  transition_id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type                 VARCHAR(32) NOT NULL DEFAULT 'task', -- [C] task | project (999380)
  task_id                     UUID,                             -- [C] (无 DB FK) entity_type=task 时非空 (anchor CHECK)
  project_id                  UUID,                             -- [C] (无 DB FK) entity_type=project 时非空 (anchor CHECK)
  workspace_id                UUID,                             -- [C] (无 DB FK)
  from_status                 TEXT,                             -- [C]
  to_status                   TEXT NOT NULL,                    -- [C]
  transition_type             TEXT NOT NULL CHECK (transition_type IN ('guard_reject','gate_reject','success','side_failed')),
  guard_result                JSONB,                            -- [C] guard 检查结果
  gate_result                 JSONB,                            -- [C] gate 检查结果
  payload_hash                TEXT,                             -- [C] 转换负载哈希
  actor_type                  TEXT,                             -- [C] member | agent | system
  actor_id                    UUID,                             -- [C]
  run_id                      UUID,                             -- [C] 关联 agent_run
  request_id                  TEXT,                             -- [C] 请求追踪 id
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_transitions_task    ON transition_records(task_id);
CREATE INDEX idx_transitions_project ON transition_records(project_id);
CREATE INDEX idx_transitions_created ON transition_records(created_at);

-- metric_hourly — 小时粒度指标 (workspace / project 维度)
CREATE TABLE metric_hourly (
  metric_id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id                UUID NOT NULL,                    -- [C] (无 DB FK)
  project_id                  UUID,                             -- [C] 可空 (workspace 级指标)
  metric_name                 TEXT NOT NULL,                    -- [C]
  metric_value                NUMERIC NOT NULL,                 -- [C]
  dimensions                  JSONB NOT NULL DEFAULT '{}',      -- [C] 维度键值
  hour_bucket                 TIMESTAMPTZ NOT NULL              -- [C] 小时桶
);
-- UNIQUE(workspace_id, metric_name, hour_bucket, dimensions): 指标去重 (实际迁移单独 CONCURRENTLY 文件)
CREATE UNIQUE INDEX idx_metric_hourly_unique ON metric_hourly(workspace_id, metric_name, hour_bucket, dimensions);

-- metric_project_snapshot — Project 监控快照 (周期性采集)
CREATE TABLE metric_project_snapshot (
  snapshot_id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                  UUID NOT NULL,                    -- [C] (无 DB FK)
  project_status              TEXT,                             -- [C] 采集时 project 状态
  task_count_by_status        JSONB NOT NULL DEFAULT '{}',      -- [C] 各状态 task 计数
  milestone_progress          JSONB NOT NULL DEFAULT '{}',      -- [C] 里程碑进度
  sla_status                  JSONB NOT NULL DEFAULT '{}',      -- [C] SLA 状态
  budget_usage_ratio          NUMERIC,                          -- [C] 预算使用比
  captured_at                 TIMESTAMPTZ NOT NULL DEFAULT now() -- [C]
);
CREATE INDEX idx_snapshot_project_time ON metric_project_snapshot(project_id, captured_at);

-- ============================================================================
-- §8  视图 (公测版常用的聚合视图, 非必须)  [C]
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 7.1  v_task_board — Workspace 全 Task 视图 (跨 Phase 1/2/3 统一)  [C]
--      用途: technical-design §5.2 中的 Workspace Task Board
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_task_board AS
SELECT
  t.id,
  t.title,
  t.status,
  t.priority,
  t.milestone,
  t.phase,
  t.context_type,
  t.context_id,
  t.project_id,
  t.opportunity_id,
  t.assignee_type,
  t.assignee_id,
  t.assigned_team_id,
  t.parent_task_id,
  t.depth,
  t.harness_attempt,
  t.harness_max_attempts,
  t.liveness_state,
  t.checkout_agent_id,
  t.estimated_effort_hours,
  t.actual_effort_hours,
  t.created_at,
  t.started_at,
  t.completed_at,
  p.name AS project_name,
  p.status AS project_status,
  p.category AS project_category,
  p.orchestrator_agent_id,
  o.status AS opportunity_status,
  w.name AS workspace_name
FROM project_tasks t
LEFT JOIN projects p      ON t.project_id = p.id
LEFT JOIN opportunities o ON t.opportunity_id = o.id
LEFT JOIN workspaces w    ON COALESCE(p.workspace_id, o.workspace_id) = w.id;

-- ----------------------------------------------------------------------------
-- 8.2  v_agent_workload — Agent 当前工作负载视图  [C]
--      用途: 编排引擎 / Console 显示 Agent 当前活跃 Task 数
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_agent_workload AS
SELECT
  a.id AS agent_id,
  a.workspace_id,
  a.name AS agent_name,
  a.role,
  a.status AS agent_status,
  COUNT(t.id) FILTER (WHERE t.status IN ('ready','running','in_review')) AS active_task_count,
  COUNT(t.id) FILTER (WHERE t.status = 'running') AS running_count,
  COUNT(t.id) FILTER (WHERE t.status = 'in_review') AS in_review_count,
  a.max_concurrent_tasks,
  a.budget_monthly_cents,
  a.budget_used_cents
FROM agents a
LEFT JOIN project_tasks t ON t.assignee_type = 'agent' AND t.assignee_id = a.id
                          AND t.status IN ('ready','running','in_review')
GROUP BY a.id, a.workspace_id, a.name, a.role, a.status, a.max_concurrent_tasks,
         a.budget_monthly_cents, a.budget_used_cents;

-- ============================================================================
-- §9  触发器 (审计 / updated_at 自动维护)  [C]
-- ============================================================================

-- 通用 updated_at 触发器函数
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 为所有有 updated_at 字段的表挂触发器
CREATE TRIGGER trg_workspaces_updated   BEFORE UPDATE ON workspaces   FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_agents_updated       BEFORE UPDATE ON agents       FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_runtimes_updated     BEFORE UPDATE ON agent_runtimes FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_teams_updated        BEFORE UPDATE ON agent_teams  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_skills_updated       BEFORE UPDATE ON skills       FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_templates_updated    BEFORE UPDATE ON agent_templates FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_projects_updated     BEFORE UPDATE ON projects     FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_tasks_updated        BEFORE UPDATE ON project_tasks FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_comments_updated     BEFORE UPDATE ON task_comments FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_routines_updated     BEFORE UPDATE ON project_routines FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_documents_updated    BEFORE UPDATE ON project_documents FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_profile_updated      BEFORE UPDATE ON agent_quality_profile FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- ============================================================================
-- Schema 完成
-- ============================================================================
-- 表统计 (M0.1 v2):
--   §1 Workspace 层:    11 张 (workspaces / agents / agent_runtimes / agent_teams /
--                           agent_team_members / skills / agent_skills / agent_templates /
--                           agent_quality_profile / workspace_portfolio_cases [M0.8] /
--                           workspace_credit_summary [M0.8])
--   §2 Project 层:      9 张 (projects / project_tasks / task_dependencies / task_comments /
--                           task_interactions / task_execution_decisions /
--                           task_revision_negotiations / plan_decompositions / opportunities)
--   §3 Routine 层:      4 张
--   §4 产物管理:        6 张 (project_documents / project_document_revisions /
--                           task_documents / document_annotation_threads /
--                           document_annotation_comments / project_artifacts)
--   §5 Spec 契约:       2 张 (project_spec_revisions / spec_change_requests)
--   §6 系统级:          5 张 (notifications / activity_log / agent_runs /
--                           agent_wakeup_requests / budget_incidents)
--   ── 以上 §1-§6 现有层小计: 37 张 (M0.8 +2: workspace_portfolio_cases / workspace_credit_summary) ──
--   §7 CSI 基础设施扩展层 (M0.1 补齐): 17 张
--                           = 14 [DB:NEW] M0.1 建迁移 (audit/doc/event/quality/monitoring)
--                           + 3 [DB:<existing>] 映射跳过 (workspace_members→member /
--                             workspace_invitations→workspace_invitation / api_tokens→personal_access_token)
--   ── §1.2 目标态合计: 54 张表 (M0.8 +2) ──
--   §8 视图:            2 张 (v_task_board / v_agent_workload)
--   §1.3b Runtime 四层模型: 3 张设计定义 (偏离-001, 不计入 §1.2 54 表;
--                           runtime_profile 已存在 migration 120;
--                           runtime_profile_version / runtime_instance 归 Runtime feature task)
--   合计: §1.2 目标态 54 张表 + 2 视图 = 56 个数据库对象
--         (另含 §1.3b Runtime 3 张设计定义, 偏离-001 不计入 §1.2)
-- ============================================================================
