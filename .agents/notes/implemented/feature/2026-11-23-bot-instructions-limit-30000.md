# Agent Note: 机器人人设与提示词模板上限提到 30000 字符

Status: implemented

## Problem

机器人 instructions 与提示词模板共用 `BOT_INSTRUCTIONS_MAX_LENGTH` 上限 20000 字符。一篇约 21000 字符的人设全文放不进新建的人设模板，创建时直接被校验拒绝。

## Decision

`packages/contracts/src/domain.ts` 里的 `BOT_INSTRUCTIONS_MAX_LENGTH` 现在是 30000。模板正文、机器人 instructions、agent-import 校验、网页与 App 编辑器的 maxLength 共用这一个常量，所以只改这一处就全线放宽。数据库列是 String，不需要迁移。

## Alternatives considered

- 保持 20000、压缩人设：最强的理由是不用改代码、不用重新部署；没用，因为用户明确要求提示词不压缩，压缩等于丢功能。
- 把人设拆进 instructions 与 description 两个字段：最强的理由是不用改上限也能塞下全文；没用，description 会在界面列表里展示，拆开后同一篇提示词变成两处维护，且两者都进系统提示词，省不下 token，只是换了个地方放。
- 只放宽模板、不放宽机器人 instructions：最强的理由是收窄影响面；没用，两个入口共用同一个常量与同一套校验，拆常量等于多造一个平行的上限，日后必有人只改一处。

## Consequences

- 收益：21000 字符级的人设模板与机器人人设可以直接创建，不再被校验挡住；改动只有一个常量，无迁移、无新配置。
- 代价：每轮进系统提示词的人设更长，单轮 token 上限变高；上限是上限不是默认值，不用长人设的机器人不受影响。
- 边界：30000 只放宽长度校验，不改变技能目录、提示词缓存与任何加载逻辑。
