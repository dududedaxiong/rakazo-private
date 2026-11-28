# Agent Note: 浏览器 Cookie 导入——机器人用用户自己的 Cookie 登录网站

Status: implemented

## Problem

机器人要在网站上替用户操作，第一步经常是登录。密码绝不能走聊天（2026-11-16 定下的凭据规则：密码只能进安全表单、服务端加密存储、模型看不到明文），而用户自己能从浏览器里导出 Cookie——登录后的会话凭证。把这批 Cookie 交给机器人的浏览器，机器人打开那个网站时直接就是登录状态，不用再填账号密码。

设计见 [2026-11-27-browser-cookie-import-design.md](../../proposed/feature/2026-11-27-browser-cookie-import-design.md)。

## Built

分支 `feature/browser-cookie-import`，自 `f27ac0ec` 起，五个提交：

- `06748e0` 基础：contracts 的 `browser_cookies` auth 类型与 `VaultKind`、`vaultItemSubtitle` 的 `cookies` 词、adapter-kit 的 `BrowserCookie` 与导航命令字段、解析器与 `resolveCookieInjection`（含 200 条 / 64 KB 上限、RFC 6265 匹配、过期跳过、宽松逐条跳过）、`revealBotSecret` 对 Cookie 返回 null。
- `9f3156a` adapter 接线：`pageBrowserTool` 在 `browser_navigate` 前解析 Cookie 并注册脱敏，`browserNavigateFromTool` 在导航落到登录页时追加兜底提示（点名已保存的账号登录），`ClientBrowserProvider` 不把 Cookie 放进手机任务（envelope 只带 URL），`ComputerBrowserProvider` 对不认识命令的旧镜像重试一次不带 Cookie 的导航。
- `b6e78c6` supervisor + helper：zod schema 加 `cookies` / `userAgent` 与 `clear_cookies`，带 Cookie 的导航走 stdin（不走 argv），校验失败答固定错误不回显值；helper 先开空白页再注入（否则页面会在注入前加载），`Network.setCookie` 逐条、`Emulation.setUserAgentOverride` 设 UA，只返回条数；`clear_cookies` 按 name + domain + path 删。agent-browser 0.41.0 确实有 `cookies set` 命令，但它的 clear 会清空整个 profile、没有 UA 覆盖、不报逐条结果，所以没用它，直接走 CDP。
- `8200843` API：`vault.importCookies`（同站重导更新旧项）、`vault.reveal` 对 Cookie 项报 403 而不是 404、`vault.remove` 与 `botSecrets.remove` 删行前读出 Cookie 名并向浏览器清理。清理覆盖该用户自己的全部电脑与本空间的共享电脑（只清运行中的；停着的电脑下次启动前 profile 里的 Cookie 还在），失败只记日志、不阻断删行。
- `6eec6e1` UI：网页版 + App：保险库表单与对话凭证卡片的双模式。

网页版：`VaultItemEditor` 顶上是模式选择（账号密码 / Cookie/UA），Cookie 模式显示粘贴框 + UA 框，保存走 `vault.importCookies`，成功后表单内显示导入汇总（导入 N 条、跳过原因）而不是直接关闭；列表与详情只显示元数据（网站、条数、最早过期时间），无查看入口。`SecretAskCard` 复用同一个编辑器，所以对话里的凭证卡片同样有两种模式；从卡片导入 Cookie 不算回答（`threads.answer` 没有这种形状），卡片保持打开，用户点掉卡片后机器人重新导航、带着 Cookie 登录。

App：`VaultItemEditor` 同样有模式选择，用原生分段控件；`lib/vault.ts` 的 `draftCookieSave` 拼导入保存，`vault.tsx` 的保存按 `cookieImport` 分流到 `vault/importCookies` 再重读列表；编辑 Cookie 项时跳过验证身份查看（本来就会 403），直接以 Cookie 模式打开、UA 预填；`VaultItemSheet` 只显示网站与条数。`SecretAskSheet`（登录提问的表单）也有模式选择，Cookie 模式走 `vault/importCookies`（以当前选中的空间为准，即卡片所在的空间），成功后显示汇总、卡片保持打开；`browser_cookies` 类型的提问直接以 Cookie 模式打开且不可切换。

## Decision

Cookie 存在复用的保险库里，不另建表。`VaultCredential` 新增一种 auth 类型 `browser_cookies`，元数据只存条数、最早过期时间、可选 UA：`{ type: "browser_cookies", cookieCount, earliestExpiry, userAgent? }`。Cookie 列表本身以 `{"v":1,"cookies":[...]}` 的 JSON 形式进 `EncryptedSecretStore`（AES-256-GCM，`v2:` 格式，AAD 绑定记录 id），与网站登录凭据同一套加密。`auth` 是 Json 列，所以这个改动不需要 Prisma 迁移。

导入接受两种格式：JSON 数组（Cookie-Editor / EditThisCookie 风格）和 Netscape `cookies.txt`。解析在服务端做，校验宽松：逐条跳过坏的并汇总原因（域名不符 / 已过期 / 格式不对），不整批拒绝。导入上限 200 条、原始内容 64 KB。一批 Cookie 只绑一个 origin；Cookie 自带的 domain 必须按 RFC 6265 与该 origin 匹配（host-only 精确匹配，或 `.example.com` 父域后缀匹配），`evil-example.com` 匹配不上 `example.com`。

