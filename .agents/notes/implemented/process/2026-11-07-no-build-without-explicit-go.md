# Agent Note: 没有用户明确点头，绝不触发构建与打包

Status: implemented

## Problem

GitHub Actions 构建与 EAS 打包都扣额度：Expo 免费每月 15 次 Android + 15 次 iOS，GitHub 打包构建扣额度。乱触发会烧掉用户的额度。

## Decision

没有用户明确点头，绝不触发 GitHub Actions 构建与 EAS 打包。写代码、跑测试、提交这些准备工作可以先做，触发构建那一步必须等用户一句话。

## Alternatives considered

- **push 即自动构建** — CI 常规做法；但每次 push 都烧额度，用户明确反对。
- **assistant 自行判断触发** — 省事；但额度是用户的，assistant 无权代花。

## Consequences

- **收益**：额度只花在用户确认的版本上。
- **代价与已知上限**：每次发布多一次等待确认；用户没点头时，代码只能停在已提交未部署的状态。

## Verification

1.0.29 与 1.0.30 两次构建均在用户说「推送，打包」后触发；Expo 账号本月 Android 构建用量以构建页为准（每月 15 次）。
