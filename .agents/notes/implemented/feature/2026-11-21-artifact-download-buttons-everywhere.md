# Agent Note: 制品/产物所有类型都有下载按钮

Status: implemented

## Problem

用户 2026-11-21 要求：制品/产物不管什么类型都要有下载按钮。调查确认的缺口：

- 网页产物页：详情页页眉的 Download 按钮八种预览类型都有，缺的是列表——行视图（`ArtifactRow`）与卡片视图（`ArtifactCard`）都只有悬停显示的删除按钮，点进详情才能下载。
- 网页画廊：预览弹窗有下载，格子（`GalleryTile`）没有逐个下载，只能点开预览或长按多选打 zip。
- App 制品页：列表行（`ArtifactRow`）无下载/分享；详情页只有图片/视频有下载，音频、压缩包、脚本、文档、软件、纯文本只有分享（`artifact.tsx:270-277` 明文写着非媒体“never show Download”）。
- App 画廊：格子无逐个下载，点按进详情、长按多选。

下载路径本身不用新造：网页端已有 `downloadArtifactBytes` / `downloadArtifact`（`apps/web/src/lib/artifact-open.ts`）；App 端详情页已有 `saveGeneratedMedia`（`apps/mobile/lib/media-folders.ts`），它按 mime 分流到图片/视频/文件三个文件夹，不是相册专用——非媒体类型走它一样是“存到设备上”，不用另接画廊的 SAF 导出那条重路。

## Decision

五处都加下载按钮，复用已有文案与已有下载路径，不新增文案：

1. 网页产物页行与卡片：每行/每卡加一个下载图标按钮，放删除按钮旁边。下载走详情页同一条路——`rpc.artifacts.getById` 取内容、`decodeArtifactBase64`、`downloadArtifactBytes`（不用 `downloadArtifact(target, …)`：列表项的 target 要拼 bot/group，拼错会在服务端吃 `IsolationError`；`getById` 是空间级读取，不用 target）。桌面沿用悬停显示，窄屏（`max-md`）下载按钮常显——触屏没有悬停，只做悬停才显示等于没有。失败时在页面的错误行显示 `Could not download {name}. Try again.`（画廊已有的文案）。
2. 网页画廊格子：每格右上角加下载图标按钮，与选中勾同一位置、选中模式下隐藏。下载走画廊已有的 `downloadArtifact(target, …)`（格子已算好 `target`，与预览弹窗同一条路）。按钮是格子按钮的兄弟节点，不是嵌套——点下载不触发打开预览。桌面悬停显示，窄屏常显。
3. App 制品页列表行：每行末尾加下载图标按钮（`NativeSymbol` 的 `square.and.arrow.down` / `download-outline`，与详情页同一图标）。点它直接下载，不进详情；嵌套在行 `Pressable` 里的内层 `Pressable` 只触发自己，不会冒泡进详情。`downloadMobileArtifact` 在制品页是点按时才动态 `import("../lib/artifact-open")`，不在屏挂载时静态引入——`artifact-open` 会拉进原生文件系统模块，而 `bot-profile.test.tsx`（唯一引入制品屏的测试）不 mock 它，静态引入会让整个测试文件在 jsdom 里以 `__DEV__ is not defined` 载入失败。画廊屏本来就静态引入 `artifact-open`（图片预览要用），不用改。
4. App 详情页：下载按钮扩展到所有类型。`saveGeneratedMedia` 本来就按 mime 分流（非图片/视频进“文件”文件夹），`download` 回调不用改；只改门：`showDownloadButton = isMedia && showDownload !== "0"` 改成内容就绪且 `showDownload !== "0"`。机器人设置 `showDownload: "0"` 关掉时仍不显示（从聊天打开的媒体详情开关语义不变）。失败提示从 `Could not save media` 换成已有的 `Could not save {name}. Try again.`——前者对非媒体类型是错文案，后者画廊已在用，不新增文案。
5. App 画廊格子：每格右上角加下载图标按钮，选中模式下隐藏（勾占那个角）。点它直接下载该项，不进详情。

