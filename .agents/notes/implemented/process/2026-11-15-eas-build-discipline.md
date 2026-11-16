# Agent Note: EAS 打包纪律：android-apk 配置、核验、令牌清理

Status: implemented

## Problem

1.0.24 首版用 `--profile production` 打出无法安装的 AAB；EAS 远程版本源忽略本地 versionCode，每次自动 +1；一次性 Expo token 若不撤销会一直留存。

## Decision

出 APK 必须用 `--profile android-apk`；交付前必须 curl 核验（HTTP 200 + PK 魔数 + 字节数）；构建后撤销一次性 token、构建主机上 `EXPO_TOKEN` unset、清终端历史；`app.json` 的 owner / projectId 只在构建主机本地改，不提交进仓库。

## Alternatives considered

- **`--profile production`** — 默认配置；但产物是 AAB，手机装不上，1.0.24 因此重打。
- **本地手写递增 versionCode** — 直观；但 EAS 远程版本源会覆盖本地值，写了也白写，实际以 EAS 分配的为准。
- **token 复用** — 省事；但泄露面扩大，一次性 token 用完即废，复用等于长期暴露。

## Consequences

- **收益**：每次交付的 APK 都可安装、可核验；令牌不留存。
- **代价与已知上限**：每次构建都要新建并撤销 token，多几步操作；交付链接必须以构建页 href 原值为准——1.0.30 构建任务报的链接少了一个字母，Expo 回 BUILD_NOT_FOUND，靠构建页原链接才核过。

## Verification

1.0.30 构建 9583bf49，versionCode 23，curl 核 200、266,833,715 字节、PK 开头；一次性 token 已撤销，EXPO_TOKEN 已 unset，历史已清。
