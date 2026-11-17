import { addFavorite, listFavorites, removeFavorite, syncFavorites } from "@rakazo_mickvvw/db";
import type { RouterContext } from "./context.js";

/**
 * A user's saved messages and message translations, shared by web and
 * mobile. `list`, `add`, and `sync` check the bot belongs to the caller
 * first, so a foreign bot id is NOT_FOUND; `remove` is scoped to the
 * caller's own rows, so a foreign bot id simply removes nothing.
 */
export function favoritesRoutes(ctx: RouterContext) {
  const { deps, repos, authed } = ctx;
  return {
    favorites: {
      list: authed.favorites.list.handler(async ({ context, input }) => {
        // A bot id the caller does not own is NOT_FOUND, so a client can
        // tell "no such bot" apart from "this bot has no favorites".
        if (input.botId) await repos.getBot(context.actor, input.botId);
        return listFavorites(deps.prisma, context.actor, input.botId);
      }),
      add: authed.favorites.add.handler(async ({ context, input }) => {
        await repos.getBot(context.actor, input.botId);
        return addFavorite(deps.prisma, context.actor, input);
      }),
      remove: authed.favorites.remove.handler(async ({ context, input }) => {
        await removeFavorite(deps.prisma, context.actor, input);
        return { ok: true as const };
      }),
      sync: authed.favorites.sync.handler(async ({ context, input }) => {
        await repos.getBot(context.actor, input.botId);
        return syncFavorites(deps.prisma, context.actor, input);
      }),
    },
  };
}
