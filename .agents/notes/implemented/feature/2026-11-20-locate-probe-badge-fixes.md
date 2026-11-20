# Agent Note: 定位焦点被弹窗归还抢走、翻译探针中断误判不支持、能力徽章缺连接自带数据

Status: implemented

## Problem

2026-11-20 14:46–14:49 网页实测（线上 c3054f96，分支 `feature/locate-focus-translate-test`），改名通过、翻译测试按钮存在，剩下三处；只改代码、测试、推送到新分支，不部署、不触发构建。

- ① 主聊天模型定位后焦点仍未落到行上。实测：文本回复点“当前模型: deepseek-v4.1-flash”→定位小窗点名字→右侧顶部“模型”卡出现蓝色边框、按 Tab 后边框仍在；但按一次 Tab，键盘焦点落在同一条回复的“朗读”按钮上，未落到定位行的控件。上一批修法（`ModelSection` 自身 effect + `locateRequestId`）单元测试 6 例通过，真机仍失败。
- ② 翻译探针结果“✗ 不支持翻译 · Request aborted”。实测：翻译四行都有“测试”按钮；只点了主力 deepseek-flash 一行，按钮先变“正在测试…”，完成后显示“✗ 不支持翻译 · Request aborted”，未显示支持与秒数。deepseek-flash 是正在用的翻译模型，平时翻译是通的，“不支持”这个结论本身可疑。
- ③ 能力徽章 9 行全无显示。实测：视频生成主力 cogvideox-flash、图片生成主力 gemini-3.6-flash 与备用 cogview-3-flash、视频/图片编辑主力 cogview-3-flash、翻译主力 deepseek-flash 与 3 个备用，9 行操作区都只有“测试、↑、↓、×”，× 后无任何徽章，页面检索“文本”“影音”无匹配。

相关笔记：[定位焦点+翻译测试+改名+徽章](./2026-11-20-locate-focus-translate-test.md) §1（上一批的焦点修法与本批 §1 翻转它的原因）、§2（探针的来源）、§4（徽章只用 `images` 的设计）。

## Decision

### 1. 定位焦点：定位关闭的那两次弹窗不归还焦点，面板 effect 的聚焦才站得住

**根因（已在装好的 Base UI 1.9.0 源码里核实，非猜测）**：定位小窗与切换记录弹窗用的都是 `@base-ui/react` 的 `Dialog`（`packages/ui-web/src/components/ui/dialog.tsx` 的 `DialogContent` 透传 props 到 `DialogPrimitive.Popup`）。`DialogPopup` 把 `finalFocus` 当 `returnFocus` 传给 `FloatingFocusManager`；其卸载清理（`FloatingFocusManager.mjs`）在清理时先算好归还目标，再用 `queueMicrotask` 调度一次归还：清理时读的 `activeElement` 是 body（被聚焦的元素随弹窗一起被移出文档，浏览器把焦点重置到 body），所以守卫 `activeEl !== doc.body ? isFocusInsideFloatingTree : true` 走无条件分支——只要归还目标是可聚焦元素，就一定归还到打开弹窗之前聚焦的“当前模型”按钮上。

上一批笔记 §1 说“effect 在面板 `setLocatedKey` 落定后的 commit 才跑（晚一到两个 commit），归还早已跑完”，这个说法是错的：面板的定位匹配 effect 在提交 A 的被动 effect 里调 `setLocatedKey`，React 把随之而来的提交 B 同一个任务里同步刷掉（被动 effect 里的更新在绘制前刷完），而弹窗清理排的 `queueMicrotask` 在整个任务结束后才跑——提交 B 里行上的聚焦先落下，微任务随后把它抢回对话里的“当前模型”按钮；再按一次 Tab 正好落在同一条回复的“朗读”按钮上，与实测完全一致。所以“晚一个 commit”躲不开微任务：两个提交在同一个任务里，微任务永远最后跑。影图行能落上去，是因为它的聚焦 effect 在列表展开（`setOpen(true)` 再展开）之后才跑，落在一个更晚的任务里，微任务早已跑完——是时序巧合，不是结构保证；列表本来就是展开的时候去定位，影图行同样会撞上。

