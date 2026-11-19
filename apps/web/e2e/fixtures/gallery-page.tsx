import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { i18n } from "../../src/lib/i18n";
import { messages } from "../../src/locales/zh-CN/messages.po";
import { GalleryPage } from "../../src/pages/Gallery";
import "../../src/styles.css";

// Renders the real GalleryPage with canned RPC answers so the grid, preview
// and selection bar can be reviewed in a real browser without a backend.

i18n.load("zh-CN", messages as Parameters<typeof i18n.load>[1]);
i18n.activate("zh-CN");

const theme = new URLSearchParams(location.search).get("theme");
if (theme === "light" || theme === "dark") {
  document.documentElement.setAttribute("data-theme", theme);
}

const now = Date.now();
const hour = 60 * 60 * 1000;
const at = (hoursAgo: number) => new Date(now - hoursAgo * hour).toISOString();

const items = [
  {
    id: "family-1",
    botId: "bot-1",
    groupId: null,
    runId: null,
    name: "generated-sunset.png",
    description: null,
    mimeType: "image/png",
    size: 59273,
    version: 1,
    createdAt: at(1),
    versionCount: 1,
  },
  {
    id: "family-2",
    botId: "bot-1",
    groupId: null,
    runId: null,
    name: "generated-portrait.png",
    description: null,
    mimeType: "image/png",
    size: 1240000,
    version: 1,
    createdAt: at(4),
    versionCount: 1,
  },
  {
    id: "family-3",
    botId: "bot-1",
    groupId: null,
    runId: null,
    name: "generated-clip.mp4",
    description: null,
    mimeType: "video/mp4",
    size: 1400000,
    version: 1,
    createdAt: at(6),
    versionCount: 1,
  },
  {
    id: "family-4",
    botId: "bot-1",
    groupId: null,
    runId: null,
    name: "generated-poster.png",
    description: null,
    mimeType: "image/png",
    size: 840000,
    version: 1,
    createdAt: at(26),
    versionCount: 1,
  },
  {
    id: "family-5",
    botId: "bot-1",
    groupId: null,
    runId: null,
    name: "generated-walk.mp4",
    description: null,
    mimeType: "video/mp4",
    size: 3100000,
    version: 1,
    createdAt: at(30),
    versionCount: 1,
  },
  {
    id: "family-6",
    botId: "bot-1",
    groupId: null,
    runId: null,
    name: "generated-old.png",
    description: null,
    mimeType: "image/png",
    size: 210000,
    version: 1,
    createdAt: at(74),
    versionCount: 1,
  },
];

// 1x1 red PNG so image tiles render as pictures, not icon placeholders.
const RED_PIXEL_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function sortedItems(sort: string | undefined) {
  const copy = [...items];
  if (sort === "date-asc") copy.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  else if (sort === "size-desc") copy.sort((a, b) => b.size - a.size);
  else if (sort === "size-asc") copy.sort((a, b) => a.size - b.size);
  else copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return copy;
}

const realFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = input instanceof Request ? input : new Request(input as never, init);
  const url = request.url;
  // oRPC's RPC wire format wraps the payload: { json: <value>, meta? }.
  // The body lives on the Request object, not on init.
  let payload: Record<string, unknown> = {};
  try {
    const text = await request.clone().text();
    if (text) payload = (JSON.parse(text) as { json?: Record<string, unknown> }).json ?? {};
  } catch {
    payload = {};
  }
  const json = (value: unknown) =>
    new Response(JSON.stringify({ json: value }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  if (url.endsWith("/rpc/bootstrap")) {
    return json({
      me: {
        ticketBoardEnabled: false,
        userId: "user-1",
        email: "test@example.com",
        name: "Test",
        spaceId: "space-1",
        isDeploymentOwner: false,
        needsModel: false,
        defaultProvider: null,
        defaultModel: null,
        hostCredentialProvider: null,
        hostCredentialSource: null,
        computerHost: null,
        canChooseHostComputer: false,
        sandboxProvider: "docker",
      },
      bots: [{ id: "bot-1", name: "New Bot" }],
    });
  }
  if (url.endsWith("/rpc/artifacts/listSpace")) {
    return json({
      items: sortedItems(payload.sort as string | undefined),
      nextCursor: null,
    });
  }
  if (url.endsWith("/rpc/artifacts/get")) {
    const item = items.find((entry) => entry.id === (payload.artifactId as string)) ?? items[0];
    return json({ ...item, contentBase64: RED_PIXEL_BASE64 });
  }
  if (url.endsWith("/rpc/artifacts/remove") || url.endsWith("/rpc/artifacts/rename")) {
    const name = url.endsWith("/rpc/artifacts/rename")
      ? `${String(payload.name ?? "renamed")}.png`
      : undefined;
    return json(name ? { ok: true, name } : { ok: true });
  }
  return realFetch(input, init);
}) as typeof window.fetch;

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

createRoot(document.getElementById("root")!).render(
  <I18nProvider i18n={i18n}>
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/app/gallery"]}>
        <GalleryPage />
      </MemoryRouter>
    </QueryClientProvider>
  </I18nProvider>,
);
