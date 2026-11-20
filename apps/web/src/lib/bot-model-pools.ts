import type { Bot, BotModelEntry } from "@rakazo_mickvvw/contracts";

export type BotModelFamily = "translation" | "image" | "video" | "imageEdit" | "videoEdit";

export type BotModelPools = {
  main: BotModelEntry[];
  backup: BotModelEntry[];
};

const FAMILY_FIELDS = {
  translation: {
    main: "translationMainModels",
    backup: "translationBackupModels",
    legacy: "translationModels",
  },
  image: { main: "imageMainModels", backup: "imageBackupModels", legacy: "imageModels" },
  video: { main: "videoMainModels", backup: "videoBackupModels", legacy: "videoModels" },
  imageEdit: {
    main: "imageEditMainModels",
    backup: "imageEditBackupModels",
    legacy: "imageEditModels",
  },
  videoEdit: {
    main: "videoEditMainModels",
    backup: "videoEditBackupModels",
    legacy: "videoEditModels",
  },
} as const;

/**
 * One family's two pools: the explicit main/backup fields when the server
 * sent either, otherwise the legacy single list split first/rest, so bots
 * saved before the pools existed keep their primary and their fallbacks.
 */
export function botFamilyPools(bot: Bot, family: BotModelFamily): BotModelPools {
  const fields = FAMILY_FIELDS[family];
  const main = bot[fields.main];
  const backup = bot[fields.backup];
  if (main != null || backup != null) return { main: main ?? [], backup: backup ?? [] };
  const legacy = bot[fields.legacy] ?? [];
  return { main: legacy.slice(0, 1), backup: legacy.slice(1) };
}
