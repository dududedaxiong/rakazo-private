# Agent Note: 底表在原生表加载时也能打开；画廊新增「其他」分类、转移与一键清理

Status: implemented

## Problem

用户 2026-11-25 在手机上（1.0.41/vc39）报了两个问题。

1. 对话页底部快捷栏四个入口点下去没反应：其他模型、收藏、背景、备份。主模型能开，只是慢；例行任务、画廊能开。根因与 2026-11-24 修过的报错详情是同一款：五个底表都在 `useNativeSheet()` 还是 `undefined`（Android 原生底表 `@expo/ui/community/bottom-sheet` 还在动态加载）时直接返回 null，点下去什么都不出现。11-24 那次只修了 `RunErrorSheetContainer`，笔记里明确写着 `BottomSheetShell` 同款 pattern「left alone here because no failure was reported on its sheets」——现在用户报的正是这些 sheet。
2. 画廊只认 `generated-` 开头的文件名（`lib/gallery.ts` 的 `isGeneratedMedia`），助手用代码出的图（如 `01_fullbody.jpg`）进不来，画廊显示「还没有生成的图片或视频」。用户先建议按后缀收纳、图片视频分开；得知后缀分不出「生成的」和截图/附件后，定版为：画廊加「其他」分类收没有 `generated-` 开头的图片/视频文件；「其他」里的文件可以转移到图片或视频；「其他」里一定要有一键清理。

## Decision

### 底表：删掉五个文件的 `Sheet === undefined` 早返回

照抄提交 `abe9e7e` 的修法，把以下五处 `if (!visible || Sheet === undefined) return null;` 改成 `if (!visible) return null;`，让 `undefined` 和 `null` 一样落到已有的 Android `Modal` 兜底（五处兜底都已写好，不用新写）：

- `apps/mobile/components/thread/thread-favorites-sheet.tsx`
- `apps/mobile/components/thread/thread-background-sheet.tsx`
- `apps/mobile/components/thread/thread-backup-sheet.tsx`
- `apps/mobile/components/thread/thread-model-picker-sheet.tsx`（主模型，顺手修打开慢）
- `apps/mobile/components/bottom-sheet-shell.tsx`（其他模型走这个壳）

原生表加载好后仍走原生表，行为与之前一致。另有三处同款 pattern（`bot-organize-modal.tsx`、`thread-bot-menu-sheet.tsx`、`thread-custom-settings-sheet.tsx`）本次不动——用户没报那几处，不顺带扩范围。

### 画廊：新增「其他」分类，转移靠重命名，一键清理先确认再删

- `GalleryCategory` 增加 `"other"`。`lib/gallery.ts` 新增 `isOtherMedia`：mime 是图片/视频、且名字不以 `generated-` 开头。`matchesGalleryCategory` 接管全部四类过滤（`all`/`image`/`video` 仍只认 `isGeneratedMedia`，`other` 认 `isOtherMedia`），画廊页不再单独调 `isGeneratedMedia`。数据源不变，仍是 `listSpaceArtifacts({ madeByBots: true, ... })`。
- 分类 tab 变成全部 / 图片 / 视频 / 其他；图片、视频、其他三个 tab 显示已加载项的计数（`全部`不显示计数）。计数按已加载的页算，翻页加载后更新——服务端 `listSpace` 不返回总数，拿不到全量计数。
- 「其他」里长按多选后，底栏多两个按钮：「移到图片」「移到视频」。点的按钮只作用于选中项里对应 mime 的子集（图片按钮只移图片，视频按钮只移视频），其余选中项留在原地。转移调已有的 `artifacts/rename`，新名是 `generated-<原名>`（服务端保留原扩展名，见 `apps/api/src/artifacts.test.ts` 的 rename 用例）；改名后本地列表同步更新名字，该项即刻离开「其他」、出现在图片/视频分类里，无需重新拉取。
- 「其他」顶栏加「一键清理」按钮（仅当「其他」有内容时出现）。点后弹确认框，复用已有的删除文案（标题 `删除 {count} 项？`，正文提醒先保存），确认后先把分页全部拉完（否则只删已加载的页，一键清不干净），再逐个调已有的 `artifacts/remove`；失败的单项报出名字，成功删除后刷新列表。
- 快捷栏画廊卡片的「最新生成时间」判定仍用 `isGeneratedMedia`（只认 `generated-`），不动——避免把截图时间算进去。
- 新文案 8 条，8 个语言包（zh、zh-TW、ru、de、nl、ja、es、pl）都补了翻译；i18n 测试要求每个 `t()` 字面量在全部非英文包里存在，缺一个即失败。

