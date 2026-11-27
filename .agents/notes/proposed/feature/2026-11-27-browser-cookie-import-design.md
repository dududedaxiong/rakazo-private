# Agent Note: 浏览器 Cookie 导入——机器人用用户自己的 Cookie 登录网站

Status: proposed

已落地，见 [2026-11-27-browser-cookie-import.md](../../implemented/feature/2026-11-27-browser-cookie-import.md)。这篇保留为设计记录。

## Problem

机器人要在网站上替用户操作，第一步经常是登录。让机器人在聊天里问用户要账号密码行不通：密码会经过中转站（第三方模型提供商），按 2026-11-16 定下的凭据规则，密码绝不能走聊天，只能进安全表单、服务端加密存储、模型看不到明文。

用户现在换了一个更直接的做法：Cookie 他自己从浏览器里能提取出来。Cookie 就是登录后的会话凭证——浏览器里已经登录的网站，把它的 Cookie 交给机器人的浏览器，机器人打开那个网站时直接就是登录状态，不用再填账号密码。

这篇笔记回答用户问的“具体操作是啥”：用户每一步怎么做，技术上怎么落地，哪些地方要用户拍板。

说明：这只解决“登录状态”问题，不解决 Cloudflare 验证问题。Cloudflare 的放行凭证跟 IP 绑定，手机上过的验证换到容器的机房 IP 还是会被重新拦；Cookie 能让机器人带着登录态进站，但过验证本身仍要靠本地流量那条路（手机操作浏览器）。

## 用户操作流程（一步一步）

### 1. 在自己的浏览器里登录目标网站

在手机或电脑浏览器上打开要操作的网站，正常登录一次。登录态就存在这个浏览器的 Cookie 里了。

### 2. 导出 Cookie

装一个 Cookie 导出扩展（二选一，两个都是常见工具）：

- **Cookie-Editor**（或 EditThisCookie）：点扩展图标 → Export → 复制 JSON。得到的是一个 JSON 数组。
- **Get cookies.txt**（或同类导出工具）：导出 Netscape 格式的 `cookies.txt`，复制全文。

两种格式都支持（见“导入格式”）。只导当前这一个网站的 Cookie，不要导全部——全站导出里混着别的网站的 Cookie，导入时会被按域名挡掉。

### 3. 打开导入表单，粘贴导入

打开 Rakazo 网页版 → 设置 → 保险库 → 新增 → 选“浏览器 Cookie”，然后：

1. 填网站地址，例如 `https://example.com`。这就是这批 Cookie 绑定的网站。
2. 把第 2 步复制的导出内容粘贴进大文本框。
3. 点“导入”。表单上会写清楚三句话：Cookie 加密存在服务端；只在这个网站上用；模型看不到 Cookie 的值。

导入后页面给一个结果汇总：成功导入 N 条，跳过 M 条（每条跳过的原因写出来：域名不符 / 已过期 / 格式不对）。

### 4. 机器人打开这个网站时会发生什么

以后机器人用浏览器打开这个网站时，服务端在页面加载前先把这批 Cookie 注入浏览器，网站看到的就是已登录的会话，页面直接是登录后的样子。机器人不需要、也不会向用户要账号密码。

如果机器人打开的是别的网站，这批 Cookie 不会被注入（域名绑定，见“技术方案”）。

### 5. Cookie 过期 / 失效了怎么办

- 列表里每条 Cookie 集都显示最早过期的时间。注入时过期的 Cookie 会被自动跳过，不会发给浏览器。
- Cookie 失效（比如网站让重新登录）没有自动续期的办法：重新走第 1–3 步，重新导出、重新导入，覆盖同一网站的旧记录。

### 6. 删除 / 撤销

保险库列表里找到该网站的 Cookie 项 → 删除。删除同时做两件事：删掉服务端存的加密记录，**并且**从机器人浏览器的实时会话里清除这批 Cookie（只删数据库行不够——浏览器是持久 profile，Cookie 会留在里面，见“技术方案：撤销”）。

