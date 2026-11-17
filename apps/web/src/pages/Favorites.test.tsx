// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const rpcClient = vi.hoisted(() => ({
  favorites: {
    list: vi.fn(async () => [] as unknown[]),
    add: vi.fn(async () => ({})),
    remove: vi.fn(async () => ({ ok: true as const })),
  },
  bootstrap: vi.fn(),
}));
vi.mock("../lib/rpc", () => ({
  rpc: rpcClient,
  rpcForSpace: () => rpcClient,
  createSpaceRpc: () => rpcClient,
  selectedSpaceId: () => null,
}));
vi.mock("../lib/bootstrap", () => ({
  takeInitialBootstrap: vi.fn().mockResolvedValue({ bots: [{ id: "bot-1", name: "Atlas" }] }),
}));
vi.mock("../lib/relative-time", () => ({ formatRelativeTime: () => "just now" }));
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) => String.raw(parts, ...values);
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});
vi.mock("../components/IconTooltip", () => ({
  IconTooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@rakazo_mickvvw/ui-web", () => {
  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Button: (props: ComponentProps<"button">) => <button {...props} />,
    buttonVariants: () => "",
    Empty: Container,
    EmptyHeader: Container,
    EmptyMedia: Container,
    EmptyTitle: Container,
    Spinner: (props: ComponentProps<"svg">) => <svg role="status" {...props} />,
  };
});

import { resetFavoritesCache } from "../lib/favorites";
import { FavoritesPage } from "./Favorites";

const favorite = {
  id: "fav-1",
  botId: "bot-1",
  messageId: "message-1",
  snippet: "Hark AI is a new search product.",
  text: "Hark AI is a new search product.",
  createdAt: "2026-11-13T00:00:00.000Z",
};
const translationFavorite = {
  id: "fav-2",
  botId: "bot-1",
  messageId: "message-2:translation",
  snippet: "Hark AI 是一款新的搜索产品。",
  text: "Hark AI 是一款新的搜索产品。",
  createdAt: "2026-11-13T01:00:00.000Z",
};

let container: HTMLDivElement;
let root: Root;
let location: { pathname: string; search: string };
function LocationProbe() {
  const current = useLocation();
  location = { pathname: current.pathname, search: current.search };
  return null;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resetFavoritesCache();
  rpcClient.favorites.list.mockReset();
  rpcClient.favorites.remove.mockReset();
  location = { pathname: "/app/favorites", search: "" };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderPage(favorites: unknown[]) {
  rpcClient.favorites.list.mockResolvedValue(favorites);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/app/favorites"]}>
          <LocationProbe />
          <FavoritesPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

it("lists favorites newest first with the bot and time", async () => {
  await renderPage([translationFavorite, favorite]);
  const rows = [...container.querySelectorAll('[data-testid="favorite-row"]')];
  expect(rows).toHaveLength(2);
  expect(rows[0]?.textContent).toContain("Hark AI 是一款新的搜索产品。");
  expect(rows[0]?.textContent).toContain("Atlas · just now");
  expect(rows[0]?.textContent).toContain("translation");
  expect(rows[1]?.textContent).toContain("Hark AI is a new search product.");
});

it("jumps back to the original message, stripping a translation suffix", async () => {
  await renderPage([translationFavorite, favorite]);
  const rows = [...container.querySelectorAll<HTMLButtonElement>('[data-testid="favorite-row"]')];
  await act(async () => {
    rows[0]?.click();
  });
  expect(location.pathname).toBe("/app/bot-1");
  expect(location.search).toBe("?m=message-2");
  await act(async () => {
    rows[1]?.click();
  });
  expect(location.search).toBe("?m=message-1");
});

it("removes a favorite from the list", async () => {
  await renderPage([favorite]);
  expect(container.querySelector('[data-testid="favorite-row"]')).not.toBeNull();
  const remove = container.querySelector<HTMLButtonElement>('button[aria-label="Remove favorite"]');
  await act(async () => {
    remove?.click();
    await flush();
  });
  expect(rpcClient.favorites.remove).toHaveBeenCalledExactlyOnceWith({
    botId: "bot-1",
    messageId: "message-1",
  });
  expect(container.querySelector('[data-testid="favorite-row"]')).toBeNull();
  expect(container.textContent).toContain("No favorites yet");
});

it("shows an empty state when nothing is saved", async () => {
  await renderPage([]);
  expect(container.textContent).toContain("No favorites yet");
  expect(container.querySelector('[data-testid="favorite-row"]')).toBeNull();
});
