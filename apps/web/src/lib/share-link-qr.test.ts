import { describe, expect, it } from "vitest";
import { shareLinkQrDataUrl } from "./share-link-qr.js";

describe("shareLinkQrDataUrl", () => {
  it("encodes the same link to the same code and a different link to a different one", async () => {
    const url = "https://web.example/s/chat-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const first = await shareLinkQrDataUrl(url);
    expect(await shareLinkQrDataUrl(url)).toBe(first);
    expect(
      await shareLinkQrDataUrl(
        "https://web.example/s/other-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      ),
    ).not.toBe(first);
  });

  it("returns a PNG data URL", async () => {
    const dataUrl = await shareLinkQrDataUrl("https://web.example/s/chat-aaa");
    expect(dataUrl.startsWith("data:image/png;base64,")).toBe(true);
    const bytes = Buffer.from(dataUrl.split(",", 2)[1]!, "base64");
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });
});