## 方案

### 浏览器生命周期：持久 profile，每次导航前注入

先查到的事实（决定了注入点）：

- 机器人浏览器是电脑显示器上那台 Chromium，由 `infra/sandboxes/computer/rakazo-page-browser`（Python）驱动，里面调的是 `agent-browser` v0.41.0（vercel-labs，钉死版本 + sha256 校验），通过 CDP 连显示器上的 Chrome。
- 一个 agent-browser 会话（`AGENT_BROWSER_SESSION`）在多次调用之间保持连接；Chrome 本身是显示器上常驻的那台，用它自己的 profile。**所以浏览器是跨运行持久 profile，不是每次运行全新 profile。**
- 导航链路：`browser_navigate` → `pageBrowserTool`（`packages/adapters/src/run-tools-computer.ts`）→ `browserNavigateFromTool` → `ComputerBrowserProvider.navigate`（`packages/adapters/src/computer-browser.ts`）→ 沙箱的 `pageBrowser` → supervisor 的 `POST /computers/:id/browser` → supervisor 把命令 JSON 经 stdin 传给 helper 子进程 → helper 调 agent-browser 批量命令 → CDP。
- supervisor 用 zod 的 `discriminatedUnion("command", …)` 校验命令（`infra/sandboxes/supervisor/src/routes.ts`，目前只有 `navigate` / `snapshot` / `purchase_check` / `act`），所以新字段或新命令要同时改三处：adapter-kit 的 `PageBrowserCommand` 类型、supervisor 的 zod schema、Python helper。

注入点选 **每次导航前注入**，不用“写一次 profile 就行”：

- 注入方式：导航命令上带一个 `cookies` 字段（或新增一个 `set_cookies` 命令，在 `navigate` 之前发）。helper 在导航前用 `page_secrets.py` 里现成的纯标准库 CDP 客户端（`CdpClient.call`、`discover_ws_url`，今天填登录信息已经在用它）调 `Network.setCookie`，逐条写入，再导航。
- 为什么不用“写一次 Chrome profile 的 Cookie 数据库”：Chrome 运行时会锁它的 `Cookies` SQLite 文件，外部写不进去；就算写进去了，运行中的 Chrome 也不会重新读；文件格式还随 Chrome 版本变。这是脆弱的路，不走。
- 为什么不用“只在导入时注入一次，靠 profile 持久化”：导入时浏览器可能没有开着那个网站的标签页，注入无处落脚；而且 profile 持久化是副作用不是保证。每次导航前注入是确定的、可验证的，profile 里残留的 Cookie 只是附带效果（撤销时必须处理，见下）。

agent-browser CLI 本身今天没有用到任何 Cookie 命令（代码里唯一的 cookie 字样是 Cookie 提示横幅的匹配），所以注入走直接 CDP，不依赖 agent-browser 有没有 Cookie 子命令；实现前先确认一次 v0.41.0 的命令表，若有现成的 Cookie 命令则优先用它。

### 存哪张表、怎么加密

复用现有保险库，不建新加密方案：

- **存 `VaultCredential` 表**（`packages/db/prisma/schema.prisma`，`vault_credentials`）：`userId`、`spaceId`、`name`（网站名）、`origin`（网站来源，如 `https://example.com`）、`auth`（Json，存元数据）、`ciphertext`（加密后的 Cookie 列表）、`createdAt`、`updatedAt`。
- **新增一种 auth 类型**，例如 `auth: { type: "browser_cookies", cookieCount, earliestExpiry }`。保险库现在的种类是 `login | card | contact | api_key | variable`（`packages/contracts/src/vault-items.ts` 的 `VAULT_KINDS`），加一种即可，不用另起一套表和一套界面。
- **加密复用 `EncryptedSecretStore`**（`packages/adapters/src/secrets.ts`，`SecretStore` 实现）：AES-256-GCM，v2 格式 `v2:<base64(salt | iv | tag | 密文)>`，密钥由 `ENCRYPTION_KEY` 经 scrypt 派生，AAD 绑定记录 id。解密走 `secretStore.load(ciphertext, recordId)`。这是 2026-11-16 网站登录凭据同一套做法，不发明新加密。
- **列表只返回元数据**：网站、条数、最早过期时间、更新时间。Cookie 的名字和值永不出现在列表接口里。

