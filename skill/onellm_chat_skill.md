# OneLLM 基础聊天模型调用 Skill

> 给应用开发者和 Agent/Skill 编排者：如何通过 OneLLM 调用基础聊天模型。多媒体生成请继续看 [../onellm_skill_client.md](../onellm_skill_client.md)。

OneLLM 提供统一的聊天模型调用入口。客户端只需要关心 OneLLM API Key、模型名、请求参数和响应内容，不需要了解底层模型供应商和路由实现。

参考：

- OneLLM 架构设计：[../onellm.md](../onellm.md)
- OneLLM 对话接口：`POST /v1/chat/completions`
- OneLLM 模型列表：`GET /v1/models`

---

## 1. Skill 适用范围

这个 skill 只处理**文本对话 / 普通聊天补全**：

| 能力 | 入口 | 说明 |
|---|---|---|
| 普通聊天 | `POST /v1/chat/completions` | 推荐默认入口，兼容 OpenAI Chat Completions 请求格式 |
| 流式聊天 | `POST /v1/chat/completions` + `stream=true` | SSE chunk 返回 |
| JSON 输出 | `response_format` | 模型支持时使用 |
| 工具调用 | `tools` / `tool_choice` | 模型支持时使用 |

不属于这个 skill：

- 图片 / 视频 / TTS / 音乐生成：走 `/v1/media/generations`
- Embedding / rerank：走对应 `/v1/embeddings` / rerank 接口
- 后台管理：用 OneLLM 控制台 API，不用模型调用 key 当管理 token

---

## 2. 基本调用约定

### 2.1 Base URL

生产环境优先使用：

```bash
export ONELLM_BASE_URL="https://onellmapi.opennotebook.chat/v1"
```

测试或私有部署时替换为实际 OneLLM 网关地址，例如：

```bash
export ONELLM_BASE_URL="https://onellmapi.opennotebook.chat/v1"
```

如果 SDK 的 `base_url` 已经包含 `/v1`，请求路径就是 `/chat/completions`；如果 base 是根地址，则请求完整路径是 `/v1/chat/completions`。

### 2.2 鉴权

模型调用统一使用 OneLLM API Key：

```http
Authorization: Bearer <your-onellm-api-key>
```

不要把任何第三方模型服务密钥暴露给业务客户端；客户端只使用 OneLLM API Key。

---

## 3. Quick Start

### 3.1 cURL

```bash
curl -X POST "$ONELLM_BASE_URL/chat/completions" \
  -H "Authorization: Bearer $ONELLM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5.5",
    "messages": [
      {"role": "system", "content": "你是一个简洁、可靠的助手。"},
      {"role": "user", "content": "用一句话解释 OneLLM 是什么。"}
    ],
    "temperature": 0.2,
    "max_tokens": 256
  }'
```

响应形态：

```json
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "model": "gpt-5.5",
  "choices": [
    {
      "index": 0,
      "message": {"role": "assistant", "content": "OneLLM 是统一接入多家大模型、并提供租户、计费和路由能力的 AI 网关。"},
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 32,
    "completion_tokens": 28,
    "total_tokens": 60
  }
}
```

### 3.2 Python SDK

```python
import os
from openai import OpenAI

client = OpenAI(
    api_key=os.environ["ONELLM_API_KEY"],
    base_url=os.getenv("ONELLM_BASE_URL", "https://onellmapi.opennotebook.chat/v1"),
)

resp = client.chat.completions.create(
    model="gpt-5.5",
    messages=[
        {"role": "system", "content": "你是一个简洁、可靠的助手。"},
        {"role": "user", "content": "用一句话解释 OneLLM 是什么。"},
    ],
    temperature=0.2,
    max_tokens=256,
)

print(resp.choices[0].message.content)
```

### 3.3 TypeScript SDK

```ts
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.ONELLM_API_KEY,
  baseURL: process.env.ONELLM_BASE_URL ?? "https://onellmapi.opennotebook.chat/v1",
});

const resp = await client.chat.completions.create({
  model: "gpt-5.5",
  messages: [
    { role: "system", content: "你是一个简洁、可靠的助手。" },
    { role: "user", content: "用一句话解释 OneLLM 是什么。" },
  ],
  temperature: 0.2,
  max_tokens: 256,
});

console.log(resp.choices[0]?.message?.content);
```

