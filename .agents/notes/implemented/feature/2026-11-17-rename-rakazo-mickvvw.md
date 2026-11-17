# Agent Note: 改名 Rakazo → Rakazo mickvvw（界面名 + 包名）

Status: implemented

## Problem

fork 要与官版 Rakazo 区分开。用户 2026-11-17 定档「界面名 + 包名全改」：看得见的 "Rakazo" 改成 "Rakazo mickvvw"（与 App 显示名一致），包名 @rakazo/* → @rakazo_mickvvw/*、根包 rakazo → rakazo_mickvvw、8 个 rakazo-* 原生模块 → rakazo_mickvvw-*。不动 deep-link scheme、RAKAZO_* 环境变量前缀、仓库名、域名、GHCR 镜像路径、Postgres 用户/库名。

摸底：21 个 @rakazo/* 包；"Rakazo" 出现在 3870 行；小写 rakazo 11995 行——全局字符串替换不可行，会动断标识符，必须按「显示名 / 包名」两类分开改。

## Decision

显示名（只改网页端可见文案与文档散文）：

- `apps/web/index.html`：`<title>` 与 `apple-mobile-web-app-title`。
- `apps/web/src/pwa/plugin.ts`：PWA manifest 的 `name` 与 `short_name`。
- 网页 Lingui 文案：Auth（"Sign in to Rakazo"、"Create your Rakazo"）、Invite/Shared/SharedConversation/PublicPageShell（"Open Rakazo"）、SignupSurvey、ModelCredits、SubscriptionGate、GitHubStarPrompt、McpOAuthCallback、SlackInstallCallback、HonchoSettingsForm、compatible-model-fields、connection-controls、use-onboarding-model、agent-import-plan、avatar-studio-popover、import-status、AccountSettingsOverlay、dictation、run-error 里的 "Rakazo" 源文案 → "Rakazo mickvvw"。改后跑 `intl:extract --clean` + `intl:compile`；新 msgid 在各语种补翻译（只换专名），`i18n-catalog.test.ts` 不新增失败。
- `packages/ui-web/src/bot-avatar.tsx` 的 `Wordmark` 文字（产品字标，未在仓库内渲染，但它是显示名）。
- 服务端产出的可见文案：`packages/core/src/run-error.ts` 的 `HOSTED_MODEL_CREDITS_REQUIRED_ERROR`（"Connect your own API key in Models or choose Rakazo credits in Billing."）与 `apps/api/src/routes/context.ts` 的 "Uses Rakazo credits" → "Rakazo mickvvw credits"；网页 `run-error.ts` 的 case 标签同步改，保持匹配。
- README/文档散文里的产品名：README.md、README.zh-CN.md、README.ja.md、docs/**、VISION.md、CONTRIBUTING.md、SECURITY.md、SETUP_PROMPT.md；只改散文，不管代码块、命令、配置示例、URL、标识符。
- `apps/api/src/app-association.ts` 的 `ANDROID_PACKAGE` → `com.rakazo.app.mickvvw`：`/.well-known/assetlinks.json` 已在 `app.ts` 挂载，部署配置了 `PASSKEY_ANDROID_CERT_SHA256` 即走到；现值与注释所指的 `apps/mobile/app.json` 包名对不上，改成 fork 的包名是纠正错误。测试期望值同步改。

包名：

- 根 `package.json` 的 "rakazo" → "rakazo_mickvvw"；21 个 `@rakazo/*` → `@rakazo_mickvvw/*`；8 个 `rakazo-*` 原生模块（file-drop、fold-regions、native-log、network-cache、notifications、pdf-view、system-float、voice-chat）→ `rakazo_mickvvw-*`。
- 全部 `@rakazo/` 引用 → `@rakazo_mickvvw/`（import、pnpm --filter、文档命令、CI、脚本、样式 import）。
- `pnpm install` 重生成 `pnpm-lock.yaml`；包目录名不动。
- 测试里对可见文案的断言随改名同步（`desktop-speech.test.ts` 的 dictation 报错文案、`avatar-studio-popover.test.tsx` 里按 "Rakazo mickvvw" 找图标集按钮）；不改测试本身的断言逻辑。

不动（边界）：

- deep-link scheme "rakazo" 与 `app.ts` 里的 "rakazo://" 白名单；RAKAZO_* 前缀；GHCR 路径；仓库名；Postgres 用户/库名；域名。
- 存储键与标识符：avatarSet "rakazo"、文件名/目录名、原生类名（RakazoFileDropModule 等）、Gradle 模块名、electron-builder 的 executableName/repo/extraMetadata name、com.rakazo.* Java 包名。
- App 端 UI 文案（mobile 的三处 `t("Rakazo")`）、桌面端 macOS 权限文案、邮件模板、营销站 www、服务端诊断信息、`.env.example` 与文档里的配置示例、CHANGELOG.md、LICENSE。
- 审计：`.agents/notes/` 里搜过 改名 / rename-rakazo / rakazo_mickvvw，无既有笔记。

## Alternatives considered

- **全量字符串替换（所有 rakazo/Rakazo 一律换掉）** — 最省事，一次跑完；否：会断 deep-link、环境变量、存储键、GHCR、仓库名，用户已明确划掉这一档。
- **只改显示名，不改包名** — 改动最小；否：用户亲口定档两档都要。
- **包名用连字符 rakazo-mickvvw** — 与 App slug 一致；否：用户原话是 rakazo_mickvvw（下划线），标识符按用户原话；显示名用空格 "Rakazo mickvvw"，与 App 显示名一致。
- **顺带改 www 营销站与邮件模板** — 一次改全；否：www 不在 fork 的部署里，邮件模板不在定档范围；改动面大、收益小，另起一事再说。
- **ANDROID_PACKAGE 不动（只记笔记）** — 路由只在配置了指纹时才返回文件；否：路由已挂载在 app.ts，部署一旦配了指纹就会走到，且现值与注释所指的 app.json 对不上；改成 fork 包名是纠正错误，不是改名附带。

## Consequences

- 新分支 `feature/rename-rakazo-mickvvw` 一个提交；提交前 `git status` 核对文件数（2418 个改动文件 + 决策笔记 1 个未跟踪文件；另 1 个未跟踪文件是 Varin 笔记，不提交）。
- `pnpm install` 后 lockfile 只含改名相关变化（除改名外只有一个 `@expo/cli` peer 后缀归一化，无版本变化）；各包解析通过，`--frozen-lockfile` 复核通过。
- `lingui extract --clean` 的 diff 只含 21 条旧 msgid 换新；21 条新 msgid 在 14 个非 en 语种全部补完翻译（只换专名）；`intl:compile` 通过，未产生新文件。
- 移动端 locale 里旧 msgid 的翻译残留（英文回退），不影响功能。
- 改名后的包名含下划线，npm 允许但少见；`pnpm install` 与测试覆盖验证通过。
- Biome 对 2317 个改动代码文件跑 `check --write`，修了 179 个文件（均为 import 因包名变长触发的换行重排）；剩余 4 warnings + 10 infos 均为 HEAD 上已有的既有问题，未修。
- 文档 diff 审过两处误改并还原：README 三处 `Rakazo-*.AppImage` 命令（桌面产物文件名未改）、`docs/self-host-billing.md` 的 `X-OpenRouter-Title` 值（代码仍发 `Rakazo`，属 wire 值）。
- 测试：网页全套 2338/2339 通过，唯一失败是既有的波兰语 "1 year"（`i18n-catalog.test.ts`，基线同款）；core 2764 通过 1 跳 0 失败（138 文件）；contracts 1011 通过 0 失败（49 文件）；api 1837 通过、2 失败、365 跳过（162 文件），2 失败是 `archived-thread-reads.test.ts` 的 threads/get 与 threads/messages（500 而非 200），已在未改动的基准提交 63591e9 临时 worktree 里复现同款 2 失败（10 通过），证实为既有问题、非改名引入；mobile 4153 通过、20 失败（348 文件），20 失败全部是既有问题：voice-settings 18 个（mock 的 `./voice-direction` 缺 `serverProviderOf` 导出，该导出在基准提交里已存在、mock 在基准里已缺失，改名未动这两个文件）、i18n 1 个（缺 Groq 朗读提示的非英语翻译）、model-settings 1 个（Ollama Cloud 排序期望）；另有 inbox-archived 1 个文件级 SyntaxError（`Unexpected token 'typeof'`，0 个用例），与上述 20 失败合计 4 个失败文件。
