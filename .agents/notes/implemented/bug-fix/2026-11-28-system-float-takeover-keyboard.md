# Agent Note: 系统悬浮窗接管按钮与键盘抢焦点修复

Status: implemented

## Problem

2026-11-28 用户在手机上反馈系统悬浮窗（`RakazoSystemFloatService`，原生 `WindowManager` 悬浮窗里的 noVNC 电脑画面）有两个问题：

1. **标题栏的键盘按钮和分享（打开应用）按钮没用**：点键盘按钮弹不出键盘，点分享按钮什么也没发生（它只是回 Rakazo 应用，用户要的不是这个）。用户要的是一个**接管按钮**：点了就接管电脑，之后能往电脑里打字。
2. **悬浮窗一开，其他应用就打不了字**：切到别的 App（例如 Muse）点输入框弹不出键盘。悬浮窗在抢窗口焦点。这是更急的一半。

## Root causes (with evidence)

### 1. 键盘按钮弹不出键盘：`showKeyboard()` 在不可聚焦的窗口逻辑下是死路

旧代码：

```kotlin
private fun showKeyboard() {
  val view = webView ?: return
  view.requestFocus()
  val inputMethodManager = getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager
  inputMethodManager.showSoftInput(view, InputMethodManager.SHOW_IMPLICIT)
}
```

`showSoftInput(view, SHOW_IMPLICIT)` 只在目标 `view` 所在的窗口当前拥有输入焦点时才会生效。旧窗口创建时没有 `FLAG_NOT_FOCUSABLE`，按理说窗口是可聚焦的——但 `requestFocus()` 发生在点击标题栏按钮的瞬间，窗口焦点并不稳定落在 `WebView` 上；`SHOW_IMPLICIT` 又是“系统觉得合适才弹”的弱请求，输入法可以直接拒绝且无任何反馈。结果就是点了没反应。根因不是少调了一个 API，而是**顺序错了**：没有先把窗口变成可聚焦、等布局更新落定、再让 `WebView` 拿到焦点、最后用强请求弹键盘。

### 2. 悬浮窗抢了其他应用的键盘：窗口默认就是可聚焦的

窗口创建时 flags 只有 `FLAG_NOT_TOUCH_MODAL`：

```kotlin
WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
```

没有 `FLAG_NOT_FOCUSABLE`。`FLAG_NOT_TOUCH_MODAL` 只让窗口外的触摸透传到底层应用，**不影响窗口焦点**。所以悬浮窗一旦显示就成了系统的聚焦窗口：别的 App 的输入框拿到的是“没有窗口焦点”的状态，输入法不为它弹出。类注释当时还把这写成设计——“窗口被点时拿焦点，远程屏幕才能接受键盘输入”——这个设计本身就是问题 2 的根因：为了让电脑能打字，付出了“别的 App 都不能打字”的代价。

### 3. 旧按钮的语义本身就是错的

键盘按钮只在最大化时出现（`updateOperationButtons()`），却不负责把窗口变成可输入状态；打开应用按钮与前台通知的点击是同一条回应用路径，标题栏里再放一个是重复入口。两个按钮各解决一半问题，合起来哪个都没解决。

## Decision

### 1. 标题栏：键盘 + 打开应用两个按钮换成一个接管按钮

标题栏顺序现在是标题、接管、放大/还原、关闭。接管按钮任何尺寸下都可见（旧按钮只在最大化时出现；接管本身就是从小窗变大窗的动作，藏起来就没法点）。

- 点接管（未接管时）：如果窗口是小窗，先最大化；再把窗口改成可聚焦（清掉 `FLAG_NOT_FOCUSABLE`，`updateViewLayout`），`WebView` 拿焦点，用 `SHOW_FORCED` 弹键盘；接管按钮切到已接管状态（主题色 tint + 内容描述改成“取消接管”）。
- 再点接管（已接管时）：收键盘、恢复 `FLAG_NOT_FOCUSABLE`、窗口还原回小窗、按钮回到未接管状态。接管是一个开关，不是单向动作。
- 放大/还原按钮不动：只改尺寸，**不**弹键盘（只在明确点接管时才弹键盘，单纯打开或放大窗口不弹）。
- 关闭按钮不动。回应用的入口仍在前台通知上（`openAppPendingIntent()`），标题栏不再重复放。

