# Agent Note: 保险库保存凭证后，未答的凭证提问自动解除

Status: implemented

## Problem

2026-11-28 07:33，用户让小码酱登录 `https://we.killcovid2020.com`。当时保管库里没有该站凭证，机器人调 `request_secret`，跑出“91porn we 站登录”卡片（只有“添加”按钮），运行停在 `Request secret` 等用户。07:42 用户在“设置 → 保管库”里存好了该站的 10 条 Cookie（列表可见 `we.killcovid2020.com 10 条 Cookie`），但卡片一直没解除、运行一直卡着；机器人 07:48 还回了一句“已登录”，可运行始终没结束，用户问“你不是帮我填写了吗”。

根因是两条路不相干：

- 提问只在 `threads.answer`（卡片路径）里解除。`commitAnswerRunInput`（`packages/db/src/thread-ask.ts`）存凭证、把 ask block 标 `answered`、把 `request_secret` effect 置 `approved`、把运行置 `queued`，是一次完成的。设置页的保存（`vault.put` / `vault.importCookies`，`apps/api/src/routes/bots.ts`）只写 `VaultCredential` 行，从不碰 ask block 和停住的运行。
- 即便运行被放出来，`request_secret` 恢复时也找不到 Cookie。恢复时的查找是按名（`findBotSecret`）和按站找登录（`findSiteLogin`，只认 `login` 类型）；登录提问 + Cookie 保存的组合，两条都落空，工具会重新提问。

原来的 Cookie 导入笔记也留过这个口子：卡片里导入 Cookie“不算回答，卡片保持打开，用户点掉卡片后机器人重新导航”。那是卡片内导入的假设；设置页保存根本没有“点掉卡片”这一步，所以运行就一直停着。

## Decision

保存凭证时，把该凭证能满足的、未答的凭证提问一起解掉；恢复时让工具认得 Cookie 也是登录路。两处改动是同一修复的两半，缺一半另一半不成立。

### 1. 保存时解提问（`packages/db/src/thread-ask.ts` 新增 `answerPendingSecretAsksForSavedCredential`）

`vault.put` / `vault.importCookies`（以及共用 `saveVaultCredential` 的 `botSecrets.put`）存好凭证后调它；失败只记日志，绝不让保存失败。它在 `ThreadEvents` 上接线（`packages/db/src/events.ts`），调用方按已答的每条运行做 `deps.events.notify` + `runContinueJob` 入队，与 `threads.answer` 的收尾一致。

它只解“保存的凭证确实能满足”的提问，匹配规则与恢复时工具的查找一一对应：

- 同一个人、同一空间、运行还在 `waiting_input`；只看 `input === "secret"`、带 `credential` 的未答 ask block（一次性验证码提问没有 `credential`，不解）。
- 站点必须相同（origin 字符串相等）。
- 登录提问：同名登录可解；或该站恰好只有一个登录（`findSiteLogin` 的规则，须 HTTPS）；或该站恰好只有一个 Cookie 项（Cookie 优先的登录路，须 HTTPS）。
- Cookie 提问：同名 Cookie 可解；或该站恰好只有一个 Cookie 项（须 HTTPS）。
- 其他组合（登录提问 + 卡片/联系人/变量等、Cookie 提问 + 登录保存）一律不解，留在原地。

解的时候不重新存凭证（已经存好了），只做回答那一半：ask block 标 `answered`（`answer` 为空串，凭据不进消息记录）、`request_secret` effect 置 `approved` 且 `result` 为 `{ credentialSaved: <实际保存的凭证> }`、运行置 `queued`。`result` 写实际保存的凭证而不是提问的凭证——恢复时工具先按提交结果比对，写错会让工具报“凭证已不在”。

为防存到机器人读不到的保险库（账号库 vs 空间库）而误解：先按 `settingsTarget` 算出该运行能读的库，确认保存的行就在那个库里，再数该站的登录/Cookie 条数；行不在那个库里一条也不解。计数在解之前算一次；并发下计数变旧的最坏结果是工具恢复时重新提问，不会用错凭证。

