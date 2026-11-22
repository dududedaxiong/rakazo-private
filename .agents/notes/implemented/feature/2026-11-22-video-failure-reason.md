# Agent Note: 视频失败原因进对话——轮询失败也带中文原因

Status: implemented

## Problem

2026-11-20 的失败原因显示（见[媒体失败原因进对话](./2026-11-20-failed-run-reason-display.md)）只做了图片与图片编辑：视频失败至今只有“视频生成失败”四个字，没有具体原因。缺口在[下载按钮那批](./2026-11-21-artifact-download-buttons-everywhere.md)里记为“未做，留给单独一批”，2026-11-21 两次跟用户说好单独做、不拖下载按钮那批。用户 2026-11-22 点头做这批。

原因丢在三层（均已核实代码）：

1. 提供方层：智谱异步轮询 `pollAsyncVideo`（`packages/adapters/src/pi-openai-compatible-provider.ts`）在任务状态 FAIL 时只返回 `{ status: "failed" }`，返回体里有没有原因字段从没读过。
2. 链路层：共享契约 `MediaVideoJob` 的 failed 变体只有 `{ id, status: "failed", modelSwitches? }`，没有原因字段；`BotMediaCallEntry.pollVideo` 的失败态同样只有状态；`generateMediaFromTool` 的视频落点调 `options.onSettled?.(tx, "failed")` 不带原因，返回值 `{ jobId, status }` 也无 error。
3. 轮询层：`pollMediaVideo` 的 `onSettled`（`packages/adapters/src/media-video-poll.ts`）写死 `"Media generation failed."` 再摘要，只能出光秃秃的前缀；wake 跟进也没带原因。超时落点（同文件约 450–469 行）同样只调 `onSettled(tx, "failed")`。

## Decision

### 1. 提供方层：FAIL 也带一个我们自己格式的错误串

`pollAsyncVideo` 在 FAIL 时返回 `{ status: "failed", error }`，其中 error 是 `MediaGenerationError` 的文本：`Media generation: provider_failure — <模型> (provider error)`。摘要器认这个格式，`provider_failure` 无详情时映射成“服务异常”，所以失败行最终是“视频生成失败：cogvideox-flash 服务异常”。

智谱 FAIL 返回体里到底有没有原因字段，已查过三处、都没有：仓库内代码只读 `task_status` 与 `video_result`（2026-11-18 异步视频笔记记的接口形态也是这两项）；智谱公开文档（docs.z.ai 视频生成异步接口）列的返回字段只有 `model`、`id`、`request_id`、`task_status` 与成功时的 `video_result`，FAIL 没有原因字段；仓库测试的 FAIL 体也只有 `task_status`。所以**不编造字段、不推测映射**，先按模型 + 服务异常兜底。若部署后实测到真实 FAIL 返回体里有原因字段，只改 `pollAsyncVideo` 这一处映射，下游不用动。

探针（`probeAsyncVideo`）不动：它只判模型支不支持异步视频，失败详情仍是原来的“视频生成失败”，不展示给用户当失败原因。

### 2. 链路层：失败态加可选 error，onSettled 加可选错误参数

- `MediaVideoJob` 的 failed 变体与 `BotMediaCallEntry.pollVideo` 的失败态各加可选 `error?: string`（`packages/adapter-kit/src/media-generation.ts`、`packages/adapters/src/media-generation-provider.ts`）。只加字段，不改状态机。
- `bot-media-generation.ts` 里模型条目的 `pollVideo` 回调把 `pollAsyncVideo` 的 error 原样透传；`media-generation-provider.ts` 的 `pollVideo` 同样透传。
- `mediaDelivery` 的 `onSettled` 签名（`packages/adapters/src/media-video-poll.ts`）与 `generateMediaFromTool` 的 `onSettled`（`packages/adapters/src/media-generation-tools.ts`）各加可选第三个参数 `error?: string`。视频落点的 settle 事务里把 `output.error` 传过去；`generateMediaFromTool` 的返回值在视频失败时也带上 error（与图片路返回 `{ error }` 对称，供调用方用）。
- 全局提供方（fal 那路）的 `pollVideo` 不动：它的轮询只判失败真假、没有可带的原因，落到轮询层兜底前缀，与改前一致。

