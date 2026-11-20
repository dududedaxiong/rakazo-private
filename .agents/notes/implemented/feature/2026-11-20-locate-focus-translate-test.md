# Agent Note: 主聊天模型定位焦点落行、翻译行补测试按钮、主池改名主力模型、卡片操作行加能力徽章

Status: implemented

## Problem

2026-11-20 13:15–13:18 网页实测（线上 f5a970e9，分支 `feature/locate-verify-fixes`），主池行、定位、细节修改“不支持图生图”均已通过，只剩两点；用户 13:29 亲口说修这两点，随后又补了两项要求，同批一起做。只改代码、测试、推送到新分支，不部署、不触发构建。

- ① 主聊天模型定位后焦点没落到行上。实测：文本回复点“当前模型”→小窗 deepseek-v4.1-flash（gb大佬）带提供方→点名字→右侧顶部模型卡出现蓝色边框+“定位到这里”、选择器保持收起没盖面板；但按 Tab 焦点落在对话末条回复的“朗读”按钮上（即仍停留在原来点开弹窗的“当前模型”按钮之后），两次复现。影图行定位时焦点是落到行上的（Tab 到“替换模型”，Shift+Tab 回到行），只有主聊天模型这条不行。
- ② 翻译主池行没有“测试”按钮，其余四行（视频生成、图片生成、视频编辑、图片编辑）都有。翻译主池行只有上移/下移/移除。
- ③（用户 13:30 补）界面上所有“主池”改成“主力模型”。
- ④（用户 13:34 补）每行模型卡片的操作行（测试/上移/下移/删除那行）× 后面的空位，放该模型支持的类型徽章：文本、图片、影音；支持什么显示什么，全支持就三个小徽章并排，组合本身就是多维态。

相关笔记：[定位实测五项修复](./2026-11-20-locate-verify-fixes.md) §6（焦点修法的来源，本批 §1 翻转了它的聊天行做法）、[定位先弹小窗](./2026-11-20-locate-popup-border.md) §3/§8（横幅卡片行与操作行顺序的来源）。

## Decision

### 1. 主聊天模型焦点：下放到 `ModelSection` 自身的 effect，与影图列表同 pattern

**根因（已定位，非猜测）**：聊天行的焦点落在面板 effect 里（`bot-panel.tsx` 的定位 effect），与定位小窗 Dialog 的关闭发生在同一个 commit——点小窗名字时，`setPendingLocate(null)` 与 `onLocateModel` 是同一次点击里的两次 setState；Dialog 卸载时按 Base UI 的规矩把焦点归还给打开它之前聚焦的元素，也就是对话里的“当前模型”按钮，这次归还发生在该 commit 的被动 effect 清理阶段，盖过了面板 effect 里同一批的 `.focus()`。所以焦点回到对话里，下一个 Tab 停点就是末条回复的“朗读”按钮。影图行能落上去，是因为它的焦点不在面板 effect 里：`MediaModelFallbackList` 自己的 effect 在 `locatedKey` 落定、列表展开之后才聚焦（晚一到两个 commit，归还早已跑完），所以赢了。上一批笔记 §6 说“由面板的定位 effect 聚焦”——那正是撞上的那处。

**纠正一个前提**：任务里说“主聊天模型行在成员模型设置页（ModelRoleSettings）”，不对。`Shell.tsx` 的 `locateBotModel` 里 kind=chat 走机器人设置面板（`setPanel("settings")`），只有 kind=computer 才开成员模型设置页（`ModelSettingsOverlay` 的 `locatedModel={locateComputerModel}`）；实测里出现蓝色边框+“定位到这里”的正是面板顶部的 `ModelSection`（`ring-2 ring-link` + `LocatedTag`）。修的地方是 `ModelSection`，不是 `ModelRoleSettings`。

- `ModelSection`（`bot-settings-sections.tsx`）新增自己的 effect：`locateKind === "chat"` 且 `locatedKey === value` 时，聚焦本行里的选择器触发控件（`[data-model-row] button, [data-model-row] select`，长列表是按钮、短列表是原生下拉，与面板旧代码同一选择器）；`locatedKey == null`（模型已不在列表，section 本身是定位目标）时聚焦 section 容器（已有 `tabIndex={-1}`）。effect 在面板 `setLocatedKey` 落定后的 commit 才跑，与影图列表同 pattern。
- 面板 effect 只保留滚动与 `setLocatedKey`/`setLocatedSection`，删掉聊天行分支；`key == null` 时聚焦 section 的分支只留给非聊天 section（聊天 section 的无匹配聚焦由 `ModelSection` 接管）。
- 为让同模型重复定位也能重新聚焦（`locatedKey` 不变时 effect 不重跑），`ModelSection` 新增 `locateRequestId` prop（取 `locateModel.requestId`），进 effect 依赖。

