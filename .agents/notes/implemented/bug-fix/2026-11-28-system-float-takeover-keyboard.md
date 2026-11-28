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

## Round 2 (2026-11-28): 接管不是弹键盘，是设置里的电脑接管

Status: implemented (code + tests, no device yet). This round supersedes
round 1's Decision §3 (forced keyboard on takeover) and the
keyboard-dismiss auto-release in Decision §2's table and §3's last
paragraph: both are removed, not adjusted.

### What the video showed

The user sent a screen recording of the round-1 build on their phone.
Frame-by-frame diagnosis found THREE takeover attempts, not two:

1. **Attempt #1**: takeover button BLUE, pinyin keyboard up. Then the
   keyboard GONE (the user tapped the noVNC canvas). Then the button
   WHITE — auto-release.
2. **Attempt #2**: button BLUE again, no keyboard visible. Then button
   WHITE — auto-release #2. The window stayed maximized, so this was
   the KeyboardDismissed auto-release, not a manual toggle-off.
3. **Attempt #3**: button BLUE, keyboard NEVER appears, stays blue,
   clicks still reach the computer (a later frame shows a shell command
   running).

### Confirmed causes

**Failure 1 (attempts 1+2): the forced keyboard had no input connection.**
The noVNC page's only keyboard path is a hidden `<textarea>`
(`#mobile-keyboard-input`), focused ONLY by the page's own "Show
keyboard" button. The float's chrome-hiding injection hid that button
(it lives inside `#mobile-controls`), and nothing in the service ever
focused the textarea. `showKeyboardAfterFocus` only did native
`view.requestFocus()` + `showSoftInput(SHOW_FORCED)` on the WebView;
with no editable element focused, `WebView.onCreateInputConnection`
returns null, so the IME was forced up with no input connection and
died on the first canvas tap. The page's own `keepOpen` guard only
protects taps when the input IS focused — dead when it isn't. The
dismiss listener then saw a real dismissal and released the takeover,
which is what turned attempt #1's dead keyboard into a white button,
and attempt #2's release the same way.

**Failure 2 (attempt 3): the show path was blind fire-and-forget.**
`hideKeyboard()` called `view.clearFocus()` after attempt #2's
release, and the show path was `view.post{}` + one 250ms retry — both
ran before the WindowManager applied the flag change and granted
window focus, so both `showSoftInput` calls were silently dropped. No
`onWindowFocusChanged` / `isActive` / `hasFocus` check exists anywhere
in the module. The state machine stuck blue with no keyboard.

**Ruled out**: the 250ms retry hiding the keyboard (a duplicate
showSoftInput on an already-shown IME is a no-op); the layout-listener
threshold misreading (the release requires 300ms with no visible pass,
so it fired on a real dismissal); a stale retry from the first
takeover (`cancelKeyboardRetry` ran on entry and in `hideKeyboard`,
and the retry nulled its field at start).

### The user's correction (replaces the forced-keyboard design)

