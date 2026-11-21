import type { BotModelEntry } from "@rakazo_mickvvw/contracts";
import { parseBotModelList } from "@rakazo_mickvvw/contracts";

/** One bot model family split into its two pools. Empty pools are null. */
export type BotModelPools = {
  mainPool: BotModelEntry[] | null;
  backupPool: BotModelEntry[] | null;
};

/**
 * Split a family's stored lists into its two pools. The backup column is
 * null on rows written before the two pools existed: then the stored list is
 * still the old full list, and it splits first entry -> main pool, rest ->
 * backup pool. A stored empty array means a two-pool client cleared the
 * backup pool, so it reads as an empty backup pool, not the legacy split.
 * A written backup column marks the row as two-pool data even when the main
 * pool was cleared, so each pool reads as stored instead of both dropping.
 */
export function splitBotModelPools(mainRaw: unknown, backupRaw: unknown): BotModelPools {
  if (Array.isArray(backupRaw)) {
    return { mainPool: parseBotModelList(mainRaw), backupPool: parseBotModelList(backupRaw) };
  }
  const main = parseBotModelList(mainRaw);
  if (!main) return { mainPool: null, backupPool: null };
  return {
    mainPool: main.slice(0, 1),
    backupPool: main.length > 1 ? main.slice(1) : null,
  };
}

/** Merge two pools back into the single ordered list older clients read. */
export function mergeBotModelPools(pools: BotModelPools): BotModelEntry[] | null {
  const full = [...(pools.mainPool ?? []), ...(pools.backupPool ?? [])];
  return full.length > 0 ? full : null;
}
