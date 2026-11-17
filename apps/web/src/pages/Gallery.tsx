import { Trans, useLingui } from "@lingui/react/macro";
import type { Artifact, Bot } from "@rakazo_mickvvw/contracts";
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
  Spinner,
} from "@rakazo_mickvvw/ui-web";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ChevronLeft, Download, Images, Play, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { VideoPreview } from "../components/ArtifactFileCard";
import { IconTooltip } from "../components/IconTooltip";
import type { ArtifactTarget } from "../lib/artifact-open";
import { downloadArtifact, fetchArtifactBytes } from "../lib/artifact-open";
import { takeInitialBootstrap } from "../lib/bootstrap";
import { desktopBridge } from "../lib/desktop";
import { useSpaceQueries } from "../lib/query";
import { formatRelativeTime } from "../lib/relative-time";
import { useArtifactImage } from "../lib/use-artifact-image";
import { errorText } from "../lib/user-error";
import { WindowChrome } from "./WindowChrome";

type GalleryArtifact = Artifact & { versionCount: number };
const NO_BOTS: Bot[] = [];
const LIST_PAGE_SIZE = 60;

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

/**
 * Every image and video the user's bots generated, newest first. A tile opens
 * the same large preview the chat uses, with a download.
 */
export function GalleryPage() {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const bots =
    useQuery({
      queryKey: queries.bootstrap.queryKey({ input: {} }),
      queryFn: () => takeInitialBootstrap(),
      select: (bootstrap) => bootstrap.bots,
    }).data ?? NO_BOTS;
  const botsById = useMemo(() => new Map(bots.map((bot) => [bot.id, bot])), [bots]);
  const listingOptions = queries.artifacts.listSpace.infiniteOptions({
    input: (cursor: string | undefined) => ({
      madeByBots: true,
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
  const autoFetchedCursorRef = useRef<string | null>(null);
  useEffect(() => {
    autoFetchedCursorRef.current = null;
  }, []);
  // Generated media may sit past a page of other bot files, so keep paging
  // while the grid is still empty.
  useEffect(() => {
    if (!nextCursor || loadingMore || items === null) return;
    if (generated && generated.length > 0) return;
    if (autoFetchedCursorRef.current === nextCursor) return;
    autoFetchedCursorRef.current = nextCursor;
    void listing.fetchNextPage();
  }, [nextCursor, loadingMore, items, generated, listing]);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const previewItem = generated?.find((item) => item.id === previewId) ?? null;

  function loadMore() {
    if (nextCursor && !listing.isFetchingNextPage) void listing.fetchNextPage();
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

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {listing.isPending || generated === null ? (
          <div className="grid flex-1 place-items-center text-body text-muted-foreground/80">
            {loadError ?? <Spinner aria-label={t`Loading…`} />}
          </div>
        ) : generated.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Images />
              </EmptyMedia>
              <EmptyTitle>
                <Trans>No generated images or videos yet</Trans>
              </EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
              {generated.map((item) => (
                <GalleryTile
                  key={item.id}
                  artifact={item}
                  bot={item.botId ? botsById.get(item.botId) : undefined}
                  onPreview={() => setPreviewId(item.id)}
                />
              ))}
            </div>
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
      {previewItem ? (
        <GalleryPreview
          artifact={previewItem}
          open={previewId !== null}
          onOpenChange={(open) => {
            if (!open) setPreviewId(null);
          }}
        />
      ) : null}
    </div>
  );
}

function GalleryTile({
  artifact,
  bot,
  onPreview,
}: {
  artifact: GalleryArtifact;
  bot: Bot | undefined;
  onPreview: () => void;
}) {
  const { t } = useLingui();
  const target = artifactTarget(artifact);
  const isImage = artifact.mimeType.startsWith("image/");
  const [visible, setVisible] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const src = useArtifactImage(target ?? undefined, artifact.id, visible && isImage);

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

  return (
    <div ref={container} className="group relative">
      <button
        type="button"
        onClick={onPreview}
        aria-label={t`Preview ${artifact.name}`}
        className="relative block aspect-square w-full overflow-hidden rounded-2xl bg-muted text-start"
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
        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-3 pt-6 pb-2 text-body-sm text-white">
          <span className="block truncate">{artifact.name}</span>
          <span className="block text-white/80">
            {bot?.name ?? t`Bot`} · {formatRelativeTime(artifact.createdAt)}
          </span>
        </span>
      </button>
    </div>
  );
}

function GalleryPreview({
  artifact,
  open,
  onOpenChange,
}: {
  artifact: GalleryArtifact;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLingui();
  const target = artifactTarget(artifact);
  const isImage = artifact.mimeType.startsWith("image/");
  const src = useArtifactImage(target ?? undefined, artifact.id, open && isImage);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [video, setVideo] = useState<
    | { status: "idle" | "loading" }
    | { status: "ready"; bytes: Uint8Array }
    | { status: "error"; message: string }
  >({ status: "idle" });

  useEffect(() => {
    if (!open || isImage || !target) {
      setVideo({ status: "idle" });
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
  }, [open, isImage, target, artifact.id, t]);

  async function download() {
    if (!target) return;
    setDownloadError(null);
    try {
      await downloadArtifact(target, artifact.id, artifact.name, artifact.mimeType);
    } catch {
      setDownloadError(t`Could not download ${artifact.name}. Try again.`);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[min(88vh,900px)] w-[min(960px,94vw)] flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
      >
        <header className="flex h-14 shrink-0 items-center gap-1 border-b border-border px-5">
          <DialogTitle className="min-w-0 flex-1 truncate text-body font-medium text-foreground">
            {artifact.name}
          </DialogTitle>
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
