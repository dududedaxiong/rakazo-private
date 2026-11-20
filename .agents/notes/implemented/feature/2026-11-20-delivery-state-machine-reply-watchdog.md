# Agent Note: 送达状态机与回复看门狗

Status: implemented

## Problem

聊天发送在两端都没有送达状态机，正在生成的指示器也没有客户端兜底，同一个“没回”有三种不同的面孔，用户分不清、重试也不敢点：

- 网页端：`use-composer-actions.sendMessage` 只有一个 composer 级 `sending` 布尔值。`rpc.threads.send` 一旦返回就清掉发送态，之后 run 的死活只通过快照与 run 失败条显示。RPC 在接受前失败（没发出去）和接受后 run 失败（已送达、没回）在用户眼里都是“失败了”，重试前者安全、重试后者可能重复发送——全靠服务端按 clientNonce 去重兜底，界面上没有任何区分。`rpc.threads.send` 还没有超时：请求挂住时 composer 永远卡在发送中。
- App 端：`thread-feedback` 的 outbox 已有 `queued / pending / failed / refused`、nonce 去重、落盘时 `pending → queued`，但没有 `no-reply` 态：已接受的发送一旦 echo 出现就从 outbox 消失，之后 run 悄悄失败时用户只看到 run 错误，看不到“这条已送达但没回”。发送请求同样没有超时。
- 两端指示器：`progress:` 实时消息完全由 SSE 事件驱动（`thread.progress` / `agent.tool.called`，终态事件清掉）。流悄悄断了、终态事件丢了，指示器就一直挂着。`stuckWorkingRuns`（run 开始 180 秒无文字回复即判卡住，配 `StuckRunActions` 恢复行）已经存在，但它只看服务端 `startedAt`：一个正在积极跑工具、跑长任务的 run，180 秒没出文字回复也会被判卡住，是误报。

BotArk（`src/renderer/src/store/delivery.ts`、`replyWatchdog.ts`）已经把这两套机制写成了带单测的纯规则：送达状态 `sending → accepted → sent`，失败分 `failed`（没发出去）与 `no-reply`（已送达但没回），接受后永不标 `failed`；全局在途集合防双击重发；`withTimeout` 的迟到结果回调纠正已显示的状态；重启后 `sending → failed`、`accepted → no-reply`；看门狗按 bot 记最后一次活动，无事件 3 分钟判停、平台仍报 busy 时放宽到 15 分钟。

## Decision

只搬 BotArk 的纯规则，不搬它的存储形态（BotArk 是 Electron + zustand + localStorage；Rakazo 的事实源头是 Postgres + App outbox 文件）。共享规则放 `packages/core`，两端各自接线，不动服务端、不新增 API、不做迁移。

### 1. 核心送达规则：`packages/core/src/delivery.ts`

纯函数，不含 Lingui——文案由调用方用 `t` 宏传进来：

- `DeliveryState = "sending" | "accepted" | "sent" | "failed" | "no-reply"`。
- `deliveryAfterError(accepted, kind, detail, texts)`：`accepted` 为真时永不返回 `failed`，只返回 `no-reply`；`kind` 为 `no-reply` 时直接返回 `no-reply`；其余返回 `failed`。已实现并有单测，但本批两端都没有直接调用它——两端从 run 状态 + `noReplyMessageIds` 推导同一区分。
- `createInFlightSet()`：按 clientNonce 单次发送，双击重试进不去第二次。网页端 `use-composer-actions` 用模块级集合守着；App 端没用——App 已有三层防重（`preparingSend` ref + `pending` 态 + 单 flight drain），不再加第四层。
- `withTimeout(promise, ms, onLate)` + `SendTimeoutError`：超时先拒，迟到的成功/失败走 `onLate` 纠正已显示的状态。网页端用它；App 端不用——App 的 RPC 层自带 `{ timeoutMs }`，发送请求直接传 120 秒超时，超时的 `TimeoutError` 由本地 `timedSend` 转成 `SendTimeoutError`，迟到结果由同一 nonce 重试时的服务端回放覆盖（安全，无重复），不另做回调通道。
- `SEND_HARD_TIMEOUT_MS = 120_000`：Rakazo 的 send RPC 只等消息与 run 落盘就返回，不像 BotArk 的 adapter 那样在调用里等完整回复，所以 2 分钟是宽裕的上界，不是 12 分钟。
- `sanitizeDeliveryStates(records, texts)`：重启重分类——持久化的客户端发送记录里 `sending → failed`、`accepted → no-reply`。已实现并有单测，但本批没有接线：网页端没有持久化的发送记录可洗，App outbox 恢复时本来就把 `pending` 落回 `queued`。
- `noReplyMessageIds(messages, runs)`：run 终态 failed/cancelled 且无机器人文字回复的用户消息 id。两端都用它推导 no-reply。
- `clearNoReplyOnReply` 没有实现：no-reply 是每次渲染时从 run 状态现算的，没有按消息存的状态可翻。

