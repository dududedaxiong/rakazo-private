import type { MiscSettings } from "@rakazo_mickvvw/contracts";
import { DEFAULT_UPLOAD_EXTENSIONS, MiscSettingsSchema } from "@rakazo_mickvvw/contracts";
import { DEFAULT_ARTIFACT_CATEGORY_MAPPING } from "@rakazo_mickvvw/core";
import type { PrismaClient } from "./client.js";

/** A space's misc settings, or the built-in defaults when it saved none. */
export const DEFAULT_MISC_SETTINGS: MiscSettings = {
  categories: DEFAULT_ARTIFACT_CATEGORY_MAPPING,
  uploadExtensions: [...DEFAULT_UPLOAD_EXTENSIONS],
};

export function findSpaceMiscConfig(
  prisma: Pick<PrismaClient, "spaceMiscConfig">,
  spaceId: string,
) {
  return prisma.spaceMiscConfig.findUnique({ where: { spaceId } });
}

/** Stored JSON that fails validation reads as no saved settings. */
export function parseMiscSettings(value: unknown): MiscSettings | null {
  const parsed = MiscSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function getSpaceMiscSettings(
  prisma: Pick<PrismaClient, "spaceMiscConfig">,
  spaceId: string,
): Promise<MiscSettings> {
  const row = await findSpaceMiscConfig(prisma, spaceId);
  return (row && parseMiscSettings(row.settings)) ?? DEFAULT_MISC_SETTINGS;
}

/**
 * The saved upload list, or undefined when the space saved none: callers fall
 * back to the built-in type list, so older clients keep working. A settings
 * read failure degrades the same way instead of breaking the upload.
 */
export async function getStoredUploadExtensions(
  prisma: Pick<PrismaClient, "spaceMiscConfig">,
  spaceId: string,
): Promise<string[] | undefined> {
  try {
    const row = await findSpaceMiscConfig(prisma, spaceId);
    if (!row) return undefined;
    return parseMiscSettings(row.settings)?.uploadExtensions;
  } catch {
    return undefined;
  }
}
