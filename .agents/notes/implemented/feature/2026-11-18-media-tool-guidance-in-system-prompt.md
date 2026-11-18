# Agent Note: 系统提示词指引聊天模型用媒体工具，不要自己写脚本调媒体接口

Status: implemented

## Problem

2026-11-18 两次网页版真聊天验证（异步修复部署前与部署后各一次）：用户说“生成一段视频”后，聊天模型两次都没调 `generate_video`，而是自己写脚本直调媒体商接口，模型名还编错了；任务建了但轮询卡在排队，第二次还撞上 429 与流空闲超时，最后都没视频挂进对话。

异步视频修复（[机器人视频模型走异步视频生成接口，不走聊天接口](../../implemented/feature/2026-11-18-async-video-generation-for-bot-media.md)）已把工具执行侧修通：提交、轮询、后台按机器人解析提供方、测试走异步探测都已就位。但工具没被调用到，异步路径一次都没走到——执行侧修通不等于模型会用。

只读调查确认了三点：

- `userTurnInstructions` 从没提过 `generate_image` / `generate_video`。提示词给 `render_plot`、`save_page`、`add_mcp_server` 等工具都写了“用户要 X 时就调 Y”的指引，媒体工具一条都没有；模型收到的全部信息只剩工具定义里的一行描述。
- 同一份提示词反而大力推模型走 shell 与文件 DIY，还把托管凭证作为环境变量交给 shell。模型既有手段又有鼓励，走“自己写脚本直调接口”这条路。
- `generate_video` 的工具描述比生图绕：用词是“Submit”不是“Generate”，还塞了 `jobId` / polling 这些运行时内部机制；弱模型容易被绕晕。

生图在 19:03 的真聊里成功过一次，证明模型有时能调媒体工具，问题是选型不稳，不是彻底不能调。

## Decision

只做两处改动，不动强制工具选择、审批与主模型：

- `userTurnInstructions` 里有媒体指引，仿照 `render_plot` 的 `offeredBuiltinClause` 写法，按工具分别设 clause，仅当工具未被禁用时出现：用户要图片时调 `generate_image`、要视频时调 `generate_video`，只传 prompt；不要自己写脚本、不要直接调任何媒体商的接口、不要自己编模型名。
- `generate_video` 的工具描述与生图平行，不提 `jobId` / polling：生图是“Generate one image from a prompt and attach it to chat.”，视频是“Generate a short video from a prompt and attach it to chat when ready. Pass only the prompt.”，同时保留“可能产生费用、失败不要自动重提”的语义。

## Alternatives considered

- **强制工具选择（用户说“生成视频”就强制调工具）** — 最稳；但这是行为改动，涉及关键词路由与回退，先做提示词与描述这两处低风险改动，部署后真聊验证效果再评估是否需要。
- **改审批：媒体工具默认需审批，shell 免审批** — 工具路径摩擦更大是事实；但两次实测里从没出现过审批卡，模型根本没调过工具，审批不是当前瓶颈。不动。
- **换主模型（工具调用更稳的模型）** — 长期选项；但换模型是选型与成本决定，不在这次改动里。
- **只改工具描述，不加提示词指引** — 描述只有一行字，弱模型在约 90 个工具里仍可能选不到；提示词指引是把“要视频就调工具”写进系统级规则，两者互补，单做一处不够。
- **不做，等模型自己学会** — 两次真聊已证明不会：DIY 路径有 shell 捷径加持，不拦就一直走。

## Consequences

- 用户要图/视频时，系统提示词现在明确把请求映射到媒体工具，并直接堵住观察到的绕路行为（自己写脚本、直调媒体商接口、自己编模型名）。
- 提示词指引不保证弱模型每次都照做：模型仍可能选 shell。效果要靠部署后的真聊验证；若仍不调，下一步再评估强制工具选择。
- 指引只覆盖“用户要图/视频”的显式请求；模型在其他场景下仍可能自己写脚本调媒体接口。
- `offeredBuiltinClause` 只按禁用集合 gating，不感知媒体能力开关：机器人没配视频模型时，指引仍可能出现（与 `render_plot` 等现有 clause 的行为一致）；能力 gating 仍由工具选择层负责。
- 部署后真聊天验证待做：用户说“生成一段视频”时模型调 `generate_video`，视频挂进对话（部署与真测不在本次提交内）。

## Testing

- 一次性脚本验证：指引在工具提供时出现、禁用时省略；`generate_video` 描述不含 `jobId` / polling。
- 相关测试 8 个文件 434 通过，4 个失败与基线同名同因（`executor.test.ts` 里 `userTurnInstructions` 的 4 个测试在改动前已失败，期望里缺了模型连接那几条 clause），无新增失败。
