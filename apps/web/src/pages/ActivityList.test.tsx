// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const runs = vi.hoisted(() => ({ list: vi.fn() }));
const threadsStop = vi.hoisted(() => vi.fn());
vi.mock("../lib/rpc", () => ({
  rpc: { runs, threads: { stop: threadsStop } },
  rpcForSpace: () => ({ runs }),
  createSpaceRpc: () => ({ runs }),
  selectedSpaceId: () => null,
}));
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray) => parts.join("");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});
vi.mock("@rakazo_mickvvw/ui-web", () => {
  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    BotAvatar: ({ identity }: { identity: string }) => <i data-avatar={identity} />,
    Button: (props: ComponentProps<"button">) => <button type="button" {...props} />,
    Collapsible: ({ open, children }: { open?: boolean; children?: ReactNode }) => (
      <div data-open={open === undefined ? undefined : String(open)}>{children}</div>
    ),
    CollapsibleContent: Container,
    CollapsibleTrigger: (props: ComponentProps<"button">) => <button type="button" {...props} />,
    GroupAvatar: () => <i data-avatar="group" />,
    Input: () => null,
    Label: Container,
    NativeSelect: () => null,
    NativeSelectOption: () => null,
    SectionHeading: ({ children }: { children: ReactNode }) => <h3>{children}</h3>,
    Spinner: (props: ComponentProps<"svg">) => <svg role="status" {...props} />,
  };
});

import { emptyActivityFilters } from "../lib/activity-list-filters";
import { ActivityList } from "./ActivityList";

const listProps = {
  bots: [],
  groups: [],
  toggledSections: new Set<string>(),
  onToggleSection: () => undefined,
  onOpenRun: () => undefined,
  onOpenBot: () => undefined,
  onOpenGroup: () => undefined,
  filters: emptyActivityFilters(),
  onFiltersChange: () => undefined,
  filtersExpanded: false,
  filtersId: "filters",
};

const run = {
  runId: "run-1",
  botId: "bot-1",
  botName: "Scout",
  status: "completed",
  updatedAt: new Date().toISOString(),
};

it("reopens with cached runs and refreshes them in the background", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  runs.list.mockImplementation(async ({ filter }: { filter: string }) => ({
    runs: filter === "recent" ? [run] : [],
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  document.body.append(container);
  const mount = async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <ActivityList {...listProps} />
        </QueryClientProvider>,
      );
    });
    return root;
  };
  try {
    const first = await mount();
    await vi.waitFor(() => expect(container.textContent).toContain("Scout"));
    await act(async () => first.unmount());
    await client.invalidateQueries();
    runs.list.mockClear();

    const second = await mount();
    expect(container.querySelector('[aria-label="Loading activity…"]')).toBeNull();
    expect(container.textContent).toContain("Scout");
    await vi.waitFor(() => expect(runs.list).toHaveBeenCalledTimes(2));
    await act(async () => second.unmount());
  } finally {
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("shows an empty state when there are no runs and no unread chats", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  runs.list.mockImplementation(async () => ({ runs: [] }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <ActivityList {...listProps} />
        </QueryClientProvider>,
      ),
    );
    await vi.waitFor(() =>
      expect(container.querySelector('[role="status"]')?.textContent).toBe("No runs yet"),
    );
    expect(container.querySelector('[aria-label="Loading activity…"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    client.clear();
    vi.unstubAllGlobals();
  }
});

it("hides the empty state once runs arrive", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  runs.list.mockImplementation(async ({ filter }: { filter: string }) => ({
    runs: filter === "recent" ? [run] : [],
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <ActivityList {...listProps} />
        </QueryClientProvider>,
      ),
    );
    await vi.waitFor(() => expect(container.textContent).toContain("Scout"));
    expect(container.textContent).not.toContain("No runs yet");
  } finally {
    await act(async () => root.unmount());
    client.clear();
    vi.unstubAllGlobals();
  }
});

it("groups attention, work and unread chats under folding headers", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  runs.list.mockImplementation(async ({ filter }: { filter: string }) => ({
    runs:
      filter === "active"
        ? [
            {
              ...run,
              runId: "ask",
              botId: "marketing",
              botName: "Marketing",
              status: "waiting_input",
            },
            { ...run, runId: "work", botId: "research", botName: "Research", status: "running" },
          ]
        : [],
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  const root = createRoot(container);
  const openBot = vi.fn();
  const writer = {
    id: "writer",
    name: "Writer",
    status: "completed",
    unread: true,
    preview: "Draft ready",
    color: "orange",
    updatedAt: new Date().toISOString(),
  };
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <ActivityList
            {...listProps}
            bots={[writer as never]}
            toggledSections={new Set(["activity:unread"])}
            onOpenBot={openBot}
          />
        </QueryClientProvider>,
      ),
    );
    await vi.waitFor(() => expect(container.textContent).toContain("Marketing"));
    const section = (name: string) => container.querySelector(`section[aria-label="${name}"]`)!;
    expect(section("Needs attention").textContent).toContain("Marketing");
    expect(section("Working").textContent).toContain("Research");
    expect(section("Unread").textContent).toContain("Writer");
    expect(container.querySelector('section[aria-label="Recent"]')).toBeNull();
    expect(section("Needs attention").querySelector("[data-open]")!.getAttribute("data-open")).toBe(
      "true",
    );
    expect(section("Working").querySelector("[data-open]")!.getAttribute("data-open")).toBe(
      "false",
    );
    expect(section("Unread").querySelector("[data-open]")!.getAttribute("data-open")).toBe("true");
    expect(container.textContent).not.toContain("Needs input");
    await act(async () => section("Unread").querySelectorAll("button")[1]!.click());
    expect(openBot).toHaveBeenCalledWith(expect.objectContaining({ id: "writer" }));
  } finally {
    await act(async () => root.unmount());
    client.clear();
    vi.unstubAllGlobals();
  }
});

it("right-clicks the Needs attention header to cancel its stuck runs and clear the section", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let stopped = false;
  runs.list.mockImplementation(async ({ filter }: { filter: string }) => ({
    runs:
      filter === "active" && !stopped
        ? [
            {
              ...run,
              runId: "ask",
              botId: "marketing",
              botName: "Marketing",
              status: "waiting_input",
            },
            {
              ...run,
              runId: "takeover",
              botId: "scout",
              botName: "Scout",
              groupId: "group-1",
              groupName: "Team",
              status: "waiting_takeover",
            },
          ]
        : [],
  }));
  threadsStop.mockImplementation(async () => {
    stopped = true;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <ActivityList {...listProps} />
        </QueryClientProvider>,
      ),
    );
    await vi.waitFor(() => expect(container.textContent).toContain("Marketing"));
    const header = container.querySelector('section[aria-label="Needs attention"] button');
    expect(header).not.toBeNull();
    await act(async () => {
      header!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    });
    await vi.waitFor(() => expect(threadsStop).toHaveBeenCalledTimes(2));
    expect(threadsStop).toHaveBeenNthCalledWith(1, { botId: "marketing" });
    expect(threadsStop).toHaveBeenNthCalledWith(2, { groupId: "group-1" });
    await vi.waitFor(() =>
      expect(container.querySelector('section[aria-label="Needs attention"]')).toBeNull(),
    );
  } finally {
    await act(async () => root.unmount());
    client.clear();
    container.remove();
    vi.unstubAllGlobals();
  }
});
