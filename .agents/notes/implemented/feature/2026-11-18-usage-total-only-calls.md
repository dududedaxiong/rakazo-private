# Agent Note: 用量页显示只报总数的调用数

Status: implemented

## Problem

用量页的总数对不上输入 + 输出。用户截图：总用量 21,177,815，输入 11,088,607 + 输出 361,399 = 11,450,006，差约 973 万；按模型更明显，deepseek-v4-pro 总数 8,114,045，输入 408,526 + 输出 136,111 = 544,637。用户 2026-11-09 就抱怨过"用量这里不准"。

根因不是算错：各列是按列分别求和，只加报了该数字的调用。有些调用（中转只返回总数、或老记录）只报 totalTokens、不报输入/输出，于是总数被拉高，输入 + 输出跟不上。

## Decision

新增一个精确计数 `totalOnlyCalls`：token-counted 调用里报了 totalTokens、但输入和输出都为空的调用数。只在数字对不上的卡上显示一行小字"其中 X 次调用只报了总数，未分输入/输出"，对得上的卡不显示。

- 契约：`UsageTotalsSchema` 加可选字段 `totalOnlyCalls`；总数、模型行、日序列共用同一 schema，服务端三处都返回它。
- 日序列直接从行里数（`usageTotalsFromRows`）；总数和模型行走 Prisma 交集查询（`totalTokens: { not: null }, inputTokens: null, outputTokens: null`），因为按列 `_count` 相减得不到交集。
- 网页：总数卡、今日卡、每个模型卡共用同一行文案；App 版不动，等下次打 App 包再做。
- 文案只解释缺口，不改任何统计口径；总数、输入、输出三列数字本身一字不动。

## Alternatives considered

- **直接显示现成的 `unknownTokensCalls`，不改后端**。最省事，但数字是错的：`unknownTokensCalls` 数的是缺 totalTokens 的调用（报了输入/输出、没报总数），与用户截图的缺口方向正好相反——那些调用拉低总数，不拉高总数。把它标成"只报了总数"是反向描述，所以否掉。
- **按列 `_count` 相减估算**（`count(totalTokens) - count(inputTokens)`）。不用加查询，但只能得到"报总数没报输入"的调用数，混进了报输入没报输出的调用；交集数算不准，否掉。
- **总数改成输入 + 输出**。改了统计口径：只报总数的调用的 token 就凭空消失，总数反而变小；且与"总数是报了该数字的调用之和"的既有定义冲突，否掉。

## Consequences

- 用量汇总端点多两次 Prisma 查询（一次总数交集 count，一次按模型 groupBy）；日序列无新增查询。
- `totalOnlyCalls` 只解释"总数大于输入 + 输出"的缺口；反向缺口（有调用报输入/输出没报总数）仍由 `unknownTokensCalls` 覆盖，但页面不显示，后者只留在契约里备用。
- 网页用量页新增一条 Lingui 文案，需 extract + compile，zh-CN 翻译随改动一起进 catalog。

相关笔记：[用量页改成 App 同款卡片 + 柱状图](../../implemented/feature/2026-11-17-app-usage-reset.md)——本次改动的页面是那次改版后的用量页。