---

## 4. Skill 调用决策规则

### 4.1 默认选择 OpenAI Chat Completions

Agent/Skill 编排时默认使用 `/v1/chat/completions`。即使选择 Claude 或 Gemini 系列模型，客户端也可以保持同一套 Chat Completions 请求格式，OneLLM 会自动处理协议差异。

优先这样做：

```json
{
  "model": "claude-opus-4-7",
  "messages": [{"role": "user", "content": "你好"}]
}
```

`model` 必须使用 `GET /v1/models` 返回的模型 ID，不要自行拼接服务商前缀：

```json
{
  "model": "anthropic/claude-opus-4-7"
}
```

调用方应使用 OneLLM 暴露的模型名，可通过 `GET /v1/models` 获取。

### 4.2 模型选择

当前可用的聊天模型以按 token 计费为主，常用示例：

| 场景 | 推荐模型示例 |
|---|---|
| 通用高质量 | `gpt-5.5` / `gpt-5.4` / `claude-opus-4-7` |
| 成本更敏感 | `gpt-5.4-mini` / `gpt-5.4-nano` / `claude-haiku-4-5-20251001` |
| Claude 风格长文/代码 | `claude-sonnet-4-6` / `claude-opus-4-6` |
| Gemini 系列 | `gemini-3.5-flash` / `gemini-3.1-pro-preview` / `gemini-3-pro-preview` |
| 旧兼容或轻量测试 | `gpt-4o` / `gemini-3-flash-preview` |

完整可用模型以部署时的 `GET /v1/models` 返回结果为准。

模型列表里可能同时出现裸名和带 `-tierN` 后缀的名字：

- 裸名，如 `gpt-5.5`：推荐默认使用。
- `-tierN`，如 `gpt-5.5-tier1`：仅在业务明确指定时使用。

### 4.3 参数最小集

基础 skill 默认只传这些参数：

| 参数 | 必填 | 说明 |
|---|---:|---|
| `model` | 是 | OneLLM 模型名 |
| `messages` | 是 | OpenAI 格式消息数组 |
| `temperature` | 否 | 默认建议 `0.2` 到 `0.7` |
| `max_tokens` | 否 | 控制最大输出 |
| `stream` | 否 | 需要边生成边展示时设为 `true` |

只有在确实需要时再传：

| 参数 | 用途 |
|---|---|
| `top_p` | 替代或配合 temperature 的采样控制 |
| `stop` | 指定停止字符串 |
| `response_format` | 约束 JSON 输出 |
| `tools` / `tool_choice` | 工具调用 |
| `user` | 透传最终用户标识，方便审计和限流 |

不同模型支持的参数不完全一致，所以 skill 不应无条件塞入一大堆默认参数。

---

## 5. 流式输出

```bash
curl -N -X POST "$ONELLM_BASE_URL/chat/completions" \
  -H "Authorization: Bearer $ONELLM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5.5",
    "messages": [{"role": "user", "content": "写一段 80 字以内的产品介绍。"}],
    "stream": true
  }'
```

流式响应是 SSE：

```text
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"delta":{"content":"OneLLM"}}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"delta":{"content":" 是"}}]}

data: [DONE]
```

客户端规则：

- 逐个读取 `choices[0].delta.content`
- 收到 `data: [DONE]` 后结束
- 流式请求如果已经返回了部分内容，不要自动无脑重试，避免用户看到重复回答

---

## 6. JSON 输出

需要结构化结果时，优先让 prompt 明确 schema，并在模型支持时加 `response_format`：

```json
{
  "model": "gpt-5.5",
  "messages": [
    {
      "role": "system",
      "content": "只输出 JSON，不要 Markdown。格式：{\"title\": string, \"summary\": string}"
    },
    {
      "role": "user",
      "content": "总结 OneLLM 的核心能力。"
    }
  ],
  "response_format": {"type": "json_object"}
}
```

