import type { ThreadMessage } from "@rakazo_mickvvw/contracts";

/**
 * The conversation as Markdown, in time order: one section per message, with
 * the author's name and time. Images and videos have no public URL, so they
 * get a placeholder line with the file name instead of a link.
 */
export function conversationToMarkdown({
  title,
  messages,
  botName,
}: {
  title: string;
  messages: readonly ThreadMessage[];
  /** The bot (or group) name shown for bot replies. */
  botName: string;
}): string {
  const lines: string[] = [`# ${title}`, ""];
  for (const message of messages) {
    const author = message.role === "user" ? "You" : botName;
    const time = new Date(message.createdAt).toLocaleString();
    lines.push(`## ${author} · ${time}`, "");
    for (const block of message.blocks) {
      if (block.kind === "text" || block.kind === "progress" || block.kind === "ask") {
        const text = block.text.trim();
        if (text) lines.push(text);
      } else if (block.kind === "image") {
        lines.push(`*[Image: ${block.name}]*`);
      } else if (block.kind === "file") {
        const kind = block.mimeType.startsWith("video/") ? "Video" : "File";
        lines.push(`*[${kind}: ${block.name}]*`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

function exportFileName(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  const date = new Date().toISOString().slice(0, 10);
  return `${slug || "conversation"}-${date}.md`;
}

/** Downloads the conversation as a Markdown file named after it and today. */
export function downloadConversationMarkdown({
  title,
  messages,
  botName,
}: {
  title: string;
  messages: readonly ThreadMessage[];
  botName: string;
}): void {
  const markdown = conversationToMarkdown({ title, messages, botName });
  const blob = new Blob([markdown], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = exportFileName(title);
  anchor.click();
  URL.revokeObjectURL(url);
}
