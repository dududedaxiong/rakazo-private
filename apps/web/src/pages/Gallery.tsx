import { plural, t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { Artifact, ArtifactListSort, Bot } from "@rakazo_mickvvw/contracts";
import type { ZipFileEntry } from "@rakazo_mickvvw/core";
import { formatFileSize, zipFiles } from "@rakazo_mickvvw/core";
import { writeSaved } from "@rakazo_mickvvw/core/query";
import {
  Button,
  buttonVariants,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Input,
  Spinner,
  ToggleGroup,
  ToggleGroupItem,
} from "@rakazo_mickvvw/ui-web";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, Download, Images, Pencil, Play, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { VideoPreview } from "../components/ArtifactFileCard";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { IconTooltip } from "../components/IconTooltip";
import type { ArtifactTarget } from "../lib/artifact-open";
import { downloadArtifact, downloadArtifactBytes, fetchArtifactBytes } from "../lib/artifact-open";
import { takeInitialBootstrap } from "../lib/bootstrap";
import { desktopBridge } from "../lib/desktop";
import { useSpaceQueries } from "../lib/query";
import { rpc } from "../lib/rpc";
import { useArtifactImage } from "../lib/use-artifact-image";
import { errorText } from "../lib/user-error";
import { WindowChrome } from "./WindowChrome";

type GalleryArtifact = Artifact & { versionCount: number };
type GalleryCategory = "all" | "image" | "video";
type GallerySort = ArtifactListSort;
const NO_BOTS: Bot[] = [];
const LIST_PAGE_SIZE = 60;
/** How long a press must be held before it counts as a long press. */
const LONG_PRESS_MS = 500;
/** A press that moves further than this is a scroll, not a long press. */
const LONG_PRESS_MOVE_PX = 10;
/** Selected files over this size are saved in smaller batches instead of one zip. */
const SAVE_ZIP_MAX_BYTES = 500 * 1024 * 1024;
const EMPTY_SELECTION: ReadonlySet<string> = new Set();
const SORT_CYCLE: GallerySort[] = ["date-desc", "date-asc", "size-desc", "size-asc"];

/** Generated media are named `generated-<id>.png/mp4` by the media tools. */
function isGeneratedMedia(artifact: GalleryArtifact): boolean {
  return (
    artifact.name.startsWith("generated-") &&
    (artifact.mimeType.startsWith("image/") || artifact.mimeType.startsWith("video/"))
  );
}

function artifactTarget(artifact: GalleryArtifact): ArtifactTarget | null {
  if (artifact.botId) return { botId: artifact.botId };
  if (artifact.groupId) return { groupId: artifact.groupId };
  return null;
}

function matchesCategory(artifact: GalleryArtifact, category: GalleryCategory): boolean {
  if (category === "all") return true;
  return category === "image"
    ? artifact.mimeType.startsWith("image/")
    : artifact.mimeType.startsWith("video/");
}

type DayGroup = {
  key: string;
  label: string;
  items: GalleryArtifact[];
};

/** Groups items under their local day, newest day first. */
function groupByLocalDay(items: GalleryArtifact[], now: Date, locale: string): DayGroup[] {
  const groups = new Map<string, GalleryArtifact[]>();
  for (const item of items) {
    const date = new Date(item.createdAt);
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  const startOfDay = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  return [...groups.entries()].map(([key, groupItems]) => {
    const date = new Date(groupItems[0]!.createdAt);
    const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / dayMs);
    const datePart =
      date.getFullYear() === now.getFullYear()
        ? date.toLocaleDateString(locale, { month: "numeric", day: "numeric" })
        : date.toLocaleDateString(locale, { year: "numeric", month: "numeric", day: "numeric" });
    const relative = diffDays === 0 ? t`Today` : diffDays === 1 ? t`Yesterday` : null;
    const count = t`${plural(groupItems.length, { one: "# item", other: "# items" })}`;
    return {
      key,
      label: relative ? `${relative} · ${datePart} · ${count}` : `${datePart} · ${count}`,
      items: groupItems,
    };
  });
}

function zipFileName(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `rakazo-gallery-${now.getFullYear()}${month}${day}.zip`;
}

/**
 * Every image and video the user's bots generated, newest first. A tile opens
 * the same large preview the chat uses, with a download. Long-press a tile to
 * select it, then save the selection to this device or delete it.
 */
export function GalleryPage() {
  const { i18n } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const bots =
    useQuery({
      queryKey: queries.bootstrap.queryKey({ input: {} }),
      queryFn: () => takeInitialBootstrap(),
      select: (bootstrap) => bootstrap.bots,
    }).data ?? NO_BOTS;
  const botsById = useMemo(() => new Map(bots.map((bot) => [bot.id, bot])), [bots]);
  const [category, setCategory] = useState<GalleryCategory>("all");
  const [sort, setSort] = useState<GallerySort>("date-desc");
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(EMPTY_SELECTION);
  const [pendingDelete, setPendingDelete] = useState<GalleryArtifact[] | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const selectMode = selectedIds.size > 0;
  const dateMode = sort === "date-desc" || sort === "date-asc";

  const sortLabels: Record<GallerySort, string> = {
    "date-desc": t`Date ↓`,
    "date-asc": t`Date ↑`,
    "size-desc": t`Size ↓`,
    "size-asc": t`Size ↑`,
  };

  const listingOptions = queries.artifacts.listSpace.infiniteOptions({
    input: (cursor: string | undefined) => ({
      madeByBots: true,
      sort,
      ...(cursor ? { cursor } : {}),
      limit: LIST_PAGE_SIZE,
    }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const listing = useInfiniteQuery(listingOptions);
  const items = useMemo(
    () => listing.data?.pages.flatMap((page) => page.items) ?? null,
    [listing.data],
  );
  const nextCursor = listing.data?.pages.at(-1)?.nextCursor ?? null;
  const loadingMore = listing.isFetchingNextPage;
  const loadError =
    listing.error && !listing.data ? errorText(listing.error, t`Could not load gallery.`) : null;
  const generated = useMemo(() => (items ? items.filter(isGeneratedMedia) : null), [items]);
  const visible = useMemo(
    () => (generated ? generated.filter((item) => matchesCategory(item, category)) : null),
    [generated, category],
  );
  const groups = useMemo(
    () => (dateMode && visible ? groupByLocalDay(visible, new Date(), i18n.locale) : null),
    [dateMode, visible, i18n.locale],
  );
  const previewItem = visible?.find((item) => item.id === previewId) ?? null;
  const selectedItems = useMemo(
    () => (visible ? visible.filter((item) => selectedIds.has(item.id)) : []),
    [visible, selectedIds],
  );
  const emptyMessage =
    category === "image"
      ? t`No generated images yet`
      : category === "video"
        ? t`No generated videos yet`
        : t`No generated images or videos yet`;

  const autoFetchedCursorRef = useRef<string | null>(null);
  // A new category or sort starts back at the first page.
  useEffect(() => {
    autoFetchedCursorRef.current = null;
    scrollRef.current?.scrollTo({ top: 0 });
  }, [category, sort]);
  // Generated media may sit past a page of other bot files, so keep paging
  // while the grid is still empty.
  useEffect(() => {
    if (!nextCursor || loadingMore || items === null) return;
    if (visible && visible.length > 0) return;
    if (autoFetchedCursorRef.current === nextCursor) return;
    autoFetchedCursorRef.current = nextCursor;
    void listing.fetchNextPage();
  }, [nextCursor, loadingMore, items, visible, listing]);

  function loadMore() {
    if (nextCursor && !listing.isFetchingNextPage) void listing.fetchNextPage();
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleLongPress(id: string) {
    if (selectMode) toggleSelected(id);
    else setSelectedIds(new Set([id]));
  }

  function changeCategory(next: GalleryCategory) {
    setSelectedIds(EMPTY_SELECTION);
    setCategory(next);
  }

  function cycleSort() {
    setSelectedIds(EMPTY_SELECTION);
    setSort(
      (current) => SORT_CYCLE[(SORT_CYCLE.indexOf(current) + 1) % SORT_CYCLE.length] ?? "date-desc",
    );
  }

  async function removeFromListing(ids: string[]) {
    const idSet = new Set(ids);
    await writeSaved(queryClient, listingOptions.queryKey, (current) => ({
      pages: (current?.pages ?? []).map((page) => ({
        ...page,
        items: page.items.filter((item) => !idSet.has(item.id)),
      })),
      pageParams: current?.pageParams ?? [],
    }));
    // Listings for other sorts may hold them too; they refresh when next shown.
    void queryClient.invalidateQueries({
      queryKey: queries.artifacts.listSpace.key(),
      refetchType: "none",
    });
    if (previewId && idSet.has(previewId)) setPreviewId(null);
  }

  async function renameInListing(artifactId: string, name: string) {
    await writeSaved(queryClient, listingOptions.queryKey, (current) => ({
      pages: (current?.pages ?? []).map((page) => ({
        ...page,
        items: page.items.map((item) => (item.id === artifactId ? { ...item, name } : item)),
      })),
      pageParams: current?.pageParams ?? [],
    }));
    void queryClient.invalidateQueries({
      queryKey: queries.artifacts.listSpace.key(),
      refetchType: "none",
    });
  }

  async function saveSelected() {
    if (selectedItems.length === 0 || saveBusy) return;
    const total = selectedItems.reduce((sum, item) => sum + item.size, 0);
    if (total > SAVE_ZIP_MAX_BYTES) {
      setSaveError(t`Selected files are over 500 MB. Save them in smaller batches.`);
      return;
    }
    setSaveBusy(true);
    setSaveError(null);
    try {
      const files: ZipFileEntry[] = [];
      let failedName: string | null = null;
      for (const item of selectedItems) {
        const target = artifactTarget(item);
        if (!target) {
          failedName = item.name;
          break;
        }
        try {
          files.push({ name: item.name, data: await fetchArtifactBytes(target, item.id) });
        } catch {
          failedName = item.name;
          break;
        }
      }
      if (failedName) {
        setSaveError(t`Could not save ${failedName}. Try again.`);
        return;
      }
      downloadArtifactBytes(zipFileName(new Date()), "application/zip", zipFiles(files));
    } catch {
      setSaveError(t`Could not save the selected files. Try again.`);
    } finally {
      setSaveBusy(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError(null);
    const failed: GalleryArtifact[] = [];
    for (const item of pendingDelete) {
      try {
        await rpc.artifacts.remove({ artifactId: item.id });
      } catch {
        failed.push(item);
      }
    }
    const succeeded = pendingDelete.filter((item) => !failed.includes(item));
    if (succeeded.length > 0) {
      await removeFromListing(succeeded.map((item) => item.id));
    }
    setDeleteBusy(false);
    if (failed.length === 0) {
      setPendingDelete(null);
      setSelectedIds(EMPTY_SELECTION);
    } else {
      // The failed ones stay selected, so they can be saved or retried.
      setPendingDelete(failed);
      setDeleteError(t`Could not delete ${failed.map((item) => item.name).join("、")}. Try again.`);
    }
  }

  function renderTile(item: GalleryArtifact) {
    return (
      <GalleryTile
        key={item.id}
        artifact={item}
        bot={item.botId ? botsById.get(item.botId) : undefined}
        dateMode={dateMode}
        locale={i18n.locale}
        selected={selectedIds.has(item.id)}
        selectMode={selectMode}
        onPreview={() => setPreviewId(item.id)}
        onToggleSelect={() => toggleSelected(item.id)}
        onLongPress={() => handleLongPress(item.id)}
        onDownload={() => void downloadTile(item)}
        downloading={downloadingId === item.id}
      />
    );
  }

  async function downloadTile(item: GalleryArtifact) {
    if (downloadingId) return;
    const target = artifactTarget(item);
    if (!target) return;
    setDownloadingId(item.id);
    setDownloadError(null);
    try {
      await downloadArtifact(target, item.id, item.name, item.mimeType);
    } catch {
      setDownloadError(t`Could not download ${item.name}. Try again.`);
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <div className="flex h-full min-w-0 flex-col bg-background text-foreground/90">
      <header className="app-drag flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3">
        {desktopBridge() ? <WindowChrome /> : null}
        <div className="flex min-w-fit flex-1 items-center gap-1">
          <IconTooltip label={t`Back`}>
            <Link
              to="/app"
              aria-label={t`Back`}
              className={buttonVariants({
                variant: "ghost",
                size: "icon",
                className: "app-no-drag text-muted-foreground",
              })}
            >
              <ChevronLeft />
            </Link>
          </IconTooltip>
          <h1 className="font-medium text-foreground">
            <Trans>Gallery</Trans>
          </h1>
        </div>
      </header>

      <div className="app-no-drag flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <ToggleGroup
          value={[category]}
          onValueChange={([next]) => {
            if (next) changeCategory(next as GalleryCategory);
          }}
          spacing={1}
          className="h-8 rounded-lg border border-input p-0.5"
          aria-label={t`Filter by type`}
        >
          <ToggleGroupItem
            value="all"
            aria-label={t`All`}
            className="h-full min-w-0 rounded-md px-2.5 text-body-sm text-muted-foreground aria-pressed:bg-accent aria-pressed:text-accent-foreground"
          >
            <Trans>All</Trans>
          </ToggleGroupItem>
          <ToggleGroupItem
            value="image"
            aria-label={t`Images`}
            className="h-full min-w-0 rounded-md px-2.5 text-body-sm text-muted-foreground aria-pressed:bg-accent aria-pressed:text-accent-foreground"
          >
            <Trans>Images</Trans>
          </ToggleGroupItem>
          <ToggleGroupItem
            value="video"
            aria-label={t`Videos`}
            className="h-full min-w-0 rounded-md px-2.5 text-body-sm text-muted-foreground aria-pressed:bg-accent aria-pressed:text-accent-foreground"
          >
            <Trans>Videos</Trans>
          </ToggleGroupItem>
        </ToggleGroup>
        <Button variant="outline" size="sm" onClick={cycleSort} className="ml-auto">
          {sortLabels[sort]}
        </Button>
      </div>

      {downloadError ? (
        <p role="alert" className="shrink-0 px-6 pt-2 text-body-sm text-destructive">
          {downloadError}
        </p>
      ) : null}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {listing.isPending || visible === null ? (
          <div className="grid flex-1 place-items-center text-body text-muted-foreground/80">
            {loadError ?? <Spinner aria-label={t`Loading…`} />}
          </div>
        ) : visible.length === 0 ? (
          nextCursor || loadingMore ? (
            <div className="grid flex-1 place-items-center text-body text-muted-foreground/80">
              <Spinner aria-label={t`Loading…`} />
            </div>
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Images />
                </EmptyMedia>
                <EmptyTitle>{emptyMessage}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          )
        ) : (
          <>
            {groups ? (
              groups.map((group) => (
                <section key={group.key} aria-label={group.label} className="mb-5 last:mb-0">
                  <h2 className="mb-2 text-body-sm font-medium text-foreground">{group.label}</h2>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
                    {group.items.map((item) => renderTile(item))}
                  </div>
                </section>
              ))
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
                {visible.map((item) => renderTile(item))}
              </div>
            )}
            {nextCursor ? (
              <div className="mt-4 flex justify-center">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={loadingMore}
                  onClick={loadMore}
                  aria-label={t`Load more`}
                >
                  {loadingMore ? <Spinner aria-label={t`Loading…`} /> : null}
                  <Trans>Load more</Trans>
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>

      {selectMode ? (
        <div className="shrink-0 border-t border-border px-4 py-3">
          {(saveError ?? deleteError) ? (
            <p role="alert" className="mb-2 text-body-sm text-destructive">
              {saveError ?? deleteError}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-body-sm text-muted-foreground">
              {t`${plural(selectedIds.size, { one: "# item selected", other: "# items selected" })}`}
            </span>
            <div className="ml-auto flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={saveBusy || deleteBusy}
                onClick={() => void saveSelected()}
              >
                <Trans>Save to device</Trans>
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={saveBusy || deleteBusy}
                onClick={() => {
                  setDeleteError(null);
                  setPendingDelete(selectedItems);
                }}
              >
                <Trans>Delete</Trans>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={saveBusy || deleteBusy}
                onClick={() => setSelectedIds(EMPTY_SELECTION)}
              >
                <Trans>Cancel</Trans>
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {previewItem ? (
        <GalleryPreview
          artifact={previewItem}
          open={previewId !== null}
          onOpenChange={(open) => {
            if (!open) setPreviewId(null);
          }}
          onRenamed={(name) => void renameInListing(previewItem.id, name)}
        />
      ) : null}
      {pendingDelete ? (
        <ConfirmDialog
          onCancel={() => {
            if (!deleteBusy) setPendingDelete(null);
          }}
          title={t`${plural(pendingDelete.length, { one: "Delete # item?", other: "Delete # items?" })}`}
          description={
            <Trans>Deleted files can't be recovered. Save them to your device first.</Trans>
          }
          error={deleteError}
          confirmLabel={deleteBusy ? <Trans>Deleting…</Trans> : <Trans>Delete</Trans>}
          onConfirm={() => void confirmDelete()}
          busy={deleteBusy}
        />
      ) : null}
    </div>
  );
}

function GalleryTile({
  artifact,
  bot,
  dateMode,
  locale,
  selected,
  selectMode,
  onPreview,
  onToggleSelect,
  onLongPress,
  onDownload,
  downloading,
}: {
  artifact: GalleryArtifact;
  bot: Bot | undefined;
  dateMode: boolean;
  locale: string;
  selected: boolean;
  selectMode: boolean;
  onPreview: () => void;
  onToggleSelect: () => void;
  onLongPress: () => void;
  onDownload: () => void;
  downloading: boolean;
}) {
  const target = useMemo(() => artifactTarget(artifact), [artifact.botId, artifact.groupId]);
  const isImage = artifact.mimeType.startsWith("image/");
  const [visible, setVisible] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const src = useArtifactImage(target ?? undefined, artifact.id, visible && isImage);
  const pressTimer = useRef<number | null>(null);
  const pressPoint = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const suppressTimer = useRef<number | null>(null);

  useEffect(() => {
    const element = container.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "320px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(
    () => () => {
      if (pressTimer.current !== null) window.clearTimeout(pressTimer.current);
      if (suppressTimer.current !== null) window.clearTimeout(suppressTimer.current);
    },
    [],
  );

  function cancelPress() {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
    pressPoint.current = null;
  }

  function clearSuppressClick() {
    suppressClick.current = false;
    if (suppressTimer.current !== null) {
      window.clearTimeout(suppressTimer.current);
      suppressTimer.current = null;
    }
  }

  function handlePointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    pressPoint.current = { x: event.clientX, y: event.clientY };
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null;
      pressPoint.current = null;
      suppressClick.current = true;
      onLongPress();
    }, LONG_PRESS_MS);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    const start = pressPoint.current;
    if (!start) return;
    if (
      Math.abs(event.clientX - start.x) > LONG_PRESS_MOVE_PX ||
      Math.abs(event.clientY - start.y) > LONG_PRESS_MOVE_PX
    ) {
      cancelPress();
    }
  }

  function handlePointerUp() {
    cancelPress();
    // The click after a long press usually follows at once; if it never comes
    // (the press turned into a scroll), drop the guard so the next tap works.
    if (suppressClick.current && suppressTimer.current === null) {
      suppressTimer.current = window.setTimeout(() => {
        suppressClick.current = false;
        suppressTimer.current = null;
      }, 500);
    }
  }

  function handlePointerEnd() {
    cancelPress();
    clearSuppressClick();
  }

  function handleClick(event: React.MouseEvent<HTMLButtonElement>) {
    if (suppressClick.current) {
      clearSuppressClick();
      event.preventDefault();
      return;
    }
    if (selectMode) onToggleSelect();
    else onPreview();
  }

  function handleContextMenu(event: React.MouseEvent<HTMLButtonElement>) {
    if (selectMode || suppressClick.current) event.preventDefault();
  }

  const time = new Date(artifact.createdAt).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const subtitle = dateMode
    ? `${bot?.name ?? t`Bot`} · ${time}`
    : `${formatFileSize(artifact.size)} · ${bot?.name ?? t`Bot`}`;

  return (
    <div ref={container} className="group relative">
      <button
        type="button"
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerEnd}
        onPointerLeave={handlePointerEnd}
        onContextMenu={handleContextMenu}
        aria-label={selectMode ? t`Select ${artifact.name}` : t`Preview ${artifact.name}`}
        aria-pressed={selectMode ? selected : undefined}
        style={{ WebkitTouchCallout: "none" }}
        className="relative block aspect-square w-full touch-manipulation overflow-hidden rounded-2xl bg-muted text-start select-none"
      >
        {isImage && src ? (
          <img src={src} alt={artifact.name} className="h-full w-full object-cover" />
        ) : (
          <span className="grid h-full w-full place-items-center text-muted-foreground">
            {isImage ? (
              <Images className="size-8" strokeWidth={1.5} aria-hidden="true" />
            ) : (
              <Play className="size-8" strokeWidth={1.5} aria-hidden="true" />
            )}
          </span>
        )}
        {selectMode ? (
          <span
            aria-hidden="true"
            className={
              selected
                ? "absolute top-2 right-2 grid size-6 place-items-center rounded-full bg-primary text-primary-foreground"
                : "absolute top-2 right-2 grid size-6 place-items-center rounded-full border-2 border-white/90 bg-black/30"
            }
          >
            {selected ? <Check className="size-4" strokeWidth={3} /> : null}
          </span>
        ) : null}
        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-3 pt-6 pb-2 text-body-sm text-white">
          <span className="block truncate">{artifact.name}</span>
          <span className="block text-white/80">{subtitle}</span>
        </span>
      </button>
      {selectMode ? null : (
        <button
          type="button"
          aria-label={t`Download ${artifact.name}`}
          disabled={downloading}
          onClick={() => onDownload()}
          className="absolute top-2 end-2 grid size-8 place-items-center rounded-full bg-black/50 text-white opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 max-md:opacity-100"
        >
          <Download className="size-4" strokeWidth={2} />
        </button>
      )}
      {selected ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-2xl ring-2 ring-primary"
        />
      ) : null}
    </div>
  );
}

function GalleryPreview({
  artifact,
  open,
  onOpenChange,
  onRenamed,
}: {
  artifact: GalleryArtifact;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRenamed: (name: string) => void;
}) {
  const target = useMemo(() => artifactTarget(artifact), [artifact.botId, artifact.groupId]);
  const isImage = artifact.mimeType.startsWith("image/");
  const src = useArtifactImage(target ?? undefined, artifact.id, open && isImage);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(artifact.name);
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [video, setVideo] = useState<
    | { status: "idle" | "loading" }
    | { status: "ready"; bytes: Uint8Array }
    | { status: "error"; message: string }
  >({ status: "idle" });

  useEffect(() => {
    if (!open || isImage || !target) {
      // Bail out with the same state when already idle, otherwise the fresh
      // object would re-render and re-run this effect forever.
      setVideo((prev) => (prev.status === "idle" ? prev : { status: "idle" }));
      return;
    }
    let cancelled = false;
    setVideo({ status: "loading" });
    void fetchArtifactBytes(target, artifact.id)
      .then((bytes) => {
        if (!cancelled) setVideo({ status: "ready", bytes });
      })
      .catch((error) => {
        if (!cancelled)
          setVideo({ status: "error", message: errorText(error, t`Could not load this file.`) });
      });
    return () => {
      cancelled = true;
    };
  }, [open, isImage, target, artifact.id]);

  async function download() {
    if (!target) return;
    setDownloadError(null);
    try {
      await downloadArtifact(target, artifact.id, artifact.name, artifact.mimeType);
    } catch {
      setDownloadError(t`Could not download ${artifact.name}. Try again.`);
    }
  }

  function startRename() {
    setRenameValue(artifact.name);
    setRenameError(null);
    setRenaming(true);
  }

  async function saveRename() {
    if (renameBusy) return;
    setRenameBusy(true);
    setRenameError(null);
    try {
      const result = await rpc.artifacts.rename({ artifactId: artifact.id, name: renameValue });
      onRenamed(result.name);
      setRenaming(false);
    } catch (error) {
      setRenameError(errorText(error, t`Could not rename ${artifact.name}. Try again.`));
    } finally {
      setRenameBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[min(88vh,900px)] w-[min(960px,94vw)] flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
      >
        <header className="flex h-14 shrink-0 items-center gap-1 border-b border-border px-5">
          {renaming ? (
            <>
              <DialogTitle className="sr-only">{artifact.name}</DialogTitle>
              <Input
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void saveRename();
                  if (event.key === "Escape") setRenaming(false);
                }}
                aria-label={t`Rename ${artifact.name}`}
                autoFocus
                className="min-w-0 flex-1"
              />
              <Button
                size="sm"
                disabled={renameBusy || renameValue.trim().length === 0}
                onClick={() => void saveRename()}
              >
                <Trans>Save</Trans>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={renameBusy}
                onClick={() => setRenaming(false)}
              >
                <Trans>Cancel</Trans>
              </Button>
            </>
          ) : (
            <>
              <DialogTitle className="min-w-0 flex-1 truncate text-body font-medium text-foreground">
                {artifact.name}
              </DialogTitle>
              <IconTooltip label={t`Rename`}>
                <Button
                  variant="ghost"
                  size="icon-lg"
                  className="rounded-full text-muted-foreground"
                  aria-label={t`Rename ${artifact.name}`}
                  onClick={startRename}
                >
                  <Pencil />
                </Button>
              </IconTooltip>
              <IconTooltip label={t`Download ${artifact.name}`}>
                <Button
                  variant="ghost"
                  size="icon-lg"
                  className="rounded-full text-muted-foreground"
                  aria-label={t`Download ${artifact.name}`}
                  onClick={() => void download()}
                >
                  <Download />
                </Button>
              </IconTooltip>
            </>
          )}
          <DialogClose
            aria-label={t`Close preview`}
            render={
              <Button
                variant="ghost"
                size="icon-lg"
                className="rounded-full text-muted-foreground"
              />
            }
          >
            <X />
          </DialogClose>
        </header>
        {downloadError ? (
          <div role="alert" className="shrink-0 px-5 pt-4 text-body-sm text-destructive">
            {downloadError}
          </div>
        ) : null}
        {renameError ? (
          <div role="alert" className="shrink-0 px-5 pt-4 text-body-sm text-destructive">
            {renameError}
          </div>
        ) : null}
        <div className="relative min-h-0 flex-1 overflow-y-auto">
          {isImage ? (
            src ? (
              <img src={src} alt={artifact.name} className="max-h-full max-w-full object-contain" />
            ) : (
              <div className="absolute inset-0 grid place-items-center text-muted-foreground">
                <Spinner aria-label={t`Loading preview…`} />
              </div>
            )
          ) : video.status === "ready" ? (
            <VideoPreview bytes={video.bytes} name={artifact.name} />
          ) : video.status === "error" ? (
            <div className="m-5 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-destructive">
              {video.message}
            </div>
          ) : (
            <div className="absolute inset-0 grid place-items-center text-muted-foreground">
              <Spinner aria-label={t`Loading preview…`} />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
