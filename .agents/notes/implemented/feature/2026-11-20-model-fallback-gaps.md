# Agent Note: 模型切换缺口补齐——电脑操作切备选、全失败留时间线、全家族当前模型栏统一入口、翻译备选 UI、细节修改无限改 + 真图生图、备选池走完、预设标签、备选收纳栏

Status: implemented

## Problem

用户 2026-11-20 连续多次加范围（07:49、07:51、07:52、07:58、08:01、08:02、08:10、08:14、08:17、08:20），核心一句话：**模型失败要自己切备选、切了要有记录可看；细节修改要能无限改、而且必须是真改图不是重画。** 2026-11-19 23:47 代码审计 + 网页实测的缺口：

- 电脑操作选时能挑备选，跑起来失败直接报错（`pi-runtime.ts` 的 `computerFallbackState` 里 `fallbackModels: []`、`switchAttempts: undefined`），无时间线。
- 时间线只在最终成功且中途换过模型时才存在：`buildModelSwitches`（`packages/core/src/model-switches.ts`）要求必须有一次 `succeeded` 才返回；全失败时没有任何记录，只能看报错文字；失败的 run（`finalizeRun` 的 `failed` 分支）根本不接受 `modelSwitches`。
- 翻译能切（`bot.translationModels`，每模型 2 次、30 秒超时），但网页翻译栏目只有一个主模型选择器，没有加备选的入口；API 早就支持 `translationModels` 整表（`apps/api/src/routes/bots.ts` 的 `legacyTranslationModels` 注释写明“New clients send the whole list instead”），但没有任何客户端发过它。
- 生图结果卡片有独立的“切换记录”按钮、翻译在翻译面板里，但各家族的“当前模型”栏没有统一入口；聊天栏点开是模型选择器；电脑操作在网页上根本没有模型栏；对话框里的模型名只有主模型时间线能点、定位到模型列表那一行。
- 图片点“细节修改”只能改一次：`media-result.tsx` 的 `startEdit` 读到存过的补充提示词就不弹窗、直接拿旧提示词重跑；publish 又把补充提示词存进新图的 job，所以改完的新图永远自带旧提示词，再点只是重复上一次。
- 细节修改语义（用户 08:02 两次强调）：必须是图生图——拿当前这张图、按新提示词让编辑模型改这张图，绝不是重新随机。链路核实到最后一步发现：原图字节确实一路传到了 `entry.call(prompt, signal, references)`，但 `generateMediaWithChatModel`（`pi-openai-compatible-provider.ts`）走的是 **chat completions**，把原图当 `image_url` 内容块发给模型；智谱的 cogview-3-flash / GLM-Image 是纯文生图模型，没有图生图能力，输入图被忽略、按文字重画一张——这正是“改出来像重新随机”的根因。
- 备选池走完（用户 08:10 问“怎么感觉就切一两个”；08:17 用户亲口给设计权：“自动切换由我们自己设计，要求就是能切完池子；图片和视频要求不同就对应设计，不用再问用户”）。
- 提示词预设占位置太大（用户 08:14）：图片/视频预设现在整段显示，改成标签。
- 备选模型列表占位置（用户 08:20）：备选多了以后列表太长，收进可收起的收纳栏。

相关笔记：[按连接定位模型](../../implemented/feature/2026-11-16-model-locate-by-connection.md)、[影图重新生成分两个模式](../../implemented/feature/2026-11-19-media-two-modes-async-regenerate.md)、[重新生成实时显示缺口](../../implemented/feature/2026-11-19-media-regenerate-live-display-gap.md)。

## Decision

### 1. 电脑操作失败也切备选

