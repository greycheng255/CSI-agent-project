# OneLLM 多媒体生成 API 调用指南

> 给应用开发者：怎么通过 HTTP 接口调用 OneLLM 的图片 / 视频 / 音频 / TTS 生成能力。本文只讲客户端怎么调用，不展开底层实现。

---

## 1. 这是什么

OneLLM 将图片 / 视频 / 音频 / TTS / 音乐生成统一封装成两种调用模式：

| 入口 | 行为 | 用途 |
|---|---|---|
| `POST /v1/media/generations` | **异步（默认）**：提交任务、冻结预扣费、立刻返回 `task_id`（HTTP 202）| 视频等长任务，客户端自己轮询 |
| `POST /v1/media/generations/sync` | **同步**：提交+阻塞轮询+完成时返回结果 | 短任务（图片、短音频），不想自己写轮询 |
| `GET  /v1/media/tasks/{task_id}` | 查询任务状态；**任务终态时驱动结算/退款** | 异步路径的标准轮询接口 |

异步路径采用**提交时预扣费**：
1. 提交任务时按模型和参数估算 credits，并冻结到调用方账户钱包
2. 客户端轮询状态接口
3. 状态接口检测到 `is_final=true` 时：成功就按实际费用结算；失败就释放冻结额度

异步返回的轻量任务收据是 `MediaTaskAccepted`（见 §2.1）；同步和"轮询到终态"的结果都是 `MediaResponse`（见 §6）。

---

## 2. Quick Start

### 2.1 异步（推荐 / 默认）

```bash
# 1) 提交：立即返回 task_id，预扣费已冻结
curl -X POST https://onellmapi.opennotebook.chat/v1/media/generations \
  -H "Authorization: Bearer $ONELLM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "ai6700/doubao-seedream-4-5-251128",
    "prompt": "a cat reading a book in a library, oil painting",
    "size": "2048x2048"
  }'
```

响应（HTTP **202 Accepted**）：

```json
{
  "object": "media.task",
  "task_id": "12345",
  "model": "doubao-seedream-4-5-251128",
  "media_type": "image",
  "status": "pending",
  "estimated_cost": 0.55,
  "billing_method": "按张",
  "tenant_id": "tenant-abc",
  "created": 1716000000
}
```

```bash
# 2) 轮询：客户端自己控制节奏，建议 5-10s 一次
curl https://onellmapi.opennotebook.chat/v1/media/tasks/12345 \
  -H "Authorization: Bearer $ONELLM_API_KEY"
```

任务未结束时返回当前处理状态（含 `progress`、`status_group` 等）。**首次返回 `is_final=true` 时**响应里就包含完整 `MediaResponse` 结构（URL、实际扣费、settled=true 标记）；重复轮询不会重复扣费（幂等）。

### 2.2 同步（短任务直接拿结果）

```bash
curl -X POST https://onellmapi.opennotebook.chat/v1/media/generations/sync \
  -H "Authorization: Bearer $ONELLM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "ai6700/doubao-seedream-4-5-251128",
    "prompt": "a cat reading a book in a library, oil painting",
    "size": "2048x2048"
  }'
```

完整 `MediaResponse`（节选）：

```json
{
  "object": "media.task",
  "task_id": "12345",
  "model": "doubao-seedream-4-5-251128",
  "media_type": "image",
  "status": "completed",
  "data": [{"url": "https://cdn.example.com/img/abc.png", "result_type": "image"}],
  "cost": 0.22,
  "duration_seconds": 30
}
```

> 同步路径同样做预扣费 + 完成时结算，所以余额不足会在提交阶段直接 402 返回，不会浪费模型生成资源。

---

## 3. 鉴权

HTTP header：`Authorization: Bearer <your-onellm-key>`。

客户端只需要使用 OneLLM API Key；不要暴露任何第三方模型服务密钥。

---

## 4. 三种 modality 的实战示例

### 4.1 图片生成

```bash
curl -X POST https://onellmapi.opennotebook.chat/v1/media/generations \
  -H "Authorization: Bearer $ONELLM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "ai6700/doubao-seedream-4-5-251128",
    "prompt": "赛博朋克风格的东京街景，夜晚下雨",
    "size": "2048x2048",
    "n": 2,
    "aspect_ratio": "16:9",
    "images": "https://your-cdn.com/ref.jpg"
  }'
```

