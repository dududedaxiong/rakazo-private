import { Trans, useLingui } from "@lingui/react/macro";
import { ChatMarkdown } from "@rakazo_mickvvw/chat-ui/web";
import type { SharedConversation, SharedConversationEntry } from "@rakazo_mickvvw/contracts";
import {
  conversationShareTokenFromSlug,
  SHARED_CONVERSATION_PATH_PREFIX,
  SharedConversationSchema,
} from "@rakazo_mickvvw/contracts";
import { Button, buttonVariants } from "@rakazo_mickvvw/ui-web";
import { useQuery } from "@tanstack/react-query";
import { Pause, Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { splitTrailingMark } from "../lib/media-mark.js";

async function readSharedConversation(token: string): Promise<SharedConversation | null> {
  const response = await fetch(`${SHARED_CONVERSATION_PATH_PREFIX}${token}`, {
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Shared conversation returned ${response.status}`);
  const parsed = SharedConversationSchema.safeParse(await response.json());
  return parsed.success ? parsed.data : null;
}

function formatTime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** A conversation someone shared by link, replayed on its original timeline. */
export function SharedConversationPage() {
  return (
    <>
      {/* The link is the conversation's only key, so no state of it belongs in search results. */}
      <meta name="robots" content="noindex, nofollow" />
      <SharedConversationBody />
    </>
  );
}

function SharedConversationBody() {
  const { t } = useLingui();
  const { slugToken = "" } = useParams();
  const token = conversationShareTokenFromSlug(slugToken);
  const shared = useQuery({
    queryKey: ["shared-conversation", token],
    queryFn: () => readSharedConversation(token!),
    enabled: token !== null,
    retry: false,
  });
  const conversation = shared.data ?? null;
  const title = conversation?.title;
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);

  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<1 | 2 | 4>(1);
  const [playhead, setPlayhead] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);
  const entries = conversation?.entries ?? [];
  const total = useMemo(
    () => Math.max(1000, entries.length > 0 ? entries[entries.length - 1]!.t : 0),
    [entries],
  );
  const visible = useMemo(
    () => entries.filter((entry) => entry.t <= playhead),
    [entries, playhead],
  );

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setPlayhead((current) => {
        const next = current + 100 * speed;
        if (next >= total) {
          setPlaying(false);
          return total;
        }
        return next;
      });
    }, 100);
    return () => window.clearInterval(timer);
  }, [playing, speed, total]);

  useEffect(() => {
    if (playing) endRef.current?.scrollIntoView({ block: "end" });
  }, [visible.length, playing]);

  if (token === null || shared.data === null) {
    return (
      <main className="grid min-h-dvh place-items-center bg-background px-6 text-center">
        <div className="flex max-w-[360px] flex-col items-center gap-3">
          <img src="/favicon-32x32.png" alt="" className="size-8 rounded-full" />
          <h1 className="text-heading3 font-medium text-foreground">
            <Trans>This conversation isn't available</Trans>
          </h1>
          <p className="text-body text-muted-foreground">
            <Trans>The owner may have revoked its link or it may have expired.</Trans>
          </p>
          <a href="/" className={`${buttonVariants({ variant: "outline", size: "sm" })} mt-1`}>
            <Trans>Open Rakazo mickvvw</Trans>
          </a>
        </div>
      </main>
    );
  }
  // Busy or unreachable is not gone; a failed refresh keeps the conversation being read.
  if (shared.isError) {
    return (
      <div className="grid min-h-dvh place-items-center bg-background px-6 text-center text-body-lg text-muted-foreground">
        <div className="flex flex-col items-center gap-3">
          <p role="alert">
            <Trans>Couldn't load this conversation. Try again.</Trans>
          </p>
          <Button variant="outline" size="sm" onClick={() => void shared.refetch()}>
            <Trans>Retry</Trans>
          </Button>
        </div>
      </div>
    );
  }
  if (!conversation) {
    return (
      <div className="grid min-h-dvh place-items-center bg-background text-body-lg text-muted-foreground">
        <Trans>Loading…</Trans>
      </div>
    );
  }

  const rangeText = conversation.range
    ? t`Messages ${conversation.range.from}–${conversation.range.to} of ${conversation.range.of}`
    : "";
  const headerParts = [
    conversation.botName ?? conversation.model ?? "",
    rangeText,
    conversation.start.slice(0, 10),
  ].filter(Boolean);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col bg-background px-4">
      <header className="border-b border-border py-6">
        <h1 className="text-heading3 font-medium text-foreground">{conversation.title}</h1>
        <p className="mt-1 text-body text-muted-foreground">{headerParts.join(" · ")}</p>
      </header>
      <div className="flex flex-1 flex-col gap-4 py-6">
        {visible.map((entry, index) => (
          <ReplayEntry key={`${entry.t}-${index}`} entry={entry} />
        ))}
        {visible.length === 0 ? (
          <p className="text-body text-muted-foreground">
            <Trans>Press play to watch this conversation unfold.</Trans>
          </p>
        ) : null}
        <div ref={endRef} />
      </div>
      <div className="sticky bottom-0 border-t border-border bg-background py-4">
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => {
              if (playhead >= total) setPlayhead(0);
              setPlaying((current) => !current);
            }}
            aria-label={playing ? t`Pause` : t`Play`}
          >
            {playing ? <Pause /> : <Play />}
          </Button>
          <span className="shrink-0 text-label text-muted-foreground">
            {formatTime(playhead)} / {formatTime(total)}
          </span>
          <input
            type="range"
            min={0}
            max={total}
            step={100}
            value={playhead}
            onChange={(event) => setPlayhead(Number(event.target.value))}
            className="min-w-0 flex-1"
            aria-label={t`Replay progress`}
          />
          <div className="flex shrink-0 gap-1">
            {([1, 2, 4] as const).map((rate) => (
              <Button
                key={rate}
                type="button"
                variant={speed === rate ? "default" : "ghost"}
                size="sm"
                onClick={() => setSpeed(rate)}
              >
                {rate}×
              </Button>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}

function ReplayEntry({ entry }: { entry: SharedConversationEntry }) {
  if (entry.type === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-primary px-4 py-3 text-body text-primary-foreground">
          {entry.text}
          <MediaRefs entry={entry} />
        </div>
      </div>
    );
  }
  if (entry.type === "tool") {
    return (
      <div className="text-label text-muted-foreground">
        {entry.name}
        {entry.summary ? ` — ${entry.summary}` : ""}
      </div>
    );
  }
  const split = splitTrailingMark(entry.text);
  const text = split?.text ?? entry.text;
  const model = entry.model ?? split?.mark.modelId;
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-2xl bg-muted px-4 py-3 text-body text-foreground">
        <ChatMarkdown>{text}</ChatMarkdown>
        <MediaRefs entry={entry} />
        {model ? (
          <div className="mt-2 border-t border-border pt-2 text-label text-muted-foreground">
            <Trans>Current model: {model}</Trans>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MediaRefs({
  entry,
}: {
  entry: Extract<SharedConversationEntry, { type: "user" | "reply" }>;
}) {
  const images = entry.images ?? [];
  const files = entry.files ?? [];
  if (images.length === 0 && files.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {images.map((image) => (
        <span
          key={image.name}
          className="rounded-full border border-border bg-background px-2 py-0.5 text-label"
        >
          {image.name}
        </span>
      ))}
      {files.map((file) => (
        <span
          key={`${file.kind}-${file.name}`}
          className="rounded-full border border-border bg-background px-2 py-0.5 text-label"
        >
          {file.kind === "video" ? "▶ " : ""}
          {file.name}
        </span>
      ))}
    </div>
  );
}
