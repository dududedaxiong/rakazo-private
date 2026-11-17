import type { PromptTemplate } from "@rakazo_mickvvw/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-localization", () => ({
  getLocales: vi.fn(() => [{ languageTag: "en-US" }]),
}));

vi.mock("./material-icons", () => ({ materialIcons: {} }));

vi.mock("./ui-direction", () => ({
  applyMobileUiDirection: vi.fn(),
}));

import { resetI18nForTests } from "./i18n";
import { currentPersonaName, isTemplateInUse } from "./prompt-template-display";

const template = (overrides: Partial<PromptTemplate> = {}): PromptTemplate => ({
  id: "template-1",
  name: "翻译助手",
  content: "你是一个专业翻译。",
  isBuiltIn: true,
  sourceUrl: null,
  createdAt: "2026-11-12T00:00:00.000Z",
  updatedAt: "2026-11-12T00:00:00.000Z",
  ...overrides,
});

describe("currentPersonaName", () => {
  beforeEach(() => {
    resetI18nForTests("en");
  });

  it("names the bot's linked template", () => {
    expect(currentPersonaName({ promptTemplateId: "template-1" }, [template()])).toBe("翻译助手");
  });

  it("says Custom when the bot has no linked template", () => {
    expect(currentPersonaName({ promptTemplateId: null }, [template()])).toBe("Custom");
    expect(currentPersonaName(undefined, [template()])).toBe("Custom");
  });

  it("says Custom when the linked template is gone", () => {
    expect(currentPersonaName({ promptTemplateId: "missing" }, [template()])).toBe("Custom");
  });

  it("stays unknown while the template list has not loaded", () => {
    expect(currentPersonaName({ promptTemplateId: "template-1" }, undefined)).toBeNull();
  });
});

describe("isTemplateInUse", () => {
  it("matches only the bot's linked template", () => {
    expect(isTemplateInUse(template(), { promptTemplateId: "template-1" })).toBe(true);
    expect(isTemplateInUse(template(), { promptTemplateId: "template-2" })).toBe(false);
    expect(isTemplateInUse(template(), { promptTemplateId: null })).toBe(false);
    expect(isTemplateInUse(template(), undefined)).toBe(false);
  });
});