### 域名绑定（只在匹配域名上用）

- 一批 Cookie 绑定一个网站来源（origin，如 `https://example.com`）。导入时逐条校验：Cookie 自带的 `domain` 必须与这个网站的 host 匹配（按 RFC 6265：host-only 精确匹配，或 `.example.com` 这种父域后缀匹配），不匹配的跳过并在导入汇总里说明。
- 注入时只看导航 URL 的 host：查出该用户、该 origin 的记录，再逐条按 Cookie 自身的 domain/path/secure 过滤，只注入当前页面能用的那几条。别的网站导航时不注入。
- 这与 `fill_secret` 的 origin 校验是同一条规则（`resolveLoginFill` 会核对登录信息保存时的 origin 与当前页面 origin 是否一致）。

### 注入时 Cookie 值怎么走（模型为什么看不到）

照抄 `fill_secret` 的已有路径，Cookie 值只出现在服务端到沙箱这一小段里：

1. 适配器层（`pageBrowserTool`）在导航前调一个 `resolveCookieInjection`（与 `resolveSecretFill` 并列）：按运行的 `userId` 查记录 → `secretStore.load` 解密 → 过滤掉过期的 → 得到 Cookie 列表。
2. Cookie 列表只放进发给 supervisor 的 `PageBrowserCommand` JSON 里。supervisor 已经有这个处理：带已保存登录信息的命令走 **stdin** 传给 helper，**不走 argv**，因为 argv 能被电脑里的任何进程读到，包括机器人自己的 shell（`infra/sandboxes/supervisor/src/routes.ts` 里的注释就是这么写的）。带 Cookie 的导航命令同样走 stdin。
3. helper 里 `page_secrets.py` 的 `call_with` 是把值当 JS 函数参数传进去的，秘密值从不出现在脚本源码里；`Network.setCookie` 同理是 CDP 参数，不是页面脚本。
4. 返回给模型的结果照常经过 `redactBrowserResult` + `ctx.secrets` 脱敏：页面回显了 Cookie 内容也会被 scrub 掉。模型收到的只是“已注入 N 条 / 导航成功”这种结果，永远看不到值。
5. Cookie 值不进任何日志、工具输出、审计事件、笔记和测试（测试用 `example.com` + `"test-value"` 这种假值）。

### 分用户隔离（约 5 个人共用）

- 数据库层：`VaultCredential` 有 `userId`（+ `spaceId`），查询一律按当前运行的 `userId` 过滤；一个用户看不到、也用不了另一个用户的 Cookie 记录。这是 `resolveLoginFill` 今天的做法，Cookie 照做。
- **但有一个保险库本身没有的问题：团队电脑的容器是共享的。** 团队电脑是一台容器，里面每个机器人有自己的浏览器 profile（`chromium-bot-<hash>`，按 botId 分），正常浏览不会互相串 Cookie；但所有机器人的 shell 在同一台容器里以同一系统用户跑，理论上能读到别的机器人 profile 目录下的文件。所以串号的风险在容器/磁盘层，不在浏览器 profile 层。这是本次设计里最大的风险点。
- **“私有”（dedicated）已经是隔离的**（2026-11-27 查代码确认）：`computerMode` 为 `dedicated` 的机器人独占一台电脑（独立容器，`Computer.scope` 为 `bot:<botId>`），浏览器 profile 也是它自己的，别的机器人碰不到它的 Cookie。所以一个设为“私有”的机器人，Cookie 导入的串号问题就不存在了；但空间里如果还有别的机器人用“团队”电脑，那台电脑上的风险还在——“私有”是按机器人逐个解决，不是全空间一次解决。
- v1 的处理（二选一，等用户拍板，见“需要用户拍板的点”）：
  - （a）只在私人电脑上启用 Cookie 注入，团队共用的电脑不注入；
  - （b）每次运行结束（或每次导航离开该网站）后，从 profile 里清除本次注入的 Cookie。
