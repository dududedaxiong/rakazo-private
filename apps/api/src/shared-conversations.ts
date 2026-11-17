import { SHARED_CONVERSATION_PATH_PREFIX } from "@rakazo_mickvvw/contracts";
import type { PrismaClient } from "@rakazo_mickvvw/db";
import type { Context, Hono } from "hono";
import { readSharedConversation } from "./conversation-shares.js";
import { throttleKey, windowCounter } from "./window-counter.js";

const MINUTE_MS = 60_000;
const READS_PER_IP_PER_MINUTE = 120;

/**
 * Anyone with a conversation's link reads its redacted snapshot here, signed
 * out. Every token that does not open a shared conversation gets the same 404,
 * and nothing here runs tools or models.
 */
export function mountSharedConversations(
  app: Hono,
  prisma: PrismaClient,
  clientIp: (c: Context) => string | undefined,
) {
  const reads = windowCounter(MINUTE_MS);
  app.get(`${SHARED_CONVERSATION_PATH_PREFIX}:token`, async (c) => {
    const headers = {
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
      "referrer-policy": "no-referrer",
    };
    if (reads(throttleKey(clientIp(c))) > READS_PER_IP_PER_MINUTE) {
      return c.json({ error: "Too many requests" }, 429, { ...headers, "retry-after": "60" });
    }
    const conversation = await readSharedConversation(prisma, c.req.param("token"));
    if (!conversation) return c.json({ error: "Not found" }, 404, headers);
    return c.json(conversation, 200, headers);
  });
}