### 3. 轮询层：失败行与 wake 跟进都用同一句中文摘要

`pollMediaVideo` 的 `onSettled` 改成 `(tx, status, error?)`：失败时 `summarizeMediaRunError(error ?? "Media generation failed.", { kind: "video", mode })`，摘要进失败行（`postMediaFailureMessage`），同时传进 `queueWake` 已有的 `reason` 参数，机器人跟进也带原因（`Video job <id> failed: <摘要>. …`）。摘要只认我们自己的错误格式，不回显上游原文、不带 key 片段，与图片路同一条规矩。

- 超时落点：`onSettled(tx, "failed", "Media generation: timeout")`，摘要器把 `timeout` 映射成“请求超时”，失败行是“视频生成失败：请求超时”。
- 参考图缺失的视频编辑落点：失败行本来已有摘要（“要编辑的图片不可用”），wake 跟进原来没传原因，本批顺手把摘要传进去，与图片路的 `fail()` 对齐。
- 接收方已不在、过期静默关闭的落点不动：本来就是故意安静的，不追加消息、不发 wake。

### 4. 网页端不动

失败行是一条普通机器人文本消息（`postMediaFailureMessage` 经 `persistMessageInTransaction` 写进对话），网页与手机都按普通消息渲染，原因在服务端摘要里已写好，核实后网页无缺显示，不改网页。`run.failed` 通知也不动：轮询失败本来就不发 `run.failed` 事件（见 11-20 笔记），靠失败行 + wake 通知客户端。

## Alternatives considered

- **读返回体里推测的原因字段（如 error / message / fail_reason）并映射成我们的 code**：最强的对手——万一智谱真给了原因字段，现在不接就永远只能显示“服务异常”。否决：公开文档与仓库里都没有这个字段，映射关系无法验证，编一个字段名就是在赌上游格式；等部署后实测到真实 FAIL 返回体再说，改动只在一处。
- **原样回显上游错误文本**：否决——与 11-20 笔记已定的规矩一致：中文摘要，不露上游原始错误、不带 key 片段；且智谱 FAIL 根本没给可回显的文本。
- **把原因写进 run.error，再由网页的输入框错误条展示**：暂不做——失败行（中文摘要）已是主显示；run.error 的展示面（输入框错误条）与图片路存原文的做法是否一致需另核，不在本批范围。11-20 笔记的架构（失败行是对话自己的记录）不变。
- **客户端从快照的 run.error 渲染失败行**：否决——同 11-20 笔记的理由；且轮询失败时 run.error 本来就是空的，从快照里取不到。

## Consequences

- 视频失败行现在带模型与原因，例如“视频生成失败：cogvideox-flash 服务异常”；超时是“视频生成失败：请求超时”；参考图缺失的视频编辑失败行与跟进都带“要编辑的图片不可用”。机器人跟进不再只说 failed，带同一句摘要，不自动重提。
- 智谱 FAIL 返回体到底有没有原因字段仍未知（文档与仓库里都没有），须部署后实测一次真实失败任务才能定；若发现字段，只改 `pollAsyncVideo` 一处映射。
- 已知缺口（未做）：输入框错误条（`threadRunError` 读 run.error）对轮询失败的视频仍无显示——run.error 本批没写；失败行已带原因，不影响主诉求。全局提供方（fal 那路）轮询失败同样走兜底前缀，无模型名时只有“视频生成失败”四个字。
- 测试：`pollAsyncVideo` FAIL 体断言 error 串；`BotMediaCallEntry.pollVideo` 透传；`generateMediaFromTool` 视频失败落点调 `onSettled` 时带 error；轮询失败原因单测照图片路的同类断言写（`media-video-poll.postgres.test.ts`，Postgres 轮询测试本地无库，跑不了，需 CI）。