- 无论选哪个，删除/撤销时都必须清 profile（见下）。

### 撤销：删除要清两处

因为浏览器是持久 profile，删除 Cookie 记录必须同时：

1. 删数据库行（`VaultCredential` 的那条记录）；
2. 向浏览器发一次清理：对这批 Cookie 逐条调 CDP `Network.deleteCookies`（按 name + domain + path），或对该域名调 `Network.clearBrowserCookies` 的域名限定版（CDP 没有按域名清的单条命令，逐条删是稳妥做法）。不清 profile，撤销就是假的——机器人下次打开网站还是登录态。

### 导入格式

支持两种，用户从浏览器导出时二选一：

**（i）JSON 数组（EditThisCookie / Cookie-Editor 风格）**

```json
[
  {
    "name": "sessionid",
    "value": "test-value",
    "domain": "example.com",
    "path": "/",
    "expirationDate": 1796000000,
    "secure": true,
    "httpOnly": true,
    "sameSite": "lax"
  }
]
```

字段说明：`expirationDate` 是秒级 Unix 时间戳（浮点）；`sameSite` 在 Chrome 导出里是 `"no_restriction" | "lax" | "strict" | "unspecified"`，要归一化成 CDP 的 `"None" | "Lax" | "Strict"`；`session: true` 的 Cookie 没有过期时间，按会话 Cookie 处理。

**（ii）Netscape `cookies.txt`**

每行 7 个 Tab 分隔字段：`domain`、`flag`（TRUE 表示子域可用）、`path`、`secure`（TRUE/FALSE）、`expiration`（秒级时间戳）、`name`、`value`；`#` 开头是注释，`#HttpOnly_` 前缀的行表示 HttpOnly。注意：值里带 Tab 会断行，解析时按“前 6 个字段定长、第 7 个字段取行剩余部分”处理，并设单条上限。

两种格式共用的校验（导入时做）：

- 必须有 `name`、`value`、`domain`；缺失的跳过并计数。
- `domain` 必须与申报的网站匹配（见“域名绑定”），否则跳过。
- 已过期的跳过并计数。
- 数量上限（建议 200 条）和总大小上限（建议 64 KB），防滥用和误粘贴。
- 校验结果汇总返回给用户：成功 N 条、跳过 M 条及原因。严格程度（整批拒绝 vs 逐条跳过）等用户拍板。

### 导入表单放哪

复用保险库界面，不新开页面：

- 网页版：设置 → 保险库（`apps/web/src/components/VaultSettings.tsx`，`SettingsOverlay` 的 `vault` 分区），新增时种类里多一个“浏览器 Cookie”，编辑器复用 `apps/web/src/components/vault/VaultItemEditor.tsx` 的模式（标题 + origin + 大文本框 + 说明文字）。
- App 里同样有保险库页（`apps/mobile/app/(settings)/vault.tsx`），界面结构与网页版对应。先做哪一端等用户拍板（建议先网页版：编辑器和列表都现成，改动最小；粘贴大段导出文本在电脑上也更方便）。

## 需要用户拍板的点