### 2. 翻译行补测试：新增 `bots.testTranslationModel` 单模型探针，走 runtime

**根因**：翻译主池行本身就是横幅卡片行（上一批已把主模型并进主池列表当第 1 行，实测也看到 deepseek-flash 的卡片行），不是旧的选择器行；缺的是测试按钮——`MediaModelFallbackList` 的测试按钮只在传了 `onTest` 时渲染，而 `TranslationGroup` 从没传过 `test`/`onTest`，列表注释写明“Absent for translation: there is no capability probe”。没有现成的翻译单模型探针可复用：`bots.translate` 走整条主池+备用池链，测不了一行（备选行会测到主模型、还会消耗主模型额度）；`testMediaModel` 是直接 fetch 的媒体探针，只认 openai-compatible 连接，会拒掉 Anthropic 原生协议的 GB 中转（用户翻译主力 deepseek-flash 就走 GB），不能用。

- 服务端新增 RPC `bots.testTranslationModel`（`packages/contracts/src/rpc.ts`，与 `testMediaModel` 同样的 `{supported, seconds, detail}` 输出）：入参 `{botId, provider, modelId}`。handler 照 `testMediaModel` 的样子先 `validateBotModelChange`（当前值取翻译主池首位，legacy 单模型字段兜底），再调新探针。探针不做 hosted 模型豁免：它走 runtime，与真实翻译同一条路，托管模型也能测（媒体探针是直接 fetch、没有用户密钥才测不了托管模型，两者机制不同）。
- 探针 `createTranslationProber`（`apps/api/src/translate.ts`，与 `createTranslator` 同一份依赖 `{prisma, runtime, resolveConnectedModel}`）：把 `translateOnce` 从闭包里抽成模块级函数供两边用；探针用固定短句 “Hello” 从英文翻中文（与机器人保存的目标语言无关，只是能力探针），30 秒超时；有译文即 supported，否则按 `shortReason` 给短原因；用量按真实翻译一样记（`operationKind: "setup"`）。`RouterDeps` 加 `translationProber` 字段，`app.ts` 与 translator 同依赖创建。
- 客户端照媒体测试同一套接线：`bot-panel.tsx` 加 `translationTest` 状态 + `testTranslationModel(key)`（解析 key、调 RPC、按 `modelStatusFromProbe` 记健康状态）+ `applyTestedTranslationModel()`（测通的模型移到翻译主池首位）；`TranslationGroup` 接 `translationTest`/`onTestTranslationModel`/`onApplyTranslationTestedModel`，两个池子列表都传 `test`/`onTest`/`onApplyTestedModel`；`MediaModelTestResult` 的 kind 扩到 `"translation"`，文案“支持翻译 / 不支持翻译”，`kind !== "translation"` 的排除去掉；主池第 1 行的上移禁用与“设为主模型”不出现，沿用列表现成的规则（`index === 0` 禁用上移、主池首行不给 `onApplyPrimary`）。
- 拒绝的方案：测试按钮调 `bots.translate`——测的是整条链而非本行，备选行会先消耗主模型，且失败时难以归因到本行；直接 fetch 的翻译探针——只认 openai-compatible，GB 中转的翻译模型测不了；只加按钮不加探针——按钮点了没东西可跑，比没有更坏。

### 3. “主池”改名“主力模型”：改 Lingui 源文案与中译