- 新增 `resolveComputerRunModels`（`computer-model-settings.ts`）：与 `resolveComputerRunModel` 同一套循环（`appliedModelRole(..., "computer")` 的 `[primary, ...backups]` 顺序、逐个过 `computerTarget` 检查），但收齐**全部**可用模型而不是只取第一个；旧函数改成取它的 `[0]`，调用方不动。
- Executor（`executor.ts`）在建 run 时解析整表：`computerModel` 仍是第一个（暂停恢复时仍用 pinned 的），其余进请求的新字段 `computerModelBackups`（provider/id/connectionId 三元组，与聊天 `fallbackModels` 同形）；另传已解析好的整表给新的 `resolveComputerModel` 解析器（按三元组查表返回，不再二次鉴权）与新的 `computerModelSwitchAttempts` 数组（run state 新字段，`run-context.ts`）。
- `pi-runtime.ts` 的 `computerFallbackState`：`request.fallbackModels` 改成电脑备选、`request.resolveFallbackModel` 改成电脑解析器、`switchAttempts` 改成电脑数组；`onSwitch` 抽成带 `computerMode` 参数的公共实现，电脑态切换时调 `request.onModelChange(provider, id, true)`——否则 executor 会把电脑备选当成聊天模型校验（“Model is not selected”）并错误地改写 run 的模型。Executor 的 `onModelChange` 在 `computerMode` 为真时也接受电脑备选，且不更新 run 模型（电脑模式是主模型的 detour，run 模型不变）。
- 电脑切换同样受 `fallbackAwareModelStream` 的既有规则约束：工具调用开始后不切、首字 60 秒 / 断流 30 秒才切、同模型重试退避；失败与跳过都记进电脑数组。
- 时间线落盘：`run-turn.ts` 完成时 `buildModelSwitches(ctx.state.computerModelSwitchAttempts)`，经 `finalizeRun`（completed 分支新字段 `computerModelSwitches`）→ `createThreadMessageInTransaction` → Message 表新列 `computerModelSwitches Json?`（迁移 `20261202122100_message_computer_model_switches`，纯新增可空列，旧版本不读写它）→ `ThreadMessageSchema` 同名字段 → `thread-message-pages.ts` 回读。聊天与电脑时间线分字段存放，各家族相互独立。

### 2. 全失败也留切换记录

- `buildModelSwitches` 去掉“必须有一次成功”的门槛：只要 `attempts` 非空就返回；`finalModel` 取最后一次尝试的模型（全失败时即最后试过的那个）。单模型重试仍只留最新一条（`recordModelSwitchAttempt` 的去重规则不动）。
- `FinalizeRunInput` 的 `failed` 分支新增 `modelSwitches?` 与 `computerModelSwitches?`；`finalizeRun` 在有 `partialReply` 时把时间线挂在那条消息上（与 completed 分支同一写法）；`run-turn.ts` 失败路径传入两边数组的构建结果。
- 没有 partial 文本时没有消息可挂——**不伪造消息**。时间线仍进 `run.failed` 事件的 payload（`{ error, modelSwitches?, computerModelSwitches? }`），留作记录；网页目前不渲染失败 run 的行（只发浏览器通知），所以这种情况下时间线在事件里可查、线程 UI 里暂不可见，是已知缺口，见 Consequences。
- 对话框全失败行的文案修掉：原来 `attempts.every(outcome !== "succeeded")` 时仍渲染绿色 ✓“Finished, current model”，全失败配成功样式是错的；改成 destructive 标记的“All models failed”行（模型名仍可点定位）。

### 3. 翻译备选端到端 + 全失败也可见

- 服务端翻译链不用动（`createTranslator` 已按 `bot.translationModels` 顺序试）。改两处：
  - 全失败时 attempts 随错误带出来：`createTranslator` 全失败改抛携带 `attempts` 的错误；`bots.translate` 路由把它转成带 `data: { attempts }` 的 `ORPCError`（oRPC 客户端透传 `error.data`，实现时以客户端实际收到的值为准）；网页 `useMessageTranslation` 的 error 状态读到 attempts 时，在错误面板里同样渲染 `ModelSwitchHistoryEntry`（kind="translation"），而不是只剩一行报错。
  - 网页设置补入口：`TranslationGroup`（`bot-settings-sections.tsx`）在主模型选择器下加备选列表，复用 `MediaModelFallbackList`（把 `test`/`onTest`/`onApplyTestedModel` 改成可选——翻译备选没有媒体那种 capability 探针，不画 Test 按钮）；`bot-panel.tsx` 新增 `translationModels` 状态（以 `bot.translationModels` 为初值，主模型选择走 move-to-front），保存时发 `translationModels` 整表（API 已支持），`savedAdvanced` 比对里加上它；翻译备选也进定位候选（见 §4）。

### 4. 全家族“当前模型”栏统一入口 + 模型名可点定位

