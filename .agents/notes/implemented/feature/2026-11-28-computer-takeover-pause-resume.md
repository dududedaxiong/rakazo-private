# Agent Note: 用户接管电脑时暂停机器人运行，释放后恢复

Status: implemented

## Problem

用户在机器人正在操作电脑时想自己接管屏幕，今天只能先停掉机器人：`computer/takeover` 在执行租约有效时直接报冲突“Stop the bot first”。机器人被停掉后，之前做到哪一步的上下文就丢了，用户只想临时插手、做完让机器人继续。

期望的行为与浏览器接管一致：用户接管 → 运行暂停（不是取消，也不是拒绝接管）；用户操作；用户释放 → 运行从暂停处恢复。

## Decision

### 接管时暂停，不再拒绝

`computer/takeover` 在原来会报“Stop the bot first”的位置改成先暂停运行，再按原流程授予用户屏幕控制权：

- 新的辅助函数 `pauseActiveRunForTakeover`（`apps/api/src/computer-control.ts`）复用已有的暂停机制 `deps.events.pauseRunForTakeover`（`packages/db/src/thread-takeover.ts` 的 `pauseRunForTakeover`），不新发明第二套暂停。暂停把运行从 `running` 翻到 `waiting_takeover`，清空 `leaseOwner` / `leaseExpiresAt`，把尝试标为 `waiting_takeover`，并在电脑行上绑 `controlRunId`。
- 暂停需要的 `leaseOwner` / `leaseFence` / `attemptId` 从运行行与它的活动尝试读：运行行提供前两项，尝试取 `status = "running"` 且 `fence` 等于运行 `leaseFence` 的最新一条；对不上就不暂停。
- 暂停结果分四种，调用方按结果办事：
  - `paused`：本次调用暂停了运行，接管响应 `runPaused: true`，授予时把 `controlRunId` 绑到该运行。
  - `waiting`：运行已经是 `waiting_takeover`（机器人先发起了等待，或暂停竞赢了本次调用）：本次没暂停任何东西，`runPaused: false`，但授予仍把 `controlRunId` 绑到该运行，否则释放时恢复不到它。
  - `idle`：运行已结束或已不存在，按空闲接管授予，`runPaused: false`。
  - `changed`：运行仍活动但当前暂停不了（刚被认领、还没跑起来，或尝试已换代）：拒绝，冲突“Computer control changed; try again”，用户重试一次即可。
- 授予后的复核沿用原有逻辑：`takeoverRequested` 为真时复查运行仍在 `ACTIVE_RUN_STATUSES` 里，否则撤回授予。`waiting_takeover` 本来就在该集合里，不用改判断。
- `computer.takeover.granted` 事件的 `takeoverRequested` 随新暂停的运行一起为真，网页的 `reduceComputerStatus` 与释放路径都看得到这次等待。

### 暂停边界：在途动作做完，下一步才停

暂停只清租约，不中断正在执行的工具调用。执行中的回合靠 `runLeaseLost` 的每秒检查发现 `leaseOwner` 已不是自己而中止，在下一个步骤边界停下；正在跑的那次工具调用会做完。这与机器人自己发起暂停时的边界完全一致。

### 释放不用改，直接恢复

`computer/release` 不改。释放走 `releaseComputerControl` → `finalizeComputerControlRelease`：`waiting_takeover` 的运行变回 `queued`、检查点记 `takeover`，再由 `enqueueTakeoverContinuation` 入队 `runContinueJob`。恢复时 `continueRun` 用 `takeoverContinuePlan`，`claimRun` 本来就接受 `waiting_takeover`。前提是授予时 `controlRunId` 已绑到被暂停的运行，上面已保证。

### 仍拒绝的情况

- 别人正持有屏幕控制：`assertNotAnotherPersonsControl` 不变，冲突“Someone else is using this computer”。
- 运行在等另一个人接管：`waitingForTakeover` 且运行属于别人时不变，冲突“The bot is waiting for someone else”。
- 运行属于别人但还在跑：同样拒绝，冲突“Stop the bot first”。别人回合的运行不该由接管方替它暂停；等运行的人自己来接管时才暂停。
- 租约已没、运行已不在：按空闲授予，不拒绝。

### 租约过期与超时

- 用户持有期间租约过期：已有行为不变。`expireComputerControl` 以 `expired` 收尾，运行从 `waiting_takeover` 回到 `queued`、检查点记 `takeover-skipped`，并入队继续执行。相当于用户没做完就跳过，运行按“没做完”继续。
- 30 分钟无人接手的 `waiting_takeover` 由 stuck-work 回收器取消；用户已在屏幕上时（持有控制）不回收。

### 契约与界面

