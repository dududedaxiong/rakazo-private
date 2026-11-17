import type {
  SharedConversation,
  SharedConversationEntry,
  ThreadMessage,
} from "@rakazo_mickvvw/contracts";
import {
  SHARE_ENTRY_MAX,
  SHARE_SNAPSHOT_SCHEMA,
  SHARE_SNAPSHOT_VERSION,
  SHARE_TEXT_MAX,
} from "@rakazo_mickvvw/contracts";
import { isPeerReceiptBlocks } from "./message-visibility.js";
import { cutShareText, redactShareText } from "./share-redaction.js";

/** The newest entries survive a long thread; the range says which. */
export function buildSharedConversation(input: {
  title: string;
  botName?: string;
  messages: readonly ThreadMessage[];
  /** The thread's message count, for the range of a truncated share. */
  totalMessages: number;
  createdAt: Date;
}): SharedConversation {
  const kept = input.messages.filter(
    (message) => !isPeerReceiptBlocks(message.blocks) && hasShareableContent(message),
  );
  const startAt =
    kept.length > 0 ? new Date(kept[0]!.createdAt).getTime() : input.createdAt.getTime();
  // Entries carry their message's seq so a truncated share can name its range.
  const paired: { entry: SharedConversationEntry; seq: number }[] = [];
  for (const message of kept) {
    const at = Math.max(0, new Date(message.createdAt).getTime() - startAt);
    const text = redactShareText(copyMessageText(message));
    const images = message.blocks
      .filter((block) => block.kind === "image")
      .map((block) => ({ name: redactShareText(block.name) }));
    const files = message.blocks
      .filter((block) => block.kind === "file")
      .map((block) => ({
        name: redactShareText(block.name),
        kind: mediaKind(block.mimeType),
      }));
    if (message.role === "user") {
      paired.push({
        entry: {
          type: "user",
          t: at,
          text: cutShareText(text, SHARE_TEXT_MAX),
          ...(images.length > 0 ? { images } : {}),
          ...(files.length > 0 ? { files } : {}),
        },
        seq: message.seq,
      });
      continue;
    }
    const model = messageModel(message);
    if (text || images.length > 0 || files.length > 0) {
      paired.push({
        entry: {
          type: "reply",
          t: at,
          text: cutShareText(text, SHARE_TEXT_MAX),
          ...(model ? { model } : {}),
          ...(images.length > 0 ? { images } : {}),
          ...(files.length > 0 ? { files } : {}),
        },
        seq: message.seq,
      });
    }
    for (const block of message.blocks) {
      if (block.kind !== "steps") continue;
      for (const step of block.steps) {
        paired.push({
          entry: {
            type: "tool",
            t: at,
            name: redactShareText(step.label),
            ...(step.note ? { summary: cutShareText(redactShareText(step.note), 2000) } : {}),
            status: "ok",
          },
          seq: message.seq,
        });
      }
    }
  }
  const trimmed = paired.length > SHARE_ENTRY_MAX ? paired.slice(-SHARE_ENTRY_MAX) : paired;
  let lastModel: string | undefined;
  for (const item of paired) {
    if (item.entry.type === "reply" && item.entry.model) lastModel = item.entry.model;
  }
  return {
    v: SHARE_SNAPSHOT_VERSION,
    kind: "conversation",
    schema: SHARE_SNAPSHOT_SCHEMA,
    title: input.title.slice(0, 200),
    ...(input.botName ? { botName: input.botName.slice(0, 200) } : {}),
    ...(lastModel ? { model: lastModel } : {}),
    start: new Date(startAt).toISOString(),
    created: input.createdAt.toISOString(),
    ...(trimmed.length < paired.length
      ? {
          range: {
            from: trimmed[0]!.seq,
            to: trimmed[trimmed.length - 1]!.seq,
            of: input.totalMessages,
          },
        }
      : {}),
    entries: trimmed.map((item) => item.entry),
  };
}

/** A message with nothing a viewer can read: no text, no media, no steps. */
function hasShareableContent(message: ThreadMessage): boolean {
  return message.blocks.some(
    (block) =>
      block.kind === "text" ||
      block.kind === "progress" ||
      block.kind === "ask" ||
      block.kind === "image" ||
      block.kind === "file" ||
      block.kind === "steps" ||
      block.kind === "channel_message",
  );
}

/** The message's readable text, with Markdown pictures as their alt text. */
function copyMessageText(message: ThreadMessage): string {
  return message.blocks
    .map((block) => {
      if (block.kind === "channel_message") return `${block.fromLabel}: ${block.text}`;
      if (block.kind === "text" || block.kind === "progress" || block.kind === "ask")
        return block.text;
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function mediaKind(mimeType: string): "image" | "video" | "file" {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  return "file";
}

/**
 * The model that wrote a reply: the switch timeline's final model, with the
 * connection name when the winning attempt names it, so two connections
 * running the same model stay apart. A reply answered by its first model
 * carries no timeline; the trailing "当前模型:" line in its text names it,
 * and the replay page reads that instead.
 */
function messageModel(message: ThreadMessage): string | undefined {
  const switches = message.modelSwitches;
  if (!switches) return undefined;
  const winner = switches.attempts.find((attempt) => attempt.outcome === "succeeded");
  return winner?.provider ? `${switches.finalModel} (${winner.provider})` : switches.finalModel;
}
