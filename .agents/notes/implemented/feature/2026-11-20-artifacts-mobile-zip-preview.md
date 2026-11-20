# Agent Note: 产物页手机端适配 + zip 预览

Status: implemented

## Problem

网页版产物页（`apps/web/src/pages/Artifacts.tsx`）只在桌面浏览器上验过，手机上排版是乱的：选中产物时页面是固定 320px 列表栏（`IndexPane`）加预览栏（`PreviewPane`）左右并排，没有任何移动端断点；手机 390px 宽一挤，列表占 320，预览只剩几十 px，下载按钮被裁、「这种文件无法预览，请下载后查看。」竖排成一字一行；分类 chips 那行也在手机上溢出。

用户 2026-11-20 发截图报了这个问题，接着亲口定了一条规矩：以后网页改动必须同时规划桌面与移动端适配，两种视口都要出效果图确认，有列表加详情两栏的页面必须先定好移动端折叠方式，部署后要在手机浏览器上实测一遍。

同一张截图里还有第二个问题：zip 这类压缩包点开只能看到「无法预览」，包里有什么、能不能直接看，全靠下载后自己解。用户补了一句「最好支持预览文件」。

## Decision

### 1. 窄屏布局只用 CSS 断点，不加 JS 视口判断

断点取 `md`（约 768px；效果图按 640px 左右画，`md` 是仓库现成断点，`CallCard`、`AdminPage` 已在用）：

- 选中产物时，`IndexPane` 在 `md` 以下隐藏（`max-md:hidden`），`PreviewPane` 占满整宽；详情头在 `md` 以下多一个返回按钮，点后回到 `/app/artifacts` 列表（复用已有的 `maximized` 状态语义，不新加状态：窄屏下列表本来就不显示，返回即路由回列表）。
- 分类 chips 的 `ToggleGroup` 在 `md` 以下改横向滚动（`max-md:max-w-full max-md:overflow-x-auto`），不再换行挤压；`ToggleGroupItem` 本来就是 `shrink-0`，不用改。
- 列表页左右边距 `px-6` 在 `md` 以下收成 `px-4`；桌面端两栏布局、边距、卡片网格一律不动。
- 不用 `matchMedia` / `useMediaQuery`：CSS 断点零状态、零 resize 监听，桌面端渲染的 DOM 与改前完全一致。

### 2. zip 预览：中央目录只读清单，单条目现场解压

只做 `.zip`。rar / 7z / tar.gz 与 Office 文档（doc / xls / ppt）仍显示「无法预览，请下载后查看」，不在这批。

- `packages/core/src/zip.ts` 新增 `listZipEntries(bytes)`：只读 zip 末尾的中央目录结束记录（EOCD）+ 中央目录，返回条目名、未压缩大小、压缩大小、压缩方法、本地头偏移、是否目录；列清单不解压任何条目。非法签名、找不到 EOCD、Zip64 标记都抛 `ZipArchiveError`，预览区显示「无法读取这个压缩包。」。
- `apps/web/src/lib/zip-entry.ts` 新增 `readZipEntryText(bytes, entry)`：按中央目录给出的偏移读本地头、跳过文件名与扩展字段后取压缩数据；方法 0（stored）直接切片，方法 8（deflate）用浏览器自带的 `DecompressionStream("deflate-raw")` 解；再用 `TextDecoder` 解成文本。未压缩超过 1 MiB 的条目拒绝预览（「这个文件太大，无法预览。」）；加密条目（通用标志位 bit 0）与未知压缩方法同样拒绝。
- 包内「可预览的文本」按扩展名 → mime（复用 core 现成的 `EXTENSION_MIME_TYPES`）→ `artifactPreviewKind` 是 `text` 或 `markdown` 的才算；`.md` 走 `ChatMarkdown` 渲染，其余走 `<pre>`。`.html` 不算（沙箱 iframe 嵌进 zip 视图没必要）。
- `packages/contracts/src/attachments.ts` 的 `artifactPreviewKind` 增加 `"zip"`：`application/zip` 与三个历史别名（`application/x-zip-compressed`、`application/x-zip`、`multipart/x-zip`，上传时已归一化，留别名是防旧数据）返回 `"zip"`，其余不变。`ArtifactPreview` 的 `"zip"` 分支走新的 `ZipPreview` 组件（桌面端同样生效）。
- `ZipPreview` 只做三件事：当前目录的直接子项清单（文件夹可点进下一级，顶部一条面包屑回上级）、点文本条目看内容、点文本条目里的返回回清单。条目行只在可点时（文件夹、可预览文本）才显示 chevron、才可点；不可预览的文件没有 chevron、不是按钮。