**修法**：弹窗只在“确认定位”这次关闭时不归还焦点，正常关闭（Esc/X/点外面）保持默认归还。`ModelLocatePopup` 与 `ModelSwitchHistoryDialog` 的历史弹窗各加一个 ref：确认/定位的点击处理里先把 ref 置真，再关弹窗；`DialogContent` 传 `finalFocus={() => (ref.current ? false : null)}`——函数返回 `false` 时 `getReturnElement` 返回 null、归还不发生；返回 `null` 时走默认归还。ref 在弹窗打开时复位（`open` 变化的 effect），下一次正常关闭不受影响。两处都要改：历史弹窗在点名字时关闭（打开确认小窗），确认小窗在点名字时关闭（真正跳转），两次关闭各有一次归还微任务，只修一处另一处仍会抢走焦点。

- 上一批备选里否决过“关掉 Dialog 的焦点归还”，否决的是无差别的 `returnFocus={false}`（所有关闭都不归还，包括正常关闭）。本批是条件式：只有确认定位这次关闭不归还，正常关闭的归还行为原样保留，所以不违反那条否决的理由。反过来，把面板 effect 再包一层 `requestAnimationFrame`/`setTimeout` 也能赢过微任务，但那是再叠一层时序赌注；从根上拿掉这次不该发生的归还，才是结构性修法。
- `ModelSection` 的 effect 本身不动（上一批的 6 例测试继续有效）；只改它上面那条已成假话的注释——“晚一个 commit、归还早已跑完”改成现在真实的机制：定位关闭不归还，面板 effect 的聚焦才站得住。
- 回归测试补在 `model-switch-history-dialog.test.tsx`：真实挂 `ModelLocatePopup` + 一行带聚焦 effect 的替身行，先把焦点放在“当前模型”入口按钮上再开弹窗，点确认后刷完微任务与退出过渡，断言焦点落在行上；再测一次 Esc/点 X 关闭，断言焦点回到入口按钮（默认归还保留）。上一批 6 例只渲染了 `ModelSection`、没挂弹窗，所以测不出这次抢焦点——这正是它们通过但真机失败的原因。

### 2. 探针结果分三态：支持 / 不支持 / 测不出，中断不再判“不支持”

**根因（已查清两条链路）**：

- “Request aborted”只来自 pi-ai `retryProviderRequest` 的 `createAbortError()`（信号已 abort 时抛 `AbortError("Request aborted")`）。探针传给 `translateOnce` → `runtime.run` 的信号是 `AbortSignal.any([context.signal, AbortSignal.timeout(30_000)])`：`context.signal` 是客户端断连信号，30 秒是探针自己的超时。客户端 `testTranslationModel` 没传 signal、没取消请求，按钮也正常走到了结果行，所以不是客户端误取消；中断源是 30 秒超时或运行时内部看门狗之一——代码层面分不出是哪一个（两者都汇成同一个 `AbortError`），但两者都是“没等到 verdict 就中断”，不是“模型不支持翻译”。
- 判定错在两处都把一切失败压成 `supported: false`：服务端 `createTranslationProber` 的 catch 不分错误种类一律返回 `supported: false`；客户端 `testTranslationModel` 的 catch（RPC 本身失败时）也写 `supported: false`。`MediaModelTestResult` 只有两档渲染，`supported: false` 就显示“✗ 不支持翻译 · {detail}”且不显示秒数。连带伤害：`modelStatusFromProbe({supported: false})` 把 deepseek-flash 记成 `unavailable`——一次中断的探针还污染了模型状态指示。

**修法**：探针结果分三态 `outcome: "supported" | "unsupported" | "unknown"`，与 `supported` 并存（`supported` 仍为布尔，`outcome` 说清 `false` 的那一半）：

