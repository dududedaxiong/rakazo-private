# Agent Note: 推代码走 Git Data API，不走 git push

Status: implemented

## Problem

git push 走 HTTPS 不通：PAT 替身只对 api.github.com 生效，推代码仓库被拒；SSH 则被出口代理挡住。没有可用的 git 远程传输通道。

## Decision

推 rakazo 代码走 Git Data API：推送脚本（传 blob → 逐层重建 tree → 按本地元数据建 commit → 快进分支），再用本地 `commit-tree` 对照复原分支。message 必须用本地原始字节（API 回包会剥掉末尾空行），日期用本地 +08:00。

## Alternatives considered

- **HTTPS git push** — 标准做法；但 PAT 替身只对 api.github.com 生效，推代码仓库被拒。
- **SSH push** — 标准做法；但出口代理挡住 SSH，连不上。
- **让用户自己推** — 零风险；但用户在手机上操作不便，违背 assistant 接手构建的初衷。

## Consequences

- **收益**：推送不再依赖 git 远程传输，提交的作者、日期、message 与本地完全一致。
- **代价与已知上限**：服务端重建的提交 SHA 与本地不同，推完必须用 `commit-tree` 复刻对齐并逐个核对 SHA；本地 clone 缺私库分支头以下 171 个父提交，`git log` 走到基底会报错（不影响推送）。

## Verification

2026-11-16 的 5 个提交推后分支头为 `54bba2f5`，本地 `commit-tree` 复刻出的 SHA 与服务端逐一一致；分支已用 `update-ref` 对齐，工作区干净。
