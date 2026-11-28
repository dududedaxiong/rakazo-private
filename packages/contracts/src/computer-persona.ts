import { z } from "zod";
import { Id } from "./ids.js";
import { SettingsScopeSchema } from "./settings-scope.js";

/** The member's computer persona: the prompt template id, or null when unset, and which copy it came from. */
export const ComputerPersonaSchema = z.object({
  promptTemplateId: Id.nullable(),
  scope: SettingsScopeSchema,
});
export type ComputerPersona = z.infer<typeof ComputerPersonaSchema>;
