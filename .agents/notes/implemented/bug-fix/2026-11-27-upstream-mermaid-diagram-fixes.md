# Agent Note: 移植上游两个 Mermaid 图表移动端修复

Status: implemented

## Problem

Android 上聊天消息里的 Mermaid 图表（流程图等）有两个显示问题，都是上游 2026-11-23 修掉的：

- **打开就崩**：`MermaidDiagram` 把 `dataDetectorTypes` 传成字符串 `"none"`，Android 原生 WebView 读这个属性时不做转换、直接按列表处理，字符串一传就崩，聊天里一出现 Mermaid 图 App 就闪退。iOS 的封装会把字符串转成列表，所以只在 Android 上崩。
- **图被压成空卡片**：WebView 库把原生视图包在一个 `flex: 1` 但没有高度的容器里；Android 的 Markdown 宿主按精确尺寸排版每个消息块，这个容器在那里被压到 0 高，气泡按图的尺寸撑开了、里面却是空的。

两个问题都在 `apps/mobile/components/mermaid-diagram.tsx` 这一个文件里，改动分别是 3 行与 8 行。

## Decision

逐个 cherry-pick 上游的两个提交，不做全量同步（上游相对基点领先 1754 个提交，全量合是 6973 个文件的重组工程）：

- 上游 #6526（`26adb8f7`）：“Stop the Android app crashing on chat replies with a Mermaid diagram”——`dataDetectorTypes="none"` 改成 `dataDetectorTypes={["none"]}`，附一行注释说明 Android 原生视图在纯字符串上会崩。
- 上游 #6545（`59e90e89`）：“fix(mobile): give a chat diagram's WebView the diagram's height on Android”——WebView 的高度不再放 `style` 上，改放 `containerStyle`（`[styles.webviewContainer, { height: drawn ? diagram.height : 1 }]`），`style` 只剩 `styles.webview`；新增 `webviewContainer: { flex: 0 }`，`webview` 样式去掉 `width: "100%"`（宽度由外层卡片定）。
- 两个提交自带的回归测试一起移植，放在 `apps/mobile/lib/mermaid-diagram.test.tsx`：一是断言 `dataDetectorTypes` 传的是 `["none"]`，二是模拟 `drawn` 消息（height 240）后断言 `containerStyle` 展开为 `{ flex: 0, height: 240 }`。测试里对上游原版只改了三处以适配本仓库的旧布局：`@rakazo/ui-tokens` → `@rakazo_mickvvw/ui-tokens`，`../../lib/api/api` → `./api`（组件在 `apps/mobile/components/`、测试在 `apps/mobile/lib/`，模块按测试文件所在位置解析），`useI18n` 不 mock（本仓库的 `useI18n` 是模块级 store，不需要 provider）。
- 两个修复只动移动端，不动服务端、不动数据库、不改翻译 catalog；改完跑移动端相关测试验证。

## Alternatives considered

- **全量同步上游 main**——一次拿齐所有修复。但上游 15 天推了 1754 个提交，还把文件夹大重组了一遍（`#5180–#5181`），全量合要动 6973 个文件；本仓库的定制（Magpie 转译、双池切换等）远多于 fork 上那一个 Magpie 提交，冲突只会比 fork 试合并的 4 个更多。否。
- **只改代码、不移植测试**——改动小，测试显得多余。但这两个测试正是上游为防回归加的（字符串 vs 列表、容器高度），且本仓库的测试基建已经覆盖 `apps/mobile/lib/`，不带测试等于下次重构还会踩同一个坑。否。
- **测试放 `apps/mobile/components/mermaid-diagram.test.tsx`（与上游同路径）**——与上游路径一致。但仓库根的 vitest 配置只收 `apps/mobile/lib/**/*.test.{ts,tsx}`，放 `components/` 进不了默认测试运行，等于没测；本仓库已有把组件测试放 `lib/` 的惯例（`account-deletion.test.tsx` 等测的都是 `../components/` 下的组件）。否，测试放 `lib/`。

## Consequences

- **收益**：Android 上带 Mermaid 图的聊天不再闪退，图画出来后能按实际高度完整显示；两个回归测试进默认测试范围，后续改动有保护。
- **代价与已知上限**：这次只拿了两个移动端小修，上游同期其他值得借的改动（工具调用重试、语音通话失败原因等）不在本批；App 打包已暂停，修复要等用户下次打包新 App 才会到手机上，服务端部署带不上去。

## Verification

- `pnpm verify-notes` 通过。
- 根 vitest 配置跑 `apps/mobile/lib/mermaid-diagram.test.tsx` 与 `apps/mobile/lib/mermaid-webview.test.ts`，全部通过；另跑 `packages/chat-ui` 的 Mermaid 相关测试确认无回归。
