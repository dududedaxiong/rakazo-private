# Agent Note: 图片/视频识别与电脑人格（服务端）

Status: implemented

## Problem

主模型是纯文本模型，看不了图。今天用户发图给机器人时，图片原样送进主模型，运行直接以图片输入错误失败；视频连尝试都没有。用户要的是：发图或视频就自动识别，每一张都分析，分析结果当上下文喂给主模型，主模型永远不直接收原图。

同时电脑模式只有一套写死的内置指令。用户想给“操作电脑时的机器人”单独定一个人格：选一个现成的提示词模板，只在操作电脑时生效，普通聊天不受影响；不设就是现状。

## Decision

### 新角色：`image` 与 `video` 复用模型角色机制

`ModelRole` 增加 `image`、`video` 两个目的，与 `main` / `approval` / `computer` 走同一套表、同一套主备池、同一套“主池走完再走备池”的兜底顺序。角色选择存在 `UserModelRoleChoice` / `SpaceModelRoleChoice`，`role` 是普通字符串列，不用迁移。

`modelSupportsRole` 对新角色的要求是视觉能力下限：协议不是 `decisions`，且 `images !== false`。选模型器是宽松的：只提示、不拦截，用户仍可选一个可能看不了图的模型（视觉能力按连接逐模型配置，服务端无法对所有协议离线断言）。

部署默认模型不补位这两个角色：`deploymentModelRole` 对 `image` / `video` 返回空池，与 `computer` 相同——部署默认是纯文本模型，拿它当视觉默认只会让每次分析都失败。`models.role` / `models.forRole` 的 `seesImages` 视图扩展到新角色：有选定模型时报告它是否真的看图，供界面提示。

### 电脑人格：新表对 + 独立的 Space 设置项

`UserComputerPersona` / `SpaceComputerPersona` 两个新表，各存一行：成员 id（空间表再加空间 id）+ 可空的 `promptTemplateId`，指向 `PromptTemplate`，模板删了级联删掉人格行。只加表，不动现有表，上一版代码完全不读写它们，迁移与上一版兼容。

作用域复用模型角色同款的“账号一份、空间一份覆盖”机制，但开关是独立的新 `SpaceSetting` 值 `computerPersona`，不复用 `models`。空间开启覆盖时从账号复制当前值，关闭时丢弃空间份。读取走 `settingsTarget`，与模型角色一致的语义：显式 scope 优先，否则空间有覆盖就读空间份，否则读账号份。

RPC 是 `models.computerPersona`（读）与 `models.setComputerPersona`（写，入参 `{ promptTemplateId | null, scope? }`），照 `models.role` 的样子做 `expectedUserId` 校验。写时校验模板属于当前用户，不存在或不属于就拒绝；清空传 `null`，行删掉。选模板的数据复用现成的 `promptTemplates.list`，不新增列表接口。

执行器在组装指令时读已解析的人格（账号或空间覆盖后的那一份），有内容才追加一句电脑限定的子句，放在电脑指令之后：`When operating the computer, <模板内容>`。只在操作电脑的语境里出现，不进普通聊天的指令；没设人格时指令与以前一字不差。

### 视觉分析预处理：在主运行开始前做，不嵌套

`packages/adapters/src/media-analysis.ts` 是新的分析器，照 `apps/api/src/translate.ts` 的 `createTranslator` / `translateOnce` 形状写：