- 入口形式统一成已有的 `ModelSwitchHistoryEntry`（“当前模型: X · provider ›”，点开同一对话框）与无时间线时的 `ModelSwitchMarkButton`（定位到模型列表）：
  - 聊天：`message-view.tsx` 早已是这个写法（有 `modelSwitches` 走 Entry、无走 MarkButton），本次不动 UI，只靠 §2 让全失败的消息也能拿到时间线。
  - 生图/视频：`media-result.tsx` 的 `markLine` 原来是模型选择菜单 + 右侧独立的“Switch history”按钮；改成有 `modelSwitches` 时栏本身就是 Entry（kind="image"|"video"），无时保持 `ModelSwitchMenu` 选择器。切换生成模型的菜单仍在预览标题栏里，不丢。
  - 图片/视频编辑：结果卡片不区分生成与编辑（`MediaResult` 的 kind 只有 image/video，`models` 恒传生成列表），所以不新加 kind；定位时 bot-panel 对 image/video 各查**两张表**（生成列表 + 编辑列表），命中哪张就滚到哪节——编辑节的 `data-model-section` 改成独立的 `"imageEdit"`/`"videoEdit"`（`MediaRoleSection` 新增 `section` 属性，默认等于 kind），编辑节也接 `locatedKey`/`locateKind`。
  - 翻译：面板里已有 Entry（`message-translation.tsx`），本次只补 §3 的全失败可见与备选列表定位。
  - 电脑操作：网页原来没有电脑模型栏；回复消息带 `computerModelSwitches` 时，在聊天栏下方再渲染一行 Entry（kind="computer"）。电脑模型是**成员级**模型角色（`userModelRoleChoice` / `spaceModelRoleChoice`，不是机器人列表），定位目标是成员模型设置页（`ModelRoleSettings.tsx` 的 computer 节），不是机器人设置——线程视图的 `onLocateModel` 对 kind="computer" 改走该页（实现时以该页实际的节锚点为准）。
- `ModelLocateKind` 扩展为 `"chat" | "translation" | "image" | "video" | "imageEdit" | "videoEdit" | "computer"`；对话框里的模型名本来就可点（有 `onLocateModel` 时渲染成按钮），本次是把各家族的 `onLocateModel` 与 kind 接全，而不是重做点击。

### 5. 视频链能力校验：不改代码

- 核实结论：没有任何可靠的逐模型能力信号。`resolveBotMediaKind` 只校验连接（baseUrl）与协议；`MediaGenerationProvider.capabilities` 是提供方级（支不支持图/视频），不是逐模型；智谱 `/models` 不返回媒体模型。硬加校验只能靠模型名启发式猜，猜错会拦掉能用的模型。最小诚实版就是不改；真正的清理已在线上配置里做完（主模型改回 cogvideox-flash、两个聊天模型备选已删）。链路本身已做到失败即记、换下一个、全失败列出原因。

### 6. 图片细节修改：无限改，每次都弹窗

- 网页 `media-result.tsx` 的 `startEdit`：图片也每次都弹窗（原来只有视频或补充提示词为空才弹窗）；框里预填当前那句补充提示词，可改；提交走已有 `submitEdit`（提示词变了先存、再以当前 artifact 调 `regenerateMedia(mode="edit")`）。
- 后端链路已支持连锁编辑，不用改：regenerate 处理里图片编辑传 `sourceArtifactId: artifact.id`（即当前卡片那张最新图）；job 行存 `mode` 与 `sourceArtifactId`；poll 时 `loadMediaReferences` 按 `sourceArtifactId ?? referenceArtifactId` 取字节；新 job 的 result 里带上本次补充提示词，所以新图的卡片下次弹窗预填的是最新那句。视频不受影响（本来每次都弹窗）。

### 7. 细节修改必须是真图生图（08:02 语义纠正）

- 核实结论（见 Alternatives）：链路没丢字节，丢的是**能力**。`requestChatMedia` 把原图以 `image_url` 内容块发到 chat completions；智谱 cogview-3-flash / GLM-Image 是纯文生图模型，没有图生图能力（智谱文档的 images/generations 参数表里没有 `image` 入参；DSH Imagegen 插件 README 明确写 GLM-Image“当前不支持图生图”，选编辑模型时自动排除；实测文章同样结论：免费档 cogview-3-flash“只能文生图，没有换背景/风格迁移的编辑能力”）。输入图被忽略、按文字重画——所以改出来像重新随机。**换哪种请求格式都救不了这两个模型**，因为能力不在模型身上。
- 修法（不换模型、不加付费模型的前提下能做到的最诚实版）：
  - 在 `generateMediaWithChatModel` 里加守卫：调用带 `references`（即编辑）且模型属于已知纯文生图家族（`cogview-*`、`glm-image`，按模型 id 匹配、与走哪个 host 无关，中转也一样）时，**不发请求**，直接抛 `MediaGenerationError("unsupported")`。`tryCalls` 会把它记成一次失败尝试、换下一个编辑模型——编辑列表里一旦配了能真编辑的模型（见下），链子自动走到它；只有一个不能编辑的模型时，全失败报错里会写明原因，不再悄悄还一张重画的图。
  - 同一套 chat 路径对真正的多模态聊天模型就是真图生图：带 `image_url` 输入、回 edited image。所以编辑列表里配了真正多模态聊天模型即可真改图，不用改请求格式；守卫只拦已知不行的家族，不拦别的模型。具体配哪一款模型是用户自己的事，本批不追踪、不作部署前置。
  - 模型归用户（2026-11-20 09:23 用户亲口）：功能（切换链、两池、守卫、时间线、收纳栏、标签）不依赖任何具体模型配置就能成立；代码与界面里不加“去配某某模型”的提示，也不把某个模型的配置当部署前置。守卫是能力层面的诚实处理，按模型 id 家族匹配（`cogview-*`、`glm-image`），家族能力变了要复核（如同家族出新一代模型支持图生图时，守卫须更新）。部署验证按当时实际配置测功能：编辑列表里仍只有不能编辑的模型时，预期的正确结果就是诚实报“不支持图生图”——那是功能在起作用，不是失败。
  - 设置里的编辑模型 Test 按钮目前测的是“能不能生图”（`probeMediaModel` 不带 references），测不出能不能编辑——本次把探针的 edit 测试改成带一张参考图测（见 Consequences 的范围说明；若改动超出本次最小范围则只记不做）。
