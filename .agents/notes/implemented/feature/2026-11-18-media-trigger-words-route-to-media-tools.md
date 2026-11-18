# Agent Note: 触发词命中直接走媒体工具，聊天模型本轮不参与

Status: implemented

## Problem

前两修都已部署（[异步视频生成](../../implemented/feature/2026-11-18-async-video-generation-for-bot-media.md)；[提示词指引 + 工具描述](../../implemented/feature/2026-11-18-media-tool-guidance-in-system-prompt.md)），但两次网页版真聊验证（20:49、21:32）都失败：聊天模型（经免费网关的弱模型）仍然不调 `generate_video`，而是自己写脚本直调智谱接口；第二次还撞上 429。提示词指引没能让弱模型改道。用户点明：关键是生成视频根本没走视频模型。

用户拍了具体方案：消息里包含指定触发词就直接走媒体工具；触发词做成可配置的设置，放在影图模型设置处，视频、图片各一栏，多词用 `|` 隔开；触发后不要再把这条消息当对话交给聊天模型，而是直接调机器人配好的对应媒体模型走媒体处理路径。

另有用户追加的核查要求：提示词预设与补充提示词必须真的起作用；对照 App / 服务端已有的影图模式能力，检查网页版是不是缺了东西，缺的补上。

## Decision

触发词路由，命中即短路，聊天模型本轮不参与：

- Bot 新增 `videoTriggerWords` / `imageTriggerWords`（`String?`，`|` 隔开）。默认值：视频 `生成视频|生成一段视频`，图片 `生成图片|画一张|画一幅`。空值或全空时用默认值；用户在设置里改空字符串不代表“禁用”，只代表回到默认。默认值只在 `packages/contracts/src/domain.ts` 定义一份，服务端、网页、App 都从那里取。
- `packages/adapters/src/media-intent.ts` 提供 `parseTriggerWords(value, fallback)`（切 `|`、去空白、去空项）与 `matchMediaTrigger(text, videoWords, imageWords)`：在全文里找最早出现的位置，同一位置取最长的词，再平手视频优先；命中后去掉触发词首次出现、剩下的文字 trim 后当 prompt；剩下为空（消息只有触发词、没有内容）时不路由，走正常对话。`matchBotMediaTrigger(text, bot)` 直接读机器人存的触发词。
- 执行器在 `deps.runtime.run(...)` 之前短路（`packages/adapters/src/executor.ts`）：只对 `user` / `follow_up` 触发且来源消息是用户发的 run 生效；命中后调 `applyTool(ctx, "generate_video" | "generate_image", { prompt }, "media-trigger:${runId}")`，即模型调工具走的同一分发入口（同一审批门、同一处理函数、同一审计）。审批要卡时 `pausePending` 为真，直接返回等用户批，批后恢复重跑仍走同一短路；媒体调用失败时抛错进 `failRun`；成功时把 `ctx.state.reply.publishedMidTurnUserMessage` 置真再调 `completeRun`，不补“done.”之类的空回复气泡，媒体消息本身就是本轮回复（视频排队时结果由后台轮询任务稍后挂进对话）。
- 提示词预设与补充提示词不另起机制：触发路由走 `applyTool` → 已有媒体执行路径，当前选中预设在 `resolveBotMediaKind` 里由 `withPromptPreset` 拼进 prompt（生图同步调用与视频异步提交同一处），重新生成时服务端重新解析 provider 同样带预设；补充提示词是按生成物存的，只在重新生成时由服务端拼到原 prompt 后面，新触发的生成还没有生成物，无补充提示词可带。
- 设置入口放在影图模型设置处，视频、图片各一栏：服务端 `UpdateBotInput` 加两个可空字符串字段（`max(500)`，空串存 null），`apps/api/src/routes/bots.ts` 按现有预设字段的写法校验保存，`packages/db/src/repos.ts` 的 `mapBot` 把两字段带进返回的 Bot；网页 `apps/web/src/pages/shell/bot-panel.tsx` + `bot-settings-sections.tsx` 与 App `apps/mobile/app/bot-settings.tsx` 各加两栏，App 的 `Bot` 类型同步加字段。触发词只认配置，不再写死。迁移 `20261202121900_bot_media_trigger_words` 只加两个可空列，旧版代码不受影响。
- 网页版补齐一项核查出的缺口：机器人 `showMediaFavorite` / `showMediaShare` / `showMediaPreview` / `showMediaDownload` 四个开关，App 侧已在用，网页版媒体结果从来不读，按钮永远全显；`apps/web/src/pages/shell/media-result.tsx` 按机器人配置显隐四个按钮（缺省为显示），关掉预览时点图也不打开，`message-view.tsx` 从 `peerBot` 取开关传进来。

## Audit: 提示词预设与补充提示词已生效，无缺口

核查结论（只读代码核对，未改）：

