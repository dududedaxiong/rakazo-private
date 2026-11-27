# Agent Note: web_fetch 指引与浏览器下载守卫——手机通道两次没被走到

Status: implemented

## Problem

`web_fetch` 接上手机通道并部署（服务端 sha-8547639a）后，用户两次重测 IP 回显页，手机通道一次都没被走到，机器人回的还是容器 IP。只读核查确认了两个独立根因，各断一条路：

1. 模型根本没调 `web_fetch`：两次重测里一次调 shell `curl`、一次调 `browser_navigate`。`web_fetch` 的工具描述写的是“Use after web_search when you need the page itself”，只把它定位成搜索后的跟进动作；直接给 URL 时模型没有任何触发它的理由，于是退回它最熟的办法——shell curl。
2. `browser_navigate` 那次也静默回落了：`ClientBrowserProvider.navigate` 的守卫 `request.downloads || !context.botId || !context.runId` 里，`request.downloads` 在每一次真实导航上都为真——`pageBrowserTool` 无条件拼出下载文件夹，`browserNavigateFromTool` 每次都传过去。但 `downloads` 只是“文件下到哪个文件夹”，不是“这次导航是下载”；守卫把“配好了下载目录”和“这次要下载”混为一谈，于是 100% 的真实导航都直接走了服务器浏览器，手机一次没试过，连日志都没有。

## Decision

两个修法缺一不可——指引决定模型选什么工具，守卫决定浏览器那条路通不通：

- `web_fetch` 描述改成直指任意 URL 并明禁 shell 抓取（`packages/adapters/src/builtin-tools.ts`）：“Fetch any public http(s) URL and return readable text … Use it for a direct URL too, not only after web_search. Never use shell curl/wget to fetch a URL; use web_fetch.”`webLookupClause` 里 search+fetch 并存的那行同步改成同样说法（`packages/adapters/src/run-instructions.ts`）；其余工具描述不动。
- `ClientBrowserProvider.navigate` 的守卫去掉 `request.downloads`，只留 `!context.botId || !context.runId`。真正的下载导航在手机上失败得很快（加载失败报 `failed`，25 秒超时也报 `failed`），分发器抛 `ClientTaskFallbackError`，`navigate` 再回落服务器浏览器正常保存文件；最坏情况是下载导航多等最多 25 秒，不是丢文件。
- `pageBrowserTool` / `browserNavigateFromTool` 不动：工具层只拿到 URL，无法预知这次导航会不会下载。
- 这篇翻转了 [web_fetch 也走本地流量](./2026-11-27-web-fetch-local-traffic.md) 里的“不改系统提示词的工具指引”一点：那时只改 provider 层就够用的判断，被两次重测证伪了——模型不选 `web_fetch`，provider 层再对也走不到。

## Alternatives considered

1. **只改工具描述，不动系统提示词条款**。最强的理由：改动面最小，描述本身就是模型选工具的依据。不用：`webLookupClause` 那行是每次 run 都进上下文的正文指引，描述只在工具清单里；两处说法不一时，模型仍可能按“先搜后取”的旧理解走。两处同说一句话才稳。
2. **在桌面守卫层直接禁 shell curl 联网**。最强的理由：确定性执行，不依赖模型选不选。不用：shell 是正当工具，curl 也常用于模型被明确要求做的联网操作（如下文件、调 API）；一刀禁掉会误伤合法用途，而指引改动只针对“取页面正文”这一个意图。
3. **守卫不动，改 `pageBrowserTool` 不再传 downloads**。最强的理由：守卫原样保留，手机照样能试。不用：下载目录是回落路径和快照/动作上报下载文件所必需的；拿掉它等于为修守卫拆了正常下载功能。且 `downloads` 的语义本就是“保存位置”，错的是守卫对它的解读，不是调用方传了它。
4. **按 URL 猜这次导航会不会下载**（如后缀是文件就跳过手机）。最强的理由：不用等手机失败，下载直达服务器。不用：URL 看不出 Content-Disposition，只有取了才知道；猜错的代价是该走手机的走了服务器——正是现在这个 bug 的反向。

## Consequences

- 直接给 URL 时，模型应选 `web_fetch` 而不是 shell curl；`web_fetch` 再经已部署的 `ClientWebProvider` 先走手机。
- `browser_navigate` 不再因下载目录被配好而跳过手机；真正的下载导航先在手机上失败（最长 25 秒），再回落服务器浏览器保存。
- 测试：`client-browser-provider` 25 个（新增“带下载目录仍走手机”，“无 bot/run 不派发”拆出）、`client-web-provider` 20 个、`client-task-dispatcher` 11 个全过；`executor.test.ts` 的 `computerLine` 文案随新指引更新，158 过、4 败——4 个 `userTurnInstructions` 失败与基线逐名比对完全一致（提示词文本断言，与本次改动无关）。
- 风险：下载导航在手机不可用时最多多等 25 秒才回落；指引改动的效果取决于模型是否遵守文本描述，无法用单测证明，只能靠用户实测（IP 回显页）验证。
