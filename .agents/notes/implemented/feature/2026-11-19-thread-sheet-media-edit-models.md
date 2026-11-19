# Agent Note: 对话页其他模型底表加编辑模型

Status: implemented

## Problem

机器人设置页「其他模型」组里已有视频/图片编辑模型栏（`app/bot-settings.tsx` 的 `OrderedModelList`，字段 `Bot.videoEditModels` / `imageEditModels`，见 [App 画廊与影图编辑模型设置](./2026-11-19-app-gallery-and-media-edit-models.md)），但对话页点「其他模型」卡片弹出的底表（`apps/mobile/components/thread/thread-media-model-sheet.tsx`）里没有：底表每组只有生成模型、提示词预设、保存目录。用户在对话页改编辑模型必须绕去机器人设置页，同一组设置分在两处，底表里的编辑入口是缺的。

## Decision

底表每组在生成模型之后、提示词预设之前有一个编辑模型列表，复用底表里现成的 `modelList` helper（主行 + 编号备选 + 添加备选行），不另起新组件：

- `kindBlock(role)` 里生成模型 `modelList` 之后是编辑模型 `modelList`：image 组 label 用 `t("Image edit model")`、video 组用 `t("Video edit model")`（两个 id 已在 8 个 catalog 里，不重复加）；添加备选行用新 id `t("Add image edit backup")` / `t("Add video edit backup")`，补进全部 8 个 catalog（`apps/mobile/lib/locales/*.ts`）。
- 选模型走同一个 picker：`thread-model-picker-sheet.tsx` 的 `ThreadModelPickerRole` 加 `"videoEdit" | "imageEdit"`；标题用 `t("Video edit model")` / `t("Image edit model")`；`select()` 与 `removeChoice()` 里对这两个 role 走与 video/image 同款逻辑（`moveBotModelToFront` + `rpc("bots/update", { botId, videoEditModels: next })` / `{ imageEditModels: next }`）。`bots/update` 的 input 已含这两个字段，不改服务端契约。
- `thread-screen.tsx` 接线，照 video/image 的现成写法：`videoEditOverride` / `imageEditOverride` state；`videoEditPrimary = primaryBotModel(currentBot?.videoEditModels)`（image 同理），provider/modelId 取 override 否则 primary；`sheetKey`、picker 的 `currentModels`、`onSaved` 按新 role 扩展；给底表传 `videoEdit` / `imageEdit`（`ThreadModelSave`）、`videoEditModels` / `imageEditModels`、`onPickEditRole`（与 `onPickRole` 同款：`setMediaOpen(false)` 后 `setSheetRole` 对应新 role）。
- `MobileBot` 的 Pick 里加 `"videoEditModels" | "imageEditModels"`：`mentionBots` 走 `rpc("bots/list")`，服务端回的是完整 `Bot` 对象（契约里已有两字段），运行时数据已在位，只补类型选取，不改取数。两个全量构造 `MobileBot` 的测试夹具（`chat-model-picker.test.tsx`、`inbox-spaces.test.ts`）同步补两字段为 `null`。
- 底表顶部的 doc comment 同步说明每组里生成模型之后是编辑模型。
- 测试：`thread-media-model-sheet.test.tsx` 的 `mountSheet` 加新 props（默认给空编辑列表与未设置主模型），新用例：两组里编辑模型行出现且在生成模型之后、提示词预设之前；未设置时显示 Not set，点行打开对应编辑 picker；编辑备选编号正确。

## Alternatives considered

- **只在机器人设置页留编辑模型，底表不加** — 最强的理由是少改三处接线、少两个 picker role，底表保持只管生成。但用户就是在对话页底表里找这个设置才报的缺口（机器人设置页他已经找到了），不加等于不修；底表本来就是「其他模型」设置的快捷入口，编辑模型是同一组设置的一部分，缺一块就是缺口。否掉。
- **底表里编辑模型只给主行、不给备选** — 最强的理由是编辑模型默认空、备选少用，少一行更清爽。但生成模型三处（生成/翻译/编辑）都是有序列表+备选同一套语义，编辑失败不降级成重画、备选在编辑列表内走，砍掉备选等于砍掉已定版的语义；且 `modelList` helper 本来就带备选行，复用比裁剪更少代码。否掉。
- **编辑模型单独成组、放到底表翻译组之后** — 最强的理由是与机器人设置页的排布一致（编辑栏在媒体块尾部、翻译模型之前）。但底表是按 kind 分组的（图片组/视频组各管各的模型、预设、保存目录），编辑模型是 kind 的一部分，跟生成模型放同一组、生成模型正下方，比跨组找更贴近「对应设置」；且翻译组之后还有动作开关组，单独成组会把同一 kind 的设置拆散。否掉。

## Consequences

- 对话页底表图片组、视频组里各有一行编辑模型，位置在生成模型之后、提示词预设之前；空时显示 Not set，点行进 picker 选完写回 `videoEditModels` / `imageEditModels`，备选编号与生成模型同款。
- `apps/mobile/lib/i18n.test.ts` 全绿：两个新 id 在 8 个 catalog 里都有翻译。
- `thread-media-model-sheet.test.tsx` 16/16 绿（含 3 个新用例）；`chat-model-picker.test.tsx` 77/77、`message-actions-row.test.tsx` 15/15、`inbox-spaces.test.ts` 随同批复跑全绿；tsc 只剩 6 个与本次无关的基线错误（`usage-detail` 的 `totalOnlyCalls`，HEAD 已有）；Biome 全绿。
- 风险仍在：`MobileBot` 加字段只改类型选取，若服务端 `bots/list` 某天不再回完整 `Bot`，底表编辑列表会读到 `undefined`，`primaryBotModel` 与 `modelList` 都按空列表处理（`?? null` / `?? []`），只显示 Not set，不会崩；新 picker role 的 `select()` 与 `removeChoice()` 是 `bots/update` 的写操作，分支写错会把编辑列表写进生成模型字段，用例里只断言底表回调，不直接断言 picker 的写字段，靠 picker 相关测试与人工核对分支。
- 未验证：无真机/模拟器截图，底表在手机上的实际排布与点按手感待用户在下一包里核对。