### 2. 核心看门狗：`packages/core/src/reply-watchdog.ts`

- `REPLY_IDLE_LIMIT_MS = 3 分钟`，`REPLY_BUSY_LIMIT_MS = 15 分钟`，`isReplyStalled(lastEventAt, now, busy)`，`ReplyWatchdog`（按 bot id 记最后一次活动；`touch / forget / lastEventAt / stalled`）。
- `liveRunIsBusy(blocks)`：实时 progress 的 block 里有 `steps`（工具调用）或 `activity` 的 progress 段即算 busy（跑工具、长任务）。
- `stuckWorkingRuns` 增加可选的看门狗时钟参数 `StuckRunClock = { lastEventAt(botId), isBusy(botId) }`：最近有过实时事件的 run（在限额内）永不判卡住；不传时钟时行为与现在完全一致，现有单测不用改。

### 3. 网页端接线

- `use-composer-actions.sendMessage`：按 clientNonce 进在途集合（同 nonce 第二次调用直接返回，不发第二次）；`rpc.threads.send` / `sendWithRoutines`（含 routines-only 路）包 `withTimeout(120s, onLate)`。超时显示“发送超时，可能已经送达；重试前先确认。”，草稿恢复（文案不丢）；迟到的成功补 receipt 并清掉超时错误，迟到的失败显示真实错误；迟到成功不动草稿——用户可能已重试，迟到 settle 会误清第二次发送的草稿，文案宁可多留，不可误删。
- run 失败条：在 `ComposerError` 上加一行“已送达，但没有收到回复。”（`runNoReply`：run 失败且该 run 的用户消息在 `noReplyMessageIds` 里），放在模型操作行上方；恢复入口复用现成的 `StuckRunActions` 行，不新增 UI。
- `use-thread-state` 里一个 `ReplyWatchdog`，`use-thread-sync` 的 `beforeEvent` 里 touch（DM 用 `event.botId ?? active.id`，群组只用 `event.botId`；终态事件 `forget`）；`transcript.tsx` 把时钟传进 `stuckWorkingRuns`；卡住 run 的 `progress:` 行与 activity 从渲染里滤掉；指示器只在“有 working run 且全部卡住”时隐藏。
- 接线时修了两个回归：`withTimeout` 对非 Promise 返回值先归一化（既有单测的 mock 返回 `undefined` 时 `.then` 会崩）；指示器条件从“任一 working run 卡住就藏”改成“全部卡住才藏”，否则无 run 的 `running` 态也被误藏。
- 文案走 Lingui：`lingui extract --clean` + `compile`；两条新文案（`Send timed out. It may already have been delivered — check the thread before resending.` / `Delivered, but no reply came back.`）的 zh-CN 翻译已补，其余 locale 走英文 fallback。

### 4. App 端接线

