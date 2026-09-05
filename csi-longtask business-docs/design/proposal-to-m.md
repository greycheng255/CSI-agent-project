# 提案：Workspace 档案发现能力（W1 查询 API + W2 生命周期事件 + W3 席位快照）

> **发起方**：Agent Owner Console 团队（§7.1 我方主动提案）
> **日期**：2026-09-04
> **状态**：提案中——**字段级反馈窗口开放**（反馈截止建议：2026-09-10；无反馈视为按本稿推进）
> **落地策略**：独立优先——Console 侧已按本稿先行实现（不等排期）；M 侧消费方式（本地投影 vs 直调渲染）自定，我方不干涉。
> **契约权威**：本提案通过后将并入 `employer-integration-api.md` §21（与既有 §3 鉴权 / §4 幂等 / §5 错误码 / §8.3 信封同构，复用全部既有约定，仅列差异）。

---

## 一、动机（M 侧四个消费场景 + Push 目标池）

现有契约没有任何"M 读 Console"的面（唯一 M→C 面 = 事件 webhook；#36/#38 仅让我方传 workspace_id 给 M）。四个场景需要 workspace 档案：

1. **大厅手动派发**：Agent Owner 逛任务大厅 → 手动派发 task 到名下指定 workspace——M 前端需列出该 owner 的 workspace 供选择（→ 端点三）；
2. **竞标席位展示**：task 页每个席位展示竞标 workspace 信息（头像/名称），可点入主页（→ W3 快照 + 端点二）；
3. **workspace 主页**：M 侧展示 workspace 介绍页（→ 端点二）；
4. **入驻画廊**：平台已入驻 workspace（AI 工作室）卡片页（→ 端点一全量）。

同时补齐 **Push 撮合投递的目标池来源**：M 投影 active workspace 集后才能路由 Push。

## 二、W1：公开档案查询 API（M 调 Console，三端点）

### 通用约定

- 鉴权：与 17 个 M→C webhook 同一套**方向分离入站凭证**（Bearer + HMAC）。
- **HMAC 签空 body**：GET 无 body，签名输入为空串（`t=<unix>,v1=<hex(HMAC-SHA256(secret, ""+t))>`）。⚠️ M 侧守卫对无 body 请求的 payload 派生须按空串——若按 `'{}'` 派生，GET 会恒 401（2026-09-02 联调实测已登记过同款问题）。
- 限流：Console 侧 per-IP（`RATE_LIMIT_PARTNER` 默认 120/min），429 `RATE_LIMIT_EXCEEDED`。
- 超时：短档 5s。

### 公开档案对象 `PublicWorkspaceProfile`（字段白名单——请反馈）

| 字段 | 类型 | 说明 |
|---|---|---|
| `workspace_id` | string (uuid-v7) | 全局唯一标识 |
| `name` | string | 工作室名称 |
| `slug` | string | URL 标识（M 侧深链用） |
| `description` | string \| null | 简介 |
| `avatar_url` | string \| null | 头像（Console 解析后的可渲染地址） |
| `capability_tags` | string[] | 擅长类目（撮合/画廊分类可直接用） |
| `service_commitments` | object | 服务承诺（键值对） |
| `agent_count` | int | Agent 规模（派生 count） |
| `created_at` | string (RFC3339) | 入驻时间 |
| `updated_at` | string (RFC3339) | 增量拉取水位锚 |

**边界（硬约束）**：只输出上表 10 字段。CSI 业务配置（auto_bid / 预算阈值 / orchestrator 等 8 列）、商机获取配置（3 列）、预算、token、runtime 细节、settings/repos/context、成员数据**一律不外泄**（Console 侧守卫测试钉死）。

**feedback 点**：字段够不够四个场景用？要不要加（例如 showcase_announcement 门店公告、信用摘要）？我们按"商务名片"口径裁剪，欢迎提增删意见——增字段需过白名单修订流程。

### 端点一：`GET /v1/partner/workspaces`（列表，增量拉取）

Query：`since`（RFC3339，updated_at 水位，严格大于，可选）/ `limit`（默认 50，上限 200）/ `cursor`（opaque，响应 next_cursor 回传）。

```json
// 200
{
  "workspaces": [
    {
      "workspace_id": "0192…",
      "name": "Silicon Studio",
      "slug": "silicon-studio",
      "description": "全栈交付工作室",
      "avatar_url": "https://console.example/api/avatars/…",
      "capability_tags": ["web-dev", "data-viz"],
      "service_commitments": { "first_response": "2h" },
      "agent_count": 6,
      "created_at": "2026-08-01T10:00:00Z",
      "updated_at": "2026-09-03T08:30:00Z"
    }
  ],
  "next_cursor": "Mdk5OTk…"
}
```

无更多页时 `next_cursor: null`（字段恒出现）。错误：`AUTH_*` 401 / `VALIDATION_PAYLOAD_INVALID` 400（since/cursor/limit 不可解析）/ `RATE_LIMIT_EXCEEDED` 429。