- 不动的线：视频编辑是另一条路（上传参考帧走 `submitAsyncVideo` 的 `firstFrame`），本次只说图片编辑，不混在一起。

### 8. 对话备选池必须能走完（08:10 用户问“怎么感觉就切一两个”）

- 先纠正一个中间结论：**切换路径本身没有预算门槛，也没有“只切两次”的硬上限。**核实（`pi-runtime-fallback.ts` 的 `run()` 循环 + `pi-runtime-limits.ts` + `adapter-kit/src/model-errors.ts`）：
  - `resolveNext` 按 `fallbackModels` 顺序逐个取，无数量上限；`nextIndex`/`attempted` 跨整条 run 共享（不是每步重置），所以备选池在一次 run 内按顺序耗尽，不会重复试同一个。
  - 120 秒 `MODEL_STREAM_TIMEOUT_MS` 是**每次 `fallbackAwareModelStream` 调用**共享的 `startedAt` 预算，但循环顶的门（`(retries > 0 || sizingFailure) && remainingMs <= 0 && failure`）只在**同模型重试 / 调整尺寸**路径上触发；两处切换分支（无输出失败、断流后失败）切换前不查预算。首字 60 秒 / 断流 30 秒是每次尝试各自的 idle 看门狗，每次尝试重新计时。
  - 所以“主模型加一个备选卡两次就到顶”作为切换机制是错的——切换不会被 120 秒掐断。预算真正掐断的是：**池子耗尽后，最后一个模型的同模型瞬时重试**（`remainingMs <= 0` 时拒掉退避重试），以及 `sizingFailure` 残留时会让循环顶把**上一个模型的旧错误**当作终态发出。
  - 链子实际在这些地方停下来（全部已核实）：
    1. 池子耗尽（`nextIndex` 走完）——之后只剩同模型瞬时重试，且受 120 秒共享预算限制。
    2. 失败类型不可切换：400 / 403 / 模型不存在 / 参数无效 / 上下文超限不在 `isRetryableProviderUnavailable` 与 `isModelCredentialRejected` 里——主模型报这类错时**零次切换**，run 直接失败。408 / 429 / 5xx / 超时 / 连接错误才切换；401 走凭证被拒路径切换。分类器不动（见 Alternatives）。
    3. 备选被跳过：无凭证、与本轮不兼容（上下文窗口太小、不接受图片输入、思考级别不支持）、与当前模型相同——记为 `skipped`。
    4. 工具调用已开始——不切（调用发出后去向不定，改主意会错）。
    5. 有可见输出 + 非 idle 错误——走同模型续写（cut-reply continuation），不是切换；只有 idle 超时（首字 60 秒 / 断流 30 秒）才在有输出时切换。
    6. 内层流抛错而非发出 error 事件——`finishWithThrownError` 直接终态，不切换（传输层抛错的残余路径，本次不动）。
    7. 信号被取消（用户停止 / run 取消）。
  - 用户“只切一两个”的感觉另有两处来源：全失败时以前**没有任何时间线**（§2 已修，失败尝试现在可见）；慢卡每次 60 秒，4 个备选走完要几分钟，180 秒的 run 卡住判定（`STUCK_RUN_NO_OUTPUT_MS`，只做 UI 恢复提示、不杀 run）会先跳出来，用户可能在链子走完前就停了 run。
- 修法（只动共享预算，不动 60 秒 / 30 秒单次等待）：
  - 每次切换成功后（两处切换分支，`switchToBackup` 返回后、`restart = true` 之前）**续期当次预算**：`startedAt = Date.now()`、`recoveredIdle = false`、`sizingFailure = undefined`。每个备选因此拿到自己完整的 120 秒重试/尺寸调整窗口：慢主模型（60 秒首字卡）不再吃掉后面备选的重试机会；上一个模型的尺寸失败不再污染下一个模型的终态；每个模型的 idle 重试各有一次续期。
  - 续期点只能放在两处调用点，不能放进 `switchToBackup`——`startedAt`/`recoveredIdle`/`sizingFailure` 是 `run()` 闭包里的 `let`，`switchToBackup` 在其作用域之外。
  - `firstRetryableError` 不用清：它只在池子耗尽的重试分支里才被设置，设置后已无切换可能，清它等于死代码。
  - 单测：在 `pi-runtime-fallback.test.ts` 的 ordered fallback 组里加一例——主模型 idle 超时切备选后，把假时钟推过 120 秒，池子耗尽时最后一个备选的瞬时失败仍能同模型重试（而不是被共享预算拒掉）；另加一例——主模型尺寸失败后切备选，备选的终态不再是主模型的旧尺寸错误。

