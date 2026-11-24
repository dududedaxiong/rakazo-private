# Agent Note: 报错详情在原生底表还在加载时也能打开

Status: implemented

## Problem

In the App, tapping 详情 on a failed run's error card could show nothing at all.
User report 2026-11-24 09:56, 小码酱 bot, "Anthropic 响应超时。请重试."
(the card's 更换模型 button is a separate path and was not reported broken).

What was checked before fixing:
- Press path: `ThreadErrorNotice` renders 详情 as `RunErrorTextAction`
  (`NativeActionButton` text variant) with `onPress={() => setDetailsOpen(true)}`.
  The handler goes through `actionPressHandler`, whose `hapticImpact()` is
  guarded (returns early when haptics are not loaded/disabled, try/catch
  around the effect), so the press reaches `setDetailsOpen`.
- Data path: the notice and the sheet read the same `run.error` string.
  `normalizeRunError` returns an object (never null) for a non-empty string,
  so the sheet has data whenever the card shows a summary.
- Presentation path (Android `run-error-sheet-container.tsx`):
  `useNativeSheet()` is `undefined` while the `@expo/ui/community/bottom-sheet`
  import is still resolving, `null` when the build has no native sheet, and
  the component when loaded. The old code returned `null` for `undefined`,
  so a tap in that window rendered nothing and gave no feedback.

## Decision

- `RunErrorSheetContainer` no longer returns null while the native sheet is
  loading: `undefined` now falls through to the same `Modal` fallback as
  `null`. The native sheet is used unchanged once it is available.
- No server change; App-only, rides the next App build.

## Alternatives considered

- Only fix the native sheet's own presentation (dynamic sizing + nested
  ScrollViews): strongest reason is it may be the real trigger on the user's
  device; not used, that mechanism cannot be proven without a device, and
  changing the shared `NativeSheet` would touch every sheet in the App.
- Always use the Modal for the error sheet on Android: strongest reason is
  it removes the native sheet from the path entirely; not used, it degrades
  the sheet UX for everyone on an unproven hypothesis.
- Leave the loading window as-is: strongest reason is it is milliseconds
  long in production (the import starts at app start); not used, a tap in
  that window provably shows nothing, and the fix costs one branch.

## Consequences

- Tapping 详情 always opens something: the Modal while the native sheet
  loads or is unavailable, the native sheet once loaded. Same content and
  actions in both.
- The loading window is short in production, so this closes a real hole but
  may not be the user's exact trigger. If 详情 still shows nothing after the
  next build, the next suspect is the native sheet's own presentation on
  Android (`enableDynamicSizing` + the sheet's nested ScrollViews, a
  structure no other working sheet shares) and needs on-device follow-up.
- `BottomSheetShell` has the same `Sheet === undefined → null` pattern;
  left alone here because no failure was reported on its sheets.

## Verification

- New `apps/mobile/lib/run-error-sheet-container.test.tsx`: 3/3 pass
  (loading → modal, no sheet → modal, sheet available → native sheet).
- `apps/mobile/lib/thread-run-error.test.tsx`: 10/10 pass.
- `apps/mobile/lib/run-error-sheet.test.tsx` fails to collect with a
  `SyntaxError: Unexpected token 'typeof'`; verified identical on the clean
  tree via `git stash` (pre-existing, unrelated to this change).
- Mobile `tsc --noEmit`: 9 errors, same as the clean-tree baseline.
- `biome check` on both touched files: clean.
