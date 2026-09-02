# 长任务平台 ↔ Console 联调 Runbook（联调窗口 2026-08-31 开启）

> 联调窗口已开启。本文档是联调的唯一操作手册：环境准备、协议基准（P0 #1/#2 平台侧提案）、逐场景验证步骤与验收清单。
> Console 侧代码不在本仓库；其未就绪时使用 [mock-console.mjs](../scripts/mock-console.mjs) 契约替身先行自测全链路。

## 1. 角色与环境

| 项 | 平台侧（本仓库） | Console 侧（另一仓库，Go） |
|---|---|---|
| 角色 | Marketplace：雇主门户、匹配、席位、订单/结算/纠纷、权益计费 | Agent Owner Console：竞标执行、Spec 签订、交付引擎 |
| C→M（Console 调平台） | 提供 22 个 API（[契约 §2.2](../csi-longtask%20business-docs/design/research/employer-integration-api.md)） | 发起方 |
| M→C（平台调 Console） | 发起方（outbox + 每 10s 投递） | 提供 17 个 Webhook |

环境变量（平台侧 `.env` 联调值）：

```bash
LONGTASK_SERVICE_TOKEN=st-local          # 双向共用的服务令牌（联调期）
CONSOLE_BASE_URL=http://localhost:8800   # 真实联调时指向 Console 测试 K8s
```

## 2. 启动顺序（契约替身自测）

```bash
# 终端 1：Console 契约替身（17 个 Webhook 接收端 + HMAC 验签 + 幂等去重 + 故障注入）
LONGTASK_SERVICE_TOKEN=st-local node scripts/mock-console.mjs 8800

# 终端 2：平台后端（DB_SYNC 自动建表；outbox 投递定时器每 10s 触发）
cd backend && LONGTASK_SERVICE_TOKEN=st-local CONSOLE_BASE_URL=http://localhost:8800 npm run start:dev
```

验替身快照：`curl http://localhost:8800/__received`

## 3. 协议基准冻结（P0 #1/#2 平台侧提案，Console 核对后写入契约）

### 3.1 P0 #1 — workspace_id 同步口径（提案）

- **主键口径**：workspace_id 统一为**平台侧 UUID v4 字符串**（平台 `workspaces.id`）。Console 侧 `workspace_id` 字段直接存该 UUID，不做二次映射；Console 内部自有 ID 与平台 ID 的对应关系由 Console 自行维护（建议存 `platform_workspace_id` 列）。
- **建立时机**：Workspace 注册/入驻完成时，平台生成 UUID 并通过**入驻回执接口或运营侧同步给 Console**（联调窗口与 Console 确认具体通道，二选一：① Console 调 `POST /v1/workspaces` 返回体携带；② 运营批量导入表）。
- **投递约定**：商机 Push payload、订单/结算/纠纷全部事件中的 `workspace_id` 均为该 UUID；Console 回调（C→M 请求体）必须原样回传，平台按其做归属校验（不匹配 404）。
- **slug 不参与跨仓引用**：`workspaces.slug` 仅用于店铺页 URL，禁止作为 API 标识。

### 3.2 P0 #2 — 状态枚举冻结清单（提取自平台代码，Console 按此实现）

| 实体 | 枚举值（冻结） | 代码位置 |
|---|---|---|
| workspace 展示状态 | `active` `suspended` `frozen` | workspaces/workspace.entity.ts |
| marketplace task | `draft` `open` `selected` `completed` `expired` `closed` `cancelled` | marketplace-tasks/marketplace-task.entity.ts |
| bid | `submitted` `won` `lost` `rejected`；source：`push` `pull` `manual_assign` | marketplace-bids/marketplace-bid.entity.ts |
| order 阶段 | `contract_status`(默认 `signing`) / `delivery_status` / `settlement_status`（varchar，随下游实体状态同步） | marketplace-orders/marketplace-order.entity.ts |
| delivery | `submitted` `accepted` `rejected` `revision_requested` `auto_accepted` | marketplace-orders/delivery.entity.ts |
| 修订协商 | `open` `resolved`（决策 A/B/C/D） | marketplace-orders/negotiation.entity.ts |
| spec 变更 | `requested` `classified` `proposed` `confirmed` `rejected` | marketplace-orders/spec-change.entity.ts |
| 协商取消 | `open` `accepted` `rejected` `counter_proposed` `finalized` `to_dispute` | marketplace-orders/cancel-request.entity.ts |
| settlement | `pending` `settled` `appeal_closed` | settlements/settlement.entity.ts |
| dispute | `evidence_open` `arbitrating` `resolved` `acknowledged`；resolution：`cancel` `fulfill` `partial_settlement` `refund` | disputes/dispute.entity.ts |

规则：英文小写下划线符号；新增值需双侧同步版本化（契约 §8.1）；Console 不得单方扩展。

## 4. 逐场景验证（P0 #5/#6）

curl 统一头部（C→M 方向）：

```bash
TOKEN=st-local
BODY='<json payload>'
TS=$(date +%s)
SIG="t=${TS},v1=$(printf '%s%s' "$BODY" "$TS" | openssl dgst -sha256 -hmac "$TOKEN" -binary | base64)"
curl -sS -X POST "http://localhost:4001/v1<路径>" \
  -H "Authorization: Bearer $TOKEN" -H "X-Signature: $SIG" \
  -H "Content-Type: application/json" -H "Idempotency-Key: <uuid>" -d "$BODY"
```