### 3. 文案按仓库的极简规则收过效果图

效果图里有一句「点文件夹进下一级」和一个提示框（点里面的文本文件直接看内容、不下载整包）——这两句都是复述界面的说明文字，按仓库「不加重复界面的解释性文案」删掉；chevron 与返回按钮本身已经说明可点。保留的只有状态行（「N 个文件 · 大小」，`formatFileSize` 复用 core 现成的），以及三句必要的错误提示。新增文案全部走 Lingui，中文翻译随同一批提交。

## Alternatives considered

- **用 fflate 的 `unzipSync`（已是 core 的依赖，久经考验）**：最强理由是不用手写解析器，出错面小。否决：它要把整个包一次全解压进内存才给清单，一个 100MB 的包只为看一眼目录就要吃 100MB 内存；也没有只列目录的入口。中央目录解析约 120 行，换来的是一次只解一个条目。
- **加 JSZip 这类新依赖**：最强理由是 API 现成、容错好。否决：为 120 行解析加一个新依赖，仓库一向不这么做；且 JSZip 同样是全量解压的思路。
- **服务端加 zip 清单 RPC**：最强理由是一处实现、网页与 App 通用，且服务端解压不怕浏览器兼容。否决：预览时产物字节本来就已经到了客户端，服务端再解析一遍是重复劳动，还要新开一个 RPC 与权限面；手机 App 以后复用 core 的解析器即可，不用服务端。
- **JS 视口判断（`matchMedia` / `useMediaQuery`）做移动端折叠**：最强理由是逻辑可测、行为显式。否决：CSS 断点零状态、零监听，桌面端 DOM 完全不变；jsdom 里测不了媒体查询，测了也是测 class 名，收益低。
- **这批同时做 App 端 zip 预览**：最强理由是核心解析器已共享，顺手。否决：App 的预览面是原生实现，与网页的 `ZipPreview` 不共用；等网页这批部署验收完再单开一批。

## Consequences

- 手机上产物页列表占满整宽，分类 chips 横向滑；点产物进全屏预览，左上角返回回列表，下载按钮不再被裁；桌面端两栏布局与交互完全不变。
- `.zip` 点开直接看到包内清单，文件夹可进下一级，包内 `.md` / `.txt` / `.json` 等文本点开即看；rar / 7z / tar.gz / Office 文档仍提示下载。
- 超大 zip（Zip64、单条目超 1 MiB、加密条目）明确报无法预览，不会静默失败或卡死；解析失败只影响这一个预览，不影响列表。
- 新增文案只有状态行与三句错误提示，全部经 Lingui 翻译；效果图里的两句说明性文案已按仓库规则删掉。

## Testing

- 单测：core 的 zip 中央目录解析（含 stored / deflate 两种条目、嵌套目录、非法签名、Zip64 标记），用 `node:zlib` 现场构造测试包；web 的 `readZipEntryText`（stored 直读、deflate 经 `DecompressionStream`、超限与加密拒绝）；contracts 的 `artifactPreviewKind("application/zip") === "zip"`；Artifacts 页返回按钮导航与 zip 清单渲染。
- tsc（core、contracts、web）、Biome、`pnpm verify-notes` 全过。
- 未测：真机截图（本环境无浏览器/模拟器）；部署后需在手机浏览器上实测一遍再算完（用户 2026-11-20 亲口定的规矩）。

## Commits

- `e3b1778` docs: note artifacts mobile layout and zip preview
- `438ec49` feat(core): list zip archive entries from the central directory
- `b43f5ee` feat(web): preview zip archives inline in the artifacts page
- （移动端布局 + 测试 + 翻译，待补）
