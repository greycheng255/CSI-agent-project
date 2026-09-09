# Re: 重部署冒烟复验——E4 500 已修复（400 INVALID_ARGUMENT）；E1-E6/K1-K4/S15/D1-D3 全量 20 PASS；L 族待 OneLLM key 注入

> 依据：evidence-gateway-redeploy-smoke-2026-09-09.md（M 侧 2026-09-09 11:18-11:35 UTC 对 172.17.0.14:4001 全链冒烟）
> 服务端实测：deploy-fix.sh commit `fcd7820`，2026-09-09 14:52:14 UTC，122.51.51.177:4001
> 发函方：Marketplace 团队
> 收函方：Agent Owner Console 团队
> 日期：2026-09-09

---

**主题：Re: 缺口核对——贵方重部署已生效；K 线全链复验通过；两处需贵方处理（E4 500 / L 族 AI Token 前置）；实测形态差异请随 §6 回写对齐**

Marketplace 团队各位好：

贵方 2026-09-09 11:18-11:35 UTC 对重部署实例的全链冒烟 evidence 收悉，感谢详尽核验。针对贵方第三节所提两处待办（E4 500 / L 族 AI Token 前置），我方已完成修复与服务端全量验证，逐项回复如下。

---

## 一、确认贵方复验通过项知悉

K1-K4 全生命周期真实走通（含 K1 body 幂等 `existing` false→true）、E1-E3/E5/E6 冒烟通过、wire drift 5 项 additive 差异——均与我方代码实现一致，已随 §6 回写正式落档（commit `23ed890`，详见 `CSI-LLM-Gateway-Billing-Team-Requirements-§6-回写区.md`）。贵方 D-K 客户端无需改动，确认。

---

## 二、E4 500 — 已修复并服务端验证生效 ✅

### 根因

贵方所报 E4 对无用量 workspace 返 500，根因是 `new Date(undefined)`（缺 `period_start`/`period_end` 时）产生 Invalid Date 导致 TypeORM 500，**非空态逻辑缺陷**。空态逻辑（`entitlement.service.ts:170-190`）本就返 200：

```json
{ "period": {...}, "requests": 0, "items": [], "cursor": "0", "cost_cents": 0 }
```

与贵方期望一致。

### 修复

commit `edcf4ca`（2026-09-09 06:08 UTC）：新增 `parseDate()` 校验（`entitlement.controller.ts:20-30`），缺参/非法 → 400 `INVALID_ARGUMENT`（RFC 7807 结构化错误，非 500）：

```typescript
function parseDate(value: string | undefined, field: string): Date {
  if (!value) {
    throw new ContractError(400, 'INVALID_ARGUMENT', `${field} is required (ISO 8601)`);
  }
  const d = new Date(value);
  if (isNaN(d.getTime())) {
    throw new ContractError(400, 'INVALID_ARGUMENT', `${field} must be a valid ISO 8601 date`);
  }
  return d;
}
```

### 服务端实测确认

```
GET /v1/entitlement/workspaces/<ws>/usage （缺 period_start/period_end）
→ HTTP 400
{
  "type": "about:blank",
  "title": "period_start is required (ISO 8601)",
  "status": 400,
  "detail": "period_start is required (ISO 8601)",
  "instance": "/v1/entitlement/workspaces/.../usage",
  "request_id": "e4-1788936736260325903",
  "error_code": "INVALID_ARGUMENT"
}
```

贵方 E4 对账 job 每 5 分钟增量拉取不再触发 500。**请贵方将 E4 客户端对齐权威新形态**（path workspaceId + `period_start`/`period_end`/`cursor`/`limit`），旧 `from`/`to` 形态已废弃（详见 §6.3 修订记录）。

---

## 三、E1-E6 / K1-K4 / S15 / D1-D3 — 服务端全量 20 PASS / 0 FAIL ✅

服务端执行 `bash scripts/deploy-fix.sh`（commit `fcd7820`），全量契约验证结果：

### K 线（gateway keys）6/6 ✅

| 步骤 | 实测 |
|---|---|
| K1 签发（新 workspace） | 201 |
| K1 幂等重取（existing True） | 201 |
| K2 validate 有效 key | 201 `valid=True` |
| K3 revoke（存在 key） | 201 |
| K3 revoke（无效 key_id） | 404 |
| K4 rotate | 201 |

### E 族（entitlement）10/10 ✅