新增一个接管图标（光标箭头，`ic_rakazo_system_float_takeover.xml`）和 `rakazo_system_float_takeover` / `rakazo_system_float_release` 两个字符串（默认英文 + 简繁中文，与旧键盘字符串的覆盖范围一致）。键盘图标、打开应用图标、`rakazo_system_float_keyboard`、`rakazo_system_float_open_app` 四个资源删掉：grep 核实过，除本文件外没有任何代码引用它们（合约测试里对打开图标的断言随本改动同步更新）。

### 2. 窗口默认不可聚焦，只在接管期间临时可聚焦（核心修复）

窗口创建时的 flags 改成：

```kotlin
WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
  WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
```

焦点流转由状态机（`SystemFloatTakeoverState.kt`，纯 Kotlin、无 Android 依赖）说了算，服务只执行状态机给出的 effect：

| 事件 | 状态变化 | effect |
| --- | --- | --- |
| 点接管（小窗） | 未接管 → 已接管 | 最大化窗口、清 `FLAG_NOT_FOCUSABLE`、强制弹键盘 |
| 点接管（已最大化） | 未接管 → 已接管 | 清 `FLAG_NOT_FOCUSABLE`、强制弹键盘 |
| 再点接管（已接管） | 已接管 → 未接管 | 收键盘、恢复 `FLAG_NOT_FOCUSABLE`、还原小窗 |
| 点放大（未接管） | 小窗 → 大窗 | 只最大化，不改焦点、不弹键盘 |
| 点还原（已接管） | 已接管 → 未接管 | 收键盘、恢复 `FLAG_NOT_FOCUSABLE`、还原小窗 |
| 点画面（已最大化、未接管） | 未接管 → 已接管 | 清 `FLAG_NOT_FOCUSABLE`、用 `SHOW_IMPLICIT` 弹键盘 |
| 点画面（小窗） | 不变 | 小窗只做观看，点按透传给 noVNC 当鼠标点击，不触发接管 |
| 键盘被收起（已接管） | 已接管 → 未接管 | 恢复 `FLAG_NOT_FOCUSABLE`，留在大窗 |
| 关闭窗口 | → 未接管 | 收尾清理 |

三条焦点流转逐一核对过：

- （a）悬浮窗显示（小窗或大窗，未接管）+ 用户在别的 App 点输入框 → 悬浮窗不可聚焦，窗口焦点留在那个 App，键盘正常弹出。
- （b）用户点接管 → 窗口变可聚焦、`WebView` 拿焦点、键盘为电脑弹出。
- （c）用户关窗/还原小窗 → 恢复 `FLAG_NOT_FOCUSABLE`，焦点回到下层应用。

### 3. 键盘弹出的顺序修好，只在明确接管时强制弹出

`takeOver(forced)` 的顺序固定为：变可聚焦 → `updateViewLayout` → `WebView.post { requestFocus(); showSoftInput(...) }` → 250ms 后重试一次（只重试一次，且仅当仍处于已接管状态）。明确点接管按钮时用 `SHOW_FORCED`（用户点了一下就是要键盘，弱请求会被输入法拒绝）；点画面触发的接管用 `SHOW_IMPLICIT`（被动触发，不强求）。打开窗口、放大窗口都不弹键盘。

键盘收起的检测用根视图的 `OnGlobalLayoutListener` 看可见区域高度差：已接管状态下键盘先出现过、之后消失，且 300ms 后仍未回来，就释放接管（恢复 `FLAG_NOT_FOCUSABLE`，留在大窗）。这个监听只在已接管且键盘曾经可见时才触发释放，不会在键盘刚弹出的动画过程里误释放。

### 4. 与上一篇笔记的关系

[电脑画面控制按钮新版仍在](../../implemented/bug-fix/2026-11-27-computer-screen-controls-still-visible.md) 里写过“系统窗只做观看（小窗不接管）”。本改动部分改变了那一点：小窗仍默认只做观看，但用户点接管按钮可以从小窗直接接管（先最大化再接管）。观看默认不变，接管改成用户明确点出来的动作。

## Alternatives considered

