# Agent Note: App 画廊与影图编辑模型设置

Status: implemented

## Problem

网页版画廊管理已上线（服务端 3fffb336），App 没有对应能力：

- App 现有 `/artifacts` 是通用文件列表（顶栏「全部文件 / 由 Bot 创建」+ 按 Bot 筛 + 搜索，长按直接弹删除确认），没有分类、排序、多选、批量保存、重命名。用户要在 App 里有与网页版相同的画廊，入口放在聊天快捷卡片那里、备份卡片后面。
- App 机器人设置「其他模型」组里已有图片/视频生成模型、提示词预设、触发词，但没有图片/视频编辑模型栏。服务端 `Bot.imageEditModels` / `videoEditModels` 已在 3fffb336 上线，App 侧读不到也改不了。
- App 预览里重新生成只有一个 ↻ 按钮（图片预览 `image-artifact-viewer.tsx`、视频预览 `app/artifact.tsx`），两种意图混在一起：细节修改（图生图，走编辑模型）与随机生成（文生图，走预设模型）分不开；点完也没有双模式入口，编辑模型没配时也不会提前提示。网页版双模式已在 3fffb336 上线（`media.regenerate` 的 `mode` + `referenceArtifactId`），App 要同步。
- 触发词两栏在 App 里其实已在位（见 Proposal §3），但标签没有中文翻译，渲染出来是英文；用户以为缺失，本次一并补翻译并核对默认值。

相关（网页版已落地，本篇是 App 端的对应实现，不改网页版决定）：[画廊管理](./2026-11-19-gallery-manage.md)、[影图重新生成双模式](./2026-11-19-media-two-modes-async-regenerate.md)。

## 用户定版（2026-11-19）

- **zip 保存位置**：手机本地下载目录下的 `Rakazo` 目录（`Download/Rakazo/`），不写进 `Documents/Rakazo/文件/`——那是 App 内部保存目的地，zip 是导出到手机下载目录。Android 走现有 SAF 导出机制（`lib/prompt-template-files.ts` 同款：首次弹系统 picker 选/建文件夹，授权存 SecureStore，后续直接写）；iOS 没有共享下载目录，走分享表。
- **触发词同步网页版**：字段已在位，只补两个中文标签，随下一包一起上；默认值与网页版一致（视频「生成视频|生成一段视频」、图片「生成图片|画一张|画一幅」）。
- **命名同步网页版**：重命名走服务端 `artifacts.rename`，App 改的名网页可见、网页改的 App 可见；范围按 Proposal §2，在 artifact 预览操作菜单全局加「重命名」，不只画廊。
- **画廊卡片实时值**：按效果图，显示最新一条生成媒体的相对时间（如「2 小时前」），无内容时「暂无生成」；总数不显示（`listSpace` 不回 total）。用户看图未提异议，按此做。
- **影图重新生成双模式与网页版同步（2026-11-19 用户补）**：App 预览里的单个 ↻ 换成细节修改 / 随机生成两个入口，与网页版同一套语义、同一条服务端契约，不另起设计。

## Decision

### 1. 入口：快捷卡片，备份之后（写死）

- `apps/mobile/components/thread/thread-composer-chips.tsx` 的 `chips` 数组末尾、`backup` 之后加 `gallery` 卡片；`ComposerChip` 的 `id` 联合类型加 `"gallery"`；`onPress` 直接 `router.push("/gallery")`（与电脑、例行任务卡片同款，不用新增 prop）；图标在两处 `NativeSymbol` 三元里加 `gallery` 分支（iOS SF Symbol / Android Ionicons 各一，与现有卡片同套）。
- 卡片 live value 不显示总数：`artifacts.listSpace` 出参只有 `{items, nextCursor}`，没有 total，数总数要翻完整页，不值得。取而代之显示最新一条生成媒体的相对时间：`listSpace({madeByBots: true, sort: "date-desc", limit: 60})` 取首条经 `isGeneratedMedia` 过滤的 `createdAt`，用 `artifacts.tsx` 已有的 `formatActivityRelativeTime` 渲染；无内容时显示「暂无生成」。`limit: 1` 不可用：首条可能是非生成媒体的 Bot 文件，时间就错了。与语音/电脑/例行任务卡片同款，在 `ThreadComposerChips` 现有的 `useEffect` 里顺手取。
- 快捷行只有 `botId` 与 `currentBot` 在位时才渲染（现有守卫不变），画廊卡片同款；无 Bot 的群聊/空白态不出现。

