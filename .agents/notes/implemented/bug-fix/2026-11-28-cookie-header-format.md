# Agent Note: Cookie 导入接受浏览器直接复制的原始 Cookie 头

Status: implemented

## Problem

用户从浏览器里导出 Cookie 时，拿到的是最直接的那种字符串：`name=value; name=value; ...`（浏览器开发者工具和复制 Cookie 的入口给的就是这个格式）。但导入器只接受 JSON 数组和 Netscape `cookies.txt` 两种格式。原始字符串进了 Netscape 解析器后，每一行被按空白切成 7 段、字段错位，解析出的 Cookie 域名是乱码，再经过域名匹配全部被跳过——用户贴了正确的 Cookie，结果是 0 条导入，还以为是自己贴错了。

这件事接在 [浏览器 Cookie 导入](../feature/2026-11-27-browser-cookie-import.md) 后面：那篇定了 JSON 与 Netscape 两种格式，没覆盖浏览器直接给的原始格式。

## Decision

导入器在 JSON 与 Netscape 之外接受第三种格式：原始 Cookie 头。

- `importBrowserCookies` 保持原有流程（先按 JSON / Netscape 解析，再按域名过滤）。只有当过滤后一条 Cookie 都没剩下、且内容不是 JSON 时，才尝试按原始头解析；解析出 Cookie 就用原始头的结果，否则保留原结果。
- 原始头解析按 `;` 切段，每段按第一个 `=` 切出名字和值（值里可以再含 `=`），名字和值两侧的空白去掉；值原样保留，不解码、不过滤（包括百分号编码的值和字面量 `undefined`）。
- 原始头里没有域名信息：每条 Cookie 的域名直接取本次导入的网站 host（只用于本站，不扩到子域）。没有 `=` 或名字为空的段按「格式不对」跳过；名字必须是 RFC 6265 token（字母数字与 `!#$%&'*+-.^_`|~`），否则按「格式不对」跳过。
- 200 条、64 KB、单值 8192 字符的上限与逐条跳过汇总，和另外两种格式一致。

## Alternatives considered

- 只在界面上提示用户先转成 JSON：最强的理由是零代码改动、解析器不动。但用户每次都要手动转格式，复制出来的东西还得再加工一次；导入器的职责就是接受用户手里的格式，提示只是把成本推给用户。不用。
- 在 `parseCookieExport` 里先猜格式（出现 `;` 就走原始头）：最强的理由是入口唯一、调用方不用改。但 Netscape 文件也可能含 `;`，猜格式会在两种解析间误判；而且原始头需要域名、解析入口本身不知道域名，猜了也补不上。改在有域名信息的 `importBrowserCookies` 里兜底更稳。不用。
- 把原始头解析放在 Netscape 之前：最强的理由是原始头更常见、先试它更快。但 Netscape 单行（只有一条 Cookie 的文件）与原始头难以区分，先试原始头会把 Netscape 单行误解析；保持 Netscape 优先、原始头只作兜底，不动已有格式的解析结果。不用。

## Consequences

- 用户从浏览器复制的原始 Cookie 字符串可以直接粘贴导入，不用再转 JSON 或 Netscape。
- JSON 与 Netscape 的解析路径完全不动：JSON 永远不走兜底；Netscape 能解析出可用 Cookie 时不走兜底；Netscape 全被域名过滤掉时，兜底解析出的也是空（名字含空白会被 token 校验拦下），原结果不变。
- 原始头 Cookie 没有过期时间，都是 session Cookie；没有 secure / httpOnly / sameSite 信息，注入时按默认值处理。
- 风险：一段本不是 Cookie 的文本如果恰好是 `name=value` 的形式，会被当成 Cookie 存下来。但它只发生在 JSON / Netscape 都解析不出可用 Cookie 时，且名字必须是 token；存下的也只是该站点的 Cookie，不会串到别的站。