三处 App 列表/格子下载共用一个新 helper `downloadMobileArtifact(artifactId)`（`apps/mobile/lib/artifact-open.ts`）：`getArtifactById` → `writeArtifactCacheFile` → `saveGeneratedMedia`，返回文件名。放 `artifact-open.ts` 而不是各屏各写一份：详情页已经是“取内容、写缓存文件、存进分类文件夹”这三步，列表与格子只是没有现成的缓存文件，所以共用同一条路。`artifact-open.ts` 本来就从 `lib/artifacts.ts` 引值（`ARTIFACT_DOWNLOAD_TIMEOUT_MS`），`artifacts.ts` 对 `artifact-open.ts` 只有 `import type`——类型导入编译期擦除，不产生运行时循环。

不在本批范围：压缩包内单个文件的逐个下载（只下整个包现状保留）；对话消息里的产物卡片。

## Alternatives considered

- 网页列表下载走 `downloadArtifact(target, …)`：否掉。`artifacts.get` 的 bot 目标要求行 `groupId: null`（`apps/api/src/routes/content.ts`），群组产物用 bot 目标会吃 `IsolationError`；拼 target 得先分群组优先还是 bot 优先——服务端语义是群组优先（移动端 `artifactThreadTarget` 已是群组优先，网页画廊的 `artifactTarget` 还是 bot 优先， latent 不一致但画廊只列机器人媒体所以没爆出来）。`getById` 是空间级读取，根本不用拼 target，详情页已在用。
- App 非媒体下载走画廊的 SAF 导出（安卓 Download/Rakazo 文件夹、iOS 分享面板）：否掉。那条路是为“多选打 zip”设计的（一次选文件夹授权、写 zip），单文件下载用它要多一次授权流程；而且 iOS 那边它走分享面板，用户明确说了下载不要只调分享面板。`saveGeneratedMedia` 直接把文件拷进 App 自己的 Rakazo/文件 文件夹，与图片/视频落点一致。
- App 详情页下载失败仍用 `Could not save media`：否掉。门一开，非媒体类型也会走到这句，文案就是错的；换成画廊已有的通用句，不新增翻译。
- 网页窄屏也沿用悬停显示：否掉。触屏没有悬停，按钮永远点不到；`max-md:opacity-100` 与页面已有的窄屏断点一致（返回按钮与最大化按钮已用 `max-md`）。

## Consequences

- 网页产物页列表行与卡片、画廊格子在窄屏上常驻一个下载按钮：行视图右侧留白从 `pe-10` 加到 `pe-20`（两个 24px 图标按钮 + 间距），卡片底部行窄屏加 `max-md:pe-20`。桌面视觉不变（悬停才显示）。
- App 详情页的 `isMedia` 只剩分享逻辑在用（非媒体永远显示分享）；`showDownloadButton` 不再看 mime。`showDownload: "0"` 的开关语义不变。
- `downloadMobileArtifact` 是 App 侧单文件下载的唯一入口；详情页的 `download` 回调仍走自己的三步（已有缓存文件在手，不用再取一次）。
- 画廊格子与制品列表行的下载是单文件直存，不走多选的 zip 路；超过 500 MB 的多选限制不适用于单文件下载（单文件上限是附件 10 MiB 的 RPC 体）。

## Tested

