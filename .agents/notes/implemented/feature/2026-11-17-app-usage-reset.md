# Agent Note: App 用量统计一键重置

Status: implemented

## Problem

App 用量页（`apps/mobile/app/(settings)/usage.tsx`）能看今日/累计 token、近 7 天趋势、按模型与调用明细，但没有重置入口。服务端接口与网页端都已有：`authed.usage.reset` 只删调用者自己在当前空间的 `UsageRecord`，返回 `{deleted}`；网页账号设置里有 `Reset usage` 按钮加确认框。App 只是没接，同一个能力在两个端不一致。

顺带一个文案问题：网页确认框说的是 "This clears all usage in this space"（中文"将清空当前空间的全部用量"），实际只清调用者自己的记录，范围被夸大了。

## Decision

- App：只改 `usage.tsx`，在页面底部（规则说明下方）放一个红色 `Reset usage` 按钮（`NativeActionButton`，`prominence="destructive"`，`fill`）。用原生 `Alert.alert` 弹确认框（标题 `Reset usage?`，正文与修正后的网页文案一致："This clears your usage in this space — runs, tokens, cost, and per-model and per-bot records. This cannot be undone."），按钮为 `Cancel`（cancel 样式）与 `Reset`（destructive 样式）。确认后调 `rpc("usage/reset")`，成功后同时重拉 `usage/summary` 与 `usage/list`——「今日」小计是本地从 records 算的，不重拉会显示旧数。重置进行中禁用按钮并显示忙态；失败用 `Alert.alert` 显示 `Could not reset usage` 加错误原因。
- 新增 4 条 App 文案（`Reset usage`、`Reset usage?`、确认正文、`Could not reset usage`），`Reset` 与 `Cancel` 复用已有翻译；8 个非英文移动端目录（zh、zh-TW、ru、de、nl、ja、es、pl）都补了翻译，`apps/mobile/lib/i18n.test.ts` 会扫描全部 `t()` 字面量并强制各目录齐全。
- 网页：只改文案不动逻辑。确认框源文案 "This clears all usage in this space — …" 改成 "This clears your usage in this space — …"，跑过 `lingui extract --clean` 与 `compile`，zh-CN 译文同步为"将清空你在这个空间的用量——…"；其余语种留空（与 2026-11-17 自定义邀请码批次的做法一致）。
- 后端不动：`rpc("usage/reset")` 已在契约里（`packages/contracts/src/rpc.ts` 的 `usage.reset`），无需新接口。

## Alternatives considered

- **自定义底部确认面板代替 `Alert.alert`** — 没选。AGENTS.md 要求移动端能用原生控件就用原生；`Alert.alert` 已是本仓删除类确认的既定模式（`ShareConversationSheet` 的删除链接就是这么做的），再造一个面板是重复。
- **不弹确认，一点就删** — 没选。重置不可撤销；网页端也要确认，两端行为应一致。
- **顺手加管理员一键清全站的接口** — 没选。超出本次需求；服务端重置按设计就是只清自己，清全站要新开管理端接口并记审计，没人要求。
- **复用网页的 `ConfirmDialog` 组件** — 没选。那是 web 的 shadcn 组件，进不了原生 App。

## Consequences

- 用量页底部有红色重置按钮；点取消不调接口；点确认只调一次 `rpc("usage/reset")`；成功后 summary 与 list 都重拉；失败有错误提示（`apps/mobile/lib/usage.test.tsx` 4 个用例覆盖）。
- 网页确认框文案改成 "your usage"，zh-CN 译文同步；网页 `AccountSettingsOverlay.test.tsx` 25 个用例全过。
- 移动端 i18n 齐全性测试通过；`pnpm verify-notes` 通过。
- 顺手修了一个既有缺口：`voice.tsx` 用的两条 Groq 文案（"Groq only transcribes speech. …" 与 "Not supported in Chinese yet. …"）只在 zh/zh-TW 目录有译文，de/es/ja/nl/pl/ru 缺失，导致 i18n 齐全性测试在基线提交上就是红的；本次给 6 个目录补了译文，测试转绿。
- 代价与边界：重置不可撤销，且只清当前空间、只清自己；多空间要逐个清。重置只删 `UsageRecord` 展示统计，不动点数账本与消费限额（限额读的是 `payment` 聚合），与网页端行为一致。7 个非中文语种的新译文是我写的，未经母语者审过；错译只影响这几条新文案的显示，不影响功能。
- 未验证：UI 没截过图（本环境无真机/模拟器）；App 的改动要重新打 EAS 包才能到手机上。

## 「我的邀请码」App 展示（同分支后续追加，用户定为 EAS 打包前必须完整）

