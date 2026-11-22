# Agent Note: 其他模型底表左滑失效与已移除模型残留备选池

Status: implemented

## Problem

用户在手机上截屏报了两个 bug（New Bot 对话 →「其他模型」底表，图片生成模型「未设置」，备选 1. `krisphyn-Gemini-3.8-Flash-Low`、2. `cogview-3-flash`）：

1. 备选行左滑不弹出移除。1.0.40 里刚上的左滑移除（`2026-11-21-app-swipe-remove-fallback-models.md`）在底表里滑不出。
2. 备选 1 号模型已在提供商（GB）处移除，但底表里还显示。

两个 bug 是串联的：残留的备选行本该在提供商保存时被清掉；就算残留了，用户也该能左滑删掉——结果两条路都断了。

## Decision

### Bug 1：底表内容包一层 `GestureHandlerRootView`

根因：`ThreadMediaModelSheet` 的备选行包在 `react-native-gesture-handler` 的 `Swipeable` 里（`apps/mobile/components/thread/thread-media-model-sheet.tsx:212`），但底表经 `BottomSheetShell` 呈现（同文件 `:495`）——Android 上两条容器路径都在 App 根的 `GestureHandlerRootView`（`apps/mobile/app/_layout.tsx:376`）之外：

- 原生表路径：`NativeSheet`（`apps/mobile/components/native-sheet.tsx`）用 `@expo/ui` 的 `BottomSheet`，即一个独立的原生 bottom-sheet 对话框；
- 回退路径：`BottomSheetShell`（`apps/mobile/components/bottom-sheet-shell.tsx:57-63`）用 RN `Modal`，同样是独立的原生窗口。

RNGH 的手势只在 `GestureHandlerRootView` 子树内生效；Modal / 对话框里的触摸根本到不了根手势系统，所以 `Swipeable` 的 pan 从未激活，左滑什么都不发生。作证：同一套 `Swipeable` 在全屏页面里是好的——`ModelPickerList`（`apps/mobile/components/model-picker-list.tsx:275,425`）放在 RN `SectionList` 里、在设置页全屏时左滑移除可用；`inbox-swipe-row.tsx` 在收件箱列表里也可用。两处都在根 `GestureHandlerRootView` 之下。坏的只是在底表里。

修法（只改容器，不动 `Swipeable` 本身）：

- `apps/mobile/components/bottom-sheet-shell.tsx`：回退路径的 `ScrollView` 外包一层 `GestureHandlerRootView`（无 flex，按内容 sizing，与原来一致）。
- `apps/mobile/components/native-sheet.tsx`：原生表里 `ScrollView` 外包一层 `GestureHandlerRootView`。

这样底表两条容器路径下左滑都能弹出移除；顺带修好了同样在底表里的选模型器左滑移除（`thread-model-picker-sheet.tsx:526` 的 `ModelPickerList`），它之前也是死的。所有底表共用 `BottomSheetShell`，修在壳上是一次修好，不是逐个底表打补丁。

### Bug 2：提供商保存时也要清机器人影音池

根因：提供商保存的占用清理（`apps/api/src/model-pins.ts` 的 `assertNoDanglingModelPins`，`apps/api/src/model-credentials.ts:440` 调用）从来只看三类 pin——机器人自己的主模型（`bot.modelId`）、例行任务、`userModelRoleChoice` / `spaceModelRoleChoice` 里的聊天/审批/电脑操作池。机器人名下的五个影音池（`imageModels`、`videoModels`、`imageEditModels`、`videoEditModels`、`translationModels`，各分主/备两列，`packages/db/prisma/schema.prisma:1173-1189`）是 Bot 行上的 JSON 字段，`compatibleModelPins`（`model-pins.ts:18-54`）根本不读它们。`2026-11-21-disable-model-removes-from-backup-pools.md` 里记过这条边界——“机器人名下的翻译/生图/视频池……本来就不进这个 assert……本次也不动”。用户这次正好踩中：被关掉的模型只在图片备选池里，保存既不拦也不删，库里一直留着。

作证这不是 App 缓存：对话页每次聚焦都重新拉机器人列表（`apps/mobile/lib/thread-focus.ts:60` 的 `refreshMentionBots()`），底表读的就是刚拉回来的 `currentBot?.imageModels`（`thread-screen.tsx:1487-1488`，服务端返回的是主备合并后的列表，`packages/db/src/repos.ts:226`）。截屏显示的是服务端当时的真实状态。

修法（服务端，与 2026-11-21 那批同一套规则）：

