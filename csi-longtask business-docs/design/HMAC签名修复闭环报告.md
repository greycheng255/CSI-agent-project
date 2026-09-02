# HMAC 签名联调修复闭环报告（Marketplace 团队 → Console 团队）

日期：2026-09-02　｜　关联：TS L1770 编码注记、Console 复测反馈（含提交 `50991903c`）、清单 v2 答复文档

## 一、结论

**第一批启动条件全部就绪，无遗留阻断项。** HMAC 鉴权链两轮联调发现的全部差异已闭环：编码口径（hex）双方已对齐，GET 空 body 派生已修复，POST 真原文已加固，`employer-mentions` 归属校验已补。

## 二、差异闭环清单（共 3 项）

| # | 差异 | 责任方 | 处置 | 状态 |
|---|------|--------|------|------|
| 1 | 签名输出编码：base64 vs hex | M 侧 | `digest('base64')` → `digest('hex')`（TS L1770 已补澄清注记，GitHub/Stripe 惯例） | ✅ 双方复测通过 |
| 2 | GET/无 body 派生：`'{}'` vs 空串 | M 侧 | 守卫改为 raw body 真原文优先，无 body = 空串（契约语义）；并顺带以 body-parser `verify` 捕获原文 Buffer，消除 re-serialization 差异（Go JSON HTML 转义 `\u003c` 风险） | ✅ 已修复并现网复测 |
| 3 | `employer-mentions` 对不存在订单误返 201 | M 侧 | 接入订单存在性校验：不存在 → `404 NOT_FOUND_ORDER`（RFC 7807） | ✅ 已修复并复测 |

三项责任方均为 M 侧（Console 复测定位准确，据此快速闭环）。

## 三、复测证据（M 侧现网实例，2026-09-02）

| 探测 | 结果 | 判定 |
|------|------|------|
| GET + 空串签名（契约口径，即 Console pull 口径） | 过 HMAC 门，进入业务态（404 业务态，非 401） | ✅ |
| GET + `'{}'` 签名（旧派生口径） | `401 AUTH_HMAC_SIGNATURE_MISMATCH` | ✅ 旧口径已拒 |
| POST + 真原文签名（usage-records） | `201 {"recorded":1}` | ✅ |
| POST + 篡改签名 | `401 AUTH_HMAC_SIGNATURE_MISMATCH` | ✅ 负向用例 |
| `employer-mentions` + 不存在订单 | `404 order not found: …` | ✅ |
| 全量回归 | 42 套件 / 232 用例通过（含新增派生与校验用例） | ✅ |

## 四、探测数据说明（请 Console 侧处理）

M 侧 `employer-mentions` 端点本就不落库（仅回执 echo），贵方探测记录（order `00000000-…`、mention 内容 "joint-debug probe"）**未写入 M 侧库**（`marketplace_orders` 无该订单），请贵方在自身侧清理。

## 五、契约口径最终版（双方文档已同步）

```
X-Signature: t=<unix_ts>,v1=<hmac_sha256(body原文 + ts)>

- 编码：hex，64 位小写（TS L1770 2026-09-02 注记）
- body 原文口径：
  - GET / DELETE / 无 body 请求 = 空串（非 "{}"）
  - POST / PUT = 请求体真原文（raw body），不依赖 re-serialization
```

已同步位置：TS L1770 注记（Console `50991903c`）、M 侧集成指南、skill 勘误、employer-integration-api、双侧实现（M 侧 `hmac.guard.ts` + `main.ts`；Console 侧 signer）。

## 六、后续动作

1. Console 侧 5min 定时 pull 按新口径（GET 空串签名）自动恢复，无需 M 侧配合；若仍被拦请确认 pull 进程签名口径。
2. 双向复测（出向 M→C 投递 + 入向 C→M 调用）通过后，第一批启动条件正式闭账。
3. 测试注意事项存档：`entitlement_usage_records` 的 `workspace_id` / `agent_run_id` 为 uuid 列，测试 payload 须传合法 UUID，否则在验签通过后的业务层报 PG `22P02`（500），勿误判为签名问题。
