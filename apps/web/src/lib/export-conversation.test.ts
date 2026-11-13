// @vitest-environment node
import type { ThreadMessage } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import { conversationToMarkdown } from "./export-conversation";

function message(
  overrides: Partial<ThreadMessage> & { blocks: ThreadMessage["blocks"] },
): ThreadMessage {
  return {
    id: "m",
    threadId: "thread",
    seq: 1,
    role: "bot",
    createdAt: "2026-11-14T10:00:00.000Z",
    ...overrides,
  };
}

describe("conversationToMarkdown", () => {
  it("renders user and bot messages in order with text and media placeholders", () => {
    const markdown = conversationToMarkdown({
      title: "Helper",
      botName: "Helper",
      messages: [
        message({
          id: "m1",
          role: "user",
          blocks: [{ kind: "text", text: "Draw a cat" }],
        }),
        message({
          id: "m2",
          blocks: [
            { kind: "image", artifactId: "a1", mimeType: "image/png", name: "generated-1.png" },
            { kind: "text", text: "经 model-a · 水彩" },
          ],
        }),
        message({
          id: "m3",
          blocks: [
            {
              kind: "file",
              artifactId: "a2",
              mimeType: "video/mp4",
              name: "generated-2.mp4",
              size: 10,
            },
          ],
        }),
      ],
    });
    expect(markdown).toContain("# Helper");
    expect(markdown).toContain("Draw a cat");
    expect(markdown).toContain("*[Image: generated-1.png]*");
    expect(markdown).toContain("经 model-a · 水彩");
    expect(markdown).toContain("*[Video: generated-2.mp4]*");
    expect(markdown.indexOf("Draw a cat")).toBeLessThan(
      markdown.indexOf("*[Image: generated-1.png]*"),
    );
  });

  it("skips empty text blocks and tool activity", () => {
    const markdown = conversationToMarkdown({
      title: "Helper",
      botName: "Helper",
      messages: [
        message({
          blocks: [
            { kind: "text", text: "  " },
            { kind: "text", text: "Hello" },
          ],
        }),
      ],
    });
    expect(markdown).toContain("Hello");
    expect(markdown).not.toContain("  \n");
  });
});
