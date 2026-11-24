# Agent Note: 机器人新建技能默认全空间通用

Status: implemented

## Problem

A skill created by a bot (`skill_create`) stayed in its own space: the create path never set `allSpaces`, so it fell to the schema default `false`. That contradicted the tool's own description ("shared across assistants") and the web creation path, which sets `allSpaces: true`. The user found the silo inconvenient and asked that skills be universal going forward, while the 23 小码酱 skills already installed stay locked to the 小码酱 space.

## Decision

- `skillCreateFromTool` now creates with `allSpaces: true`, matching the web path.
- The mutate guard changes with it. It used to require `allSpaces: false` (`onlyInSpace`), so a bot could never update or delete a skill it had just created shared — the create→update→delete flow would break in production. The guard is now home-space ownership (`homedInSpace`: same `spaceId` + `userId`): a bot can change skills homed in its own space even when shared, and still cannot touch skills homed in another space.
- The 23 小码酱 skills are untouched: they were created with `allSpaces: false` and stay that way. Re-running `/p666` reuses them, so they stay locked.

## Alternatives considered

- Only flip the create default and leave the mutate guard strict: strongest reason is the smallest diff; not used, it would leave bots unable to update or delete the universal skills they create, and the existing create→update→delete test would fail against a real database.
- Change the schema default `allSpaces` to `true` instead: strongest reason is one place covers every creation path; not used, it would also flip plugin installs, bot packages, and account imports, whose scoping is deliberate.
- Flip the existing 23 小码酱 skills to shared as well: strongest reason is consistency; not used, the user explicitly chose to keep them as they are.

## Consequences

- New bot-created skills appear in every space's catalog (within the 50-line catalog cap) and cost every bot the catalog lines each round.
- A shared skill's home bot can still maintain it; bots in other spaces can read it but cannot change it — the user can, via the web UI.
- Existing space-locked skills are unaffected.
