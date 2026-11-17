# Agent Note: 邀请码支持自定义与专属推广码

Status: implemented

## Problem

邀请码只能由服务端随机生成（`generateInviteCode`，无歧义字母表、12 位），管理员在管理页只能选数量与有效期，没法给某个人或某个渠道起一个好记的码；新用户注册后也没有自己的码可以发给朋友。

## Decision

### 管理员生成自定义码

- 契约 `InviteCodeCreateInputSchema` 有可选字段 `codes: z.array(z.string().max(64)).max(100).optional()`（自定义码列表；每项只做长度上限，真正的字符集规则在服务端校验）。
- 每个自定义码先按现有 `normalizeInviteCode` 处理（去空格、转大写），然后必须全部落在生成码用的无歧义字母表内、长度 4–32；空项直接忽略。规则在 `packages/auth/src/invite-codes.ts`：`INVITE_CODE_ALPHABET` 已导出，`normalizeCustomInviteCode(raw)` 合法返回归一化后的码，不合法返回 null，长度常量一并导出。
- `inviteCodes.create` 里 `input.codes` 非空时走自定义批量分支：逐个归一化校验（第一个不合格的码报 BAD_REQUEST 并指明是哪个码）；列表内归一化后去重，出现重复报 BAD_REQUEST 并指明是哪个码；再用 `findMany({ code: { in: [...] } })` 与库里已有码查重，冲突报 CONFLICT 并指明是哪个码；全部校验通过后在一个事务里逐个写入，一个码不合格则整批不建；写入时 `code` 列已有 `@unique` 约束，仍捕获 `isUniqueViolation`（P2002）转抛同样的 CONFLICT 作为竞态兜底。`codes` 为空或不传时保持现有随机批量行为不变（`count` 只在随机分支里用；自定义分支忽略 `count`）。
- 生成弹窗的自定义码输入框是单行输入，多个码用逗号分开（中英文逗号都支持）；旁边一个「Generate random」按钮，点一下生成一个随机 12 位码追加进输入框（网页端不依赖 `@rakazo_mickvvw/auth`，字母表在组件里用同值常量并注明与服务端 `INVITE_CODE_ALPHABET` 保持一致）。一次提交建的就是输入框里的全部码——手填的与按钮追加的随机码可以在同一批里；自定义留空时按数量随机批量生成；填了自定义码就禁用数量输入。重名与非法错误走现有 `toast` 机制显示。

### 推广码设置（管理页注册设置，与邀请码开关同一处）

- `DeploymentSettings` 有两个字段（迁移 `20261202121800_referral_codes`）：`referralCodeEnabled Boolean @default(true)`（推广码开关，默认开）、`referralCodeMaxUses Int @default(10)`（推广码有效次数，正整数，默认 10）。
- `packages/auth/src/registration-limits.ts` 的 `RegistrationSettings` 与 `DEFAULT_REGISTRATION_SETTINGS` 有同样两个字段；`readSignupSettings` 按既有 `??` 兜底模式映射（旧行或测试替身缺字段时落到默认值，不关闭注册）。
- 契约 `RegistrationSettingsSchema` / `RegistrationSettingsUpdateSchema` 有这两个字段（更新时 `referralCodeMaxUses` 限 1–100）；管理页注册设置 `registrationSettings.get/update` 透传；前端注册设置页在邀请码开关同一处有两个控件（开关 + 次数输入，次数越界时截断到 1–100、不合法时回落到已保存的值），随现有保存按钮一起提交。

### 专属推广码的发放

- 新用户注册成功（邀请码验证通过、账号建好）后，后端在 `packages/auth/src/index.ts` 的 `user.create.after` 里、现有记账 `try/catch` 内（`recordRegistration` + `linkInviteCodeRedemption` 同处，失败记日志不阻断注册），自动给他建一个专属码：`createdById = 新用户`、随机 12 位码、`maxUses = referralCodeMaxUses 的当前值`、不过期（`expiresAt` 空）、`isReferral = true`。
- 发放逻辑是 `invite-codes.ts` 的 `issueReferralCode(prisma, userId, settings)`：开关关时返回 null（注册不再自动发码）；先 `findFirst({ createdById, isReferral: true })` 去重，已有就直接返回；否则创建；创建撞唯一约束时重试一次（先再查一次去重，再用新随机码建）。
- **一人一个码，用完即止**：专属码用完后不自动补发，也不提供重新生成。