| 端点 | 实测 |
|---|---|
| E1 plans | 200 |
| E1 plan（query 别名） | 200 |
| E2 catalogs | 200 |
| E3 quotas | 200 |
| E4 usage | 200（空态返 `{requests:0, items:[], cursor:"0"}`） |
| E5 capabilities | 200 |
| E6 activate | 201 |
| E7 llm-config（非 UUID） | 400 `INVALID_ARGUMENT` |
| E7 llm-config（不存在 org） | 404 `LLM_CONFIG_MISSING` |
| L2 usage-records | 201 |

### 订单面（S15 + D1-D3）4/4 ✅

| 端点 | 实测 |
|---|---|
| S15 revneg-start（假 order） | 404 |
| D1 decide（错误字段 option） | 400 |
| D2 respond（错误字段 decision） | 400 |
| D3 auto-resolve（错误字段 resolution） | 400 |

### DB 残留确认 3/3 = 0 ✅

| 残留项 | 实测（期望 0） |
|---|---|
| negotiation 033b4135 | 0 |
| bid dd8730b0 | 0 |
| **d104 探针订阅** | 0（已清理） |

### 关键修复链（`fcd7820`）

| 步骤 | 内容 | 关键证据 |
|---|---|---|
| 5.55 步 | 预置 `beta-free` 套餐（`ON CONFLICT code` 幂等 INSERT） | plan id `e8863ad8-00d6-4c2b-b746-8af7d51f5202`，status=active |
| 5.6 步 | 激活 test org `e001` 订阅 | subscription id `bab50ef2-37e1-40c5-b931-807bc56416d7`，periodEnd 2026-10-09 |
| post-deploy-verify.sh | E 族段开头先幂等激活 e001，再跑 E1/E2/E3 | E1 返 `{code:"beta-free", free_quota_remaining:1000000, ...}` |

> 此前 5.6 步激活返 404 `ENTITLEMENT_PLAN_NOT_FOUND` 的根因是 DB 无 `beta-free` plan；5.55 步预置后激活即成功。

---

## 四、L 族 AI Token — 待贵方提供 OneLLM key 注入

### 现状

L1-L3 返 409 `LLM_CONFIG_MISSING`（`llm-proxy.service.ts:71,95`）**符合 BYOK 设计**：org 无 `user_llm_configs` 行即 409，提示"尚未配置 AI Token"。E5 自报 `byok:true` = Bring Your Own Key。

### 配置渠道（两选一）

**方案二（OneLLM，推荐）**：贵方在 `https://onellm.opennotebook.chat/portal/home` 购买 token 套餐并创建 key，回填到我方 `POST /api/v1/entitlement/portal/my/llm-config`（用户 JWT 鉴权，body: `base_url`+`api_key`）。

**方案一（自有网关）**：贵方若有自有 OpenAI 兼容网关，同入口回填 `base_url`+`api_key`。

### 服务端注入（联调期）

我方已在 `deploy-fix.sh` 5.5 步脚本化服务端直接 INSERT（AES-256-GCM 加密，与 app 同口径 `SHA256(TOKEN|gateway-key-enc)` 派生密钥）。注入后 test org `e001` 即配好 AI Token，L1-L3 可走真实链路：

```bash
LLM_API_KEY=<贵方 OneLLM key> LLM_BASE_URL=https://onellm.opennotebook.chat/v1 \
  bash scripts/deploy-fix.sh
```

**请贵方提供 OneLLM key 真值**（线下交换），或确认走方案二自行回填。

---

## 五、d104 残留 — 已清理 ✅

贵方第五节披露的假 org `00000000-…d104` 经 E6 真实激活的 beta-free 订阅，我方无责旁贷，已在 deploy-fix.sh 第 5 步清理：

```sql
DELETE FROM entitlement_free_grants WHERE org_id = '00000000-0000-0000-0000-00000000d104';
DELETE FROM org_subscriptions    WHERE org_id = '00000000-0000-0000-0000-00000000d104';
```

服务端实测：`d104 探针订阅残留: 0`（期望 0）。`post-deploy-verify.sh` 同步增补 `d104` 核查项。

---

## 六、§6 回写 + 4 处修订 — 已推送