返回的 `data` 数组里每个元素对应一张图（多张时多条）：

```json
{
  "data": [
    {"url": "https://cdn/.../1.png", "result_type": "image"},
    {"url": "https://cdn/.../2.png", "result_type": "image"}
  ]
}
```

**支持的图片模型**（举例，完整列表见配置）：
- `doubao-seedream-4-5-251128` / `doubao-seedream-5-0-260128` — 即梦 4.5/5.0
- `gemini-3-pro-image-preview` — Nano Banana Pro
- `gpt-image-2-all` / `gpt-image-1.5-all` — GPT Image
- `grok-4.1-image` / `grok-4.2-image` — Grok Image

### 4.2 视频生成

```bash
curl -X POST https://onellmapi.opennotebook.chat/v1/media/generations \
  -H "Authorization: Bearer $ONELLM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "ai6700/doubao-seedance-1-5-pro-251215",
    "prompt": "一只猫在草地上奔跑，电影感运镜",
    "size": "1920x1080",
    "seconds": 8,
    "input_reference": "https://your-cdn.com/firstframe.jpg",
    "ratio": "16:9",
    "generate_audio": "true",
    "timeout": 1800
  }'
```

返回的 `data[0].url` 是视频 mp4 下载地址；`duration_seconds` 是**生成耗时**（不是视频时长）。

**视频任务默认 timeout 是 900 秒**（15 分钟），生成视频本来就慢。需要更长可以传 `"timeout": 1800`。

**支持的视频模型**：
- `doubao-seedance-1-5-pro-251215` — 即梦 3.5 Pro
- `grok-video-3` / `grok-video-3-plus` — Grok Video
- `hailuo-2.3` — 海螺
- `happyhorse-t2v` / `happyhorse-i2v` / `happyhorse-r2v` — 文/图/参考生视频

### 4.3 TTS / 音频

```bash
curl -X POST https://onellmapi.opennotebook.chat/v1/media/generations \
  -H "Authorization: Bearer $ONELLM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "ai6700/doubao-tts-2.0",
    "prompt": "今天天气真好，我们一起去公园散步吧",
    "type": "audio",
    "speed": 1.25,
    "voice": "BV001_streaming",
    "parameters": {
      "emotion": "happy",
      "emotion_scale": "4"
    }
  }'
```

返回的 `data[0].url` 是 mp3 下载地址。

**支持的音频模型**：
- `doubao-tts-2.0` — 豆包语音合成 2.0（100+ 音色、多语言）
- `gemini-2.5-pro-preview-tts` / `gemini-3.1-flash-tts-preview` — Gemini TTS

> 注意：onellm 的音频统一走 `/v1/media/generations`，返回 URL，你自己下载。

---

## 5. 请求参数

### 5.1 顶层字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `model` | string | ✅ | 形如 `ai6700/<model-name>` |
| `prompt` | string | ✅ | 文本提示词 |
| `type` | string |  | `image` / `video` / `audio` / `tts` / `music`。当模型类型无法自动识别时显式指定 |
| `parameters` | object |  | 模型原生参数。**最高优先级**，会覆盖自动映射结果 |
| `count` / `n` | int |  | 生成数量（图片用） |
| `timeout` | float |  | 轮询总超时（秒）。默认 600；视频建议 900–1800 |
| `poll_interval` | float |  | 轮询间隔（秒），默认 5 |

### 5.2 OpenAI 风格参数——会被自动映射

| 你传 | 视频映射到 | 图片映射到 | 音频映射到 |
|---|---|---|---|
| `size` | `params.resolution`（`1280x720→720p`，`3840x2160→4K`...）| `params.size`（`1024x1024→1K`，`2048x2048→2K`，`4096x4096→4K`）| —— |
| `seconds` | `params.audio_duration` | —— | —— |
| `input_reference` / `image` / `image_url` | `params.images` | `params.images` | —— |
| `n` / `num_images` | —— | top-level `count` | —— |
| `speed` | —— | —— | `params.speech_rate`（连续浮点 → 离散吸附） |
| `voice` | —— | —— | `params.voice`（透传） |
| `quality` / `style` / `response_format` | （丢弃） | （丢弃） | （丢弃） |

### 5.3 模型私有参数——直接透传

