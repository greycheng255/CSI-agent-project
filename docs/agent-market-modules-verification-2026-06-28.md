# 智能体集市 OpenNotebook Agent Runs API 接入与验证报告

更新时间：2026-08-29

## 1. 接入结论

智能体集市当前代码目录共有 10 个模块。除 OpenNotebook 公共目录尚未开放的“声音克隆”外，其余 9 个模块已统一使用 `backend/app/api/v1/agent_runs.py` 对外提供的 Public Agent Runs API：

- 目录：`GET /api/v1/agents`
- 提交：`POST /api/v1/agent-runs`
- 状态：`GET /api/v1/agent-runs/{record_id}`
- 鉴权：`Authorization: Bearer <OpenNotebook API Key>`
- 幂等：每次提交发送唯一的 `Idempotency-Key`

旧链路 `POST /api/v1/agent/generate` 和 `GET /api/v1/agent/status` 已从智能体集市调用代码中移除。

请求不再传入以下参数：

- `tenantId` / `tenant_id`
- `userId` / `user_id`
- `X-Tenant-ID`
- `X-User-ID`

工作区 ID 仍然保留，因为 OpenNotebook 的 `AgentRunCreate` 合约要求 `workspace_id`。

## 2. 新请求结构

工作流智能体示例：

```json
{
  "agent": "mindmap",
  "agent_version": "v1",
  "workspace_id": "<workspace-id>",
  "input": {
    "source_material": "待整理的内容",
    "layout": "mindmap",
    "depth": 0
  }
}
```

媒体模型示例：

```json
{
  "agent": "image",
  "agent_version": "v1",
  "workspace_id": "<workspace-id>",
  "model": "gpt-image-2",
  "input": {
    "prompt": "生成一张产品概念图",
    "size": "1024x1024",
    "quality": "auto"
  }
}
```

## 3. 当前模块映射

| 模块 | id | Agent Runs 映射 | 当前状态 |
| --- | --- | --- | --- |
| 语音合成 | `voice` | `agent=speech_synth` | 公共目录已开放 |
| 声音克隆 | `clone` | 无 | 公共 `/api/v1/agents` 尚未提供对应 agent/model，保持不可运行 |
| 视频生成 | `video` | `agent=videoagent` | 已改为公共工作流，不再伪造 Seedance 模型 |
| 配乐生成 | `music` | `agent=music`、`model=suno-v3` | 使用公共目录实际模型 |
| 图片生成 | `storyboard` | `agent=image`、所选图片模型 | 支持 `midjourney`、`gpt-image-2` |
| 速记卡片 | `flashcard` | `agent=flashcard` | 公共目录已开放 |
| 思维导图 | `mindmap` | `agent=mindmap` | 公共目录已开放 |
| 音频播客 | `podcast` | `agent=podcast` | 公共目录已开放 |
| 数字人 | `digihuman` | `agent=digihuman` | 公共目录已开放 |
| 财务发票识别 | `invoice` | `agent=invoice` | 公共目录已开放 |

## 4. 代码调整

### 4.1 API 客户端

文件：`frontend/src/api/agentMarketApi.ts`

- 目录加载合并为带 API Key 的 `GET /api/v1/agents`；该响应同时包含 agents 和 models。
- 提交体转换为 `agent / agent_version / workspace_id / input / model`。
- 每次提交自动生成 `Idempotency-Key`。
- 轮询改为 `GET /api/v1/agent-runs/{record_id}`。
- 兼容解析 `id`、`record_id`、`run_id` 以及 `output` 等响应字段。
- 移除租户 ID、用户 ID 和相关请求头。

### 4.2 运行页与集市页

文件：

- `frontend/src/pages/AgentMarketHub.tsx`
- `frontend/src/pages/AgentRun.tsx`

调整内容：

- 集市目录请求统一携带 OpenNotebook API Key。
- 运行设置仅保留工作区 ID。
- 页面不再显示或缓存租户 ID、用户 ID。
- 状态轮询和结果展示适配 Agent Runs 记录。

### 4.3 模块能力映射

文件：

- `frontend/src/data/agentMarketCatalog.ts`
- `frontend/src/features/agent-market/plugins/registry.tsx`
- `frontend/src/features/agent-market/plugins/video.tsx`
- `frontend/src/features/agent-market/plugins/music.tsx`

调整内容：

- 视频生成改为 `videoagent` workflow。
- 视频参数恢复为公共目录实际 schema：`video_type`、`prompt`、`resolution`、帧 URL、`size`、`duration`、`shot_type`、`reference_urls`、`audio`。
- 配乐模型改为公共目录实际返回的 `suno-v3`。
- 删除前端强行注入的 `kwvideo-v2`、`kwvideo-v2-ref` 和 `suno-v4.5` 目录项。

## 5. 配置

配置示例：

```dotenv
VITE_AGENT_API_BASE=https://api.opennotebook.chat
VITE_AGENT_REST_BASE=https://api.opennotebook.chat/api/v1
VITE_AGENT_OPENNOTEBOOK_REST_BASE=https://api.opennotebook.chat/api/v1
VITE_AGENT_OPENNOTEBOOK_WORKSPACE_ID=<workspace-id>
VITE_AGENT_OPENNOTEBOOK_API_KEY=<onb-api-key>
```

实际 API Key 已写入本机被 Git 忽略的 `frontend/.env`，没有写入源码或本报告。

注意：`VITE_*` 变量会被 Vite 打包进浏览器资源。当前实现符合“浏览器直接调用 OpenNotebook”的现有架构，但生产环境若不能公开此 Key，应改为由 CSI 后端代理请求，并把 Key 放在服务端环境变量中。

## 6. 远端验证

### 6.1 已通过

- 使用 API Key 请求 `GET /api/v1/agents` 成功。
- 返回 9 个可用 workflow agents：`llm_chat`、`mindmap`、`flashcard`、`podcast`、`invoice`、`video_shot_analysis`、`digihuman`、`videoagent`、`speech_synth`。
- 返回 5 个媒体模型：`midjourney`、`gpt-image-2`、`kling-v1`、`suno-v3`、`framedirector-v1`。
- 使用 API Key 请求 `GET /api/v1/agent-runs` 成功，当前列表为空。
- 前端 `npm run build` 通过。

### 6.2 当前阻塞

最小 `mindmap` 提交已到达 OpenNotebook 业务层，但返回：

```text
PRICING_UNAVAILABLE: No active pricing contract is available
```

这表明 API Key 鉴权和 Agent Runs 请求格式已被服务端接受，但当前环境没有有效计价合同，暂时无法创建实际运行记录。需要在 OpenNotebook 中为该 Key 所属账户/工作区启用有效计价合同后，再逐项做完成态验证。

声音克隆仍是服务端能力缺口：公共目录未返回对应 agent/model，不能通过 `/api/v1/agent-runs` 合法提交。需要 OpenNotebook 后端先将声音克隆注册为公共 agent，前端才能接通。

## 7. 验证命令

```bash
cd frontend
npm run build
```

结果：TypeScript 编译和 Vite 构建均通过；仅有既有 chunk 大小提示。