- `apps/web/src/pages/Artifacts.test.tsx`：新增 3 个测试——卡片下载（点下载调 `getById` + `downloadArtifactBytes`，不打开详情）、索引窗格行下载（详情里点行下载不离开详情）、列表下载失败显示错误行。
- `apps/web/src/pages/Gallery.test.tsx`：新增 2 个测试——格子下载（点下载调 `downloadArtifact`，不打开预览）、格子下载失败显示错误。
- `apps/mobile/lib/artifact-open.test.ts`：新增 2 个测试——`downloadMobileArtifact` 把 pdf 存进 `Rakazo/文件`、图片存进 `Rakazo/图片`，均不调分享面板。
- 六个相关测试文件共 66 个测试全过（`bot-model-pools` 三处见下、Artifacts、Gallery、`artifact-open`）。Biome 干净。
- 全量 `apps/mobile/lib` 套件：4135 通过 / 22 失败，失败集中在 6 个未动的文件（voice-settings、settings-sheet、model-settings、account-screen、bot-profile、inbox-archived），与基线一致。其中 bot-profile 有两段历史：①本批最初的静态引入曾让它整文件载入失败（`__DEV__ is not defined`），已改成动态引入修好；②它另有 5 个失败是旧问题——测试的 `./artifacts` mock 缺 `matchesArtifactCategory` 导出，而制品屏自产物分类功能起就调它，已用改动前代码复核：同一 5 个失败，不由本批引起。
- 未在真机上点过下载按钮；未跑桌面 Playwright（按仓库规矩，e2e 走 CI）；三个改动的 App 页面（`artifacts.tsx`、`artifact.tsx`、`gallery.tsx`）没有现成的测试文件，下载路径由 `artifact-open.test.ts` 覆盖。

## Follow-ups in the same batch

### 主池空了显示全空（已做）

主池被清空、备用池还有模型时，设置页把两池都显示成空，只是显示不对，链路本身还能读到备用池。根因：`parseBotModelList([])` 与 `parseBotModelList(null)` 都返回 null，所以 `splitBotModelPools` 里 `if (!main) return { mainPool: null, backupPool: null }` 在主池清空时把已存的备用池也丢了。

两处都改，缺一不可：

1. `packages/core/src/bot-model-pools.ts` 的 `splitBotModelPools`：`backupRaw` 是数组时（两池数据行的标志，写路径保证备用列恒为数组，即使空），直接按存储读两池，不再因主池为空提前返回；`backupRaw` 为 null 时才走旧的 legacy 拆分（首条进主池、其余进备用池）。
2. `packages/db/src/repos.ts` 的 `mapBot`：legacy 单模型回退条件从 `!translationPools.mainPool` 收紧为 `!mainPool && !backupPool`。否则回退会把 legacy 列里镜像的值（写路径把合并列表首条镜像进 `translationModelProvider/Id`；主池空时那就是备用池首条）复活进主池，主池显示备用首条、且与备用池重复。回退的本意只是“从未写过列表的旧行”，备用池非空即说明写过两池列表。其他家族（视频/图片/编辑）在 `mapBot` 里没有这个回退，只靠第 1 处修复。

已核实的调用方安全性：翻译链（主池 + 备用池；两者都空才走 legacy 单模型）、`bots.ts` 测试翻译模型（`primary = mainPool[0] ?? legacy 单个`，行为不变）、`bot-media-generation.ts` 的 `botModelPoolEntries`（视图字段缺失读存储拆分）、`bots.ts` 更新路由的既有池合并（旧代码把已存备用池算成 null，新代码算成真实列表，只影响旧客户端单模型改动时的前置列表，更正确）。写路径（`bots.ts` 更新路由）主池空时写 `Prisma.DbNull`、备用列恒写数组、legacy 列镜像合并首条——这些是修复成立的前提，已核实。

测试：`packages/core/src/bot-model-pools.test.ts`（主池 `[]` 或 null + 备用有模型 → 主 null、备用保留；两池都空 → 双 null）、`packages/db/src/repos.test.ts`（经 `listBots` + 模拟 Prisma：主空 + 备用有模型 + legacy 列镜像 → `translationMainModels` 为 null、`translationBackupModels` 为备用；两列都 null + legacy 单个 → 回退仍生效）、`apps/web/src/lib/bot-model-pools.test.ts`（服务端发主 null + 备用有模型 → 显示主 []、备用保留）。三处 31 个测试全过。

### 视频失败没原因（未做，留给单独一批）

视频失败目前只有「视频生成失败」四个字、没具体原因；图片失败已能显示原因（共用中文摘要 `summarizeMediaRunError`）。已核查：原因不在任何现有数据结构里，从现有 run/轮询数据里取不到，不动接口做不了。

