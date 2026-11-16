import {
  createConversationShare,
  listConversationShares,
  restoreConversationShare,
  revokeConversationShare,
} from "../conversation-shares.js";
import type { RouterContext } from "./context.js";

export function sharesRoutes(ctx: RouterContext) {
  const { deps, authed } = ctx;
  const shareDeps = () => ({
    prisma: deps.prisma,
    secrets: deps.secrets,
    webOrigin: deps.env.webOrigin,
  });
  return {
    shares: {
      create: authed.shares.create.handler(({ context, input }) =>
        createConversationShare(
          shareDeps(),
          context.actor,
          input,
          context.signal ?? new AbortController().signal,
        ),
      ),
      list: authed.shares.list.handler(({ context, input }) =>
        listConversationShares(shareDeps(), context.actor, input),
      ),
      revoke: authed.shares.revoke.handler(({ context, input }) =>
        revokeConversationShare(shareDeps(), context.actor, input.shareId),
      ),
      restore: authed.shares.restore.handler(({ context, input }) =>
        restoreConversationShare(shareDeps(), context.actor, input.shareId),
      ),
    },
  };
}