- 服务端翻译探针（`apps/api/src/translate.ts`）：超时信号单独建（`AbortSignal.timeout` 的 abort 能单独认出），catch 里按三档分——探针自身超时 / 外层信号 abort / `AbortError`/`TimeoutError` → `unknown`，原因分别写“{N} 秒内没有回音”/“请求中断”；模型回了但没翻出译文（`Translation did not return JSON` / `Translation produced no text`）→ `unsupported`，那是唯一“模型答了但做不了这件任务”的证据；其余一切（限流、鉴权、余额、网络、未连接）→ `unknown`，带脱敏后的原因。成功仍是 `supported` + 译文。
- 媒体探针同 pattern 一起做（`probeMediaModel`，`MediaModelProbeResult` 加 `outcome`）：探针答了但没给媒体（只回文字、返回不是 JSON）→ `unsupported`；中断/超时、HTTP 错误分类（限流/鉴权/余额/上游错/模型不存在/请求无效）、网络错误 → `unknown`。只改判定，不改探测本身；异步视频探针（`probeAsyncVideo`）同样带 `outcome`。
- 契约（`packages/contracts/src/rpc.ts`）：`testTranslationModel` 与 `testMediaModel` 的输出各加 `outcome` 枚举；两端一起发版，客户端只读新字段。
- 客户端（`bot-panel.tsx` / `bot-settings-sections.tsx`）：`MediaModelTestState.done` 加 `outcome`；`MediaModelTestResult` 加第三档——“? 测不出是否支持… · {detail} · {seconds}s”，测不出也显示秒数（30 秒超时与 2 秒中断是不同的信息）；`testTranslationModel`/`testMediaModel` 的 catch 改成 `outcome: "unknown"`；`outcome === "unknown"` 时不调 `recordModelStatus`（不确定的探针不写模型状态），`modelStatusFromProbe` 为此返回 `null` 表示“不记录”。“设为主模型”仍只在 `supported` 时出现。
- 新文案三条（视频/图片/翻译各一条“测不出”）走 Lingui：extract → 补 zh-CN/zh-TW → compile，与上一批同一流程。
- 不做的事：不把探针超时从 30 秒放宽——真实翻译同一条路也是每尝试 30 秒，探针与真实路径的预算一致；不重试一次——探针是单行快测，测不出就是测不出，用户点一次测试能再点一次。也不悄悄吞掉 abort：中断仍显示原因，只是换个诚实的档位。

### 3. 能力徽章：接线缺口——连接自带的 vision 数据到了客户端，却在 `connectedModelChoices` 被丢掉

**根因（已查清整条链路）**：

- 9 行无徽章不是渲染 bug：`modelCapabilities`（`bot-settings-sections.tsx`）读 `ChatModelChoice.images`，`images === undefined` 时返回空数组；卡片接线正确。
- 数据在目录那一端本来就没有——而且是故意没有：全部自定义连接共享同一个提供方 id `"openai-compatible"`（`bot-panel.tsx:927` 的注释）；`buildPiCatalog()`（`packages/adapters/src/pi-models.ts`）给 openai-compatible 的每一条目录都只打 `placeholder: true`，不带 `images`（注释原话：兼容元数据证明不了一个用户的端点真在跑这个模型，图片支持是连接自己的设置，不是目录的）。`connectedModelChoices` 过滤掉占位条目后，`providerModels` 为空，`images` 全是 `undefined`。
- 但“连接自己的设置”这份数据是存在的，并且已经到了客户端：`modelCredentialDto`（`packages/adapters/src/model-connect.ts`）给每个 openai-compatible 连接算 `visionModelIds`——已启用模型里按 `compatibleModelSeesImages` 算出能看图的那些（Anthropic 原生协议的连接全算，chat-completions 的按连接里声明的 vision 列表/旧 `supportsImages` 算）；`ModelCredentialSchema` 有这个字段，连接列表 RPC 传 plaintext 时会填上。丢数据的点在 `packages/core/src/model-providers.ts`：`CredentialModelRef` 没有 `visionModelIds` 字段，`connectedModelChoices` 只查目录，从不看它。
- 所以 9 行无徽章是“数据在客户端门口被丢掉”，不是“数据不存在”、也不是“渲染没接线”。GB 连接（Anthropic 原生）按现有规则全员算会看图；智谱连接（chat-completions、没声明 vision 列表）算出来是空——两边行为不同，但都是连接自己的设置说了算，不是我编的。

**修法**：把 `visionModelIds` 接进 `connectedModelChoices`：