### 2. 画廊页：新路由 `/gallery`，不动 `/artifacts`

- 新建 `apps/mobile/app/gallery.tsx`，并在 `app/_layout.tsx` 里注册 `Stack.Screen`（照 `artifacts` 的 `glassHeaderOptions(t("Gallery"))`，标题「画廊」）。`/artifacts` 是通用文件列表，保持不动；画廊是生成媒体专用视图。
- 数据源与网页版一致，走服务端 `artifacts.listSpace`（`lib/artifacts.ts` 已有 `listSpaceArtifacts`；分页 `PAGE_SIZE = 30` + cursor，`limit` 上限 60；`sort` 参数直接传服务端，游标方向服务端已处理），客户端过滤 `name` 以 `generated-` 开头 + `mimeType` 为 `image/*` 或 `video/*`（与网页版 `Gallery.tsx:54-57`、`madeByBots: true` 同一条规则）。**不要另起本地扫描**：App 的 `Documents/Rakazo` 文件夹（`lib/media-folders.ts`）只是保存目的地，本地扫会与服务端列表冲突——已删的还在、改名对不上、多设备不同步，且用户在网页改的名字只存在服务端。
- 功能与网页版逐项对齐（分类 全部/图片/视频、排序按钮四态循环、日期排按天分组/大小排平铺、长按进多选、选中打 zip 保存到本地、删除先确认、预览里重命名），细节见下：
  - **分类**：顶栏三个 tab，按 `mimeType` 在客户端过滤；切换分类重置分页回第一页；与网页版一样不建新查询键。
  - **排序**：一个按钮点着切，`日期 ↓`（默认）→ `日期 ↑` → `大小 ↓` → `大小 ↑` → 回到 `日期 ↓`，不做下拉菜单；切换排序重置分页并清空已选。组头文案与网页版实测一致，用斜杠格式（`今天 · 11/19 · N 项` / `昨天 · 11/18 · N 项`），不是 `11月19日`。
  - **长按进多选**：复用 `Pressable onLongPress`（`artifacts.tsx` 已有长按删确认的写法；`react-native-gesture-handler` 已在依赖里，但现有写法已够用，不另引手势）；500ms 计时 + 松开/滑动取消与网页版一致；选择模式下长按改切换勾选；底栏 `已选 N 项` + `保存到本地` + `删除` + `取消`。注意 `/artifacts` 的长按仍是删除确认，两页行为不同——分属两个路由，不冲突。
  - **保存到本地**：选中逐个 `getArtifactById` 取字节（已有，120 秒下载超时），`core` 的 `zipFiles`（fflate，已在 `core` 依赖里、App 已引 `core`）打一个 `rakazo-gallery-<日期>.zip`；Android 走 SAF 写进手机本地下载目录下的 `Rakazo` 目录（`Download/Rakazo/`，复用 `lib/prompt-template-files.ts` 的 SAF 导出机制：首次弹系统 picker 让用户选/建文件夹，授权存 SecureStore，后续直接写；重名先删旧文件再写，同款 `writeSafFile` 做法；zip 字节用 base64 编码写入，具体调用按 `expo-file-system/legacy` 的 StorageAccessFramework 实际接口定）；iOS 没有共享下载目录，走分享表（同文件已有 `exportViaShare`）；写完弹 `已将 {name} 保存在本地`（复用 `artifact.tsx` 的单文件保存反馈文案，路径用 SAF 解出的实际路径，如 `Download/Rakazo/rakazo-gallery-20261119.zip`）；总大小上限 500 MB，先校验、超了报错（与网页版同值）。`bytesToBase64` 目前是 `lib/voice.ts:1021` 的局部函数，抽到共享处（`lib/artifact-file.ts` 或 `core`），不复制第二份。注意：不要写进 `Documents/Rakazo/文件/`——那是 App 内部保存目的地（`lib/media-folders.ts`），zip 是导出到手机下载目录。
  - **删除**：先弹确认，标题 `删除 N 项？`，正文 `删除后服务器上的文件无法恢复，请先保存到本地。`（与网页版同一份中文），确认后逐个调已有 `lib/artifacts.ts` 的 `removeArtifact`；失败单项留选中态并报错（与网页版同款）。
  - **重命名**：`lib/artifacts.ts` 加 `renameArtifact`（`rpc("artifacts/rename", {artifactId, name})`，契约已在 `packages/contracts`，出参 `{ok: true, name}`，服务端校验见已上线笔记：空名、纯扩展名、含 `/` 或 `\`、超长报 `AttachmentValidationError`）；预览复用 `app/artifact.tsx`（路由 `/artifact?artifactId=`，已有分享/重新生成/下载/删除），在操作菜单里加「重命名」，输入框复用 `components/profile-edit-dialog.tsx` 的 `useTextEditDialog`（iOS 用 `Alert.prompt`，Android 用小对话框，跨平台已解决）。改名后若新名不再以 `generated-` 开头，该项从画廊消失（与网页版同一条过滤规则）。
- 新字符串补进全部 8 个 catalog（`zh.ts` + `zh-TW` / `ru` / `de` / `nl` / `ja` / `es` / `pl`）：`i18n.test.ts` 要求每个 `t()` id 在每个 catalog 里都有翻译，「其余 locale 留空」会让该测试变红；其余 7 个是新译的中文以外译文，未经母语者校对：`Gallery` → 画廊；`Save to device` → 保存到本地（底栏按钮；与网页版同一份中文）；`Delete {count} items?` → 删除 {count} 项？（App 的 `t()` 只做 `{var}` 插值，不做 Lingui 复数，标题用这一条）；底栏计数沿用 App 已有 `"{count} selected"` → 已选 {count} 条，不另造「已选 N 项」。

### 3. 影图编辑模型：加进「其他模型」分组，按网页版排布

- 位置：`app/bot-settings.tsx` 的 `SettingsGroup label={t("Other models")}` 内，顺序与网页版 `bot-settings-sections.tsx` 的 `Media model` 组一致：视频生成模型 → 视频提示词预设 → 视频触发词 → 图片生成模型 → 图片提示词预设 → 图片触发词 → **视频编辑模型 → 图片编辑模型**，再往后是翻译模型行。编辑模型两栏放在媒体块尾部（图片触发词之后、翻译模型之前），不插到生成模型与预设之间；App 的「其他模型」组里翻译行在媒体行之后，组尾是翻译不是编辑栏。
- 形态：复用本文件的 `OrderedModelList`（`kind` 复用 `"video"` / `"image"`；`label` 用 `t("Video edit model")` / `t("Image edit model")`；`testable`，测试复用 `bots/testMediaModel` 生成探针、**不传 `presetPrompt`**——编辑不走预设，网页版同款近似探针；「设为主用」同款）。新增 `videoEditModels` / `imageEditModels` state + 载入（`bot.imageEditModels ?? []`）+ 保存 diff（`bots/update` input 已含两字段，`contracts/domain.ts:682-684`）+ dirty 判断；默认空，不预设、不硬编码模型 ID（用户后续自己在设置里安排，与网页版一致）；备选只在编辑列表内走，失败不降级成重画（服务端已保证，App 只传字段）。
- 「添加视频备选」「添加图片备选」沿用 `OrderedModelList` 按 `kind` 出的同一文案（两组列表共用，不另造「添加视频编辑备选」）。
- `bot-settings.tsx` 用完整 `Bot` 类型读 bot，字段已在契约里；`MobileBot` 是收件箱列表用的精简 Pick，编辑模型不需要进列表，不用改。
- 触发词：已在位（`375d92d` 引入，state/载入/保存/输入框全套在「其他模型」组里，默认值走 `contracts` 的 `DEFAULT_VIDEO_TRIGGER_WORDS` / `DEFAULT_IMAGE_TRIGGER_WORDS`，即「生成视频|生成一段视频」「生成图片|画一张|画一幅」，空串存 `null` 回默认——与网页版一致）；本次只补两个标签的中文翻译（`Video trigger words` → 视频触发词，`Image trigger words` → 图片触发词）+ 核对，不新增字段。用户装的 1.0.32 是旧代码所以看不到，随下一包一起上。

### 4. 影图重新生成双模式：细节修改 / 随机生成（与网页版同步）

网页版已上线（`2026-11-19-media-two-modes-async-regenerate.md`），App 跟同一套语义、同一条服务端契约（`media.regenerate` 的 `mode?: "edit" | "random"`，缺省 `random`；`referenceArtifactId?`），不改服务端。

- **入口**：图片预览（`components/image-artifact-viewer.tsx`，GlassIconButton 行）与视频预览（`app/artifact.tsx`，顶栏 + iOS 26 `unstable_headerRightItems`）里的单个 ↻ 换成两个按钮：**细节修改**与**随机生成**；构建期间两个都变灰防重复点。§2 说的「预览已有重新生成」即指这两处，换成双模式后单按钮不再保留。
- **细节修改 = 图生图**：只传补充提示词（不拼原提示词和预设），走机器人配的编辑模型（§3 的 `imageEditModels` / `videoEditModels`），失败不降级成重画。**随机生成 = 文生图**：原提示词 + 预设 + 补充提示词，走预设模型，全新随机一张/一条。提示词拼法在服务端（`media.ts` 已实现），App 只传 `mode`，不自己拼。
- **编辑对话框**：点细节修改时先读已存的补充提示词（`media/getSupplementaryPrompt`）；图片且补充提示词非空时直接开始改，图片且为空时弹对话框让用户填；视频每次都弹对话框——视频编辑还要上传一张参考图（对话框里加「选择参考图」，走 `lib/pick-attachments.ts` 的 `pickFromLibrary` 取一张已预处理的图，再走 `rpc("artifacts/create", {botId, name, mimeType, contentBase64, clientNonce: "reference:<artifactId>:<uuid>"})` 上传，上传图优先于服务端抽的首帧）。对话框里补充提示词为空时提交不可点；视频没选参考图时提交不可点。
- **未配编辑模型**：点细节修改前先查机器人（`rpc("bots/get", {botId})`，读 `imageEditModels` / `videoEditModels` 字段）：该类型编辑列表为空就弹提示，文案说清还没配编辑模型、按钮跳机器人设置「其他模型」（`router.push("/bot-settings", {botId})`）。服务端同样会拦（`BAD_REQUEST`「这个机器人还没有配置编辑模型……」），调用失败走到同一条提示做兜底。
- **异步**：两者都是异步（点完即回 `queued`，对话显示「正在生成图片…」/「正在生成视频…」，结果到了自动出现）；App 侧点完弹 `Regenerating…`（沿用现有单按钮的反馈），新文件到了按下文处理（图片预览换成本地新图、视频预览切到新版本）；失败走 `showModelErrorAlert` 带原因 + 重试（沿用现有单按钮的失败路径）。
- **消息操作行的重新生成不动**：查过，`message-row.tsx` 的 `onRegenerate` 是整轮重发（`thread-screen.tsx` 的 `regenerate` 调 `sendUserTextAgain` 重发上一条用户消息），不是影图重新生成；网页版删了那条链是网页版的事，App 的整轮重试是通用功能（没收到可用回复时不用重打字），不随本次改。
- 新字符串进全部 8 个 catalog（见 §2）：`Edit details` → 细节修改；`Generate random` → 随机生成；`Choose a reference image` → 选择参考图；`Reference image` → 参考图；未配编辑模型的提示两条（图片/视频各一）+ `Open settings` → 去设置。

### 5. 打包约束

- 代码可先合、包等 12 月 1 日 Expo 额度重置后打（mickvvw33 额度 15/15 用完）；画廊与编辑模型同属 App 包，不发服务端——服务端契约（sort / rename / edit 字段）已在 3fffb336 上线，无需再部署。

## Implementation

2026-11-19 落地，单次提交（画廊与设置各改的文件在 locale 块里交织，干净分两个提交拆不开；见下）。

### 改了什么

- 画廊：新建 `apps/mobile/app/gallery.tsx`（路由 `/gallery`，`_layout.tsx` 注册在 `artifacts` 之后）与 `apps/mobile/lib/gallery.ts`（分类/排序四态/分组/多选/zip 名/500MB 上限纯逻辑）+ `gallery-export.ts`（Android SAF 写 `Download/Rakazo/`，新 SecureStore key `rakazo.gallery_export_dir`；iOS 分享表）+ `gallery.test.ts`；`lib/artifacts.ts` 加 `renameArtifact`（`rpc("artifacts/rename", …)`）；`lib/artifact-file.ts` 导出 `bytesToBase64`/`base64ToBytes`，`lib/voice.ts` 删本地同名函数改 import；`lib/prompt-template-files.ts` 导出 `loadSaf` 与 `safExportDirectory(saf, key)`（key 参数化）；`app/artifact.tsx` 预览顶栏加「重命名」（`useTextEditDialog`，`ARTIFACT_NAME_MAX_LENGTH=255`，`rename.ask` 用 ref 托住）；快捷卡片 `thread-composer-chips.tsx` 在备份之后加画廊卡片（live value 最新一条生成媒体的相对时间，无内容「暂无生成」）。
- 设置：新建 `apps/mobile/lib/bot-model-lists.ts`（从 bot-settings 抽出 `sameModelList`/`samePresetList`）+ 测试；`app/bot-settings.tsx` 加 `videoEditModels`/`imageEditModels` state + 载入 + 保存 diff + dirty 判断，编辑模型两栏放在图片触发词之后、翻译模型之前，复用 `OrderedModelList`（kind 复用 `"video"`/`"image"`，`testable`，测试复用生成探针不传 `presetPrompt`，编辑测试用独立 `videoEditTest`/`imageEditTest` state）；触发词只补两个中文标签。
- 双模式：新建 `apps/mobile/components/media-edit-dialog.tsx`（补充提示词 + 视频选参考图）与 `apps/mobile/lib/use-media-regenerate.tsx`（共享 hook，`startEdit`/`regenerateRandom`/`editDialog`）；`lib/media-supplementary.ts` 加 `regenerateMedia(artifactId, {mode, referenceArtifactId})`（无 options 不传 mode，服务端缺省 random）、`hasEditModels`/`needsEditDialog`/`isNoEditModelError`/`uploadReferenceImage`（`rpc("artifacts/create", …)`，`clientNonce: "reference:<artifactId>:<uuid>"`）；图片预览 `image-artifact-viewer.tsx` 与视频预览 `app/artifact.tsx` 的单个 ↻ 换成细节修改 / 随机生成两个按钮，构建期间变灰；未配编辑模型时先 `rpc("bots/get")` 预检、弹提示 + 「去设置」跳 `/bot-settings?botId=`，读 bot 失败不拦截、走服务端校验；群组图片 `targetBotId` 为空时跳过客户端预检。消息操作行的整轮重发不动（不是影图重新生成）。
- iOS 截图目录：`catalog.json` files 区 screens 加 `"gallery"`，`flows/files.yaml` 末尾加 `rakazo:///gallery` 三步（等空态文案 `No generated images or videos yet` 出现再截图 `07-gallery`）；种子里没有 `generated-` 夹具，拍到的是空态。
- 附带修了一个基线夹具缺口：`bot-roster.test.ts` 的 Bot 夹具缺 `imageEditModels`/`videoEditModels`，已补 `null`。
- 单测更新：`chat-model-picker.test.tsx` 九张卡 → 十张卡（加 `"Gallery: No generated media"`）；8 个 locale catalog 各补 33 条新文案翻译（含 `Deleting…`，gallery.tsx 里用了该 id 但 zh.ts 漏了）。

