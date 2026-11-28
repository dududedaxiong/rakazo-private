import { rpc } from "./api";

/**
 * Cancels the stuck runs behind a needs-attention pill: one `threads/stop` per waiting bot —
 * the same call the thread's Stop button makes, which cancels every active run in the thread,
 * waiting ones included — then refreshes the inbox, so the bots' cleared status drops the pill.
 * A stop that fails leaves its bot waiting, so its pill stays; the failed bots come back for the
 * caller to report. The refresh still runs, so a run cancelled elsewhere still clears.
 */
export async function cancelAttentionBots(
  botIds: readonly string[],
  refresh: () => Promise<void>,
): Promise<string[]> {
  const failed: string[] = [];
  for (const botId of [...new Set(botIds)]) {
    try {
      await rpc("threads/stop", { botId });
    } catch {
      failed.push(botId);
    }
  }
  await refresh();
  return failed;
}
