# Agent Note: 关掉模型保存时占用确认：主池与机器人进确认框，备用池静默删

Status: implemented

## Problem

App 提供方模型列表里关掉一个模型再点保存，服务端会拦，报错 “In use by backup models. Pick another model for them first.”。拦截在 `apps/api/src/model-pins.ts` 的 `assertNoDanglingModelPins`，连接保存时调用（`apps/api/src/model-credentials.ts` 的 `verifyModelConnection`）。它查 `compatibleModelPins`：named 是 bot/routine 的主模型 pin，backups 是 `UserModelRoleChoice` 与 `SpaceModelRoleChoice` 的行；只要有一行还指着被关掉的模型、且关掉后没别的连接能提供它，保存就整体拒绝。

用户最终定的流程：

- 备用池占用不进确认框、不拦截：关掉模型保存时，它在备用池里的行直接删掉（静默处理）。
- 主池占用弹确认框：文案点名哪一类的主模型正用着它；点确认保存就移除占用，之后用户手动重设。
- 机器人自己的主模型 pin 也进确认流程：冲突里点名是哪个机器人，点确认保存后清除该机器人的主模型设置，之后用户手动再设。前提是机器人没模型时确实回落到成员主池（已核实，见 Decision）。
- routine（例行任务）仍硬拒绝，不变。
- 移除的是提供商最后一个启用的模型时，确认框里多一句提示：移除后将没有可用模型，请手动补一个。只是提示，不是拦截。
- 确认框出现条件 = 有主池占用（或机器人占用），或是最后一个模型；文案按实际情况拼，只出现适用的行。
- 网页端和 App 端都要上确认框，共用服务端同一个冲突错误和确认标志；所有报错/提示文案全中文。

本篇最初是按“静默自动删备用池”那版写的草稿；用户改了设计后按最终的确认流程就地重写（该草稿未提交过）。

## Decision

服务端（`apps/api/src/model-pins.ts`、`apps/api/src/model-credentials.ts`、`packages/contracts/src/model-connections.ts`）：

- `compatibleModelPins` 的 role 行多取 `pool`，bot 行多取 `id`；named 行打上 kind（`bot` / `routine`），这样拒绝文案能区分机器人与例行任务，确认删除时能定位到具体的机器人。行属哪个池按存的值读，没有值按老规则：position 0 是主池、其余是备用池——与 `packages/db/src/model-roles.ts` 的 `rowPool` 同一条规则。
- `refuseModelPins`（硬拒绝，routine 与改默认模型那条路共用）文案改成中文：bot 叫“机器人 {名}”、routine 叫“例行任务 {名}”、role 行统称“备用模型”；一个名字时用“请先给它换个模型。”，多个时用“请先给它们换个模型。”。服务端直接出中文，不新增翻译条目。
- `assertNoDanglingModelPins` 改成返回待删列表，并收两个选项（`confirmRemovePins`、`removesLastEnabledModel`）：
  - routine 行只要 dangling 就硬拒绝，哪怕带了确认标志也不删。
  - 备用池行永远不拦、不进确认框：直接进待删列表。
  - 主池行与 bot 行：没带确认标志时抛 `CONFLICT` 错误（见下）；带了确认标志时进待删列表。
  - 冲突错误带结构：`data: { reason: "confirm_model_removal", occupancies, removesLastEnabledModel }`，其中 occupancies 是 `{ kind: "bot", name }` 或 `{ kind: "role", role, pool: "main" }`。文案只拼适用的行：占用行是“正被{机器人名/类主模型，、连接}使用。确认保存将移除这些占用，之后请手动重新设定对应模型。”；最后一个模型行是“这是该提供商最后一个模型，移除后将没有可用模型，请手动补一个。”。两行都有时先后拼接；只有最后一个模型时只出现后一句。
  - 类名用界面上已有的叫法：role `main` →“聊天”（即“聊天主模型”）、`approval` →“审批”、“computer” →“电脑操作”；不在这三个里的老 role 行直接用 role 原值当类名。
