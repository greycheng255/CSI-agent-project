# 非签约阶段拒收 Mention（§13.2 契约补齐）验收报告

> 验收对象：`STATE_PROJECT_NOT_SPEC_SIGNING`（422）新增 + C 侧对接说明扩写为双向通道说明
> 提交：`ea6ca0a`（本轮代码变更）
> M 侧实现：`backend/src/longtask/contract/errors.ts`、`backend/src/longtask/marketplace-orders/spec-contract.service.ts`
> 相关文档：`csi-longtask business-docs/design/雇主主动发起消息-C侧对接说明.md`（v3）

---

## 一、验收结论

**通过。** 三项真实 HTTP 实测全部符合预期，E2E 21/21 无回归，质量门全绿，已部署至生产容器并清理测试数据。

本轮为**契约补齐**性质：把总契约 §13.2 早已声明、但 M 侧一直未实现的错误码补上，使 C 侧按文档对接时行为可预期。

---

## 二、验收范围

### 2.1 本轮变更

| # | 变更 | 性质 | 说明 |
|---|---|---|---|
| 1 | 新增 `STATE_PROJECT_NOT_SPEC_SIGNING`（422） | 代码 | 非签约阶段的订单不再受理新的 `@employer` 提问 |
| 2 | 定义签约阶段判定集合 `SPEC_SIGNING_STAGES` | 代码 | `signing` / `awaiting_confirmation` 受理；`signed` / `cancelled` 拒收 |
| 3 | 校验置于**幂等回读之后** | 代码 | 已受理的 `mention_id` 重试不受订单状态推进影响 |
| 4 | 新增 4 个单测 | 测试 | signed 拒 / cancelled 拒 / awaiting_confirmation 受理 / 幂等优先 |
| 5 | C 侧对接说明扩写为双向通道说明（v3） | 文档 | 补 Agent/Agent Owner 发起通道（原仅总契约 §13.2）+ 顶层 Comment 回流闭环要求 |

### 2.2 判定集合的依据（为什么是这两个状态）

`marketplace_orders.contract_status` 的取值链为 `signing`（选标成功，待提交 Spec）→ `awaiting_confirmation`（已提交 Spec，待雇主确认）→ `signed`（Spec 已签署，进入交付期）/ `cancelled`。

「签约阶段」即 Spec 签署完成之前的两个状态；`signed` 后进入交付期、`cancelled` 后订单终止，均不再受理新提问。**该口径经用户确认（维持 §13.2 严格口径）**。

### 2.3 范围外

- `CONFLICT_PROCESSING_IN_PROGRESS`（409）：**本轮不实现**，见第七节 L1。
- 前端：本轮无前端改动。
- 交付期（`signed`）是否需要受理 mention：待 C 侧反馈，见第七节 L2。

---

## 三、验收环境

| 项 | 值 |
|---|---|
| 后端镜像 | `genesis-backend:20260925-155128`（旧：`20260925-1403`） |
| 容器 | `genesis-backend`，`--network csi_genesis-net --env-file .env -p 4001:4000 --restart always -v csi_genesis_uploads:/app/uploads` |
| 数据库 | 生产 `genesis_db`（PostgreSQL） |
| 部署校验 | `docker run --rm <镜像> sh -c 'grep -c STATE_PROJECT_NOT_SPEC_SIGNING dist/…/errors.js'` → `1`；`grep -c SPEC_SIGNING_STAGES dist/…/spec-contract.service.js` → `2`（镜像内确为新代码，避免发布过时 dist） |
| 启动校验 | Nest 正常启动，`Database pool warmed with 4 connections`，路由注册正常 |

> 后端 `Dockerfile` 为 `COPY dist ./dist`，故部署前已在 `backend/` 执行 `npm run build`；并用「镜像内 grep」二次确认，规避历史「镜像构建成功但内部无新代码」的坑。

---

## 四、验收项对照