- `thread-feedback.deliverSend`：发送请求（plain 与 sendWithRoutines 两路，含 routines-only 早返分支）传 `{ timeoutMs: 120_000 }`；`timedSend` 把 `TimeoutError` 转成 `SendTimeoutError`，文案与网页端同一句。上传保持 60 秒不动（上传超时不是“已送达”，不套同一文案）。drain 里超时走 `failed`（`SendTimeoutError` 的 name 不是 `TimeoutError`，不进 offline 分支），不静默重排；重试复用同一 nonce，服务端回放不重复。
- no-reply：`ThreadErrorNotice` 新可选 prop `noReply`，run 失败且该 run 的用户消息在 `noReplyMessageIds` 里时，body 里加一行“已送达，但没有收到回复。”；重发走已有的长按 Resend（服务端 `resend`，新 nonce），不另起入口。
- 看门狗：`thread-screen` 里一个 `ReplyWatchdog`，经 `useThreadSync` 传到 `useThreadLiveSubscription`，在 onEvent 回调里 touch/forget（与网页端同款 botId 规则：DM 用 `event.botId ?? botId`，群组只用 `event.botId`；终态事件 `forget`，其余看门狗事件 `touch`）；`useThreadRows` 接时钟、返回 `stuckRunIds` / `stuckBotIds`，卡住 run 的 `progress:` 行从渲染列表滤掉；`thread-screen` 的 footer（`ThreadWorkingFooter`）排除卡住的 bot，`hasLiveProgress` 排除卡住 run 的 progress 行。`replyWatchdog` 在 `thread-live` / `thread-sync` / rows 里都是可选参数——不关心看门狗的调用方（例如 `thread-foreground.test.ts`）不用构造它。
- 文案走 App 手写 locales：两条新串补进 8 个目录（zh、zh-TW、ru、de、nl、ja、es、pl）；`i18n.test.ts` 扫描全部 `t()` 字面量并强制各目录齐全。

### 5. 不在本批

BotArk 的第三条（原子写 JSON + 读失败抛错）不立项，只记一笔：App 本地存储（草稿、收藏缓存、设置）是“读－改－写”，存在同一类丢数据风险，下次碰 App 本地存储时按此审查；同时给 [durable-execution-recovery-records](../../proposed/feature/2026-11-16-durable-execution-recovery-records.md) 那份长任务落库笔记补一个实现细节——落库的每一步必须是崩溃安全的，否则恢复点本身就是坏的。

### 6. Rebase 到产物页修复头（r2）与 zip 标题措辞

本批原分支 `feature/delivery-state-machine` 建在旧部署头 `80deae38` 上；产物页手机修复（`feature/artifacts-mobile-fix`，`3c44d1b9`）先部署上线，直接部署原分支会把产物页修复盖回去，所以另开 `feature/delivery-state-machine-r2`，以本地 `6680c82`（tree 与远端 `3c44d1b9` 完全一致，`3ef1a721…`）为基点，把 6 个提交按顺序 cherry-pick 过去，零冲突；两边都动过的 Lingui `.po` 由 git 自动合并，两边新串都在（delivery 的 2 条 + 移动修复的 8 条），事后用 `git diff` 核对过 zh-CN。

同批顺带修了一个标题措辞：zip 预览头部的计数是整包文件总数（`files = entries.filter(e => !e.isDirectory)`），列表只显示当前目录的直接子项，根目录 5 个文件夹装着 7 个文件时，标题“7 个文件”看着像少了文件。改成“共 # 个文件”（`t`共 ${plural(...)} · ${formatFileSize(totalSize)}``），只改措辞、不改计数口径；Lingui `extract --clean` + zh-CN/zh-TW 补译 + `compile`，单测断言标题显示总数（测试 zip 含 2 个文件，断言 `共 2 files`）。

## Alternatives considered

