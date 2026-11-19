# Agent Note: 影图重新生成分两个模式：细节修改 / 随机生成，改异步 + 正在构建提示

Status: implemented

## Problem

## Problem

图片/视频的重新生成（`rpc.media.regenerate`）一直失败，用户 2026-11-19 早上又试了三次。证据（日志 + 数据库双核实）：

- 六次重新生成全部在请求开始后约 8 秒断开：凌晨 02:54:34、02:54:45、02:58:13，早上 08:55:53、08:56:40、08:59:27；每次都是 `rpc media/regenerate client disconnected`、HTTP 500 `Error: aborted`。同一时段对话里直接发提示词正常（09:00:04–09:00:16，约 12 秒出图）。
- 数据库 runs/tasks 显示的 `completed` 是假的：`media.ts` 里建 run/task 时就直接写 `status: "completed"`，六次里一次都没真正跑起来——无 startedAt/completedAt、无模型、无消息、无新图。凌晨曾误判为“新图可能已经生成”，已当面纠正：一次都没生成过。
- 根因：重新生成是同步长连接 RPC（`await generateMediaFromTool` 等图画完才回），对话触发是发完即回、结果后推，所以不断。8 秒断点具体是哪一环掐的未确定（本地无代理超时配置，网页 RPC 客户端代码里也没有超时），但修法不用等它：改异步就不再挂长连接。
- 只有一个 ↻ 按钮，两种意图混在一起：用户要的是两个模式——细节修改（在已生成的作品上按细节提示词改）与随机生成（同提示词全新随机一张/一条），视频也一样。点完也没有进行中提示，用户问“新图没出来能不能提示正在构建”。

相关笔记：[触发词命中直接走媒体工具](../../implemented/feature/2026-11-18-media-trigger-words-route-to-media-tools.md)、[网页视频点一下就地自动播放](../../implemented/feature/2026-11-19-web-video-click-to-autoplay.md)。

## Decision

第一步（本次）：修通现在的路，不换模型。真逐像素改是第二步（见 Alternatives）。

**两个模式（图片与视频同款，网页版预览顶栏 + 对话消息操作行都放）：**

- **细节修改 = 图生图（编辑模型）**：拿已生成的原图 + 细节提示词（补充提示词），走编辑模型在原图基础上改。编辑只传补充提示词，不拼原提示词和预设——原图已经带了全部内容，细节提示词就是改动要求。图片编辑把原图当参考图、视频编辑把原视频首帧 + 尾帧当参考帧，经现有的媒体生成抽象传下去；模型专属的 API 参数只出现在 adapters 里，不写死模型 ID。编辑模型由用户在机器人设置里配，「编辑模型」栏默认空；GLM-Image（图片）与 CogVideoX-3（视频首尾帧）只是候选示例、不是默认值，代码、设置、种子数据里都不写它们（2026-11-19 用户澄清）。补充提示词为空时，点它先弹出补充提示词输入框，保存后即开始修改。
- **随机生成 = 文生图（预设模型）**：走机器人配好的影图模型（图片 cogview-3-flash、视频 cogvideox-flash），原提示词 + 提示词预设 + 补充提示词，全新随机一张/一条。补充提示词两种模式都生效：细节修改是拿它去改原图，随机生成是拿它重画一张——区别只在用不用原图，不在提示词本身（2026-11-19 用户澄清：有时候补充提示词也是想它重新生成的）。
- **编辑模型与随机模型分开配（2026-11-19 用户定）**：机器人影图模型设置里加「编辑模型」栏（图片与视频各一），与随机生成用的影图模型分开，各配各的提示词、互不干扰。编辑模型栏是可排序的模型列表，与现有的 imageModels / videoModels 同一套模式：有序备选切换，失败换下一个编辑模型；编辑备选只在编辑模型之间走，失败不降级成重画。栏默认空，由用户后续在机器人设置里安排；代码、设置、种子数据里都不写默认值、不硬编码模型 ID。视频编辑走首尾帧：原视频首帧 + 尾帧 + 细节提示词，开头结尾和原视频一样、中间按细节要求重画——不是逐帧改，中间内容仍会变。未配编辑模型时，细节修改按钮提示去配。
- **视频细节修改可上传参考图（2026-11-19 用户补）**：视频点「细节修改」时流程里加一个图片上传入口，用户可以传一张图片当参考帧（定基准），免得服务端从原视频抽帧抽不准。用户上传的图优先于服务端抽的首帧：有上传图就用它当首帧参考，没有上传图才用服务端抽的首帧；尾帧仍从原视频取（首尾帧模型才需要）。若服务端完全没有可用的帧提取手段，视频编辑退到单图图生视频（只用上传的图或抽的首帧当参考）。图片编辑不受影响：参考就是原图本身，不用上传。现状：api 容器里没有 ffmpeg、服务端抽帧暂不可用，视频编辑先走上传图单图图生视频；服务端抽帧是待决项。

