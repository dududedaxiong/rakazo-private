# Agent Note: 动态（Activity）模式空 feed 没有空态，开关看起来像坏了

Status: implemented

## Problem

2026-11-20 17:01 网页实测（线上 1849b1d4，New Bot 对话页）：左侧边栏顶行左起第二个铃铛按钮，无障碍名称「动态」，点之前已处于 `[pressed]` 按下状态；点一次只把按下状态切掉，URL 不变，不打开任何面板、页面、信息流或对话框，左侧「最近」列表、中间对话、右侧设置面板均无可见变化；再点一次只切回 `[pressed]`；悬停无 tooltip。页面刚加载时曾出现状态文本「正在加载动态…」，但始终没加载出任何动态内容，feed 区域在全部观察中一直为空。只改代码、测试、推送到新分支，不部署、不触发构建。

## Decision

**先说查到的事实，再说修法。**

### 查到的事实（四条，都在代码里核实过）

**1. 铃铛不是面板开关，它是一个模式开关——“不打开任何东西”是设计，不是接线坏了。** `sidebar-header.tsx` 的按钮只调 `toggleActivityMode`，状态存在 `rakazo.activity-mode`（`lib/activity-mode.ts`，`createStoredPreference`，默认关）。`shell-sidebar.tsx` 里 `activityMode && !mini` 时在 `{roster}` 上面多渲染一个 `<ActivityList/>`，roster（「最近」列表）永远渲染。右面板的 `Panel` 类型里根本没有 activity/notifications 这一项。注释原话是 “Persisted Codex-style recency mode for the sidebar activity sections”——这个模式就是在边栏顶部叠加运行动态分区，不是打开一个通知面板。所以“点了只改按下状态、URL 不变、不开面板”是符合设计的；用户把铃铛当成通知面板，是心智模型与设计不一致，不是按钮接线断了。

**2. 取数接线是通的，失败也没有被悄悄吞掉。** `ActivityList` 用 `useSpaceQueries()` 调 `runs.list`（`filter: "active"` 与 `"recent"` 各一次，`apps/api/src/routes/content.ts` → `listSpaceRuns`），开着时每 15 秒轮询；加载中显示 Spinner（`aria-label` 就是「正在加载动态…」，可见的只有一个转圈、没有文字）；任一查询出错就显示红色错误 + 「Try again」按钮（`role="alert"`）。实测看到加载文本、没看到错误——与“查询已返回”一致，与“取数失败”不一致。服务端 `listSpaceRuns` 的两条路都直接查 `runs` 表（active：未归档、非隐藏 trigger、活动中状态；recent：每对话最新一条已终态运行，上限 20 条），没有会把结果悄悄置空的分支。

**3. 真正的缺陷：空 feed 没有空态，整个组件渲染出来是“什么都没有”。** 两条查询都返回空、又没有未读对话、又没开筛选时，`ActivityList` 的渲染结果是：外层 div 没有底边框（`hasAnyRuns || unreadCount > 0 || filtersOn || filtersExpanded` 全假）、筛选区收起（看不见）、没有错误、没有加载中、四个分区（Needs attention / Working / Unread / Recent）全空——视觉上就是一块空白。边栏在模式开与关时看起来一模一样，开关像是坏了；唯一的瞬时痕迹是加载中的转圈，加载完就消失。这与实测完全吻合：加载文本出现过，随后什么都没有。

**4. 线上 feed 为什么是空的，代码层面定不下来。** 正常对话确实会建 `run` 行（`thread-target.ts` 里 `trigger: "user"` 的创建），`recent` 也应返回每对话最新一条已终态运行，所以天天聊天的用户本应看到 Recent 分区。到底是这个空间里确实没有符合条件的终态运行，还是数据侧另有问题——本机查不到线上库，任务也不允许动 cue，只能等部署后实测：若部署后空态出现、且最近聊过天仍长期是空，那是另一件数据调查，不是这个开关的问题。

