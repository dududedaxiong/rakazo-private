import { z } from "zod";

/** One file extension, lowercase without the dot. */
const extensionSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/^\./, "").toLowerCase())
  .pipe(
    z
      .string()
      .min(1)
      .max(16)
      .regex(/^[a-z0-9]+$/),
  );

const extensionListSchema = z.array(extensionSchema).max(200);

/** Which extensions belong to each artifact category, edited in Misc settings. */
export const ArtifactCategoryMappingSchema = z.strictObject({
  image: extensionListSchema,
  video: extensionListSchema,
  archive: extensionListSchema,
  script: extensionListSchema,
  document: extensionListSchema,
  software: z.strictObject({
    desktop: extensionListSchema,
    apple: extensionListSchema,
    android: extensionListSchema,
    other: extensionListSchema,
  }),
});

/**
 * Extensions a chat upload or a bot attach may carry. ".env" is refused here
 * and again at upload time, so a stored list can never smuggle it in.
 */
export const UploadExtensionsSchema = z
  .array(extensionSchema)
  .max(500)
  .refine((extensions) => !extensions.includes("env"), {
    message: ".env is never uploadable",
  });

/** Per-space misc settings: artifact categories and chat upload formats. */
export const MiscSettingsSchema = z.strictObject({
  categories: ArtifactCategoryMappingSchema,
  uploadExtensions: UploadExtensionsSchema,
});
export type MiscSettings = z.infer<typeof MiscSettingsSchema>;

/** Upload formats a fresh space starts with; every entry has a known type. */
export const DEFAULT_UPLOAD_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "svg",
  "mp4",
  "mov",
  "webm",
  "pdf",
  "txt",
  "md",
  "csv",
  "html",
  "json",
  "xml",
  "yaml",
  "yml",
  "toml",
  "sql",
  "zip",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "py",
  "js",
  "mjs",
  "cjs",
  "jsx",
  "ts",
  "tsx",
  "mts",
  "cts",
  "sh",
  "bash",
  "zsh",
  "css",
  "scss",
  "go",
  "rs",
  "java",
  "c",
  "h",
  "cpp",
  "cc",
  "hpp",
  "rb",
  "php",
  "swift",
  "kt",
  "kts",
  "lua",
  "pl",
  "ini",
  "cfg",
] as const;
