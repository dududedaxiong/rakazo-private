# Agent Note: App 备选模型列表左滑移除

Status: implemented

## Problem

对话页「其他模型」底表（`ThreadMediaModelSheet`）里的五张备选列表（生图、生图编辑、视频、视频编辑、翻译）只能添加、不能移除：每行点一下只打开选模型器换模型，「添加备用」行也只进选模型器。用户想删掉一个配错的备选，只能去机器人设置页找移除按钮，或者在选模型器里左滑——而选模型器里的左滑删的是连接里的模型（`removeModelFromConnection`），会把该模型从这个连接下所有地方都下掉，语义比“从这张列表里去掉一行”重得多。

另外两处已有移除入口，不在本批：成员模型设置页（设置 → 模型）每行右边的 `•••` 菜单里有移除；机器人设置页每行已有可见的移除按钮。

## Decision

只在「其他模型」底表上加左滑移除，语义是“从这张备选列表里去掉这一行”，不动连接、不动其他机器人：

- 备选行（`modelList` 里编号的 fallback 行）包一层 `react-native-gesture-handler` 的 `Swipeable`，左滑露出红色移除按钮，点后调新的 `onRemoveModel(list, entry)`。主模型行不包——主模型移除仍走选模型器那条路（删连接里的模型、下一位自动升主），本批不改。
- `thread-screen` 里一个 `removeBotModel` 处理五张列表：按 `list` 取对应字段（`videoModels` / `imageModels` / `videoEditModels` / `imageEditModels` / `translationModels`），过滤掉该条后 `bots/update` 保存，再 `refreshMentionBots()` 刷新底表。行在刷新后消失，不做乐观更新——与该文件里其他底表保存（翻译源语言、预设、保存目录）同一写法。
- 移除按钮样式照抄 `ModelPickerList` 的左滑移除：宽 88、`destructiveFill` 底、`destructiveForeground` 的 `Remove` 字。颜色走底表已有的 `mobileTokens()`，不新引 `useMobileTokens`。
- 文案不新增：复用 `t("Remove")`，App 的 `t()` 缺翻译时回落英文，与选模型器里同一个按钮完全一致。

## Alternatives considered

- **iOS 用 SwiftUI `SwipeActions`，Android 用 RNGH**：收件箱就是这么做的，但那是整行包进一行的 SwiftUI `List` 才有的系统手势，要量行高、包 `Host`、`RNHostView`，为底表五张列表各套一层代价太大；选模型器里模型行左滑移除的先例就是两端共用 RNGH `Swipeable`，本批沿用它。
- **复用选模型器的连接级移除**：最强的理由是零新代码——备选行点开选模型器、左滑就能删。但它删的是连接里的模型：同一个模型配在别的机器人或别的列表里也会一起消失，用户要的只是“这张列表不要这一行”。语义不对，否掉。
- **每行直接放一个可见的移除按钮**：最直观，但五张列表每行都多一个按钮，行会变挤；左滑把移除藏进手势，行面保持干净，也与选模型器已有的手势一致。
- **成员模型设置页也加左滑**：那里的移除已在每行 `•••` 菜单里，只是藏得深；本批只补真正缺入口的底表。用户若也要那边的左滑，另起一批。

## Consequences

- `ThreadMediaModelSheet` 新增必填 prop `onRemoveModel`，唯一调用点是 `thread-screen`；单测里 `react-native-gesture-handler` 的 `Swipeable` 按 `chat-model-picker.test.tsx` 的既有写法 mock 成直通渲染（子内容 + 右侧动作都渲染出来，按钮可点）。
- 移除只改机器人自己的五张列表字段，不动服务端、不新增 RPC、不做迁移；删空一张列表是合法状态（主模型行显示 `Not set`，与选模型器里选空间默认清空列表一致）。
- App 端改动，随下个 EAS 包才到用户手机；服务端不用部署。
- 遗留：`t("Remove")` 在 App 各语种里没有“移除”的翻译，中文界面上按钮显示英文 `Remove`，与选模型器里同一个按钮现状相同；要改中文文案时两处一起改，不在本批。
