# Agent Note: 客户端浏览器任务通道（最小版）

Status: implemented

## Problem

机器人浏览器跑在 cue 服务器上，是机房 IP，Cloudflare 直接拦；用户手机浏览器能过，因为走的是用户本地流量（住宅/手机 IP），不是浏览器指纹的功劳。App 端“走本地流量”开关已经有了（`db3405a`，`apps/mobile/lib/computer-local-traffic.ts`），但它只在手机本地 SecureStore 里记偏好，后端没接，点开只会提示“等配套更新来了才生效”。

缺的东西是一条服务器到手机的任务通道。现在的实时连接是单向的：

- App 调服务器是 HTTPS JSON-RPC（`apps/mobile/lib/api.ts` 的 `rpc`），服务器推 App 是 SSE（`apps/mobile/lib/api-live.ts` 的 `subscribeRpcEvents`，POST `/rpc/threads/subscribe`），只能推线程事件，没有“服务器发任务、等手机回结果”的往返通道。
- 机器人浏览器是 `ComputerBrowserProvider`，走服务器上虚拟桌面的 Chromium + CDP（`packages/adapters/src/computer-browser.ts`）。执行器在 `packages/adapters/src/executor.ts:261` 拿单个 `BrowserProvider`（`executorDeps.browser ?? createBrowserProvider(...)`），没有“先手机、不行再服务器”的选择逻辑。
- 在线判断不存在：服务器不知道用户 App 在不在线、开关开没开——开关只存在手机本地，服务器看不到。

最小版的目标：App-only，只做一件事——手机 WebView 抓一个 URL 的页面内容传回来，超时/离线/拒绝就回落服务器浏览器。不做导航、点击、填表、截图（那是 3–6 周的完整版）。

## Decision

### 通道：沿用线程事件那套成熟模式，不新造传输

线程事件已经是“持久化行 + Postgres NOTIFY 信号 + 游标追赶”：`packages/db/src/event-stream.ts` 的 `followThreadEvents`，传输是 `PostgresRealtimeFanout`（`packages/adapters/src/realtime.ts`，Postgres LISTEN/NOTIFY，跨 API/worker 进程，单条 NOTIFY 上限 7,900 字节）。任务通道照抄这个形状：

- 新 Prisma 模型 `ClientTask`（只加表，不动现有表，符合“迁移必须与上一版兼容”）：`id`、`userId`、`spaceId`、`botId`、`runId`、`kind`（最小版只有 `fetch`）、`url`、`status`（`pending`/`dispatched`/`completed`/`failed`/`expired`/`declined`，plain `String`，仓库里 Run 等模型就是这么写的）、`result`（JSON：`url`/`title`/`text`/`truncated`/`error`）、`createdAt`、`expiresAt`、`completedAt`。
- 派发：执行器里的分发器写一行 `pending` 任务，`pg_notify` 到 `client-task:${userId}`，信封里只放任务 id（信号，不放内容，绝不超过 NOTIFY 上限）。
- 下发：新 oRPC 程序 `clientTasks/subscribe`（照 `notifications/subscribeCalls` + `packages/db/src/chat-alerts.ts` 的 `followChatAlerts` 那种按用户订阅的形态），App 只要活着就一直连着；API 收到 fanout 信号后重读该用户的 pending 行，用 SSE 帧推下去。`packages/contracts/src/rpc.ts` 里加契约，`apps/api/src/routes/` 里加实现。fanout 不可用或订阅失败时退化成 1 秒轮询（提案照线程事件写的是 30 秒追赶，任务等不起 30 秒，所以这里收紧到 1 秒）。
- 回结果：App 调新程序 `clientTasks/complete`（`{ taskId, status, result }`），API 把行标成对应状态。worker 侧的待处理任务登记（以 taskId 为键的内存登记）在 `client-task-result:${taskId}` 的 fanout 上等唤醒，信号里只放任务 id；fanout 不可用时退化成 1 秒轮询行状态。
- 超时与迟到：分发器等结果带超时（默认 30 秒）；超时把行标 `expired` 并回落服务器浏览器；迟到的回结果撞上非 `pending` 行直接忽略（幂等，不报错）。
- 偏好同步：新模型存每用户的开关（`userId` 主键，`localTrafficEnabled`，`updatedAt`）+ 新程序 `clientTasks/setPreference`。App 在开关变化时和启动时各同步一次（修漂移）。服务器只在 `enabled=true` 时才派发；App 侧也本地执行——开关关着时任务到达直接回 `declined`，盖住“用户刚关开关、服务器还没知道”的窗口期。
- URL 校验：只许 HTTPS（提案写的是 `http(s)`，落地按任务要求收紧为仅 HTTPS），拒绝带 userinfo 的 URL，拒绝 RFC1918 / loopback / link-local / 云元数据地址（手机在用户家里局域网里，WebView 能摸到内网，SSRF 必须在派发前拦住）。校验复用 contracts 已有的 SSRF 边界（`isNonPublicAddress` / `isCloudMetadataHost` / `isInternalHostname`），主机名做真实 DNS 解析、解析不到直接拒绝。
- 限流：每用户同时 1 个任务、每小时 10 次；任务只发给请求的那个人（`client-task:${userId}` + 订阅鉴权），绝不广播。

