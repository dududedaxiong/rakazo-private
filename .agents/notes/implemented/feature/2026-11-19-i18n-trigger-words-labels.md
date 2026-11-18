# Agent Note: 触发词标签乱码：新文案未提取，界面显示 Lingui 消息 ID

Status: implemented

## Problem

用户在网页版机器人设置（影图模型）截图里看到触发词输入框的标签是乱码：视频栏 `_C3aZP`，图片栏 `abe94k`，而不是中文。同一截图里输入框内显示的“生成视频|生成一段视频”是占位符（见下），不是乱码的一部分。

根因已实证确认，分三层：

- 第三修在 `apps/web/src/pages/shell/bot-settings-sections.tsx` 新加了两条 Lingui 文案 `t`Video trigger words`` 与 `t`Image trigger words``（[触发词路由](../../implemented/feature/2026-11-18-media-trigger-words-route-to-media-tools.md)），但提交时没跑 extract，`apps/web/src/locales/*/messages.po` 里从来没有这两条。
- 构建期 compile 只认 catalog 里有的条目：跑 extract 之前，编译产物 `zh-CN/messages.mjs` 里根本没有这两个 key（grep 为 0）。运行时 macro 生成的代码按哈希 ID 查表，查不到就原样渲染 ID 本身——界面上出现的就是 ID。
- 这两个 ID 确实就是这两条文案的哈希：补翻译并 compile 后，编译产物里 `_C3aZP` → `["视频触发词"]`，`abe94k` → `["图片触发词"]`。不是后端返回的乱码，也不是编码问题。

这是同一教训的第二次发生：约 288 条文案未提取的前科之后，改名那篇笔记已写明“改后跑 `intl:extract --clean` + `intl:compile`”，第三修仍漏了这一步。

## Decision

- 在 `apps/web` 跑 `pnpm intl:extract`（即 `lingui extract --clean`）。diff 只有每语种各 2 条新增（`Image trigger words`、`Video trigger words`），共 15 个文件 +120 行、0 删除，证明第三修与视频点击播放两轮改动里新加的 UI 文案只有这两条，没有其他漏网的。
- zh-CN 补翻译：`Video trigger words` → `视频触发词`，`Image trigger words` → `图片触发词`。
- 跑 `pnpm intl:compile`，用 node 直接 import 编译产物核对：zh-CN 里 `_C3aZP` → `["视频触发词"]`，`abe94k` → `["图片触发词"]`；en 里两 key 是英文原文。编译产物（`.mjs`）是 gitignored 的构建产物，不进提交，下次构建时由 `.po` 重新生成。
- 顺带核实：截图里输入框的“生成视频|生成一段视频”是 placeholder，不是已存的值。`bot-panel.tsx` 里触发词 state 初始值是 `bot.videoTriggerWords ?? ""`，保存时 `trim() || null`，空串归一化为 null 回到默认；输入框 `value={triggerWords}` 为空时显示 `placeholder={DEFAULT_VIDEO_TRIGGER_WORDS}`。API 侧的空串归一化逻辑与此一致，无需另改。

## Alternatives considered

- **把这两条也翻成其余 13 个语种**——每个语种的界面都能显示本地文字，最彻底。否掉：用户界面是 zh-CN；其余语种的 catalog 在 compile 时对未翻译条目回退英文原文（已核对 de 编译产物，两 key 都是英文原文），界面不会再出现哈希 ID；手工翻 13 个语种容易翻错，且与“只补中文”的任务范围不符。
- **顺手把 zh-CN 里另外 4 条未翻译（`Never`、`Play`、`Pause`、`Text`）也补了**——同一次 extract 里可见，顺手就能做。否掉：这 4 条在第三修之前就已在 catalog 里未翻译，与这两轮改动无关；`Text` 脱离上下文无法确定译法（文本？文字？），不适合顺手猜一个；另立决定，不捆绑进本次提交。

## Consequences

- 下次构建后，网页版影图模型设置里两栏标签显示“视频触发词”“图片触发词”；其余语种显示英文原文，不再显示哈希 ID。
- 新文案的完成标准重申一次：`t`...`` 落地后同一提交里必须跑 `intl:extract --clean` + `intl:compile`，并把非 en 语种的翻译补进 catalog；只改 `.tsx` 不跑 extract 就等于没做完。这条在改名笔记里已有，本次是它第二次被漏掉的记录。
- 以后怀疑某串乱码是不是 Lingui ID，不用猜：补翻译 compile 后直接读编译产物，看该中文串对应的 key 是不是屏幕上那串字符。
- `i18n-catalog.test.ts` 里 `keeps source placeholders…` 那组测试并不守提取：PO 解析器会给 catalog 里没有的条目补空翻译，所以 key 集合断言在 extract 之前也能过；它只守已翻译条目的占位符一致性。真正守住这两条的是本次新增的回归测试（直接读 `.po` 原文，要求条目存在且译文是中文）。另有一点如实记录：`keeps source placeholders… in pl translations` 在父提交上就是红的（pl 里 `{0} calls` 等 6 条带 `{0}` 的旧条目一直没翻译），本次改动前后同一个失败，与这两条无关，不属于本次范围。

## Testing

- `lingui extract --clean`：15 个语种 catalog 各新增 2 条，无其他新增。
- `lingui compile` 通过；node import 编译产物核对两 key 的中文翻译无误；de 编译产物核对英文回退无误。
- 新增回归测试 `apps/web/src/lib/i18n-catalog.test.ts`：zh-CN 里 `Video trigger words` → `视频触发词`、`Image trigger words` → `图片触发词`。
- 相关测试：`i18n-catalog` 13/14（1 个失败是已知基线：`pl translations`，父提交上同一个测试同一个原因失败，与本次改动无关）；`i18n-activate`、`ui-locale` 全过；Biome 干净。
- `verify-notes` 三线过。
- 未做端到端验证：标签是否正确显示需部署后在网页版机器人设置里看一眼。