User 2026-11-28 17:13: "接管不是弹键盘啊，而是像设置里电脑接管一样"
("Takeover is not about popping up the keyboard, it's like the
computer takeover in Settings.") 17:14: "下面有esc，键盘图标那种"
("Below there are ESC, the keyboard icon, that kind of thing.")

What the Settings takeover is: the in-app computer screen has
`hasControl` and `chromeMode={hasControl ? "takeover" : "float"}`. The
chrome modes live in `computer-screen-chrome.ts`: "float" (watching)
hides EVERY in-page control; "takeover" (user driving) KEEPS the
Esc/Tab/Ctrl bar (`#mobile-key-bar`) and the paste/keyboard/trackpad
row (`#mobile-controls`) visible (only hides the +/- zoom cluster and
the arrow keys). The user drives the computer, and the keyboard comes
up naturally when they tap a text field or noVNC's own keyboard
button. The float's native WebView was permanently in "float"
(watching) mode.

### Decision (round 2)

1. **Do NOT force-pop the soft keyboard.** `showSoftInput` and the
   250ms retry are gone from the takeover path entirely — no
   `showSoftInput` call exists in the service any more. This kills
   both failure modes at the root: no forced IME with no input
   connection, no blind show that can be dropped.
2. **The takeover button switches the WebView's chrome from "float"
   to "takeover" mode.** The takeover rules are the exact rules from
   `computerScreenChromeScript("takeover")`: keep `#mobile-key-bar`
   and `#mobile-controls` visible, hide only `#mobile-view-controls`
   and the four `#mobile-key-bar [data-key="Arrow…"]` keys. Tapping
   the button again switches back to "float" chrome (hide all
   controls). The button's highlight still shows taken-over vs not.
3. **The takeover button still makes the window focusable** (clear
   `FLAG_NOT_FOCUSABLE`) while taken over, so the keyboard CAN appear
   naturally when the user taps a text field or noVNC's keyboard
   button. Nothing forces it up. Releasing restores
   `FLAG_NOT_FOCUSABLE`.
4. **The keyboard-dismiss auto-release is gone** — the layout
   listener, the `KeyboardDismissed` event, and the transition are
   all removed. Dismissing the keyboard must NOT end the takeover;
   it ends ONLY on an explicit takeover-button tap,
   maximize/restore, or close.
5. **One injected style element carries both modes.** The chrome
   rules live in a new pure function (`SystemFloatScreenChrome.kt`,
   mirroring `computer-screen-chrome.ts` selector for selector), and
   the service swaps its content per mode via a new
   `APPLY_SCREEN_CHROME` effect. `onPageFinished` re-injects the
   CURRENT mode's rules (not always the float rules), so a page
   reload while taken over keeps takeover chrome. The style element
   is keyed by id with a `data-mode` attribute, so a mode switch
   rewrites the rules instead of stacking a second element.
6. **At rest the float stays `FLAG_NOT_FOCUSABLE`** so other apps
   keep their keyboards; while taken over it is focusable (needed
   for typing into the computer); releasing goes back to
   `NOT_FOCUSABLE` via the takeover button (or maximize/restore/
   close). Unchanged from round 1.
7. Small-window taps stay noVNC mouse clicks. Tapping into the
   maximized screen while NOT taken over takes over (chrome to
   takeover + focusable) — with no forced keyboard.
8. Title-bar layout (takeover / maximize-restore / close) unchanged.

The state machine's new transition table (no `KeyboardDismissed`
event, no `SHOW_KEYBOARD_*` effects, `APPLY_SCREEN_CHROME` on every
transition that changes the takeover state):

| 事件 | 状态变化 | effect |
| --- | --- | --- |
| 点接管（小窗） | 未接管 → 已接管 | 最大化窗口、清 `FLAG_NOT_FOCUSABLE`、切 takeover chrome |
| 点接管（已最大化） | 未接管 → 已接管 | 清 `FLAG_NOT_FOCUSABLE`、切 takeover chrome |
| 再点接管（已接管） | 已接管 → 未接管 | 收键盘（若已弹出）、恢复 `FLAG_NOT_FOCUSABLE`、切 float chrome、还原小窗 |
| 点放大（未接管） | 小窗 → 大窗 | 只最大化，不改焦点、不切 chrome |
| 点还原（已接管） | 已接管 → 未接管 | 收键盘、恢复 `FLAG_NOT_FOCUSABLE`、切 float chrome、还原小窗 |
| 点画面（已最大化、未接管） | 未接管 → 已接管 | 清 `FLAG_NOT_FOCUSABLE`、切 takeover chrome，不弹键盘 |
| 点画面（小窗） | 不变 | 小窗只做观看，点按透传给 noVNC 当鼠标点击 |
| 键盘被收起（已接管） | 不变 | 收起键盘不再结束接管 |
| 关闭窗口 | → 未接管 | 收尾清理 |

### Alternatives considered (round 2)