### 验证结果（2026-11-19）

- 本次单测 5 文件 134/134 通过：gallery 10、media-supplementary 11、bot-model-lists 4、i18n 32、chat-model-picker 77。
- 全量 mobile vitest：4206 通过、22 失败（6 文件），失败全是基线问题，与本次无关：`voice-settings.test.tsx` 18 个（测试 mock 的 `./voice-direction` 没给 `serverProviderOf`，voice.tsx:709 调用它）、`inbox-archived.test.tsx`（文件级 SyntaxError `Unexpected token 'typeof'`）、`model-settings.test.tsx`（Ollama Cloud 顺序）、`settings-sheet.test.ts`（referral 页不在设置链接表里）、`ios-screenshot-catalog.test.ts`（6 条未覆盖路由：bot-package-export、bot-package-import、prompt-templates、referral、usage、voice-chat；gallery 已覆盖，不在其中）。
- `tsc --noEmit -p apps/mobile/tsconfig.json`：本次文件全干净；仅剩基线 6 处 `usage-detail.ts` / `usage-detail.test.ts` 的 `totalOnlyCalls` 缺失错误（文件未动）。
- Biome：30 个改动文件干净。
- `pnpm verify-notes`：三线过（tree 30、format 30、archived 0）。

### 未验证

- 无真机/模拟器截图：画廊长按手感、SAF picker、iOS 分享表、双模式对话框与按钮都只在代码层面核对过，未实拍。
- 未打 EAS 包：等 2026-12-01 Expo 额度重置后打，含第二批改动一起上。
- iOS 截图目录的 gallery flow 未实跑（本机无 Maestro/simulator）。
- 未配编辑模型的提示路径、GLM-Image 接原图、视频编辑出片、首尾帧：服务端行为未变，App 只传字段，仍待用户配好编辑模型后实测。
- 其余 7 个 locale 的新译文未经母语者校对。

