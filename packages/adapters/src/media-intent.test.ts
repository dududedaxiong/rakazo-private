import { DEFAULT_IMAGE_TRIGGERS, DEFAULT_VIDEO_TRIGGERS } from "@rakazo_mickvvw/contracts";
import { describe, expect, it } from "vitest";
import { matchBotMediaTrigger, matchMediaTrigger, parseTriggerWords } from "./media-intent.js";

describe("parseTriggerWords", () => {
  it("splits on | and drops blanks", () => {
    expect(parseTriggerWords("生成视频|生成一段视频|", DEFAULT_VIDEO_TRIGGERS)).toEqual([
      "生成视频",
      "生成一段视频",
    ]);
    expect(parseTriggerWords(" 画一张 | 画一幅 ", DEFAULT_IMAGE_TRIGGERS)).toEqual([
      "画一张",
      "画一幅",
    ]);
  });

  it("falls back to the defaults when empty or missing", () => {
    expect(parseTriggerWords("", DEFAULT_VIDEO_TRIGGERS)).toEqual([...DEFAULT_VIDEO_TRIGGERS]);
    expect(parseTriggerWords("  |  ", DEFAULT_VIDEO_TRIGGERS)).toEqual([...DEFAULT_VIDEO_TRIGGERS]);
    expect(parseTriggerWords(null, DEFAULT_IMAGE_TRIGGERS)).toEqual([...DEFAULT_IMAGE_TRIGGERS]);
    expect(parseTriggerWords(undefined, DEFAULT_IMAGE_TRIGGERS)).toEqual([
      ...DEFAULT_IMAGE_TRIGGERS,
    ]);
  });
});

describe("matchMediaTrigger", () => {
  it("routes a video trigger and strips it from the prompt", () => {
    expect(
      matchMediaTrigger(
        "生成一段视频：真实手机前置摄像头近距离自拍快照",
        ["生成视频", "生成一段视频"],
        ["生成图片", "画一张"],
      ),
    ).toEqual({
      tool: "generate_video",
      trigger: "生成一段视频",
      prompt: "：真实手机前置摄像头近距离自拍快照",
    });
    expect(matchMediaTrigger("生成视频一只猫跳舞", ["生成视频"], ["生成图片"])).toEqual({
      tool: "generate_video",
      trigger: "生成视频",
      prompt: "一只猫跳舞",
    });
  });

  it("routes an image trigger and strips it from the prompt", () => {
    expect(
      matchMediaTrigger("画一张橘猫坐在窗台上", ["生成视频"], ["生成图片", "画一张", "画一幅"]),
    ).toEqual({ tool: "generate_image", trigger: "画一张", prompt: "橘猫坐在窗台上" });
    expect(matchMediaTrigger("生成图片一只猫", ["生成视频"], ["生成图片"])).toEqual({
      tool: "generate_image",
      trigger: "生成图片",
      prompt: "一只猫",
    });
  });

  it("does not route ordinary chat or a bare trigger word", () => {
    expect(matchMediaTrigger("看看视频", ["生成视频"], ["生成图片"])).toBeNull();
    expect(matchMediaTrigger("刚才生成的视频呢", ["生成视频"], ["生成图片"])).toBeNull();
    expect(matchMediaTrigger("生成视频", ["生成视频"], ["生成图片"])).toBeNull();
    expect(matchMediaTrigger("画一张", ["生成视频"], ["画一张"])).toBeNull();
    expect(matchMediaTrigger("", ["生成视频"], ["生成图片"])).toBeNull();
  });

  it("takes the earliest trigger, and the longest at the same position", () => {
    expect(
      matchMediaTrigger("画一张图，再生成一段视频", ["生成视频", "生成一段视频"], ["画一张"]),
    ).toEqual({ tool: "generate_image", trigger: "画一张", prompt: "图，再生成一段视频" });
    expect(matchMediaTrigger("画一张图，一只猫", ["生成视频"], ["画一张", "画一张图"])).toEqual({
      tool: "generate_image",
      trigger: "画一张图",
      prompt: "，一只猫",
    });
  });

  it("matches custom trigger words case-insensitively", () => {
    expect(matchMediaTrigger("Generate video: a cat", ["generate video"], ["draw"])).toEqual({
      tool: "generate_video",
      trigger: "generate video",
      prompt: ": a cat",
    });
  });
});

describe("matchBotMediaTrigger", () => {
  it("uses the bot's stored words, or the defaults when unset", () => {
    expect(
      matchBotMediaTrigger("生成视频：一只猫", {
        videoTriggerWords: "出片|生成视频",
        imageTriggerWords: null,
      })?.tool,
    ).toBe("generate_video");
    expect(
      matchBotMediaTrigger("画一张橘猫", { videoTriggerWords: null, imageTriggerWords: null }),
    ).toEqual({ tool: "generate_image", trigger: "画一张", prompt: "橘猫" });
    expect(matchBotMediaTrigger("出片一只猫", { videoTriggerWords: null })).toBeNull();
  });
});
