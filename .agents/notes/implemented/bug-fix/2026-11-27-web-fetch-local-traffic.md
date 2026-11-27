# Agent Note: web_fetch 也走本地流量

Status: implemented

## Problem

本地流量通道只接了 `browser_navigate`，`web_fetch` 还走服务器直连：用户让机器人抓 IP 回显页，一直拿到 cue 容器的 IP，开关开了也没用。根因是两条链不相干：`web_fetch` 走 `ctx.providers.web`（Tavily/Brave → KeylessHttpWebProvider → 容器内直连），`ClientBrowserProvider` 只包了电脑浏览器那条线。

## Decision

新建 `ClientWebProvider`（`packages/adapters/src/client-web-provider.ts`），实现 `WebProvider`，包着原来的 web 链：

- `fetch()`：有 `botId`/`runId` 时先走 `ClientTaskDispatcher.fetchPage`，拿回手机的 `{ url, title, text, truncated }`，按 `web_fetch` 的 `maxChars`/`offset` 开窗（`pageWindow`，与 KeylessHttpWebProvider 同一套），`truncated` 取手机截断与开窗截断的或；任何 `ClientTaskFallbackError`（disabled/offline/timeout/declined/failed/rate-limited/ssrf-denied/busy）都静默回落原来的 web 链；分发器本身的意外错误直接抛，不伪装成回落。缺 `botId`/`runId` 时直接走原链。`offset` 超限在派发前就抛，不惊动手机。run 取消时 AbortSignal 让等待立刻停（与 ClientBrowserProvider 共用同一个 `awaitWithAbort`）。
- `search()`：不动，仍走服务器链——搜的是索引，不是读页面。
- `describe()`：沿用被包链的能力，只把 id 改成 `client`。
- 接线：两处组合根都包一层，与浏览器 provider 同款——`createRunExecutor` 的默认 web（`executorDeps.web ?? createClientWebProvider(...)`）和 `createRunRuntime` 传给执行器的 `web`（生产必经这条）。显式传了 `web` 的调用方不包；`WEB_PROVIDER=fake` 时不包（离线 conformance 不碰手机）。
- `awaitWithAbort` 从 `ClientBrowserProvider` 的私有方法抽成 `client-task-dispatcher.ts` 的导出函数，两家共用一份，浏览器 provider 原地改调它，行为不变。
- 不改系统提示词的工具指引，不走 `browser_navigate`；限流、超时、presence、SSRF 校验一律不动；任务信封只带 URL。

这篇是 [客户端浏览器任务通道](../feature/2026-11-27-client-browser-task-channel.md) 的延伸：同一条通道、同一个回落约定，补上 `web_fetch` 这个缺口。

## Alternatives considered

1. **在 `webFetchFromTool` 里先调分发器**。最强的理由：改动最小，只动工具层。不用：`providers.web.fetch` 的其他调用方会绕过去；provider 层包一层才是所有 `web_fetch` 的唯一入口，与 `ClientBrowserProvider` 的做法一致。
2. **把 `web_fetch` 改走 `browser_navigate`**。最强的理由：手机通道已经接好，复用现成的。不用：`web_fetch` 是只读抓取、不开电脑，改走浏览器等于把轻量工具变成重操作，还会改变快照/点击的语义；任务要求只在 provider 层修。
3. **在 `createWebProvider` 工厂里直接包**。最强的理由：一处改动，全链路覆盖。不用：工厂不知道 prisma/realtime，参数要改契约；而且工厂也被离线测试直接调用，包一层会把测试用的 fake 也卷进来。组合根包一层保持了工厂的纯粹。
4. **手机抓不到时直接报错、不回落**。最强的理由：用户能立刻知道本地流量没生效。不用：回落是最小版定下的安全默认值（开关关、离线、超时都静默回落）；报错会把一次本可成功的抓取变成失败，用户要的是内容，不是报错。

## Consequences

- 开关开 + App 在 + URL 能抓：`web_fetch` 拿到手机抓回的标题和正文，容器一次没碰；IP 回显页回的是手机 IP。
- 开关关、离线、超时、拒绝、限流、SSRF 拒绝、忙：静默回落原来的 web 链（Tavily/Brave/keyless-http），不向用户报额外的错。HTTP 页面（非 HTTPS）也会经这条回落正常抓到，因为分发器只许 HTTPS 而服务器链不禁 HTTP。
- `web_search` 不受影响，仍走服务器链。
- 测试：新 `client-web-provider.test.ts` 20 个（手机成功、截断与开窗、8 种回落原因、缺上下文跳过、offset 超限先抛、意外错误直抛、取消停等、search 不派发、工厂 fake 不包与默认包）；`client-browser-provider` 24 个、`client-task-dispatcher` 11 个、`web-conformance` 等 6 个文件 83 个、`executor-readonly-approval` 与 `builtin-tool-bridge` 275 个全过；`executor.test.ts` 的 4 个 `userTurnInstructions` 失败是基线就有的提示词文本断言，与本次改动无关；`tsc` 在未改动的两个文件上有 4 个既存错误。
- 已知缺口：手机抓完之后快照/点击仍看不到那页（最小版固有断点，同浏览器通道）；busy/限流仍是“先数后插”。
- 后续：这篇“不改系统提示词的工具指引”一点已被 [web_fetch 指引与浏览器下载守卫](./2026-11-27-web-fetch-guidance-browser-download-guard.md) 翻转：两次重测证明模型不选 `web_fetch` 时 provider 层再对也走不到，指引必须同步改。
