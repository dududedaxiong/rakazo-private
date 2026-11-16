# Agent Note: 对话分享：分享卡与回放链接

Status: implemented

## Problem

对话只能导出文件，没法像发一张图、发一条链接那样分享给别人看。

## Decision

借鉴 dsh-Go 的设计（只借鉴设计，不搬代码，AGPL-3.0），按分享卡 → 回放链接 → 分享前脱敏的顺序做，网页版先行：

- **分享卡**：一条 AI 回复生成一张 1080px 宽竖版 PNG，网页端 canvas 绘制，预览与下载共用同一套版式。样式可调：三预设（墨黑/米白/宣纸）、背景色/文字色/辅助色、字号 14–26px、宋体/黑体切换、恢复默认；背景支持上传本地图片（FileReader 读 dataURL，不上传服务器）加透明度 0–100%（默认 35%）。文字卡是文字加当前模型；图片卡是图加说明加提示词加模型；视频卡用运行时截的封面帧加播放标记加时长。入口在回复 hover 菜单的「做成分享卡」，提问取该回复上方最近一条用户消息，可开关。
- **回放链接**：对话导出成带版本号的规范格式（v:2、kind:conversation、schema:1），条目是 user/reply/tool，带相对时间戳 t、模型名、媒体名；公开只读页 `/s/<slug>-<token>` 按原始时间轴回放（播放/暂停、1×/2×/4× 变速、进度拖动），不用登录。链接 token 是 32 随机字节 base64url（43 字符），行上只存 sha256，原文封进 Secret 表供主人再次复制链接；过期默认 30 天，可选 1/7/30/365 天或永不过期；撤销是置 revokedAt，恢复是清 revokedAt，同一链接复活。公开读取每 IP 每分钟限 120 次，no-store/noindex，任何打不开的 token 一律 404。
- **分享前脱敏**：服务端建快照前用 `redactShareText` 脱敏——sk-/rk-/pk- 密钥、GitHub token、JWT、私钥块、Authorization 头、secret 赋值、JSON secret 字段、用户主目录路径、App 存储路径；Markdown 里的图片只留 alt 文字。快照只存文本和媒体名，不存 artifactId 与 URL，查看页不外链取图；媒体元数据里的本机路径不带出去。
- **E2E 加密不做**：分享服务器就是自己的服务端，内容本来就在库里；真要防的是分享内容里别带密钥和路径，脱敏才是关键。以后往第三方托管再补 E2E（AES-256-GCM，密钥放链接 #k= 片段里）。
- **回放页不复用 MessageView**：它依赖登录态、机器人、翻译与操作回调；回放页只用 ChatMarkdown 渲染回复文本，用户消息按纯文本渲染，工具步骤只显示 label 与 note。
- **App 端分享卡**：隐藏 WebView 加 canvas 绘制，复用 mermaid-webview 的先例（postMessage 回传 PNG data URL，15 秒超时；CSP 只允许 data: 图片、禁止一切外部请求）。版式计算（plan）与网页共用同一套 core 代码（`planShareCard` 的位置字段 questionY/questionDividerY/mediaY/bodyY/footerDividerY/footerY 由 core 一次算出，网页 canvas 与 App WebView 脚本都按这套坐标画；宽度估算 `estimateShareCardTextWidth`：CJK 宽字符 1em、拉丁字母数字 0.6em、空格 0.3em、其余 ASCII 0.5em，另加 6% 裕量）。入口在消息长按菜单（iOS context menu、Android 长按表、无障碍动作）的「分享卡」行，只对有文字或生成媒体的 AI 回复出现；提问取该回复上方最近一条用户消息（复用 thread-regenerate 的 previousUserMessageText），可开关。样式与网页同一套：三预设、颜色（每项取三预设的值做色点，不做任意取色器）、字号 14–26、宋体/黑体、恢复默认；背景上传本地图（expo-image-picker 选图，只读 data URL，不上传）加透明度 0–100%（默认 35%）；样式每次打开回默认，与网页对话框一致，不持久化，背景图只留当次打开。图片卡用 artifact 缓存的本地文件读 data URL；视频卡用 expo-video-thumbnails 在 1 秒处截帧，时长用 expo-video 的 useVideoPlayer 读（与网页读 `<video>` 元素 duration 同理）。PNG 保存到 App 本地 Rakazo 文件夹（复用 saveGeneratedMedia，图片目录，重名加序号后缀），再走系统分享（expo-sharing 的 shareAsync）发出去。
- **App 端回放链接**：调已有的 shares RPC（shares/list、shares/create、shares/revoke、shares/restore），过期默认 30 天（1/7/30/365/永不过期），撤销/恢复同一链接；链接走 RN Share.share 发出去，也可复制（expo-clipboard）；App 内不做回放页，对方在浏览器里看。入口：1:1 对话进机器人菜单（头像点的菜单）的「分享对话」行；群聊进群设置页（头栏已满，不加图标）。
- **App 端脱敏**：复用 packages/core 的 share-redaction（shareCardContentFromMessage 里已脱敏），App 不另写规则；卡片媒体只带画面和文字，不带 artifactId 与 URL。

