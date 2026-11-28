# Agent Note: 四个保险库 Cookie 修复合批部署

Status: implemented

## Problem

2026-11-28 上午围绕保险库 Cookie 陆续出了四个独立修复，都基于同一基点（本地 `e2a202b`，与服务端头 `c9816370` 树相同），各在一处分支上：

1. 手机上粘贴长 Cookie 后保存按钮被顶出可视区（`fix/vault-editor-mobile-save`）。
2. 浏览器导出的原始 `name=value; ...` 格式无法直接导入（`fix/cookie-header-format`）。
3. 存好的 Cookie 在详情里永远看不到值（`fix/cookie-reveal-like-password`）。
4. 在设置 → 保险库里存了凭证，对话里挂起的登录请求卡片仍不解除（`fix/secret-ask-resolves-on-vault-save`）。

四个修复各改各的文件，本可以分四次部署；但每次部署都是一次完整镜像构建 + 拉取 + 容器重建，cue 磁盘只剩约 2.7G（95%），分开部署要反复腾空间、反复走公开库 → 构建 → 翻回私库的流程，成本高且每多一次就多一次出错面。合批一次部署是最省的走法。

## Decision

四个提交按下列顺序依次 cherry-pick 到新分支 `fix/vault-cookie-fixes-batch`（基点 `e2a202b`），各自保留原提交信息，不 squash：

1. `d1ac359` fix(web): keep vault editor Save reachable on a phone with a long cookie pasted — Cookie 框限高 `max-h-48` 内部滚动，操作行 sticky 固定底部，编辑器 Dialog 加 `max-h-[calc(100dvh-2rem)]` 可滚动。见 [2026-11-28-vault-editor-mobile-save.md](./2026-11-28-vault-editor-mobile-save.md)。
2. `0fd6170` fix(adapters): accept raw Cookie-header paste in the browser-cookie importer — 新增 `parseRawHeaderExport`，按 `;` 分段、按第一个 `=` 分名值，域名取来源 host；仅当 JSON/Netscape 解析后零条可用且内容不是 JSON 时才走此兜底。见 [2026-11-28-cookie-header-format.md](./2026-11-28-cookie-header-format.md)。
3. `33ff422` fix(vault): reveal saved browser cookies like passwords, after identity confirmation — 删掉 `vault.reveal` 对 `browser_cookies` 的 403，查看与密码同一道门（密码验证），值以 `name=value` 整份显示、可复制，30 秒自动隐藏。见 [2026-11-28-cookie-reveal-like-password.md](./2026-11-28-cookie-reveal-like-password.md)。
4. `fe5a0f3` fix(db,api,adapters): resolve a pending secret ask when the credential is saved in the vault — 保存凭证时把同站点的挂起登录请求标记为已答并让等待的 run 继续排队；`request_secret` 在已有同站点凭证时直接用，不再新开卡片。见 [2026-11-28-secret-ask-resolves-on-vault-save.md](./2026-11-28-secret-ask-resolves-on-vault-save.md)。

合并时三个文件被 git 自动合并，未出现冲突：`apps/api/src/routes/bots.ts`（第 3 项删 403、第 4 项加保存后解析调用，两处改动都在）、`packages/adapters/src/bot-secrets.ts`（第 3 项的 Cookie 解码返回、第 4 项的 `findSiteCookie`，都在）、`packages/adapters/src/bot-secrets.test.ts`（两项的新测试都在）；`apps/web/src/components/VaultSettings.test.tsx`（第 1 项与第 3 项的新测试都在）。合批后逐项核对过：403 文案已消失、保存后解析调用在、两处 bot-secrets 改动在、挂起解析入口在。

分支基点说明：服务端头 `c9816370` 的提交对象不在本机仓库里，无法直接 checkout；本地 `e2a202b` 与它树相同，按此前各批已验证过的流程，推送时以服务端 SHA 为 base，脚本按树校验，两边对得上。

## Alternatives considered

- **分四次部署** — 最强的理由：每处修复独立验证、独立回滚，出了问题定位快。否掉：四次完整部署的磁盘与流程成本太高（cue 磁盘 95%，每次都要停容器删旧镜像腾空间），且四个修复本来就是同一天同一主题的用户反馈，合批是用户可感知的“一批修好”。
- **squash 成一个提交** — 历史更干净、一次推送。否掉：丢掉每处修复的独立归属与可回滚性；以后某处要单独回退时无法只摘它。保留四提交 + 本篇合批说明。
- **用 merge commit 合并四个分支** — 保留分支拓扑。否掉：本仓库的推送工具一次推一个提交、按树校验，线性 cherry-pick 历史才是它能处理的形态；merge commit 会让推送流程多一层不必要的复杂度。

## Consequences

- 一次部署带走四个修复；服务端只需构建、拉取、重建一次。
- 四个修复的独立笔记仍在原位，本篇只记录合批这一决定，不重复它们的理由；以后改其中一处，改它自己的笔记。
- 仍不做的事：不推、不构建、不部署（由上层统一走公开库 → 构建 → 部署 → 翻回私库的流程）；不做真机/真浏览器端到端验证，留待部署后在用户手机上核对。

## Tests

合批后在分支上重跑了各修复报过的相关套件（基点 `e2a202b`，非全量）：

- `packages/adapters/src/browser-cookies.test.ts`、`bot-secrets.test.ts`、`executor-run-login.test.ts`：153/153 过。
- `packages/db/src/events.test.ts`：178/179，唯一失败是 "held instruction answers > rejects edits from another user…"，第 4 项的作者已在干净基点上复现过，属既有失败，非合批回归。
- `apps/api/src/routes/bots.test.ts`、`vault-cookies.test.ts`：25/25 过。
- `apps/web/src/components/VaultSettings.test.tsx`：22/22 过（无独立的 VaultItemDetail 测试文件，第 3 项的网页版覆盖走此文件）。
- `apps/mobile/lib/vault.test.ts`、`vault-settings.test.ts`、`i18n.test.ts`：67/67 过。

合计 445 过、1 既有失败。`pnpm verify-notes` 通过。未做类型检查全量重跑（各分支提交时已分别通过，仅有既有未动文件的报错）；未做真机/真浏览器端到端验证。