| 场景 | 步骤摘要 | 契约章节 | 验收 |
|---|---|---|---|
| 一 商机投递 | ① 平台运营创建 task + Push（或 Console Pull `GET /v1/marketplace/tasks`）→ ② 替身收到 `opportunity.pushed` | §9 | 替身快照含 event；重复推送幂等 |
| 二 竞标提交 | Console 提交竞标（占席位）→ 非法席位满 422 | §10 | bid `submitted`；席位校验生效 |
| 三 选标 | 平台选标 → `bid.result` webhook（won/lost/全部驳回三形态） | §11 | 替身快照含对应 event_type |
| 四 Project 创建 | 中标回执后 Console 创建 Project → 失败兜底 webhook 重试 | §12 | order `contract_status=signing` |
| 五 Spec 签订 | 提交 Spec（含 spec_hash）→ 雇主确认/驳回 → webhook；未传 hash 平台补算 | §13.4/.5 | spec_hash 落库；7 天超时注册 |
| 六 交付验收 | 提交交付物 → 14 天计时 + 5/9/13 天催办 → 验收/驳回/自动验收 | §14 | 催办 event 5/9/13 天各一；**修订期间计时暂停（已裁决 2026-08-31）：扫描仅命中 `status='submitted'`，`revision_requested`/`rejected` 后计时失效，重交（submissionSeq+1）重置 14 天** |
| 七 修订协商 | 修订超限 → 协商窗口 → 4 选项 + 2 天默认 C | §15 | 超时默认 C + 申诉期开立 |
| 八 Spec 变更 | 变更请求 → 判定 → 提案 → 雇主二次确认 | §16 | confirmed 后新 spec_hash 覆盖 |
| 九 取消/结算 | 协商取消三选一 → 结算触发 → `settlement.completed` → 7 天申诉期关闭 | §17/§18 | settlement `appeal_closed` |
| 十 纠纷 | 举证 3 天 → 仲裁 → 4 选项结果 → 确认 | §19 | dispute `resolved`/`acknowledged` |

## 4b. 网关密钥 K1-K4（Console daemon 本地代理通道硬前置，已实现）

格式对齐 OneLLM 口径（skill 文档）：`sk-csi-<base64url>`，Bearer 调用；明文仅签发响应出现一次，平台 AES-256-GCM 加密落库（可解密实现 K1 幂等重取），daemon 内存持有。

| 端点（平台侧，HMAC 同 C→M） | 语义 |
|---|---|
| `POST /api/v1/gateway/keys` | **K1 签发（幂等）**：`{org_id, workspace_id}` → 已有 active key 原样返回（`existing:true`），无则新建 |
| `POST /api/v1/gateway/keys/validate` | **K2 验签注入**：daemon 代理以 key 换 `{workspace_id, org_id, key_id}` 归集头（TenantID=workspace_id 口径）；无效/吊销 → `valid:false` |
| `POST /api/v1/gateway/keys/:keyId/revoke` | **K3 吊销**：即时失效；daemon 401 后重取走 rotate 链路 |
| `POST /api/v1/gateway/keys/:keyId/rotate` | **K4 轮换**：新 key active + 旧 key 置 rotated（daemon 24h 顺带轮换语义） |
| `GET /api/v1/gateway/keys?workspace_id=` | 密钥列表（不含明文） |

网关契约面映射登记（指南(2) §3.7.1，E5/L1/L2 精确定义在 Console 仓库专属文档 `CSI-LLM-Gateway-Billing-Team-Requirements.md`）：
- **E1-E4/B.6** ✅ entitlement 模块；**E6 免费额度激活** ✅ activate 幂等已验；**K1-K4** ✅ 本节
- **L2 计量面** ✅ `recordUsage`（chat token / media credits）+ `credit-holds` 预扣三段式已承载
- **L1 统一调用面**：LLM/media 代理转发由网关服务本体承载（skill 文档即其 API：`/v1/chat/completions`、`/v1/media/generations`），本仓库只做权益校验（`POST /v1/entitlement/checks`）与计量计费，不重复建代理
- **E5**：待专属文档对齐后登记

## 5. 可靠性链路用例（投递器已接线，联调必测）| 用例 | 操作 | 预期 |
|---|---|---|
| 正常投递 | 触发任一 webhook | 替身 200，快照 +1 |
| HMAC 校验 | 错误 token 发起 C→M | 平台 401 `AUTH_TOKEN_INVALID` |
| 5xx 重试 | Push 时替身 `?fail=500` | outbox 按退避重试 5 次（5s→30s→2m→10m→1h） |
| 4xx 死信 | `?fail=404` | 直接死信 + error 日志 |
| 网络超时 | `?fail=timeout` | 10s 超时按网络错误重试 |
| 幂等去重 | 同 event 重投 | 替身返回 `duplicate:true`，快照不增加 |

## 6. 验收清单（窗口关闭条件）

- [ ] P0 #1 workspace_id 口径 Console 书面确认
- [ ] P0 #2 枚举清单 Console 书面确认（或差异项回写本表）
- [ ] 场景一~四真实环境通过（替身换真实 Console）
- [ ] 场景五~八真实环境通过（Console M4 闭合后）
- [ ] 可靠性链路 6 用例全过
- [ ] 差异清单归零，契约文档回写定稿
