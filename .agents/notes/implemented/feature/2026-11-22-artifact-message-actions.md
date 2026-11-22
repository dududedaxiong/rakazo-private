# Agent Note: 对话里产物消息的操作行改成重命名 / 下载 / 分享 / 收藏 / 打开 / 删除

Status: implemented

## Problem

对话里机器人发的产物（.py、.zip、图片、视频）下方一直是通用操作行：复制 / 朗读 / 转发 / 收藏 / 翻译 / 重载。对文件来说，复制、朗读、翻译、重载都没有意义；下载、重命名、打开、删除这些真正要用的操作反而要长按菜单或点进详情页才能找到。用户 2026-11-22 发截图要求：产物消息下方改成重命名、下载、分享、收藏、打开、删除六个图标按钮，删除替掉原来重载的位置；没有正文的产物消息才换，图片和视频也算产物。

多产物（一条消息里多个产物）当时还没设计。用户随后定：多产物删一个只去掉那一张、消息留着，最后一个删掉消息才消失。服务端当时只有整条消息删除的接口，从消息里去掉单个附件做不了。

## Decision

只换机器人发的、没有正文、带产物的消息。文件、图片、视频都算产物；带正文的消息、音频消息，操作行不变；只读历史里重命名和删除不显示，其余四个还在。

单产物：消息下方一行六个图标按钮，顺序就是重命名、下载、分享、收藏、打开、删除；删除在最右、原来重载的位置，灰底红图标。多产物：一个气泡里几个产物，每个卡片下面各跟自己的一行六颗图标，点的就是自己那张。收藏还是整条消息的收藏，任一卡片上点效果一样，所有卡片显示同一状态。

六个动作全部复用现有路径，不造新的：

- 重命名：详情页同一套 `useTextEditDialog` + `renameArtifact`，改完调一次对话刷新才显示新名。
- 下载：制品页列表同一条 `downloadMobileArtifact`，点按时动态引入（静态引入曾让 `bot-profile.test.tsx` 在 jsdom 里以 `__DEV__ is not defined` 载入失败）。
- 分享：详情页同一条 `getArtifactById → writeArtifactCacheFile → shareLocalFile`。
- 收藏：现在同一个 `actions.favorite` 开关。
- 打开：与点产物本身一致——图片进查看器，视频与文档进详情页（`onPreviewFile`），预览类型是 `none` 的才走分享面板。注意 zip 的预览类型是 `zip` 不是 `none`，所以点 zip 进详情页，和点卡片本身一样；不是分享面板。
- 顺带修了一个挡在打开路径上的旧缺口（`apps/mobile/app/artifact.tsx`）：`computePreview` 没有 `zip` 分支，打开 zip 的详情页时 `preview` 是 `undefined`，渲染到 `content.preview.kind` 就抛错——点卡片本身也一样崩。补了 `case "zip": return { kind: "unsupported" }`，详情页显示「No preview for this file type.」，头上的下载/分享/重命名/删除都在。两行，tsc 原先报的 `TS2366` 随之消失。
- 删除：先弹详情页同款确认框（`Delete "{name}"?` + `This can't be undone.`）。单产物：确认后先删消息（`threads/deleteMessage`，服务端允许删机器人消息、顺带清收藏），再删产物，最后刷新；先删消息是为了重试不被卡住。多产物：先调新接口从消息里去掉那一张，再删产物，最后刷新；最后一个删掉时走整条消息删除那条路，消息才消失。

新接口 `threads/deleteMessageAttachment`：输入 thread target + `messageId` + `artifactId`，输出 `{ ok: true, messageDeleted: boolean }`。它只做一件事：把消息 blocks 里 `artifactId` 对上的图片/文件块去掉；去掉后 blocks 为空（陈旧快照或竞态）时顺手删整条消息并清收藏，与 `deleteThreadMessage` 的清理一致。删产物本身仍由客户端随后调已有的 `artifacts/remove`。与 `deleteThreadMessage` 同一个事务选项，权限与机器人消息的约束与它对齐。blocks 经 Prisma 客户端的 content-encryption 扩展透明加解密，读写与明文时一样；不需要迁移。

图标按代码里已有的来：重命名 pencil、下载 square.and.arrow.down、分享 square.and.arrow.up、收藏 bookmark、删除 trash（destructive 红）；打开没有现成图标，用 `arrow.up.forward.app` / `open-outline`——这对图标已在 `computer-float-window.tsx` 用过，不生造。瓦片沿用 `MessageActionRow` 的 36px `ActionTile`，不接自定义排序设置（那套只认复制/朗读/分享/收藏/重载）。

机器人四个媒体显示开关（收藏/分享/预览/下载）对已生成媒体（图片、视频文件）继续有效：开关关掉的动作在行里不显示；非已生成媒体的文件（.py、.zip、文档）不受开关管，六个全显示。默认值全开，所以确认过的效果图就是默认样子。

文案零新增：六个名字和所有提示用的都是制品页 / 详情页已有的 msgid，已逐个核对过八个语言文件（`Delete "{name}"?` 等 20 条全在）。

## 实现结构

