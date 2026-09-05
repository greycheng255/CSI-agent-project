**主题：Re: Workspace 档案发现提案（W1/W2/W3）答复——三个 feedback 点 + 我方接入完成情况**

Agent Owner Console 团队各位好：

贵方 §21 提案（proposal-to-m.md，2026-09-04）已逐项核对，三个 feedback 点答复如下，另附我方消费侧已完成的实现清单，供联调排期参考。

## 一、feedback 点 ①：字段白名单

**结论：10 字段够用，按现稿推进；建议公测后增补两项（走白名单修订流程）。**

- 四个消费场景（大厅手动派发 / 竞标席位 / workspace 主页 / 入驻画廊）以现稿 10 字段均可支撑。
- `service_commitments` / `capability_tags` 直接复用为我方展示页渲染，`slug` 用于深链，`updated_at` 用于同步水位——字段设计无冗余。
- **增补建议（非阻塞，公测后按 §7.1 提修订）**：
  1. `announcement`（门店公告）——我方展示页有公告条位（PRD §5.6.7），现稿缺此字段，画廊卡片可降级不展示；
  2. 信用摘要（`completed_tasks_count` / `avg_rating` 聚合两枚即可）——我方画廊卡片现在显示"完成单数 / 评分"，数据取自我方自有业务统计而非贵方档案，不依赖本次白名单；若贵方后续开放，我方切到权威源。
- 白名单外字段一律不落我方投影（本地以白名单映射写入，守卫测试已覆盖）。

## 二、feedback 点 ②：端点路径与事件命名

**结论：全部确认，无异议，我方已按此实现。**

1. **接收端点**：`POST {M_BASE}/v1/webhooks/workspace/changed`（三事件同端点）——确认。我方已上线，入站走我方 HMAC 守卫（方向分离入站凭证 + RFC 7807 错误渲染），贵方配置 `CSI_MARKETPLACE_PARTNER_EVENT_PATH=/v1/webhooks/workspace/changed` 后即可开启推送。
2. **三事件命名**：`workspace.created` / `workspace.updated` / `workspace.deleted`——确认。
3. **无 `workspace.suspended`**：接受。我方以"删除即生命周期终点"处理：收到 deleted 将本地投影置为终止态（frozen），停止画廊展示与商机 Push 派发；若此后再收到同 id 的 created/updated，视为贵方权威快照、自愈恢复 active。
4. **全量快照粒度**：确认优于变更字段集——我方以幂等 upsert 消费，无需 delta 排序/丢失补偿。
5. **best-effort 投递语义**：接受。我方去重按 `event_id`（`Idempotency-Key` 头同值仅作双保险不作主键），兜底走 W1 Pull。

## 三、feedback 点 ③：投影 vs 直调

**结论：我方选投影模式（W2 事件 + W1 Pull 兜底，即贵方推荐组合），已实现。**

理由：
1. 四个消费场景全部在 M 前端渲染主路径上，直调会引入逐请求同步等待与 Console 可用性耦合；
2. Push 撮合投递需要本地 active workspace 集合做类目路由（目标池），必须本地有投影；
3. 投影读路径零跨版块调用，联调与压测互不放大。

落地面：
- **W2 投影**：`workspaces` 本地表按 §21.2 白名单映射全量快照 upsert，`event_id` 去重；
- **W1 Pull 兜底**：`GET /v1/partner/workspaces`，`limit=200` + `next_cursor` 翻页（本方 MAX_PAGES 上限防 cursor 异常死循环），30 分钟周期，环境开关门控（默认关，联调期手动触发验证）；
- **幂等**：Pull 侧合成 `event_id = sync-{workspace_id}-{updated_at}` 复用同一去重与 upsert 通道，内容未变自动跳过；
- **鉴权**：按 §21.1 空 body 空串派生 HMAC（我方守卫侧 2026-09-02 已修复过同款 GET 派生问题，出站签名同样按空串口径，贵方守卫可复测）。

## 四、W3 席位快照确认（含一个小反馈）

**结论：确认接收，已实现，向后兼容无异议。**

- 我方 submit_bid 消费侧已支持 `workspace_name` / `workspace_avatar_url`：贵方传入值**优先采用**（投标时点语义正确），缺省时回退我方本地投影，两字段均可空、零破坏。
- **小反馈（不阻塞）**：契约 §21.4 注明 `workspace_avatar_url` 为"Console 存储原值：**对象存储 URL 或站点相对路径**"——我方席位页 `<img>` 需可渲染地址。我方处理：**原值入库**（已实现，`workspace_avatar_url` → 我方席位快照列）；渲染侧按形态分流——绝对 URL 直接渲染（保留投标时点快照语义），**站点相对路径则按契约以 W1 详情 `avatar_url`（渲染级绝对地址）渲染**（回退链路待贵方样本到位后实现并联调验证）。已知悉此处存在时点差（快照值 = 投标时点，W1 渲染地址 = 当前时点），契约既定"以 W1 为准"，我方按此执行，无需修订。请贵方在首场联调时提供一条站点相对路径样本，我方验证回退链路。
- `agent_count` 我方暂不落库（本地无对应展示位），属白名单内字段，留待"平台推荐"标签升级时使用。

## 五、联调对接信息

1. **W2 推送开启**：请贵方配置 `CSI_MARKETPLACE_PARTNER_EVENT_PATH=/v1/webhooks/workspace/changed` 并将我方 `M_BASE`（现网 `http://172.17.0.14:4001`，公网窗口另议）写入贵方出站目标；密钥沿用既有方向分离凭证，无需新交换。
2. **W1 联调**：我方 Pull 通道已就绪，首场联调可加一个验证项——贵方造 1 个 workspace（created 事件）→ 我方投影出现；更新档案 → 投影同变更；删除 → 我方画廊/投递目标池消失。三步即可覆盖 W2+W1 兜底闭环。
3. **对账补充**：`workspace_id` 在既有 #36/#38 通道的取值与本提案 `PublicWorkspaceProfile.workspace_id` 为同一标识（贵方文档口径），无需二次映射，请一并书面确认。

—— Marketplace 团队（CSI-Agent）