- 后端新增用户侧 `referral.code` 接口（`apps/api/src/routes/content.ts`，契约在 `packages/contracts/src/rpc.ts` 的 `referral` 节，响应体 `MyReferralCodeSchema` 在 `packages/contracts/src/admin.ts`）：返回当前用户唯一的专属码（码、已用/总次数、状态），没有就 lazy 补建——复用 `issueReferralCode`（随机 12 位码、maxUses 取 `referralCodeMaxUses` 当前值、不过期、`isReferral: true`，先查后建、撞唯一约束重试一次）；开关关时返回空不建。查询只按 `createdById = 本人` 过滤，接口不接受别人的用户 id，查不到别人的码。
- App：账号页加「我的邀请码」入口（与用量行并列），新页 `apps/mobile/app/(settings)/referral.tsx` 显示码（可复制，复用 `CodeCopyButton`）、已用/总次数；用完显示「已用完」。不加补发与重新生成（用户已定：专属码用完即止）。
- 入口位置调整（2026-11-18，用户定）：账号页上「我的邀请码」行从用量行下方挪到「临时文件」行下方，顺序变为用量行 → 临时文件行 → 我的邀请码行；只调换两行顺序，跳转、文案、清除逻辑都不动。随下一包生效，不在正在打的 1.0.32 里。
- 网页入口（2026-11-18，用户定）：账号菜单里「获取移动应用」下方加「我的邀请码」项（`SidebarFooter` 新 `onMyInviteCode`，图标 Ticket，始终显示、不设 billing 门槛），点后关菜单直达设置用量分区（`openSettings("usage")`），面板就在用量统计下方。入口从「设置→用量」改为菜单直达。

## 网页用量页改成 App 同款卡片+柱状图（2026-11-18，用户定）

- 网页 `UsageSettingsPanel` 照 App 用量明细页的布局重做：上方两张卡片「今日用量 / 总用量」（token 数、请求次数、输入/输出），中间「近 7 天」柱状图（每天一根柱子、标数值、今天高亮），下方「按模型统计」卡片（模型名、token 数、请求次数、输入/输出、占比条）。不用新图表库，柱状图纯 div 实现。
- 取数不改接口：今日用量从 `usage.daily` 里取当天那条；总用量用 `usage` 本身（默认全量，范围切换时跟随范围）；近 7 天从 `usage.daily` 取最近 7 个本地日期（缺失补 0）；模型卡片用 `usage.models`。范围切换（1/7/30 天/全部）与重置按钮、确认框原样保留；用量分区下方的 `ReferralCodeSettingsPanel` 不动；机器人表格原样保留。
- 柱状图防重叠规则（与 App 同一条）：数值标签在柱子轨道之外，柱子高度按轨道高度缩放，最高柱也不得顶到标题（App 那边 89.4万 压标题就是这么修的）。
- 代价与边界：旧的三格统计（Runs/Tokens/Cost）与「Daily cost, last year」热力图、模型表格被新布局取代，费用（Cost）不再在用量页上显示——App 的用量页本来就没有费用栏，照参考设计走。模型卡片没有 App 那种点开看最近调用的展开（网页没拉 `usage/list`，不补取）。
- 测试：`AccountSettingsOverlay.test.tsx` 的用量用例改写为断言两张卡片、7 根柱子（柱高都不超过轨道 100%、最高 100%）、模型卡片与占比条宽度；`SidebarFooter` 与移动端相关用例照旧。随下次服务端部署上线，不在昨晚已部署的版本里。

## App 用量页柱状图数值标签压标题（2026-11-18，用户手机截图实证）

- 问题：最高那根柱子（11/12，89.4万）的数值标签顶到了「近 7 天」标题上。根因：柱子高度按整列高度（92px）的百分比算，最高柱占满 92px 后再加两行标签与间距，总高约 129px，标签被顶出卡片、压到标题。
- 修法：每列里加一个 `flex: 1` 的轨道（`barTrack`），柱子高度改为按轨道高度的百分比；轨道只分标签剩下的空间，所以内容总高恒等于列高，最大值再大也不会把标签顶出去。验算：列高 92px，标签与间距约 37px，轨道约 55px，最高柱 100% 即 55px，数值标签稳稳落在卡片内。
- 随下一包生效，不在正在打的 1.0.32 里。

## 网页设置「App 下载」分组对齐（2026-11-18，用户手机截图实证）

- 问题：设置 → 通用页最下面的「App 下载」分组里，「自定义 App 下载」标题、说明、两个下载地址输入框、「保存设置」按钮都贴着卡片边，与上面数据、安全性等分组的行对不齐。
- 根因：`SettingsGroup` 的卡片本身无内边距，靠每行自带的 `px-4 py-3`（`SettingsRow`）对齐；`AdminAppDownloadSettings` 的表单是裸 `space-y-4` div，左右内边距为 0。
- 修法：表单 div 加 `px-4 py-3`，与 `SettingsRow` 一致；只动对齐，内容、行为、文案、保存逻辑都不动。随下次服务端部署上线。
- 网页：账号设置用量分区下方加 `ReferralCodeSettingsPanel`（`apps/web/src/pages/AccountSettingsOverlay.tsx`，在 `SettingsOverlay.tsx` 的用量分区里渲染），调同一个 `referral.code` 接口；显示码、可复制（复用 `useCopyText`）、已用/总次数，用完显示「已用完」；接口返回空（推广开关关时）显示暂未开放；加载失败可重试。不加补发与重新生成。
- 网页端「我的邀请码」展示也已实现，不再 deferred。
- 测试：接口 5 个用例（首次查询补建且只建一个、已有直接返回、开关关时不建只返回空、不能查到别人的码、用完返回 exhausted 状态）；App 页 4 个用例（有码显示与复制、无码状态、用完状态、加载失败重试）。
