# 智能体集市 OpenNotebook Agent Runs API 接入与验证报告

更新时间：2026-09-02

## 1. 接入结论

智能体集市当前代码目录共有 10 个模块。除 OpenNotebook 公共目录尚未开放的“声音克隆”外，其余 9 个模块已统一使用 `backend/app/api/v1/agent_runs.py` 对外提供的 Public Agent Runs API：

- 目录：`GET /api/v1/agents`
- 提交：`POST /api/v1/agent-runs`
- 状态：`GET /api/v1/agent-runs/{record_id}`
- 历史：`GET /api/v1/agent-runs?workspace_id=<workspace-id>`
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
- 历史记录通过 `GET /api/v1/agent-runs` 加载，并按当前工作区和智能体类型筛选。
- 兼容解析 `id`、`record_id`、`run_id` 以及 `output` 等响应字段。
- 移除租户 ID、用户 ID 和相关请求头。

### 4.2 运行页与集市页

文件：

- `frontend/src/pages/AgentMarketHub.tsx`
- `frontend/src/pages/AgentRun.tsx`

调整内容：

- 集市目录请求统一携带 OpenNotebook API Key。
- 运行页使用 API Key 调用 `GET /api/v1/workspaces`，由用户选择可访问工作区。
- 工作区 ID 不再由前端环境变量预置，仅在浏览器本地保存最近选择。
- 页面不再显示或缓存租户 ID、用户 ID。
- 状态轮询和结果展示适配 Agent Runs 记录。
- 所有 `/agent-market/:id` 运行页统一为双栏工作台：左侧为 API Key、工作区、模型及智能体参数，右侧为当前执行、进度、结果和运行历史。
- 点击历史任务可以恢复对应任务的状态与执行结果；运行中的历史任务会继续轮询。

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
VITE_AGENT_API_BASE=http://localhost:3001
```

OpenNotebook API Key 不再写入环境变量。每个 CSI 用户在智能体运行页面填写自己的 Key；Key 按 CSI 用户 ID 隔离并保存在当前浏览器的 `localStorage`，不会提交给 CSI 后端，也不会进入 Vite 构建产物。

API Key 需要包含 `agents:read`、`agent_runs:create`、`agent_runs:read` 和 `workspaces:read` 权限。租户、用户和工作区归属均由服务端根据 Key 决定。

页面仅在浏览器直连 OpenNotebook 时把该用户的 Key 放入 `Authorization: Bearer` 请求头。用户可以随时更换或清除本机保存的 Key；在共享设备上使用后应主动清除。

## 6. 远端验证

### 6.1 已通过

- 使用 API Key 请求 `GET /api/v1/agents` 成功。
- 返回 9 个可用 workflow agents：`llm_chat`、`mindmap`、`flashcard`、`podcast`、`invoice`、`video_shot_analysis`、`digihuman`、`videoagent`、`speech_synth`。
- 返回 5 个媒体模型：`midjourney`、`gpt-image-2`、`kling-v1`、`suno-v3`、`framedirector-v1`。
- 使用 API Key 请求 `GET /api/v1/workspaces` 成功，页面可以让用户选择该 Key 可访问的工作区。
- 使用 `gpt-image-2` 提交真实文生图任务成功：`POST /api/v1/agent-runs` 返回 `202`，Worker 消费任务后最终状态为 `succeeded`、进度为 `100`，并返回图片地址和 storage object ID。
- 页面能够识别 `succeeded` 完成态，并根据结果数据中的 `image_url`、`video_url` 或 `audio_url` 显示对应媒体。
- API Key 输入、更新、清除及按 CSI 用户隔离的浏览器保存逻辑已完成。
- 前端 `npm run build` 通过。

### 6.2 当前限制

声音克隆仍是服务端能力缺口：公共目录未返回对应 agent/model，不能通过 `/api/v1/agent-runs` 合法提交。需要 OpenNotebook 后端先将声音克隆注册为公共 agent，前端才能接通。

本地运行异步 Agent 时，除 Uvicorn API 服务外还必须同时运行 `python -m app.workers.agent_api_worker`，否则任务会停留在 `queued`。

## 7. 验证命令

```bash
cd frontend
npm run build
```

结果：TypeScript 编译和 Vite 构建均通过；仅有既有 chunk 大小提示。
