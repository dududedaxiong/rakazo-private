// @vitest-environment jsdom
import type { PromptTemplate } from "@rakazo/contracts";
import { describe, expect, it, vi } from "vitest";
import { downloadPromptTemplate, downloadPromptTemplates } from "./prompt-template-files";

const template = (overrides: Partial<PromptTemplate> = {}): PromptTemplate => ({
  id: "tpl-1",
  name: "翻译助手",
  content: "Translate.",
  isBuiltIn: false,
  sourceUrl: null,
  createdAt: "2026-11-12T00:00:00Z",
  updatedAt: "2026-11-12T00:00:00Z",
  ...overrides,
});

describe("prompt template downloads", () => {
  it("downloads one .txt file named after the template", () => {
    const urls: string[] = [];
    const clicks: Array<{ href: string; download: string }> = [];
    vi.stubGlobal(
      "URL",
      Object.assign(URL, {
        createObjectURL: vi.fn(() => "blob:fake"),
        revokeObjectURL: vi.fn((url: string) => {
          urls.push(url);
        }),
      }),
    );
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clicks.push({ href: this.href, download: this.download });
    };
    try {
      downloadPromptTemplate(template());
      expect(clicks).toEqual([{ href: "blob:fake", download: "翻译助手.txt" }]);
      expect(urls).toEqual(["blob:fake"]);
    } finally {
      HTMLAnchorElement.prototype.click = click;
      vi.unstubAllGlobals();
    }
  });

  it("downloads each template as its own file", () => {
    const downloads: string[] = [];
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    };
    try {
      downloadPromptTemplates([
        template({ id: "tpl-1", name: "翻译助手" }),
        template({ id: "tpl-2", name: "写作助手" }),
      ]);
      expect(downloads).toEqual(["翻译助手.txt", "写作助手.txt"]);
    } finally {
      HTMLAnchorElement.prototype.click = click;
    }
  });
});
