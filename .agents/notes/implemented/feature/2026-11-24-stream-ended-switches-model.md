# Agent Note: 流被截断的模型报错也要切备用模型

Status: implemented

## Problem

A chat run failed with "Anthropic stream ended before message_stop" (the
Anthropic stream ended without `message_stop`, 9.3 s in, 0 output tokens)
and never switched to a backup model, even though the chain had four
configured backups and one of them (baidu/ernie-5.5-flash-preview:free)
answered the same conversation fine four minutes later. The App shows the
failure as "Anthropic 响应超时", which is the display layer's classification,
not the switch gate's.

Two gates missed the error, for two different reasons:
- The transient classifier (`isRetryableProviderUnavailable` in
  `packages/adapter-kit/src/model-errors.ts`) only recognises
  "stream ended without finish_reason", not pi-ai's Anthropic wording
  "stream ended before message_stop". The text contains no "timeout" /
  "timed out" and carries no HTTP status, so `isTransientModelError`
  returned false and the same-model retry never ran.
- The run-internal switch branch (`packages/adapters/src/pi-runtime-fallback.ts`)
  only switches on `state.isProviderFailure`, a WeakSet fed by the observer's
  `onProviderError` hook. That hook fires for a thrown stream error only
  when the terminal error is still identical to the provider error
  (`terminalError === providerError` in `observedPiStream`); usage accounting
  that throws in between silently drops the marking, so the switch never
  fires and the error surfaces as a plain `Error` from `pi-runtime.ts`.

## Decision

- Classifier: add `stream ended before message_stop` to the transient
  pattern, next to the existing `stream ended without finish_reason`. A bare
  `stream ended` was not used: the repo's own "Model stream ended without a
  terminal event" is deliberately permanent (existing test), so the match
  stays pinned to the two provider wordings.
- Switch branch: before visible output, a failure now switches when either
  `state.isProviderFailure(event.error)` holds or the error is transient
  (`isTransientModelError`) and is not the idle timeout
  (`MODEL_STREAM_IDLE_TIMEOUT_MESSAGE`). A transient error is a provider-side
  failure by definition, so the switch no longer depends on the fragile
  WeakSet marking alone. The idle timeout is excluded: it renews the same
  model's idle bound instead of switching. When no backup exists,
  `resolveNext` returns nothing and execution still falls through to the
  same-model retry, so the retry path is preserved for backup-less runs.

## Alternatives considered

- Only fix the classifier: strongest reason is the smallest diff and it
  restores the same-model retry; not used, it would still leave the run
  failing after the retries exhaust, because the switch branch would still
  depend on the WeakSet marking that missed this error.
- Fix the WeakSet marking instead (call `onProviderError` regardless of the
  identity check): strongest reason is it repairs the exact channel that
  dropped the marking; not used, the identity check exists to avoid marking
  a usage-accounting error as a provider failure, and the production trigger
  (whether accounting threw) cannot be proven from the persisted records,
  so the fix would be aimed at an unproven cause.
- Broaden the switch branch to every error, not just transient ones:
  strongest reason is the user's "模型报错就切" rule in its broadest form;
  not used, permanent errors (bad key, context overflow, invalid input)
  would burn the whole pool for failures another model cannot fix.

## Consequences

- A dropped Anthropic stream now switches to the next model in the chain
  (main pool first, then backups) when a backup exists, and retries the
  same model when none does. The display text is unchanged.
- Transient errors with a backup configured now switch immediately instead
  of retrying the same model first; the same-model retry remains for
  backup-less runs and for the idle timeout. This follows the user's
  2026-11-21 rule (switch on a model error, judged by model) rather than
  the older retry-first comment in the fallback code.
- The mid-stream stall switch and the cut-reply continuation are untouched.

## Verification

- `packages/adapter-kit/src/model-errors.test.ts`: new transient case for
  "Anthropic stream ended before message_stop" — verified it fails without
  the regex change and passes with it; the permanent case "Model stream
  ended without a terminal event" still passes.
- `packages/adapters/src/pi-runtime-fallback.test.ts`: new test for the
  incident (primary yields the stream-ended error before output, backup
  configured) asserting the run completes on the backup. Honest limit: in
  this harness the observer always marks the error as a provider failure,
  so the test passes with or without the branch change — it locks the
  incident behavior, it does not isolate the new branch condition.
- Full fallback suite 153/153, model-errors suite 148/148.
- Adapters `tsc --noEmit`: 4 errors, same as the clean-tree baseline
  (2 pre-existing in `voice-factory.ts`, 2 in the fallback test file);
  adapter-kit `tsc`: 0. `biome check` clean on all touched files.