## Alternatives considered

- **只导出文件，不做链接** — 已有对话导出；但文件要对方下载打开，分享体验差。
- **链接直接指向原对话** — 最简单；但原对话要登录才能看，且没有脱敏，密钥会跟着出去。
- **一开始就上 E2E** — 最安全；但在自己服务器上收益小，先上会拖慢分享卡和回放链接的落地。
- **分享卡用 SVG 转图片** — 排版与 canvas 相当；但 canvas 与预览共用一套绘制代码，下载即所见，少一套实现。
- **撤销即换 token** — 泄露后更彻底；但恢复就要发新链接，撤销/恢复来回折腾。复活同一链接更符合「关掉再打开」的直觉。
- **App 卡片用原生截图库（view-shot 之类）** — 要装新依赖、另起一套渲染；WebView 加 canvas 复用网页绘制代码与 core 版式，零新截图依赖，只多一个 expo-video-thumbnails（视频截帧官方包）。
- **App 里也做回放页** — 要在 App 内复刻公开回放页；对方点链接本来就在浏览器里看，App 内做等于重复实现，不做。
- **App 颜色任意取色器** — 网页有 `<input type=color>`；App 没有原生取色器，自定义取色轮是重型实现，三预设色点够用。

## Consequences

- **收益**：分享卡一键生成 PNG，能发到微信/QQ；链接免登录回放，过期与撤销生效；分享出去的内容没有密钥、没有本机路径（规则命中的部分）。
- **代价与已知上限**：脱敏只能挡住规则命中的内容，自然语言里的隐私拦不住；链接泄露等于内容泄露，token 再长也一样；思考正文与工具调用详情没进 v1——思考没有以文本形式持久化进 Message，工具调用详情在事件里不在消息行里，投影事件是后续工作；回放页只渲染文本与媒体名，不播图片与视频原文件。
- **App 端已做**：分享卡（长按菜单）与回放链接（机器人菜单/群设置），与网页同一套样式、同一套脱敏、同一套 RPC。
- **App 的取舍**：颜色只给三预设色点（网页是任意取色器）；样式与背景图每次打开回默认、不持久化（与网页对话框一致）；视频封面固定 1 秒处截帧（网页取到一半处）；卡片渲染依赖 WebView，15 秒无回包算失败，可重试。
- **App 回放链接要等服务端部署**：分享接口在新镜像里，部署被 cue 磁盘满挡住，服务器仍跑旧镜像；部署完成前 App 调 shares RPC 会失败，分享卡（本机渲染加保存）不受影响。
- **公开页的边界**：回放页不带登录态、编辑、删除；超 1000 条的对话只留最新 1000 条，并在快照里记 range。

## Verification

- 新测试 33 个全过：contracts 分享格式与 token 工具 4 个、core 脱敏 9 个与快照 4 个、web 分享卡纯函数 10 个、api 创建/列表/撤销/恢复/公开读 6 个；另有 chat-header 与 transcript 相关测试 21 个全过。
- tsc：contracts、core、db、api（除 2 处既存 voice-factory 错误）、web（除 2 处既存 GroupPanel/bot-panel 测试夹具错误，Bot 字段在 HEAD 已有而夹具没跟上）均通过；迁移只加一张表，Prisma validate 通过。
- 未实测：PNG 下载的实际落盘、视频封面截帧、公开页在浏览器里的回放（无真机/无部署，均只在单元测试与类型检查层面验证）。
- **App 端**：新增测试 19 个全过——WebView 渲染输入/脚本/消息解析 7 个、媒体解析与保存 5 个（含视频封面复用已下载文件 1 个）、回放链接状态 5 个、时长格式 1 个、长按菜单 1 个；连同从网页移入 core 的分享卡 16 个与 media-mark 9 个，相关 53 个全过。mobile lib 全套：3 个失败文件、20 个失败测试、4164 通过（基线是 3 个失败文件、20 个失败测试、4147 通过；多的 17 个全是新增且全过；i18n 只剩基线 2 条 Groq 缺口，新文案 34 条已补进 8 个目录）。mobile tsc 0 错、core tsc 0 错（修了 media-mark.test.ts 导入缺 `.js` 后缀 1 处）；Biome 在改动文件上干净（locale 与 web 两个重导出文件的既存问题在 HEAD 上就有，没动）。verify-notes 三线全过（13 篇）。
- **App 端回归修过两处**：ShareConversationSheet 静态 import expo-clipboard 会让 import group-settings 的测试在收集期崩（expo-modules-core 读未定义的 `__DEV__`），改成点按时动态 import；group-settings 导入 sheet 后又拖进 BottomSheetShell 的原生模块链，bot-member-picker.test.tsx 按该文件既有做法把 ShareConversationSheet 整个 mock 掉。
- **App 端未实测**：PNG 在真机上的实际落盘与系统分享、视频封面截帧、回放链接在真机上创建、长按菜单与两个 sheet 的真机交互（均只在单元测试与类型检查层面验证）；回放链接还要等服务端部署——分享接口在新镜像里，cue 磁盘满拉不下来，部署完成前 App 调 shares RPC 会失败。