客户端仍要做 JSON parse 失败兜底，因为不是所有模型和渠道都强保证 JSON mode。

---

## 7. 多模态聊天输入

若模型支持视觉输入，可以用 OpenAI 内容块格式：

```json
{
  "model": "gpt-5.5",
  "messages": [
    {
      "role": "user",
      "content": [
        {"type": "text", "text": "这张图里有什么？"},
        {"type": "image_url", "image_url": {"url": "https://example.com/image.png"}}
      ]
    }
  ]
}
```

注意：

- 视觉输入是否可用取决于当前模型能力。
- 远程 URL 必须能被模型服务访问。
- 这仍然是聊天补全；生成图片或视频不要用这个接口，改用媒体生成 skill。

---

## 8. 计费和用量

基础聊天模型是同步调用，通常按 token 计费。客户端一般只需要读取响应体里的 `usage`：

| 字段 | 用途 |
|---|---|
| `usage.prompt_tokens` | 输入 token 数 |
| `usage.completion_tokens` | 输出 token 数 |
| `usage.total_tokens` | 总 token 数 |

实际扣费以 OneLLM 的账单和消费记录为准。客户端不要根据本地 token 估算自行认定账务结果。

---

## 9. 错误处理

| HTTP 状态 | 常见原因 | Skill 处理建议 |
|---:|---|---|
| 400 | 请求体错误、参数不被模型支持、messages 为空 | 修正请求，不自动重试 |
| 401 | API Key 缺失或无效 | 提示重新配置 `ONELLM_API_KEY` |
| 402 | 钱包余额或 key 额度不足 | 提示充值或更换有额度的 key |
| 403 | key 无模型权限、租户权限不满足 | 提示检查 key 权限 |
| 404 | 模型名不存在或未在配置中启用 | 调 `/v1/models` 或检查配置 |
| 429 | 调用频率、并发或 token 速率超限 | 指数退避后重试 |
| 500/502 | 模型服务或网关错误 | 可短暂重试，保留请求时间、模型名和返回的 error 信息 |
| 504 | 模型响应超时 | 降低输入长度或换模型后重试 |

重试建议：

- 只自动重试网络错误、429、500、502、504。
- 不重试 400、401、402、403、404。
- 非流式请求可重试 1 到 2 次；流式请求如果已经输出内容，不自动重试。

---

## 10. 与原生 Anthropic / Gemini 格式的关系

OneLLM 也可以暴露原生兼容入口：

| 格式 | 入口 | 适用 |
|---|---|---|
| Anthropic Messages | `POST /v1/messages` | 使用 Anthropic SDK，或必须要 Anthropic 原生响应结构 |
| Gemini GenerateContent | `POST /v1beta/models/{model}:generateContent` | 使用 Google AI SDK，或必须要 Gemini 原生响应结构 |

但通用 skill 默认不走这些入口；默认走 OpenAI Chat Completions，可以让同一个调用器覆盖 `gpt-*`、`claude-*`、`gemini-*` 等模型。

---

## 11. Skill 实现清单

实现一个 OneLLM chat skill 时，至少包含：

- `ONELLM_API_KEY`：必填，从安全存储或环境变量读取
- `ONELLM_BASE_URL`：可选，默认 `https://onellmapi.opennotebook.chat/v1`
- `model`：调用方可配置，默认用一个稳定裸名模型
- `messages`：只传 OpenAI 格式消息
- `timeout`：建议 60 到 180 秒，长上下文可更高
- `retry`：只对 429/5xx/网络错误做有限退避
- `logging`：记录 model、status、latency、usage 和 error 信息，不记录 API Key

最小伪代码：

```text
load ONELLM_API_KEY
base_url = ONELLM_BASE_URL or "https://onellmapi.opennotebook.chat/v1"
payload = {
  model,
  messages,
  temperature,
  max_tokens,
  stream
}
POST {base_url}/chat/completions
if success:
  return choices[0].message.content
if retryable:
  retry with backoff
else:
  surface error.message
```
