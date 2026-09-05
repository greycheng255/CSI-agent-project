# M 侧答复：C→M 链路联调进展 + W1/W2/W3 提案反馈

> **答复方**：Marketplace（M 侧）
> **日期**：2026-09-04
> **背景**：今晚双方完成 C→M 链路逐层排查与修复；同时收到贵方 `proposal-to-m.md`（W1 查询 API + W2 生命周期事件 + W3 席位快照）提案。
> **结论速览**：鉴权已通、Pull 响应格式已修、链路已到业务层——**仅剩 1 处 Console 侧偏差**（见第三节）。

---

## 一、M→C 方向（M → Console Webhook）：已全链路验证通过

1. 16 条 Webhook 路径投递正常，四件套请求头（Bearer / X-Signature / X-Request-Id / Idempotency-Key）按 §3.1。
2. 密钥口径：M 出站签 `m2c-...`（= 贵方 `CSI_MARKETPLACE_INBOUND_*`），双向值一致，贵方验签已通过（实测 ACK）。
3. **payload 补丁（请知悉）**：M 侧 outbox 投递时自动在 body 注入 `event_id`（与 Idempotency-Key 头同值，§8.3 信封 + §4.1 去重口径），已实测贵方校验通过。
4. 故障注入已验证：4xx 直进死信、5xx/网络错误按 5s/30s/2min/10min/1h 退避重试 5 次、重投 event_id 不变。

## 二、C→M 方向（Console → M）：鉴权与格式已修通

1. **鉴权（抓包定位，已闭环）**：贵方服务级调用（`marketplace_pull` 等）实际发送：
   - `Authorization: Bearer` = **CSI_SERVICE_TOKEN**（`09d9ee06...`）
   - `X-Signature` = **HMAC-SHA256(CSI_WEBHOOK_SECRET, body原文+ts)**（`2c42afd7...`）
   - 即 Bearer 与 HMAC 用**两把不同密钥**——与 C2 清单的方向分离口径不同（贵方出站未接线 `CSI_MARKETPLACE_OUTBOUND_*`）。
2. M 侧已适配：`HmacGuard` 新增 `LONGTASK_INBOUND_HMAC_SECRET`（HMAC 独立密钥，未设时回落单密钥口径，向后兼容）。当前 C→M 调用已全部通过 M 侧验签（401 彻底消失）。
3. **Pull 响应格式（已修）**：M 侧 `GET /v1/marketplace/tasks` 已改为契约 §9.2 包装结构 `{ "tasks": [...], "next_cursor": null, "has_more": false }`，task 字段按契约 snake_case（task_id / budget_range / current_seats / published_at 等），支持 `category / status / since / limit` 过滤。贵方 `listTasksResponse` 反序列化已通过（unmarshal 错误消失）。
4. cursor 分页联调期未启用（next_cursor 恒 null、字段恒出现，符合 §21 同款约定）；如需 keyset 分页请反馈，M 侧按 `(published_at, task_id)` 实现。

## 三、当前唯一卡点：pull 任务的 workspace_id 校验（**请贵方修复**）

1. **现象**：贵方 pull 处理对每条 task 强制校验 `workspace_id` 为 UUID，报错：
   `ports: invalid request: marketplace task "" has a non-UUID workspace_id ""`
2. **契约依据**：§9.2 Pull 响应的 task schema **没有** `workspace_id` 字段——Pull 是**公开商机发现**（任务无归属），该字段仅存在于：
   - §9.1 Push 定向事件 `data.workspace_id`（定向投给某 workspace）
   - 场景二投标请求 `workspace_id`（竞标主体）
3. **请贵方修复**：pull 路径对无 `workspace_id` 的公开任务**跳过归属校验**（商机记录挂发现池 / Agent 判定匹配后再绑定 workspace），不应沿用 push 定向语义。
4. 贵方修复后，M 侧将立即重推一条 open 任务完成 M→C 端到端验收（M 侧 4001 联调窗口保持运行中）。

### 可直接转发的修复请求（简版）

> **pull 任务 workspace_id 校验偏差反馈**：`GET /v1/marketplace/tasks`（契约 §9.2）响应的 task schema 无 `workspace_id` 字段——Pull 为公开商机发现，任务无归属；该字段仅存在于 Push 定向事件（§9.1）与投标请求（场景二）。贵方 pull 处理现按 push 定向语义强制校验 `workspace_id` UUID，导致公开任务全部被拒（`non-UUID workspace_id ""`）。请改为：task 无 `workspace_id` 时跳过归属校验，商机记录挂发现池，Agent 判定匹配后再绑定 workspace。修复后 M 侧即重推 open 任务完成 M→C 端到端验收。

## 四、密钥对齐过渡约定

1. M 侧当前 C→M 验签配置（过渡态，均已注明来源与回切值）：
   - Bearer 比对 = `09d9ee06...`（= 贵方 CSI_SERVICE_TOKEN）
   - HMAC 重算 = `2c42afd7...`（= 贵方 CSI_WEBHOOK_SECRET）
2. **请贵方按 C2 清单接线出站方向密钥**（出站签名改用 `CSI_MARKETPLACE_OUTBOUND_TOKEN/SECRET` = `c2m-...`），贵方完成后 M 侧切换回 `c2m-...` 单密钥口径（回切值已备档）。
3. M→C 方向（`m2c-...`）双方已一致，无需调整。

## 五、对 proposal-to-m.md（W1/W2/W3）的反馈

1. **落地策略**：同意"独立优先"，贵方先行实现，M 侧按本反馈接入。
2. **字段白名单（§二 feedback 点）**：现有 10 字段满足四个场景，暂不增补；`showcase_announcement` 门店公告、信用摘要留待二期按白名单修订流程提。
3. **W2 端点与事件命名（§三 feedback 点①）**：同意 `POST /v1/webhooks/workspace/changed` + `workspace.created/updated/deleted` 三事件；**无 suspended** 的语义 M 侧知悉（删除即终点，停止展示与投递）。
4. **全量快照粒度（feedback 点②）**：同意全量快照 + 幂等 upsert（免 delta 排序，联调期最稳）。
5. **消费模式（feedback 点③）**：M 侧选择**推荐组合**——"收 W2 事件建本地投影 + W1 Pull（since 水位）周期对账兜底"。
6. **GET 签空 body（§二通用约定）**：确认。M 侧守卫对无 body 请求按空串派生（2026-09-02 登记的问题已于当轮修复，本轮联调已实测空串口径通过）。
7. **W2 best-effort 语义**：知悉与 M→C at-least-once 的差异；M 侧按 `event_id` 去重（Idempotency-Key 头同值双保险）+ W1 Pull 兜底闭合。
8. **W3 席位快照**：同意 `submit_bid` 增补 `workspace_name` / `workspace_avatar_url` 两个可选字段，M 侧消费端将渲染席位信息；旧数据缺省兼容。
9. **反馈截止**：无其他异议，按本稿推进即可，无需等到 2026-09-10。

## 六、联调环境状态（M 侧）

1. Backend 联调窗口：`http://122.51.51.177:4001` 运行中（贵方 pull 定时器当前依赖该实例，请注意勿在验收前停服）。
2. 已完成：测试数据清理（outbox dead 行 / e2e 任务与 workspace）、抓包代理下线、贵方 configmap 恢复直连 `172.17.0.14:4001`。
3. 待贵方修复第三节偏差后：M 侧重推 open 任务 → Console 200 ACK → outbox `success` → M→C 端到端验收闭账。

---

*M 侧联调联系人：（略）；本文档随仓库 `csi-longtask business-docs/design/` 同步。*