- 四处源文案：收纳栏标题 `Main models ({count})`（`fallback-disclosure.tsx`）、切换记录池标签 `Main models`（`model-switch-history-dialog.tsx:99`）、详情位置 `Main models #N`（`bot-settings-sections.tsx:582`）、添加入口 aria-label `Add main model`（`bot-settings-sections.tsx:1287`）。池子三处用复数 `Main models` 而不用单数：单数 `Main model` 这个 msgid 已被成员模型设置页的角色标题占用（译“主模型”），池子要的是“主力模型”，共用一条会把角色标题也改掉；复数既独立成条，英文上也更准（池子本来就是一组模型）。zh-CN 译“主力模型（{count}）”/“主力模型”/“添加主力模型”，zh-TW 同步；其余语言暂无译文、按 Lingui 规矩回退到英文源文案，等翻译补。
- 代码标识符不动：`mainPool`、`pool="main"`、变量名、字段名、API 字段、`attempt.pool === "main"` 的判断全都不改；只改显示文案。“备用池”/`Backup pool` 不动。注释里泛指池子的 “main pool” 不是用户看得见的文案，不动；只有直接引用标题原文的那一条注释（`fallback-disclosure.tsx` 的 `"Main pool (N)"`）随文案改，否则注释就成假话了。
- 流程：改源文案 → `pnpm --filter @rakazo_mickvvw/web intl:extract --clean` → 补 zh-CN/zh-TW 翻译 → `intl:compile`；测试里断言 “Main pool” 的地方同步改。

### 4. 能力徽章：只用 `images` 这一份真实数据；影音无数据，记缺口

**数据现状（已查清）**：到达网页卡片的模型能力数据只有一个字段——`ChatModelChoice.images?: boolean`（`packages/core/src/model-providers.ts`；目录的模态本身就是 `("text" | "image")[]`，见 `packages/adapters/src/model-modalities.ts`）。`images` 由目录 `model.input.includes("image")` 算出；目录知道的模型一定带布尔值（`true`/`false`），自由填的模型 id 留空（unknown）。**音频/视频能力字段不存在**：目录条目、`ChatModelChoice`、`ConnectedModelChoice` 上都没有；语音是另一套提供商设置，不在模型行上；输出侧（生图/生视频）能力也没有按模型的字段，只有角色列表与运行时探针结果。

- 映射（与详情里“图片输入”同一认识论：`images` 有值 = 目录知道，无值 = 不知道）：`images === true` → `[文本][图片]`（目录知道它是 text+image 输入）；`images === false` → `[文本]`（目录知道它是纯文本输入）；`images === undefined` → 不显示任何徽章（不知道，不编造）。`[文本]` 的含义是“接受文本输入”（后端 `input` 里永远有 text），不是“能聊天”；纯文生图/视频模型是自由填 id、`images` 为空，所以不会误挂 `[文本]`。
- `[影音]` 没有任何数据来源，本批不显示，记入已知缺口（要补需目录先有音频/视频能力字段并一路传到 `ChatModelChoice`，输出侧能力还需探针或提供方元数据，不是改文案能解决的）。
- 样式与位置：徽章是小而淡的 pill（`shrink-0 rounded-full border border-border px-2 py-0.5 text-body-sm text-muted-foreground`，沿用 `LocatedTag` 同款尺寸与 token），放在操作行删除按钮（×）之后；操作行容器已有 `flex-wrap`，窄屏徽章自动换行，不挤占、不截断测试/上移/下移/删除。只在 `MediaModelFallbackList` 的横幅卡片行上做（任务说的“每行模型卡片”就是这些行）；聊天选择器行与成员模型设置页的行没有操作行，不在范围。
- 新文案“文本”“图片”“影音”走 Lingui（“影音”本批不渲染，但徽章组件按三档设计、数据到了即显示，所以消息一并入 catalogue）。

## Alternatives considered

