# Agent Note: Cookie 导入表单文案乱码——新字符串没进翻译目录

Status: implemented

## Problem

Cookie 导入功能部署后（服务端 sha-ec4348fd），用户在手机网页版和 App 上都看不到保险库表单的两种模式：模式按钮和 Cookie / UA 字段的标签显示为 6 位乱码（`P3ytlx`、`DmCwTD`、`30XQ-_`、`jfScC6`、`MKnUmq`、`hgU7Qd`、`SVqNZa`、`HZy_Dy`），认不出哪个是 Cookie 模式。桌面端网页实测同样乱码。

根因是翻译目录没跟上代码。功能实现见 [2026-11-27-browser-cookie-import.md](../feature/2026-11-27-browser-cookie-import.md)，它加了一批新文案，却没跑 `lingui extract`，也没往 App 手工维护的翻译表里加条目：

- 网页版用 Lingui macro：`t\`…\`` / `<Trans>` 在编译时按文案内容生成短 hash ID（`generateMessageId`），`lingui extract` 没跑过，`src/locales/*/messages.po` 里根本没有这些条目，运行时查不到翻译就直接渲染裸 ID。逐个核对过，每个乱码都精确对应一条新文案：`P3ytlx` = `Account and password`、`DmCwTD` = `Cookie / UA`、`30XQ-_` = `Cookies`、`jfScC6` = `Paste the exported cookies`、`MKnUmq` = `User-Agent`、`hgU7Qd` = `Imported {0} cookies`、`SVqNZa` = `{count} cookies`、`HZy_Dy` = `Browser cookies`。
- App 用手工维护的 `apps/mobile/lib/locales/*.ts`：新 `t("…")` 同样没进表。App 的 `translate()` 缺键时回落英文原文（不渲染乱码），但仓库自己的完整性测试（`apps/mobile/lib/i18n.test.ts` 里“translates every mobile chrome t() id in every non-English catalog”）因此挂掉，跑出来缺 16 个 ID。

## Decision

只补翻译，不改任何行为。分支 `fix/cookie-import-i18n`，自 `6438578`（与服务端头 `ec4348fd` 同树）起一个提交：

- 网页版：跑仓库自己的工作流 `pnpm intl:extract`（`lingui extract --clean`），15 条新文案进全部 15 个语种的目录；`zh-CN` 与 `zh-TW` 填真实翻译，其余语种留空 `msgstr`（Lingui 标准状态：编译时回落英文原文，比原来渲染裸 hash ID 好）。两处模式标签按要求定死：`Account and password` → `账号密码`，`Cookie / UA` → `Cookie/UA`。
- App：17 个 ID 进全部 8 个手工目录（`zh`、`zh-TW` 填真实翻译；`ru`、`de`、`nl`、`ja`、`es`、`pl` 填英文原文——与 `translate()` 缺键回落完全一致，只是让完整性测试通过；等有人翻译再换）。17 个里 11 个是 Cookie 导入的，另 6 个是同一轮测试报出的同类缺口（4 条本地流量文案 + `Anthropic Messages（经 chat-completions 转译）`），顺手补上，测试才变绿。
- App 模式标签改键：两个分段控件原来用 `t("Login")`，但 `Login` 是共享键，同时是保险库条目种类标签（`lib/vault.ts` 的 `vaultKindLabel`，必须保持“登录信息”）。只改两处模式标签为 `t("Account and password")`（`vault-item-editor.tsx`、`secret-ask-sheet.tsx` 各一行），种类标签不动；网页版本来就用 `Account and password`，不用改。

验证：`lingui compile` 后读编译产物，之前乱码的 ID 在 `zh-CN` 里全部解析成中文（`P3ytlx` → `账号密码`、`DmCwTD` → `Cookie/UA`、`hgU7Qd` → `已导入 {0} 条 Cookie` 等）；`zh-TW` 同样。测试：`apps/mobile/lib/i18n.test.ts` + `vault.test.ts` 47 个全过（之前完整性测试挂 16 个缺 ID）；`apps/web/src/components/VaultSettings.test.tsx` + `i18n-activate.test.ts` 全过；Biome 干净。

## Alternatives considered

1. **只填 `zh-CN` 网页目录，不跑 extract、不动 App**。最强的理由：改动最小，正好对上用户报的问题。不用：App 的完整性测试会继续挂（它扫描全部 `t()` ID、要求 8 个目录都有）；其余语种的新文案仍渲染裸 hash ID，而跑一次 extract 就能让它们回落英文。extract 是仓库自己的工作流，输出就是该进的。
2. **把 `Login` 的中文翻译改成“账号密码”，不动 App 代码**。最强的理由：零代码改动。不用：`Login` 是共享键，种类标签和模式标签共用它；改了它，所有登录信息条目的种类名会跟着变成“账号密码”。改两处调用点的键才是最小的正确修法。
3. **给新文案加显式稳定 `id:`，不用 hash ID**。最强的理由：ID 可读，再也不会出现 hash 乱码。不用：全库都用文案作 ID、hash 生成是既定模式，只给一个功能开特例是分裂；真正的缺口是没跑 extract，不是 ID 方案，换 ID 也要改调用点加目录，同样的工作量还没修到点上。

## Consequences

- 网页版文案随服务端部署生效（编译进 app 镜像）；App 版文案要等下一次打包才进包。`1.0.42` 里本来就没有 Cookie 功能，这次也不在包里。
- 以下失败是改动前就有的，本次没动，不是我引入的（都在改动前基点上复现过，失败内容一字不差）：
  - `apps/web/src/lib/i18n-catalog.test.ts` 2 个：波兰语目录里两条无关文案（图片生成判断、条目多选复数）本来就是空翻译。
  - `apps/mobile/lib/vault-settings.test.tsx` 1 个：种类列表期望里没有 `Browser cookies`——Cookie 功能加了种类，测试期望没跟上。
  - `apps/mobile/lib/ask-card.test.tsx` 与 `secret-ask-sheet.test.tsx` 收集失败：`__DEV__ is not defined`（Expo 模块在根 vitest 配置下缺全局量）。
- 残留疑问：手机网页版报告里用户名/密码标签的乱码 `eR2QvS` / `3X8x6S`，我能想到的候选文案（`Username`、`Password` 及登录表单其他字段）算出的 ID 都对不上；且 `Username` / `Password` 在 `zh-CN` 目录里早有正确翻译。很可能是小屏幕上看错的转录，部署后需在真机上再核对一次。
- `zh-TW` 已填；其余语种仍是英文原文占位，等有人翻译再换。