- `CredentialModelRef` 加 `visionModelIds?: readonly string[]`；已启用 id 的 `images` 取“目录有值用目录的，目录没值且在 vision 列表里则为 `true`，其余仍为 `undefined`”；单模型自由填的默认模型那条路同样处理。目录值优先（含显式的 `false`——捆绑目录说纯文本是比启发式列表更强的证据）；vision 列表只补“真”，永远不补“假”（自定义端点永远不能被证明是纯文本，`thread-image-admission.ts` 的注释也是这个意思）。
- 渲染与映射不动：`images === true` → `[文本][图片]`，`false` → `[文本]`，`undefined` → 无徽章。`modelCapabilities` 的注释同步改——数据来源从“只有目录”改成“目录或连接声明的 vision 列表”。
- 部署后的预期：GB 的行（翻译主 deepseek-flash、3 个翻译备用、图片生成主 gemini-3.6-flash）出 `[文本][图片]`；智谱的行（cogview-3-flash、cogvideox-flash）仍无徽章——没有声明数据，不编造。cogview 是图片输出，当前徽章的 `[图片]` 意思是图片输入，所以它拿不到徽章是对的；输出侧能力等用户定 `[图片]` 语义（“生图也算图片”还是“只算能看图”，已问、未答）后的影音那批再做。
- 附带说明：Anthropic 原生协议“一律算会看图”是协议层启发式（注释原话：这条协议跑的是 Claude 模型，都会看图），GB 中继后面挂的不是 Claude 模型，徽章会按这条启发式宣称 deepseek-flash 等“能看图”——这是运行时图片准入与电脑角色选择器本来就用的同一条信念，徽章与它们保持一致，不新编一套；但它的真实性未经逐模型实测，部署后以实测为准。

## Alternatives considered

- ① 面板 effect 里再包一层 `requestAnimationFrame`/`setTimeout(0)`：最强的理由是改动只有一行，且宏任务一定在微任务之后跑，所以一定能赢。但它是再叠一层时序赌注（下一次弹窗的退出动画或清理时序一变就可能再输），且焦点会晚一拍才落下；从根上拿掉这次不该发生的归还是结构性修法；不用。
- ① 只修确认小窗、不修历史弹窗：最强的理由是改动面小。但历史弹窗在点名字时关闭、同样排一次归还微任务——点名字后焦点还没进确认小窗就可能先被抢回对话；两次关闭是同一次导航的两步，都要修；不用。
- ① 无差别关掉归还（上一批已否决）：否决的理由是正常关闭的归还也会丢掉。本批是条件式，只关确认定位这次，正常关闭原样保留；否决的前提已不存在。
- ② 探针超时从 30 秒放宽到 60 秒：最强的理由是运行时首字看门狗是 60 秒，探针 30 秒就放弃可能错杀慢模型。但真实翻译同一条路也是每尝试 30 秒，探针与真实路径预算一致；放宽会让探针与真实翻译的行为脱节；不用。
- ② 中断时自动重试一次：最强的理由是真实翻译链本身每模型重试一次，探针跟它一致更抗抖。但探针是用户点一下的快测，测不出就如实显示、用户可再点；重试把最坏等待翻倍，且重试成功仍会掩盖“这次确实中断了”；不用。
- ② 只在翻译探针上做三态、不动媒体探针：最强的理由是本批的故障只报在翻译行。但两档共用 `MediaModelTestState` 与 `MediaModelTestResult`，媒体探针的 catch 同样把中断写成“不支持”；同一条“失败 ≠ 不支持”只修一半，下次媒体行出同样的错还要再修一次；一起做。
- ② “模型不存在”（404）判 `unsupported`：最强的理由是模型跑不起来，测了等于白测。但 404 说的是 id 不对或已停用，不是“这个模型没有媒体/翻译能力”；判 `unknown` + 原因才是诚实的；不用。
- ③ 不改代码、回报“9 行无徽章是设计使然”：最强的理由是目录故意不给数据，零改动零风险。但数据并非不存在——连接自己的 vision 列表已经算好并送到了客户端，只是在 `connectedModelChoices` 门口被丢掉；按上一批 §4 的设计（“只用真实数据”），接上这份真实数据是补完，不是编造；不用。
- ③ 徽章改读运行时准入（`compatibleModelSeesImages`/`modelAcceptsImageInput`）而不是接 `visionModelIds`：最强的理由是运行时那套更全（还含环境变量声明的 vision 列表）。但那是服务端的运行时判断，客户端的 choices 层拿不到；`visionModelIds` 已经是服务端把那套判断按连接算好、随连接列表发下来的结果，接它就是接同一份数据；不用。
- ③ vision 列表里没有的模型判 `images: false`（出 `[文本]`）：最强的理由是列表是连接的完整声明，没在列表里就是不会看图。但连接的 vision 列表是“声明了会看图的模型”，不是“全部模型的完整能力表”；自定义端点永远不能被证明是纯文本，未声明 = 不知道，出 `[文本]` 是编造；不用。

## Consequences