- **Keep forcing the keyboard, but focus the page's hidden textarea
  first (evaluateJavascript `input.focus()` before showSoftInput)** —
  strongest reason: it would give the forced IME a real input
  connection, fixing failure 1 without changing the design. But it
  keeps the blind fire-and-forget show (failure 2 needs a focus
  callback anyway), and it fights the user's stated model: they
  pointed at the Esc/keyboard bar as the thing they want, i.e. the
  page's own controls driving the keyboard, not the service forcing
  one. No — the user corrected the design, not the mechanism.
- **Keep the dismiss auto-release, but only after the keyboard was
  shown by the page's own button** — strongest reason: it would
  preserve round 1's "dismissing means done" convenience. But the
  user explicitly wants to dismiss the keyboard and keep driving;
  any dismiss-based release misfires the moment they hide the
  keyboard to see the full screen. No.
- **Two injected style elements (one per mode), toggling which is
  active** — strongest reason: each mode's rules are independent
  text, no rewriting logic. But two elements can both apply if the
  toggle misses, and the float rules use `!important` on the same
  selectors the takeover rules need visible — order/specificity
  between two elements is exactly the bug class round 1 hit. No —
  one element, content swapped per mode.

### Testing (round 2)

- `apps/mobile/lib/system-float-window-contract.test.ts`: the old
  "forced keyboard on takeover" case is replaced by a case pinning
  the new rules (no `showSoftInput` / `SHOW_FORCED` / `SHOW_IMPLICIT`
  / retry / dismiss listener / `KeyboardDismissed` anywhere in the
  service; `APPLY_SCREEN_CHROME` on takeover; `onPageFinished`
  re-injects the current mode). New case pins the chrome rules
  (takeover keeps `#mobile-key-bar` and `#mobile-controls` visible,
  float hides them) with the exact selectors from
  `computer-screen-chrome.ts`, and the state-machine case drops
  `KeyboardDismissed` / `SHOW_KEYBOARD_*` and adds
  `APPLY_SCREEN_CHROME`. 9/9 pass.
- Pure Kotlin checks (one-off compiler, nothing added to the repo):
  the state machine transitions (takeover/release/maximize/screen
  tap/close, no `SHOW_KEYBOARD` effect anywhere) and the chrome
  function (float hides all four panels, takeover keeps the
  Esc/keyboard bars, script keys the style by id and records the
  mode) — 34/34 pass.
- `pnpm verify-notes` passes; Biome clean on the changed TS file;
  `tsc --noEmit` no new errors. Kotlin service file not compiled
  (no Android SDK here) — CI's Android build is the backstop, as in
  round 1.

### Still needs real-device confirmation (no device yet)

Round 1's four unconfirmed items carry over in updated form — the
first two are now the point of this round, and must be checked on the
user's phone after packaging:

(a) the bottom bar with ESC and the keyboard icon is actually visible
in takeover mode (and hidden again after releasing);
(b) tapping the keyboard icon brings the keyboard up and typing
reaches the computer;
(c) dismissing the keyboard does NOT release the takeover (button
stays blue, window stays focusable and maximized);
(d) other apps' keyboards still work while the float is at rest
(`FLAG_NOT_FOCUSABLE` at rest, unchanged);
(e) `FLAG_NOT_FOCUSABLE` under a small window still lets taps through
to noVNC as mouse clicks.

## Round 3 (2026-11-28): the takeover button never reached the server

Status: implemented (code + tests, no device yet). This round keeps
round 2's design (no forced keyboard, no dismiss auto-release, chrome
switch) and fixes the layer underneath it: the takeover button did
not change what page the window was showing.

### What the video showed

The user installed the round-2 build, opened the system popup, and
tapped the takeover button (blue, taken-over state), then tapped the
computer for about nine seconds. The noVNC bottom bar (Esc, keyboard
icon, trackpad) never appeared; the remote desktop stayed
letterboxed with only the desktop's own taskbar at the bottom of the
canvas.

### Confirmed cause

The takeover button was purely local, and the window opened on a
view-only page. The exact code path, verified in the code:

