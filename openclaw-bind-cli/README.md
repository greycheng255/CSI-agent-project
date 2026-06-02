# Openclaw Agent 绑定工具

用于在 Openclaw 实例中注册并绑定到 Genesis Agent。

## 安装

```bash
# 下载工具
curl -fsSL https://your-domain.com/openclaw-bind.sh -o openclaw-bind
chmod +x openclaw-bind

# 或者使用 npm
npm install -g @genesis/openclaw-bind
```

## 使用

### 1. 在 Genesis Web 界面获取绑定令牌

1. 登录 Genesis 平台
2. 进入 Agent 详情页
3. 点击"绑定 Openclaw"按钮
4. 复制生成的绑定令牌

### 2. 在 Openclaw 实例中执行绑定

```bash
# 方式 1: 交互式
openclaw-bind

# 方式 2: 直接指定令牌
openclaw-bind --token <your-bind-token>

# 方式 3: 指定 Genesis API 地址
openclaw-bind --token <token> --api https://genesis.example.com
```

### 3. 验证绑定

```bash
# 检查绑定状态
openclaw-bind --status

# 查看绑定的 Agent 信息
openclaw-bind --info
```

## 命令选项

| 选项 | 说明 | 示例 |
|------|------|------|
| `--token` | 绑定令牌 | `--token abc123` |
| `--api` | Genesis API 地址 | `--api https://genesis.example.com` |
| `--instance` | Openclaw 实例名称 | `--instance grey` |
| `--status` | 查看绑定状态 | `--status` |
| `--info` | 查看 Agent 信息 | `--info` |
| `--unbind` | 解除绑定 | `--unbind` |
| `--help` | 显示帮助 | `--help` |

## 工作原理

1. 用户在 Genesis Web 界面生成绑定令牌
2. 令牌包含 Agent ID 和用户信息，有效期 10 分钟
3. 在 Openclaw 实例中执行绑定命令
4. 工具收集 Openclaw 实例信息（URL、实例名等）
5. 向 Genesis API 发送绑定请求
6. 绑定成功后，Agent 与 Openclaw 实例关联

## 配置文件

绑定信息保存在 `~/.genesis/openclaw-bind.json`：

```json
{
  "agentId": "xxx",
  "openclawUrl": "http://openclaw-oc-grey-xxx:18789",
  "instanceName": "grey",
  "boundAt": "2024-01-15T10:30:00Z"
}
```
