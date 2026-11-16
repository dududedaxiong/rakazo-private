import { describe, expect, it } from "vitest";
import { cutShareText, markdownImagesToAlt, redactShareText } from "./share-redaction.js";

describe("redactShareText", () => {
  it("redacts sk- keys, JWTs, private key blocks, and Authorization headers", () => {
    const text = [
      "key is sk-proj-abcdefghij1234567890",
      "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature",
      "Authorization: Bearer abcdef123456",
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAA\n-----END RSA PRIVATE KEY-----",
    ].join("\n");
    const out = redactShareText(text);
    expect(out).not.toContain("sk-proj-");
    expect(out).not.toContain("eyJhbGciOi");
    expect(out).not.toContain("MIIEowIBAA");
    expect(out).not.toContain("abcdef123456");
    expect(out).toContain("[Redacted]");
    expect(out).toContain("Authorization: Bearer [Redacted]");
  });

  it("redacts secret assignments but leaves placeholders and ordinary words", () => {
    const out = redactShareText(
      "API_KEY=abcdef123456 and token: abcdef123456, but $TOKEN stays and basic usage stays",
    );
    expect(out).toBe(
      "API_KEY=[Redacted] and token: [Redacted], but $TOKEN stays and basic usage stays",
    );
  });

  it("redacts JSON secret fields without touching other fields", () => {
    const out = redactShareText('{"name": "demo", "api_key": "abcdef123456"}');
    expect(out).toBe('{"name": "demo", "api_key": "[Redacted]"}');
  });

  it("replaces home folders and app storage, and leaves other paths", () => {
    const out = redactShareText(
      "see /home/alice/notes.txt, /Users/bob/x.png, C:\\Users\\carol\\y.txt, " +
        "and /data/user/0/com.example.app/files/z.txt, but /var/log/syslog stays",
    );
    expect(out).toBe("see ~/notes.txt, ~/x.png, ~/y.txt, and …, but /var/log/syslog stays");
  });

  it("leaves clean text untouched", () => {
    const text = "Hello, this is a plain reply with no secrets.";
    expect(redactShareText(text)).toBe(text);
  });
});

describe("markdownImagesToAlt", () => {
  it("replaces image links with their alt text", () => {
    expect(markdownImagesToAlt("Look: ![a watercolor mountain](/local/path.png) here.")).toBe(
      "Look: 〔a watercolor mountain〕 here.",
    );
  });

  it("drops an image with no alt text", () => {
    expect(markdownImagesToAlt("![](x.png)")).toBe("");
  });

  it("leaves images inside fenced code blocks alone", () => {
    const input = "```md\n![kept](x.png)\n```\n![gone](y.png)";
    expect(markdownImagesToAlt(input)).toBe("```md\n![kept](x.png)\n```\n〔gone〕");
  });
});

describe("cutShareText", () => {
  it("keeps short text whole and cuts the middle of long text", () => {
    expect(cutShareText("short", 100)).toBe("short");
    const long = "a".repeat(500) + "b".repeat(500);
    const cut = cutShareText(long, 100);
    expect(cut.length).toBe(103);
    expect(cut.startsWith("a".repeat(60))).toBe(true);
    expect(cut.endsWith("b".repeat(40))).toBe(true);
    expect(cut).toContain("…");
  });
});