- 触发：当前回合有图片块就走 `image` 角色，有视频文件块（`video/*`）就走 `video` 角色，每一个附件都分析，不只在用户问起时分析。
- 顺序：`appliedModelRole` 取出主池再备池，逐个经 `resolveConnectedRunModel` 解析；一次一模型，失败就换下一个；30 秒超时；用量按 `setup` 操作记账。
- 图片：沿用现成的 `loadCurrentTurnImages` 读字节，`sharp` 先压缩再送：长边约 1024px、JPEG 质量约 80。`sharp` 已是 `packages/adapters` 的依赖，不新增依赖。
- 视频：从 artifact store 读字节写临时文件，`ffprobe` 取时长，按约每 10 秒一帧、最多约 8 帧选时间戳，`ffmpeg -ss` 逐帧抽图，同样经 `sharp` 压缩后当图片组送出，提示词要求按时间顺序汇总。临时文件用完就删。
- 失败不炸运行：没配视觉模型、或池里模型全失败时，注入一句短注记（“The attached image/video could not be analyzed: <原因>”）继续跑。`ffmpeg` 在运行时缺失时同样只注入注记，不崩溃。
- 分析结果以 `mediaAnalysisContext` 字段穿进 `userTurnInstructions`，成为一段带标签的上下文块；绝不改写用户消息原文。

关键一点：预处理发生在主 `runtime.run()` 调用之前，是顺序执行的两个调用，不是嵌套调用——主运行还没开始时分析已经做完，所以不存在嵌套 `runtime.run()` 死锁的问题。`run_subagent` 的嵌套 Agent 是另一条机制（工具循环里的子 Agent），与这里无关。

### 主模型永远不收原图

带图片或视频附件的回合，主运行不再传 `currentTurnImages`：分析文本就是主模型看到的全部视觉内容。历史回合的图片水合（`withRecentTurnImages`）不受影响，它只在主模型看图时才发生。代价见 Consequences：视觉能力强的主模型在这些回合里也只能读分析文本。

### ffmpeg 进镜像

`infra/compose/Dockerfile` 加 `apt-get install -y --no-install-recommends ffmpeg`。这是部署层面的改动：镜像要重建才会生效；旧镜像里没有 `ffmpeg`，视频分析在旧镜像上只会注入“无法分析”注记，不会崩。

## Alternatives considered

- **识别放在主运行里、让主模型自己看图**——最省事，什么都不用加。但主模型是纯文本模型，今天就是这么失败的；而且“主模型永远不收原图”是用户定下的要求，这条路直接违背它。
- **分析失败就让整个运行失败**——最诚实，失败就是失败。但用户发一张图就想让整轮对话作废的代价太高；识别只是上下文补充，主模型靠注记仍能继续对话、并能告诉用户图没看成，所以失败时降级为注记。
- **视频整段送模型**——省去抽帧，模型自己看全片。但视觉模型吃的是图片输入，不是视频流；抽关键帧是唯一可行的输入形状。约每 10 秒一帧、上限约 8 帧是成本与覆盖的折中。
- **人格存在 Bot 行上（`Bot.promptTemplateId` 那种）**——已有现成的字段形态，改动最小。但人格是成员级的设置：同一个成员在不同机器人上操作电脑时是同一个人格；放 Bot 上会变成每个机器人各设一份，与“成员级、账号/空间作用域”的要求不符。
- **人格复用 `models` 那个 Space 覆盖开关**——少加一个设置项，开关现成。但开关一开，模型和人格的覆盖会一起开、一起关：用户只想让某个空间用不同人格时，会被迫同时覆盖模型；只想覆盖模型时，人格也被迫跟着走。独立开关才让两个覆盖互不干扰。
- **人格不走新表，用 `SpaceSetting` 机制存**——`SpaceSettingOverride` 表只有开关，没有地方放模板 id；值总得有个表。多一个开关值、少一对表是省不掉的，语音偏好（`UserVoicePreference` / `SpaceVoicePreference` + `voice` 开关）就是现成先例，照抄它。
- **人格子句放进 Bot 的 instructions**——不用改执行器。但 Bot instructions 是所有聊天的指令，人格会漏进普通聊天；电脑模式是模型切换、不是提示词切换，执行器侧追加限定子句是唯一能把它钉在电脑语境里的位置。
- **预处理嵌套在主运行里调用 `runtime.run()`**——看起来更“集成”。但主运行进行中再开一个同 runtime 的 run 是不必要的风险；预处理在主运行开始前顺序执行，拿到同样的效果且没有嵌套，死锁问题不存在。