- “最后一个模型”的判定按用户实际管理的显式列表算：新显式列表为空、且旧显式列表非空。显式列表 = 存的 enabled 列表去掉连接自己的模型（客户端发之前本来就把默认模型从列表里滤掉，服务端保存时再把它并回去，所以“最后一个模型”指的是复选框列表里最后一个能勾的模型）。这里有个实现细节：服务端存的列表永远含连接自己的模型（`enabledOpenAiCompatibleModelIds` 把它并进去，modelId 必填），所以按“存的列表为空”算永远触发不了；按显式列表算才与用户看到的列表一致。确认保存后，提供商的存列表里仍会剩它自己的默认模型——“没有可用模型”是指用户管理的列表空了，不是连接本身没模型。
- 机器人回落已核实：`packages/adapters/src/model-roles.ts` 的 `selectConfiguredModel` 按 override（机器人自己的模型）→ main（成员主池）→ 部署默认选，`override` 为空的注释就是“null follows the main model”；跑批路径 `packages/adapters/src/run-model.ts` 正是这么接线的（override 取机器人模型，main 取 `resolveMemberMainModel`）。所以清除机器人自己的模型后，机器人跑成员主池，不会直接不可用。
- 默认模型核对（用户要求只核对、不改逻辑）：连接自己的默认模型永远被并进存的列表，保存不可能把它留在列表外；成员主池那行如果指着被关的模型，会作为主池占用进确认、确认后删掉，之后成员主模型回落到部署默认，等用户手动重设——不会留一个指着不存在模型的默认。机器人自己的模型被清除后回落到成员主池（上条）。三处都没有悬空引用。
- 待删列表经 `verifyModelConnection` → `connectModelCredential` → `persistModelCredential` 传进 `writeModelCredential`，在同一个 Serializable 事务里删：role 行按（账号或空间、role、提供方、modelId、credentialId）删，并加池守卫（主池：`pool = "main"` 或 `pool IS NULL AND position = 0`；备用池：`pool = "backup"` 或 `pool IS NULL AND position > 0`），所以检查与写之间行被挪池、或被换到别的连接时不会误删；bot 行按 id 批量把 `modelProvider` / `modelId` 置 null。保存失败时池子和机器人都不动；保存成功时占用一定已清。
- 删完 position 出现空缺不用压紧：`getModelRole` 按 position 排序再按池分，空缺不影响读取；下次改那个 role 时 `writeModelRole` 会整体重写 position。
- 确认标志进共享契约：`ModelConnectInputSchema` 加 `confirmRemovePins?: boolean`，App 与网页都发同一个字段；原因常量 `CONFIRM_MODEL_REMOVAL_REASON = "confirm_model_removal"` 也放 contracts，两端用它识别冲突（`code === "CONFLICT"` 且 `data.reason` 对上）。
- `assertCompatibleDefaultChange`（改默认模型那条路）不动；它共用 `refuseModelPins`，所以它的文案也随之变中文，但拦截逻辑本身没动。
- 角色池表里只有 `main` / `approval` / `computer` 三种 role（`ModelRoleSchema` 在写入时校验）；机器人名下的翻译/生图/视频池存在 Bot 行自己的 JSON 字段里，本来就不进这个 assert——关掉的模型只在那些池里时，保存从来就不拦，本次也不动。

客户端：

- 两端共用 `packages/core/src/user-error.ts` 的 `isModelRemovalConflict(error)` 识别冲突（`code === "CONFLICT"` 且 `data.reason === CONFIRM_MODEL_REMOVAL_REASON`），不各写一套判断。
- App：`apps/mobile/lib/model-connect-confirm.ts` 新增 `saveWithModelRemovalConfirmation(input, save, t)`，把一次 `models/connect` 调用包起来：收到可确认的冲突就弹原生 `Alert`（标题用已有的 `t("Save")`，正文直接显示服务端那条中文文案，按钮是已有的 `t("Cancel")` / `t("Save")`），点确认就带 `confirmRemovePins: true` 重调一次；点取消或不是这类错误就原样抛回。两个调用点都走它：`removeModelFromConnection`（三处模型选择器的左滑移除共用）与 `model-connection.tsx` 的表单保存。不新增文案。
- 网页：`use-model-settings.ts` 的 `connectKey` 与 `keepUsableModels` 在收到可确认冲突时不直接报错，而是把服务端文案与重试闭包存下来；`ModelSettingsOverlay.tsx` 在有待确认时渲染现成的 `ConfirmDialog`（标题与确认按钮都用已有的 `<Trans>Save</Trans>`，正文是服务端文案，`variant="default"`，点取消后把文案留在错误行里）。不新增文案，不用跑 Lingui extract。

## Alternatives considered

