import { z } from "zod";

/** One model tried while producing a message, in try order. */
export const ModelSwitchAttemptSchema = z.object({
  /** The model id that was tried. */
  model: z.string().min(1),
  /**
   * The connection display name the model belongs to (the user's own
   * connection name, e.g. the name they gave the relay); distinguishes
   * same-named models on different connections. Absent when unknown.
   */
  provider: z.string().min(1).optional(),
  outcome: z.enum(["failed", "skipped", "succeeded"]),
  /**
   * Which pool the model belongs to: "main" for the main pool, "backup" for
   * the backup pool. Absent on records written before the two pools existed.
   */
  pool: z.enum(["main", "backup"]).optional(),
  /** Short failure class for the timeline label (e.g. rate_limit, connection). */
  errorCode: z.string().min(1).optional(),
  /** Sanitized failure detail, truncated to 300 characters; never contains secrets. */
  errorMessage: z.string().min(1).max(300).optional(),
  /** Server time the attempt was recorded, ISO 8601. */
  at: z.string().min(1),
});
export type ModelSwitchAttempt = z.infer<typeof ModelSwitchAttemptSchema>;

/**
 * The model-switch timeline for one message: every attempt, in order, plus
 * the model that finally produced it. Only present when a switch happened;
 * a message answered by its first model carries no timeline.
 */
export const ModelSwitchesSchema = z.object({
  attempts: z.array(ModelSwitchAttemptSchema).min(1),
  finalModel: z.string().min(1),
});
export type ModelSwitches = z.infer<typeof ModelSwitchesSchema>;