### 9. 各家族预算与放手条件（08:17 设计权：自动切换由我们设计，要求就是能切完池子）

总原则（用户原话的要求就是能切完池子）：**每条备选一次公平尝试；链子只在池子用完或失败不可重试时停；时间预算按每次尝试算，不让一个全局预算饿死后面的备选。** 图片与视频要求不同，各按其调用形态设计。

- 聊天：见 §8。切换后续期 120 秒重试/尺寸预算；首字 60 秒 / 断流 30 秒单次等待不动；400 / 403 / 模型不存在不切换；工具调用开始后不切；池子用完后只剩同模型瞬时重试（退避 `[2s, 8s, 20s]`，每模型一个 120 秒窗口内）。
- 电脑操作：与聊天同一条 `fallbackAwareModelStream`，§8 的续期规则自动适用；同样工具调用开始后不切。
- 图片（同步调用）：`tryCalls` 顺序走，每模型一次同步调用。每次调用以 `requestChatMedia` 的 60 秒单次超时为界（`modelHealthTimeoutMs()`），超时或失败即记一次 failed、换下一个，同一模型不重试；**没有跨模型的全局预算**，已核实现状即如此，不用改。放手条件：列表走完 → 全失败报错列出每模型原因；列表为空/未配 → `unsupported` 直接报，不进链子；用户取消（signal abort）立即停。图片编辑（imageEdit）同一条链、同一预算。
- 视频（异步提交加轮询）：分两段，现状一半已通、一半要补。
  - 提交段 `tryVideoCalls`（已通，不用改）：先同步调用（同图片，每模型 60 秒）；模型拒同步（`async_required`）才走 `submitVideo`（单次提交同样 60 秒超时）；提交失败记 failed、换下一个。
  - 轮询段（本次新增）：已提交的任务按 `nextMediaPollAt` 轮询（10 秒起、随任务变老拉长到 5 分钟一跳），单次轮询查询 60 秒超时；任务报 `failed` 时**在轮询周期里换下一个模型重新提交**，而不是直接判整单失败；时间线随 job 行带下去（提交时把此前尝试记进 `modelSwitches` 存进 job 行，重提交时续上）。
  - 放手条件：列表走完且无一提交/轮询成功 → 全失败；整单 60 分钟截止（`MEDIA_POLL_DEADLINE_MS`，以 job 创建时间为准，重提交不延期）+ 15 分钟错误宽限；用户取消停链。
  - 实现点（见 Alternatives 的否决项）：`MediaGenerationProvider` 接口加可选方法 `resubmitVideoAfter?(failedModelId, input, signal, priorAttempts?)`——全局 QueueJobProvider 不实现，保持现有行为；`BotMediaGenerationProvider` 实现它（找到失败模型所在列表——生成或编辑——从下一位起复用 `tryVideoCalls` 的循环）；触发点在 `generateMediaFromTool` 的轮询分支（`pollVideo` 返回 `failed` 时），仅当调用方传了 `resubmitUntil`（`pollMediaVideo` 传 job 创建时间 + 60 分钟）且未过期；prompt 从 reservation.request 取，references 由调用方传（再生任务 `pollMediaVideo` 已加载；对话任务无 references）。
- 翻译：不动。`createTranslator` 每模型 2 次、每次 30 秒，走完 `bot.translationModels` 整表；全失败抛错带 attempts（§3）。
- 各家族通用：解析不到（未连接/无凭证）的备选记 `skipped`，不占一次尝试；媒体链内任何一次调用失败都换下一个（不做聊天那种 400/403 分类——媒体错误按 `MediaGenerationError` 码记录）。

### 10. 提示词预设改标签（08:14）