- 提示词预设：`resolveBotMediaKind`（`packages/adapters/src/bot-media-generation.ts`）在每条媒体调用里用 `withPromptPreset(preset.prompt, prompt)` 拼提示词，生图同步调用与视频异步提交共用同一处；后台视频轮询重解析 provider 时同样带预设；重新生成（`apps/api/src/routes/media.ts`）重新解析 provider，注释明说预设在 provider 调用内应用。网页与 App 都能在设置里编辑、多套点选切换，聊天里媒体标题栏也能切。
- 补充提示词：按生成物存（`media.setSupplementaryPrompt`），重新生成时服务端读出来拼到原 prompt 后面（`media.ts`），再进 provider（预设也一并应用）；结果里透传，随生成物保留。网页 `media-result.tsx` + `media-rpc.ts`、App `media-supplementary.ts` + 媒体标题栏都有。
- 网页版与 App 的影图模式能力对齐情况：影图模型有序列表与备选、提示词预设编辑与点选、媒体标题栏（当前模型 + 预设切换）、补充提示词与重新生成，两边都有；只缺触发词设置（本次新加，两边一起加）与上述 `showMedia*` 显隐开关（本次补上）。

## Alternatives considered

- **首个模型调用强制 `tool_choice` 为媒体工具** — 最省事的改法，模型仍自己写 prompt，提示词预设、备选、结果下标都照常。否掉：Pi 的 Agent 根本没有 toolChoice 概念（`ToolChoice` 只声明 `"auto" | "none"`），函数式强制要靠类型断言赌适配器原样透传；网关是否认 `tool_choice` 未知，弱模型即使被强制也可能写出不合格参数或空转。用户也明确选了关键词触发，不再赌模型与网关。
- **自动意图识别（动词 + 媒体名词的模式匹配）** — 不用用户配触发词，“生成/画 + 视频/图片”就路由。否掉：用户明确要可配置的触发词；关键词子串匹配确定性最高，误判面最小；模式匹配的边界（“生成视频脚本”是写脚本不是出片、“刚才生成的视频呢”是问旧物）要靠一堆例外规则兜底，修不完。
- **只收窄首回合 offered tools（只给媒体工具）** — 模型没了 shell 可选。否掉：仍可以只回文字不调工具，保证不了“必须走媒体工具”。
- **换工具调用更稳的主模型** — 长期选项。否掉：换模型是选型与成本决定，且当前限流下任何模型都出不了片，不解决路由问题。
- **不做，等限流过去再测** — 限流只是第二层问题；没限流时模型同样没调工具。等不能解决问题。

## Consequences

- 消息含“生成视频”或“生成一段视频”时，本轮不调聊天模型，直接调机器人配好的视频模型走异步视频路径；含“生成图片 / 画一张 / 画一幅”时走生图路径；触发词去掉后剩下的文字就是 prompt。
- 触发词在网页与 App 的影图模型设置里改，视频、图片各一栏，多词用 `|` 隔开；改完即对后续消息生效。触发词设置是机器人级：同一机器人在网页与 App 共用同一份配置，改一处两边都生效。
- 触发时当前选中的提示词预设仍拼进 prompt；重新生成时补充提示词仍起作用。
- 不命中触发词的消息行为不变；只说触发词、后面没内容时走正常对话。
- 网页媒体结果的收藏 / 分享 / 预览 / 下载按钮按机器人开关显隐。
- 触发词是子串匹配，不做语义判断：消息里提到触发词就会路由，哪怕是否定（“不要生成视频”）或引用别人说的话。用户选的就是这个确定性做法；缓解靠用户自己改触发词，不另加否定判断。
- 视频排队时本轮没有任何文字回复，结果由后台轮询任务稍后挂进对话；用户在结果出来前看不到“正在生成”的提示。
- 审批仍按现有规则走：机器人媒体工具若被配成要审批，触发后先出审批卡，批了才生成；不改审批规则。
- 旧版 tool_choice 方案的笔记已删，其理由收进本篇备选方案；`media-intent.ts` 的旧版意图识别与 `pi-runtime.ts` 的 tool_choice 接线已随改版清掉。

## Testing

- `media-intent.test.ts` 新写 8 个用例（切分与回退、视频/图片路由与剥词、普通聊天与空触发词不路由、最早与最长优先、自定义词大小写不敏感、机器人存词与默认回退），全过。
- 相关套件：`bot-media-generation`、`media-generation-tools`、`media-generation-provider`、`executor-completion`、`run-tools`、`domain`（contracts）、`bots`（API）、`bot-panel`、`media-result`、`message-view`、`media-model-group`、`GroupPanel`、`bot-roster`、`chat-model-picker`、`inbox-spaces`，共 167 + 144 项，全过。
- `executor.test.ts` 的 4 个失败是已知基线（`userTurnInstructions` 期望缺模型连接 clause，父提交已如此），无新增。
- `verify-notes` 三线过。Biome 格式化过。
- tsc：adapters 与 api 只剩已知的 `voice-factory.ts` 2 个基线错误；contracts、db、web 干净；mobile 只剩 6 个与本次无关的基线错误（`usage-detail` 的 `totalOnlyCalls`，`decfec3` 同款代码就缺）。
- 未做端到端真聊验证：触发路由需部署后在网页版实测（发“生成一段视频：…”看是否直接出片、不经过聊天模型）。
