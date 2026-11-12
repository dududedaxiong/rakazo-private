import * as z from "zod";
import { BOT_INSTRUCTIONS_MAX_LENGTH } from "./domain.js";
import { Id, IsoDate } from "./ids.js";

/** Template names stay short enough to read in a list row. */
export const PROMPT_TEMPLATE_NAME_MAX_LENGTH = 80;

export const PromptTemplateSchema = z.object({
  id: Id,
  name: z.string(),
  content: z.string(),
  isBuiltIn: z.boolean(),
  sourceUrl: z.string().nullable(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type PromptTemplate = z.infer<typeof PromptTemplateSchema>;

export const PromptTemplateNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(PROMPT_TEMPLATE_NAME_MAX_LENGTH);
export const PromptTemplateContentSchema = z
  .string()
  .trim()
  .min(1)
  .max(BOT_INSTRUCTIONS_MAX_LENGTH);

export const CreatePromptTemplateInput = z.object({
  name: PromptTemplateNameSchema,
  content: PromptTemplateContentSchema,
});
export type CreatePromptTemplateInput = z.infer<typeof CreatePromptTemplateInput>;

export const UpdatePromptTemplateInput = z
  .object({
    templateId: Id,
    name: PromptTemplateNameSchema.optional(),
    content: PromptTemplateContentSchema.optional(),
  })
  .refine((input) => input.name !== undefined || input.content !== undefined, {
    message: "Nothing to update",
  });
export type UpdatePromptTemplateInput = z.infer<typeof UpdatePromptTemplateInput>;

export const PromptTemplateIdInput = z.object({ templateId: Id });
export type PromptTemplateIdInput = z.infer<typeof PromptTemplateIdInput>;

export const ApplyPromptTemplateInput = z.object({ templateId: Id, botId: Id });
export type ApplyPromptTemplateInput = z.infer<typeof ApplyPromptTemplateInput>;

export const SaveCurrentAsTemplateInput = z.object({
  botId: Id,
  name: PromptTemplateNameSchema.optional(),
});
export type SaveCurrentAsTemplateInput = z.infer<typeof SaveCurrentAsTemplateInput>;

export const PromptTemplateImportItemSchema = z.object({
  name: PromptTemplateNameSchema,
  content: PromptTemplateContentSchema,
});
export type PromptTemplateImportItem = z.infer<typeof PromptTemplateImportItemSchema>;

export const ConfirmPromptTemplateImportInput = z.object({
  templates: z.array(PromptTemplateImportItemSchema).min(1).max(100),
  /** When given, an imported template the bot already uses is applied at once. */
  botId: Id.optional(),
  /** The subscription address the templates came from, recorded on new templates. */
  sourceUrl: z.string().trim().url().max(2048).optional(),
});
export type ConfirmPromptTemplateImportInput = z.infer<typeof ConfirmPromptTemplateImportInput>;

export const FetchPromptTemplatesInput = z.object({
  url: z.string().trim().url().max(2048),
});
export type FetchPromptTemplatesInput = z.infer<typeof FetchPromptTemplatesInput>;

export const FetchedPromptTemplatesSchema = z.object({
  templates: z.array(PromptTemplateImportItemSchema),
});
export type FetchedPromptTemplates = z.infer<typeof FetchedPromptTemplatesSchema>;

/** The four templates every account starts with. Names and content are the product copy. */
export const BUILTIN_PROMPT_TEMPLATES: ReadonlyArray<{
  name: string;
  content: string;
}> = [
  {
    name: "默认助手",
    content:
      "你是一个通用 AI 助手，回答简洁、准确，用中文回复。遇到不确定的事，先说不知道，再给最可能的答案。",
  },
  {
    name: "翻译助手",
    content:
      "你是一个专业翻译，把用户发来的内容翻译成目标语言，只输出译文，不要解释、不要加多余的话。",
  },
  {
    name: "写作助手",
    content:
      "你是一个写作助手，帮用户起草、改写、润色文章。保持原文的意思，语言自然、简洁，结构清晰。",
  },
  {
    name: "代码助手",
    content:
      "你是一个资深程序员，帮用户写代码、修 bug、解释代码。先给结论和代码，再简单解释为什么。",
  },
];

export class PromptTemplateImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromptTemplateImportError";
  }
}

function parseImportItem(item: unknown, index: number): { name: string; content: string } {
  const result = PromptTemplateImportItemSchema.safeParse(item);
  if (!result.success) {
    throw new PromptTemplateImportError(`第 ${index + 1} 个模板的名称或内容不对`);
  }
  return result.data;
}

/**
 * Parse pasted text or a file's contents into templates. JSON holds one template
 * ({name, content}) or many ([{name, content}, ...]); anything else is one template
 * whose name comes from the file (or the name the user typed in the preview).
 */
export function parsePromptTemplateImport(input: {
  text: string;
  suggestedName?: string;
}): Array<{ name: string; content: string }> {
  const text = input.text.trim();
  if (!text) throw new PromptTemplateImportError("导入的内容是空的");
  if (text.startsWith("{") || text.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new PromptTemplateImportError("文件不是有效的 JSON");
    }
    const items = Array.isArray(parsed) ? parsed : [parsed];
    if (items.length === 0) throw new PromptTemplateImportError("JSON 里没有模板");
    if (items.length > 100) throw new PromptTemplateImportError("一次最多导入 100 个模板");
    return items.map((item, index) => parseImportItem(item, index));
  }
  const name = (input.suggestedName ?? "").trim();
  if (!name) throw new PromptTemplateImportError("请给这个人设起个名字");
  if (name.length > PROMPT_TEMPLATE_NAME_MAX_LENGTH) {
    throw new PromptTemplateImportError("模板名称太长了");
  }
  if (text.length > BOT_INSTRUCTIONS_MAX_LENGTH) {
    throw new PromptTemplateImportError("内容太长了");
  }
  return [{ name, content: text }];
}

/** A file name for an exported template: the name is the file name. */
export function promptTemplateFileName(name: string): string {
  const safe = name
    .trim()
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, PROMPT_TEMPLATE_NAME_MAX_LENGTH);
  return `${safe || "template"}.txt`;
}