- 现状：机器人设置里的 `PromptPresetSection`（`bot-settings-sections.tsx`）每条预设占一行（名字 + 两行提示词 + 编辑/删除钮）；对话页底表（`media-result.tsx` 预览标题栏的 `PresetSwitchMenu` 下拉 + 消息视图底表里的预设选择）只列名字。`BOT_PROMPT_PRESET_MAX` = 20。
- 改法：两处共用同一套标签组件（新组件，放 `apps/web/src/pages/shell/`，复用现有 Button/Dialog primitives，不另起设计语言）：
  - 一行小标签：默认最多 5 个，超了后面跟“更多”（展开全部，再点收起回 5 个）；末尾跟“+”新增。
  - 点标签 = 选中该预设（现有行为不变）**并**打开查看/编辑对话框：对话框里完整展示提示词内容，含编辑提示词、重命名、删除三个操作；保存即时生效（走现有 `onPresetsChange` / `onActiveChange`）。
  - 设置页：`PromptPresetSection` 改成标签行 + 对话框，去掉每行名字 + 提示词 + 编辑/删除钮；底表：预设选择器同样改标签行，共用组件。
  - 边界（现有规则保留）：预设为空时只显示“+”新增；达到 20 条上限时“+”隐藏；删除当前生效预设 → active 清空；重命名冲突校验、空名/空提示词校验保留。
  - 新增文案走 Lingui：extract + 补翻译 + compile（仓库规矩）。

### 11. 备用模型收纳栏（08:20）

- 规则：每个备选列表包进同一套可收起组件（新组件，放 `apps/web/src/pages/shell/`，先看有没有现成的 Disclosure/Collapsible 可复用，有则复用）；标题行“备用模型（N）”+ 展开/收起箭头；收起时只占一行标题；展开后增删、排序、定位照常。
- 默认状态：列表为空时默认展开（露出新增入口），非空时默认收起（省位置）；状态为本地组件 state，不持久化。
- 覆盖：每家族两节——主池节与备用池节，各有自己的收纳栏。聊天主模型（主池节平时显示当前主模型 + 添加入口）、生图、视频、图片编辑、视频编辑、翻译（§3 的备选入口按 §12 做成两池）、电脑操作成员角色页（`ModelRoleSettings` 的主池行 + 备选行）。
- 不动：主模型选择器本身、备选的增删排序逻辑、定位锚点（`data-model-section` 等）。

### 12. 两池：先主池、后备用池（08:25 方向；08:26 翻译同样两池）

- 方向：自动切换先走完主池（用户加的更多模型），全部失败再切备用池（备份模型列表），走完备用池才算全失败。UI 上主池和备用池分开展示，各有收纳栏；时间线里标明每次尝试属于主池还是备用池。
- 数据结构决策：**两个独立列表**（不是一个有序列表分两段）。
  - 两池是两种不同的承诺：主池模型都是用户主动选的、都可以直接回答；备用池只在主池耗尽时才试。分开存让承诺落在存储上，不只是 UI 上。
  - 操作互不干扰：主池增删排序不动备用池，反之亦然；没有边界计数器可漂移。
  - 链子就是拼接：主池 ++ 备用池；时间线的 pool 标记就是归属，不用按位置算。
  - 迁移规则统一：现有首位/主模型 → 主池（单元素），其余 → 备用池；旧数据零丢失。
  - 否掉（B）一个有序列表分两段：边界是隐藏状态，每次改列表都要维护，错一位就把模型划错池；跨池移动模型变成“下标 + 边界”两步舞；UI 两节实际是一张表的两个切片，重排越过边界线时语义含糊。省下的只是几列，列是便宜的。
- 落点（已核实）：
  - 成员角色（聊天 main、电脑 computer）：行表 `user_model_role_choices` / `space_model_role_choices`，`position` 全局排序，`primary` = position 0、`backups` = position > 0（`packages/db/src/model-roles.ts` 的 `getModelRole`；保存是整表重写 `writeModelRole` 的 deleteMany + createMany）。加可空 `pool` 列（`main`|`backup`，迁移只加列不改数据）；读规则：pool 为空时 position 0 归主池、其余归备用池；写时主池行 position 0..m-1（pool=main）、备用池行接着排（pool=backup）。`ModelRoleSettings` 保留 `primary`/`backups`（手机端在用：primary = mainPool[0]、backups = backupPool），新增 `mainPool`/`backupPool`。
  - Bot 家族（翻译、生图、视频、图片编辑、视频编辑）：现有单 JSON 列（`translationModels` 等，首位主、其余备选）。`XModels` 列改存主池，新增 `XBackupModels` 列存备用池；读规则：备用列为空时主池=[首位]、备用池=其余。API 旧字段 `XModels` 继续返回整表拼接（主池+备用池），手机端（`apps/mobile/app/bot-settings.tsx` 整表读写）不受影响；更新时新字段优先，旧字段按首位/其余拆分。
  - 时间线：`ModelSwitchAttempt` 加可选 `pool: "main" | "backup"`；各家族记录时按归属填；对话框里每行标池。
