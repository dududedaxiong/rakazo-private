import type { ThreadMessage } from "@rakazo/contracts";
import { copyableMessageText } from "@rakazo/core";
import { isToolOnlyNarration } from "./tool-activity-view";

/**
 * True when the user message at `index` has no normal bot reply after it:
 * scanning forward, no bot message with text appears before the next user
 * message or the end of the list. Progress bubbles and tool-only messages
 * do not count as a reply. A run that failed before producing a reply leaves
 * no bot message at all, so it shows the resend icon too — the transcript
 * marks no failed bot message; the run error lives on the composer instead.
 */
export function userMessageHasNoNormalReply(
  messages: readonly ThreadMessage[],
  index: number,
  showToolActivity: boolean,
): boolean {
  const message = messages[index];
  if (message?.role !== "user") return false;
  if (copyableMessageText(message).trim() === "") return false;
  for (let i = index + 1; i < messages.length; i++) {
    const next = messages[i];
    if (!next) continue;
    if (next.role === "user") return true;
    if (
      next.role === "bot" &&
      !next.id.startsWith("progress:") &&
      !isToolOnlyNarration(next.blocks, showToolActivity) &&
      copyableMessageText(next).trim() !== ""
    ) {
      return false;
    }
  }
  return true;
}
