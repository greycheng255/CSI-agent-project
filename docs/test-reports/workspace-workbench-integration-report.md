# 平台侧 — 「AI 工作室」工作台落位改造 · 阶段性测试验证回归报告

> **阶段性质**：概念点落位改造——AI 工作室不再作为独立导航/独立页面，全部功能点落到现有「工作台」页面体系
> **日期**：2026-08-27
> **依据**：longtask-platform-execution-plan.md v1.1（D1 改造语义）· longtask-platform-implementation-plan.md v1.0 §0.2
> **结果**：✅ 通过

---

## 1. 改造目标

| 概念点 | 落位（工作台体系内） |
|---|---|
| 工作室主体 | 工作台「我的工作室」（/workspace）：Agent Owner 用户的业务主体页 |
| 门面编辑（简介/能力标签/服务承诺/公告/案例） | 工作台管理面「门面信息」表单 → PATCH showcase |
| 信用数据 | 工作台只读卡片（平台自动计算，标注不可修改） |
| 名下 Agent | 工作台「名下 Agent」区块（短任务 agentMarket 归属工作室） |
| 店铺门面 | 工作台头部「查看店铺门面」→ 公开展示页（雇主视角） |

**导航回归**：顶导航移除上一轮临时新增的「AI 工作室」入口，恢复为 首页/智能体广场/智能体集市/任务大厅/发布任务/API 文档。

## 2. 代码变更清单

| 文件 | 变更 |
|---|---|
| `frontend/src/layouts/MainLayout.tsx` | 移除 publicNav「AI 工作室」入口（回归） |
| `frontend/src/config/workbenchNavigation.ts` | userWorkbenchNavigation 新增「我的工作室 /workspace」（概览之后） |
| `frontend/src/pages/MyWorkspace.tsx` | 新：工作台管理面（开通引导/信用只读/门面表单/案例管理/名下 Agent/门面预览入口） |
| `frontend/src/App.tsx` | `/workspace` 归于 WorkbenchLayout；`/longtask/workspaces/mine` 重定向至 `/workspace`；by-owner 保留（Agent 详情跳转用） |
| `frontend/src/api/longtaskApi.ts` | 新增 `createWorkspace` / `updateWorkspaceShowcase` |
| `backend/…/workspaces.service.ts` + `controller.ts` | PATCH showcase 支持 `bio` 更新（门面简介） |
| `backend/…/workspaces.service.spec.ts` | 新增 bio 更新断言 |

## 3. 测试验证

### 3.1 代码质量门

| 门 | 结果 |
|---|---|
| 后端全量回归 `npx jest` | ✅ 36 套件 / 175 用例（含既有短任务线全部套件，零破坏） |
| 前端 `npm run build`（tsc -b + vite） | ✅ 0 error |
| 后端 `nest build` | ✅ 0 error |

### 3.2 数据流转验证（工作台保存 → API → 落库）

`scripts/longtask-workbench-save-verify.js`：PATCH showcase（bio/公告，模拟工作台「保存门面」）→ slug 回读 → PG 落库比对：

```
PASS bio 一致（API = DB = "专注企业官网…（工作台编辑版简介）。"）
PASS 公告一致（API = DB = "工作台保存验证：本周可承接 3 个官网类新任务。"）
```

### 3.3 浏览器端到端（登录态注入 → 工作台管理面）

（注入既有用户 b8fb3908 登录态）逐项核验：

| 检查项 | 结果 |
|---|---|
| 顶导航不再出现「AI 工作室」 | ✅ PASS |
| 工作台侧栏出现「我的工作室 · AI 工作室门面与资产」 | ✅ PASS |
| 管理面：名称「星辰 AI 工作室」+ @starcraft-ai | ✅ PASS |
| 信用数据 12 / 4.7 / 93% / 2%（只读 + 平台自动计算标注） | ✅ PASS |
| 门面表单预填回显：简介/能力标签/公告/3 条服务承诺/3 个案例 | ✅ PASS |
| 「保存门面」按钮 + 「查看店铺门面」链接 + 「名下 Agent」区块（含 2 个 Agent） | ✅ PASS |
| 公共展示页回归：名称 + 更新后公告「工作台保存验证：…」+ 案例 3 个 | ✅ PASS |
| 三个页面控制台 ERROR | ✅ 0 条（仅 React Router future-flag warn ×2） |

## 4. 回归对比（对照执行方案）

| 基线 | 结论 |
|---|---|
| T14 展示页（PRD §5.6.7） | ✅ 展示页保持可用；管理面由孤页迁入工作台 |
| D1 改造语义（workspaces.owner_user_id → users） | ✅ 保持有效，工作台按 owner 加载工作室 |
| D2 双线独立 | ✅ 短任务线 36 套件全量回归零破坏 |
| 既有工作台导航 | ✅ 只增「我的工作室」一项，原 6 项与账户区不变 |

## 5. 遗留与下一步

1. **入驻自动开通**：用户注册/升级 Agent Owner 时自动建默认工作室（当前工作台「立即开通」按钮已可手动开通，slug 规则 `u-<userId10>`）。
2. **Agent 归属贯通**：「我的 Agent」页加入工作室视角（当前「名下 Agent」列表已按 owner 取数）。
3. **信用数据平台 job**：四指标改由定时任务计算写入（当前演示数据为手工写入）。
4. **真机登录验收**：本轮浏览器验证采用注入登录态；建议以真实账号登录验收一次完整路径。

## 6. 结论

AI 工作室概念点已全部落位到现有工作台体系：导航回归、工作台管理面上线（门面/信用/名下 Agent/店铺预览），数据流转与展示页联动验证通过，全量回归零破坏。