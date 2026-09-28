# 模型网关切换到 cherryin 套餐 + gpt-5.4/gpt-5.5 别名映射

## Context

CSI Runtime（`/home/ubuntu/csi-runtime`）当前的默认模型网关是 LINGKE/ONELLM（`https://api.lk888.ai/api`，模型 `gpt-5.5`）。需要整体切到新套餐网关 `https://open.cherryin.ai`，并把 multica 侧沿用的裸模型名 `gpt-5.4` / `gpt-5.5` 映射成新网关要求的带 vendor 前缀形式 `openai/gpt-5.4` / `openai/gpt-5.5`，让 multica 传裸名也能正常调用套餐配置。

**为什么要做映射**：新网关要求模型名带 vendor 前缀，裸名会直接 404。已实测：

```
gpt-5.5              -> 404 model_not_found   ❌
openai/gpt-5.5       -> 200 + tool_use 正常    ✅
openai/gpt-5.4       -> 200 + tool_use 正常    ✅
```

**已完成的实测验证（2026-09-26）**：
- `https://open.cherryin.ai` 鉴权有效（错误 key → 401，正确 key 通过）
- `openai/gpt-5.4` / `openai/gpt-5.5` 在 `/v1/messages` 上均 200，且 **tool_use 往返正常**（agentic coding 必需路径）
- 8 分钟持续负载：87/87 成功、零限流、延迟零衰减；并发 20 全通过；长上下文到 90k input tokens 仍正常

## 变更清单

### 1. `console-api/.env`（L20-23）—— 替换默认网关三件套

```
DEFAULT_ANTHROPIC_BASE_URL=https://open.cherryin.ai
DEFAULT_ANTHROPIC_MODEL=openai/gpt-5.5
DEFAULT_ANTHROPIC_API_KEY=<线下注入，勿入库>
```

注释同步为「默认模型路由 (cherryin 套餐, 已验证)」。

> `BASE_URL` 填根域即可：`console-api/main.py` 把它注入为 runtime 的 `ANTHROPIC_BASE_URL`，Claude Code 会自行拼 `/v1/messages`，已实测拼出 `https://open.cherryin.ai/v1/messages`。

### 2. `console-api/main.py` —— 新增模型别名归一化（核心）

在配置常量区新增别名表与归一化函数：

```python
# 模型别名归一化：multica 侧沿用裸模型名，cherryin 网关要求 vendor 前缀。
# 未命中或已带前缀的模型名原样透传。
MODEL_ALIASES = {
    "gpt-5.4": "openai/gpt-5.4",
    "gpt-5.5": "openai/gpt-5.5",
}

def normalize_model(name: str) -> str:
    return MODEL_ALIASES.get(name, name)
```