1. **The popup opens on the first URL fetched, which is view-only.**
   The header entry opens the float with `systemOnly` set
   (`thread-screen.tsx`). On open, the refresh controller fetches
   `computer/screenUrl` at once, before any takeover; the server
   returns a view-only URL when the user does not hold control
   (`apps/api/src/routes/computer.ts` `screenUrl` handler:
   `holder = holdsComputerControl(computer, bot.id, context.actor)`,
   then `withViewOnly(session.url, !holder)`, and
   `apps/api/src/computer-control.ts` `withViewOnly` sets
   `view_only=true`). The auto-popout effect shows the system
   window on the first loaded URL — the view-only one.
2. **The open-time takeover exists, but nothing waits for it.**
   The same file's takeover effect does `rpc("computer/takeover")`
   and then a forced screen refresh, and the rotated-capability
   effect re-points the window at the new URL via `updateUrl` — so
   the system-only path can recover on its own when the takeover
   succeeds. But the popout does not wait for it, and if the
   takeover is refused (a run holds the lease: the server answers
   "Stop the bot first") or the refresh does not land, the window
   stays view-only with no retry path.
3. **The other way in never takes over at all.** The in-app float's
   pop-out button (`toggleSystemFloat` → `showSystemWindow`) shows
   the system window with the current URL and never calls
   `computer/takeover`.
4. **The native takeover button could not fix any of it.** The
   button (`RakazoSystemFloatService.onTakeoverTapped`) only ran
   the local state machine (focusable + chrome). There was no
   native→JS event channel — the round-1 report already noted
   this — so the tap could never take the lease or change the URL.
   A blue button with a view-only page behind it was the only
   possible outcome.
5. **On a view-only page the bars can never appear.** The computer
   page (`infra/sandboxes/computer/embed.html`) only calls
   `attachMobileKeyboard` under
   `if (!rfb.viewOnly && (isTouchBrowser() || window.__rakazoNativeKeys))`,
   and `attachMobileKeyboard` itself returns early on
   `rfb.viewOnly`. So `#mobile-key-bar` and the three buttons keep
   their `hidden` attribute forever, and a view-only RFB session
   never sends input either. Round 2's chrome only stopped hiding
   the rows; it never showed them, and even visible buttons would
   be dead on a view-only page.
6. **Correction to the task's point 2:** the page's CSS has a
   `[hidden]` rule only for `#mobile-key-bar`
   (`#mobile-key-bar[hidden]{display:none}`); the three buttons are
   hidden by the `hidden` attribute's default style, not by a page
   rule. The force-visible rules below cover both.

### Decision (round 3)

1. **Native→JS takeover event.** The module declares
   `Events("onTakeoverChanged")` and an `isTakenOver` query; the
   service notifies the module only when a transition really flips
   the takeover state (a canvas tap while already taken over says
   nothing — the lease and the URL are already right), and the
   module forwards it with `sendEvent`. `lib/system-float.ts`
   wraps both as `subscribeSystemFloatTakeover` /
   `systemFloatIsTakenOver`.
2. **A native takeover tap drives the lease and the URL.** While
   the system window is up, the float subscribes and handles each
   flip: taken over → `rpc("computer/takeover")`, then a forced
   screen refresh — the existing rotated-capability effect
   re-points the window at the interactive URL, whose page runs
   the attach that un-hides the bottom bar. Released → hand the
   lease back (`rpc("computer/release")`) and re-point at the
   view-only URL. A lease the user already held before this
   session opened is never taken or handed back here, and a tap
   that landed before the subscription is reconciled by asking the
   window what it is showing now.
3. **The popup waits for the open-time takeover to settle.**
   A `controlReady` flag is set when the takeover attempt finishes
   (granted or refused, or already held); while the computer runs
   and it is not set, the auto-popout waits, so the popup opens on
   the interactive URL instead of the view-only one fetched first.
   A refused takeover still pops out view-only — watching stays
   useful, and the native tap retries the takeover later.
4. **Defense in depth in the takeover CSS:** the takeover rules
   now force `#mobile-key-bar[hidden]`,
   `#mobile-controls[hidden]`, and the three buttons visible with
   `!important`, so the bar shows even if the page's own un-hide
   did not run. This is a complement to (2), not a substitute: on
   its own it cannot work, because a view-only page never attaches
   the button handlers and never sends input.