- **只修 `showKeyboard()`，不动 flags（例如改成 `SHOW_FORCED` 或先 `requestFocusFromTouch`）**——最强的理由是改动最小。但它只可能修问题 1，问题 2 的根因（窗口默认可聚焦）原封不动；而且 `SHOW_FORCED` 在不可聚焦的窗口上同样可能被系统忽略，治标不治本。否。
- **窗口一直可聚焦，只在切到别的 App 时让出焦点**——最强的理由是电脑随时能打字，不用多点一下接管。但服务侧不知道用户何时切到别的 App（没有可靠的“前台 App 变了”回调给悬浮窗服务用），做不到“及时让出”；这就是用户现在遇到的状况的翻版。否。
- **用 `FLAG_ALT_FOCUSABLE_IM` 代替来回切换 `FLAG_NOT_FOCUSABLE`**——最强的理由是 Android 专门为“不可聚焦的窗口也想和输入法交互”准备了这个 flag，一个 flag 就能同时满足“不抢焦点”和“能打字”。但它的语义是窗口在不可聚焦的情况下仍可挂输入法：输入法一旦挂上我们的 `WebView`，别的 App 的输入框就可能再次拿不到键盘，问题 2 会以更难查的形式回来。接管时直接清掉 `FLAG_NOT_FOCUSABLE` 是明确的状态切换，出了问题能从状态机里查到；`FLAG_ALT_FOCUSABLE_IM` 的行为取决于各家输入法的实现，查起来更难。否，记录在此，万一 `FLAG_NOT_FOCUSABLE` 单独用在真机上仍不能恢复别的 App 的键盘，再回头试它。
- **接管按钮只在最大化时出现（沿用旧按钮的可见性规则）**——最强的理由是与旧行为一致，小窗保持极简。但接管的入口就是“从小窗变大窗”，藏起来等于没有入口；用户得先点放大、再点接管，两步。否，接管按钮常驻。
- **点画面（小窗）也触发接管**——最强的理由是用户点哪里想打字、哪里就接管，最直觉。但小窗里的点按现在是 noVNC 的鼠标点击（观看时点画面是点电脑里的东西），一点就最大化会打断观看；而且分不清“想点一下”还是“想打字”。否，只在大窗里点画面才接管，小窗的点按保持为鼠标点击。
- **键盘收起后自动把窗口还原回小窗**——最强的理由是状态干净：没键盘 = 没接管 = 回小窗。但用户收起键盘常常只是想看一眼全屏画面，还原回小窗是多余的打断。否，收键盘只释放焦点，不动尺寸。
- **给模块加 Kotlin 单测 harness（Gradle + JUnit）只为测状态机**——最强的理由是真单测比源码断言可信。但模块现在没有任何构建/测试配置，加一套 Gradle 配置只是为了测一个纯函数，改动面远超收益。否，状态机抽成无 Android 依赖的纯 Kotlin 文件，用现有的 TS 合约测试（源码断言风格）覆盖转移表，并用一次性编译器校验逻辑（见 Consequences）。

## Consequences

- 好处：悬浮窗默认不再抢任何 App 的键盘；接管是用户明确点的开关，键盘只在接管时出现；状态机是纯函数，转移规则可 review、可测，不用真机也能核对焦点流转。
- 代价：电脑打字多了一步明确操作（点接管）；之前“窗口一点就拿焦点、随时能打字”的行为没了——这是有意的，旧行为就是问题 2 的根因。键盘收起检测依赖可见区域高度差，不同机型/输入法下阈值可能要调。
- 未验证（无真机/模拟器）：（a）别的 App 的键盘在悬浮窗显示时是否确实恢复；（b）接管时键盘是否确实弹出、重试一次是否足够；（c）键盘收起检测在真机输入法上是否误触发或漏触发；（d）`FLAG_NOT_FOCUSABLE` 下小窗的点按是否仍正常透传给 noVNC 当鼠标点击。以上四项必须在真机上核实后才能算修完，见下面 Verification 一节。
- 风险：`SHOW_FORCED` 的键盘在接管释放时若未及时收起，会短暂盖住下层应用；释放路径里先收键盘再恢复 flag，且 `onDestroy` 也走同一释放路径。

## Testing

- `apps/mobile/lib/system-float-window-contract.test.ts`：旧的“键盘/打开应用按钮”断言改成接管按钮断言（同一文件、同一测试）；新增状态机转移与焦点 flag 的断言。
- 纯函数 `reduceTakeover` 的逻辑用一次性 Kotlin 编译器在 `/tmp` 里编译运行核实（不进仓库、不加构建配置），覆盖转移表全部事件；结果见提交记录。
- `pnpm verify-notes` 通过；Biome 覆盖改动的 TS 文件；Kotlin 无编译器可用，未做编译验证——CI 的 Android 构建是兜底。
- 真机验证仍待做（见 Consequences 未验证四项），由用户在手机上核实。