### 区分推广码

- `InviteCode` 有 `isReferral Boolean @default(false)`（同一迁移）；自动发的专属码建的时候置 true，管理员生成的码保持 false。
- 契约 `InviteCodeSchema` 有 `isReferral: z.boolean()`；管理页邀请码列表里 `isReferral` 的行有一个「Referral」小徽标。

### 推广码用完自动撤销（只针对推广码）

- `holdInviteCode` 里，在原有带 `usedCount` 守卫的 `updateMany` 中，预先算好 `row.isReferral && row.usedCount + 1 >= row.maxUses`，为真时同一条更新里把 `revokedAt` 置为当前时间——码立即失效，管理列表状态变「已撤销」。因为守卫钉住了 `usedCount` 的旧值，预先算好的「是否到顶」在更新成功时一定准确，撤销与扣次是同一原子操作，中间没有「用完但还没撤销」的窗口。
- 不做硬删：撤销只置 `revokedAt`，`InviteCodeRedemption` 的使用记录保留备查（删码会级联抹掉谁用过码的记录）。
- 管理员生成的码保持现有行为：用完显示「用完」（`exhausted`），不自动撤销。

### 开关对兑换的门禁

- `checkInviteCode` 与 `holdInviteCode` 都感知开关与码的种类：新增 `InviteCodeProblem` 值 `"referral_disabled"`，码是推广码（`isReferral`）且开关关时返回它。开关值顺着现有注册流程传：`effectiveSignupPolicy` 从 `readSignupSettings` 读到的设置里带上 `referralCodeEnabled`，调用处（发码预检、两处 hold）把它传进去，不另起炉灶读设置。调用方对非成功值都走现有通用处理（发码预检回通用成功防泄露；注册报通用 `INVALID_INVITE_CODE`），用户侧看不到「推广码已关」的区别。
- 管理员生成的码不受推广开关影响（`isReferral` 为 false 的码不走这条门禁）。

### Deferred（本批不做，后续再做）

- 用户侧查「我的邀请码」的接口与网页/App 展示（可看可复制）。
- 老用户（功能上线前已注册的）首次查看时补建专属码（lazy 创建），复用 `issueReferralCode` 的去重逻辑。
- 上面两项做成后，「我的邀请码」页用完后只提示已用完（显示已用次数），不加补发或重新生成功能。

## Alternatives considered