注入在每次导航前做，不写 Chrome profile 的 `Cookies` SQLite 文件。导航链路带上 `cookies` + `userAgent`：adapter-kit 的 `PageBrowserCommand` 的 `navigate` 变体、supervisor 的 zod schema、Python helper 三处同改。helper 用 `page_secrets.py` 现成的标准库 CDP 客户端调 `Network.setCookie` 逐条注入，`Emulation.setUserAgentOverride` 设 UA，再导航。Cookie 值只走 supervisor 命令 JSON 经 stdin 传给 helper，不走 argv；返回结果经 `redactBrowserResult` + `ctx.secrets` 脱敏；Cookie 值不进日志、工具输出、审计事件、笔记、测试（测试只用 `example.com` + `"test-value"`）。

路由规则是固定的：同一网站两种凭证都设了，先试 Cookie，Cookie 不行（导航后页面还是登录页，说明过期或失效）再自动用账号密码登录；只设一种就用那一种。Cookie 是快路，账号是兜底。登录页的判断看导航结果：最终 URL 落到登录路径（而请求的 URL 不是），或快照里出现密码字段。Cookie 失败后不重试 Cookie；兜底登录也失败时按正常登录失败上报。

表单是显式的二选一。保险库表单（网页版 + App）和对话里弹出的保险库凭证卡片顶上都有模式选择：“账号密码”或“Cookie/UA”，选哪个只显示哪个的填写框，两种模式都存成 `VaultCredential` 行（auth 类型分别是 `login` 和 `browser_cookies`）。模式选择本身就是互斥机制，不再在密码字段下加提示行。

列表只返回元数据（网站、条数、最早过期时间、更新时间）。Cookie 项禁用保险库的“验证身份后查看明文”，只有元数据和删除。（2026-11-28 已翻转：用户要求与密码一样可见可复制，见 [2026-11-28-cookie-reveal-like-password.md](../../implemented/bug-fix/2026-11-28-cookie-reveal-like-password.md)。）删除要清两处：删数据库行，并且向浏览器发 `clear_cookies` 命令，按 name + domain + path 逐条调 CDP `Network.deleteCookies` 清 profile——只删行不够，浏览器是持久 profile。

过期不自动续期：列表显示最早过期时间，注入时跳过已过期的，失效后用户重新导出导入覆盖同一网站的旧记录。再导入同一网站时按 name + origin + type 找到旧项并更新（`auth` 里的条数/过期/UA 一起更新），不新建、不报错。

## Wire contract

`BrowserCookie`（adapter-kit，导航命令和 helper 共用）：`{ name, value, domain, path, secure, httpOnly, sameSite?, expires? }`，`expires` 是秒级 Unix 时间戳，缺失表示会话 Cookie；`sameSite` 归一化为 CDP 的 `"None" | "Lax" | "Strict"`。

`PageBrowserCommand` 的 `navigate` 变体加 `cookies?: BrowserCookie[]` 和 `userAgent?: string`；新增 `clear_cookies` 命令，带 `cookies: Array<{ name, domain, path? }>`。`BrowserNavigateRequest` 同样加这两个字段。

## Alternatives considered

- **Cookie 直接发聊天里让模型填** — 最省事；但 Cookie 会经过中转站，任何一个中转都能拿去冒用登录，比密码更危险（不需要第二步验证）。否掉。
- **写一次 Chrome profile 的 Cookie 数据库，导入后不用再注入** — 不用改导航链路；但 Chrome 运行时锁库文件，外部写入不生效，格式还随版本变。否掉。
- **每次运行给机器人开全新浏览器 profile** — 隔离干净；但机器人浏览器就是显示器上常驻那台 Chrome（用户要在屏幕上看到机器人操作），换 profile 等于换架构，且全新 profile 下每次都要重新注入，省不掉注入这一步。否掉。
- **新开一张 Cookie 专用表，不复用保险库** — 边界干净；但列表、删除、加密、权限、界面都要重做一套，与“复用已有原语”的要求相背。否掉。
- **表单只靠密码字段下的提示行做二选一** — 用户 22:04 改成顶上的显式模式选择：提示行靠用户自觉，单选直接把选择做进界面，不会同时填错。提示行方案被模式选择取代。
- **Cookie 失败时由模型自己决定要不要用账号登录** — 模型不一定看得出 Cookie 失效（页面只是回到登录页），且“先 Cookie 后账号”是用户定下的固定顺序，不该留给模型临场判断。路由规则写死在导航层，模型只收到“Cookie 没登上，已有保存的账号登录可用”的结果。

## Consequences

- 保险库多了一种类型，列表、编辑器、凭证卡片三处 UI 都要认它；`VaultKind` 加 `"browser_cookies"`，`vaultItemSubtitle` 用 `auth` 里的条数和最早过期时间拼副标题。
- `prepareBotSecret` 的明文上限按类型走：`browser_cookies` 是 128 KB（导入原始内容上限 64 KB，规范化后的 JSON 可能比 Netscape 原文略大），其余类型仍是 16 KB。
- `sameSecretDestination` 对 `browser_cookies` 只比 name + origin + type：`auth` 里的条数、过期时间、UA 是每次导入都会变的元数据，不算身份，否则重导就会报“先删掉已有凭证”。
- 旧镜像的电脑不认识带 `cookies` 的导航命令和 `clear_cookies`（supervisor 的 exit 2 路径）：导航必须按“命令不认识”回退成不带 Cookie 的普通导航，而不是报错；删除时的清理失败只记日志，不阻断删行。电脑镜像要重新构建部署后 helper 的改动才生效。
- 注入依赖的链路长（adapter-kit 类型 → supervisor schema → Python helper），三处必须同批改，少一处就断。
- 共享容器串号的风险仍在容器/磁盘层，不在浏览器 profile 层；设为“私有”的机器人独占一台容器，不存在这个问题。团队电脑上的风险本次不解决。
