# Agent Note: AI 点击放大镜

Status: implemented

## Problem

用户看另一个 AI 助手操作电脑的截图：它每次点击时，在点击处显示一个圆形放大镜，把点击点周围的画面放大 2–3 倍，用户一眼就能看清点的是什么、每一步都看得见。我们现在的指示（圆点 + 圆环 + 光标箭头，4.5 秒）不够清楚：圆环只圈出位置，不放大内容，小字、图标、小按钮在手机上仍然看不清。

要求：点击时在点击点正中显示一个圆形透镜（约 120–160pt），里面是点击点周围**真实屏幕内容的 2–3 倍放大**，带一圈可见的边框；停留时间与现有指示相同（全显约 4.5 秒再淡出），每一步都清楚；透镜是覆盖层，不能挡住屏幕其他地方的操作；屏幕在 WebView 里可能有黑边，透镜位置要与光标一样做黑边修正。

## Decision

### 1. 放大内容从 noVNC 画布里现取，不走服务端、不另开会话

屏幕是 WebView 里的 noVNC 页面。noVNC 把桌面帧画进一个 2D `<canvas>`（`core/display.js`：`Display` 用 2D context 在后台缓冲上渲染，再 `flip()` 拷到可见画布；`core/rfb.js`：`RFB` 在 `#screen` 里建这个画布，画布后备存储就是帧缓冲尺寸，所以画布像素与桌面像素 1:1）。2D 画布的后备存储一直保留——`preserveDrawingBuffer` 读空的问题只存在于 WebGL——所以任何时候调 `canvas.toDataURL()` 都能拿到当前帧；画布只画同源内容（后台缓冲、putImageData、fillRect），不会被 taint。这一点已对 noVNC master 的 `display.js` 与 `rfb.js` 源码核实过，不是猜的。

做法（`apps/mobile/lib/computer-pointer-snapshot.ts`，`computerPointerSnapshotScript(pointer)`）：指针到 App 后，往 WebView 里注一段 JS，找到画布（先 `#screen canvas`，再 `#noVNC_canvas`，再页面里第一个 `canvas`——三个版本都覆盖），以点击点为中心裁一块 56×56 桌面像素的区域，画进 140×140 的离屏画布（2.5 倍放大），用 JPEG 0.85 转 data URL，通过 `window.ReactNativeWebView.postMessage` 发回 App，消息是 `{"type":"rakazo-pointer-snapshot","seq":<指针序号>,"dataUrl":"data:image/jpeg;base64,..."}`。点在屏幕边缘时裁剪框会出界：先把离屏画布填成屏幕页底色，再把裁到的部分按偏移画进去，点击点始终在透镜正中心，不会偏。画布还没建好时，脚本 800ms 后在页面内再试一次，仍没有就发 `{"type":"rakazo-pointer-snapshot","seq":...,"error":"no-canvas"}`，App 当作没有快照（回落到原来的圆点+圆环+箭头）。

### 2. 快照跟着指针走，存在指针 store 里

`ComputerPointer`（`apps/mobile/lib/computer-pointer.ts`）多一个可选字段 `snapshot?: string`（data URL）。`setComputerPointerSnapshot(seq, dataUrl)` 只在序号与当前指针一致时生效，过期快照直接丢掉；同一个指针已经有快照时，后到的不再覆盖（两个屏幕面同时抓也不会让标记的计时重启两次）。快照到后指针对象会换一个新对象，标记的 4.5 秒计时随之重启——透镜从图片落袋起算有完整的 4.5 秒，总共约 5 秒，可以接受。

### 3. 触发：每个屏幕面自己抓，hook 里做

`useComputerPointerSnapshot(webViewRef)`：订阅指针，序号变了且还没有快照时，就往自己的 WebView 注捕获脚本；2 秒后仍没快照就再注一次（页面还没准备好时补一枪）。三个面各挂一个：悬浮窗（新加 WebView ref 与 onMessage）、电脑页预览（新加 ref）、全屏 Modal（沿用已有的 `screenWebViewRef`）。各面独立抓，不互相协调——先到的快照进 store，后到的被挡掉；多抓一次只是多裁一张 56×56 的小图，成本可忽略。`ScreenWebView` 的 onMessage 先认快照消息，再走原有的屏幕状态/键盘路由；悬浮窗的 WebView 新加 onMessage，只认快照消息。

### 4. 透镜的样子：有快照时替代圆环，没有时原样回落

