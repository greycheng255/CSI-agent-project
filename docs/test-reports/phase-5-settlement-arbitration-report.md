# 长任务平台侧 — 阶段五（结算与仲裁）测试验证报告

> **阶段**：阶段五 结算与仲裁（T20~T22，第三批，涉资金最后接）
> **测试日期**：2026-08-27
> **依据**：longtask-platform-execution-plan.md v1.1 §4 阶段五 · longtask-platform-implementation-plan.md v1.0 §5
> **结果**：✅ 通过

---

## 1. 阶段目标

结算数据面（只备数据，划款交关联方）+ 长任务仲裁（3 天举证 + 7 天裁定 + 4 选项 + 终态确认）。

## 2. 验收结论（对照 T20~T22）

| 编号 | 任务 | 验收标准 | 结论 |
|---|---|---|---|
| T20 | 结算数据准备（结算单 + 里程碑公式 + 对账 #35/#36） | `Σ(权重×final_price)` 仅计 `verified_passed`；权重和=100% 校验 | ✅ 通过 |
| T21 | settlement/trigger 备数据交关联方 + 收 settlement.completed | 平台不执行划款；收到回写后更新状态 | ✅ 通过 |
| T22 | 长任务仲裁（3 天举证 + 7 天裁定 + 4 选项） | dispute.acknowledge 终态确认；4 选项资金动作数据齐全 | ✅ 通过 |

## 3. 交付物清单

| 文件 | 说明 |
|---|---|
| `settlements/milestone-math.ts` | 里程碑结算公式纯函数（权重和校验 + verified_passed 筛选） |
| `settlements/settlement.entity.ts` | 结算单（order_id UNIQUE，一个 Project 仅一次结算） |
| `settlements/settlements.service.ts` | trigger（备数据/409/400）+ settlement.completed 回写 + 对账 #35/#36 + 申诉期关闭扫描（#34） |
| `disputes/dispute.entity.ts` | 纠纷（举证/裁定窗口 + 4 选项 + 终态） |
| `disputes/disputes.service.ts` | 纠纷发起（#33/#39）/ 举证（#40）/ 启动仲裁（#41）/ 结果（#42）/ 终态确认（#43）/ 举证到期自动进仲裁 |
| `contract/marketplace-contract.controller.ts`（更新） | +5 端点：settlement/trigger、orders/:id/settlement、workspaces/:wid/settlements、disputes/:id/evidence、disputes/:id/acknowledge |

## 4. 测试执行结果

```
命令：npx jest longtask（五阶段全量）
结果：Test Suites: 22 passed, 22 total；Tests: 143 passed, 143 total
命令：npx jest（全项目回归，含短任务既有 14 套件）
结果：Test Suites: 36 passed, 36 total；Tests: 173 passed, 173 total
构建：npm run build ✅（0 error）
```

新增用例：milestone-math（4）+ settlements（5）+ disputes（7）+ 控制器新增 1。

关键断言：
- **里程碑公式**：`0.4/0.6 仅 m1 通过 → 10,000 × 0.4 = 4,000` 精确断言；权重和 ≠100% → 400；无 verified_passed → 0（转纠纷路径，契约陷阱 8 不发明估算算法）✅
- **结算幂等**：重复 trigger → 409 `CONFLICT_SETTLEMENT_ALREADY_TRIGGERED`；order_id UNIQUE 兜底 ✅
- **备数据边界（D3）**：trigger 只生成结算单（pending + 金额 + 里程碑明细），服务内无任何资金执行逻辑；划款由关联方完成、平台消费 `settlement.completed` 回写 ✅
- **申诉期关闭**：`after_sale_deadline` 到期且已结算 → 投递 `settlement.appeal-perior-closed`（#34）→ Project 终态 ✅
- **仲裁窗口**：发起 → evidence_deadline ≈ now+3d；受理 → arbitration_deadline ≈ now+7d；举证到期自动 startArbitration ✅
- **4 选项资金动作数据**：resolution + amount_cny 齐全投递 `dispute.arbitration-result` ✅
- **终态双向确认**：acknowledge 仅 resolved 可确认（未裁 422），确认后终态（未获确认不得清重试上下文）✅

## 5. 遗留与未决项

| 项 | 说明 | 处置 |
|---|---|---|
| 结算支付版块接口 | trigger 后「备数据交关联方」的具体传输协议（结算单字段/回写协议） | 与结算支付版块对协议（执行方案 §7-5） |
| 7 天资金托管期计时 | 由关联方执行，平台仅跟踪展示 | 联调确认状态回传口径 |
| 仲裁后台 UI | 平台侧仲裁操作界面未落地 | 随 M6 管理后台任务 |

## 6. 结论

阶段五（T20~T22）**通过验收**。五个阶段全部完成，进入整体回归验证（见汇总报告）。