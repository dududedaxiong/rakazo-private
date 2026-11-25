# Agent Note: 原生底表只弹出一点点就卡住：手势根的 flexBasis 0% 压垮动态量高

Status: implemented

## Problem

用户 2026-11-26 在手机上（1.0.41/vc40）反馈：画廊「其他」分类好了，但对话页底部快捷栏「其他模型」「收藏」「背景」「备份」四个入口还是打不开。点下去「有反应，弹出一点点，卡住了弹不出来」，并附了录屏。

录屏逐帧证实：点「其他模型」后底部出现约 50–60dp 的白条、带拖柄、背后变暗、内容空白、高度纹丝不动。拖柄是 `NativeSheet` 自己画的那条（32×4 的圆角条）；`Modal` 兜底没有拖柄、动画是 fade——所以渲染走的是原生底表路径，不是 Modal 兜底。

上一轮（2026-11-25）的诊断是错的：那篇笔记认为是五个 sheet 在 `useNativeSheet()` 还是 `undefined`（Android 原生底表还在动态加载）时直接 `return null`，修法 351a6df 删掉了 `Sheet === undefined` 早返回。但这台手机上原生底表的动态 import 在 App 启动时早已完成，`Sheet` 是真实组件，渲染走 `if (Sheet) → <NativeSheet>`，351a6df 的改动根本没跑到。351a6df 只修了一个真实使用中几乎不会出现的窗口（App 启动后最初几毫秒）。

真根因在 89f9d14（2026-11-22，为修左滑移除）：它在 `NativeSheet` 里把 `ScrollView` 包进裸 `<GestureHandlerRootView>`。`react-native-gesture-handler@2.32.0` 的 `GestureHandlerRootView` 在没传 `style` 时默认 `flex: 1`（源码：`style ?? styles.container`，`container: { flex: 1 }`）。`flex: 1` 展开是 flexGrow 1、flexShrink 1、flexBasis 0%。父容器（`NativeSheet` 里的 `View`）只有 `maxHeight`、没有定高，高度要靠内容量出来；Yoga 里父高不确定时，flexBasis 0% 的子项量高为 0。再里面是 `ScrollView`——滚动容器在滚动方向上内容不贡献尺寸——于是内容高度量出 0。`enableDynamicSizing` 的原生表按「拖柄 + 0 内容」定高，卡在约 50dp，纹丝不动。

对照：唯一能打开的「主模型」是唯一传了 `expanded` 的 sheet（`thread-model-picker-sheet.tsx:574`），内容拿固定 `height: maxHeight`，不依赖量高，所以能开。其他四个（收藏、背景、备份、其他模型）都不传 `expanded`，全中招。

## Decision

`apps/mobile/components/native-sheet.tsx` 的 `NativeSheet` 里，把裸 `<GestureHandlerRootView>` 改成 `<GestureHandlerRootView style={{ flexGrow: 0 }}>`。

`react-native-gesture-handler@2.32.0` 的实现是 `style ?? styles.container`——传了任何 `style` 就整块替换掉默认的 `flex: 1`，不是合并。只留 `flexGrow: 0` 时，flexBasis 回到 Yoga 默认 auto，视图按内容尺寸量高，恢复 89f9d14 之前的量高行为；手势根还在，`Swipeable` 左滑移除不受影响。

关键是不要写成 `style={{ flex: 0 }}`：`flex: 0` 展开是 flexGrow 0、flexShrink 0、flexBasis 0%，flexBasis 又回到 0%，和现在一样坏。flexBasis 必须保持 auto。

`bottom-sheet-shell.tsx` 的 Modal 兜底里的裸 `GestureHandlerRootView` 不动：Modal 是全屏定高容器，父高确定，`flex: 1` 在那里没问题，子项靠 flexGrow 撑满父容器是正确的。

351a6df 的五处改动保留，不回滚：它们无害，只是在这台手机上跑不到（原生表早已加载完）；App 启动最初几毫秒的窗口仍然由它们兜底。

## Alternatives considered

