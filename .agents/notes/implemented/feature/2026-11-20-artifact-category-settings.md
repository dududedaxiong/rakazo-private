# Agent Note: App 制品页分类筛选 + 分类后缀与上传格式设置

Status: implemented

## Problem

App 里账户页 → 制品（`apps/mobile/app/artifacts.tsx`）现在只有搜索、全部文件 / 机器人制作分段、机器人 chips，没有按类型分类。用户 2026-11-20 要求加分类展示：压缩包、图片、影视、脚本、文档、软件（电脑软件 / 苹果软件 / 安卓软件 / 其他软件）。

定过两次靶子，都是错的：第一次我猜是画廊（`Gallery.tsx`，只显示生成的图和视频），第二次猜是网页版产物页（`/app/artifacts`）。用户两次纠正：第一次「不是画廊」，第二次发截图圈出 App 账户页里的「制品」，说「这是 app 的」。目标从此锁定 App 制品页，网页版产物页这次不动。

用户先说「各个分类的后缀类型添加更多些」，随后改主意：「或者你给我弄个其他设置，比如压缩包指定添加的后缀类，让我自己添加」，并补了一项：「对话中允许上传的文件格式」。所以这批不只做硬编码扩表，要做两块可改的设置：分类后缀（每类自己增删）与对话上传格式。

现状：

- 制品页筛选是客户端做的（`matchesArtifactQuery`，`apps/mobile/lib/artifacts.ts`），机器人筛选与机器人制作走服务端 `artifacts.listSpace` 参数。
- 分类依据只有现成的 `artifactTypeLabel`（`packages/core/src/attachments.ts`，扩展名大写，如 PY、ZIP），没有「某文件属于哪类」的共用判断。
- 上传白名单是代码写死的：`ATTACHMENT_FILE_MIME_TYPES`（contracts）与 `EXTENSION_MIME_TYPES`（core，2026-11-20 刚加了代码后缀，见 [code-attachment-types](../../implemented/feature/2026-11-20-code-attachment-types.md)）。机器人 `attach_file` 与用户上传走同一张表。
- 画廊已有分类先例（[gallery-manage](../../implemented/feature/2026-11-19-gallery-manage.md)：全部 / 图片 / 视频，客户端按 `mimeType` 过滤），但画廊只认生成的图和视频，分类逻辑不能直接复用：制品要按扩展名分，且软件要分四档。

## Decision

### 1. 共用分类函数，放 packages/core

`packages/core/src/attachments.ts` 在 `artifactTypeLabel` 旁有分类判断，供 App 与网页共用：

- 输入：文件名 + `mimeType`，外加可选的已存映射（没有就用内置默认）。
- 先按扩展名查表；扩展名不在表里时按 `mimeType` 兜底（`image/*` → 图片，`video/*` → 影视）；都对不上归「其他」，只在「全部」里出现。
- 分类：`image`（图片）、`video`（影视）、`archive`（压缩包）、`script`（脚本）、`document`（文档）、`software`（软件）；软件再分子类 `desktop`（电脑软件）、`apple`（苹果软件）、`android`（安卓软件）、`other`（其他软件）。
- 内置默认表（用户设置没存过时用，设置页也用这份做种子）：
  - 图片：png、jpg、jpeg、gif、webp、bmp、svg、heic、heif、avif、tif、tiff、ico
  - 影视：mp4、mov、webm、mkv、avi、wmv、mpg、mpeg、3gp、flv、m4v、ts
  - 压缩包：zip、rar、7z、tar、gz、tgz、bz2、xz、zst、cab、jar、war
  - 脚本：py、js、mjs、cjs、ts、tsx、jsx、sh、bash、zsh、go、rs、java、c、h、cpp、rb、php、swift、kt、lua、pl、sql、css、scss、vue
  - 文档：txt、md、pdf、doc、docx、xls、xlsx、ppt、pptx、csv、json、xml、yaml、yml、toml、html、rtf、epub、log
  - 电脑软件：exe、msi、deb、rpm、AppImage、run
  - 苹果软件：dmg、pkg、ipa
  - 安卓软件：apk、aab、xapk
  - 其他软件：iso、img、vhd、vhdx
