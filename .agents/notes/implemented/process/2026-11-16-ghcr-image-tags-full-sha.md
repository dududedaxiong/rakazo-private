# Agent Note: 镜像标签必须用完整 40 位 SHA

Status: implemented

## Problem

2026-11-16 部署 1.0.29 时，部署任务两次拉取镜像报 not found。原因是镜像标签用了 8 位缩写，GHCR 上根本不存在这个标签；只有完整 40 位 SHA 的标签存在。

## Decision

部署与构建一律用完整 40 位 commit SHA 作镜像标签（`sha-<40 位>`）。`RAKAZO_IMAGE_TAG` 只填完整标签；任何文档、脚本、部署指令里都不出现 8 位缩写标签。

## Alternatives considered

- **8 位缩写标签** — 最省事、最常用；但 GHCR 上不存在，拉取直接报 not found，部署任务两次因此失败。
- **semver / edge 标签** — 语义清晰；但发布流程只产 `sha-` 标签，`edge` 指向 main，不对应部署分支的那次提交。
- **latest 标签** — 最省事；但不可追溯，无法确认线上跑的是哪次提交，出问题没法对上代码。

## Consequences

- **收益**：标签与提交一一对应，部署结果可验证，拉取失败时先查标签而不是先怀疑网络。
- **代价与已知上限**：标签长，复制时容易抄错；交付链接与标签必须以构建页 href 原值或下载实测为准，不能靠手打。

## Verification

1.0.30 部署拉取 `ghcr.io/dududedaxiong/rakazo-private/app:sha-54bba2f5d36fed7db0a208a3bebdfd685506c02f` 成功；`docker ps` 显示四个应用容器均为该镜像；本地与公网 `/health` 均 200。