- 提供方层就把原因丢了：智谱异步轮询 `pollAsyncVideo` 在任务状态 FAIL 时只返回 `{ status: "failed" }`，上游响应里的错误详情从没读过；fal 提供方的 `poll` 解析了 `error: z.unknown()`，但只判真假、内容直接丢掉。
- 共享契约里没有原因字段：`MediaVideoJob` 的 failed 变体只有 `{ id, status: "failed", modelSwitches? }`；各提供方 `pollVideo` 实现也只返回状态。
- 工具层不传原因：`generateMediaFromTool` 在视频失败时调 `options.onSettled?.(tx, "failed")`，不传原因，返回值 `{ jobId, status }` 也无 error；`pollMediaVideo` 的 `onSettled` 里明文写着“A video poll returns no reason, so the row only says it failed; the wake follow-up carries the same. Never invent a reason.”
- 存下来的记录里也没有：job 行 `result` 只有 provider/jobId/modelSwitches；run 的 `error` 列是通用句 "Media generation failed."。图片能显示原因是因为图片生成是同步调用、错误直接返回；视频是异步提交 + 轮询，失败原因在提供方任务状态里，现有轮询接口没把它带回来。

要做就得动接口：`MediaVideoJob` failed 变体加原因字段、各提供方 `pollVideo` 把上游任务状态里的失败信息带回来（须先确认智谱等上游任务查询接口到底返回什么失败信息，目前未核实）、`generateMediaFromTool` 的 settle/`onSettled` 签名改成能传原因、`pollMediaVideo` 的失败消息改用它，再加各层测试；上游原始错误文本还要过 `summarizeMediaRunError` 那套“不回显 key 片段”的处理。属于轮询接口/响应结构改动，工作量留给单独一批评估，本批不做、不拖下载按钮这批。


### 下载落到设备共享目录（2026-11-21 跟进，本批的后续）

用户要求：下载要落到电脑/手机上。网页端已经是真的浏览器下载（blob + `a[download]`，进浏览器下载目录，不用动）；App 端之前是存进 App 自己的私有文件夹（`Paths.document` 下的 `Rakazo/图片|视频|文件`），手机文件管理器里看不到。

改法（App-only，服务端无变化）：

- 新增 `apps/mobile/lib/gallery-export.ts` 的 `exportSingleFile(bytes, fileName, mimeType)`：安卓走 SAF，复用画廊打 zip 同一个授权目录（`GALLERY_EXPORT_DIR_KEY`，第一次下载还没授权时走同一套授权流程，只问一次），单文件与 zip 平放在 `Download/Rakazo/`，不再分图片/视频/文件子目录；同名文件加 ` (2)`、` (3)` 后缀去重（与 `saveGeneratedMedia` 同一套命名规则），不像 zip 那样替换已有文件。失败映射沿用 `GalleryExportError`（`cancelled`/`write_failed`）。
- 新增 `apps/mobile/lib/artifact-open.ts` 的 `saveDownloadedFile(sourceUri, mimeType, name, settings?)`：安卓走 `exportSingleFile`（动态引入 `gallery-export`，不污染静态模块图），返回去重后的真名与显示路径；用户在文件夹选择器里点返回时返回 null（不弹错）；iOS 没有共享 Download 目录，保持现状（`saveGeneratedMedia` 进 App 的 Documents，文件 App 里可见）。
- 三处用户下载动作都改走它：`downloadMobileArtifact`（列表行与画廊格子）、详情页 `download`（`app/artifact.tsx`）、图片全屏查看器 `download`（`image-artifact-viewer.tsx`）。四个调用点在取消时直接返回，不弹“保存失败”。
- 不动的：`share-card-media.ts` 调 `saveGeneratedMedia` 是生成分享卡图片，不是用户下载；网页端不动；视频播放器本身无下载按钮。