### 在线判断：任务 SSE 本身就是人在的信号

API 的 `clientTasks/subscribe` 处理器在连接建立时写一行 presence（`userId` 主键，`lastSeenAt`，`expiresAt`），流活着时每 20 秒刷新，断开时删除。worker 派发前查这一行是否新鲜（60 秒内）。行过期 = 人不在，直接走服务器浏览器，不派发。`UserDeviceConnection` 复用不了——它是桌面 App 配对 WebSocket 的，手机 App 从不走那条网关，所以另起 `ClientPresence` 表。

### Provider 选择：新建 ClientBrowserProvider，执行器只换 provider

`packages/adapters/src/` 新建 `ClientBrowserProvider`，实现 `BrowserProvider`（`packages/adapter-kit/src/interfaces.ts:648`）：

- `describe()`：`id: "client"`，能力 `{ page: true, refs: false, keyless: true }`——`refs: false` 是关键：手机抓回来的只有文本，没有可点的元素 ref。
- `navigate()`：有下载要求、或缺 `botId`/`runId`，直接交给包着的 `ComputerBrowserProvider`；否则走手机任务等结果，拼成 `BrowserNavigateResult { url, title, tree: 文本, elements: [] }`，`note` 写明这是手机抓的纯文本、服务器浏览器没开过这页、快照/点击看不到它，`truncated` 时追加“文本被截断”。手机侧任何失败（`ClientTaskFallbackError`：`disabled`/`offline`/`timeout`/`declined`/`failed`/`rate-limited`/`ssrf-denied`/`busy`）都静默回落服务器浏览器；分发器本身的意外错误（比如数据库挂了）则直接抛出去，不伪装成回落。run 取消时 AbortSignal 让等待立刻停（分发器后台的任务行会过期，迟到结果忽略）。
- `snapshot()` / `act()`：提案写的是直接回 `{ fallback: "computer_act", ... }`，落地改成按上一次 navigate 分流——上次是手机抓的，就回 `computer_act`（服务器浏览器没开过那页，展示它的快照会误导）；否则交给包着的服务器浏览器（回落 navigate 之后快照/点击仍能正常工作）。`purchaseCheck` 同理：手机抓过返回 `{ purchase: null }`，否则委托。
- 接线：执行器默认建 browser 的地方包一层（`createRunExecutor`，`executorDeps.browser ?? createClientBrowserProvider(...)`）。`ExecutorDeps` 新增可选 `realtime`，由 worker 与 API 的 `createRunRuntime` 调用处传进来（它们手里本来就有 fanout 实例）；没传就走 1 秒轮询兜底。`BROWSER_PROVIDER=fake/emulator` 时不包（离线 conformance 不碰手机）；显式传了 `browser` 的调用方也不包。

### 手机端：任务订阅 + 藏起来的 WebView 执行器

`apps/mobile/lib/` 新建 `ClientTaskRunner`，订阅生命周期照 `apps/mobile/lib/incoming-calls.ts` 的 `follow`（长连 + 退避重连，App 活着就连着）：

- 收到任务先看开关：关着就回 `declined`；开着就挂一个“机器人正在用你手机上网”的可见指示（任务跑多久显示多久），再挂一个隐藏 WebView（`key={taskId}`，每个任务全新实例；`sharedCookiesEnabled={false}`、`domStorageEnabled={false}`、`thirdPartyCookiesEnabled={false}`，照 `apps/mobile/components/human-verification.tsx` 的干净配置）。
- WebView 加载 URL，等加载完成 + 短暂沉淀，注入 JS 取 `document.title` + `document.body.innerText`（截断到 64KB），`window.ReactNativeWebView.postMessage` 回传，再调 `clientTasks/complete`。加载失败/超时回失败结果，不重试——重试是服务器的活（回落服务器浏览器）。
- 一次只跑一个任务，多余的直接回 `declined`（`busy`），服务器立刻回落，不用等超时。
- 开关关掉时，正在跑的任务取消并回 `declined`。

### 安全边界（最小版就必须有的，不许留到完整版）

- 任务信封只有 `{ taskId, url }`，绝不带任何 secret。`fill_secret` / `fill_card` / `fill_pay_token` 这些东西永远不发到手机上——最小版没有填表，本来就用不着。
- URL 在服务器侧派发前校验：只许 HTTPS，拒绝带 userinfo 的 URL，拒绝 RFC1918 / loopback / link-local / 云元数据地址（手机在用户家里局域网里，WebView 能摸到内网，SSRF 必须在派发前拦住）。
- 每用户限流：同时 1 个任务，每小时上限；任务只发给请求的那个人（`client-task:${userId}` + 订阅鉴权），绝不广播。
- 干净的浏览器：任务 WebView 不与任何别的 WebView 共享 cookie/storage，尤其不碰用户的登录态；机器人用自己的账号登录，登录态问题与这条通道无关。
- 结果只进当次 run 的工具结果，不落盘留存；页面文本截断后才回传。

