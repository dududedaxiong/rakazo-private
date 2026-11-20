# Agent Note: 送达状态机与回复看门狗

Status: proposed

## Problem

聊天发送在两端都没有送达状态机，正在生成的指示器也没有客户端兜底，同一个“没回”有三种不同的面孔，用户分不清、重试也不敢点：

- 网页端：`use-composer-actions.sendMessage` 只有一个 composer 级 `sending` 布尔值。`rpc.threads.send` 一旦返回就清掉发送态，之后 run 的死活只通过快照与 run 失败条显示。RPC 在接受前失败（没发出去）和接受后 run 失败（已送达、没回）在用户眼里都是“失败了”，重试前者安全、重试后者可能重复发送——全靠服务端按 clientNonce 去重兜底，界面上没有任何区分。`rpc.threads.send` 还没有超时：请求挂住时 composer 永远卡在发送中。
- App 端：`thread-feedback` 的 outbox 已有 `queued / pending / failed / refused`、nonce 去重、落盘时 `pending → queued`，但没有 `no-reply` 态：已接受的发送一旦 echo 出现就从 outbox 消失，之后 run 悄悄失败时用户只看到 run 错误，看不到“这条已送达但没回”。发送请求同样没有超时。
- 两端指示器：`progress:` 实时消息完全由 SSE 事件驱动（`thread.progress` / `agent.tool.called`，终态事件清掉）。流悄悄断了、终态事件丢了，指示器就一直挂着。`stuckWorkingRuns`（run 开始 180 秒无文字回复即判卡住，配 `StuckRunActions` 恢复行）已经存在，但它只看服务端 `startedAt`：一个正在积极跑工具、跑长任务的 run，180 秒没出文字回复也会被判卡住，是误报。

BotArk（`src/renderer/src/store/delivery.ts`、`replyWatchdog.ts`）已经把这两套机制写成了带单测的纯规则：送达状态 `sending → accepted → sent`，失败分 `failed`（没发出去）与 `no-reply`（已送达但没回），接受后永不标 `failed`；全局在途集合防双击重发；`withTimeout` 的迟到结果回调纠正已显示的状态；重启后 `sending → failed`、`accepted → no-reply`；看门狗按 bot 记最后一次活动，无事件 3 分钟判停、平台仍报 busy 时放宽到 15 分钟。

## Proposal

只搬 BotArk 的纯规则，不搬它的存储形态（BotArk 是 Electron + zustand + localStorage；Rakazo 的事实源头是 Postgres + App outbox 文件）。共享规则放 `packages/core`，两端各自接线，不动服务端、不新增 API、不做迁移。

### 1. 核心送达规则：`packages/core/src/delivery.ts`

纯函数，不含 Lingui——文案由调用方用 `t` 宏传进来：

- `DeliveryState = "sending" | "accepted" | "sent" | "failed" | "no-reply"`。
- `deliveryAfterError(accepted, kind, detail, texts)`：`accepted` 为真时永不返回 `failed`，只返回 `no-reply`；`kind` 为 `no-reply` 时直接返回 `no-reply`；其余返回 `failed`。
- `createInFlightSet()`：按 clientNonce 单次发送，双击重试进不去第二次。
- `withTimeout(promise, ms, onLate)` + `SendTimeoutError`：超时先拒，迟到的成功/失败走 `onLate` 纠正已显示的状态。
- `SEND_HARD_TIMEOUT_MS = 120_000`：Rakazo 的 send RPC 只等消息与 run 落盘就返回，不像 BotArk 的 adapter 那样在调用里等完整回复，所以 2 分钟是宽裕的上界，不是 12 分钟。
- `sanitizeDeliveryStates(records, texts)`：重启重分类——持久化的客户端发送记录里 `sending → failed`（“应用关闭时还没确认送达”）、`accepted → no-reply`（“已送达，但回复还没收完”）。
- `clearNoReplyOnReply(messages, runId)`：某 run 的机器人回复落地后，把该 run 的用户消息从 `no-reply` 翻成 `sent`（按 runId 定位，比 BotArk 的“最新用户消息”扫描更准，因为 Rakazo 的用户消息自带 runId）。

### 2. 核心看门狗：`packages/core/src/reply-watchdog.ts`

- `REPLY_IDLE_LIMIT_MS = 3 分钟`，`REPLY_BUSY_LIMIT_MS = 15 分钟`，`isReplyStalled(lastEventAt, now, busy)`，`ReplyWatchdog`（按线程 key 计最后一次活动：DM 用 botId，群聊用 groupId；`touch / forget / stalled`，与 BotArk 同形）。
- `liveRunIsBusy(blocks)`：实时 progress 的 block 里有 `steps`（工具调用）或 `activity` 的 progress 段即算 busy（跑工具、长任务）。
- `run-stuck.ts` 的 `stuckWorkingRuns` 增加可选的看门狗时钟参数 `lastEventAt(runId)` / `isBusy(runId)`：最近有过实时事件的 run（在限额内）永不判卡住；不传时钟时行为与现在完全一致，现有单测不用改。

