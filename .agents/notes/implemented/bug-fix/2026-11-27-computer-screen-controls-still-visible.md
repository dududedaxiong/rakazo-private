# Agent Note: 电脑画面控制按钮新版仍在——注入不可靠 + 原生方向键栏

Status: implemented

## Problem

db3405a（2026-11-27，App 1.0.41 vc42）往屏幕 WebView 里注入一段 `<style>` 藏页面自带的控制面板，小窗口藏全部、接管藏缩放组与方向键。用户在新版上录像核实：两处都还在。

- 小窗口（悬浮窗）：`+`/`-`、Esc、Tab、Ctrl、四个方向键、手柄按钮，全在。
- 全屏：屏幕上一个浮动的 `+`/`-` 簇，底部还有一行 Esc、Tab、Ctrl、四个方向键。

用户当时的要求没变：小窗口不要任何操作面板；接管后也不要 `+`/`-` 和 4 个方向键（Esc/Tab/Ctrl 可以留）。

## Root causes (with evidence)

### 1. 注入只靠页面加载后的一次 `injectedJavaScript`，在真机上没落下

选择器本身是对的——上游现行 `embed.html`（2026-11-27 从 elie222/rakazo 拉取核实）里，控制面板的 id 与注入的目标完全一致：

- `#mobile-view-controls`：`+`/`-` 缩放与 `^`/`v` 滚动，2×2 60px 按钮，嵌在 `#mobile-controls` 里，初始带 `hidden`。
- `#mobile-key-bar`：Esc、Tab、Ctrl 与四个方向键，按钮带 `data-key`，初始带 `hidden`。
- `#mobile-controls`：粘贴/键盘/手柄三个按钮。
- 仓库里旧版 `embed.html` 根本没有 `#mobile-view-controls`，所以视频里出现 `+`/`-` 本身就证明线上跑的是新版页面，不是仓库旧版。

脚本本身在 jsdom 里跑过、能把这些元素全藏起来（既有测试 4 例）。用户又确实装了新版——悬浮的本地流量开关能点、点了出「已保存，配套更新到达后生效」，那是同一批改动。所以剩下的唯一解释是：真机 WebView 里那段注入没执行、或没落到文档里。`!important` 的 `display:none` 一旦进了文档，页面自己的 JS（`attachMobileKeyboard`/`attachMobileTrackpad` 只是去掉 `hidden` 属性）盖不掉它；按钮还在，等于 `<style>` 根本不在文档里。到底是哪个原生环节丢了这次注入（页面加载时序、缓存、WebView 恢复），本机无真机/模拟器，无法远程取证——所以修复不赌单次注入一定成功，改成多处兜底（见 Decision）。

### 2. 系统悬浮窗的原生 WebView 从来没有注入

`apps/mobile/modules/rakazo-system-float/.../RakazoSystemFloatService.kt` 里那个原生 `android.webkit.WebView` 只 `loadUrl`，用的是 plain `WebViewClient`，没有任何 `evaluateJavascript`。它自己的注释还写着「on-screen +/- buttons hidden」，写的是意图，不是行为——没有任何代码藏它们。用户一旦走系统悬浮窗看画面，按钮必然全在。

### 3. 全屏底部的方向键根本不在 WebView 里，注入永远够不着

全屏底部那行 Esc、Tab、Ctrl、四个方向键是原生的 `ComputerKeyboardBar`（`apps/mobile/components/computer-keyboard-bar.tsx`），`computer.tsx:422` 在 `hasControl`（接管）时才渲染。它是 React Native 视图，不是页面元素，往页面里注样式对它无效。db3405a 只处理了页面内的按钮，漏了这一行。接管后用户明确不要方向键，所以这一行必须在原生侧去掉方向键，只留 Esc/Tab/Ctrl。

## Decision

### 1. 注入改成“早注 + 晚注 + 换模式能更新”，不再赌一次加载

`apps/mobile/lib/computer-screen-chrome.ts` 的脚本改成模式感知：`<style>` 上记 `data-mode`，重复注入时模式没变就跳过、模式变了就更新样式内容。两个 WebView（悬浮窗与全屏 `ScreenWebView`）同时用：

- `injectedJavaScriptBeforeContentLoaded`：页面脚本跑之前就把样式放进文档，控制面板还没被页面的 JS 揭开 `hidden` 就已经被藏起来，时序上不再赛跑。
- 保留 `injectedJavaScript`：页面重载/导航后重新落一次，兜底。
- 全屏 `ScreenWebView` 原来只在 `nativeKeyboard` 时才有 `injectedJavaScriptBeforeContentLoaded`（键盘启动脚本），现在把去杂脚本也拼进去，两段拼成一段注入。

