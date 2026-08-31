# 长任务平台侧 — 阶段三（签约闭环）测试验证报告

> **阶段**：阶段三 签约闭环（T15/T16/T16b，第一批尾）
> **测试日期**：2026-08-27
> **依据**：longtask-platform-execution-plan.md v1.1 §4 阶段三 · longtask-platform-implementation-plan.md v1.0 §3
> **结果**：✅ 通过

---

## 1. 阶段目标

场景四（Spec 签订）三向联动 + Spec 超时 7 天重开 + 场景八协商取消骨架（counter_proposal 固定 422）。

## 2. 验收结论（对照 T15/T16/T16b）

| 编号 | 任务 | 验收标准 | 结论 |
|---|---|---|---|
| T15 | 场景四三向联动（employer-mentions / spec / 雇主确认） | Spec 提交启动 7 天计时；spec_hash 仅记录不重算 | ✅ 通过 |
| T16 | Spec 超时 7 天重开 | 订单取消 + `spec.timeout` + 任务 `bid_round+=1` 席位清零 | ✅ 通过（taskService.reopenBidding 联动） |
| T16b | 场景八骨架联调（#24-#30 事件收发） | 正确处理 `422 COUNTER_PROPOSAL_UNSUPPORTED`（M5 放开） | ✅ 通过 |

## 3. 交付物清单

| 文件 | 说明 |
|---|---|
| `marketplace-orders/spec-contract.service.ts` | submitSpec（权重和=100% 校验 + 7 天计时 + 超时注册）/ employerAction（confirmed/rejected + 驳回计数）/ scanSpecTimeouts（到期重开）/ notifyEmployerReply |
| `marketplace-orders/cancel-request.entity.ts` | 协商取消请求实体 |
| `marketplace-orders/cancel-skeleton.service.ts` | initiateCancel（#24 触发源）/ respond（counter_proposal 422）/ autoResolve / finalize / toDispute |
| `marketplace-order.entity.ts`（扩展） | 新增 `spec_deadline`（7 天计时持久化）+ `spec_rejection_count`（驳回 5 次联动） |
| `contract/marketplace-contract.controller.ts`（扩展） | +6 端点：employer-mentions / spec / cancel respond / auto-resolve / finalize / to-dispute |

## 4. 测试执行结果

```
命令：npx jest longtask（阶段一~三全量）
结果：Test Suites: 15 passed, 15 total；Tests: 99 passed, 99 total
构建：npm run build ✅（0 error）
```

新增用例：spec-contract.service.spec.ts（8）+ cancel-skeleton.service.spec.ts（9）+ 控制器新增 5。

关键断言：
- **7 天计时窗口**：`specDeadline - now ≈ 7×24h`（容差 5s 内断言）✅
- **里程碑权重和=100%**：`0.4+0.6` 放行；`0.4` 单独 → 400 ✅
- **spec_hash 不重算**：原样存储 `specHash`，无重算逻辑 ✅（口径待 Console 裁决，见遗留项）
- **驳回第 5 次触发协商取消**：`specRejectionCount=5` 时自动调用 `initiateCancel(orderId, 'spec_rejection_limit')` ✅
- **7 天到期**：订单 → cancelled + 投递 `spec.timeout` + `reopenBidding(marketplaceTaskId)` ✅
- **counter_proposal**：422 + `COUNTER_PROPOSAL_UNSUPPORTED`（业务态不告警，M5 放开）✅
- **取消协商结果投递**：finalize → `cancel-resolution(auto_settled)`；toDispute → `cancel-resolution(to_dispute)` ✅

## 5. 遗留与未决项

| 项 | 说明 | 处置 |
|---|---|---|
| spec_hash 计算口径 | 当前「仅记录不重算」，与 Console 的 canonical JSON 口径未终裁 | 联调前与 Console 二选一写入契约（执行方案 §7-2） |
| cancel-requests 路径确认 | `/v1/marketplace/cancel-requests/*` 为建议路径 | 以 `employer-integration-api.md` 实际路径为准，联调前核对 |
| 雇主侧 UI 入口 | confirmed/rejected/mention 回复的平台前端 UI 未落地 | 随第一批前端任务 |
| 通知渠道 | employer-mentions 暂为回显（站内通知接口预留） | 平台基础设施通知服务就绪后接入 |

## 6. 结论

阶段三（T15/T16/T16b）**通过验收**。签约闭环与场景八骨架后端能力就绪，第一批（阶段一~三）全部完成；阶段四（验收闭环）依赖 Console M4 闭合 + M5，按排期为第二批。