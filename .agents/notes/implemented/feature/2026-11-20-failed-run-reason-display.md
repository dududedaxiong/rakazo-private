# Agent Note: 媒体失败原因进对话——失败 run 留一行、通知与跟进带原因

Status: implemented

## Problem

媒体 run 全失败时，存下的 run 错误本身是诚实的（例如 `Media generation: provider_failure — cogview-3-flash (unsupported)`），但用户在界面上看不到原因（2026-11-20 部署验证，分支 `feature/media-edit-pool-read-fix`；缺口原记录见[模型切换缺口补齐](./2026-11-20-model-fallback-gaps.md) §13 与 Consequences）：

- 线程 UI 不渲染失败 run 的行：重新生成失败时“正在生成图片…”那行进度消息被撤掉，对话里什么都没留下；只有输入框下方的报错条（可关闭、下一条 run 开始就换掉），翻历史也找不到。
- `run.failed` 的浏览器通知只说通用的 “Failed.”。
- wake 跟进提示词（`Image job … failed. Do not resubmit unless the user asks.`）不带原因，跟进的机器人回复也说不清为什么失败。

用户 2026-11-20 10:27 亲口点头做这项。

## Decision

### 1. 一处中文摘要，服务端与通知共用

新增 `summarizeMediaRunError(error, { kind, mode })`（`packages/core/src/run-error.ts`），只认两种输入，别的原样返回 null：

- `MediaGenerationError` 的文本（`Media generation: <code> — <model> (<reason>), …`），逐个解析 `model (reason)` 对；reason 必须是已知的短词（`mediaGenerationFailureReason` 的那几个），否则该模型只留通用原因；**绝不原样回显上游文本、不带 key 片段**——与模型测试弹窗的中文摘要同一条规矩。
- 几个已知的通用串：`Media generation failed.` → 通用失败；`Media generation is unavailable.` → “影图服务不可用”；`The reference image is unavailable.` / `The image to edit is unavailable.` → “要编辑的图片不可用”。

原因映射（按 kind + mode 措辞）：unsupported 在编辑模式是“不支持图生图”（图片）/“不支持视频编辑”（视频），在生成模式是“不支持生成图片”/“不支持生成视频”；rate_limit → “限流”；authentication → “密钥无效”；timeout → “请求超时”；无详情的 provider_failure → “服务异常”；invalid_input → “输入无效”；output_limit → “输出过大”。前缀按 kind + mode：图片生成失败 / 图片编辑失败 / 视频生成失败 / 视频编辑失败；多模型失败用“；”连起来（例如“图片生成失败：gemini-3.6-flash 限流；cogview-3-flash 不支持图生图”）。kind/mode 未知时前缀退化成“生成失败”，unsupported 退化成“不支持该操作”。

### 2. 失败 run 在对话里留一行：服务端追加一条机器人文本消息

失败的媒体结果与成功的媒体结果对称：成功时 `mediaDelivery.publish` 把图/视频作为消息发进对话；失败时在同一个失败落点追加一条纯文本机器人消息（`persistMessageInTransaction`，普通 text block，不引入新 block 类型），只展示、不重提、不自动重跑、不改重试行为。消息与失败状态同事务提交（借用落点已有的 job 行 claim 做一次性保证，不另发明去重键）；顺序上消息先于 wake 入队，所以对话里先是失败行、后是机器人的跟进。

落点（只限媒体 run；聊天备选切换时间线不动）：

- `apps/api/src/routes/media.ts` 重新生成提交失败：与 run 置失败同事务追加消息；`run.failed` 的 payload 多带 `mediaKind`（image/video）与 `mediaMode`（generate/edit）两个可选字段（事件 payload 是自由 record，加字段向后兼容）；提交后 notify。
- `pollMediaImage` 的 `fail(error)`：同事务追加消息（有 error 文本可摘要），沿用已有的 `recipientRemains` 守卫；提交后 notify。
- `pollMediaVideo` 的 `onSettled(tx, "failed")`：视频轮询不返回具体原因，所以行文案只有“视频生成失败”/“视频编辑失败”，不编造原因；onSettled 在调用方的事务内执行，notify 靠随后入队的 wake 跟进消息与客户端已有的媒体快照 2 秒重拉，不在事务内另行 notify。

以下落点**不动**：收件方已不在（机器人/成员没了、对话被清空）与过期旧 job 的静默关闭——本来就是故意安静的，不追加消息、不发 wake。

### 3. `run.failed` 通知带原因

`browserNotificationMessage`（`apps/web/src/lib/browser-notifications.ts`）：`run.failed` 时先用摘要函数解析 payload 的 error（kind/mode 从 payload 的 `mediaKind`/`mediaMode` 取，没有就退化措辞）；解析得出就把 body 换成摘要（例如“图片编辑失败：cogview-3-flash 不支持图生图”），解析不出仍是原来的 “Failed.”。聊天 run 的失败通知不动。

### 4. wake 跟进提示词带原因（若有）

`queueWake` 多一个可选 `reason` 参数；图片轮询的 `fail` 把摘要传进去，提示词变成 `Image job <id> failed: <摘要>. Do not resubmit unless the user asks.`——原因在场，但“不自动重提”的 guard 原样保留。视频轮询没有具体原因可传（见 §2），提示词保持原样。

## Alternatives considered

- **客户端从快照的 `snapshot.run` 渲染失败行**：最强的对手——`reduceThreadSnapshot` 本来就把失败 run 留在 `snapshot.run`（带 error）， transcript 里渲染一行即可，不动服务端。否决：快照只保留最新一条 run，下一条 run 一开始行就消失，翻历史也找不到；用户的诉求正是“留一行”，服务端消息才是对话自己的记录，与成功消息对称。
- **复用输入框下方的报错条**：已有 `ComposerError` + `ModelErrorActions`（中文摘要 + 改模型/测 key 操作）。否决：它在对话之外、可关闭、下一条 run 就换掉；用户投诉的正是线程里看不到，不是输入框下看不到。报错条不动，失败行是新增的记录，两者不冲突。
- **行文案原样放上游错误**：否决——与第五批模型测试弹窗已定的规矩一致：中文摘要，不露上游原始错误、不带 key 片段。摘要解析器只回显模型 id 与我们自己的短原因词。

## Consequences

- 失败行是一条真实的机器人消息：进历史、进搜索/导出、未读计数与成功消息一致；手机端按普通机器人文本消息渲染，不引入新类型。
- 视频失败仍只有通用文案（轮询不返回原因）；失败行挂切换时间线是下一步（成功消息已有 `meta.modelSwitches`，失败行暂不挂），见下。
- `run.failed` payload 新增两个可选字段；旧客户端忽略它们，行为不变。
- 已知缺口（未做）：视频失败行没有切换时间线入口（时间线在 job 的 result 里，onSettled 拿到的是轮询前的旧快照）；`run.failed` 事件本身仍只在 media.ts 提交失败时发出，轮询失败靠快照刷新 + wake 通知客户端，不另补发事件（避免与 wake 重复通知）。