测试：`artifact-open.test.ts` 新增 3 个（安卓走共享目录且不调分享面板、去重后名字原样返回、取消返回 null；既有 2 个 iOS 路径测试保留，默认平台改为 iOS）；新增 `gallery-export.test.ts` 6 个（单文件写盘、两次去重、取消、`write_failed` 映射、zip 同名仍替换）。相关三文件 38/38 过；Biome 干净。

### 保存目录改成设置项（2026-11-21 再跟进，取代上节的写死目录）

用户改主意：不要写死 Download/Rakazo，杂项设置里加一行「保存目录」，默认 Download/Rakazo，用户能改。网页端不做——不是另起一批，是浏览器控制保存位置，App 不用管（用户 2026-11-21 13:18 亲口：电脑端是浏览器控制，不用管）。

改法（App-only，服务端无变化；上节的下载落点逻辑不动，只把“写死目录”换成“设置里的目录”）：

- 设置入口：杂项设置页（账户页 AI 数据共享后面那个入口）最下面加一行「保存目录」，显示当前目录，点它用 SAF 文件夹选择器改目录（复用画廊导出那套授权机制，但能选任意目录，不只 Download/Rakazo）。复用已有文案 `Save directory`（中文「保存目录」），不新增翻译。行只在安卓显示：iOS 没有共享 Download 目录，设置项不适用。
- 存哪：不进服务端同步的杂项设置。SAF 授权是跟设备的，同步到别的手机会失效；存的就是授权本身——画廊导出已有的 SecureStore key（`GALLERY_EXPORT_DIR_KEY`），改目录就是换授权。设置页只负责显示与改，不另建存储。
- 生效范围：下载动作与画廊 zip 本来就读同一个 key，改完设置下一次下载/打 zip 就进新目录，不用另写生效逻辑。默认仍是 Download/Rakazo：没选过时行显示默认，第一次下载走原有授权流程。
- 显示诚实：行上显示的是所选目录的设备路径；所选目录不在主存储时（例如 SD 卡），`safDisplayPath` 取不到路径，新增 `safFolderLabel` 取文件夹名兜底——行绝不能把已选的目录显示成默认。
- `prompt-template-files.ts` 新增 `storedExportDirectory`（读已存授权）与 `pickExportDirectory`（改目录专用、每次都弹选择器，取消返回 null 不报错）；`safExportDirectory` 的读授权改走前者。`gallery-export.ts` 新增 `downloadDirectoryDisplay`（行显示用）与 `pickDownloadDirectory`（行点选用）及默认常量 `DOWNLOAD_DIRECTORY_DEFAULT`。

否掉的：

- 另建一个 key 只给单文件下载、zip 留在原目录：否掉。用户说的“同一个地方”就是同一个目录；两个 key 会让设置行与 zip 落点各说各话，改设置改不到 zip。
- 把目录选择存进服务端同步的杂项设置：否掉。SAF 授权跟设备，换手机后存的 URI 在新设备上无效，同步过去是坏数据。
- iOS 也显示一行、点开走文件夹选择器：否掉。iOS 没有共享 Download 目录，选了也写不进去；保持现状（Documents，文件 App 里可见）。

测试：`prompt-template-files.test.ts` 新增 6 个（`safFolderLabel` 主存储路径、SD 卡文件夹名、不可解 URI；`storedExportDirectory`/`pickExportDirectory` 记住授权、取消不改旧目录）；`gallery-export.test.ts` 新增 4 个（没选过显示默认、已选显示所选、改目录返回新标签、取消返回 null）。相关三文件 48/48 过；Biome 干净。
- 全量 `apps/mobile/lib` 套件：4202 通过 / 27 失败，失败集中在 6 个未动的文件（voice-settings 17、settings-sheet 1、model-settings 1、account-screen 2、bot-profile 5、inbox-archived 1），与基线一致——本批改动前先跑过同一套件复核：其余 5 个文件 22 个失败 + bot-profile 5 个失败，数字对得上，无新增回归。
- 未在真机上点过设置行（无安卓真机/模拟器）；杂项设置页本身没有测试文件，行由 lib 层测试覆盖。