- 归类取舍：CSS/SCSS 算脚本（要改的代码），HTML 算文档（标记文本）；音频（mp3、wav 等）不进任何分类，只在「全部」里，用户没要音频分类，不擅自加。

### 2. 设置存服务端，按空间一份

- 分类映射与上传白名单存在服务端空间设置里（`SpaceMiscConfig`，见下），第一次读不到时用内置默认种子；App 与网页读同一份，换手机不丢。
- 新 RPC 取 / 存这两份设置；设置页改完立即保存，不用另点保存按钮。
- 强制规则：`.env` 始终不允许上传，写死在校验里，不进可改的表（防密钥泄露）。
- 上传格式默认 59 个后缀（png、jpg、jpeg、gif、webp、bmp、svg、mp4、mov、webm、pdf、txt、md、csv、html、json、xml、yaml、yml、toml、sql、zip、doc、docx、xls、xlsx、ppt、pptx、py、js、mjs、cjs、jsx、ts、tsx、mts、cts、sh、bash、zsh、css、scss、go、rs、java、c、h、cpp、cc、hpp、rb、php、swift、kt、kts、lua、pl、ini、cfg）；没有已存设置时走旧的代码白名单，老 App 不受影响。

### 3. App 制品页与网页产物页都加分类筛选

- App（`apps/mobile/app/artifacts.tsx`）：机器人 chips 下加一排分类 chips（复用现成的 `Chip`），横向滚动；点「软件」再展开一排细分：全部软件、电脑软件、苹果软件、安卓软件、其他软件。
- 网页（`apps/web/src/pages/Artifacts.tsx`，2026-11-20 20:55 用户确认两个都要）：加一排分类 chips，同样九类 + 软件细分，读服务端已存的分类映射，与现有筛选（搜索、按机器人、按日期、全部文件/机器人制作、卡片/列表视图）叠加。
- 分类筛选与搜索叠加，都是客户端过滤已加载的页；分类筛空时沿用搜索已有的自动翻页逻辑（有下一页就继续拉，直到有匹配或拉完）。
- 空态文案按分类显示（这个分类下还没有东西）。

### 4. App 与网页设置页

- 新画面「杂项设置」：上半是每类后缀（chips 点 × 删除，输入框 + 添加）；下半是「对话可上传格式」，同一套编辑器。
- 入口待用户定：首选制品页右上角齿轮；备选账户设置里加一行。效果图已给用户确认，待回话。
- **图标（2026-11-20 20:58 用户亲口：记得带图标，不要格格不入）**：网页菜单入口用 SlidersHorizontal，与邻居同款式（text-muted-foreground、strokeWidth 1.75），不与「设置」的齿轮撞；App 账户页那组本来没有行图标（settingsLink 渲染的 SettingsRow 都不带 leading），杂项设置行跟邻居一样不带，硬加反而格格不入；杂项设置页里每类带对应图标（照 artifacts 列表已有的文件类型图标）；分类 chips 有图标位就带，没有不硬加。
- **入口已定（2026-11-20 20:45–20:50 用户亲口 + 截图，App 位置 20:57 用户改主意）**：设置页叫「杂项设置」；App 端放在账户页「AI 数据共享」后面（`apps/mobile/app/(settings)/account.tsx`，Vault/Wallet/Integrations/Skills/Memory/Messaging/AI data sharing 那组数组的最后一项之后，做该组最后一行；之前定的「通知设置上面」作废）；网页端放在账户菜单获取移动应用上面（`apps/web/src/components/SidebarFooter.tsx`，`Get the mobile app` 按钮上面）。
- **图标（2026-11-20 20:58 用户亲口「记得带图标，不要格格不入」，按各处现有惯例）**：网页账户菜单每项都有 lucide 图标，杂项设置入口带 SlidersHorizontal，与邻居同款式（text-muted-foreground、strokeWidth 1.75），不用设置的齿轮；App 账户页那组本来就没有行图标，杂项设置行跟邻居一样不带；杂项设置页里每类带一个对应图标（照 artifacts 列表已有的文件类型图标来）；制品/产物页的分类 chips 有图标位就带，没有就不硬加。