5. **The in-app screen is not mirrored — verified, not guessed.**
   `app/computer.tsx` drives its takeover from JS (`hasControl`
   → takeover RPC → refetch), sets
   `window.__rakazoNativeKeys`, and shows its own native
   `ComputerKeyboardBar`; the page's own bars stay hidden there by
   design (`pageChrome=false` in `attachMobileKeyboard`), so
   forcing them visible in-app would duplicate the native bar.
   The in-app chrome file is untouched.

### Alternatives considered (round 3)

- **Poll `isTakenOver` on a timer instead of an event** — strongest
  reason: no native wiring, reuse the existing 2-second
  `isShowing` poll. But that poll only exists in system-only mode,
  the pop-out path would need a new loop, and every tap would wait
  up to 2 seconds plus the takeover round trip. The event is the
  idiomatic Expo pattern (the file-drop module's precedent) and
  fires at once. No.
- **Have the native service reload the page itself on takeover** —
  strongest reason: no JS round trip. But the service has no lease
  and no screen URL; it cannot take control or fetch the
  interactive URL, so a reload would just reload the same
  view-only page. No.
- **Make the view-only page attach the keyboard handlers anyway**
  — strongest reason: the bar would appear without any URL swap.
  But view-only means the RFB session must not send input;
  attaching handlers that send keys would break the view-only
  contract, and the buttons would still be dead. No.
- **Block the popup when the open-time takeover is refused** —
  strongest reason: never show a view-only popup. But a refused
  takeover (bot mid-run) would leave the user with no popup at all
  instead of a watchable one; watching is still useful, and the
  native tap retries the takeover later. No — pop out view-only,
  retry on tap.

### Testing (round 3)

- `apps/mobile/lib/system-float-window-contract.test.ts`: 11/11
  (was 9) — the event channel, the force-visible CSS, the popout
  gate and the tap-handler wiring.
- `apps/mobile/lib/system-float.test.ts`: 19/19 (was 16) — the
  subscribe helper forwards flips, `isTakenOver` reads the
  window's state, missing module gives null/false.
- `apps/mobile/lib/computer-float-window.test.tsx`: 58/58 (was
  56) — the gate test (the popup does not show while the takeover
  is pending, then shows once it resolves) and the native-tap test
  (take → takeover RPC + `updateUrl` with the interactive URL;
  release → release RPC + `updateUrl` with the view-only URL).
- Biome clean on the changed TS files; `tsc --noEmit` has no
  errors in the changed files (pre-existing errors remain in
  unrelated files this branch never touched). Kotlin is not
  compiled here (no compiler available) — CI's Android build is
  the backstop, as in rounds 1–2.

### Still needs real-device confirmation (no device yet)

Round 2's items carry over in updated form:

(a) the bottom bar with ESC and the keyboard icon actually appears
after tapping takeover in the system popup, and the keyboard button
brings the keyboard up with typing reaching the computer;
(b) the popup opens on the interactive URL directly when the
takeover succeeds on open, with no view-only flash;
(c) tapping takeover again to release hands the lease back (the bot
can drive again) and the bar hides;
(d) tapping into the maximized screen takes over once: only the
first tap flips state, so the page reloads once to the interactive
URL and later taps do not reload it — check the first tap's click
is not lost to that reload;
(e) a refused takeover (bot mid-run) still shows a watchable popup,
and a later takeover tap retries it;
(f) the live computer image serves a page version whose attach
un-hides the bars on an interactive load. If the image predates
that page code, the force-visible CSS will show the buttons but
they will be dead until the image is rebuilt — this cannot be
checked from the code side.

## Round 4 (2026-11-28): the takeover script never parsed

Status: implemented (code + tests, no device yet). This round keeps
rounds 2–3's design (no forced keyboard, no dismiss auto-release,
chrome switch, native tap drives the lease and URL) and fixes the
injection itself: the takeover chrome script was a JavaScript
SyntaxError, so it never executed in the page at all.

### What the user reported

