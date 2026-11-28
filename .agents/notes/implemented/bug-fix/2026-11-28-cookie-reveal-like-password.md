# Agent Note: Cookie 查看——与密码一样，验证身份后可见可复制

Status: implemented

## Problem

用户把网站 Cookie 存进保险库后，详情里只能看到网站和条数，值永远看不到。2026-11-27 的 Cookie 导入决定是：`vault.reveal` 对 Cookie 项报 403，`revealBotSecret` 返回 null。用户 2026-11-28 连着问：能不能和密码一样（密码在详情里可以验证身份后查看）、可见啊、可见可复制、只是要密码验证。保险库是用户自己的存放处，值是用户自己从浏览器导出的；密码同样是可直接用的凭据却可以查看，Cookie 却不行，这个不一致让用户以为没存上。

## Decision

Cookie 项的查看与密码完全一致：同一入口、同一道门、同一复制能力。

- `vault.reveal` 不再对 `browser_cookies` 报 403；`revealBotSecret` 把存好的 Cookie 集解码后以 `VaultRevealed` 的 `fields` 形态返回，每条 Cookie 一个 field（label 是 Cookie 名、value 是值、hidden 是 true）。不新增契约变体，`fields` 在网页版和 App 都是现成的通用渲染。
- 门不变：`vault.reveal` 入口的 `requireIdentityConfirmation` 原样保留——查看 Cookie 值之前必须先过密码验证（没有密码的账号走邮箱验证码），与查看密码同一道门，不多不少，不另加确认。
- 列表接口仍只返回元数据（网站、条数、最早过期时间）；值只在显式查看这一次调用里解密返回，静态仍加密。
- 网页版详情：Cookie 项多一行 `Value`，没查看时显示掩码 + Show 按钮（与 API 密钥的 Value 行同一形态）；查看后显示全部 `name=value`（一行一条）+ 一个复制按钮，复制整份文本；30 秒自动隐藏沿用现有 `REVEAL_MS`。
- App：详情 sheet 的 Cookie 项多一行 `Value`（掩码圆点，点按触发 Show，与密码行同一形态）；点按后走现有的身份验证 + 原生提示框，提示框里列出全部 `name=value`，操作表里除逐条复制外多一个“Copy all”，一次复制整份。
- 编辑不变：编辑 Cookie 项仍从空 Cookie 框开始（重导覆盖），查看的值不进编辑表单；网页版与 App 的编辑入口本来就只对账号密码/卡片才先查看，Cookie 项不走那条路。

本篇翻转了 [2026-11-27-browser-cookie-import.md](../../implemented/feature/2026-11-27-browser-cookie-import.md) 里“Cookie 项禁用保险库的验证身份后查看明文”这一条，其余决定不变。

## Alternatives considered

- **维持永不可见** — 最强的理由：Cookie 是直接可用的会话凭证，泄露即冒用登录，比密码更危险。否掉：值本来就是用户自己持有并导出的，查看只是让主人看到自己已有的东西；密码同样直接可用却可以查看；不一致的代价已经实测——用户以为没存上。
- **`VaultRevealed` 加 `{cookies}` 新变体** — 类型上更直观；但 `fields` 在网页版详情与 App 提示框里都是通用渲染，复用它零契约改动、零新渲染分支。否掉。
- **网页版每条 Cookie 一行（照抄登录字段的渲染）** — 与密码字段一一对应；但用户明确要求整份一次复制，单行复制要逐条点。主形态改成单行 `Value` 展示整份文本 + 一个复制全部的按钮。App 提示框里保留逐条复制（操作表本来就逐条），另加“Copy all”。
- **编辑时把查看的值预填进 Cookie 框** — 与账号密码编辑一致（编辑带值、保存保留全部）；但 Cookie 框是粘贴导入框，预填等于把值放进可编辑的文本框，用户要改只能重导。编辑仍从空框开始，查看只管看与复制。否掉。
- **查看再加一道单独确认（除密码验证外）** — 更保险；但用户明确说“只是要密码验证”，多一道门就是与密码不一致。否掉。

## Consequences

- 保险库的可查看类型现在共用同一条查看路径：验证身份 → 解密 → 显示 → 复制 → 30 秒隐藏（网页版）。
- `revealBotSecret` 的 Cookie 分支与导航注入共用 `decodeBrowserCookieSet`，解码失败时抛错不回显值（现有行为）。
- 审计事件 `credential.revealed`（procedure `vault.reveal`）照旧记录每次查看，含 Cookie 项。
- 仍不做的事：列表不回值；值不进日志、工具输出、审计元数据、笔记、测试（测试只用 example.com + "test-value"）；注入路径与脱敏不变。

## Tests

- `packages/adapters/src/bot-secrets.test.ts`：Cookie 项按登录项一样以 fields 形式返回（`sessionid`、`prefs`，值均为 `test-value`）；非属主（`userId: "user-2"`）返回 null。
- `apps/api/src/routes/vault-cookies.test.ts`：原 `FORBIDDEN` 预期改为“身份验证后返回 Cookie fields”；另加非属主报 `NOT_FOUND`；原 `NOT_FOUND` 保留。
- `apps/web/src/components/VaultSettings.test.tsx`：身份验证后显示全部 `name=value` 行，复制按钮复制整份，`REVEAL_MS` 后自动隐藏。
- `apps/mobile/lib/vault-settings.test.tsx`：原生提示框操作表为 `["Copy all", "Copy session", "Copy prefs"]`；登录项的操作表也多了 `Copy all`（排在首位）。
- `apps/mobile/lib/i18n.test.ts` 随 vault 测试一起跑，覆盖新增的 "Copy all" 词条（8 个 catalog 都有）。

附带修了同一批文件里的三处旧问题：`apps/mobile/lib/vault-settings.test.tsx` 里“新建”菜单的种类预期补上 `Browser cookies`（Cookie 导入功能加了该种类却没改这处预期，基线已在失败）；另修了三处仅测试的 TS 类型错误（网页版 `VaultSettings.test.tsx` 的 textarea 断言、App `vault-settings.test.tsx` 本地 `Credential` 的 auth 形态、App `vault.test.ts` 可选的 `cookieImport`），使相关包类型检查干净。

验证：8 个 vault 相关测试文件共 222 个测试全过；`pnpm verify-notes` 通过；Biome 干净；`tsc --noEmit` 在 contracts、api、web 干净，mobile 除既有未动文件（`bot-roster`、`bottom-sheet-gesture`、`usage-detail`）的错误外干净，adapters 除既有 `pi-runtime-fallback`/`voice-factory` 错误外干净。未做真机/真浏览器端到端验证；App sheet 的 Value 行没有单独测试（sheet 在 `vault-settings.test.tsx` 里是 mock），仅由类型检查与展示流程测试覆盖。
