**主题：Re: 联调进展答复——pull 偏差已修复并发布 beta，请重推 open task 完成 M→C 端到端验收（附 W1/W2/W3 提案反馈确认）**

Marketplace 团队各位好：

贵方反馈已收到并处理完毕，两项均已落地：

**一、pull workspace_id 校验偏差（第三节）已修复并发布**

1. 我方 `Sync` 已按契约 §9.2 改为**公开商机发现语义**：`GET /v1/marketplace/tasks` 返回的公开 task（无 `workspace_id`）不再做归属校验，改为枚举已开启自动发现（`auto_discover_opportunity=true`）的 workspace，按 capability_tags 与 task.category 匹配后逐 workspace 投影商机——与贵方公开大厅线形完全对齐。
2. 带 `workspace_id` 的定向兼容路径保留（仅命名且已 opt-in 才投影，不参与枚举、不重复投影）。
3. 新版本已发布 beta（server 镜像 `beta-9ffb088fb`）并完成 rollout，pod 已验证运行新逻辑。

**二、出站方向密钥（第四节）已接线**

1. beta 运行 pod 的四方向密钥已实证注入：`CSI_MARKETPLACE_OUTBOUND_TOKEN/SECRET` = `c2m-…`、`CSI_MARKETPLACE_INBOUND_TOKEN/SECRET` = `m2c-…`——出站调用（Bearer + HMAC）现使用 `c2m-` 方向密钥，不再回落 legacy 单密钥。
2. 贵方可将验签配置回切为 `c2m-` 单密钥口径（回切值贵方已备档）。

**三、请求贵方重推一条 open 任务**

贵方重推 open task → 我方 Console 应 200 ACK（商机正常投影）→ 贵方 outbox 记 `success`，即完成 M→C 端到端验收闭账。我方 beta 环境保持运行（api `csi-beta-api.cloud.hropenai.cn` / 出站走同机内网），随时可接收。

**四、W1/W2/W3 提案反馈（《Re Workspace 档案发现提案 答复》）确认**

贵方消费侧实现清单已收悉，全部确认，响应如下：

1. **W2 推送已开启**：我方 beta 已配置 `CSI_MARKETPLACE_PARTNER_EVENT_PATH=/v1/webhooks/workspace/changed` 并完成 rollout（pod env 实证）——workspace.created/updated/deleted 现已向贵方端点推送（best-effort + 贵方 W1 Pull 兜底，按契约口径）。
2. **字段白名单增补建议**（`announcement` / 信用摘要两枚聚合）：登记为公测后 §7.1 白名单修订候选，我方记录在案；信用摘要贵方现阶段用自有统计不受影响。
3. **workspace_id 同一标识确认（贵方 §五.3）**：书面确认——既有 #36/#38 通道的 `workspace_id` 与本提案 `PublicWorkspaceProfile.workspace_id` 为**同一标识**（均我方 workspace 主键），无需二次映射。
4. **W3 相对路径样本**：接受贵方渲染回退方案（原值入库 → 渲染侧回退 W1 详情 `avatar_url`）；首场联调时我方提供一条站点相对路径样本供贵方验证回退链路。
5. **首场联调验证项**：贵方 §五.2 的三步闭环（created → 投影出现 / 更新 → 同变更 / 删除 → 画廊与投递目标池消失）我方接受，纳入首场联调清单。
6. `slug` 深链与 `updated_at` 同步水位的用法与我方设计意图一致，无补充。

—— Agent Owner Console 团队