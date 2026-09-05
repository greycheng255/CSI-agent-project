**主题：Re: M侧待处理清单 v2 答复——三项闭环确认 + BYOK 立场 + 首场时间窗**

Marketplace 团队各位好：

贵方 v2 答复已收悉并逐项核对完毕，反馈如下：

**一、三项挂账闭环确认**

1. **A1 仲裁 outcome 六值**：确认闭环。我方 #42 消费端直接读取 `outcome` 字段（六值全量 gate，未知值拒绝），与贵方实现零改动对齐；零结算校验口径一致。
2. **A2 场景五计时**：确认闭环。我方已于 09-02 按同口径（reset-on-resubmit）完成数据面落码：`revising→in_accept` 重投边重盖 `delivered_at=now / auto_accept_after=now+14d`，5/9/13 天催办锚同步改为最新 submission——与贵方"重新计满 + #14 直携 deadline"完全一致，含状态机注册表与技术文档四方同步及测试断言。
3. **A3 幂等键 9 项**：确认闭环。验收/修订两项以 `submission_seq` 等价承载的口径我方接受，联调期以真实重试流量验证等价性。

**二、HMAC 与签名**

hex 口径双向复测通过确认；GET 空 body 派生差异贵方已处理，我方将在首场联调时一并复核（GET 类请求空 body 按契约空串派生）。`entitlement_usage_records` 的 UUID 列注意事项已知悉。

**三、密钥现状确认（C2 补充）**

方向分离密钥双方已于 09-02 交换并配置生效（我方 beta 四方向值已 apply + rollout，Bearer 门与 HMAC 门实测通过即为凭证）。贵方答复中"请指定交换方式"应写于交换完成前，无需再办。后续轮换约定：联调期走联调群加密文件；生产按契约 K8s Secret + 提前 7 天双发轮换。

**四、D 组 BYOK 处置意见的回复**

我方 Owner 裁决：**公测联调按既有冻结契约执行**——

- 双方实现面均以现行契约文档为准：**《CSI-Agent-Owner-Console-Integration-Guide.md》（v1.8，含 BYOK 裁决警示）**、**《CSI-LLM-Gateway-Billing-Team-Requirements.md》**，以及我方 TS（Technical Solution）§12.2 / §17 / 附录 B——三份此前均已提供给贵方，如需最新版可随时索取。贵方 BYOK 相关变更（owner key 平台存储与下发 / env 注入 / 自定义 provider 入口 / E7 正式纳入）须按《集成指南》§7.1 提交正式变更请求，经双方评审并回写权威文档后方可实施；评审通过前双方均不按新形态实现。
- 联调排期：**E1-E4 计量对账面**双方均已实现，公测期即可开联。K 线（K1-K4）、E6 在冻结契约内且我方 Console 侧已全部实现——我方就绪待贵方对应实现交付，交付后即安排对接联调（契约不变，无联调壁垒）。
- **E7（`GET /v1/entitlement/llm-config/:orgId`）暂不接入**：该端点承载的是 BYOK 凭证链路——平台存储 owner 自带 key（user_llm_configs）后供服务级批量拉取下发。它与冻结契约的三条硬约束直接冲突（平台不存储/不下发 owner key、key 不落 Runtime env、凭证面收敛于 K1-K4 daemon 本地代理）。我方已在 TS §17.3.5/B.6 与网关需求文档登记该端点（登记≠接入）；如贵方希望正式纳入契约，请按 §7.1 提交变更请求，经双方评审并回写权威文档后我方再评估接入。

**五、首场联调**

我方就绪（beta 出向走同机内网 `172.17.0.14:4001` 已实测通，公网窗口地址暂不使用）。请回复贵方可行的 2 小时时间窗（工作日任意时段均可配合），场景一~三（商机投递 → 竞标提交/撤回 → 选标 `bid.won` 闭环）。另请将 `docs/longtask-integration-runbook.md` 与 `docs/carbon-silicon-longtask-dev-plan.md` 副本发到联调群，谢谢！

**六、能力预告：我方将提供 Workspace 档案发现 API（技术提案随后发出）**

我们注意到贵方多个页面需要我方 workspace 档案（任务大厅手动派发选目标 workspace / 竞标席位展示竞标方信息 / workspace 主页 / 已入驻工作室画廊）。现有契约缺这个面，我方将主动补齐，方向如下（详细 API 设计文档随后发联调群）：

1. **只读查询 API**（Console 提供，贵方调用）：workspace 列表（游标 + since 增量）+ 单个 workspace 公开档案 + 按 org 列出 owner 名下 workspace——贵方可用它做投影同步，也可前端直调，实现方式自定；
2. **生命周期事件**（Console → 贵方 webhook）：`workspace.created / updated / suspended`，供贵方及时同步投影（suspended 请贵方用于暂停投递）——此机制同时可作为贵方 Push 撮合投递的目标池来源；
3. **竞标席位快照**：`submit_bid` payload 增补 workspace 展示字段（名称/头像），席位页免逐条查询。

该提案按 §7.1 流程随设计文档正式发出，字段范围以公开档案白名单为界（不含任何业务配置/预算数据）。若贵方前端还有其它需要的字段，请在收到设计文档时一并反馈。

—— Agent Owner Console 团队