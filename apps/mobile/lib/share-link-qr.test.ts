import { describe, expect, it } from "vitest";
import { shareLinkQrSvg } from "./share-link-qr";

describe("shareLinkQrSvg", () => {
  it("encodes the same link to the same code and a different link to a different one", async () => {
    const url = "https://web.example/s/chat-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const first = await shareLinkQrSvg(url);
    expect(await shareLinkQrSvg(url)).toBe(first);
    expect(
      await shareLinkQrSvg(
        "https://web.example/s/other-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      ),
    ).not.toBe(first);
  });

  it("returns an SVG string", async () => {
    const svg = await shareLinkQrSvg("https://web.example/s/chat-aaa");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('viewBox="0 0 ');
  });
});