- 一次只建一个自定义码（`code?: string`）。最强的理由：API 与界面都最简单，一次一码没有批量校验的复杂度。不用：用户明确纠正——要一次设定多个自定义码（比如给某个渠道贴一列码），单码接口逼管理员逐个建，批量才是这次的需求。
- 填了 `codes` 时要求 `count` 必须为 1，否则报错。最强的理由：契约明确，不静默忽略调用方传进来的参数。不用：前端填了自定义码就禁用数量输入，误传的场景只剩直接调 API；忽略 `count` 让随机批量路径的契约完全不动，改动面只多一个可选字段。
- `count` 在有自定义码时仍生效（表示「再随机生成 N 个」）。最强的理由：一次提交真的能同时建自定义码与随机码，不用点 N 次随机按钮。不用：那样「随机生成」按钮就多余了——数量输入本身就是随机批量的入口；而且 `count` 最小值是 1，只想建自定义码时会被迫多出一个随机码（要把最小值改成 0 才能表达「只要自定义」），改动了现有随机批量契约。最终形态：数量输入只控制「自定义留空时」的随机批量；随机按钮是往自定义列表里追加一个码的入口，两者不冲突。
- 随机按钮调服务端生成。最强的理由：随机码由服务端唯一来源生成，不会在网页端复制字母表。不用：没有现成的只生成不保存的接口，为按钮新开一个接口只为填输入框是多余的往返；网页端用同值常量生成、提交时服务端再按同一规则校验，非法码到不了库里。
- 在 zod schema 里做字符集校验（transform + pipe）。最强的理由：输入校验失败自动变成 BAD_REQUEST，不用在 handler 里手写。不用：字母表在 `packages/auth`，契约层（contracts）去 import 逻辑层会倒置分层；把规则留在 auth 里，与 `generateInviteCode` 同一处，是一份来源。
- 写入前不查重名，只靠捕获 P2002。最强的理由：少一次查询，竞态下反正要靠唯一约束兜底。不用：P2002 的报错里只有字段名、没有是哪个码的值，满足不了「冲突要指明是哪个码」；先 `findMany` 查重，常见重名能直接点名，P2002 只留作竞态兜底。
- 自定义码允许任意字符。最强的理由：用户想用什么就用什么，限制越少越自由。不用：生成码刻意避开易混字符（0/O、1/I、L）就是为了能电话里读出来；自定义码放宽字符集会破坏这一条，还会让大小写归一化后的匹配行为不一致。
- 撤销用第二条 `updateMany`、与扣次放同一事务。最强的理由：条件写在 `where` 里更直观。不用：守卫已钉住 `usedCount` 旧值，预先算好的到顶判断在更新成功时一定准确，单条更新就是同一原子操作，还少一次往返。
- 撤销用原生 SQL 的 `CASE WHEN`。最强的理由：字面意义上的单条语句条件更新。不用：代码库其余地方都走 Prisma client，为这一处引入 `$executeRaw` 是例外；单条带守卫的 `updateMany` 已是同一原子操作。
- 给推广码加部分唯一索引 `UNIQUE (createdById) WHERE isReferral`。最强的理由：数据库层兜底「一人一个」，连未来 lazy 创建的并发竞态也防住。不用：发码只发生在单次用户创建的 hook 里，并发双建在实践中到不了；`issueReferralCode` 的先查后建是唯一的发码口，后续 lazy 创建复用同一函数，索引是多余的迁移面。
- 用完的推广码硬删。最强的理由：码没用了，留着占地方。不用：删码会级联删掉 `InviteCodeRedemption`，谁用过这个码的记录就没了；撤销保留记录备查，码本身也不可再用。
- 开关关时 `checkInviteCode` 对推广码回 `not_found`。最强的理由：对外不区分原因，信息泄露面最小。不用：服务端自己的测试与日志需要区分「码不存在」与「推广码已关」；用户侧的报错仍是通用 `INVALID_INVITE_CODE`，没有多泄露。
- 专属码次数写死 10。最强的理由：简单，需求最初就是这么说的。不用：用户后来明确要把次数放进设置里控制，开关关时还要能停发；写死就改不了。
- 本批就做 lazy 创建与「我的邀请码」展示。最强的理由：老用户现在就没有码，晚做就晚有。不用：用户定了范围——展示后续再加，本批只做发放与管理侧。

## Consequences

- 管理员能一次建多个自定义码（逗号分隔），注册时输入大小写不敏感；随机按钮追加的码与手填的码可混在同一批提交；自定义留空时按数量随机批量；其中一个码重名或非法，整批都不建，错误指明是哪个码。
- 注册成功后新用户自动有一个专属推广码（`maxUses` 为设置当前值、不过期、`isReferral`）；开关关时不发；每人只有一个；发码失败不阻断注册。
- 推广码用完最后一次后自动撤销且不可再用，使用记录保留；管理码用完只显示用完。开关关时推广码注册被拒，管理码仍可用；管理列表能认出推广码。
- 迁移是加列（均有默认值），旧版代码不读不写新列，滚动部署安全；`isReferral` 默认 false，老码与管理码都不受影响。
- 自定义码最短 4 位，比 12 位随机码好猜；但邀请码只是注册门禁的一层，后面还有 IP 注册限额与邮箱验证，且只有管理员能建码。
- 专属码用完即止、不补发：用户把次数用完后就没有推广码了，这是用户定下的规则，不是 bug；后续展示页不要「重新生成」。
- 随机批量路径一行不动，回归面只在新增分支与 hold 的撤销判断。

## Verification

- `pnpm verify-notes` 通过（18 篇）。
- 单元与集成测试：auth + api 管理路由 + api 注册限额 + web 管理组件 19 文件 317 测试全过；contracts + api router 50 文件 1406 测试全过。
- `tsc --noEmit`：auth、contracts 干净；api、web 各有既有报错（均在本次未动的文件里：adapters 的 `voice-factory.ts` 缺 `preset` 属性；web 两处测试的机器人类型缺媒体目录字段），与本次改动无关。
- 迁移只在本地做过 `prisma validate` 与 `prisma generate`，没有真实数据库可跑迁移；部署时按正常流程走 `prisma migrate deploy`。
- UI 改动未做截图复核（本环境无 live 浏览器）；改动面是两个管理页的输入框、按钮与徽标，无新增说明文案。
