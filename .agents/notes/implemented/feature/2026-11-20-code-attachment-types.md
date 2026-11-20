# Agent Note: 聊天发不了 .py/.js 文件——附件白名单里没有代码后缀

Status: implemented

## Problem

2026-11-20 19:40 用户报：让机器人在对话里发一个 xxx.py 文件，对话提示“聊天不支持直接传 .py”。

代码里核实过的根因（不是模型瞎说的）：附件类型是一张封闭白名单，`.py`、`.js` 等代码后缀根本不在里面。

- `packages/core/src/attachments.ts` 的 `EXTENSION_MIME_TYPES` 只有媒体、Office 文档、txt/md/csv/html/json/zip，没有任何代码后缀。
- `packages/contracts/src/attachments.ts` 的 `ATTACHMENT_FILE_MIME_TYPES` 同样没有代码类 MIME 类型。
- 机器人调 `attach_file` 发 xxx.py 时，`attachWorkspaceFileToThread`（`packages/adapters/src/thread-artifacts.ts`）先调 `inferAttachmentMimeType("xxx.py")`，拿不到 MIME 就抛 `Unsupported attachment type for xxx.py`，工具把这句错回给模型，模型就跟用户说聊天不支持直接传 .py。
- 同一个 `inferAttachmentMimeType` 也是用户上传的关口（`apps/api/src/artifacts.ts`、`apps/web/src/lib/prepare-image.ts`），所以用户自己也传不上去 .py/.js，不只是机器人发不出来。

## Decision

在共享白名单里加代码后缀，一处改动同时打通机器人发文件和用户上传两条路：

- `packages/contracts/src/attachments.ts`：`ATTACHMENT_FILE_MIME_TYPES` 里加代码类 MIME 类型。
- `packages/core/src/attachments.ts`：`EXTENSION_MIME_TYPES` 里加后缀 → MIME 的映射，`MIME_TYPE_EXTENSIONS` 里加反向映射（文件卡片上的类型徽章用，如 PY、JS）。
- 后缀尽量用 `text/*` 或已在 `TEXT_APPLICATION_MIME_TYPES` 里的类型（`application/javascript`、`application/x-sh`、`application/xml`、`application/yaml`、`application/sql`），这样 `artifactPreviewKind` 一律返回 `text`，文件卡片能内联预览代码，不用再改预览逻辑。
- 覆盖的后缀：.py .js .mjs .cjs .jsx .ts .tsx .mts .cts .sh .bash .zsh .css .scss .xml .yaml .yml .toml .sql .go .rs .java .c .h .cpp .cc .hpp .rb .php .swift .kt .kts .lua .pl .ini .cfg。
- 故意不加 `.env`：文件名以点开头、内容常含密钥，不鼓励当附件传；真要传可以用 .txt 改名。

## Alternatives considered

- 只加 .py/.js 两个用户点名的后缀：修得最少，但 .ts/.sh 明天一样会撞上同一堵墙，一次加齐更干净。
- 把未知后缀一律当 `text/plain` 放行：改动最小，但文件卡片徽章全变 TXT、类型信息丢了，而且等于把白名单废了（任意后缀都能进）。封闭白名单是原设计，留着。
- 让模型把代码贴代码块里了事：用户要的就是文件（下载、存档、直接跑），代码块满足不了。

## Consequences

- 机器人能发代码文件了：`write_file` 写 xxx.py 后 `attach_file` 不再报不支持类型，对话里出现带下载的文件卡片，可内联预览。
- 用户也能直接上传 .py/.js 等代码文件，走同一张白名单。
- 白名单仍是封闭的：不在表里的后缀（如 .exe、二进制）照样被拒，附件类型没有失控。
- 旧文件不受影响：已存的附件 MIME 不变，只是新后缀现在能进了。

## Verification

- 单测：`inferAttachmentMimeType("x.py")`、`inferAttachmentMimeType("x.js")` 等返回对应 MIME；`validateAttachmentMimeType` 通过；`artifactPreviewKind` 返回 `text`。
- 部署后网页实测：让 New Bot 写一个 xxx.py 并 attach，确认对话里出现文件卡片、能预览、能下载；再从网页上传一个 .py 文件，确认能发上去。
