import type { PromptTemplate } from "@rakazo_mickvvw/contracts";
import { t } from "./i18n";

/**
 * The persona a chat shows under its avatar: the linked template's name, or
 * Custom when the bot's instructions were written outside a template. Null
 * while the template list has not loaded yet, so the caller can keep the bot
 * name until the persona is known.
 */
export function currentPersonaName(
  bot: { promptTemplateId?: string | null } | undefined,
  templates: PromptTemplate[] | undefined,
): string | null {
  if (!templates) return null;
  const linked = bot?.promptTemplateId
    ? templates.find((template) => template.id === bot.promptTemplateId)
    : undefined;
  return linked?.name ?? t("Custom");
}

export function isTemplateInUse(
  template: Pick<PromptTemplate, "id">,
  bot: { promptTemplateId?: string | null } | undefined,
): boolean {
  return bot?.promptTemplateId === template.id;
}
