# 智能体集市 14 个模块功能与运行验证报告

验证时间：2026-06-28

## 1. 执行链路结论

智能体集市当前共有 14 个模块，执行方式分为三类：

1. 本地任务包模块  
   不调用 OpenNotebook API，只在前端生成可复制的任务包文本。

2. OpenNotebook workflow 模块  
   前端调用 `POST /api/v1/agent/generate`，传入 `type` 和 `params`，再通过 `GET /api/v1/agent/status?task_id=...` 轮询结果。

3. OpenNotebook media/model 模块  
   前端调用 `POST /api/v1/agent/generate`，传入 `type`、`model`、`prompt` 和 `params`，再轮询 `status`。

当前远端目录实际开放：

- workflow agents：`mindmap`、`flashcard`、`podcast`、`invoice`、`digihuman`、`videoagent`
- models：`midjourney:image`、`gpt-image-2:image`、`kling-v1:video`、`suno-v3:music`、`framedirector-v1:framedirector`

当前远端目录没有返回 `tts` 或 `audio` 模型，因此“语音合成”和“声音克隆”在前端会被判定为不可运行。

## 2. 模块逐项梳理与验证结果

| 模块 | id | 类型 | 功能 | 当前结果 |
| --- | --- | --- | --- | --- |
| 脚本大师 | `script` | 本地 | 根据主题、形式、语气生成脚本任务包 | 前端本地可用，但不是远端执行 |
| 语音合成 | `voice` | media | 文本转语音 | 不可运行：远端未返回 `tts/audio` 模型 |
| 声音克隆 | `clone` | media | 参考录音 + 目标文本生成克隆音色语音 | 不可运行：远端未返回 `tts/audio` 模型 |
| 视频生成 | `video` | workflow | `videoagent` 文生/图生/参考生视频 | 已调试修复，补传 `size=1280*720` 后完成 |
| 配乐生成 | `music` | media | `suno-v3` 生成音乐/配乐 | 接口存在，但当前远端积分不足，提交被 402 拦截 |
| 图片生成 | `storyboard` | media | `gpt-image-2` 文生图/图文生图 | 接口存在，但当前远端积分不足，提交被 402 拦截 |
| 速记卡片 | `flashcard` | workflow | 学习材料生成问答/填空/配对/判断卡片 | 已完成 |
| 思维导图 | `mindmap` | workflow | 文档/素材生成结构化导图树 | 已完成 |
| 音频播客 | `podcast` | workflow | 素材生成播客脚本和音频 | 已完成 |
| 数据可视化 | `data` | 本地 | 根据数据生成可视化任务包 | 前端本地可用，但不是远端执行 |
| 多语翻译 | `translate` | 本地 | 根据文本生成翻译任务包 | 前端本地可用，但不是远端执行 |
| 数字人 | `digihuman` | workflow | 人物图片 + 音频生成数字人视频 | 提交和轮询正常，远端仍在生成中 |
| 财务发票识别 | `invoice` | workflow | 文本/图片/PDF 发票结构化识别 | 已完成 |
| FrameDirector | `framedirector` | media | brief → 脚本/分镜/预览/渲染 | 接口存在，但当前远端积分不足，提交被 402 拦截 |

## 3. 本次远端测试记录

### 3.1 已跑通到完成

| 模块 | task_id | 最终状态 | 说明 |
| --- | --- | --- | --- |
| 速记卡片 | `ef4545b9-b12e-4f52-be76-dbe4b64780e7` | `done` | 有 `result_data` |
| 思维导图 | `b2f81de4-bd97-4699-afb1-6c8de6d4c163` | `done` | 有 `result_data` |
| 音频播客 | `8a2497cb-de86-4f0e-a228-df12efa47dfc` | `done` | 有 `result_url` 和 `result_data` |
| 财务发票识别 | `d7fe8ef0-1926-4921-bfb1-5d73cda2ab86` | `done` | 有 `result_data` |
| 视频生成，修复后 | `e0fca51b-6acc-4469-8e88-6f72482199ab` | `done` | 有 `result_url` 和 `result_data` |

### 3.2 提交/轮询通过，但等待远端完成

| 模块 | task_id | 当前状态 | 说明 |
| --- | --- | --- | --- |
| 数字人 | `1b187b29-7623-422c-af7f-3621fe5f7765` | `running`，`42%`，`generating` | 提交、扣费、状态轮询均正常，生成耗时较长 |

### 3.3 失败项

| 模块 | 失败阶段 | 错误 |
| --- | --- | --- |
| 图片生成 | submit | `402 Payment Required`，`INSUFFICIENT_CREDITS`，当前可用 `1.09 C`，需要 `5.00 C` |
| 配乐生成 | submit | `402 Payment Required`，`INSUFFICIENT_CREDITS`，当前可用 `1.09 C`，需要 `5.00 C` |
| FrameDirector | submit | `402 Payment Required`，`INSUFFICIENT_CREDITS`，当前可用 `1.09 C`，需要 `5.00 C` |
| 视频生成，原参数 | status | `size is not supported` |
| 语音合成 | 目录能力检查 | 远端 `/models` 未返回 `tts/audio` 模型 |
| 声音克隆 | 目录能力检查 | 远端 `/models` 未返回 `tts/audio` 模型 |

## 4. 已完成的调试修复

文件：

- `frontend/src/features/agent-market/plugins/video.tsx`

修复内容：

- 视频生成面板默认写入 `size=1280*720`。
- 将原来的自由输入“画幅/尺寸”改为固定选项：
  - `1280*720`
  - `720*1280`
  - `960*960`

原因：

远端 `videoagent` 在不传 `size` 或传不支持值时会在执行阶段失败，错误为 `size is not supported`。补测 `size=1280*720` 后任务完成。

## 5. 待修复/待确认事项

1. 脚本大师、数据可视化、多语翻译当前只是本地任务包  
   如果产品目标是“真正跑通运行起来”，需要为这 3 个模块接入真实 OpenNotebook workflow 或平台自己的执行 API。

2. 语音合成、声音克隆缺远端模型  
   需要 OpenNotebook `/models` 返回 `tts` 或 `audio` 类型模型，或调整前端映射到当前实际可用的模型类型。

3. 图片生成、配乐生成、FrameDirector 当前受积分限制  
   代码侧能力匹配正常，失败原因是远端租户积分不足。充值或更换可用 tenant/workspace 后需要重新验证。

4. 数字人需要继续观察最终结果  
   本轮验证已确认提交和状态轮询正常，但远端生成未在等待窗口内完成。

5. 视频尺寸选项需要与 OpenNotebook 后端保持同步  
   当前只验证 `1280*720` 可用。`720*1280` 和 `960*960` 是按常见视频尺寸补充的候选项，后续最好由远端 `/agents` schema 返回明确 options。

## 6. 验证命令

前端构建验证：

```bash
cd frontend
npm.cmd run build
```

结果：

- TypeScript 编译通过
- Vite 构建通过
- 仅有 chunk 大小提示，不影响本次功能