- ① 面板 effect 里把焦点调用包一层 `requestAnimationFrame`：最强的理由是改动只有一行。但时序依赖脆弱（归还发生在 100ms 退出动画后还是清理阶段，换个版本就可能变），且与上一批“不抢时序”的做法背道而驰；下放到行组件的 effect 是结构性修法，与已验证的影图列表同 pattern；不用。
- ① 在小窗确认路径上关掉 Dialog 的焦点归还（`returnFocus={false}` 之类）：最强的理由是从根上断了抢焦点的来源。但归还是无障碍的基本行为，关掉会影响所有从弹窗回来的焦点（包括正常关闭不定位时），改动面超出定位；不用。
- ① 焦点改落整行 div（`tabIndex`）：整行得焦点时视觉上最整，但键盘用户落到行内第一个控件（选择器触发）才是自然落点，Tab 顺序不断；上一批已否决过；不用。
- ② 测试按钮调现成的 `bots.translate`：最强的理由是零服务端改动。但它走整条链，备选行测到的是主模型，失败归因与额度消耗都错；不用。
- ② 直接 fetch 的翻译探针（照 `testMediaModel` 的样子）：最强的理由是与媒体测试同一套、不动 runtime。但它只认 openai-compatible 连接，GB 中转（Anthropic 原生）会被拒，而那正是用户翻译主力的连接；不用。
- ② 只加按钮、探针以后再说：最强的理由是本批改动小。但点了没东西可跑的按钮比没有按钮更坏；不用。
- ③ 只改 zh-CN/zh-TW 译文、不动英文源文案：最强的理由是其他语言零风险。但源文案就是英文界面上的文案，改一半会让“主池”在英文界面上继续存在，与改名意图不一致；Lingui 回退机制就是为源文案改动准备的；不用。
- ④ 徽章按行所在的列表推断（生图列表的行挂 `[图片]`、视频列表的行挂 `[影音]`）：最强的理由是用户的媒体模型行立刻都有徽章。但列表是用户配置，不是模型能力——2026-11-20 实测就见过 cogview-3-flash（纯文生图）被错配进视频主池，按列表推断会把错配当成能力背书；不用。
- ④ `[文本]` 只在 `images === false` 时显示、`images === true` 时只显示 `[图片]`：最强的理由是文本是基线、不值得占一个徽章。但目录数据是“输入模态”——`true` 的行同样接受文本输入，只标 `[图片]` 会让人误以为它不接受文本；按模态如实列出才是“支持什么显示什么”；不用。
- ④ 徽章放横幅头（名字那行）而不是操作行：最强的理由是更醒目。但用户明确指定了操作行 × 后面的空位，且横幅头是点开展详情的按钮，放徽章会挤占名字；不用。

## Consequences

- 定位后焦点落在被定位行上：聊天行落选择器触发控件（与影图行落横幅按钮对称），模型已不在列表时落 section 容器；重复定位同模型也会重新聚焦。
- 翻译每行都有测试按钮（替换、测试、上移、下移、删除），点测试跑一次真实翻译探针（固定短句 en→zh、30 秒超时、用量照常记），结果行显示“支持翻译/不支持翻译 + 秒数”，测通的非首行模型可一键设为主池首位。
- 界面上不再出现“主池”，统一是“主力模型”；“备用池”不动；代码标识符不动。
- 能力徽章只反映目录已知的输入模态：`[文本]`、`[文本][图片]`、或无徽章；`[影音]` 本批永远不出现（无数据）。
- 代价：新增一个服务端 RPC 与一个 RouterDeps 依赖（探针走 runtime，与真实翻译同路）；`translateOnce` 从闭包抽成模块级函数；其他语言的“Main model”在翻译补齐前显示英文。
- 未验证：没有 live 浏览器视觉核对（桌面浏览器改不了视口宽、且本批不部署）；手机端窄屏三处等用户手机验收。

## Verification

- 改动相关测试全过：`apps/web/src/pages/shell` 整个目录 + `ModelRoleSettings.test.tsx` + `apps/api/src/routes/bots.test.ts` + `apps/api/src/translate.test.ts`，47 个文件 683/683；其中新增 `bot-settings-sections.test.tsx`（聊天行焦点 6 例）、翻译行测试按钮（panel 级）、徽章三种情况（group 级）、服务端探针与 RPC 各 3 例。
- `apps/web` tsc 0 错；`apps/api` tsc 只有已知的 `voice-factory.ts` 2 错（基线）；Biome 干净；`pnpm verify-notes` 三项过。
- 顺带修了 `bots.test.ts` 里两个与本批无关的旧断言（update 测试仍按合并单列表断言，但 update handler 早已把旧单列表拆成主池首位 + 备用池其余；在干净 HEAD 上复现过，确认是旧失败、不是本批引入的）。

## Known gaps

- `[影音]` 徽章无数据来源：目录与 `ChatModelChoice` 上没有音频/视频能力字段；输出侧（生图/生视频）能力也没有按模型字段，只有角色列表与探针结果。要补需目录先有能力字段并传到 choices。
- 详情里没有用量统计（设置页作用域里没有按模型分的用量数据），与上两批相同，不在本批。
- `splitBotModelPools` 主池空、备用池有模型时丢备用池的显示问题仍在（见模型切换缺口笔记 §13），不在本批。
- 重复定位同模型时影图行的焦点不重跑（影图列表 effect 的依赖里没有 requestId），与本批修好的聊天行不对称；用户没报过，暂不扩大范围。