- `compatibleModelPins` 在 `{ notIn }` 查询（即“哪些模型正离开启用列表”，只在提供商保存时用）里多取机器人影音池：读该用户未归档机器人的十个 JSON 列，用 `splitBotModelPools` 分主备，每条生成一个 media pin（机器人、家族、池、provider、model）。只取 `{ notIn }` 形式——`models/setDefault` 那条单模型查询里，出局的默认模型仍在启用列表里，影音池指向它依然可用，不该拦。实现上是 `compatibleModelPins` 内新增的 `compatibleMediaPins` 查询；注意 `{ notIn }` 装的是保留列表，收集的是列表之外的条目，别写反。
- `assertNoDanglingModelPins` 里 media pin 与 role 池同规则：备池静默进待删列表；主池（主列里的条目）没带确认标志时抛 409，确认后进待删列表。409 文案的类名新增映射：`image`→图片生成、`video`→视频生成、`imageEdit`→图片编辑、`videoEdit`→视频编辑、`translation`→翻译（沿用 `roleFamilyLabel` 的“{类}主模型”拼法）；occupancies 仍是 `{ kind: "role", role, pool: "main" }`，两端只认 `reason`（`packages/core/src/user-error.ts:26`），不新增客户端判断。
- 待删列表新增 `{ kind: "media", botId, field, provider, model }`；`model-credentials.ts` 的清理循环里按 `field`（十个 JSON 列之一）在同一事务内重读该机器人该列、滤掉该条写回：主列清空写 `DbNull`、备列清空写 `[]`，与 `routes/bots.ts:726-730` 的写入规矩一致。事务内重读即池守卫——检查与写之间条目被挪走时不会误删。
- `bots/update` 的校验（`routes/bots.ts:484-505`）本来就放过“已在列表里的条目”，所以旧残留不会在编辑机器人时被顺带清掉；本批修的是“提供商保存时清”，不改那条校验。

本次不做的：对话页打开底表时再拉一次机器人列表。聚焦时已刷新（上文），底表打开再拉只是给“网页端移除时 App 正开着对话页”这个短暂窗口多一次请求，不值得。已移除模型在库里清掉后，下次聚焦即消失。

## Alternatives considered

### Bug 1

- **把底表两个 `ScrollView` 换成 RNGH 的 `ScrollView`**：最强的理由是 RNGH 文档确实建议手势放进可滚动容器时用它。但它修不了这个 bug：RNGH 的 `ScrollView` 同样需要一个 `GestureHandlerRootView` 祖先，而 Modal / 对话框里根本没有。换了也一样死。否掉；且换容器会影响所有底表的滚动行为，代价比包一层 `GestureHandlerRootView` 大。
- **给备选行换自定义 `PanResponder` 手势**：能绕过 RNGH，但等于为底表重写一套滑动逻辑，与选模型器、收件箱已有的 `Swipeable` 两套并存，日后改手势要改两处。否掉。
- **每行直接放可见的移除按钮**：2026-11-21 那篇已否掉过（行面变挤）；用户要的就是左滑。否掉。

### Bug 2

- **读取时过滤（`bots/list` 返回前去掉已断开连接的模型）**：最轻的改法，底表立刻干净。但库里的脏数据还在，切换链路读原始列时仍会拿着不存在的模型去跑，治标不治本。否掉。
- **定时清理任务**：能扫掉所有残留，但为“保存时应有的不变式”另起一套后台机制；而且残留会在两次清理之间一直可见。保存时同一事务内清掉才是这个 invariant 该在的位置。否掉。
- **删整个提供商时也清**：本次用户是关掉单个模型，不是删提供商；删提供商是另一条 RPC（不走 `assertNoDanglingModelPins`），是否同病要另查另修，不在本批里顺带扩范围。

## Consequences

- App 端改动，随下个 EAS 包才到用户手机；服务端改动随下次部署。两个 bug 分开提交（App 一支、服务端一支）。
- `BottomSheetShell` 与 `NativeSheet` 的改动影响所有底表：改的是手势容器，不是某个底表的内容；回归面是“底表里的手势与滚动”，验收时除本底表外顺手点开一个别的底表确认能正常滚动即可。
- 服务端：提供商保存时，影音池主池占用会新出现 409 确认（以前是直接保存成功、悄悄留残留）。确认框文案是服务端出的中文，两端原样显示，不新增文案。备池仍静默删。
- 单测：App 断言底表两条路径的内容都在 `GestureHandlerRootView` 内；服务端沿用 `router.test.ts` 里 `openai-compatible enabled models` 的 fixture（新增 `media` 种子），覆盖备池静默删、主池 409、确认后删、别家连接仍在供时不删。真机手势只能手机验收，单测不冒充。
- 仍需一次线上库核对：代码证明了清理缺口与 App 聚焦刷新，但要最终确认这次这条残留确实在库里（而不是某次失败的拉取留下的旧快照），部署后查一次 New Bot 的 `imageModels` / `imageBackupModels` 列——残留应已不在。