- **服务端存送达状态（Postgres 里给每条消息记 delivery）**：最强的理由是单一事实源头，换设备、重装都还在。不用：接受（receipt 已应用）、已送达（echo 已出现）、没回（终态 run 无回复）这三个事实服务端 run 记录里已经全有，缺的只是客户端的呈现与超时；为呈现问题做一次迁移不合算。App outbox 本来就是有意的客户端本地物。
- **原样照抄 BotArk 的 delivery.ts**：最强的理由是带单测、已评审。不用：那个模块是 Electron/zustand 形状（localStorage 持久化、账号 sanitize、附件字节、配额压缩），Rakazo 的持久化是 Postgres + outbox 文件，只有纯规则能搬，存储部分搬不过来。
- **看门狗放服务端（客户端静默就判 run 失败）**：最强的理由是服务端拥有流。不用：服务端看不到客户端的事件送达——SSE 断了和 run 安静了在服务端看来一模一样；看门狗管的是客户端自己的指示器，只能活在客户端。
- **发送请求不设超时**：最强的理由是慢网络下不误报。不用：无界的 composer `sending` 就是用户现在报的“卡住”；超时文案写明“可能已经送达”，迟到回调会自我纠正，误报不需要用户动手。
- **给卡住另起一套“stalled”恢复行**：最强的理由是概念分得干净。不用：同一底层状态（run 安静太久）出两套恢复行会让人困惑；`StuckRunActions` 已有取消与换模型重试，正好就是看门狗需要的重试入口。

## Consequences

- 接受后永不标 failed：网页端接受后的 run 失败走 no-reply 行；App 端超时走 failed 但文案写明可能已送达，且重试走同一 nonce 回放。`deliveryAfterError` 与 `sanitizeDeliveryStates` 只在 core 里有单测、没有客户端接线——下一批若要持久化发送记录或在客户端存 delivery 态，接线时直接用它们，不要重写规则。
- 两端差异（有意保留）：网页端迟到成功补 receipt 清错误，App 没有 onLate 通道、靠 nonce 回放覆盖；App 的在途防重已有三层，不另加集合；网页端补集合是因为 composer 的 `sending` state 有同 tick 竞态。
- 超时误报的代价：120 秒在慢网络下可能误报；迟到回调（网页）与 nonce 回放（App）兜底，文案写明“可能已经送达”。看门狗的忙碌放宽（15 分钟）会推迟真正卡死的工具 run 的恢复行：取舍是正在出工具事件的 run 是在工作、不是卡住。
- 测试：core 的 delivery / reply-watchdog / run-stuck 单测全过；网页端相关 5 个文件 173 例全过，core 相关 4 个文件 62 例全过；App 端 thread-feedback 69、thread-rows-stuck 8、i18n 32、thread-foreground 12，共 121 例全过；网页 + core tsc 干净；App tsc 只剩基线就有的 7 处错（bot-roster、usage-detail 的 totalOnlyCalls）；Biome 干净；`pnpm verify-notes` 全过。
- 顺手修了一个既有缺口：杂项设置批次的 16 条 App 文案（分类名与设置页文案）只在 zh 目录有译文，其余 7 个目录缺失，i18n 齐全性测试在基线提交上就是红的；本次给 7 个目录补了译文（zh 本来就有，不动），测试转绿。7 个非中文语种的新译文是我写的，未经母语者审过；错译只影响这几条新文案的显示，不影响功能。
- 基线红项（与本批无关，在基线提交 `4fade75` 上核对过，数字一致）：移动端全量套件另有 27 例失败（voice-settings 的 mock 缺 `serverProviderOf` 导出、bot-profile 分页、account-screen、model-settings、settings-sheet、inbox-archived 集合错误）；App tsc 另有 7 处错（见上）。本批新增 0 失败、0 新错。
- 未验证：没有真机/模拟器，App 的改动只在 jsdom 单测里验过；网页端也没有在浏览器里点过（本批只做代码 + 测试 + 推送）。只推代码、不部署、不打 App 包。
- r2（rebase 到 `3c44d1b9` + zip 标题措辞）验证：cherry-pick 零冲突；scoped 单测全过——web + core 79 例（delivery 16、reply-watchdog 13、run-stuck 7、use-composer-actions 26、transcript 7、zip-entry 4、Artifacts 6，含新增“共 2 files”断言），App 端 121 例（与原批数字一致）；core 与 web tsc 干净；Biome 在改动文件上干净（顺手修了 `Artifacts.test.tsx` 第 28 行一个基线就有的格式问题，`6680c82` 上的原文件同样不过 Biome format）；`pnpm verify-notes` 全过。
