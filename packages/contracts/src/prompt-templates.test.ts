import { describe, expect, it } from "vitest";
import {
  BUILTIN_PROMPT_TEMPLATES,
  PromptTemplateImportError,
  parsePromptTemplateImport,
  promptTemplateFileName,
} from "./prompt-templates.js";

describe("prompt templates", () => {
  it("seeds four built-ins with unique names inside the content limit", () => {
    expect(BUILTIN_PROMPT_TEMPLATES.map((template) => template.name)).toEqual([
      "默认助手",
      "翻译助手",
      "写作助手",
      "代码助手",
    ]);
    for (const template of BUILTIN_PROMPT_TEMPLATES) {
      expect(template.content.trim().length).toBeGreaterThan(0);
      expect(template.content.length).toBeLessThanOrEqual(20000);
    }
  });

  it("parses plain text with the file name as the template name", () => {
    expect(parsePromptTemplateImport({ text: "  Be helpful.  ", suggestedName: "Helper" })).toEqual(
      [{ name: "Helper", content: "Be helpful." }],
    );
  });

  it("parses a single JSON template and a JSON array", () => {
    expect(
      parsePromptTemplateImport({
        text: JSON.stringify({ name: "A", content: "Do A." }),
      }),
    ).toEqual([{ name: "A", content: "Do A." }]);
    expect(
      parsePromptTemplateImport({
        text: JSON.stringify([
          { name: "A", content: "Do A." },
          { name: "B", content: "Do B." },
        ]),
      }),
    ).toEqual([
      { name: "A", content: "Do A." },
      { name: "B", content: "Do B." },
    ]);
  });

  it("rejects empty text, bad JSON, and items without a name or content", () => {
    expect(() => parsePromptTemplateImport({ text: "   " })).toThrow(PromptTemplateImportError);
    expect(() => parsePromptTemplateImport({ text: "{nope" })).toThrow(PromptTemplateImportError);
    expect(() => parsePromptTemplateImport({ text: "Be helpful." })).toThrow(
      PromptTemplateImportError,
    );
    expect(() => parsePromptTemplateImport({ text: JSON.stringify({ name: "A" }) })).toThrow(
      PromptTemplateImportError,
    );
    expect(() => parsePromptTemplateImport({ text: JSON.stringify({ content: "Do A." }) })).toThrow(
      PromptTemplateImportError,
    );
  });

  it("derives a safe file name from the template name", () => {
    expect(promptTemplateFileName("翻译助手")).toBe("翻译助手.txt");
    expect(promptTemplateFileName("a/b:c")).toBe("a_b_c.txt");
    expect(promptTemplateFileName("   ")).toBe("template.txt");
  });
});
