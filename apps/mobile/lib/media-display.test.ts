import { describe, expect, it } from "vitest";
import {
  mediaDisplaySettingsFromBot,
  messageHasGeneratedImage,
  messageHasGeneratedMedia,
} from "./media-display";

describe("media display settings", () => {
  it("defaults every action to shown", () => {
    expect(mediaDisplaySettingsFromBot(null)).toEqual({
      showMediaFavorite: true,
      showMediaShare: true,
      showMediaPreview: true,
      showMediaDownload: true,
    });
    expect(mediaDisplaySettingsFromBot({})).toEqual({
      showMediaFavorite: true,
      showMediaShare: true,
      showMediaPreview: true,
      showMediaDownload: true,
    });
  });

  it("reads the bot's toggles", () => {
    expect(
      mediaDisplaySettingsFromBot({
        showMediaFavorite: false,
        showMediaPreview: false,
        showMediaDownload: true,
      }),
    ).toEqual({
      showMediaFavorite: false,
      showMediaShare: true,
      showMediaPreview: false,
      showMediaDownload: true,
    });
  });

  it("detects generated images and videos only on bot replies", () => {
    const image = { role: "bot", blocks: [{ kind: "image", mimeType: "image/png" }] };
    expect(messageHasGeneratedImage(image)).toBe(true);
    expect(messageHasGeneratedMedia(image)).toBe(true);
    const video = { role: "bot", blocks: [{ kind: "file", mimeType: "video/mp4" }] };
    expect(messageHasGeneratedImage(video)).toBe(false);
    expect(messageHasGeneratedMedia(video)).toBe(true);
    const document = { role: "bot", blocks: [{ kind: "file", mimeType: "application/pdf" }] };
    expect(messageHasGeneratedMedia(document)).toBe(false);
    const upload = { role: "user", blocks: [{ kind: "image", mimeType: "image/png" }] };
    expect(messageHasGeneratedImage(upload)).toBe(false);
    expect(messageHasGeneratedMedia(upload)).toBe(false);
    expect(messageHasGeneratedMedia({ role: "bot", blocks: [] })).toBe(false);
  });
});
