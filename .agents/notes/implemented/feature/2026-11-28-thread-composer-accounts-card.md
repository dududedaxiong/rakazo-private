# Agent Note: 聊天快捷卡片加一张“账号管理”卡

Status: implemented

## Problem

用户在 App 聊天界面想更快管保险库里的账号：现在要进保险库得从设置里绕进去。2026-11-28 10:04 用户对着 mockup 确认：在输入框上方那排快捷卡片里，紧跟在“电脑”卡后面，放一张“账号管理”卡，图标是钥匙，下面显示账号数（比如“2 个账号”），点一下进保险库。

## Decision

在 `ThreadComposerChips` 的 `ComposerChip` id 联合里加 `"accounts"`，在 `computer` 后面插入一张卡：

- 图标：iOS 用 `key`、Android 用 `key-outline`（沿用卡片里现有的 `NativeSymbol` 按 id 分支写法）。
- 下面小字显示保险库里的账号数：有账号显示 `"{count} accounts"`（中文“{count} 个账号”），没有显示 `"No accounts"`（中文“暂无账号”）；还在加载时先显示卡片名，等数到了再换。
- 点一下进保险库：`router.push({ pathname: "/(settings)/vault", params: spaceId ? { spaceId } : {} })`，和保险库页本身的路由参数约定一致（有 spaceId 进该空间的保险库，没有进账号的）。
- 账号数是真实的：用 `vault/list` 按当前线程的作用域取（`settingsTarget(spaceId)` 定作用域、`settingsRpc(target)` 调，和保险库页 `vault.tsx` 同一套），取回数组的长度就是账号数；`useFocusEffect` 在进入和回到这个界面时都刷新一次，免得在保险库里增删完回来数还是旧的。
- spaceId 顺着现有的线传下去：路由层 `app/thread.tsx` 用 `threadSpaceRequest(spaceId, focusSync.activeSpaceId)` / `selectedSpaceId()` 定出当前空间 → `Thread`（thread-screen.tsx）多一个 `spaceId` prop → 传给 `ThreadComposerChips`。不另造空间来源；`snap` 里没有 spaceId，所以不走 snap。

“账号数”指保险库条目总数（登录信息 + Cookie 都算），和保险库页顶部的“全部 N”一致。mockup 上的“2 个账号”当时正好是全部 2 条（1 登录 + 1 Cookie），所以总数就是用户看到的数；只数登录类会把只存 Cookie 的账号漏掉，和保险库页对不上。

## Alternatives considered

- **在 chips 组件里直接读 `selectedSpaceId()`，不走 prop 透传** — 最强的理由：少改两层，不用动 `Thread` 的 props。否掉：`ThreadComposerChips` 现在所有输入都是 props（botId、userId、favoriteCount……），在里面直接读全局选中空间会打破这个约定，也让测试要多 mock 一个全局状态；路由层已经算好当前空间了，顺手传下去更干净。
- **把账号数从一个共享的保险库 store 里读，或把 vault/list 提到 thread screen 和保险库页共用** — 最强的理由：一次请求两处用，不重复拉。否掉：现在没有共享的保险库 store；卡片只要一个数，聚焦时调一次作用域对的 `vault/list` 够便宜，不值得为它新建一个 store。
- **只数登录类条目，不数 Cookie** — 最强的理由：“账号”听起来像账号密码，Cookie 不像账号。否掉：mockup 的“2 个账号”就是全部 2 条；用户现在的主要用法正是 Cookie 登录，只数登录会把只有 Cookie 的账号漏掉，卡片数和保险库页的“全部 N”对不上。
- **只在挂载时读一次（`useEffect`），和别的卡片一样** — 最强的理由：和别的卡片一致，代码最少。否掉：用户点进保险库增删账号再回来，数还是旧的；`useFocusEffect` 在进入和回来时都刷新，正好盖住这个场景，保险库页本身也是这么刷新的。

## Consequences

- 聊天界面快捷卡片多一张“账号管理”，在“电脑”后面，显示真实账号数，点进对应空间的保险库。
- 新增 3 条文案（`"Account management"`、`"{count} accounts"`、`"No accounts"`），8 个移动端语言目录都要有（中文/繁体中文实译，其余先用英文原文兜底，和之前 Cookie 那批的做法一致）；i18n 完整性测试会扫源码里的 `t()` 逐个核对。
- 全部是 App 端改动（`apps/mobile`），需要重新打 App 包才能到用户手机上；服务端部署带不走它。
- 加载中的短暂窗口里，小字先显示卡片名再换成数字；`vault/list` 读失败时数保持上一值（首次失败则显示卡片名），不弹错、不挡卡片。

## Verification

- 新测试 `apps/mobile/lib/thread-composer-chips.test.tsx`：账号卡 4 个（有账号显示数量、没账号显示“暂无账号”、带 spaceId 点进空间保险库、不带 spaceId 点进账号保险库），全过；整文件 12/12 过。i18n 完整性测试 32/32 过（3 条新文案在 8 个语言目录都有）。线程路由测试 3/3 过。
- `pnpm verify-notes` 全过；Biome 干净。
- 未在真机上验证：需要打完新包后在手机上确认卡片位置（电脑卡后面）、数字和点进保险库后的空间一致。