1. **导入表单先放网页版还是 App 里？** 两端都有保险库界面。建议先网页版（改动最小，粘贴大段文本也方便），App 随后跟上。
2. **一次导一个网站还是多个？** 建议一个导入项只绑一个网站（与保险库“一项一个 origin”的现有模型一致）。多网站合导要拆成多项，界面更复杂。
3. **Cookie 过期后怎么办？** 建议：列表里显示过期时间，注入时自动跳过已过期的，失效后提示用户重新导出导入。没有自动续期（Cookie 续期等于重新登录，做不到）。
4. **团队共用的电脑上怎么处理？** 浏览器 profile 是整台电脑共享的，一个人的 Cookie 注入后会留在里面，另一个人打开同一网站可能直接就是前一个人的登录态。选一个：(a) v1 只在私人电脑上启用；(b) 每次运行结束自动清除本次注入的 Cookie。约 5 个人共用，这个问题躲不掉。
5. **导入校验严格还是宽松？** 有一条 Cookie 域名不符/格式不对时：(a) 整批拒绝，全部重导；(b) 只跳过坏的，好的照常导入并汇总说明。建议 (b)。
6. **复用保险库还是另建一张表？** 建议复用 `VaultCredential` 加一种新类型（改动最小，列表/删除/加密/权限都现成）。但有一点要确认：保险库现在有“验证身份后查看明文”的功能，Cookie 项必须关掉查看（Cookie 是直接能用的会话凭证，显示出来等于泄露），只留元数据和删除。

## 用户决定（2026-11-27 21:39）

- **拍板点 1（表单放哪）：两版都做**——网页版和 App 里都做导入表单。
- **新增要求（表单提示）**：表单上注明 Cookie 填入时无需密码、填写密码时不能有 Cookie；这行提示放在密码字段下方。Cookie 和密码二选一，不能同时填。
- **新增要求（UA 设定）**：每个 Cookie 项（按网站）可设一个 User-Agent，机器人打开该网站时用这个 UA。见下“UA 设定说明”。
- **拍板点 4（团队共用电脑）**：尚未决定，等用户选。
- **拍板点 2、3、5、6**：用户未逐项表态，默认按本文建议执行（一次一个网站；显示过期时间、注入跳过期、失效重导；校验宽松逐条跳过；复用保险库并关掉 Cookie 项的查看明文），用户有异议再改。

### UA 设定说明

- 每个 Cookie 项存一个可选的 UA 字符串（与该网站的 Cookie 绑在一起）。机器人导航到该网站前，先经 CDP `Emulation.setUserAgentOverride`（或等价接口）把 UA 设成这个值，再注入 Cookie、再加载页面。
- UA 设定确实起作用，但作用有限（2026-11-27 回答用户提问时确认）：
  - 对登录有用：有些网站把会话跟 UA 绑定，机器人浏览器的 UA 和用户手机的不一样，会话会被当成换了设备而失效；UA 设成和导出 Cookie 的浏览器一致，会话能接着用。
  - 对 CF 有用，但只是配合：cf_clearance 也会核对 UA 是否一致；但前提是 IP 也一致，只改 UA、IP 还是容器的机房 IP，CF 照样拦。
  - 单独改 UA 过不了 CF：CF 看的是整套指纹（IP、TLS、行为），UA 只是其中一项；UA 和实际指纹对不上反而更可疑。
- 所以 UA 是“有用的配合”，不是单独过验证的办法；真正过验证要手机 IP + 真设备 + UA 一致三样一起。

## 不做的事

- 不走聊天传 Cookie：不在聊天里问用户要 Cookie，不在聊天里贴导出内容。
- Cookie 值不进任何日志、工具输出、审计事件、决定笔记、测试用例。测试只用 `example.com` + `"test-value"` 这种假值。
- 不在界面上显示 Cookie 的值（不提供“查看”按钮），列表只给元数据。
- 不直接写 Chrome profile 的 `Cookies` SQLite 文件（Chrome 运行时锁文件，格式随版本变，写了也未必生效）。
- 不碰手机那条本地流量路：这功能只给容器里的机器人浏览器用，手机 WebView 有自己的 Cookie 存储，不动它。
- 不自动刷新 Cookie：续期等于重新登录，只能用户重新导出导入。

## Alternatives considered

