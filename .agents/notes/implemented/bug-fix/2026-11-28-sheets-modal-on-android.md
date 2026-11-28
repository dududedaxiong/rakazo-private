# Agent Note: 安卓上卡片弹窗改走 Modal，不再用原生底表

Status: implemented

## Problem

User report 2026-11-28 12:46: App 1.0.44 里快捷卡片（收藏、背景、备份、模型、自定义设置）点了还是弹不出来。1.0.44 已包含 cb2ea91（去掉 `Sheet === undefined` 的提前返回），但用户实测无效。

## Root cause

cb2ea91 修的是一个实际上不存在的窗口。thread-screen 里五张 sheet 是常驻挂载的（`visible={favoritesOpen}` 等），`useNativeSheet()` 的动态 import 在 App 启动时就开始解析，等用户点卡片时原生 BottomSheet 早已加载好——`Sheet` 根本不是 `undefined`，代码走的是 `if (Sheet)` 分支，渲染的是原生底表，不是 Modal 兜底。

真正的问题在原生底表自己身上：`NativeSheet` 开了 `enableDynamicSizing`，内容又是包着 ScrollView 的结构。动态尺寸要靠量内容高度来定表高，ScrollView 没有固有高度，量出来是 0，整张表就以 0 高度渲染出来——点了等于没点。2026-11-24 报错详情那篇笔记已经点过这个嫌疑（`enableDynamicSizing` + 嵌套 ScrollView），当时没敢动；现在 1.0.44 实测证实了它。

## Decision

- `useNativeSheet()` 在 Android 上直接返回 `null`（hooks 之后再返回，不破坏 Rules of Hooks）。所有调用方本来就有 Modal 兜底，Android 上一律走 Modal，不再经过原生底表。
- 顺带把剩下三处 `Sheet === undefined → null` 的提前返回也去掉（bot-organize-modal、thread-bot-menu-sheet、bottom-sheet-shell），iOS 上加载窗口内也走 Modal，不再渲染空白。
- 不动 `enableDynamicSizing` 和 `NativeSheet` 本身：没有真机验证，改尺寸逻辑是猜；Modal 路径是现成且经过测试的。

## Alternatives considered

- 只修 `enableDynamicSizing`（关掉动态尺寸、给表定高）：最接近根因，但没有真机验证，改完不知道量高会不会换个方式继续错；Modal 路径是现成的，不赌。
- 只修这五张 sheet，不动 `useNativeSheet`：治标，报错详情、机器人菜单这些同样走原生底表的弹窗还会继续 invisible；根因在共享的底表上。
- 不动，等上游修：用户已经等过一轮，没道理再等。

## Consequences

- Android 上所有弹窗都走 Modal：收藏、背景、备份、模型选择器、自定义设置、报错详情、机器人菜单、收纳弹窗，全部能弹出来。iOS 不变，仍用原生底表。
- 代价是 Android 上失去原生底表的拖拽手感，换成 Modal 动画。这是可见的取舍：如果以后想恢复原生底表，得先在真机上解决动态尺寸量高问题，而不是再改提前返回。

## Verification

- Biome 4 个文件干净。
- 移动端测试 19/19 过（favorites sheet 4、run-error 3、composer chips 12）。
- `native-sheet.test.tsx` 在本环境跑不起来（`SyntaxError: Unexpected token 'typeof'`），干净基线也一样，是环境问题，与本次改动无关。
- 需重新打包 App（1.0.45）用户才能看到；服务端不用动。