One line: "还是没出来，但是光标可以定位了" ("still didn't
appear, but the cursor can be positioned"). The bottom bar still
did not appear on takeover, but clicks reach the computer — so the
round-3 takeover tap, lease, and URL swap work, and only the chrome
injection fails.

### Confirmed cause

`screenChromeScript(TAKEOVER)` in
`SystemFloatScreenChrome.kt` interpolated the takeover CSS raw
into a single-quoted JS string literal (`var css='$css';`). The
TAKEOVER CSS contains real newline characters (Kotlin `"\n"`
escapes, lines 57–61), and a single-quoted JS string cannot contain
a literal line break — so the whole IIFE failed to PARSE. The
`try{...}catch(e){}` inside never ran, no
`<style id="rakazo-screen-chrome">` was created or rewritten, and
`applyScreenChrome()` passes a null callback to
`evaluateJavascript`, so the error was swallowed silently.

Worse, the FLOAT injection from the initial page load DID parse
(its CSS has no `\n`) and created the style element with
`data-mode="float"` and `display:none` for `#mobile-key-bar` /
`#mobile-controls`. That element stays live; every takeover
attempt failed to overwrite it. The bar was actively hidden by
stale FLOAT rules, not merely un-shown.

Proof (node v24): `node --check` on the generated TAKEOVER script
exits 1 (`SyntaxError: Invalid or unexpected token` at the first
literal newline); FLOAT passes; the same CSS with newlines escaped
as two-character `\n` passes `node --check` and `new Function`,
and executing it against a fake DOM sets `data-mode="takeover"`
and the exact intended 5 rules. The double quotes
(`[data-key="ArrowLeft"]`) are fine inside the single-quoted
literal.

History: `git show d2fb370` shows the TAKEOVER CSS already ended
its first rule with `\n` — takeover chrome never parsed since
round 2 — and commit `235a1bb` added three more `\n`s. The
contract test only asserted `toContain` on Kotlin source
substrings and never parsed the generated script, which is why it
slipped through. The in-app equivalent is immune:
`computer-screen-chrome.ts` embeds the CSS via
`JSON.stringify(css)`, which escapes newlines.

Ruled out (diagnosis, not re-investigated here): the injection
path runs correctly (takeover state set before
`APPLY_SCREEN_CHROME`; `onPageFinished` re-injects; no FLOAT
re-injection after takeover; the load-URL dedup is not the
blocker — the URL rotates and the cursor proves the reload
happened); WebView settings do not break touch detection
(`isTouchBrowser()` is true on a phone); there is exactly one
WebView and it is the injection target; the `onTakeoverChanged`
emission is correct.

### Decision (round 4)

1. **New pure-Kotlin `jsStringLiteral(value: String)` helper** in
   `SystemFloatScreenChrome.kt`: returns a double-quoted,
   JSON-style escaped JS string literal (escapes `"`, `\`,
   newline as `\n`, carriage return as `\r`, tab as `\t`, and
   other control characters as `\uXXXX`). This mirrors the
   in-app screen's `JSON.stringify(css)` approach.
2. **`screenChromeScript()` embeds the CSS through the helper**
   (`var css=${jsStringLiteral(css)};`) instead of the raw
   single-quoted interpolation (`var css='$css';`). The rest of
   the script is identical (same style-element id, same
   `data-mode` rewrite logic).
3. **The now-wrong comment is fixed**: it claimed the CSS "contains
   double quotes but no single quotes, so a single-quoted JS string
   literal needs no escaping". The replacement explains the real
   constraint (newlines must be escaped or the script fails to
   parse) and names the helper.
4. **Nothing else changes**: no CSS rule, no FLOAT/TAKEOVER mode
   semantics, no state machine, no service, no in-app screen. No
   `window.__rakazoNativeKeys` is set in the float — that flag
   tells the page to hide its own chrome because the native app
   shows its own bar, and the float has no native bar.

### Alternatives considered (round 4)

- **Escape only newlines (`\n` → `\\n`) and keep the
  single-quoted literal** — strongest reason: the smallest change,
  fixes exactly the characters that fail today. But the CSS
  already contains double quotes and could gain backslashes or
  other control characters later; a general JSON-style escaper
  covers the whole class of failures, and it is the same approach
  the in-app screen already uses, so the two screens stay in
  sync. No — general helper.
- **Build the script with the CSS in a template literal
  (backticks)** — strongest reason: backticks allow newlines, so
  no escaping helper is needed at all. But the CSS could later
  contain a backtick or `${...}`, which would break the script in
  a new way, and it would be a different escaping regime from the
  in-app screen's `JSON.stringify`. One rule for both screens is
  easier to keep correct. No.
- **Have the contract test reconstruct the generated script from
  the Kotlin source and run `new Function(...)` on it** —
  strongest reason: the test would catch any future parse failure
  directly instead of pinning source substrings. But
  reconstructing Kotlin string concatenation in TypeScript
  re-implements the code under test and breaks on any harmless
  rewording; the source-level pin (helper call present, raw
  interpolation absent) plus the kotlinc + node proof below
  covers the same failure without that fragility. No — the
  ad-hoc kotlinc proof stays the verification step for future
  chrome changes.

### Testing (round 4)

- Pure Kotlin, compiled with a one-off kotlinc in `/tmp` (nothing
  added to the repo): the helper's escaping is checked directly
  (double quote, backslash, newline, carriage return, tab, and a
  control character), and both `screenChromeScript` outputs are
  generated from the real file. The old raw-interpolation form
  was reproduced and fails `node --check` with `SyntaxError:
  Invalid or unexpected token` (exit 1); the new TAKEOVER and
  FLOAT scripts both pass `node --check` (node v24).
- Fake-DOM execution of the generated scripts: FLOAT installs
  `data-mode="float"` with the exact float CSS; TAKEOVER then
  rewrites the SAME element to `data-mode="takeover"` with the
  exact intended 5 rules (so the stale-float-rules failure is
  gone, not just the parse failure); re-running TAKEOVER is
  idempotent.
- `apps/mobile/lib/system-float-window-contract.test.ts`: 11/11 —
  the takeover-chrome case now pins the escape helper call,
  its newline escaping, the absence of `var css='$css'`, the
  corrected comment, and the file staying free of Android
  imports. `system-float.test.ts`: 19/19.
  `computer-float-window.test.tsx`: 58/58. Total 88/88.
- `pnpm verify-notes` passes; Biome clean on the changed TS
  file; `tsc --noEmit` no new errors. The Kotlin file is not
  compiled by the repo (no Android SDK here) — the one-off
  kotlinc run above is the backstop, as in rounds 1–3.

### Still needs real-device confirmation (no device yet)

Round 3's items carry over; the first four are now the point of
this round, and must be checked on the user's phone after
packaging:

(a) the bottom bar with ESC and the keyboard icon actually
appears after tapping takeover in the system popup;
(b) tapping the keyboard icon brings the keyboard up and typing
reaches the computer;
(c) tapping takeover again to release hides the bar;
(d) dismissing the keyboard does NOT release the takeover
(button stays blue, window stays focusable and maximized);
(e) the popup opens on the interactive URL directly when the
takeover succeeds on open, with no view-only flash;
(f) a refused takeover (bot mid-run) still shows a watchable
popup, and a later takeover tap retries it;
(g) the live computer image serves a page version whose attach
un-hides the bars on an interactive load (see round 3 (f)).

## Testing

- `apps/mobile/lib/system-float-window-contract.test.ts`：旧的“键盘/打开应用按钮”断言改成接管按钮断言（同一文件、同一测试）；新增状态机转移与焦点 flag 的断言。
- 纯函数 `reduceTakeover` 的逻辑用一次性 Kotlin 编译器在 `/tmp` 里编译运行核实（不进仓库、不加构建配置），覆盖转移表全部事件；结果见提交记录。
- `pnpm verify-notes` 通过；Biome 覆盖改动的 TS 文件；Kotlin 无编译器可用，未做编译验证——CI 的 Android 构建是兜底。
- 真机验证仍待做（见 Consequences 未验证四项），由用户在手机上核实。