另两处实测描述，在代码里没有对应物：**「Notifications alt+T」这个 region/快捷键在代码里不存在**——全仓库搜不到 `Alt+T`（唯一的 Alt 快捷键是 roster 行的 `Alt+ArrowUp Alt+ArrowDown`），也没有名为 Notifications 的 region（`Notifications` 只出现在浏览器通知 hook 与机器人设置的通知设置区，与 feed 无关）。那是核对工具自己的无障碍快照命名，不是代码里的东西，无从修。**悬停无 tooltip**也没有代码证据：按钮包在 `IconTooltip`（label `Activity`）里，与旁边搜索、新建按钮同一套 Base UI Tooltip 写法，接线没错；大概率是悬停停留没到默认延迟。两处都不动。

### 修法

只补空态，不改模式、不改取数、不做面板：`ActivityList` 在“已加载完、无错误、无任何运行、无未读”时渲染一行空态文案，复用已有的 `<Trans>No runs yet</Trans>`（`RoutineRunHistory` 同款，zh-CN「还没有运行记录」、zh-TW 已有译文，不新增 Lingui 文案）。条件与已有的「No runs match these filters.」分支互斥（那条要求 `hasAnyRuns`，空态要求 `!hasAnyRuns`）。外层底边框的条件同步加上空态，让空态那行在视觉上仍是一个分区、与下面的 roster 分开。`role="status"` 与现有分支一致。

## Alternatives considered

- **把铃铛改成打开通知面板**：最强的理由是最贴合用户对铃铛的心智模型，点了就该出现点东西。但这个模式是刻意设计（Codex 风格的边栏动态分区，叠加在 roster 上方），开关本身没坏，坏的是空 feed 没有任何可见反馈；改面板是 UX 改版，不是修这个故障，且会动 `Panel` 类型与右面板路由；不用。
- **新写一条「No activity yet」空态文案**：最强的理由是更精确——feed 除了运行记录还含未读对话。但那是新 msgid，要新跑 extract + 补 zh-CN/zh-TW + compile；`No runs yet` 已有全部译文且同样诚实（feed 的内容就是运行记录，未读对话本来也在下面的 roster 里可见）；不用。
- **查线上库确认 feed 为什么是空的**：最强的理由是能一次定论是“确实没数据”还是“数据侧 bug”。但本批不部署、不动 cue，本机也查不到线上库；空态修好后，部署实测时空态本身就让问题可诊断（最近聊过天仍长期是空 → 再立项查数据）；本批不做。
- **只在笔记里回报“开关是设计使然”，不改代码**：最强的理由是接线确实没断，零改动零风险。但用户看到的故障是真实的——开关点了没有任何可见反馈，空 feed 零文案就是这块缺的拼图；不改代码等于把“看起来坏了”留给用户；不用。
- **加载中也显示文字「正在加载动态…」**：最强的理由是实测里这行字只在无障碍树里出现，肉眼只有一个转圈。但加载态本身没坏（转圈可见、加载完即消失），空态补上后加载态的短暂空白不再是问题；不动。

## Consequences

- 动态模式开着、feed 为空时，边栏顶部出现一行「还没有运行记录」，开关的效果看得见；「空」与「坏了」分得清。
- 有运行记录或未读对话时行为不变（空态条件要求 `!hasAnyRuns && unreadCount === 0`）；筛选无匹配时仍是已有的「No runs match these filters.」。
- 代价：`ActivityList` 多一个渲染分支 + 一条测试；无新文案、无迁移、无 RPC 改动。

## Verification

- 新增 `ActivityList.test.tsx` 一例：两条 `runs.list` 都返回空、bots/groups 均无未读 → 加载清除后出现 `role="status"` 的「No runs yet」；并断言有运行记录时不出现（已有两例覆盖有记录的渲染）。
- `apps/web` tsc 0 错；Biome 改动文件干净；`pnpm verify-notes` 三线全过。
- 未验证：没有 live 浏览器视觉核对（桌面浏览器改不了视口宽、且本批不部署）；部署后须实测两点——空 feed 是否出现空态、以及最近聊过天的情况下 feed 是否长期是空（若是，另立项查数据）。

## Known gaps

- 线上 feed 为空的根因未定（见 Decision §4）：可能是确实无符合条件的终态运行，也可能是数据侧问题；本批只让“空”可见，不做定论。
- 「Notifications alt+T」在代码里不存在，是核对工具的快照命名，不在本批。
- 悬停 tooltip 未在代码里找到缺陷（接线与相邻按钮一致），未动。