## Alternatives considered

- **底表：App 启动时预加载原生底表**：最强的理由是能直接消掉加载窗口，点下去永远是原生表。否决：import 本来就在 App 启动时开始，窗口只有毫秒级；`abe9e7e` 已确立「加载中落到 Modal 兜底」的模式，照抄只要改一个分支。
- **画廊：放宽 `isGeneratedMedia`，按后缀收全部 bot 图片/视频**：最强的理由是最简单，正是用户最初的建议。否决：后缀分不出「生成的」和截图/附件，放宽后截图和附件图全进画廊——用户明确不要。`generated-` 仍是「已生成」的标记，「其他」桶装其余的，两类分开。
- **画廊：代码出图改名 `generated-`（不动 App）**：最强的理由是零 App 改动。否决：以后每次代码出图都要记得这个命名约定，且已有的三张图仍要改名；「其他」桶不改助手习惯，现有文件直接可见。
- **转移：一个「移到已生成」按钮**：最强的理由是按钮少、实现更简单。否决：用户要的就是分别移到图片/视频；按 mime 分子集处理，视频不会被误放进图片。
- **一键清理：只删已加载的页**：最强的理由是最简单。否决：后面的页还留着，一键清不干净；先拉完分页再删才是「一键」该有的语义。
- **一键清理：不确认直接删**：最强的理由是少一步。否决：删除不可逆，画廊已有的删除都先确认；本次沿用同一确认框。

## Consequences

- 五张底表在原生表加载中也能打开（Modal 兜底），加载好后仍是原生表；主模型不再等原生表加载。
- 画廊多一个「其他」tab：没有 `generated-` 开头的 bot 图片/视频都在这里，图片、视频、其他三 tab 显示已加载项的计数；「其他」里的文件可以按图片/视频分别转移（改名加 `generated-` 前缀），转移后即刻出现在对应分类；「其他」可以一键清理（先确认，删全部页）。
- 「其他」里的截图和附件图不会进图片/视频分类；转移时只按 mime 分子集处理，选中的另一类文件留在「其他」里。
- 计数只按已加载的页算，未翻到的页不计入；一键清理会先拉完所有页再删，文件很多时需要一点时间。
- App 端改动，随下个 EAS 包才到用户手机；本次不打包、不部署。
- 仍有三处 `Sheet === undefined → null`（`bot-organize-modal`、`thread-bot-menu-sheet`、`thread-custom-settings-sheet`）未修，等用户报了再修。

## Verification

- 新测试 8 个文件、84 个用例全部通过：`bottom-sheet-shell.test.tsx` 4、`thread-favorites-sheet.test.tsx` 4、`thread-background-sheet.test.tsx` 4、`thread-backup-sheet.test.tsx` 4（各为加载中→Modal、无原生表→Modal、有原生表→原生表、隐藏→空）、`gallery.test.ts` 新增 5 个（`isOtherMedia`、`galleryRenameToGenerated`、`countGalleryCategories`、`matchesGalleryCategory` 的 `"other"`，共 14 个）；另同批跑过 `run-error-sheet-container.test.tsx` 3、`i18n.test.ts`（新文案 8 条在全部 8 个语言包里存在且插值一致）、`thread-media-model-sheet.test.tsx`，无失败。
- `native-sheet.test.tsx` 收集失败（`SyntaxError: Unexpected token 'typeof'`，34 个用例）；经 `git stash` 在干净树上复核，失败完全相同，是既有问题，与本次改动无关。
- 移动端 `tsc --noEmit`：9 个错误，与干净树基线完全一致（`bot-roster.test.ts` 1、`bottom-sheet-gesture.test.tsx` 2、`usage-detail.test.ts` 5、`usage-detail.ts` 1），本次零新增。
- `biome check`：20 个改动文件干净。
- `pnpm verify-notes`：59 篇笔记校验通过。
- 未验证：真机上的底表打开手感与画廊转移/清理（本次不打包，等用户点头打新包后手机验收）。

相关：[报错详情在原生底表还在加载时也能打开](../feature/2026-11-24-run-error-details-sheet-fallback.md)（同款根因，本次把剩余五处补齐）、[画廊管理——分类、排序、按天分组、长按多选、保存到本地、删除、重命名](../feature/2026-11-19-gallery-manage.md)（画廊分类与删除/重命名机制的来源）、[其他模型底表左滑失效与已移除模型残留备选池](../feature/2026-11-23-app-model-sheet-fixes.md)（`BottomSheetShell` 的手势容器背景）。