### 2. 恢复时工具认 Cookie（`packages/adapters/src/bot-secrets.ts` 新增 `findSiteCookie`，`run-tools-secrets.ts` 的 `request_secret` 接上）

`findSiteCookie` 与 `findSiteLogin` 对称：该站恰好只有一个 `browser_cookies` 项时返回它，否则 null（0 条或 2 条以上都不认，与 `resolveCookieInjection` 的“恰好一个”一致）。

`request_secret` 在 `siteLogin` 之后、提问之前加一段：没有已知的、也没有该站登录时，若该站有唯一 Cookie 项，返回 `{ saved: true, ... }`。这同时覆盖两种情况：登录提问被 Cookie 满足（导航时注入 Cookie 即登录），以及 Cookie 提问被同站异名 Cookie 满足。这一段也是反向的同一机制：提问时站上已有保存的 Cookie，工具直接返回，不再新建提问。

## Alternatives considered

1. **只修卡片内导入，让用户点掉卡片**。最强的理由：原来导入笔记就是这么设计的，点掉卡片后机器人重新导航，流程已经通。不用：用户是从设置页保存的，那条路没有“点掉卡片”这一步；而且“存好了还要手动点掉”正是用户质问的点（“你不是帮我填写了吗”），保存本身就该是回答。
2. **跑一个 reconciler，定期把停住的运行拿保管库重对一遍**。最强的理由：保存处不用动，提问与保存彻底解耦。不用：停住的运行只有被回答才会恢复，reconciler 本质上还是要合成一个回答，等于把同一套提交逻辑搬到定时任务里，还多了延迟和竞态；保存时当场解是最直接、最精确的点。
3. **按站全解，不分凭证种类（登录保存也解 Cookie 提问）**。最强的理由：匹配最简单。不用：恢复时工具按提问的凭证找，登录保存解不掉 Cookie 提问——工具会报“凭证已不在”或重新提问，等于把卡住换成报错。
4. **让设置页保存直接走 `threads.answer`（合成一次卡片回答）**。最强的理由：复用整条回答路径，不用新写提交逻辑。不用：`threads.answer` 要 `messageId`/`runId`，设置页没有；而且卡片回答的 writer 会再存一次凭证，设置页已经存过了。解提问的提交逻辑与存凭证是两件事，分开才干净。

## Consequences

- 设置页存登录或 Cookie 后，同站同人的、停在 `Request secret` 的运行立刻恢复，不用再去点卡片；07:33 那种“存了还卡着”不再出现。卡片内导入 Cookie 也一样：导入成功即算回答，运行恢复去导航，不用再手动点掉卡片。
- `request_secret` 提问前先认已存凭证：登录提问在站上有唯一登录或唯一 Cookie 时直接返回，Cookie 提问在站上有唯一 Cookie 时直接返回；以前只有登录有这条路，现在 Cookie 也有。
- 仍不解的留在原地：跨站保存、其他种类凭证、一次性验证码提问、该站有 2 个以上同类凭证（工具无法二选一）——这些恢复时工具本来也找不到，解了只会换成报错。
- 测试：`packages/db/src/events.test.ts` 新增解析器用例（设置页保存解同站登录提问、解同站 Cookie 提问、异站不解、异种不解、一次性验证码提问不解、他人运行不解、已答过的不重复解）；`packages/adapters/src/bot-secrets.test.ts` 新增 `findSiteCookie` 用例（唯一返回、0 条/2 条返回 null、只认 Cookie 项）；`request_secret` 的 Cookie 查找走 `executor-run-login.test.ts` 的同类用例覆盖。`pnpm verify-notes` 通过。
- 未验证：没有真实运行的端到端——部署后须在真机上重走一次（先提问、再设置页保存、看运行恢复且机器人带着 Cookie 登录）。计数竞态见上，至多导致重新提问。
- 与并行分支的关系：手机保存按钮修复、Cookie 头格式解析、Cookie 查看（可见可复制、验密码）是同一批里的另外三支，各自独立分支；本支只动提问解除与恢复查找，不碰它们的 UI 与解析器。