- `apps/mobile/lib/media-display.ts` 新增 `artifactActionAttachments(message)`：范围判定，返回要挂行的附件列表或 null。判定用去掉“当前模型”标记后的消息（标记本身是一个 text 块，不去掉会把带标记的已生成媒体消息误判成带正文）。
- `apps/mobile/components/thread/artifact-action-row.tsx` 新增 `ArtifactActionRow`：一行六颗图标 + 重命名对话框 + 各动作的处理。`MessageActionRow` 的 `ActionTile` 导出复用。
- `apps/mobile/components/thread/message-bubble.tsx`：附件分支里，符合范围的消息在每个附件的包装 View 里、卡片正下方渲染行（与卡片共一个包装，行与卡片之间隔 8pt）；不符合的走原来结构，一字不动。行要用的 `artifactActions`（收藏、刷新、只读）由 `MessageRow` 传下来；`refresh` 从 `thread-screen` 的 `useThreadSync` 经 `MessageRowActions`（可选字段，`useLatestRowActions` 同步透传）顺下来。
- `apps/mobile/components/thread/message-row.tsx`：符合范围的消息不渲染通用 `MessageActionRow`，`canTranslate` 同样关掉（复制 / 朗读 / 翻译 / 重载从产物消息下方拿掉）；长按菜单不动。
- `ActionTile` 与 `useActionTileColors` 从 `message-row.tsx` 挪进新文件 `apps/mobile/components/thread/message-action-tiles.tsx`，通用行与产物行共用。挪的原因：产物行若直接引 `message-row.tsx`，会把整条行（含 expo-clipboard 的复制路径）拖进气泡的依赖图，渲染真气泡的测试（`message-mention-accessibility.test.tsx`）会以 `__DEV__ is not defined` 炸掉；挪出来后气泡只依赖瓦片本身。
- 服务端：`packages/contracts/src/rpc.ts` 加 `threads/deleteMessageAttachment`；`packages/db/src/events.ts` 加 `deleteThreadMessageAttachment`；`apps/api/src/routes/threads.ts` 加同名路由。
- 测试：`apps/mobile/lib/message-row-artifact.test.tsx`（照 `message-row-resend.test.tsx` 的路子，瓦片要点得通）；`apps/api/src/thread-delete-message-attachment.test.ts`（删一张、删最后一张留空删消息、找不到附件、空间隔离）。

## Alternatives considered

- 多产物整条消息只留一行、点哪个产物先生效：否掉。重命名、删除、打开只能对着单个产物做，共用一行目标含糊；两个相同的行叠在一起也分不清各属于谁。
- 多产物删除整条消息一起删：否掉。用户亲口定了删一个只去那一张、消息留着；整条删会丢掉同消息里别的产物。
- 新接口同时删产物实体：否掉。接口只做“从消息里去掉附件”这一件事；产物实体由客户端随后调已有的 `artifacts/remove`，与单产物流程的顺序一致（先脱钩再删实体，重试不被卡住）。
- 最后一个附件由客户端判断、服务端接口不管空消息：否掉一半。客户端确实按附件数分支（最后一个走 `deleteMessage`），但服务端仍要防陈旧快照与竞态：去掉后 blocks 为空就删消息，否则会留下一条空消息。
- 行里开关全不接，六个永远显示：否掉。四个媒体显示开关是机器人主人明确关掉某些动作的设置，对话行绕过它等于把开关废了；默认值全开，效果图的样子不受影响。
- 行放 `MessageRow`、气泡下方统一渲染：否掉。多产物时行会全堆在气泡下面，分不清各属于哪张卡片；行必须跟在每张卡片下面，所以只能进 `MessageBubble` 的附件循环。
- 重命名对话框复用详情页整屏：否掉。详情页的改名就是 `useTextEditDialog` + `renameArtifact` 两步，行里直接调同一套，不用跳页。

## Consequences

- 对话里产物消息的操作行从通用行换成六颗图标；带正文、音频、用户发的消息不受影响。
- 多产物删除现在是两段式（脱钩 + 删实体），中间失败会留一个已脱钩、仍在制品列表里的产物，可从制品页再删；消息先脱钩，所以重试不会被死卡片卡住。
- `threads/deleteMessageAttachment` 是第一个改消息 blocks 的删除接口；blocks 为空时删消息的兜底逻辑以后别的块级删除也能复用。
- `ActionTile` 从 `message-row.tsx` 导出，`MessageActionRow` 与新行共用同一套瓦片；改瓦片样式只改一处。实现上瓦片住在 `message-action-tiles.tsx`，两行都从那里引。
- `MessageRowActions` 多一个可选 `refresh` 字段；不传的调用方（测试、别的入口）行为不变。

## Related

- [制品/产物所有类型都有下载按钮](../../implemented/feature/2026-11-21-artifact-download-buttons-everywhere.md)：本批的下载路径（`downloadMobileArtifact`、动态引入、制品页与详情页的复用关系）与那篇的第 3、4 条同源；那篇明确把“对话消息里的产物卡片”留给后续，就是本批。
- 效果图：单产物屏与多产物屏都已由用户确认，以它为准（不在仓库里）。