- 链子：`AgentRunRequest` 加 `mainPoolModels?`（主池里除当前运行模型之外的模型，按序）；`resolveNext` 先走主池、再走备用池；电脑链同理（角色同样是行表，同样分池；`computerModelBackups` 即备用池，主池 extras 同样走整表顺序）。媒体链（`tryCalls`/`tryVideoCalls`）与翻译链（`createTranslator`）按主池 ++ 备用池的顺序试，尝试按归属标池；图片/视频/翻译的预算与放手条件见 §9，不因分池改变。
- 翻译（08:26）：先补备选入口，再按两池做——§3 的单列表 UI 改成两池：主池节 + 备用池节（各有收纳栏）；翻译链走主池再走备用池，每模型 2 次、30 秒不变；翻译当前模型栏的切换明细与可点定位见 §4。
- 已确认 2026-11-20 09:22（用户亲口“我去配 gemini，两池默认就这样”）：主池按列表顺序试；主池空了直接走备用池；某次切到备用池模型后，下次 run 重新从主池首位开始。两池是两个独立列表；现有主模型进主池、其余进备用池，旧数据不丢。

## Alternatives considered

- **全失败时间线合并进 `modelSwitches`** — 否掉：各家族时间线相互独立是用户定好的（07:52），电脑的另开字段。
- **全失败无 partial 文本时伪造一条 bot 消息挂时间线** — 否掉：不发明消息；时间线进 `run.failed` 事件 payload 留作记录，UI 可见性是后续项。
- **翻译全失败 attempts 存进 `messageTranslation` 行** — 否掉：那张表存的是成功的翻译；失败的 attempts 走错误 payload，不污染成功记录。
- **翻译备选 UI 另起一套组件** — 否掉：与图片/视频同一套 `MediaModelFallbackList`，只把 Test 相关 props 改可选。
- **视频链加模型名启发式能力校验**（如名字含 cogview 的不许进视频链）— 否掉：名字猜能力不可靠，拦错比白烧一次调用更糟；配置清理已在线上做完。
- **图片编辑改走 `images/generations` + `image` 参数** — 否掉：OpenAI 自家的 `images/generations` 根本不接受 `image` 入参（那是 `/images/edits` 的 multipart 字段），而智谱的 `images/generations` 参数表里也没有 `image`；对所有提供方 blanket 先试 images 端点，遇到严格校验的上游会 400，遇到宽松的上游会被静默忽略——又回到悄悄重画。只对已知支持 `image` 入参的提供方用它，而目前两个在用模型（cogview-3-flash、GLM-Image）都不支持，所以不引入这条路。
- **只按 host 判断上游** — 否掉：中转把上游藏在自己 host 后面；能力是模型的属性，按模型 id 家族匹配才能覆盖中转。
- **每次编辑前先探针测编辑能力** — 否掉：每次多一次计费调用 + 延迟；改成已知家族守卫 + 设置里探针带参考图。
- **编辑失败降级成随机重画** — 否掉：用户 2026-11-19 已定“编辑失败不降级成重画”；守卫抛 `unsupported` 后链子只在编辑模型之间走。
- **电脑时间线挂进聊天 `modelSwitches`** — 否掉：同 §2，家族独立。
- **把 `MODEL_STREAM_TIMEOUT_MS` 全局调大**（如 120 秒 → 300 秒）— 否掉：调大同时放宽了主模型的首字等待与同模型重试窗口，是错的杠杆；问题不在预算大小，而在预算按“次”还是按“整条流调用”算。续期只在切换时发生，单模型重试仍受每模型 120 秒约束。
- **彻底去掉 120 秒预算** — 否掉：同模型重试与尺寸调整需要一个上限，否则瞬时失败会在退避列表 `[2s, 8s, 20s]` 耗尽后仍由别的路径兜底重试；预算按每次尝试续期已足够。
- **放宽 `isRetryableProviderUnavailable`，让 400 / 403 / 模型不存在也切换** — 否掉：这类错对池子里每个模型都会一样报（坏参数、relay 上没有这个模型 id），切换只会白烧整个池子；正确做法是让全失败时间线写明是哪个错停住了链子（§2），而不是多试几次。
- **每次重试也续期 `startedAt`** — 否掉：重试续期等于取消同模型重试的预算上限；只有换模型（新模型、新凭证、新上游）才值得一个新窗口。
- **视频轮询失败后让 run 自己重发一次生成请求** — 否掉：run 的 wake 提示词明写“失败了不要重发，除非用户要求”；重提交是 poll worker 在轮询周期里的内部动作，不经过 run、不打扰用户、不重复计费整单（只对下一个模型计一次新提交）。
- **视频重提交延长 60 分钟截止** — 否掉：截止以 job 创建时间为准，重提交不延期；否则一个失败模型能把整单无限拖下去。列表走完仍失败时照常在截止前判失败。
- **图片链也加“失败分类、不重试某些错”** — 否掉：媒体调用失败就是换下一个，不分类；聊天链的分类存在是因为坏参数对每个模型都一样、换了白烧，媒体调用没有这种跨模型必败的共性（同一提示词换模型常能成功，11-19 生图实测 gemini 失败 → cogview 成功就是例子）。
- **预设标签点一下只选中、另设小按钮进详情** — 否掉：多一个按钮占位置，违背“改标签就是为了省位置”的初衷；点标签 = 选中 + 打开详情，一次手势办两件事。
- **收纳栏状态持久化到用户设置** — 否掉：展开/收起是临时浏览状态，不值得一个持久字段；默认规则（空展开、非空收起）已覆盖两种场景。
- **两池用一个有序列表分两段（边界值）** — 否掉：边界是隐藏状态，每次改列表都要维护，错一位就把模型划错池；跨池移动模型变成“下标 + 边界”两步舞；UI 两节实际是一张表的两个切片，重排越过边界线时语义含糊。省下的只是几列，列是便宜的。见 §12。
- **主池只存首位、其余主池模型放进备用池前面** — 否掉：那还是一个列表，只是换了个名字；主池与备用池是两种承诺，分开存才算数。