## Consequences

- **收益**：图片/视频附件不再让运行失败；视觉能力由可配置的角色池承担，主模型保持纯文本；电脑人格与普通聊天彻底隔离，没设时零变化。
- **代价与已知上限**：
  - 带附件的回合主模型只能读分析文本，得不到原图细节；分析模型看错时主模型也会跟着错，且没有回退到原图的路径。分析质量上限就是所选视觉模型的上限。
  - 每次带附件的回合都多一次视觉模型调用（图片还多一次压缩），成本与延迟随附件数涨；视频最多 8 帧，长视频只看得到稀疏采样。
  - `ffmpeg` 只在新镜像里有；部署前旧镜像上的视频分析一律注记失败。镜像重建是本次改动的部署前提。
  - 人格模板内容是用户写的提示词原文，原样进指令；模板被删时人格行级联删除，执行器读不到就当没设。
- **需要重访的信号**：视觉模型开始支持视频直传输入时，抽帧可以退役；主模型换成视觉模型后，“不收原图”这条规则值得重议。

## Verification

- `packages/contracts/src/model-roles.test.ts`：新角色进枚举、视觉门控、池顺序。
- `packages/db/src/model-roles.test.ts`：`appliedModelRole(..., "image")` 用内存替身往返；`packages/db/src/model-roles.postgres.test.ts`：同名真实往返（需数据库）。
- `packages/db/src/computer-persona.postgres.test.ts`：人格往返 + 空间覆盖 + 模板归属校验（需数据库）。
- `packages/adapters/src/media-analysis.test.ts`：sharp 压缩尺寸/质量、关键帧时间戳选取、模型兜底链（首个失败→第二个成功；全失败→注记注入、运行继续）、分析文本进运行上下文；视频抽帧用真实 `ffmpeg` 跑。
- `packages/adapters/src/executor.test.ts`：`userTurnInstructions` 有人格时含限定子句、无人格时不含；`mediaAnalysisContext` 进指令。
- `apps/api/src/models-backups.test.ts`：`models.computerPersona` / `models.setComputerPersona` 往返。
- `pnpm verify-notes` 通过；Biome 覆盖改动文件。

## Long-press the needs-attention pill to cancel stuck runs

**Problem.** The "Needs attention" pill marks chats whose runs are stuck waiting on the user (`waiting_input` / `waiting_takeover`), but the only way to clear it was to find the thread and tap its Stop button, which is not obvious — so the pill stayed there forever.