### 最小版的能力边界（说清楚，不许偷换）

- 只支持 `navigate` 读页面。`snapshot` / `act` 在手机抓过的页上回落服务器浏览器——而服务器浏览器没打开过这张手机抓过的页，所以抓完之后再快照/点击，看到的是服务器浏览器自己的那页，不是手机那页。这是最小版固有的断点：抓内容可以，连续交互不行。结果里的 `note` 字段把这点写给模型。
- 不支持下载、不支持网页版（跨域抓内容会被 CORS 拦住，GOAL.md 已定只做 App）。
- 电话打不通、App 在后台被杀、SSE 断开，全部表现为回落服务器浏览器，不向用户报错。

## Alternatives considered

1. **线程事件通道：把任务当成线程事件发在 run 所在的 thread 上**（`client.task.requested`）。最强的理由：零新表、零新程序，持久化 + NOTIFY + 追赶全是现成的，App 看聊天时本来就订阅着这个 thread。不用：App 只有在看某个聊天时才订阅它的 thread；后台跑的 run 没有打开的订阅，任务会漏；而且任务 plumbing 会混进产品事件流和聊天历史的机器里。
2. **服务器直连 App 的 WebSocket**。最强的理由：真双向通道，延迟最低。不用：新传输、新鉴权/会话、新重连逻辑，等于为一个功能再搭一套实时系统；SSE + fanout 已经鉴权、已经重连，够用了。
3. **worker 轮询任务行等结果，不用 fanout 唤醒**。最强的理由：最简单，不新增 fanout topic。不用：每个任务多最多 1 秒延迟、每次轮询都打数据库；worker 里 `PostgresRealtimeFanout` 本来就连着（run 运行时就订阅 thread topic），复用它唤醒，轮询只当退化。
4. **手机轮询“待处理任务”RPC，不用 SSE 推**。最强的理由：不用新 SSE 程序，SSE 抖动也不怕。不用：费电、延迟大；App 本来就一直挂着长连 SSE（来电那路），推过来能让任务立刻开始、手机平时闲着。
5. **整段浏览器会话都走手机（含 snapshot/act）**。最强的理由：智能体的连续交互能端到端走通手机，不用断在抓完之后。不用：要把服务器那套 snapshot/ref 定位系统在手机上复刻一遍，是 3–6 周的完整版，不是最小版。最小版先把只读抓取交出来。
6. **什么都不做，继续只用服务器浏览器**。不做：用户已经点头让做；开关已经以“等配套更新来了才生效”的诚实姿态装在 App 里了，CF 该拦还是拦。

## Consequences

- 开关开 + App 在 + URL 能抓：智能体的 `browser_navigate` 拿到手机抓回的标题和正文，服务器浏览器一次没碰；结果带 `note` 说明手机抓取的断点。
- `web_fetch` 也走同一条通道：见 [web_fetch 也走本地流量](../bug-fix/2026-11-27-web-fetch-local-traffic.md)。
- 开关关 / App 离线 / 超时 / 拒绝 / 限流 / SSRF 拒绝：`navigate` 悄悄回落 `ComputerBrowserProvider`，不向用户报额外的错。
- 任务信封里没有任何 secret；SSRF 拒绝的 URL 绝不派发；任务绝不发给非请求用户。
- 任务跑着时手机上有可见指示；关开关立刻拒掉待处理任务。
- App 的 typed-RPC casts 已随服务端契约落地而去掉（`client-task-runner.ts` 直接调 `clientTasks/complete` 与 `clientTasks/setPreference`，无 `as never`）。
- 测试：分发器 11、Provider 24、DB 9、契约 3、API 路由 6、手机 39（runner 15 + host 5 + api-live 19），全过；`pnpm verify-notes` 过；一功能一提交。
- 迁移只加表；不推、不构建、不部署——那些要用户另行点头；App 侧代码要等下一次打包才到手机上。
- 已知缺口：busy/限流是“先数后插”，两个真正并发的 `fetchPage` 可能同时通过 busy 检查（实际一次 run 只派一个任务）；run 取消后分发器后台的任务仍等到 30 秒超时才过期（结果忽略，无副作用）；最小版断点仍在——手机抓完之后快照/点击看到的是服务器浏览器那页，不是手机那页，完整交互是 3–6 周的完整版。

## Risks

- 在线误判：App 活着但 SSE 刚好断开，任务会被判成人不在而回落服务器，表现为那次调用又撞上 CF。接受：回落是安全默认值。
- 页面抽取差异：SPA 晚渲染、长页面截断，结果可能不完整。结果里带 `truncated` / `loading` 标记，不假装完整。
- NOTIFY 7,900 字节上限：任务信封只放任务 id，不放内容；结果走 `clientTasks/complete` RPC，不走 NOTIFY。
- 多人：任务按 `userId` 定向；订阅鉴权失败就收不到任务，收不到就回落，不会串到别人手机上。
- 目标站可能限流/封用户的住宅 IP：机器人行为算到用户头上；限流 + 允许/禁止名单 + 手机上的可见指示是最小版就有的三件套，名单调校留给上线后。