| # | 验收项 | 方法 | 结果 |
|---|---|---|---|
| 1 | 非签约阶段拒收新 mention | 对 `contract_status=signed` 的订单（`795c117a-…`）推送新 `mention_id` | ✅ **422** `STATE_PROJECT_NOT_SPEC_SIGNING` |
| 2 | 拒收后不留脏数据 | 查 `employer_mentions` 该订单行数 | ✅ `0` 行 |
| 3 | 幂等未被阶段校验破坏 | 对 `signing` 订单（`3a4d2636-…`）重推已受理的 `mention_id` | ✅ **201** `duplicate=true` |
| 4 | 正常路径无回归 | 对 `signing` 订单推新 `mention_id` | ✅ **201** `duplicate=false` |
| 5 | 端到端无回归 | 重跑 `longtask-employer-chat-e2e.js` | ✅ **21/21 PASS** |
| 6 | 契约文档与实现一致 | 对接说明 §3.5 由「未实现」改为「已实现」并补判定口径表 | ✅ 已同步（v3） |
| 7 | 测试数据清理 | 删除实测产生的 mention / outbound 行 | ✅ 见第六节 |

### 4.1 实测响应原文

**验收项 1（422）**

```json
{
  "type": "about:blank",
  "title": "order is not in spec-signing stage (contract_status=signed)",
  "status": 422,
  "detail": "order is not in spec-signing stage (contract_status=signed)",
  "instance": "/v1/marketplace/orders/795c117a-7095-4740-bbd6-7195098ea1ee/employer-mentions",
  "request_id": "403bb99b-cab9-432e-97db-38f725f14d19",
  "error_code": "STATE_PROJECT_NOT_SPEC_SIGNING"
}
```

**验收项 3（幂等优先）**

```json
{ "ok": true, "mention_id": "97082302-…", "received_at": "2026-09-25T06:04:30.017Z", "duplicate": true }
```

**验收项 4（正常路径）**

```json
{ "ok": true, "mention_id": "21c2c2f6-…", "received_at": "2026-09-25T07:52:31.411Z", "duplicate": false }
```

---

## 五、实现要点

```ts
const SPEC_SIGNING_STAGES = new Set<string>(['signing', 'awaiting_confirmation']);

const existing = await this.mentionsRepo.findOne({ where: { mentionId } });
if (existing) return this.mentionAck(existing, true);   // ← 幂等优先

if (!SPEC_SIGNING_STAGES.has(order.contractStatus)) {
  throw new ContractError(
    422,
    CONTRACT_ERROR_CODE.STATE_PROJECT_NOT_SPEC_SIGNING,
    `order is not in spec-signing stage (contract_status=${order.contractStatus})`,
  );
}
```

**为什么校验必须放在幂等回读之后**：M 侧 outbox 是 at-least-once，Console 重试是常态。若把阶段校验前置，一条在 `signing` 时已被受理的提问，会因订单后来推进到 `signed` 而在重试时突然变成 422——对端会把它当失败处理。放在回读之后，语义变为「已受理的照旧幂等应答，只有**新**提问才受阶段约束」。该行为有专门单测覆盖（验收报告第 4 项断言）。

---

## 六、质量门与数据清理

### 6.1 质量门

| 门 | 结果 |
|---|---|
| 单测（`spec-contract.service.spec.ts`） | ✅ **29/29**（新增 4 项） |
| 后端全量回归 | ✅ **427/427**，62 suites |
| 后端 `npx eslint`（改动文件） | ✅ **0 报错**（顺带清掉 HEAD 既有的 2 个 prettier + 1 个 union 冗余报错） |
| 后端 `npm run build` | ✅ `nest build` 成功 |
| 前端 `npx eslint`（改动文件） | ✅ 0 报错 |
| 前端 `npm run build` | ✅ `tsc -b && vite build` 成功 |

### 6.2 数据清理

实测产生 3 行测试数据，**已全部删除并复核**：

| 表 | 主键 | 来源 |
|---|---|---|
| `employer_mentions` | `21c2c2f6-…`（pending） | 验收项 4 正常路径 |
| `employer_mentions` | `9380c390-…`（replied） | E2E 脚本 |
| `employer_outbound_messages` | `f32b20d6-…` | E2E 脚本 |

- 复核：`signed` 订单 mention 数 = **0**；近 1 小时新增 `access_tokens` = **0**（E2E 脚本自行清理其 2 个临时 token）。
- 一次性实测脚本（`/tmp/live-422-test.js`）已删除，未入库。

---

## 七、遗留问题与风险