任何不在上表的 key 会作为模型原生参数透传。例如：
- 视频：`ratio` / `generate_audio` / `audio_duration`（直接传也行）
- 图片：`aspect_ratio` / `quality_level`
- 音频：`emotion` / `emotion_scale` / `model_version`

### 5.4 优先级

`parameters` 显式指定的 key **永远赢**：

```json
{
  "model": "ai6700/m",
  "prompt": "...",
  "size": "1280x720",
  "parameters": {"resolution": "1080p"}
}
```

上例中 `size` 会自动映射成 `resolution="720p"`，但 `parameters.resolution="1080p"` 覆盖之，最终 `1080p` 生效。

---

## 6. 响应：MediaResponse

```json
{
  "object": "media.task",
  "task_id": "12345",
  "model": "grok-video-3",
  "media_type": "video",
  "status": "completed",

  "data": [
    {"url": "https://cdn/abc.mp4", "result_type": "video"}
  ],

  "cost": 1.65,
  "duration_seconds": 42,
  "created": 1716000000,
  "completed_at": 1716000042
}
```

字段说明：

| 字段 | 含义 |
|---|---|
| `object` | 永远是 `"media.task"` |
| `task_id` | 任务 ID（字符串） |
| `model` | 返回的模型名 |
| `media_type` | `image` / `video` / `audio` / `tts` / `music` |
| `status` | 只返回 `completed` 状态的；失败会返回 4xx/5xx |
| `data[]` | 结果资产列表。图片多张时这里会有多条 |
| `cost` | 本次实际扣费，单位为 credits |
| `duration_seconds` | 从提交到完成的耗时（秒） |
| `created` / `completed_at` | unix 时间戳 |

---

## 7. 上传参考图 / 首帧——必须公网 URL

OneLLM 不托管引用文件。所有 `type=upload` 的参数（`images`、`input_reference`、`first_frame` 等）只接受 `http(s)://...` 形式的公网 URL。

```json
// ✅ OK
{
  "model": "ai6700/grok-video-3",
  "prompt": "...",
  "input_reference": "https://your-bucket.s3.amazonaws.com/ref.jpg"
}
```

下面这些会被拒绝（HTTP 400，发请求前就拦截）：

```text
/local/path.jpg
file:///x.jpg
data:image/png;base64,...
""（空字符串）
```

**推荐的上传链路**：
1. 用户上传 → 你的应用 → 临时对象存储（S3 / OSS / COS）
2. 拿到公网 URL（或预签名 URL，有效期足够覆盖生成时长，**视频建议 ≥ 30 分钟**）
3. 把 URL 放入请求体

---

## 8. 错误处理

所有失败都以 HTTP 4xx/5xx 返回，响应体形如：

```json
{
  "error": {
    "message": "任务失败：...",
    "type": "MediaGenerationError",
    "code": 502
  }
}
```

常见情况：

| status_code | 含义 | 怎么修 |
|---:|---|---|
| 400 | prompt 为空 / 上传不是 URL / model 不存在或类型不匹配 | 看 `message` 字段，按提示修参数 |
| 401 | API Key 缺失或无效 | 检查 `Authorization` header |
| 402 | **积分不足**（预扣费失败） | 看 `message` 里"当前可用 X C，需要 Y C"，给账户充值 |
| 502 | 模型任务失败 / 缺少结果 URL | 看 `message` 字段；可能是模型本次失败，重试 |
| 504 | 同步路径轮询超时 | 改用异步路径（`POST /v1/media/generations`）+ 自己轮询；或加大 `timeout` |

504 / 异步路径超时时，任务可能还在处理，可以用第 9 节的查询接口拿 `task_id` 单独查；查到 `is_final=true` 时也会自动结算/退款。

---

## 9. 查询单个任务状态（异步路径必读）

```bash
curl https://onellmapi.opennotebook.chat/v1/media/tasks/12345 \
  -H "Authorization: Bearer $ONELLM_API_KEY"
```

**未结束**时返回任务状态：

```json
{
  "task_id": 12345,
  "status": "生成中",
  "status_group": "处理中",
  "is_final": false,
  "progress": "60%",
  "result_url": ""
}
```

**首次返回 `is_final=true`** 时，OneLLM 同时做了两件事：
1. 触发钱包结算（成功 → 按实际 `cost` 扣费 + 释放冻结额度；失败 → 全额退还）
2. 把任务状态转换成完整 `MediaResponse` 返回（同 §6 结构 + 增 `settled: true` / `refunded: true` 字段）

