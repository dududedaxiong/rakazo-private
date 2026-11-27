# Agent Note: Vault editor Save unreachable on a phone with a long cookie pasted

Status: implemented

## Problem

In the in-conversation login card (SecretAskCard) on mobile web, the user pasted a long
cookie export, switched to Cookie/UA mode, and could not find Save at all. The Save
button exists and is enabled once site + cookie are filled (`ready` in cookie mode is
`origin.trim() && cookieContent.trim()`), so this is purely layout.

Root cause is the Cookie textarea growing without bound. The shared `Textarea`
(`packages/ui-web/src/components/ui/textarea.tsx`) uses `field-sizing-content`, so it
grows to fit its content, and the vault editor gave it only `min-h-32` with no cap. A
device-browser reproduction confirmed it: 3 rows empty, ~20 rows after 20 pastes, no
max-height. The Save button sits at the very bottom of the form, so a long paste pushes
it far below the fold. Two contexts differ in how bad that is:

- Settings → Vault (`VaultItemEditorPage`): the page scrolls, so Save is reachable with
  one scroll down.
- Conversation card (`VaultItemEditor`, a `Dialog`): the default `DialogContent` size
  has no max-height and no overflow, so a tall form overflows the viewport with no
  scroll at all — Save is unreachable, not merely below the fold. That is the context
  the user hit ("直接打开对话的登录").

## Decision

Branch `fix/vault-editor-mobile-save`, off `e2a202b` (tree-identical to server head
`c9816370`). One commit, three changes, all in
`apps/web/src/components/vault/VaultItemEditor.tsx`. No logic, validation, copy, or
mobile (`apps/mobile`) changes:

1. **Cookie textarea capped**: `max-h-48 overflow-y-auto` added to its className
   (`min-h-32` kept). `field-sizing-content` is retained, so the box still grows with
   content — from 8rem up to 12rem — then scrolls internally instead of growing past
   Save. Verified with the repo's `tailwind-merge` that the classes resolve as
   intended (no conflict with the shared base).
2. **Action row sticky**: the Save/Dismiss row becomes
   `sticky bottom-0 bg-dialog py-2`. `bg-dialog` matches the surface in both contexts
   (the Settings editor sits inside the Settings dialog too; in light mode
   `--background` and `--dialog` are the same white, in dark mode the dialog is
   `#161616` against the page `#0a0a0a`, so `bg-background` would seam in the dialog).
   This keeps Save pinned to the visible area while the fields scroll.
3. **Dialog scrollable**: the editor's `DialogContent` gains
   `max-h-[calc(100dvh-2rem)] overflow-y-auto`. A tall form now scrolls inside the
   dialog instead of overflowing the viewport — this is what makes the sticky row
   effective in the dialog context. On desktop the form fits, so nothing changes there.

Verification:

- Unit tests: `apps/web/src/components/VaultSettings.test.tsx`, 21/21 pass, including
  2 new ones — one asserting the textarea cap + sticky row + enabled Save with a
  30-line fake cookie pasted, one rendering `VaultItemEditor` directly and asserting
  the dialog's max-height + overflow. Biome clean.
- Real screenshots (headless Chromium, repo-compiled Tailwind CSS): a faithful replica
  of the dialog with the exact class names from the component, 30 fake cookie lines
  pasted. Desktop 1280×800 and mobile 390×844 both show Save visible with no scroll
  needed. Measured: textarea `offsetHeight=192` (capped at 12rem) against
  `scrollHeight=556` (content scrolls inside); Save fully inside the viewport in both.
  Short viewport 390×500: dialog scrolls (`clientHeight=468 < scrollHeight=616`) and
  Save stays pinned at the bottom via sticky. Reviewed against
  `.agents/skills/ux-declutter/SKILL.md`: no new copy or elements, monochrome, the
  form is already minimal ("Add a note" is progressive disclosure); nothing to remove.
- Not visually verified: the live conversation card itself. These screenshots render a
  replica (exact class names + the repo's compiled Tailwind output), not the mounted
  React component — this environment has no live browser or running app server for a
  subagent. The class wiring to the real component is covered by the unit tests above;
  the parent's device-browser check is the place to confirm on the real card after
  deploy.

## Alternatives considered

1. **Only cap the textarea, no sticky row and no dialog max-height**. Strongest reason:
   smallest change, and the cap alone bounds the form. Not used: on a short phone the
   form can still exceed the viewport; without a scrollable dialog the Save button can
   still be pushed off with no way to reach it. The cap bounds the form, the dialog
   scroll + sticky row guarantee reachability.
2. **Remove `field-sizing-content` from the shared `Textarea`**. Strongest reason:
   fixes every growing textarea at once. Not used: the content-sized textarea is a
   deliberate shared choice (composer, notes); changing it would alter every textarea
   in the app. The unbounded growth is only a problem for this paste box, so the cap
   belongs on this field.
3. **Move Save to the top of the form (or a fixed header button)**. Strongest reason:
   always visible without scrolling. Not used: Save-at-the-bottom is the established
   pattern across all vault kinds; moving it changes the form's layout for every kind.
   Sticky bottom keeps the existing layout and only pins the row while scrolling.

## Consequences

- Web only. `apps/mobile` untouched; the App build in progress is not disturbed.
- Desktop behavior unchanged: the form fits, Save sits at the bottom as before, and
  the sticky row is a no-op when nothing scrolls.
- The import-summary view's Done row was left as-is: that view is short (a summary
  line plus an optional skipped list), so Done only goes off-screen with a very long
  skipped list — out of scope for this fix.
- No new copy, no logic or validation changes, no migration.