### 3. 网页端接线

- `use-composer-actions.sendMessage`：按 clientNonce 进在途集合；`rpc.threads.send` / `sendWithRoutines` 包一层 `withTimeout(120s, onLate)`。超时显示“发送超时，可能已经送达；重试前先确认”，草稿不清除；迟到的成功补上 receipt（accepted）并清掉超时提示，迟到的失败显示真实错误。接受后 run 失败且无回复时，run 失败条走 no-reply 文案（“已送达，但没有收到回复；重发前先确认”）。
- `use-thread-sync`：每个打开的线程一个 `ReplyWatchdog`，每次应用该线程事件时 `touch`；`transcript.tsx` 的卡住计算把看门狗时钟传进 `stuckWorkingRuns`。恢复入口复用现成的 `StuckRunActions` 行（取消 / 换模型重试），不新增 UI。

### 4. App 端接线

- `thread-feedback.deliverSend`：`threads/send` 请求包一层 `withTimeout`，迟到回调同网页端；超时记 `failed` 并附超时文案——重试安全（服务端按 nonce 回放）。`send()` 里用在途集合显式防重（drain 本来就是单 flight，这里是第二道）。
- 已接受发送的 no-reply：`acceptedRun` 的 run 走到终态失败/取消且无机器人回复时，在该用户消息行上标 no-reply，复用现有的无回复消息重发表态（新 nonce 发一条新消息，不是对原 nonce 重试）。
- `thread-rows.tsx`：卡住计算同样传入看门狗时钟，与网页端同一套恢复行。

### 5. 文案

新增 UI 文案一律走 Lingui，中文翻译补进 locales；保持极简，不加解释性文字。超时与中断文案的英文原文：`Send timed out — it may already have been delivered. Check before retrying.`、`Sent, but no reply yet — check before resending.`

### 6. 不在本批

BotArk 的第三条（原子写 JSON + 读失败抛错，`jsonFile.ts`）不立项，只记一笔：App 本地存储（草稿、收藏缓存、设置）是“读－改－写”，存在同一类丢数据风险，下次碰 App 本地存储时按此审查；同时给 `2026-11-16-durable-execution-recovery-records.md` 那份长任务落库笔记补一个实现细节——落库的每一步必须是崩溃安全的，否则恢复点本身就是坏的。

## Alternatives considered

- **服务端存送达状态（Postgres 里给每条消息记 delivery）**：最强的理由是单一事实源头，换设备、重装都还在。不用：接受（receipt 已应用）、已送达（echo 已出现）、没回（终态 run 无回复）这三个事实服务端 run 记录里已经全有，缺的只是客户端的呈现与超时；为呈现问题做一次迁移不合算。App outbox 本来就是有意的客户端本地物。
- **原样照抄 BotArk 的 delivery.ts**：最强的理由是带单测、已评审。不用：那个模块是 Electron/zustand 形状（localStorage 持久化、账号 sanitize、附件字节、配额压缩），Rakazo 的持久化是 Postgres + outbox 文件，只有纯规则能搬，存储部分搬不过来。
- **看门狗放服务端（客户端静默就判 run 失败）**：最强的理由是服务端拥有流。不用：服务端看不到客户端的事件送达——SSE 断了和 run 安静了在服务端看来一模一样；看门狗管的是客户端自己的指示器，只能活在客户端。
- **发送请求不设超时**：最强的理由是慢网络下不误报。不用：无界的 composer `sending` 就是用户现在报的“卡住”；超时文案写明“可能已经送达”，迟到回调会自我纠正，误报不需要用户动手。
- **给卡住另起一套“stalled”恢复行**：最强的理由是概念分得干净。不用：同一底层状态（run 安静太久）出两套恢复行会让人困惑；`StuckRunActions` 已有取消与换模型重试，正好就是看门狗需要的重试入口。

## Acceptance criteria

- 单测覆盖：接受后永不标 failed；超时在 accepted 时走 no-reply、未接受时走 failed 并附超时文案；迟到结果纠正已显示状态；在途集合单 flight；重启重分类（sending → failed、accepted → no-reply）；看门狗空闲/忙碌限额与分 key 时钟；最近有事件的 run 不判卡住。
- 相关单测、tsc、Biome 全过；`pnpm verify-notes` 全过。
- 网页端与 App 端都接上；不新增服务端 API、不做迁移。
- 推到 `feature/delivery-state-machine`，一个逻辑点一个提交；只做代码 + 测试 + 推送，不部署、不打 App 包。

## Risks

- 120 秒发送超时可能在慢网络下误报：迟到回调 + nonce 安全重试兜底，文案写明“可能已经送达”。
- 看门狗的忙碌放宽（15 分钟）会推迟真正卡死的工具 run 的恢复行：取舍是正在出工具事件的 run 是在工作、不是卡住。
- 超时后用户立即重试，而第一次请求其实还在服务端跑：服务端按 clientNonce 去重，不会发出两条消息；同会话内在途集合也挡住第二个同 nonce 尝试。
