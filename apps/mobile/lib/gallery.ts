import type { ArtifactListSort } from "@rakazo_mickvvw/contracts";

/** What the gallery lists: generated images and videos, nothing else. */
export type GalleryItem = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  createdAt: string;
  botId: string | null;
  groupId: string | null;
};

export type GalleryCategory = "all" | "image" | "video";
export type GallerySort = ArtifactListSort;

export type GalleryTranslate = (
  message: string,
  values?: Record<string, string | number>,
) => string;

/** One tap cycles the sort; no dropdown, matching the web gallery. */
export const GALLERY_SORT_CYCLE: readonly GallerySort[] = [
  "date-desc",
  "date-asc",
  "size-desc",
  "size-asc",
];

export function nextGallerySort(sort: GallerySort): GallerySort {
  return (
    GALLERY_SORT_CYCLE[(GALLERY_SORT_CYCLE.indexOf(sort) + 1) % GALLERY_SORT_CYCLE.length] ??
    "date-desc"
  );
}

/** The sort button's label, translated at the call site. */
export function gallerySortLabelKey(sort: GallerySort): string {
  switch (sort) {
    case "date-desc":
      return "Date ↓";
    case "date-asc":
      return "Date ↑";
    case "size-desc":
      return "Size ↓";
    case "size-asc":
      return "Size ↑";
  }
}

/** Generated media are named `generated-<id>.png/mp4` by the media tools. */
export function isGeneratedMedia(item: Pick<GalleryItem, "name" | "mimeType">): boolean {
  return (
    item.name.startsWith("generated-") &&
    (item.mimeType.startsWith("image/") || item.mimeType.startsWith("video/"))
  );
}

export function matchesGalleryCategory(
  item: Pick<GalleryItem, "mimeType">,
  category: GalleryCategory,
): boolean {
  if (category === "all") return true;
  return category === "image"
    ? item.mimeType.startsWith("image/")
    : item.mimeType.startsWith("video/");
}

export type GalleryDayGroup<T> = {
  key: string;
  /** Local midnight of the day the group covers. */
  date: Date;
  items: T[];
};

/**
 * Groups items under their local day, in first-seen order: newest day first
 * when the listing is date-desc, oldest first when it is date-asc. The
 * server already sorted the listing, so no re-sorting here.
 */
export function groupGalleryItemsByDay<T extends { createdAt: string }>(
  items: readonly T[],
): GalleryDayGroup<T>[] {
  const groups = new Map<string, GalleryDayGroup<T>>();
  for (const item of items) {
    const date = new Date(item.createdAt);
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    const group = groups.get(key);
    if (group) group.items.push(item);
    else
      groups.set(key, {
        key,
        date: new Date(date.getFullYear(), date.getMonth(), date.getDate()),
        items: [item],
      });
  }
  return [...groups.values()];
}

/**
 * A day group's header, matching the web gallery: `Today · 11/19 · 3 items`,
 * `Yesterday · 11/18 · 1 item`, `11/17 · 1 item`. Same-year dates omit the
 * year; the count goes through the translator's `{count}` interpolation.
 */
export function formatGalleryDayLabel(
  group: Pick<GalleryDayGroup<unknown>, "date" | "items">,
  now: Date,
  locale: string,
  t: GalleryTranslate,
): string {
  const date = group.date;
  const dayMs = 24 * 60 * 60 * 1000;
  const startOfDay = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / dayMs);
  const datePart =
    date.getFullYear() === now.getFullYear()
      ? date.toLocaleDateString(locale, { month: "numeric", day: "numeric" })
      : date.toLocaleDateString(locale, { year: "numeric", month: "numeric", day: "numeric" });
  const relative = diffDays === 0 ? t("Today") : diffDays === 1 ? t("Yesterday") : null;
  const count =
    group.items.length === 1
      ? t("{count} item", { count: 1 })
      : t("{count} items", { count: group.items.length });
  return relative ? `${relative} · ${datePart} · ${count}` : `${datePart} · ${count}`;
}

/** A tile's time under a date-sorted listing, 24-hour `HH:MM`. */
export function galleryTileTime(iso: string, locale: string): string {
  return new Date(iso).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Toggles one id in the selection, returning a new set. */
export function toggleGallerySelection(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Selected files over this size are saved in smaller batches instead of one zip. */
export const GALLERY_SAVE_MAX_BYTES = 500 * 1024 * 1024;

export function galleryTotalBytes(items: readonly Pick<GalleryItem, "size">[]): number {
  return items.reduce((sum, item) => sum + item.size, 0);
}

export function isGallerySaveOverLimit(totalBytes: number): boolean {
  return totalBytes > GALLERY_SAVE_MAX_BYTES;
}

export function galleryZipFileName(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `rakazo-gallery-${now.getFullYear()}${month}${day}.zip`;
}