**异步（根因修法，与视频同款）：**

- `media.regenerate` 不再同步等生成结果：建好 run 后立刻回 `{ ok: true, status: "queued" }`，服务端排期生成任务（复用视频已在用的 `scheduleMediaPoll` + media delivery 事件路径），结果画好后经现有事件/轮询推到对话里。视频的 regenerate 本来就走这条路（`jobId` 未完成时回 queued），图片补上同一条路。
- 点完对话里立刻出现「正在生成图片…」/「正在生成视频…」（`run-tools-files.ts` 已有的进行中文案，09:00 对话触发时用户已见过）；新图/新视频到了自动换成结果；失败时 toast 显示原因 + 可重试；构建期间两个按钮变灰防重复点。
- 修掉假 completed：run/task 建的时候不再写 `completed`，改成进行中状态，artifact 落库才标 completed，失败标 failed 并写 error。以后数据库状态可信。
- 记最终提示词：生成时把最终拼好的提示词（原提示词 + 预设 + 补充提示词）记进日志，补充提示词有没有拼进去一眼能核对。

**范围与文案：**

- 只做网页版：`apps/web` 的 `MediaResult` / `ArtifactFileCard` / `media-result.tsx` 与 `apps/api` 的 `media.ts`。App 的 regenerate 走同一条 RPC，契约里 `MediaRegenerateResult` 已有 `"completed" | "queued"`，App 不用改代码就能拿到 queued；App 的双按钮是另外的事，用户没提先不动。
- 新增文案「细节修改」「随机生成」走 Lingui：extract + 补 zh-CN 翻译 + compile 再提交（2026-11-19 触发词标签乱码的教训：不 compile 就会显示 message ID）。
- 触发词仍是纯子串匹配，本次不动；图片模型仍只有 cogview-3-flash 一个、零备选，不动。

## Alternatives considered

- **只修异步，不分两个按钮** — 否掉：用户亲口定了两个模式，↻ 一个按钮分不清细节修改还是随机生成。
- **细节修改用文生图重画（原提示词 + 补充提示词，不传原图）** — 否掉（2026-11-19 用户纠正）：细节修改就是图生图、编辑模型，随机生成才是文生图。重画不算细节修改。
- **视频的细节修改机制** — 已定（2026-11-19 用户：视频编辑按道理也得做）：首尾帧图生视频（候选示例：CogVideoX-3，1 元/条；不是默认值）。免费 cogvideox-flash 名义上支持图生视频、实测不认参考图，不用它做编辑。
- **找出 8 秒断点并调大超时，不改异步** — 否掉：断点归属未确定（本地代理、Caddy、隧道、手机 VPN 都没找到对应超时配置），而且生图要 30–180 秒，任何固定超时都脆弱；异步直接去掉长连接，断点是谁的不再重要。
- **另起一套 job id + 客户端轮询协议** — 否掉：视频已在用 `scheduleMediaPoll` + delivery 事件，复用现成路径，不新造协议。

## Consequences

- 点细节修改 / 随机生成不再报「无法连接服务」：立刻回 queued，对话里显示「正在生成图片…」/「正在生成视频…」，结果到了自动出现；失败有原因 + 重试。
- 两个按钮语义分明：细节修改 = 原图 + 补充提示词（编辑模型）；随机生成 = 原提示词 + 预设 + 补充提示词（预设模型，全新随机）。补充提示词两种模式都生效。补充提示词为空时点细节修改先弹输入框。
- runs/tasks 的状态可信：进行中、完成、失败分得清；最终提示词进日志，补充提示词可核查。
- App 不受影响：契约已兼容 queued，App 按钮不动。

## Implementation summary