## Consequences

- 新增 DB 列 `messages.computerModelSwitches`（迁移 `20261202122100_message_computer_model_switches`）：纯新增可空 JSON 列，旧代码不读写；部署时正常跑迁移即可，回滚只需删列。`finalizeRun` 的 completed/failed 分支都接受它；`run.failed` 事件 payload 新增可选字段，旧客户端忽略未知字段。
- `buildModelSwitches` 语义变了：以前“返回即代表真换过模型且成功”，以后“返回即代表试过不止一个模型或失败过”。调用方（`run-turn.ts`、媒体 `tryCalls`、`loadKeptTranslations` 的翻译 attempts 不走它）都要按“attempts 非空”理解；对话框的全失败分支文案已同步改掉。单测覆盖：全失败返回、单模型成功返回 undefined、重试去重。
- 电脑备选是**运行中**解析的整表：设置改了，下次 run 生效；暂停恢复的 run 用 pinned 主模型 + 当前设置的备选（pinned 电脑模型本身不变）。
- 翻译备选 UI 只做网页版；App 的翻译设置是另外的界面，本次不动（API 已支持整表，App 发整表即可用）。
- 图片编辑守卫是模型名家族匹配（`cogview-*`、`glm-image`）：同家族出新一代模型时要复核它支不支持图生图，能力变了守卫须更新；守卫只在带 `references` 的调用里生效，文生图不受影响。守卫上线后，若编辑列表里只有不能编辑的模型，点细节修改会直接报“该模型不支持图生图”，而不是悄悄重画——这是功能在起作用，不是失败；配哪一款能编辑的模型归用户，不追踪、不作部署前置。
- 已知缺口（未做）：run 在首字前就全失败（无 partial 文本）时，时间线只在 `run.failed` 事件里，线程 UI 不渲染失败 run 的行，所以用户在界面上还看不到它——要可见需另做“失败 run 行 + 时间线入口”；编辑模型 Test 探针若本次没改成带参考图，设置里仍测不出编辑能力，见实现时的取舍记录。
- 备选池走完的含义收窄：切换路径本身无上限，修的是切换后重试预算的续期；400 / 403 / 模型不存在等不可切换错误、工具调用开始后、内层流抛错这三处停点仍在，全失败时间线会写明是哪一处停住的——用户再问“切了几个”时以时间线为准，不再凭感觉。
- 视频轮询重提交只在 poll worker 里发生（`generateMediaFromTool` 的 `resubmitUntil` 由 `pollMediaVideo` 传）；全局 QueueJobProvider 没有备选列表，不实现 `resubmitVideoAfter`，行为与现在一致。重提交的 job 行复用同一行（`result.jobId` 换成新提交的 id，`createdAt` 不变，截止不延期）；时间线从提交时存的 `modelSwitches` 续上。
- 两池存储（§12）：角色行表加可空 `pool` 列（迁移只加列，旧行 pool 为空时按 position 0/其余分池）；Bot 家族新增 `XBackupModels` 列（迁移只加列，备用列为空时按首位/其余分池）。API 旧字段继续返回整表拼接，手机端不受影响；新字段 `mainPool`/`backupPool`（角色）与 `XMainModels`/`XBackupModels`（Bot）只给新版网页用。主池初始只有一个模型（现有主模型），用户在新 UI 里往主池加模型。
- 预设标签与备选收纳栏只做网页版；App 的对应界面（底表预设选择、备选列表）本次不动。
