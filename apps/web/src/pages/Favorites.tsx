import { Trans, useLingui } from "@lingui/react/macro";
import type { Bot, MessageFavorite } from "@rakazo_mickvvw/contracts";
import {
  buttonVariants,
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Spinner,
} from "@rakazo_mickvvw/ui-web";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Star, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { IconTooltip } from "../components/IconTooltip";
import { takeInitialBootstrap } from "../lib/bootstrap";
import { desktopBridge } from "../lib/desktop";
import {
  favoriteMessageId,
  isTranslationFavorite,
  removeFavoriteItem,
  useFavorites,
} from "../lib/favorites";
import { useSpaceQueries } from "../lib/query";
import { formatRelativeTime } from "../lib/relative-time";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";
import { WindowChrome } from "./WindowChrome";

const NO_BOTS: Bot[] = [];

/**
 * The space's saved messages, newest first. A row jumps back to its message
 * in that bot's chat; a translation favorite jumps to the message it came from.
 */
export function FavoritesPage() {
  const { t } = useLingui();
  const navigate = useNavigate();
  const { favorites, loading, error } = useFavorites(rpc);
  const queries = useSpaceQueries();
  // The space's bootstrap is where the shell keeps what it last loaded, bots included.
  const bots =
    useQuery({
      queryKey: queries.bootstrap.queryKey({ input: {} }),
      queryFn: () => takeInitialBootstrap(),
      select: (bootstrap) => bootstrap.bots,
    }).data ?? NO_BOTS;
  const botsById = useMemo(() => new Map(bots.map((bot) => [bot.id, bot])), [bots]);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const loadError = error && !favorites ? errorText(error, t`Could not load favorites.`) : null;

  async function remove(favorite: MessageFavorite) {
    setRemovingId(favorite.id);
    setRemoveError(null);
    try {
      await removeFavoriteItem(rpc, favorite);
    } catch (err) {
      setRemoveError(errorText(err, t`Could not remove this favorite.`));
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="flex h-full min-w-0 flex-col bg-background text-foreground/90">
      <header className="app-drag flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3">
        {/* This route is the window's leading edge, so Electron window controls sit in the header. */}
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
            <Trans>Favorites</Trans>
          </h1>
        </div>
      </header>

      {removeError ? (
        <p role="alert" className="px-6 py-2 text-body text-destructive">
          {removeError}
        </p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {loading || favorites === null ? (
          <div className="grid flex-1 place-items-center text-body text-muted-foreground/80">
            {loadError ?? <Spinner aria-label={t`Loading…`} />}
          </div>
        ) : favorites.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Star />
              </EmptyMedia>
              <EmptyTitle>
                <Trans>No favorites yet</Trans>
              </EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="mx-auto flex w-full max-w-2xl flex-col">
            {favorites.map((favorite) => {
              const bot = botsById.get(favorite.botId);
              const content = (
                <>
                  <span className="block text-body-lg leading-snug wrap-anywhere">
                    {favorite.snippet}
                  </span>
                  <span className="mt-1 block text-body-sm text-muted-foreground">
                    {bot?.name ?? t`Bot`} · {formatRelativeTime(favorite.createdAt)}
                    {isTranslationFavorite(favorite.messageId) ? (
                      <>
                        {" · "}
                        <Trans>translation</Trans>
                      </>
                    ) : null}
                  </span>
                </>
              );
              return (
                <li
                  key={favorite.id}
                  className="flex items-start gap-2 border-b border-border py-3 first:pt-0 last:border-b-0"
                >
                  {bot ? (
                    <button
                      type="button"
                      data-testid="favorite-row"
                      onClick={() =>
                        navigate(
                          `/app/${favorite.botId}?m=${favoriteMessageId(favorite.messageId)}`,
                        )
                      }
                      className="min-w-0 flex-1 rounded-lg px-2 py-1 text-start transition-colors hover:bg-accent"
                    >
                      {content}
                    </button>
                  ) : (
                    <div className="min-w-0 flex-1 px-2 py-1">{content}</div>
                  )}
                  <IconTooltip label={t`Remove favorite`}>
                    <button
                      type="button"
                      aria-label={t`Remove favorite`}
                      disabled={removingId === favorite.id}
                      onClick={() => void remove(favorite)}
                      className="mt-1 shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>
                  </IconTooltip>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
