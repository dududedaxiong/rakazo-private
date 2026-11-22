# Agent Note: App 对话视频内联播放 + 备选列表左滑移除合包

Status: implemented

## Problem

下一版 App 包要带两项，都是用户已点头的：

1. **备选列表左滑移除**（[2026-11-21-app-swipe-remove-fallback-models.md](./2026-11-21-app-swipe-remove-fallback-models.md)）只在 `feature/app-swipe-remove-fallback` 分支上，1.0.39 打包的 `feature/app-artifact-message-actions` 分支里没有。用户 2026-11-22 明确说两项合在一个包里，不然浪费一次打包次数。
2. **App 对话里的视频还是文件卡**：`message-bubble.tsx` 里附件分三路——图片走 `InlineImageAttachment` 内嵌、音频走 `AudioAttachment`、其余（含 `video/*`）走 `Pressable` 文件卡（📎 名字），要点卡片进详情页播放器、再按一次播放。网页版 2026-11-18 已做成内联播放（[2026-11-19-web-video-click-to-autoplay.md](./2026-11-19-web-video-click-to-autoplay.md)）：首帧缩略图 + 播放按钮 + 时长，点一下原地带声播放。App 没动，两边不共用这块代码。

## Decision

新分支 `feature/app-inline-video-swipe` 从 `af29fb0`（产物操作行）起，两个提交：

- ① `64acf55` 原样 cherry-pick（左滑移除，提交信息与笔记不动），无冲突——它改的文件与产物操作行那批不重叠。
- ② App 对话视频内联播放，只动 `message-bubble.tsx` 的附件渲染：`video/*` 附件改走新组件 `InlineVideoAttachment`，其余（图片、音频、其他文件）不动。

`InlineVideoAttachment` 照抄网页版 `InlineVideoCard` 的行为：

- 先经 `videoArtifactUri`（已有的服务端鉴权缓存）取本地文件 URI；加载中是名字 + 转圈的占位，取失败是名字 + `Tap to open`，点后进详情页。
- 取到 URI 后挂一个暂停的 `VideoView` 当封面：`useVideoPlayer` 建 player，首帧即缩略图；`statusChange` 到 `readyToPlay` 后读 `player.duration` 显示时长（m:ss，加载前不显示）；`videoTrackChange` 读 `videoTrack` 的宽高定盒子宽高比，默认 16:9、最高 360（与图片 `MAX_INLINE_HEIGHT` 同值）。
- 未播放时整块盖一层播放浮层（居中播放圆钮 + 右上时长角标），点一下就地带声播放；播放中浮层消失，系统控制条接管暂停 / 进度 / 全屏；暂停或播完后浮层回来。播完后 `currentTime` 已到末尾，再点播放先回到 0 再播。
- 播放器只在 URI 就绪后才挂：`InlineVideoPlayer` 用 `React.lazy` 动态引入（`video-preview.tsx` 同款写法），`ExpoVideo` 原生模块缺失时（OTA 更新落到旧包上）回落到文件卡占位，不炸。
- 机器人无正文产物消息下方的六图标操作行不动，仍跟在卡片下面；「打开」保留，进详情页 / 播放器。用户发的和机器人发的视频走同一路。

**缩略图方案**：没有服务端缩略图 URL（画廊视频格也只有播放图标占位，无取帧）。本地取帧的机制是现成的：`expo-video-thumbnails` 的 `getThumbnailAsync`（已是依赖，`share-card-media.ts` 用它给分享卡取 1 秒处的帧）。但本批不用它，选暂停的 `VideoView` 首帧当封面，理由见备选方案。

**每行一个 player 的开销**：每个可见视频挂一个暂停的原生 player（`useVideoPlayer`，卸载时释放）。消息列表是 `FlatList`，屏幕外的行卸载即释放，同一屏通常只有一两个视频；`AudioAttachment` 早就每行挂一个音频 player，是同一取舍；网页版每条视频也挂一个 `<video preload="metadata">`。不做“滚动到可视才建 player”的懒加载——图片附件也是挂载即取，行为一致。

**文案零新增**：浮层用已有的 `t("Play")`，失败占位用已有的 `t("Tap to open")`；时长是数字，无文案。

## Alternatives considered

- **先用 `getThumbnailAsync` 取帧当封面，点一下再挂 player**：最强的理由是列表里零 player 开销，封面是一张静态图。但时长只能等 player 挂载后才知道，封面上就没时长（网页版封面有时长）；点一下后要先建 player、加载再播，有等待感；每条视频多一个临时缩略图文件要管生命周期。否掉。
- **点一下才挂 player，不挂不显示首帧**：开销最小，但封面只剩图标 + 名字，丢了网页版同款的首帧预览；否掉。
- **不做内联，只让详情页播放器自动播放**：改动最小，但用户要的就是“点一下在消息里直接播”，弹窗不是消息里；否掉（与网页版当时否掉的理由相同）。
- **左滑移除另打一个包**：用户明确说合包，不然浪费打包次数；否掉。

## Consequences

- 两个提交进同一分支，App 随下个 EAS 包才到用户手机；服务端不用部署，`app.json` 版本号不动。
- `message-bubble.tsx` 新增视频分支；`InlineVideoAttachment` / `InlineVideoPlayer` 两个新文件，复用 `videoArtifactUri`、`video-player.tsx` / `video-preview.tsx` 的现成件，不新写播放器。
- `expo-video` 只在 `InlineVideoPlayer` 里静态引入、且该模块是 `lazy` 的，`message-bubble` 的既有测试不加载原生视频模块；新单测按 `audio-attachment.test.tsx` 的写法 mock `expo-video` 与 `expo`。
- 已知缺口：`app/peer-chat.tsx` 也渲染附件（视频目前是分享按钮），本批未动——它不走 `MessageBubble`，要改是另一处；画廊视频格仍是播放图标占位，未改；多个视频可同时播放（与网页版相同）；首帧要等 player 加载元数据，加载完成前是占位不是首帧。
- 未另出效果图：按用户已批准的网页版同款设计直接实现；用户事后要看图再补。

## Testing

- 新单测 `lib/inline-video-attachment.test.tsx`：加载中占位、取到 URI 后挂 player、点播放浮层调 `play()`、就绪后显示时长、取失败显示 `Tap to open`、原生模块缺失时回落文件卡。
- 左滑那批的 `thread-media-model-sheet` 测试要过；只跑改动文件相关的 mobile 测试。
- `mobile tsc` 与 Biome 只针对改动文件；`bot-roster`、`usage-detail` 的 7 个 tsc 错是基线，不用修、但确认没新增。
- `verify-notes` 三线过。
- 未做真机验证：需装包后在手机上实测（点视频一点就播、播完浮层回来、详情页「打开」仍在）。