`ComputerPointerMarker`：指针带快照时，在黑边修正后的点击点正中画一个 140pt 的圆（2.5 倍放大，56 桌面像素裁出），白圈打底、主色 3pt 边框、内容区 `overflow: hidden`，里面是一张 140×140 的图（就是那张 data URL），正中心再压一个 10pt 的圆点——放大的图中心就是点击点，圆点标出精确位置。透镜与现有指示共用同一个 `Animated.View` 与同一套 4.5 秒全显 + 0.6 秒淡出的计时，所以淡出是一起的。没有快照时（抓取失败、画布没好、旧数据），画原来的圆点 + 圆环 + 光晕 + 箭头，不画空透镜。整个标记容器本来就是 `pointerEvents="none"`，透镜不吃触摸，屏幕操作不受影响。

常数：透镜直径 140pt，放大 2.5 倍，裁 56×56 桌面像素，JPEG 0.85（140×140 的图约 5–15KB，走 postMessage 没问题）。

## Alternatives considered

- **再开一个 WebView，加载同一屏幕页并用 CSS 放大**——第二个 noVNC 会话要多一条 VNC 连接与多一份流量，画的还是实时画面而不是点击那一刻；而且页面内容在画布里，CSS 只能缩放整个页面，裁不出一个圆形的透镜区域。否。
- **对现有 WebView 做 `transform: scale()`**——缩放的是整个屏幕，不是透镜里的局部；还会打乱布局与触摸坐标。否。
- **原生视图截图（react-native-view-shot 之类）**——要多一个依赖，截的是整个 WebView 视图（连标记本身都截进去），还得再按黑边裁剪；画布里本来就有帧，没必要绕到原生层。否。
- **服务端发帧**——服务端观测里确实有帧，但观测不发给 App（只发指针坐标），为一次点击发一整帧又重；画布本地已有，重复传没有意义。否。
- **只把圆环画大，不放大内容**——大圆环还是只圈位置，看不清小字与图标，达不到用户要的“看清点了什么”。否。
- **静态图或纯色圆当透镜**——用户明确要求真实内容放大；假的透镜比没有更误导。否。

## Consequences

- **收益**：每次 AI 点击，用户在悬浮窗、预览、全屏三个面上都能看到点击处真实内容的 2.5 倍放大，停留约 5 秒，小字与小按钮也看得清；抓不到时自动回落到原来的圆点+圆环+箭头，不出现空透镜。
- **代价与已知上限**：
  - 透镜拍的是抓取那一刻的画布：点击后的界面变化（弹窗、菜单）要等帧传到画布才进得去，刚点完的瞬间可能还是点之前的画面；但要看清的是“点了什么”，目标本身在两种画面里都在。
  - 画布与服务端观测之间有帧传输延迟，极少数情况下透镜内容比服务端帧慢一拍；位置（点击点）始终以服务端指针为准，不受影响。
  - 指针到 App 时 WebView 还没挂好（刚打开悬浮窗、页面还在加载），2 秒补抓也可能赶不上——这时只显示原来的标记，等下一次 AI 操作再抓。
  - 透镜只在 App 里：网页版没有这个 WebView 抓取路径，不做。
  - 与按钮修复同一分支、未推送、未部署；透镜要等用户下次打包新 App 才会到手机上，服务端部署带不上去。

## Verification

- 新测试 `apps/mobile/lib/computer-pointer-snapshot.test.ts`：在 jsdom 里搭一个带桩 2D context 的假画布，跑捕获脚本，断言 postMessage 收到带正确序号的 JPEG data URL，且 `drawImage` 的裁剪框以点击点为中心；边缘点击不断言出界，断言点击点仍在输出中心；无画布时发 `no-canvas` 错误；消息解析器只认快照消息，其他消息返回 null。
- `apps/mobile/lib/computer-pointer.test.ts`：快照只落到序号一致的指针上；过期序号的忽略；已有快照的不被覆盖。
- 新测试 `apps/mobile/components/computer-pointer-marker.test.tsx`：有快照时透镜出现（Image 的源就是 data URL、圆形边框、中心圆点），且位置与黑边修正后的点击点一致；无快照时是原来的圆点+圆环+箭头；透镜不拦截触摸。
- 悬浮窗测试：WebView mock 记下 `injectJavaScript` 调用与 onMessage，指针到后断言捕获脚本被注入；再把一条快照消息喂给 onMessage，断言透镜出现。
- 反向验证：把捕获脚本换回不发快照的版本，透镜测试应失败；把 store 的序号校验去掉，过期快照测试应失败。
- 未在真机验证（无模拟器）；透镜的实际放大效果待用户在手机上看。