- 备用池也进确认框：否掉。用户亲口说“备用模型不用”——备用池占用不值得打断用户，静默删掉就是。
- 机器人继续硬拒绝：否掉。回落已核实（见 Decision），清除后机器人跑成员主池，不会不可用；用户也明确点了机器人进确认框。routine 仍硬拒绝，因为例行任务没有“成员主池”可回落。
- “最后一个模型”按存的列表为空算：否掉。服务端保存时永远把连接自己的模型并进列表，存的列表不可能为空——这条判定永远触发不了，也没法写出可跑的测试。按用户实际管理的显式列表（存的列表去掉连接自己的模型）算，才与复选框里看到的一致。
- 在 assert 里直接删行（检查时就删，不进事务）：否掉。assert 在 `persistModelCredential` 的事务之前跑，保存一旦失败（密钥校验、事务冲突），池子已经被改了，保存与删行不再是同一个原子操作。
- 在事务里重新算一遍哪些行该删，不传列表：否掉。要在 `writeModelCredential` 里复刻一遍 `findConnectedModelCredential` 的替换判断，还得把 secret store 传进去；传列表加池守卫已经够用。剩下的竞态（检查与事务之间新建的占用行会留下来、仍指着已关的模型）与代码里已注明的旧竞态是同一条，接受它。
- 两端各写一套确认逻辑：否掉。用户定了两端共用服务端同一个冲突错误和确认标志；客户端只做“识别错误 → 弹框 → 带标志重试”这一层。
- 删完把同池剩余行 position 压紧：否掉。读取容忍空缺，压紧是多余的写；下次正常改 role 时 position 本来就会重写。
- 主池行也悄悄删掉：否掉。主模型被换掉决定了对话用什么模型跑，静默换掉后果大，必须让用户在确认框里看到。

## Consequences

- 关掉的模型只在备用池里时，保存直接成功，相关行在同一事务里消失；不用再先去每个备用列表里手动换掉，也不弹框。
- 关掉的模型在主池里、或是某个机器人自己的主模型时，保存先回一个中文冲突（点名占用 + 是不是最后一个模型）；App 弹原生 Alert、网页弹 ConfirmDialog；点确认后同一事务里删掉占用并保存成功，之后用户手动重设对应模型；点取消则什么都不变。
- 关掉的模型是某个例行任务的主模型时，保存仍硬拒绝（中文，点名是哪个例行任务），哪怕带了确认标志也不删。
- 拒绝文案改中文影响两处调用方：连接保存与改默认模型（共用 `refuseModelPins`），后者的拦截逻辑本身没动。
- 机器人自己的模型被清除后跑成员主池；成员主池被清空后跑部署默认；连接自己的默认模型永远在存的列表里——三处都没有悬空引用。

## Tested

- 服务端 `apps/api/src/router.test.ts`：`openai-compatible enabled models` 一组 40/40，整文件 399/399。新用例：不带确认标志回 409 冲突（同时占用机器人 + 审批主池，中文文案点名占用，`data` 的 reason/occupancies/removesLastEnabledModel 对上）；只有最后一个模型时冲突只有最后一句；带标志后清空列表保存成功；备用池行静默删且保存成功（账号级与空间级各一）；带标志后主池行被删、机器人模型被清、保存成功；routine pin 即使带标志仍 400 拒绝。另有四处旧的 connect 路径机器人拒绝测试按新行为改成冲突；三处“应被忽略的 pin”测试的夹具里多留了一个显式模型，以免新加的“最后一个模型”确认框误触发。
- App：`apps/mobile/lib/model-connect-confirm.test.ts` 5/5（一次保存成功；冲突时弹框、点确认带标志重试；点取消原样抛回不重试；其他失败与别的原因冲突直接透传不弹框）；`apps/mobile/lib/model-removal.test.ts` 14/14。
- 共享判断：`packages/core/src/user-error.test.ts` 含新增的 `isModelRemovalConflict` 用例。以上四个文件合跑 441/441。
- 网页：`apps/web/src/pages/model-settings` 与 `apps/web/src/lib/user-error.test.ts` 36/36。`use-model-settings` 本身没有现成的 hook 测试架子，未新增组件级测试；对话框接线由 tsc 覆盖。
- tsc：contracts、core、web 干净；api 只有 `packages/adapters/src/voice-factory.ts` 的 2 个旧错（基线）；mobile 除 artifact/usage-detail/bot-roster 的旧错外，新测试的 2 处 `possibly undefined` 已修掉。
- Biome `check --write` 跑过全部 16 个改动文件，无剩余问题。
- 未做的验证：网页确认框没有在浏览器里点过（无 live browser）；服务端与客户端的端到端联调待部署后用户在手机/网页上实测。
