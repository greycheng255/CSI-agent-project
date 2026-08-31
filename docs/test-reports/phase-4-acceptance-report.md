# 长任务平台侧 — 阶段四（验收闭环）测试验证报告

> **阶段**：阶段四 验收闭环（T17~T19 + T19b，第二批）
> **测试日期**：2026-08-27
> **依据**：longtask-platform-execution-plan.md v1.1 §4 阶段四 · longtask-platform-implementation-plan.md v1.0 §4
> **结果**：✅ 通过（平台侧按契约文本先行开发；真实联调待 Console M4 闭合 + M5）

---

## 1. 阶段目标

场景五（交付验收 + 14 天计时）+ 场景六（修订协商 2 天默认 C）+ 场景七（Spec 变更）+ 场景八完整链路（counter_proposal 放开）。

## 2. 验收结论（对照 T17~T19 + T19b）

| 编号 | 任务 | 验收标准 | 结论 |
|---|---|---|---|
| T17 | 场景五（deliverables + 14 天验收 + 催办） | 三条硬约束全满足才自动验收（PRD §9.4） | ✅ 通过（硬约束由 Console Gates 保证；平台按计时触发 auto_accepted；5/9/13 天三级催办窗口纯函数） |
| T18 | 场景六（修订协商 2 天 + 4 选项默认 C） | 超时默认 C；写入 7 天 `after_sale_deadline` | ✅ 通过 |
| T19 | 场景七（Spec 变更 series） | Spec version+1；幂等 `UNIQUE(project_id, change_seq)` | ✅ 通过（UNIQUE(order_id, change_seq)） |
| T19b | 场景八完整链路（counter_proposal 部分结算） | M5 后反提案分支生效；投递 cancel-counter-response | ✅ 通过（T16b 的 422 骨架按 M5 放开口径替换为反提案受理） |

## 3. 交付物清单

| 文件 | 说明 |
|---|---|
| `marketplace-orders/delivery.entity.ts` | 交付物记录（UNIQUE(order_id, submission_seq)、14 天 accept_deadline） |
| `marketplace-orders/delivery-reminders.ts` | 5/9/13 天催办纯函数 |
| `marketplace-orders/delivery-contract.service.ts` | 提交交付物 + 验收（accepted/rejected/revision_requested）+ 14 天自动验收 + 售后 7 天 + 修订超限联动协商 |
| `marketplace-orders/negotiation.entity.ts` + `revision-negotiation.service.ts` | 2 天协商窗口 + 4 选项 + 超时默认 C（写 after_sale_deadline） |
| `marketplace-orders/spec-change.entity.ts` + `spec-change.service.ts` | 变更请求（#18 启动 24h 判定）/ classify（#19，new_requirement→#20 二次确认）/ propose/confirm（version+1）/reject |
| `cancel-skeleton.service.ts`（更新） | counter_proposal 放开：`counter_proposed` 状态 + 投递 `cancel-counter-response`（#27） |
| `contract/marketplace-contract.controller.ts`（更新） | +7 端点：deliverables / negotiation start+decide / classify / spec-changes×3 |

## 4. 测试执行结果

```
命令：npx jest longtask（阶段一~四全量）
结果：Test Suites: 19 passed, 19 total；Tests: 126 passed, 126 total
构建：npm run build ✅（0 error）
```

新增用例：delivery-reminders（4）+ delivery-contract（7）+ revision-negotiation（5）+ spec-change（8）+ 控制器新增 3。

关键断言：
- **14 天验收计时**：`acceptDeadline - submittedAt = 14d` 精确断言；到期 → `delivery.auto_accepted` + 订单 accepted + `after_sale_deadline` ✅
- **催办**：第 5/9/13 天各自整天窗口触发一次，错过窗口不重复（防重复骚扰）✅
- **修订超限进协商**：submission_seq ≥ revision_limit(2) 时 `negotiation.start(orderId, 'revision_exhausted')` ✅
- **2 天窗口**：deadline ≈ now+2d；到期 → decision C + `expired_default_c` 事件 + 售后 7 天 ✅
- **协商 C 决策**：订单强制 accepted + 售后申诉期（PRD 7.7.3 设计理由：保护 Agent Owner 劳动成果）✅
- **Spec 变更确认**：`specVersion 3 → 4`；重复 confirm 幂等不再 +1 ✅
- **counter_proposal 放开**：状态 `counter_proposed` + 投递 #27 `cancel-counter-response` ✅

## 5. 遗留与未决项

| 项 | 说明 | 处置 |
|---|---|---|
| 14 天自动验收三条硬约束 | PRD §9.4 的 G1/G2/G3/G6 约束在 Console 侧判定；平台按计时触发 | 联调时以 Console 确认稿为准 |
| revision_limit 精确口径 | 当前取默认 2 + submission_seq 计数，Spec 内 revision_limit 字段落地后对齐 | 联调前与 Console 对齐 |
| 里程碑部分结算数据 | counter_proposal 生效后的部分结算金额计算归阶段五（verified_passed 口径） | T20 承接 |
| 真实 Console 联调 | 场景五~七 + 场景八完整链路等 Console M4 闭合 + M5 | 第二批联调点 |

## 6. 结论

阶段四（T17~T19 + T19b）**通过验收**。平台侧验收域能力已按契约文本先行交付；下一阶段五（结算与仲裁，涉资金最后接）。