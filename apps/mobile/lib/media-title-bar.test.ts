import { describe, expect, it } from "vitest";
import { estimateSegmentWidth, mediaTitleBarRows } from "./media-title-bar";

const segments = [
  { key: "preset" as const, text: "图片生成: 卡通" },
  { key: "supplementary" as const, text: "补充提示词: 让天空更蓝一些" },
  { key: "model" as const, text: "模型: krisphyn-DeepSeek-V4-Pro · GB中转" },
];

describe("media title bar rows", () => {
  it("keeps short segments on one row", () => {
    expect(
      mediaTitleBarRows(
        [
          { key: "preset", text: "图片生成: 卡通" },
          { key: "supplementary", text: "补充提示词: + 添加" },
          { key: "model", text: "模型: 模型A" },
        ],
        360,
      ),
    ).toHaveLength(1);
  });

  it("drops the longest segment to a second row when the line overflows", () => {
    const rows = mediaTitleBarRows(segments, 360);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.map((segment) => segment.key)).toEqual(["preset", "supplementary"]);
    expect(rows[1]?.map((segment) => segment.key)).toEqual(["model"]);
  });

  it("counts CJK characters as full-width", () => {
    expect(estimateSegmentWidth("卡通")).toBe(28);
    expect(estimateSegmentWidth("ab")).toBe(14);
  });
});