- 定位后焦点落在被定位行上：确认定位的两次弹窗关闭都不再抢回焦点，面板 effect 的聚焦是最后一次焦点移动；正常关闭弹窗仍把焦点还给原处。重复定位同模型仍按 `locateRequestId` 重聚焦。
- 翻译与媒体探针结果分三态：支持（✓ + 秒数）、不支持（✗ + 原因）、测不出（? + 原因 + 秒数）；中断/限流/鉴权/余额/网络不再写成“不支持”；测不出的探针不写模型状态、不污染健康指示。
- 能力徽章多了一个真实数据来源：目录没值时，连接声明的 vision 列表能让行出 `[文本][图片]`；没有声明数据的行仍无徽章。GB 的行部署后应出徽章，智谱的行仍不出。
- 代价：`testTranslationModel`/`testMediaModel` 的 RPC 输出各加一个 `outcome` 字段；`MediaModelProbeResult` 与 `TranslationProber` 返回各加 `outcome`；`CredentialModelRef` 加 `visionModelIds`；新 UI 文案三条走 Lingui。

## Verification

- vitest（改动相关的 9 个文件）：318/318 通过——`packages/core/src/model-providers.test.ts`（42，含新增 vision 补 `true` 3 例）、`packages/adapters/src/pi-openai-compatible-provider.test.ts`、`apps/api/src/translate.test.ts`（21，含新增中断/超时 2 例）、`apps/api/src/routes/bots.test.ts`（11）、`apps/web/src/lib/model-status.test.ts`（6，含新增 unknown 不记录 1 例）、`apps/web/src/pages/shell/media-model-group.test.tsx`（28，含新增 unknown 渲染 1 例）、`bot-settings-sections.test.tsx`（6）、`bot-panel.test.tsx`、`model-switch-history-dialog.test.tsx`（14，含新增竞态 2 例）。另跑大面扫查 `apps/web/src/pages/shell` + `packages/contracts` + `packages/core`：233 个文件、4433 通过、1 跳过。
- 竞态测试的反向验证：临时把确认小窗的 `finalFocus` 改回默认（`undefined`），“确认定位后焦点落在行上”那例失败（焦点落在入口按钮上——正是真机报的故障），“点 X 关闭焦点回到入口”那例仍通过；恢复修法后两例都通过。上一批 6 例只渲染 `ModelSection`、没挂弹窗，所以测不出这次抢焦点。
- `apps/web` tsc：0 错。`outcome` 改动暴露了两处旧调用要补 null 处理（`message-translation.tsx:267` 的 `recordModelStatus` 入参与 `model-status.test.ts:26–27` 的 `.state` 访问），已各加 null 守卫/可选链——`modelStatusFromProbe` 返回 `null` 是新增的返回形态，不是只有新调用才要处理。
- `apps/api` tsc：只有已知的基线 2 错（`packages/adapters/src/voice-factory.ts` 的 `preset` 属性），与本批无关。
- Biome：改动文件 `biome check` 干净（格式化 4 个文件 + 修掉新测试里一个不 yield 的 async generator 触发的 `useYield`）。
- Lingui：`intl:extract --clean` 后新文案三条，zh-CN/zh-TW 已补译（“? {0} 是否支持图片/视频生成/翻译无法确定 · {1} · {2} 秒”，zh-TW 用“支援/圖片/影片”），`intl:compile` 通过。
- `pnpm verify-notes` 三线全过（38 条笔记）。
- 未验证：没有 live 浏览器视觉核对（桌面浏览器改不了视口宽、且本批不部署）；手机端窄屏三处等用户手机验收；徽章在 GB 行上的正面例子、探针三态的显示，均须等部署后实测。

## Known gaps

- 媒体探针的“不支持”仍只认“答了但没给媒体”：模型回了非 JSON 但给了媒体链接等边缘情况不在判定里，与之前相同。
- 探针中断的根因（30 秒超时还是运行时看门狗）代码层面分不出来：两者都汇成同一个 `AbortError`；三态修法不依赖分清这一点，只保证中断不再误判。
- `[影音]` 徽章仍无数据来源（等用户定 `[图片]` 语义后的探针+勾选那批）。
- 详情里没有用量统计（设置页作用域里没有按模型分的用量数据），与之前相同。
- `splitBotModelPools` 主池空、备用池有模型时丢备用池的显示问题仍在，不在本批。
- 重复定位同模型时影图行的焦点不重跑（影图列表 effect 的依赖里没有 requestId），与之前相同。