- **全部 sheet 都传 `expanded`**：最强的理由是最直接——「主模型」就是这么开的，照抄就能开。否决：`expanded` 让内容拿固定 `height: maxHeight`（约 90% 屏高），所有 sheet 都变成近全屏高，哪怕内容只有几行（收藏空态、备份页）；动态量高才是这些 sheet 该有的样子。这是用视觉回归去盖量高 bug，没修根因。
- **回滚 89f9d14，去掉手势根**：最强的理由是精确恢复 11-22 之前的量高行为，一行都不用多想。否决：那会把左滑移除的 bug 带回来——`Swipeable` 行在底表里收不到手势，正是 89f9d14 修掉的。手势根必须留，只改它的尺寸。
- **`onLayout` 手动量内容高度再定高**：最强的理由是量高逻辑完全掌握在自己手里，不依赖原生表的动态量高。否决：等于把 `enableDynamicSizing` 已经做的事重写一遍；内容每次变化（键盘弹出、收藏列表更新）都要重新量、重新 setState，多一套测量管线，代码量远大于一行 style。
- **把 `ScrollView` 换成 RNGH 的 `ScrollView`**：最强的理由是 RNGH 文档确实建议手势放进可滚动容器时用它。否决：量高失败的是外层的 `GestureHandlerRootView`（flexBasis 0%），不是里面的 `ScrollView`；换里面的组件，外面 0 高的父容器还在，量出来还是 0。
- **Android 上禁用原生表、全部走 Modal 兜底**：最强的理由是 Modal 是已验证能走的路，彻底绕开原生量高。否决：丢掉原生表的拖拽关闭和动态量高，是全量行为回退；原生表本身没坏（主模型就是证明），坏的只是一行 wrapper 的尺寸，禁用属于用大锤修小钉。
- **再改 Modal 兜底（让 351a6df 的路生效）**：最强的理由是兜底已经写好了。否决：录屏证明这台手机根本不走兜底——渲染的是原生表，带拖柄。兜底再怎么改，也修不到正在跑的那条路径。

## Consequences

- 四张卡住的底表恢复动态量高：内容多高、表就多高；左滑移除不受影响（手势根还在，只是尺寸改了）。
- 「主模型」行为不变（它本来就拿固定高）；Modal 兜底路径不变。
- 351a6df 的五处改动继续留着：它们只在 App 启动最初几毫秒（原生表还没加载完）起作用，是兜底，不是主修法。
- 陷阱：`style={{ flexGrow: 0 }}` 看起来像一句废话（flexGrow 0 本来就是 Yoga 默认），后人可能当成无用代码删掉。删了就回到默认 `flex: 1`、flexBasis 0%，底表重新卡住。`bottom-sheet-gesture.test.tsx` 里有回归断言钉住这一行，删 style 会先红测试。
- App 端改动，随下个 EAS 包才到用户手机；本次不打包、不部署。

## Verification

- 根因机制已对源码核实：`react-native-gesture-handler@2.32.0` 的 `GestureHandlerRootView`（通用与 Android 两个实现）都是 `style ?? styles.container`，`container: { flex: 1 }`——传任何 `style` 即整块替换默认，不是合并；89f9d14 的 diff 证实裸手势根是那次提交加进 `NativeSheet` 的；`thread-model-picker-sheet.tsx:574` 是唯一传 `expanded` 的 sheet，与真机上「主模型能开、其余卡住」对照一致。
- 回归测试：`bottom-sheet-gesture.test.tsx` 新增 1 个用例（共 3 个），断言原生表手势根的 `style.flexGrow` 为 `"0"` 且 `flexBasis` 为空（保持 auto）；mock 透传 `style`。反证：只回滚 `native-sheet.tsx` 的修法重跑，新用例变红、其余 2 个仍过，证实它确实钉住了这次修复。
- 相关测试 9 个文件、87 个用例全部通过：`bottom-sheet-gesture.test.tsx` 3、`bottom-sheet-shell.test.tsx` 4、`thread-favorites-sheet.test.tsx` 4、`thread-background-sheet.test.tsx` 4、`thread-backup-sheet.test.tsx` 4、`thread-media-model-sheet.test.tsx`、`gallery.test.ts` 14、`run-error-sheet-container.test.tsx` 3、`i18n.test.ts` 32。
- `native-sheet.test.tsx` 收集失败（`SyntaxError: Unexpected token 'typeof'`，34 个用例）；经 `git stash` 在干净树上复核，失败完全相同，是既有问题，与本次改动无关。
- 移动端 `tsc --noEmit`：9 个错误，与 `git stash` 对照的干净树基线完全一致（`bot-roster.test.ts` 1、`bottom-sheet-gesture.test.tsx` 2、`usage-detail.test.ts` 5、`usage-detail.ts` 1），本次零新增。注：新测试起初用 `createElement` 传 children 被 tsc 拒（React 19 类型要求 props 自带 `children`），改 JSX 写法后同时过 tsc 与 biome；不要改回 `children:` prop 写法，biome 的 `noChildrenProp` 会拦。
- `biome check`：2 个改动文件干净。
- `pnpm verify-notes`：60 篇笔记校验通过（新增本篇）。
- 未验证：真机上的底表打开手感（本次不打包，等用户点头打新包后手机验收）。

相关：[底表在原生表加载时也能打开；画廊新增「其他」分类、转移与一键清理](./2026-11-25-sheet-loading-fallback-and-gallery-other.md)（上一轮诊断，录屏证实其底表根因是错的；画廊部分仍成立）、[其他模型底表左滑失效与已移除模型残留备选池](../feature/2026-11-23-app-model-sheet-fixes.md)（89f9d14 引入手势根的来源；其「无 flex」判断是错的——裸 `GestureHandlerRootView` 默认 `flex: 1`）。
