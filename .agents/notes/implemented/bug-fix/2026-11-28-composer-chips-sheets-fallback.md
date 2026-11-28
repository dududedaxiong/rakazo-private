# Agent Note: 快捷卡片的 sheet 在原生底表还在加载时也能打开

Status: implemented

## Problem

App（1.0.43，Android）聊天界面底部快捷卡片那排，点例行任务、收藏、背景、备份、画廊都没反应；模型报错卡片（“模型返回了无法使用的回复。请重试。”）下面的“详情”点开也弹不出来。用户把截图里能看到的卡都点了，都没弹出来；左边滑出屏幕的模型、其他模型、电脑还没测。

这和 2026-11-24 修过的错误详情 sheet 是同一个毛病。那篇笔记（[2026-11-24-run-error-details-sheet-fallback.md](../feature/2026-11-24-run-error-details-sheet-fallback.md)）修了 `RunErrorSheetContainer`，并明确写了别的 sheet 也有同样的 `Sheet === undefined → null` pattern、“先放着”。这次用户报的五张 sheet 就是当时放着的那些。

## Root cause（以代码和测试为准）

- 五张 thread sheet（收藏、背景、备份、模型选择器、自定义设置）开头都是同一句：`if (!visible || Sheet === undefined) return null;`。`useNativeSheet()` 在 `@expo/ui/community/bottom-sheet` 的动态 import 还没完成时返回 `undefined`（导完是组件、导失败或本机没有是 `null`）。`undefined` 时 sheet 直接 return null，下面的 Modal 兜底够不着——点卡片确实把 visible 置 true 了，但 sheet 渲染出空，什么都不出来。
- 复现：新测试把 `useNativeSheet` mock 成 `undefined` 去渲染收藏 sheet，没修之前渲染出空（测试失败），修后渲染出 Modal 兜底（测试通过）。`null` 时本来就能走 Modal，不受影响。
- 卡片本身的接线没毛病（测试证明）：点例行任务确实调 `router.push({ pathname: "/routines", params: { botId } })`，点收藏/背景/备份确实调各自的打开回调，点画廊确实调 `router.push("/gallery")`。所以卡片点下去是有反应的，毛病在 sheet 那层没出来；导航那两张（例行任务、画廊）的页面本身存在且能渲染，接线也对——如果真机上它们仍像没反应，那是导航/页面另外的问题，不在本次范围。
- 错误“详情”：`RunErrorSheetContainer` 在 2026-11-24 已经修过，`undefined` 也会走到 Modal 兜底，代码上没毛病。这次没动它。用户仍报它弹不出来，代码上复现不了；按 2026-11-24 那篇的判断，下一个怀疑对象是原生底表自身在 Android 上的呈现（`enableDynamicSizing` + 嵌套 ScrollView），需要真机跟进。

## Decision

五张 sheet 的 early return 只留 `if (!visible) return null;`，去掉 `Sheet === undefined` 这一项：原生底表没准备好（还在加载或不可用）时一律走下面的 Modal 兜底，不再返回空。`useNativeSheet` 的三态（`undefined`=还在加载、`null`=不可用、组件=可用）不动；`BotOrganizeModal` 里同样的 early return 不动（收件箱那张，不在本次报障范围）。

代价是取舍过的：加载窗口里点开会先闪一下 Modal，等原生底表导完再切过去；但那个窗口本来就短（import 在启动时就开始预加载），闪一下远好过什么都不出。

## Alternatives considered

- **在 `native-sheet.tsx` 里把 `loadedSheet` 初始值改成 `null`，让 `useNativeSheet()` 永远不返回 `undefined`** — 最强的理由：共享层改一行，所有调用方立刻都走到 Modal 兜底。否掉：它改了 hook 的三态约定，把“还在加载”并进了“不可用”，会让 `RunErrorSheetContainer` 和 `BotOrganizeModal` 在预加载窗口里也闪 Modal，违背了它们刻意等的“预加载、不闪 Modal”设计；每张 sheet 各修一行更精准。改完又撤回了，只保留了 sheet 层的改动。
- **只修收藏一张** — 最强的理由：改动最小，用户最先报的就是收藏。否掉：五张 sheet 是同一句 early return，用户随后确认背景、备份也弹不出来；只修一张会把同样的毛病留给另外四张。
- **加超时再兜底（等几秒还导不出来才走 Modal）** — 最强的理由：既保住“加载时不闪 Modal”，又修了 import 挂住的情况。否掉：多一套计时器和状态；Modal 闪一下只发生在启动后极短的预加载窗口里，代价可接受，不值得为它加复杂度。
- **放着不动（加载窗口很短，正常情况碰不上）** — 最强的理由：import 启动时就开始预加载，点卡片时早导完了。否掉：和 2026-11-24 那篇同样的道理——窗口里的一次点击能被证明什么都不出，而用户现在正撞上它；修的成本只是一行。

## Consequences

- 五张 sheet（收藏、背景、备份、模型选择器、自定义设置）现在只要 visible 就一定出东西：原生底表可用时走原生，不可用或还在加载时走 Modal，内容和操作一致。
- 卡片接线不变；`useNativeSheet`、原生底表、`BotOrganizeModal`、错误详情容器一概不动。
- 全部是 App 端改动（`apps/mobile`），需要重新打 App 包才能到用户手机上；服务端部署带不走它。
- 错误“详情”和例行任务/画廊导航本次未改：前者代码上已有正确兜底，后者接线经测试无误；如果打完新包真机上它们仍弹不出来，按 2026-11-24 那篇的判断下一步查原生底表在 Android 上的呈现，或导航/页面层另外的问题。

## Verification

- 新测试 `apps/mobile/lib/thread-favorites-sheet.test.tsx`：4/4 过（加载中走 Modal、不可用走 Modal、可用走原生、不可见渲染空）。其中“加载中走 Modal”在没修之前确实失败（先 stash 验证过），修后通过。
- 扩展 `apps/mobile/lib/thread-composer-chips.test.tsx`：8/8 过（原有 3 个 + 新增 5 个：点例行任务导航到 `/routines`、点收藏/背景/备份打开各自回调、点画廊导航到 `/gallery`）。
- 相关 sheet 测试：`chat-model-picker` 77 个、`bottom-sheet-gesture` 2 个、`run-error-sheet-container` 3 个，全过。
- `apps/mobile/lib/native-sheet.test.tsx` 在本环境跑不起来（`SyntaxError: Unexpected token 'typeof'`）；`git stash` 在干净树上验证过，同样报错，是既有的环境问题，和本次改动无关。
- Biome 干净。
