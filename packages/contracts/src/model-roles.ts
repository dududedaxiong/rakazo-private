import { z } from "zod";
import { Id, ThinkingLevelSchema } from "./ids.js";
import type { ModelCatalogEntry } from "./model-connections.js";
import { ModelBackupChoiceSchema, modelChoiceListSchema } from "./model-connections.js";

/** Add purposes here; connections, persistence, pickers and backups stay shared. */
export const ModelRoleSchema = z.enum(["main", "approval", "computer", "image", "video"]);
export type ModelRole = z.infer<typeof ModelRoleSchema>;
export const ModelRoleChoiceSchema = ModelBackupChoiceSchema.extend({
  thinkingLevel: ThinkingLevelSchema.nullable().optional(),
  /** The connection this row runs on; omitted rows use the provider's connection or the deployment's. */
  credentialId: Id.optional(),
});
export type ModelRoleChoice = z.infer<typeof ModelRoleChoiceSchema>;
export const ModelRoleSettingsSchema = z.object({
  primary: ModelRoleChoiceSchema.nullable(),
  backups: modelChoiceListSchema(ModelRoleChoiceSchema),
  /**
   * The main pool, in try order: the primary is its first entry. The chain
   * walks the whole main pool before the backup pool.
   */
  mainPool: modelChoiceListSchema(ModelRoleChoiceSchema),
  /** The backup pool, in try order; tried only after the main pool is exhausted. */
  backupPool: modelChoiceListSchema(ModelRoleChoiceSchema),
});
export type ModelRoleSettings = z.infer<typeof ModelRoleSettingsSchema>;
export const ModelRoleUpdateSchema = ModelRoleSettingsSchema.partial();
/** A member's choices plus what the deployment runs when they chose no model. */
export const ModelRoleViewSchema = ModelRoleSettingsSchema.extend({
  deploymentPrimary: ModelRoleChoiceSchema.nullable().optional(),
  /** Main, image and video roles only: whether the model that runs reads images on the connection runs use. */
  seesImages: z.boolean().optional(),
});
export type ModelRoleView = z.infer<typeof ModelRoleViewSchema>;

export function modelSupportsRole(entry: ModelCatalogEntry, role: ModelRole): boolean {
  if (role === "approval") return true;
  if (entry.protocol === "decisions") return false;
  // The main role runs text-only models too; every other role that looks at
  // pictures needs a model that reads images.
  return role === "main" || entry.images !== false;
}