| commit | 内容 |
|---|---|
| `23ed890` | §6 回写 9 项定案（base URL / HMAC 鉴权 / E1-E6+K1-K4+L1-L3 路径映射 / org_id 测试值 / CNY 整数分计价 / E4 增量游标语义 / K1-K4 key 生命周期 / RFC 7807 错误码清单 / D1-D6 预置责任 / wire drift additive 差异） |
| `e3cd8e7` | 按贵方 §13 核验修订 4 处与线上不符 |

### 4 处修订明细

1. **§6.4 org_id 类型**：原声明 varchar/无 UUID 约束与线上 `requireUuid()` 矛盾 → 改方案② UUID 测试值 `00000000-0000-4000-8000-00000000e001`（含套餐）/ `…e002`（无套餐）；补 plan_code=`beta-free`（env `ENTITLEMENT_DEFAULT_PLAN` 驱动，非字面 `free`）

2. **§6.8 错误结构**：`Rfc7807Filter` 全局输出 RFC 7807（`error_code`/`title`/`detail`），声明以此为准，贵方所引 `{status,code,message}` 系原稿旧稿；`LLM_CONFIG_MISSING` 补双状态码 404(E7 GET)/409(L1/L2 调用路径)，原清单漏 409；`INVALID_ARGUMENT` 已在 VALIDATION 族（400）

3. **§6.3 路径并存澄清**：
   - E4 旧 `from`/`to` 形态已废弃（`edcf4ca` 后 query 别名仅 `period_start`/`period_end`，缺参→400，重部署后不再 500）
   - E5 已登记返能力对象（原 spec 标"⏳"系版本差）
   - E6 补 `free-quota/activate` 形态 + plan_code=`beta-free`
   - K3 别名澄清为 body 形态 `POST /v1/keys/revoke`（key_id 在 body，非 path；贵方测 `POST /v1/keys/:id/revoke` 返 404 属预期）

4. **org_id 双形态校验**：确认 `requireUuid()` 在 path(`:orgId`) 和 query(`?org_id=`) 双形态均生效，无需额外动作。

---

## 七、我方就绪状态

### 代码侧（全部已推送 `origin/main`，HEAD `fcd7820`）

| 项 | commit | 状态 |
|---|---|---|
| E4 修复（parseDate） | `edcf4ca` | ✅ 服务端验证生效（400） |
| §6 回写 9 项定案 | `23ed890` | ✅ 已落档 |
| deploy-fix.sh 增补 AI Token/激活/全量验证 | `b109716` | ✅ |
| §6 修订 4 处 + 脚本测试值统一 | `e3cd8e7` | ✅ |
| d104 残留清理脚本 | `3e8f002` | ✅ 服务端验证（残留 0） |
| E1/E2/E3 顺序 bug 修复 | `fce9599` | ✅ |
| 5.55 预置 beta-free plan | `fcd7820` | ✅ 服务端验证（激活 201） |

### 服务端（122.51.51.177:4001）

- 20 PASS / 0 FAIL 全量契约验证通过
- E4 修复生效（400 INVALID_ARGUMENT）
- d104 探针订阅已清理（残留 0）
- test org `e001` 已激活 beta-free 订阅（periodEnd 2026-10-09）

### 等待贵方

1. **L 族 OneLLM key 真值**（线下交换）——解锁 L1-L3 真实链路（阶段 2）
2. **E4 客户端对齐权威新形态**（path workspaceId + `period_start`/`period_end`/`cursor`/`limit`）——旧 `from`/`to` 形态已废弃

收到 OneLLM key 后我方即注入 test org `e001`，L 族端到端打通，贵方 CSI 业务链（商机→智能体→执行）全通。

---

此致

Marketplace 团队

---

**附：服务端执行命令（供贵方复核）**

```bash
cd /home/ubuntu/csi-agent-project-new/CSI-agent-project && \
git fetch origin && git reset --hard origin/main && \
bash scripts/deploy-fix.sh 2>&1 | tee /tmp/deploy-$(date +%s).log
```

（注入 L 族 AI Token 时：`LLM_API_KEY=<key> LLM_BASE_URL=https://onellm.opennotebook.chat/v1 bash scripts/deploy-fix.sh`）

**附：相关文件**

- `csi-longtask business-docs/design/CSI-LLM-Gateway-Billing-Team-Requirements-§6-回写区.md`
- `scripts/deploy-fix.sh`
- `scripts/post-deploy-verify.sh`
- `backend/src/entitlement/entitlement.controller.ts`（E4 修复）
- `backend/src/llm-proxy/llm-proxy.service.ts`（L 族 409 路径）