### 2. 系统悬浮窗的原生 WebView 也注同一段样式

`RakazoSystemFloatService.kt`：`WebViewClient.onPageFinished` 里 `evaluateJavascript` 一段与 float 模式等价的隐藏样式（`#mobile-view-controls,#mobile-key-bar,#mobile-controls,#noVNC_control_bar_anchor{display:none!important}`）。系统窗只做观看（小窗不接管），float 模式是正确的那一份。

### 3. 原生方向键栏去掉四个方向键，只留 Esc/Tab/Ctrl

`ComputerKeyboardBar` 的 `keySpecs` 去掉 ArrowLeft/ArrowDown/ArrowUp/ArrowRight 四项，键盘切换按钮与 Esc/Tab/Ctrl 不动。这个栏只在接管时渲染（`computer.tsx:422` 的 `hasControl`），去掉方向键正好就是“接管后不要方向键”。方向键没有别的原生入口（全 App 只有这一个栏渲染它们），页面内的方向键由注入负责。

## Alternatives considered

- **只修选择器**——选择器已经是对的（上游页面核实过），修选择器修不到点上。否。
- **重建沙箱镜像、把 `embed.html` 里的按钮删掉**——要重建镜像加部署，且线上镜像版本与仓库不同步的问题还在；注入对任何页面版本都有效。否（与 db3405a 当时的结论一致）。
- **服务端代理顺手把隐藏样式注进页面**——代理已经往页面里注了一个 shim（藏 `#noVNC_status`），但再把移动端控制也藏进去会影响网页端/桌面端，那些端可能还要这些按钮；App 端注入只影响手机。否。
- **只加 `injectedJavaScriptBeforeContentLoaded`，不留 post-load**——早注能解决时序，但页面重载/导航后早注不一定重跑，留 post-load 兜底更稳；脚本是幂等的，重复跑无害。否（两个都留）。
- **方向键栏改成可折叠而不是删掉**——用户说的是接管后不要方向键，不是“藏起来备用”；栏只在接管时出现，折叠等于多一个用户没要的控件。否，直接删。

## Consequences

- 隐藏不再依赖某一次加载事件：早注在页面脚本之前、晚注在加载之后、系统窗在 `onPageFinished`，三处各自独立，任何一处落下都能藏住。
- 模式切换不再依赖 WebView 重挂：脚本按 `data-mode` 更新样式，接管/释放时即使 URL 不变，样式也会跟着换。
- 系统悬浮窗与应用内悬浮窗行为一致，不再有一条没注入的路。
- 接管后全屏底部只剩键盘切换、Esc、Tab、Ctrl；方向键在原生侧与页面内都被去掉。
- 代价：Kotlin 那处改动本机无法编译验证（无 Android SDK），只按现有模式写了最小的 `onPageFinished` 注入；下次打包后需用户在手机上核对系统悬浮窗。

## Verification

- `computer-screen-chrome.test.ts`：新增模式切换测试（float 注完再注 takeover，样式内容跟着换、仍只有一个 `<style>`）与上游结构测试（按上游现行 `embed.html` 的嵌套与 `hidden` 属性造页面：`#mobile-view-controls` 嵌在 `#mobile-controls` 里，`#mobile-key-bar` 带 `data-key`，脚本仍能全藏）。
- `computer-keyboard-bar.test.tsx`：按钮数 8 → 4（键盘切换 + Esc + Tab + Ctrl）；“关闭后不再发命令”那例的按键循环去掉方向键。
- `computer-screen.test.tsx` 与 `computer-float-window.test.tsx`：断言两个 WebView 的 `injectedJavaScriptBeforeContentLoaded` 与 `injectedJavaScript` 里都有去杂脚本。
- `pnpm verify-notes` 通过；Biome 检查改动文件干净；根 vitest 配置跑相关测试文件。
- 未在真机/模拟器上截图验收（本机无可用模拟器）；下次打包后请用户在手机上核对小窗口、全屏、系统悬浮窗三处。
- 相关记录：上一次去杂见 [2026-11-27-computer-screen-cleanup-local-traffic-float-ai-pointer.md](../feature/2026-11-27-computer-screen-cleanup-local-traffic-float-ai-pointer.md)。