成功示例（首次终态查询响应）：
```json
{
  "object": "media.task",
  "task_id": "12345",
  "model": "doubao-seedream-4-5-251128",
  "media_type": "image",
  "status": "completed",
  "data": [{"url": "https://cdn/.../abc.png", "result_type": "image"}],
  "cost": 0.55,
  "duration_seconds": 30,
  "settled": true
}
```

失败示例：
```json
{
  "task_id": 12345,
  "status": "生成失败",
  "status_group": "失败",
  "is_final": true,
  "error": "模型响应超时",
  "settled": false,
  "refunded": true
}
```

**幂等**：重复查同一个终态 task，钱包数字不会再变，但响应结构每次都给完整 `MediaResponse`。客户端拿到 `is_final=true` 就可以停止轮询。

> 注意：只有通过 OneLLM 提交的任务才会触发结算/退款。

---

## 10. 怎么找到能用的模型

### 10.1 查询可用媒体模型

OneLLM 暴露三个查询接口，用于查看当前可调用的媒体模型、模型元数据和价格信息。

```bash
# 全部可用媒体模型
curl 'https://onellmapi.opennotebook.chat/v1/media/models' \
  -H "Authorization: Bearer $ONELLM_API_KEY"

# 单个模型的元数据
curl 'https://onellmapi.opennotebook.chat/v1/media/models/grok-video-3' \
  -H "Authorization: Bearer $ONELLM_API_KEY"

# 该模型的价格信息
curl 'https://onellmapi.opennotebook.chat/v1/media/models/grok-video-3/pricing' \
  -H "Authorization: Bearer $ONELLM_API_KEY"
```

返回体形如：

```json
// /v1/media/models
{
  "object": "list",
  "data": [
    {"name": "grok-video-3", "display_name": "Grok Video 3", "type": "video"}
  ]
}

// /v1/media/models/{model}/pricing
{
  "model": "grok-video-3",
  "type": "video",
  "billing_method": "按秒",
  "base_price": 0.15,
  "option_prices": [...]
}
```

---

### 10.4 钱包 / 预扣费速记

异步路径强制走钱包，三条规则：

1. **谁付钱**：以调用 API Key 所属的 OneLLM 账户或租户钱包为准。
2. **什么时候动账**：
   - 提交时：按模型、参数和数量估算预计费用，并冻结相应额度。
   - `is_final=true` 第一次被查到时：成功 → 按实际费用结算并释放冻结额度；失败 → 释放冻结额度，不扣费。
3. **额度估算保守原则**：视频 `duration='auto'` 默认按 15 秒预扣；实际扣费以任务完成后的 `cost` 为准，结算时多退少补。

消费记录请通过 OneLLM 控制台或账单接口查看。

---

## 11. 常见陷阱

| 现象 | 原因 | 解决 |
|---|---|---|
| `Cannot infer media_type for 'ai6700/xxx'` | 模型类型无法识别 | 加 `"type": "image"`（或 video/audio） |
| 提交后立马拿 task_id，但没 URL | 默认是异步！只返回 receipt | 用 `/v1/media/tasks/{task_id}` 轮询；想阻塞等结果调 `/sync` |
| 视频任务 504 超时（同步路径） | 复杂场景生成超过 900s | 改用异步路径自己轮询；或显式传 `"timeout": 1800` |
| HTTP 402 `积分不足` | 钱包余额或额度不够 | 给账户充值；或确认 API key 有可用额度 |
| 上传参数报 400 | 传了本地路径 / base64 / `file://` | 必须公网 URL |
| `response_format=mp3` 没生效 | OpenAI 标准 key 被丢弃 | 用 `"parameters": {"output_format": "mp3"}` 透传 |
| `voice="alloy"` 报错 | OpenAI voice ID 不通用 | 用该模型支持的 voice ID（如豆包的 `BV001_streaming`） |
| 多 tier 模型选哪个 | 业务未指定时不用选 tier | 通常使用裸模型名 |
| `cost=0.0` | 本次任务没有产生有效扣费，通常发生在失败任务 | 看响应里的 `error` |
| 任务完成但 `settled=false` | 任务未通过 OneLLM 标准提交流程创建 | 通过 OneLLM 提交的任务会自动结算 |

---
