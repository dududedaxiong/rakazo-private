# Agent Note: threads.unread 列已删，unread 改由已读游标推导

Status: implemented

## Problem

2026-11-26 17:23 CST，迁移 `20261202120100_drop_thread_unread` 把数据库里 `threads.unread` 列删了。但当前部署的 rakazo-private 镜像（41dcb182，基点 270c6060）的 Prisma schema 里还留着 `Thread.unread`，Prisma 客户端每次查 thread 都带上这一列，报 `The column threads.unread does not exist in the current database`。切换后 1320 次该错、621 个 HTTP 500（主路径 `chatGroup.findMany`，`spaces.ts:425` 的导航接口），网页端机器人列表加载失败，手机 App 同一个后端也跟着报错。

根因是代码基点比迁移旧：270c6060 的迁移目录里根本没有 `20261202120100_drop_thread_unread`，它的 Prisma schema 还带有 `unread` 字段。数据库比代码新，客户端比数据库旧。

## Decision

删掉 `Thread.unread` 这一列的全部痕迹，unread 改由已读游标推导，不再单独存一个布尔列：

- `unread = lastReadSeq < nextMessageSeq - 1`，即“最后一条已读消息之后还有消息”。`nextMessageSeq` 是下一条待分配的 seq，最新消息的 seq 是 `nextMessageSeq - 1`。
- `packages/db/prisma/schema.prisma`：`Thread` 模型删掉 `unread Boolean @default(false)`。
- `packages/db/prisma/migrations/20261202120100_drop_thread_unread/migration.sql`：补上这次删列的迁移文件，与数据库里已执行的记录对齐（标准 Prisma 生成格式）。不带 `-- deferred`：这一列在库里已经删了，defer 没有意义；文件的作用是让迁移历史与库里一致。
- `packages/db/src/repos.ts` 与 `packages/db/src/groups.ts`：`bot.unread` / `group.unread` 不再读 `thread.unread`，改读 `thread.lastReadSeq` / `thread.nextMessageSeq` 再按上式推导。API 返回的 `unread` 字段本身不变，网页与手机端不用改。
- `apps/api/src/thread-read-state.ts`：`markThreadRead` / `markThreadUnreadFrom` / `setThreadUnreadState` 不再读写 `unread` 列，只动 `lastReadSeq`。标记已读就是把 `lastReadSeq` 推到最新消息；标记未读就是把 `lastReadSeq` 往回挪到最新消息之前一条。
- `apps/api/src/account-import.ts`：导入收尾不再写 `unread: false`（`lastReadSeq` 已等于最新消息 seq，推导结果本来就是 false）。
- 派生关系比单独一列更自洽：新消息一到 `nextMessageSeq` 自增，unread 自动变真；读完 `lastReadSeq` 追上最新消息，unread 自动变假，不需要再有人去维护这个标志位。

## Alternatives considered

- **把 `unread` 列加回数据库**——改动最小，老代码路径原样恢复。但这条路与上游删列的方向相反，且本次任务明确不许动数据库、不许跑迁移；加回去等于把一个多余的列请回来。否。
- **把整个基点 rebase 到已含删列迁移的新版**——能直接拿到上游的替换写法。但新基点会连带引入大量无关的上游改动，Magpie 移植要重做，远超本次只修 500 的范围。否。
- **unread 一律写死 false（不要未读红点）**——最简单。但未读红点与 New 分隔线是用户日常用的功能，砍掉属于功能倒退。否。

## Consequences

- **收益**：Prisma 客户端不再查已删的列，导航与机器人列表的 500 消失；unread 与已读游标永远一致，不会再出现标志位与游标打架的状态。
- **代价与已知上限**：`setThreadUnreadState(true)`（整聊标记未读）现在靠把 `lastReadSeq` 往回挪一条实现，不再是单独置位；“已读到最新却被手工标未读”这种标志位与游标不一致的状态不再存在。另注意：数据库的迁移记录（274 条）比本仓库迁移目录（260 条）多，本次只补了删列这一条，历史缺口没有一次补齐，后续如需完整对齐须另做。
- **与 AGENTS.md 的一处偏离**：删列本应配 `-- deferred` 打头的迁移，但该列在库里已经删了，defer 已无意义；本次迁移文件用标准 Prisma 生成格式，目的是与库里已执行的记录对齐。

## Verification

- 重新生成 Prisma 客户端后，`adapters` 与 `apps/web` 的 vitest 全过（仓库根配置）。
- 部署后查 api 日志，`threads.unread does not exist` 不再出现；网页端机器人与对话列表正常加载；发一条测试消息确认聊天通。