### 端点二：`GET /v1/partner/workspaces/{workspace_id}`（详情）

200 = `PublicWorkspaceProfile` 单对象；404 = `NOT_FOUND_WORKSPACE`（新错误码，对齐 NOT_FOUND_* 族）。

### 端点三：`GET /v1/partner/orgs/{org_id}/workspaces`（Owner 名下列表）

- org_id = 平台统一账户体系的不透明键（Console 侧以 `csi_org_bindings` 绑定解析，测试环境可按联调约定直绑）。
- 200 = `{ "workspaces": [PublicWorkspaceProfile] }`，org 维度**全量不分页**（owner 的 workspace 为个位~十位级）；无绑定 = 200 空数组（非 404）。
- 鉴权复用同一服务间凭证（不做 per-org credential——公测过度设计；如 M 侧有 org 级鉴权诉求请提出）。

## 三、W2：生命周期事件（Console → M，M 提供接收端点）

- **M 侧需提供**：`POST {M_BASE}/v1/webhooks/workspace/changed`（三事件同端点；按 M 自己的入站守卫验 Console 出站凭证）。
- 事件：`workspace.created` / `workspace.updated` / `workspace.deleted`（**无 suspended**——Console 侧 workspace 无 status 列，删除即生命周期终点，M 侧应停止展示与投递）。
- 信封与既有 webhook 信封同构（`source: "console"`、`event_version: 1`）；**payload = 全量快照**（幂等 upsert，免 delta 排序）：

```json
{
  "event_id": "0192…",
  "event_type": "workspace.updated",
  "event_version": 1,
  "occurred_at": "2026-09-04T08:00:00Z",
  "sent_at": "2026-09-04T08:00:01Z",
  "source": "console",
  "data": { "workspace": { "…PublicWorkspaceProfile 全量 10 字段…" } }
}
```

deleted 形态（仅标识）：`"data": { "workspace_id": "…", "deleted_at": "…" }`。

**投递语义（与 M→C webhook 的差异，请 M 侧注意）**：

| 维度 | W2（C→M workspace 事件） | 既有 M→C webhook |
|---|---|---|
| 语义 | **best-effort**（Console 进程内重试 5s/30s/2m + 60s 预算，失败仅日志） | at-least-once + 5 次退避 + 死信表 |
| 去重 | **M 侧按 event_id 去重**（Idempotency-Key 头 = event_id 同值双保险） | Console 侧去重 |
| 兜底 | **M 侧 W1 Pull**（since 水位增量） | Console 对账 + 死信告警 |

公测不建 C→M outbox——可靠性由"M 去重 + Pull 兜底"闭合。**M 侧端点未就绪不阻塞 W1**：Console 侧事件推送默认关闭（配置 `CSI_MARKETPLACE_PARTNER_EVENT_PATH` 后开启），W1 三端点照常可用。

**feedback 点**：①端点路径（`/v1/webhooks/workspace/changed`）与三事件命名可否？②全量快照粒度可否（vs 变更字段集）？③你们倾向"收事件建投影"还是"直接调 W1"（两者都支持，事件 + Pull 兜底是推荐组合）？

## 四、W3：席位快照（submit_bid 增补，向后兼容）

场景二 `POST /v1/marketplace/tasks/{task_id}/bids` 请求体**增补两个可选字段**：

| 字段 | 类型 | 说明 |
|---|---|---|
| `workspace_name` | string（可省略） | 投标时点的 workspace 名称（反规范化快照） |
| `workspace_avatar_url` | string（可省略） | 投标时点的头像引用（Console 存储原值；渲染级绝对地址以 W1 详情 `avatar_url` 为准） |

席位页免逐条调 W1；值为投标时点档案（后续改名不回溯）；旧消费者忽略即可（零破坏）。

## 五、幂等 / 去重 / 兜底汇总

| 件 | 幂等 | 去重 | 兜底 |
|---|---|---|---|
| W1 三端点 | GET 天然幂等 | — | — |
| W2 三事件 | event_id（去重表 + Idempotency-Key 头） | M 侧按 event_id | M 侧 W1 Pull（since 增量） |
| W3 两字段 | 随宿主（竞标幂等键不变） | 宿主 | — |

## 六、M 侧接入清单（最小面）

1. 实现三个 GET 的调用方（或选择 W2 投影模式，则只需实现 `/v1/webhooks/workspace/changed` 接收端点 + 周期 Pull 对账）；
2. GET 签名按**空 body** 派生（守卫修正项，见二·通用约定）；
3. submit_bid 消费侧忽略/采用新字段（零成本兼容）；
4. 依据本稿反馈字段意见（或确认无异议）。

---

*本提案为 `employer-integration-api.md` §21 的独立提取版（2026-09-04）；通过后以该文档为契约权威。*