在 `provision_runtime` 的模型路由解析处（[main.py L875-878](file:///home/ubuntu/csi-runtime/console-api/main.py#L875-L878)）解析后立即归一化，使「请求体显式传 `name`」和「走服务端默认值」两条路径都被覆盖：

```python
model_name = (body.model.name if body.model else None) or settings.DEFAULT_ANTHROPIC_MODEL
model_name = normalize_model(model_name)
```

归一化后再往下走原有的入库（L894-909）与 env var 注入流程，无需改动其他逻辑。

### 3. `deploy/k8s/runtime-configmap.yaml`（L25-37）—— 部署侧同步

```yaml
ANTHROPIC_BASE_URL: "https://open.cherryin.ai"
ANTHROPIC_MODEL: "openai/gpt-5.5"
```

并更新上方注释块里关于 ONELLM 网关的说明。

### 4. `console-api/runtimes.py` —— dsh 硬编码网关（L41-59）

`_DSH_DEFAULT_SETTINGS_YAML` 里的 LINGKE 地址与模型名：

```yaml
llm-deepseek:
  baseURL: https://open.cherryin.ai/v1
  models:
    - id: openai/gpt-5.5
      name: GPT-5.5 (via cherryin gateway)
agent-default-model:
  model: openai/gpt-5.5
```

注释里的 LINGKE / `212.129.240.112:4200` 描述一并更新。

### 5. 兜底默认值对齐（一致性，非必需）

- `runtimes/shared/daemon.sh` L264：kimi config.toml 的 `local model="${!model_var:-gpt-5.5}"` fallback → `openai/gpt-5.5`
- `runtimes/gemini-cli/gemini-openai-proxy.mjs` L19：`const MODEL = process.env.GEMINI_MODEL || 'gpt-5.5'` → `'openai/gpt-5.5'`

两处都是「env var 缺失时的兜底」，正常路径不会命中，但改成一致可避免排障时误导。

## 不做的事

- **不改** `.multica/server/.env` 的 `MULTICA_LLM_*`（已确认本次范围不含 multica 自身 LLM 调用）
- **不改** `docs/`、`*.md` 里的历史示例文本（非运行配置；如需同步可后续单独处理）
- 不改 gemini proxy 的协议转译逻辑本身

## 验证

1. **网关连通性**（不依赖代码改动，先跑）
   ```bash
   curl -sS https://open.cherryin.ai/v1/messages \
     -H "Authorization: Bearer $LLM_API_KEY" \
     -H "anthropic-version: 2023-06-01" -H "content-type: application/json" \
     -d '{"model":"openai/gpt-5.5","max_tokens":16,"messages":[{"role":"user","content":"say OK"}]}'
   ```
   预期 200；把 model 换成裸名 `gpt-5.5` 预期 404（反证映射必要性）。

2. **归一化函数单测**
   ```bash
   cd console-api && python -c "
   from main import normalize_model
   assert normalize_model('gpt-5.4') == 'openai/gpt-5.4'
   assert normalize_model('gpt-5.5') == 'openai/gpt-5.5'
   assert normalize_model('openai/gpt-5.5') == 'openai/gpt-5.5'
   assert normalize_model('anthropic/claude-sonnet-4.5') == 'anthropic/claude-sonnet-4.5'
   print('ok')"
   ```

3. **回归既有测试**
   ```bash
   cd console-api && python -m pytest tests/ -q
   ```
   重点看 `test_provision_flow.py` / `test_runtimes.py` / `test_runtime_lifecycle.py` 全绿。

4. **端到端**：起 console-api，用裸名供给一个 runtime，确认入库与注入的是带前缀模型
   ```bash
   # 传裸名 gpt-5.4，断言响应体 anthropic_model == "openai/gpt-5.4"
   curl -sS -X POST http://localhost:18080/api/v1/runtimes \
     -H "Authorization: Bearer csi-admin-dev-7c4a8f2b9e" -H "content-type: application/json" \
     -d '{"runtime_type":"claude-code","agent_id":"map-test","model":{"name":"gpt-5.4"}}' \
     | jq '.anthropic_model, .anthropic_base_url'
   ```
   预期 `"openai/gpt-5.4"` / `"https://open.cherryin.ai"`。

5. **Pod 内冒烟**（若环境可跑）：`kubectl exec` 进 runtime pod，确认 `ANTHROPIC_MODEL=openai/gpt-5.5`，再跑一次 `claude -p` 验证走通。

## 注意事项

- 目标仓库 `/home/ubuntu/csi-runtime` **不在当前命令沙箱的可写目录白名单**内（白名单只有主工作目录、memory、/tmp 等）。执行编辑时需要跳出沙箱（`dangerouslyDisableSandbox`）或先由你确认放开该路径的写权限。
- `console-api/.env` 内含真实密钥，改动时不要将内容回显到日志或提交记录里；确认该文件是否已被 `.gitignore` 覆盖。
- 切换后旧 LINGKE 网关的 `sk-7cb9efb1...` key 将不再被使用，如需保留回滚路径请自行留档。