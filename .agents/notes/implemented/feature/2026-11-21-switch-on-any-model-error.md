# Agent Note: 模型报错就切，不再按错误分类拦

Status: implemented

## Problem

2026-11-21 一轮对话在第一个模型上直接失败，没有发生任何切换：提供方返回 400 `content_filter`，文案是“内容审核未能完成（余额不足，请充值后再试）”。当时先按分类器修了一版（[余额不足的 400（中文措辞）也切换模型](../bug-fix/2026-11-21-balance-400-switches-model.md)：`EXHAUSTION_SIGNAL` 补中文耗尽措辞），但用户 09:26 直接定了更彻底的规则：“模型报错时就切，不要管提供商”。

先核实了报错的到达路径，再动手：提供方报错无论以 error 事件到达、还是在流里抛错，`observedPiStream`（`packages/adapters/src/pi-usage.ts`）都会把它转成 `{ type: "error" }` 事件推给切换层，并经 `onProviderError` 把它的 content 登记进 `providerFailures`——所以 `isProviderFailure(event.error)` 对这类报错恒为真，切换门里唯一拦路的就是错误分类本身。

这篇翻转了两处决定：[模型切换缺口补齐](./2026-11-20-model-fallback-gaps.md) §8 的“400 / 403 / 模型不存在等不可切换错误、分类器不动”与它的 Alternatives 里“放宽 `isRetryableProviderUnavailable`，让 400 / 403 / 模型不存在也切换——否掉”；以及同日余额 400 那篇的“只放行明确说耗尽的 400”。否掉的理由当时是“这类错对池子里每个模型都会一样报，切换只会白烧整个池子”——用户现在明确接受这个代价：一次都没回的对话，比烧掉池子更糟。

## Decision

聊天与电脑操作走的 `fallbackAwareModelStream`（`packages/adapters/src/pi-runtime-fallback.ts`），无可见输出的 error 分支里，切换条件从

`isProviderFailure && (requestLimitTooSmall || isRetryableProviderUnavailable || isModelCredentialRejected)`

改成只剩 `isProviderFailure(event.error)`。`isRetryableProviderUnavailable` 与 `isModelCredentialRejected` 的 import 随之删掉。

不动的边界：

- 还没出内容才切。已经写了一半再报错的，仍走原来的续写（cut-reply continuation）：切过去会把已写的内容丢掉。
- 用户点了停，永不切（`signalAborted` 守卫在先）。
- 只认提供方报错（`isProviderFailure` 保留）：本地前置错误（建流时抛的 `MODEL_IMAGE_INPUT_ERROR`、额度预留/记账超时之类）不是模型报错，切模型修不好它，也不该掩盖真实原因。
- 工具调用已经开始的不切：工具已经跑了，切过去没法算清。
- 上下文超长的缩窗重启（`sizingFailure`）不动，它在切换分支之前跑；卡住不动的切换（首字 60 秒、途中 30 秒）也不动。
- 池子耗尽后同模型重试的判断不动：`isTransientModelError` 仍用分类器，所以余额 400 那篇的分类器改动要保留——池子走完时，中文耗尽错仍不该在同一个模型上重试。
- 媒体链与翻译链不用这个门，不受影响。

## Alternatives considered

- 只放宽分类措辞（余额 400 那篇的做法）：用户明确否掉。分类本身就是他要拿掉的东西，每种新报错措辞都再补一次模式匹配，没完没了。
- 连本地错误也切：否掉。本地错误不是模型报错，切模型修不好，只会把真正的原因藏进切换时间线。
- 可见输出之后的硬错误也切：本次不动。切过去会丢掉已写的内容，续写才是那条路该有的行为；真要改是另一个决定。

## Consequences

- 坏参数、模型不存在、403 拒绝这类错，现在会把整个池子烧完才报失败——这是用户明确接受的代价。切换时间线会记下每一次尝试，烧的过程看得见。
- 8 个旧单测按新规则翻转：`does not retry or switch on …`（4 条，HTTP 403 / permission denied / context_length_exceeded / bad request）改成切备选后报 fallback 诊断；`does not reuse a recovered … call's error on a later failed call`（2 条）改成报诊断里的 `primaryError`（仍是后来那次 400，不是恢复过的 503）；`does not claim exhaustion when an error leaves an untried backup` 改成“走完整个链再报每一次尝试”；`does not switch to the backup on 403 forbidden` 改成切备选。
- 余额 400 那篇的分类器改动保留：它现在只影响池子耗尽后“同模型还重不重试”的判断，不再决定“切不切”。

## Tested

- `packages/adapters/src/pi-runtime-fallback.test.ts`：152/152 过。
- `packages/adapter-kit/src/model-errors.test.ts`：147/147 过（分类器本身未动）。
- Biome 干净。
- 未部署：分类器那提交的构建（run 44849902722）还在跑；本篇是同一分支 `feature/balance-400-switch` 上的第二个提交，需另一次构建与部署。
