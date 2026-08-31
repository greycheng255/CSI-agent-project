# 长任务平台侧 — T14 Workspace 展示页 端到端测试验证报告

> **范围**：T14（PRD §5.6.7 AI 工作室展示页）前端补全 + 页面→API→数据库全链路 E2E 验证
> **测试日期**：2026-08-27
> **环境**：前端 Vite（:5173）→ 代理 → 后端 NestJS（:4000）→ 远端 PostgreSQL（122.51.51.177:15435/genesis_db，项目 .env 配置）
> **结果**：✅ 通过

---

## 1. 交付物

| 文件 | 说明 |
|---|---|
| `frontend/src/api/longtaskApi.ts` | 展示页 API 助手（按 slug/id 查询；pg numeric 归一处理） |
| `frontend/src/pages/WorkspaceShowcase.tsx` | 展示页：品牌头（头像/名称/新店徽章）、公告横幅、简介、案例卡（公开/仅评审可见）、能力标签、服务承诺、信用数据（脱敏 + 平台自动生成标注）、冻结/暂停警示、加载骨架、错误态 |
| `frontend/src/App.tsx` | 路由 `/longtask/workspaces/:slug`（懒加载，雇主公开可见） |
| `backend/workspaces.controller/service`（扩展） | PATCH showcase 支持 `serviceCommitments` 写入 |
| `backend/scripts/longtask-schema-sync.js` | 长任务 13 张表幂等 DDL（远端 PG 落库，不触碰短任务既有表） |
| `backend/scripts/longtask-e2e-seed.js` | E2E 种子：清理旧数据 → 真实 API 创建/更新 → 模拟平台 job 写信用数据 → API↔DB 一致性断言 |

## 2. 数据流转链路（页面功能点 → 业务 → 落库）

```
① 创建 Workspace（POST /api/v1/longtask/workspaces，真实 API）
② 更新展示页（PATCH .../showcase：3 案例/公告/3 服务承诺）
③ 模拟平台 job 写信用数据（pg UPDATE：完成任务 12/评分 4.7/按时率 0.93/纠纷率 0.02）
④ 页面加载（GET .../slug/starcraft-ai）→ 渲染 6 大模块
⑤ 数据库落库核验：API 回读与 pg 行值逐项比对（7 项全 PASS）
⑥ 无效 slug → 错误态（不崩溃）
⑦ 新店分支：完成任务 0 → 「新店」徽章 + 三个空态渲染
```

**API↔DB 一致性断言结果**：id / name / slug / announcement / completedTasksCount / avgRating / cases 共 7 项全部 PASS（中文 UTF-8 无损）。

## 3. 浏览器端到端验证（截图 + DOM + 控制台三重核验）

### 3.1 正常数据页（starcraft-ai，完成任务 12）

| 检查项 | 结果 |
|---|---|
| 名称「星辰 AI 工作室」+ @starcraft-ai | ✅ PASS |
| 徽章「资深工作室」（12≥3，无「新店」） | ✅ PASS |
| 首页公告横幅 | ✅ PASS |
| 能力标签 ×3（电商文案/SaaS 官网/数据分析报告） | ✅ PASS |
| 服务承诺 ×3（24h 响应/2 次修订/14 天退款保障） | ✅ PASS |
| 历史交付案例 ×3（含「仅评审可见」案例） | ✅ PASS |
| 信用数据 4 指标（12 / 4.7 / 93% / 2%） | ✅ PASS |
| 底部「平台自动生成、不可修改」说明 | ✅ PASS |

### 3.2 新店分支（fresh-studio，完成任务 0）

| 检查项 | 结果 |
|---|---|
| 「新店」徽章显示，且无「资深工作室」 | ✅ PASS |
| 无公告时不渲染公告模块 | ✅ PASS |
| 能力标签 / 服务承诺 / 案例 三处空态文案 | ✅ PASS |
| 信用数据全 0（0 / 0.0 / 0% / 0%） | ✅ PASS |

### 3.3 异常分支

无效 slug `/not-exists-slug` → 「无法查看该 AI 工作室」错误态 + 返回首页按钮，无崩溃 ✅

### 3.4 控制台

- 两页均 **0 条 ERROR**；仅 React Router v7 future-flag 提示 2 条 warn（框架弃用提示，非业务错误）。

## 4. 质量门（代码侧）

| 门 | 结果 |
|---|---|
| 后端单元测试 `npx jest longtask` | ✅ 22 套件 / 144 用例（workspaces 新增服务承诺写入用例） |
| 前端 `npm run build`（tsc -b + vite build） | ✅ 0 error |
| 后端 `npm run build` | ✅ 0 error |
| 远端 PG 长任务表落库（DDL 幂等执行） | ✅ 13 表 exists=true |

## 5. 遗留说明

- 演示数据保留在远端 PG：`starcraft-ai`（完整展示数据）、`fresh-studio`（新店空态）；slug 唯一约束下重跑种子脚本会自动清理重建。
- 「仅评审可见」案例当前按展示层文案控制；正式鉴权（评审员可见性）随 Phase 1 竞标阶段的雇主侧权限落地。
- 展示页入口挂 `/longtask/workspaces/:slug`；从竞标列表点击 Workspace 名称跳转的入口随阶段二前端任务接入。

## 6. 结论

T14 **通过验收**：页面按现有设计语言（Tailwind + CSS 变量 + card-cs 组件风格）完成 6 大模块渲染，业务逻辑（新店阈值、脱敏信用指标、空态、错误态、案例权限标签）经浏览器端到端验证全部正确，页面→API→数据库数据流转一致，控制台零报错。