**Decision.** Long-pressing the pill cancels the stuck runs behind it immediately, with no confirmation dialog. On mobile the jump pill gains an `onLongPress` that calls `threads/stop` once per waiting bot counted by that edge of the pill (the same RPC the thread's Stop button uses), then refreshes the inbox (`refreshBots` + `loadActivity`) so the pill clears. A failed stop leaves its pill in place and reports "Failed to stop work". The pill carries the waiting bots' ids through the existing signal path (`InboxSignal.attentionBotIds` → `JumpPill.attentionBotIds`), so the gesture cancels exactly the runs the pill counted — including every bot in a pinned strip — and nothing else. Web has no jump pill, so its closest equivalent is right-clicking the "Needs attention" section header in the activity list, which cancels every run in that section the same way and refetches the feed so the section clears. The gesture is discoverable only through the pill's accessibility hint on mobile; no visible copy was added.

**Alternatives considered.**
- *A confirmation dialog before cancelling, strongest reason:* a long-press is easy to hit by accident and cancelling kills in-flight work. Not used: the user explicitly decided no confirmation, and a stop that was a mistake is recoverable by starting the work again, while a dialog would defeat the one-gesture clear the pill exists for.
- *Navigating to the thread instead of cancelling, strongest reason:* it reuses the existing, visible Stop button and cannot cancel the wrong run. Not used: it is the status quo the user complained about — the pill would still stay until the user hunts the thread down.
- *A per-run cancel affordance on each attention row, strongest reason:* it cancels only one run at a time, so a mistaken tap costs less. Not used: the pill is a count over several stuck runs, and the requested gesture is one action that clears the whole pill; per-row cancel would leave the pill up until every row was visited.
- *A new server endpoint that cancels by pill or by run id, strongest reason:* it could target exactly the waiting runs and nothing else. Not used: `threads/stop` already cancels every active run in the thread, waiting ones included, so a new endpoint would duplicate a working path for no gain.

**Consequences.** The pill becomes a one-gesture clear for stuck runs on both surfaces. The mobile long-press and the web right-click are hidden gestures with no visible affordance beyond the mobile accessibility hint; users who never long-press or right-click will not find them. Cancelling is all-or-nothing per pill edge (mobile) or per section (web) — there is no way to cancel one of several stuck runs from the pill itself; that still needs the thread's Stop button. A failed stop keeps the pill visible, so a persistent pill after a long-press means the stop did not go through.

**Verification.** Mobile tests 94 passed (pill ids per edge, long-press wiring, one `threads/stop` per waiting bot then refresh, failed stop still refreshes and is reported, pill clears once the bot's status clears, locale parity for the new hint string); web tests 5 passed (right-click stops the bot and group runs and the section clears after refetch). Biome clean on all touched files; typecheck clean on all touched files (remaining errors are pre-existing or from the parallel worker's in-flight contracts change). Not verified on a device or against a live server.

## Vault scope: the account card counts the vault the thread's Space uses

**Problem.** The composer's "Account management" card and the vault page it opens both sent an explicit `space` scope whenever a Space was open, so in a Space without its own vault they counted and listed an empty Space vault while the saved items sat in the account vault (verified on the server: 2 items). The card and the vault page agreed with each other; both disagreed with the vault the bots actually read and write.

**Decision.** Vault calls for a Space target send no scope, letting the server resolve the effective vault (`packages/adapters/src/bot-secrets.ts` `vaultFields` → `spaceSettingOverride` for `credentials`: Space's own vault when customized, the account's otherwise). The account target still sends explicit `{scope: "account"}`. The request stays pinned to the Space via `settingsRpc`, so a Space with an override still uses its own vault. One shared helper, `vaultScopeBody` in `apps/mobile/lib/settings-target.ts`, is used by the card count and by every vault call in the vault page (list, put, cookie import, reveal, remove), so no call can drift to a different partition.

**Alternatives considered.** *Resolve the override client-side via `spaceSettings/overrides` and pass the explicit scope:* rejected first because it adds a round trip on every focus, introduces a race between the override read and the vault read, and duplicates the server's single source of truth; the server already defines omitted-scope resolution and every other reader (bots, secret-ask import, web account vault) relies on it. *Fix only the card to match the vault page:* rejected because the vault page itself was reading the wrong partition — matching it would have kept the vault empty. *Keep explicit scope but fall back to the account vault when the Space vault is empty:* rejected because an empty Space vault is legitimate (a Space that customized credentials but saved nothing yet), so emptiness cannot distinguish "no own vault" from "own vault, nothing saved".

**Consequences.** In a Space without a credentials override, the card count and the vault page now show the account vault — the same items the bots use — and saves from the vault page land in the account vault. In a Space with an override, behavior is unchanged (its own vault). The account vault page (no Space) is unchanged (explicit account scope). The `BotEmailAddressesGroup` gate still keys off the target scope, not the effective vault.

**Verification.** Mobile vitest: 50 passed (composer chips 14, vault settings 21, vault helpers 15), including new tests for a Space without its own vault (card counts the account's 2 items; vault page lists them with no scope sent) and a Space with its own vault; the new card test fails on the pre-fix code. Biome clean on all 5 changed files.