## Alternatives considered

- **画廊数据源走本地 `Documents/Rakazo` 扫描**：最强理由是不用联网、打开即有。否决：本地只是保存目的地，删/改名/多设备都对不上服务端；网页改名只存在服务端，本地扫不到；用户要的是与网页版同一份画廊。
- **复用 `/artifacts` 加 `generatedOnly` 参数**：最强理由是少一个文件、分页与行组件现成。否决：两页的顶栏与行为分叉太大（Bot 筛 + 搜索 + 长按删除 vs 类型 tab + 排序 + 多选 + 批量保存 + 重命名），塞进一个文件等于两个屏；且 `/artifacts` 是通用文件列表，画廊是生成媒体专用视图，分开更干净。
- **zip 走服务端出接口**：最强理由是手机只下一次。否决：网页版已否决过同一方案（新 API + 服务端打包开销，文件已在客户端可取）；`core` 的 `zipFiles` 现成、fflate 已在依赖里，客户端打包零新依赖。
- **zip 保存走系统分享表（Android 也用 Share sheet 让用户自选位置）**：最强理由是用户能直接存到文件 App。否决：Android 已有 SAF 导出机制（`prompt-template-files` 同款），一次授权后直写 `Download/Rakazo/`，比每次弹分享表少一步；iOS 没有共享下载目录，只能走分享表（不在此列）。
- **编辑模型栏插到生成模型与预设之间（视频编辑紧跟视频生成）**：最强理由是成对出现、找得快。否决：与网页版排布不一致；网页版把两栏编辑统一放组尾，App 跟网页版走，用户两边看到的顺序一样。
- **画廊卡片 value 显示总数**：最强理由是一眼看到有多少。否决：`listSpace` 不回 total，数总数要翻完整页；最新一条的相对时间已够用。
- **触发词另起新字段/新 UI**：否决：已在位，只补翻译。

