import type { PromptTemplate } from "@rakazo/contracts";
import { promptTemplateFileName } from "@rakazo/contracts";

/** Downloads one template as a .txt file named after the template. */
export function downloadPromptTemplate(template: PromptTemplate): void {
  downloadTextFile(promptTemplateFileName(template.name), template.content);
}

/**
 * Downloads every template as its own .txt file. One file per template, so a file edited
 * outside the app re-imports onto the template with the same name.
 */
export function downloadPromptTemplates(templates: readonly PromptTemplate[]): void {
  for (const template of templates) downloadPromptTemplate(template);
}

function downloadTextFile(fileName: string, content: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