- **Cookie 直接发聊天里让模型填** — 最省事；但 Cookie 会经过中转站，任何一个中转都能拿去冒用登录，比密码更危险（不需要第二步验证）。否掉。
- **写一次 Chrome profile 的 Cookie 数据库，导入后不用再注入** — 不用改导航链路；但 Chrome 运行时锁库文件，外部写入不生效，格式还随版本变。否掉。
- **每次运行给机器人开全新浏览器 profile，导入时写 profile** — 隔离干净，多用户不串号；但现在机器人浏览器就是显示器上常驻那台 Chrome（用户要在屏幕上看到机器人操作），换 profile 等于换架构，且全新 profile 下每次都要重新注入，省不掉注入这一步。否掉。
- **新开一张 Cookie 专用表，不复用保险库** — 边界干净，保险库的“查看明文”流程不会误伤；但列表、删除、加密、权限、界面都要重做一套，与 AGENTS.md“复用已有原语、不要重复造”的要求相背。复用保险库是更好的默认选择，见“技术方案”。
- **用 agent-browser CLI 自带的 Cookie 命令注入** — 如果 v0.41.0 有现成的 Cookie 子命令，比直接调 CDP 少写代码；但今天代码里没有任何 Cookie 命令在用，实现前必须先查命令表确认，没有就走直接 CDP（`page_secrets.py` 的客户端已经在了）。

## Acceptance criteria

- 用户按“用户操作流程”走完，机器人打开该网站时直接是登录态，不用再问账号密码。
- Cookie 只在绑定的网站上注入，别的网站导航时不注入；别的用户看不到也用不了这批 Cookie。
- 模型收到的任何结果里都不出现 Cookie 的值；日志、审计、笔记里也不出现。
- 列表只显示元数据（网站、条数、过期时间、更新时间），没有查看 Cookie 值的入口。
- 删除后，服务端记录和浏览器 profile 里的 Cookie 都被清除，再打开该网站不再是登录态。
- 导入两种格式（JSON 数组、Netscape cookies.txt）都能用；域名不符、已过期、格式不对的条目被跳过并汇总说明。

## Risks

- **共享容器串号**：团队电脑是一台容器、每个机器人一个浏览器 profile，正常浏览不串 Cookie；但所有机器人的 shell 共用同一系统用户，理论上能读到别的机器人 profile 目录下的文件。见“分用户隔离”和拍板点 4。设为“私有”的机器人独占一台容器，不存在这个问题。
- **浏览器进程里仍有明文**：注入那一刻 Cookie 值在 helper 进程内存里，沙箱本身必须可信；沙箱被攻破则 Cookie 仍可能泄露。与 2026-11-16 凭据笔记里登录信息的同一约束。
- **Cookie 是直接可用的会话凭证**：不像密码通常还有第二步验证，拿到 Cookie 就能冒用。所以导入表单、列表、删除都必须按凭据处理，绝不能有“查看/复制值”的入口。
- **注入依赖的链路长**：一次注入要改 adapter-kit 类型、supervisor zod schema、Python helper 三处；电脑镜像要重新构建部署后才生效（helper 在镜像里）。旧镜像的电脑会拒绝不认识的命令（supervisor 的 exit 2 路径），要按“命令不认识”处理成回退而不是报错。
- **Cookie 随时可能失效**：网站可以随时让会话过期，机器人会突然回到未登录状态；这不是 bug，是 Cookie 本身的性质，流程上靠重新导出导入解决。

## 测试（实现时做，不在这篇里）

- 解析：两种格式的正常输入、空输入、坏行、Tab 在值里、HttpOnly 前缀行、`sameSite` 各取值归一化。
- 域名绑定：匹配的进、不匹配的跳过、父域后缀的边界（`evil-example.com` 不能匹配 `example.com`）。
- 过期：已过期的导入时跳过、注入时跳过。
- 加密往返：用现成的 `EncryptedSecretStore` 加密解密，换记录 id 解密失败。
- 注入：匹配域名时导航命令带上 Cookie、别的域名不带；删除后发清理命令。
- 全程只用假值（`example.com`、`"test-value"`），不出现任何真实 Cookie。