## Consequences

- 快捷行备份卡片之后是画廊卡片，点进画廊页；无 Bot 时行不渲染（现有守卫）。
- 画廊页三个 tab 过滤正确；排序按钮四态循环且顺序真实变化；日期排按天分组（组头 `今天 · 11/19 · N 项` 斜杠格式）、大小排平铺；长按进多选、底栏三按钮工作；保存落一个 zip 到手机下载目录 `Download/Rakazo/`（Android SAF；iOS 分享表）；删除先确认；预览里能重命名；改名不以 `generated-` 开头后从画廊消失。
- 设置页「其他模型」组里视频/图片编辑模型两栏可增删排序测试，保存后服务端 Bot 字段生效；触发词两栏显示中文标签、默认值与网页版一致。
- 双模式：图片与视频预览里各有两个按钮（细节修改 / 随机生成），构建期间变灰；细节修改只传补充提示词、随机生成走预设模型；图片补充提示词为空时弹对话框、视频每次弹对话框并可上传参考图；未配编辑模型时点细节修改提示去「其他模型」配；点完回 `queued` 显示进行中，失败有原因 + 重试。
- 新字符串进全部 8 个 catalog，`i18n.test.ts` 全过。
- 预览 effect 依赖里不放新建对象（`target` 经 `useMemo` 缓存）：网页版 e2e 曾抓到裸 `t` 白屏与 effect 无限循环，App 侧同款风险点已按此处理。

## Risks

- App 包等 12 月 1 日额度重置后才能打给用户装；代码合了不等于用户手机上有。
- 长按手感只能真机验，模拟器/单测验不出 500ms 计时与滑动取消的边界。
- 画廊与 `/artifacts` 各自一套长按行为（多选 vs 删除确认），实现时别把两页的状态抄混。
- `rename` 的服务端校验（空名、纯扩展名、含 `/` 或 `\`、超长报 `AttachmentValidationError`）App 侧要透出中文错误，不要只报英文原文。
- 双模式只在两个预览里做：图片预览与视频预览的顶栏空间本来就紧，两个图标按钮加对话框是上限，不再往消息操作行加第三处入口；整轮重发（消息行 ↻）与影图重新生成是两个功能，别抄混。
