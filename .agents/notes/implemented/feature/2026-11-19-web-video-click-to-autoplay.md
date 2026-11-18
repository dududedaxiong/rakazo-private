# Agent Note: 网页聊天里的生成视频点一下就地自动播放

Status: implemented

## Problem

触发词第三修上线后，网页版真聊验证（2026-11-18 23:05–23:07）确认视频确实生成了，但结果在对话里是一张文件卡（图标 + 文件名 + 大小 + 下载按钮），要点预览再进弹窗，弹窗里的视频还是暂停的，要再按一次播放。用户要的是：点一下视频就直接在消息里自动播放，像正常聊天里的视频气泡一样。

对照：图片（`ArtifactImage`）在消息里就是内联缩略图，点一下才开大图；视频没有任何等价的内联形态。

现在点一下的实际流程：点文件卡 → 打开预览弹窗 → `FilePreview` 取完整字节（转圈）→ `VideoPreview` 渲染 `<video controls preload="metadata">`，暂停状态 → 用户再按播放。共两次点击 + 一次弹窗。

相关笔记：[触发词命中直接走媒体工具](../../implemented/feature/2026-11-18-media-trigger-words-route-to-media-tools.md)。

## Decision

`MediaResult` 的视频分支改走内联视频；普通附件不动：

- `ArtifactFileCard` 新增 `inlineVideo` 开关，只在生成的视频结果上由 `MediaResult`（kind 为 `video` 时）传 `true`。普通附件（`message-view.tsx` 里无媒体标注的回落分支）、Artifacts 页、Gallery、PeerMessagesOverlay 都不传，保持文件卡。
- 内联播放器（`ArtifactFileCard.tsx` 内的 `InlineVideoCard`）：滚动到可视范围才取字节（`IntersectionObserver`，rootMargin 320px，与 `ArtifactImage` 同款）；`fetchArtifactBytes` 取回后生成 blob URL；`<video preload="metadata" playsInline controls>`，首帧即缩略图；暂停时整块区域盖一层播放按钮 + 时长（`onLoadedMetadata` 读 duration，m:ss），点一下就地 `play()`——这次点击是用户手势，带声音播放没问题；播放中浮层消失，控制条接管暂停 / 进度 / 音量 / 全屏；播完或暂停后浮层回来。
- 弹窗仍在：预览按钮打开的仍是 `ArtifactFileCard` 的 Dialog；`VideoPreview` 在 src 就绪后自动 `play()`（`AudioArtifactPreview` 同款 effect 写法，播不出就静默留在暂停态，不报错），所以预览入口点开也自动播放。`VideoPreview` 只在三个弹窗里用（文件预览弹窗、Artifacts、Gallery），都是用户点开的场景，自动播放都在手势激活窗口内。
- 按钮不动：下载 / 分享 / 收藏 / 重新生成 / 折叠与“当前模型”行照常；`showMedia*` 开关照常；关掉预览时预览按钮仍不显示，内联播放不受影响（它是消息内的播放，不是预览弹窗）。
- 只做网页版：`ArtifactFileCard` 与 `MediaResult` 都是 `apps/web` 专属，App 不共用这两个组件，改动到不了 App。

## Alternatives considered

- **改 `ArtifactFileCard` 的默认行为，让所有视频附件都内联播放** — 一处改动全站受益。否掉：任务范围只说生成的视频；普通附件沿用文件卡是既有约定，改默认会动到 Artifacts、Gallery、PeerMessagesOverlay 的既有表现，超出本次用户要的范围。
- **点一下只开弹窗、弹窗里自动播放，不做消息内联** — 改动最小。否掉：用户明确要“点一下就直接在消息里自动播放”，弹窗不是消息里；而且弹窗打开要等取字节转圈，体验仍是两步。
- **用 `autoPlay` 属性代替 effect 里调 `play()`** — 更短。否掉：src 是异步取回后才挂上的，`autoPlay` 属性在 src 后挂载时不可靠；effect 里调 `play()` 是 `AudioArtifactPreview` 已在用的写法，播被拒时 catch 掉留在暂停态，行为可预期。
- **内联播放器直接取流式 URL 而不是先下完整字节** — 省流量。否掉：artifact 取数只有 `rpc.artifacts.get`（base64 全量）一条路，没有流式 / 分片地址；首帧缩略图也要靠 `preload="metadata"` + blob URL，现成路径够用。
- **去掉弹窗，只留内联播放** — 最省。否掉：预览弹窗里有标题栏（预设 / 补充提示词 / 模型切换）与重新生成入口，是媒体结果的操作面；用户只要求播放方式变，没要求砍掉预览入口。

## Consequences

- 生成的视频在消息里直接是一块视频（首帧 + 时长 + 播放浮层），点一下就地带声音播放；预览按钮点开的弹窗也自动播放。
- 播放被浏览器拒绝时（手势过期等）不报错，停在暂停态，控制条照常可用。
- 内联播放器在滚动到可视范围才取字节，不可见的消息不下载视频；弹窗打开时 `FilePreview` 仍会再取一次字节（与内联那份不共用缓存），多一次下载。
- 普通附件（非生成的视频文件、其他类型文件）仍是文件卡，不动。
- App 不受影响：改动的两个组件都是网页版专属。

## Testing

- `ArtifactFileCard.test.tsx` 新增用例：内联视频渲染 `<video>` 而不是文件卡、点播放浮层就地播放、弹窗打开时自动播放。
- `media-result.test.tsx` 新增用例：视频结果渲染内联视频。
- 相关套件全过；`executor.test.ts` 的 4 个失败是已知基线（`userTurnInstructions` 期望缺模型连接 clause，父提交已如此），无新增。
- `verify-notes` 三线过。Biome 格式化过。
- 未做端到端真聊验证：需部署后在网页版实测（发“生成一段视频：…”看是否一点就播）。
