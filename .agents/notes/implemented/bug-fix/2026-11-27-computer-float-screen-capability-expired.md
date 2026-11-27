# Agent Note: 聊天悬浮窗被拒的屏幕能力不再当桌面显示，且能自己恢复

Status: implemented

## Problem

用户在聊天里打开「电脑画面」悬浮窗时，窗里显示的不是桌面，而是代理原样返回的一行英文：`Invalid or expired screen capability`。当时机器人正在电脑上操作（已打开淘宝），电脑本身在运行。

这行字是屏幕代理的 403 正文（`apps/web/src/screen-proxy.ts` 的 `screenRefusal`）。代理每次放行都要问 API 的 authority（`/api/internal/screen-target`），由它打开密封的能力再核对：没过期、bot 与电脑的 `screenGeneration` 仍对得上、电脑在运行／启动中。能力有效期 60 分钟；`screenGeneration` 由数据库触发器在电脑状态变化（`booting → running` 除外）、`providerRef` 变化、bot 换电脑或归档时递增（`packages/db/prisma/migrations/20260909000000_screen_generation/migration.sql`）。所以“被拒”只有两种可能：能力过期了，或生成号已经变了。线上那一刻到底是哪一种，代码里看不出来——没有那次会话的服务端日志可对。

但代码能证明的是另一半：悬浮窗拿到一个被拒的能力后，既显示错了，也恢复不了。这是本次修的根因，分三点，全在 `apps/mobile/components/thread/computer-float-window.tsx`：

1. **加载事件把失败清掉了**。被拒的页面照样会加载完成：`onHttpError` 先报，`onLoad` 后到；而悬浮窗的 `onLoad={() => setScreenFailed(false)}` 无条件清掉失败。离线遮罩永远出不来，代理的 403 正文就留在窗里，看着像桌面。
2. **失败后不再重读**。全屏电脑页（`apps/mobile/app/computer.tsx`）的 `onError` 会调 `refreshController.invalidateScreen()`，悬浮窗的 `onError`／`onHttpError` 只改了两个 flag。刷新器的 `screenLoaded` 缓存还以为手里的 URL 是新鲜的，2 秒一次的状态轮询不再重读屏幕链接——死能力一直留到状态变化或 50 分钟续期才换。用户只能手动点「重新连接」。
3. **新能力来了也可能不被采用**。`retainScreenSource` 只在旧能力进入续期窗口（过期前 15 分钟）时才换新链接；一个已被吊销的能力在那之前照样被留着喂给 WebView。悬浮窗在失败时把 WebView 卸掉（`screenVisible` 为假时 `loadedScreenUrl` 为空），这一步顺带把旧链接忘了，所以这一点在本修的失败路径里是被绕过的，不用另改。

## Decision

只改悬浮窗，不动能力系统本身（不改 60 分钟有效期、不改生成号规则、不改续期节律），三处配合：

- 记下被拒的链接（`failedScreenUrlRef`）。`onError`／`onHttpError` 共用一个 `failScreen`：先调 `refreshController.invalidateScreen()`，让下一次轮询重读屏幕链接，再记下当时加载的链接、置失败。
- 刷新器读到新链接时（`onScreen`），链接与被拒的不同就清掉失败，窗口自己重新挂上 WebView、加载新能力，自己恢复成桌面。同一个链接（服务端又发回同一枚被拒的 seal）不清失败——再加载也只会再被拒一次，不让它 2 秒一轮地闪。
- `onLoad` 只在加载的链接与被拒的不同时才清失败：被拒页面自己加载完成，不再把自己的失败清掉。失败标记同时在流切换（原有效果）、手动重连、换 bot 时清掉，与原来清 `screenFailed` 的地方保持一致。

## Alternatives considered

- **加载前先探一下链接（网页版 `probeScreen` 的做法）**——网页版用 iframe 看不到 HTTP 错误，只能先探；移动端 WebView 自己就能报 `onHttpError`，多一次请求换不来什么，还修不了 `onLoad` 清失败、也不补重读。否。
- **把生成号放进状态契约、让新鲜度判断看得到吊销**——`ComputerStatus` 里没有生成号，`screenKey` 也看不见它；补上能让客户端早一点察觉吊销，但这是跨契约的改动（contracts、API 状态、客户端新鲜度三处），且修不了悬浮窗显示错和不恢复这两个症状。记为后续跟进，不在本批做。
- **直接删掉 `onLoad` 的清理**——被拒页面的问题没了，但一次短暂网络抖动后、同链接重新加载成功也清不掉失败，窗口要一直等手动重连。否，改成按链接比对。

## Consequences

- **收益**：悬浮窗再拿到被拒的能力时，显示的是离线遮罩加「重新连接」，不再是代理的英文原文；下一次轮询读到新能力后自己恢复成桌面，不用手动点。
- **代价与已知上限**：本修只治悬浮窗的显示与恢复。全屏电脑页本来就有失效重读加页面状态机，不受影响。生成号变化仍要等状态变化或续期才被客户端察觉（见上条后续跟进）；App 打包已暂停，修复要等用户下次打包新 App 才会到手机上，服务端部署带不上去。

## Verification

- 根 vitest 配置跑 `apps/mobile/lib/computer-float-window.test.tsx`：54/54 通过，含新增的回归测试（模拟 `onHttpError` 后紧跟 `onLoad`，断言显示离线、不再是原文本；再让轮询读到新链接，断言窗口自己加载新链接并回到在线）。
- 反向验证：只把组件改动临时撤掉（`git stash push` 那个文件），新测试在“显示离线”那句断言上失败；恢复后重新通过，测试确实抓得到这个 bug。
- 相邻的 `apps/mobile/lib/computer.test.ts`、`computer-refresh.test.ts`、`computer-screen.test.ts`：113/113 通过。Biome 检查干净。