- **编辑模型栏**：Bot 新增 `imageEditModels` / `videoEditModels`（可空 JSONB 列 + 迁移），与 imageModels / videoModels 同一套可排序列表 + 有序备选；默认空，不预设、不硬编码模型。编辑调用走通用媒体生成抽象：图片编辑把原图当参考图，视频编辑把上传图当首帧参考；有 references 时只走编辑列表、无编辑模型报 unsupported，绝不降级成重画。
- **异步**：`media.regenerate` 只建 reservation（`submitOnly`）即回 queued，`scheduleMediaPoll` 排期；工作进程 `resume` 认领后跑生成（`pollMediaJob` 按 tool 分派视频/图片；图片失败即标 failed 不重试，免得重复计费）。run/task 建为 running（startedAt 在位、不设 lease、不被 reconciler 捡），artifact 落库才标 completed、失败标 failed；`settleRegenerateRun` 只结算仍为 running 的 regenerate run。点完对话里发 `thread.progress`「正在生成图片…」/「正在生成视频…」；最终提示词记进 `media.generate` 日志。
- **网页**：预览顶栏与对话消息操作行的单个 ↻ 换成「细节修改」「随机生成」两按钮；细节修改补充提示词为空时弹输入框、保存后自动开始，视频细节修改弹上传参考图对话框（`prepareImage` 预处理后经 `rpc.artifacts.create` 上传，上传图优先于服务端抽帧）；失败走 `toastModelError` 带重试；构建期间两按钮变灰。消息行的旧 `onRegenerate`（重发用户消息）链已删，`regenerateFromMessage` 随之移除。机器人设置里加「图片编辑模型」「视频编辑模型」两栏（picker + 备用 + 测试，无预设、无触发词）；编辑模型测试复用生成探针（无预设），属近似探针、非专用编辑探针。新增文案 extract + zh-CN 翻译 + compile 已过；「随机生成」复用已有 `Generate random` 文案，未另造近义词。
- **偏差**：服务端抽帧仍不可用（api 容器无 ffmpeg），视频编辑只走上传图单图图生视频；尾帧传入待服务端抽帧手段落地后再接。`pollMediaVideo` 的 deadline 失败路径现也覆盖 `media_submitting`。图片编辑的参考图加载走 `loadMediaReferences`（按 sourceArtifactId 取 artifact 字节）。
- **未验证**：部署后网页实测（细节修改/随机生成落袋、视频编辑上传参考图出片）、GLM-Image 是否真接受原图、`submitAsyncVideo` 的 `image_url` data URL 是否被上游接受、视频首尾帧是否生效。

## Testing

- `apps/api/src/routes/media.test.ts`：14 个用例全过——随机图片/视频立刻回 queued 且 run/task 为 running、图片编辑只传补充提示词且带原图引用、无编辑模型报 BAD_REQUEST、补充提示词为空报 BAD_REQUEST、视频编辑无上传参考图报 BAD_REQUEST、有上传参考图带 referenceArtifactId。
- `packages/adapters/src/bot-media-generation.test.ts` 与 `media-generation-tools.test.ts`：46 个用例全过——编辑列表解析与备选切换、编辑无模型报 unsupported、submitOnly 预留 + 幂等回放、resume 认领跑一次且抢占返回 running；修了一个回归：轮询已提交视频时不再先解析 prompt（`{jobId}` 无 prompt 会抛错）。
- `apps/web` 五个相关测试文件：150 个用例全过——两按钮渲染、随机生成调 `regenerate`（mode random）、补充提示词为空时弹编辑对话框、编辑模型栏、机器人设置快照恢复。
- api 全套：1855 通过、2 个失败（`archived-thread-reads.test.ts` 的两条「reads the owned archived history」）。已定位：与本次改动无关，是基线失败——`thread-message-pages.ts` 的 `loadKeptTranslations` 调 `prisma.messageTranslation.findMany`，而该测试的 mock prisma 从未 mock 过 `messageTranslation` delegate（翻译留存功能 8d21899 引入后 fixture 未跟进），直调复现为 `Cannot read properties of undefined (reading 'findMany')`；该文件与 fixture 均不在本次 diff 内。本次未修（超出本 PR 范围）。
- adapters 全套：9287 通过、75 个失败，全在未动过的文件（computer-idle 35、computer-recovery 16、computer-workspace 6、home-object-store 5、executor 4 已知基线、home 3、strategic-initiative-run 2、host-computer / computer-lifecycle / mcp-transport / index 各 1）。已在基线 ebc71dc 的 worktree 上复跑其中 5 个文件（computer-idle、computer-recovery、home-object-store、strategic-initiative-run、index）：59 失败 / 217 通过，与本分支一字不差，证实为环境基线失败，非本次回归；本次改动的两个测试文件（bot-media-generation、media-generation-tools）全过。
- web 全套：2365 通过、2 个失败，均为基线失败：`type-scale.test.ts`（AccountSettingsOverlay.tsx 三处 off-scale 尺寸，未动过的文件）；`i18n-catalog.test.ts` 的 pl 全翻译断言——基线 pl 里 `"{0} calls"`（2026-11-18 用量功能新增）就是空翻译（`git show ebc71dc` 核实），我的 diff 没碰它；本次新增的 5 条文案在 pl 等非中文 locale 同样留空（与既有未翻译条目同 pattern，只填了 zh-CN），该测试在基线已红。本次未修（超出本 PR 范围）。
- tsc：adapters 与 api 只剩 voice-factory.ts 的 2 个 `preset` 基线错误；web 的 tsc 在本会话早段已干净。
- `verify-notes` 三线过。Biome 格式化过。新增文案 extract + zh-CN 翻译 + compile 过。
- 未做端到端真聊验证：需部署后在网页版实测（点细节修改带补充提示词，看「正在生成图片…」后新图落袋；点随机生成，看全新随机一张）。