| # | 问题 | 级别 | 说明与建议 |
|---|---|---|---|
| L1 | `CONFLICT_PROCESSING_IN_PROGRESS`（409）未实现 | 中 | M 侧不做「同幂等键在途」判定，并发由 `mention_id` 唯一约束兜底——结果是**不重复落库**，但不返回 409。若要严格对齐 §13.2，需引入在途状态记录，成本明显高于 422。已在对接说明 §3.5 标注要求 C 侧知悉。 |
| L2 | 交付期（`signed`）是否需要受理 mention | 中 | 当前严格按 §13.2 拒收。若 C 侧在交付期（变更谈判、交付答疑）也要 `@employer`，需放宽 `SPEC_SIGNING_STAGES`——改动仅一行，但需 C 侧先确认。 |
| L3 | §13.2 的 `Idempotency-Key` 头 M 侧不读取 | 低 | 去重完全依赖 body 内的 `mention_id`。已在对接说明标注；若 C 侧按该头实现重试，语义上不影响正确性（M 侧仍按 `mention_id` 幂等）。 |
| L4 | 工作区另有一批未提交改动 | 低 | 「外部自托管 Agent 市场」功能（`agentMarketApi.ts` / `agentMarketCatalog.ts` / `AgentMarketHub.tsx` / `NewTask.tsx`）属**另一工作流**，本轮未参与验证，故未纳入本次提交。需确认是否单独提交。 |

---

## 八、复现方式

```bash
# 1. 单元测试
cd backend && npx jest src/longtask/marketplace-orders/spec-contract.service.spec.ts

# 2. 端到端（21 项断言；E2E_CLEANUP=1 可自清理）
cd backend && node scripts/longtask-employer-chat-e2e.js

# 3. 生产实测：对 signed 订单推 mention，应返 422
#    （需 LONGTASK_INBOUND_TOKEN；签名 t=<unix_ts>,v1=hmac_sha256(rawBody+ts)）
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  http://127.0.0.1:4001/v1/marketplace/orders/<SIGNED_ORDER_ID>/employer-mentions \
  -H "Authorization: Bearer $LONGTASK_INBOUND_TOKEN" \
  -H "X-Signature: t=<ts>,v1=<hmac>" -H 'X-Request-Id: <uuid>' \
  -H 'Content-Type: application/json' \
  -d '{"mention_id":"<新uuid>","content":{"text":"x"}}'   # 期望 422
```

```sql
-- 复核：非签约阶段拒收后不留行
SELECT count(*) FROM employer_mentions WHERE order_id = '<SIGNED_ORDER_ID>';  -- 期望 0
```

---

## 九、证据索引

| 项 | 位置 |
|---|---|
| 错误码枚举 | [errors.ts](file:///home/ubuntu/csi-agent-project-new/CSI-agent-project/backend/src/longtask/contract/errors.ts#L23) |
| 阶段集合定义 | [spec-contract.service.ts](file:///home/ubuntu/csi-agent-project-new/CSI-agent-project/backend/src/longtask/marketplace-orders/spec-contract.service.ts#L25-L30) |
| 入站校验实现 | [spec-contract.service.ts](file:///home/ubuntu/csi-agent-project-new/CSI-agent-project/backend/src/longtask/marketplace-orders/spec-contract.service.ts#L202-L215) |
| 新增单测 | [spec-contract.service.spec.ts](file:///home/ubuntu/csi-agent-project-new/CSI-agent-project/backend/src/longtask/marketplace-orders/spec-contract.service.spec.ts#L199-L275) |
| 契约文档（v3） | [雇主主动发起消息-C侧对接说明.md](file:///home/ubuntu/csi-agent-project-new/CSI-agent-project/csi-longtask%20business-docs/design/%E9%9B%87%E4%B8%BB%E4%B8%BB%E5%8A%A8%E5%8F%91%E8%B5%B7%E6%B6%88%E6%81%AF-C%E4%BE%A7%E5%AF%B9%E6%8E%A5%E8%AF%B4%E6%98%8E.md) §3.5 / §10.2 |
| 本轮提交 | `ea6ca0a` |
| 上一轮联调验收报告 | [雇主与agent沟通闭环-联调验收报告.md](file:///home/ubuntu/csi-agent-project-new/CSI-agent-project/.trae/documents/%E9%9B%87%E4%B8%BB%E4%B8%8Eagent%E6%B2%9F%E9%80%9A%E9%97%AD%E7%8E%AF-%E8%81%94%E8%B0%83%E9%AA%8C%E6%94%B6%E6%8A%A5%E5%91%8A.md) |