- `computer/takeover` 的输出加 `runPaused: z.boolean()`（`packages/contracts/src/rpc.ts`），含义是“本次调用暂停了一个运行”。每个返回点都带它：已持有控制的分支与竞态恢复分支返回 `false`（它们没暂停任何东西）；正常授予返回实际值。
- 界面不改。运行落在 `waiting_takeover` 且 `controlRunId` 已绑，`computer.takeoverRequested`（即 `Boolean(controlRunId)`）为真，现有界面全部亮起：网页活动列表“Needs takeover”、总览“Needs you”、电脑浮层出现 Skip / I'm done；移动端同样有“Needs takeover” / “Needs you”与释放操作。`runPaused` 目前没有界面消费它，只供调用方区分“这次是我暂停的”。
- `bots.setComputer`（切换电脑模式）里另一处“Stop the bot first”不改：那不是接管流程，切换模式要停掉并重建电脑；已暂停等待恢复的运行也不能换电脑，拒绝仍成立。

## Alternatives considered

- **接管时取消运行**——最简单，停掉再让用户接管。但用户要的是“做完继续”，取消丢掉做到一半的上下文，违背需求。
- **客户端先停机器人再接管**——不用改服务端。但停和接管之间有竞态（停完机器人可能又开始新回合），且“停止”在界面上是破坏性动作；服务端一次暂停加授予是原子意图，客户端拼不出来。
- **新写一套暂停机制（直接改运行状态、不走 `pauseRunForTakeover`）**——少读几张表。但暂停不只是改状态：它要锁电脑、线程、运行三张行，清租约、标尝试、绑 `controlRunId`、发 `computer.takeover.requested` 事件；重写一套必然漏掉其中一环，与机器人发起的暂停分叉。
- **授予时不绑 `controlRunId`，释放时再找运行**——少改授予。但释放靠 `controlRunId` 认领等待的运行；不绑就恢复不到它，界面也不会显示“Needs you”。绑定是恢复的前提，不是装饰。
- **运行属于别人时也替它暂停**——共享空间里接管更顺。但暂停会打断别人的回合，别人回来时运行已被暂停过一次；等待只认运行的发起人，暂停也只认他，与“等待只等那个人”的规则一致。

## Consequences

- **收益**：用户接管不再需要先停机器人；暂停与恢复复用机器人发起等待的同一条路，状态、事件、超时、恢复全是现成行为，不新增状态机。
- **代价与已知上限**：
  - 暂停不是立即生效：在途工具调用做完才停；用户接管后一秒内屏幕上可能还有一次机器人动作的收尾。
  - 刚被认领、还没跑起来的运行暂停不了，第一次接管可能报冲突，重试一次即可。
  - 两个用户同时接管同一台电脑时，先暂停的那次调用可能在授予竞态里落败，响应里 `runPaused` 为 `false`，但运行确实已被暂停；界面的 `waiting_takeover` 状态是准的，以它为准。
  - `runPaused` 是新字段：老客户端不读它，不受影响；新客户端读它时不要把它当成运行状态，运行状态以 `run.status` 为准。

## Verification

- 单元测试 `apps/api/src/computer-control.test.ts`（8 例）：暂停成功、运行已结束为空闲、已在等待为绑定、未跑起来/无尝试/围栏不对为拒绝、暂停失败后重读（仍在跑/已结束/已在等待）、已被释放时为空闲、尝试缺失时按失败处理、其他暂停失败原样抛出。
- 集成测试 `apps/api/src/takeover-chat.postgres.test.ts` 增加 6 例（`setup("running")` 新模式 + `release` 助手）：接管暂停运行（`runPaused: true`、状态 `waiting_takeover`、`controlRunId` 绑定、两事件齐全）、释放后恢复（`queued` + 检查点 `takeover`、继续任务入队）、空闲接管（`runPaused: false`）、别人持有屏幕仍拒绝、运行等别人仍拒绝、别人的活动运行不替它暂停。
- 执行器在 `waiting_takeover` 时不发电脑动作：已有覆盖，不新增测试——`takeoverContinuePlan` 对 `waiting_takeover` 返回 `heldForTakeover: true`（`packages/adapters/src/takeover-resume.test.ts`），执行器据此关掉图形工具与页面浏览器（`executor.ts` 的 `graphicalToolsAllowed` / `pageBrowserAllowed`），回合靠 `runLeaseLost` 中止（`packages/adapters/src/run-turn-stop.test.ts`）。
- 本机实测：单元测试与相关套件全过；Postgres 集成套件本机无数据库服务，36 例全部跳过，未在本机执行，需在有数据库的环境或 CI 里跑。
- 类型检查：改动文件无新增错误；`apps/api` 全量检查仅剩 2 处与本次无关的既有错误（`packages/adapters/src/voice-factory.ts` 的 `preset` 属性，基线提交上同样存在）。
- 待上线后核实：真机上机器人跑着时接管，确认在途动作收尾后机器人停手、界面显示“Needs you”、释放后机器人从暂停处继续；再确认租约过期后运行按“跳过”恢复。