## Alternatives considered

- **只把硬编码表扩充，不做设置**：最强理由是改动最小，当天就能上。否决：用户亲口改主意要自己加后缀；硬编码以后每次加后缀都要改代码走发布。
- **设置只存 App 本地**：最强理由是不用动服务端，当天就能上。否决：重装 App 就丢，网页版读不到；用户在网页与 App 两边都验东西，设置两边不一致会再报问题。
- **上传白名单按机器人分**：最强理由是不同机器人能传不同格式。否决：用户要的是对话里统一的上传格式，没提按机器人分；多一份维度多一份维护。
- **分类筛选走服务端查询参数**：最强理由是大数据量下翻页准。否决：制品页搜索与机器人筛选已有客户端过滤 + 自动翻页的现成模式，分类跟着走同一套即可，不用改 `artifacts.listSpace`。

## Consequences

- App 制品页点分类只显示该类文件；点软件细分只显示该档软件；分类与搜索可叠加；分类筛空时沿用搜索的自动翻页逻辑。
- 网页产物页同样有分类筛选（2026-11-20 20:55 用户确认两个都要）。
- 设置页每类后缀可增可删，对话上传格式可增可删，改完立即保存；重进 App 设置还在。
- 上传格式改完后，对话上传与机器人发文件都按新表走；`.env` 无论如何传不上去。
- 用户把 `.exe`、`.apk` 这类可执行文件加进上传白名单后，对话就能传可执行文件：这是用户自己实例的决定，设置页只拦 `.env`，不替用户拦别的。
- 旧文件按新映射当场重分类，不做数据迁移；用户改了某类后缀后，同名旧文件可能换类，这是设置本身的语义，不是 bug。
- App 打包要用户点头（EAS 额度），代码推完不等于用户手机上能用；汇报时分清「代码好了」与「装到手机的包好了」。
- 文案 id 注意：「Videos」这个英文 id 已被画廊占用（中文「视频」），制品分类的影视一档用「Film and video」（中文「影视」），App 与网页一致，避免改动画廊的翻译。
- 分类筛选的匹配逻辑只有一份：`packages/core` 的 `matchesArtifactCategory`，App 的 `lib/artifacts.ts` 与网页 `Artifacts.tsx` 都直接用它。

## Testing

- 单测：contracts schema 7 例、core 附件 62 例（含分类器与匹配器）、db 12 例、API 路由 5 例、adapters 22 例、App lib 10 例、网页杂项设置页 4 例 + SidebarFooter + Artifacts 39 例合跑全过。
- tsc：core、contracts、db、api、web 全过；adapters 与 mobile 各有已核实的基线错误（voice-factory.ts 2 处、usage-detail/bot-roster 7 处，本批未碰的文件）。
- Biome 全过；`pnpm verify-notes` 全过。
- 未测：真机截图（本环境无浏览器/模拟器，效果图与窄屏溢出只做了代码自查）；服务端部署后、App 打包后的端到端验收待用户。

## Commits

- `fc23e4f` feat(contracts)：杂项设置 schema 与 RPC
- `bc7319a` feat(attachments)：办公/容器 MIME 与已存上传列表校验
- `41899d3` feat(db)：SpaceMiscConfig 表与设置读写
- `dcf97f5` feat(api)：杂项设置 RPC 与已存上传列表校验
- `84b341f` feat(mobile)：制品分类筛选与杂项设置页
- `67ee9ca` feat(web)：产物分类筛选与杂项设置页（含共用 `matchesArtifactCategory` 抽到 core）
