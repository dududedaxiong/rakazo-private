// @vitest-environment jsdom

import type { BillingStatus, Bot, Group } from "@rakazo_mickvvw/contracts";
import { BOT_COLORS } from "@rakazo_mickvvw/contracts";
import type * as UiWeb from "@rakazo_mickvvw/ui-web";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const billing = vi.hoisted(() => ({ status: null as Partial<BillingStatus> | null }));
const writeText = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.reduce((text, part, index) => text + part + (values[index] ?? ""), ""),
  }),
  Trans: ({ children }: { children: ReactNode }) => children,
  Plural: ({ value, one, other }: { value: number; one: string; other: string }) =>
    (value === 1 ? one : other).replace("#", String(value)),
}));
vi.mock("@rakazo_mickvvw/ui-web", async (importOriginal) => {
  const { useCopyText } = await importOriginal<typeof UiWeb>();
  const Plain = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    useCopyText,
    BotAvatar: () => null,
    Input: (props: Record<string, unknown>) => <input {...props} />,
    GroupAvatar: () => null,
    Button: ({
      variant: _v,
      size: _s,
      ...props
    }: ComponentProps<"button"> & Record<string, unknown>) => <button type="button" {...props} />,
    Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) =>
      open ? <div role="dialog">{children}</div> : null,
    DialogContent: Plain,
    DialogHeader: Plain,
    DialogTitle: Plain,
    DropdownMenu: ({ children }: { children?: ReactNode }) => <>{children}</>,
    DropdownMenuContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DropdownMenuGroup: Plain,
    DropdownMenuItem: Plain,
    DropdownMenuLabel: Plain,
    DropdownMenuSeparator: () => <hr />,
    DropdownMenuTrigger: ({ render, children }: { render?: ReactNode; children?: ReactNode }) => (
      <>
        {render}
        {children}
      </>
    ),
    toast: () => undefined,
  };
});
vi.mock("../../components/IconTooltip", () => ({
  IconTooltip: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../../components/SubscriptionGate", () => ({
  useBilling: () => ({ status: billing.status, showPlans: () => undefined }),
}));

import { ChatHeader } from "./chat-header";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  billing.status = null;
  writeText.mockClear();
});

function renderHeader({
  inGroup = false,
  voiceReady = false,
  readingConversation = false,
  canReadConversation = false,
  onReadConversation = () => undefined,
} = {}) {
  act(() =>
    root.render(
      <ChatHeader
        inGroup={inGroup}
        active={
          inGroup ? undefined : ({ id: "bot-1", name: "Helper", color: BOT_COLORS[0] } as Bot)
        }
        activeGroup={
          inGroup ? ({ id: "group-1", name: "Team", members: [] } as unknown as Group) : undefined
        }
        activeSnapshot={null}
        phoneCallsEnabled={false}
        voiceReady={voiceReady}
        inCall={false}
        readingConversation={readingConversation}
        canReadConversation={canReadConversation}
        onReadConversation={onReadConversation}
        panelOpen={false}
        onOpenNavigation={() => undefined}
        onTogglePanel={() => undefined}
        onCall={() => undefined}
        onFind={() => undefined}
        onExportConversation={() => undefined}
        onShareConversation={() => undefined}
        onSelectMessages={() => undefined}
      />,
    ),
  );
}

const readConversationButton = () =>
  container.querySelector<HTMLButtonElement>('[data-testid="read-conversation-button"]');

const searchButton = () =>
  container.querySelector<HTMLButtonElement>('[data-testid="search-in-conversation-button"]');

const exportButton = () =>
  container.querySelector<HTMLButtonElement>('[data-testid="export-conversation-button"]');

const selectButton = () =>
  container.querySelector<HTMLButtonElement>('[data-testid="select-messages-button"]');

const gift = () => container.querySelector<HTMLButtonElement>('[aria-label="Invite a friend"]');

it("keeps the header strip opaque so a scrolled message cannot show through it", () => {
  renderHeader();
  // The transcript scrolls under this floating header; without a solid
  // background a message bubble shows through the gaps between the pills
  // and the title area looks empty.
  const classes = container.firstElementChild?.className.split(" ") ?? [];
  expect(classes).toContain("bg-background");
});

it("shows the persona switcher in a bot chat and not in a group", () => {
  billing.status = { referral: null };
  renderHeader();
  expect(container.querySelector('[data-testid="persona-switcher"]')).not.toBeNull();
  renderHeader({ inGroup: true });
  expect(container.querySelector('[data-testid="persona-switcher"]')).toBeNull();
});

it("shows the read-conversation entry when voice is ready and the chat has something to read", () => {
  renderHeader({ voiceReady: true, canReadConversation: true });
  const button = readConversationButton();
  expect(button).not.toBeNull();
  expect(button?.getAttribute("aria-label")).toBe("Read conversation");
});

it("hides the read-conversation entry when voice is not ready or nothing is speakable", () => {
  renderHeader({ voiceReady: false, canReadConversation: true });
  expect(readConversationButton()).toBeNull();
  renderHeader({ voiceReady: true, canReadConversation: false });
  expect(readConversationButton()).toBeNull();
});

it("hides the read-conversation entry in a group", () => {
  renderHeader({ inGroup: true, voiceReady: true, canReadConversation: true });
  expect(readConversationButton()).toBeNull();
});

it("toggles the read-conversation entry while reading", () => {
  const onReadConversation = vi.fn();
  renderHeader({
    voiceReady: true,
    canReadConversation: true,
    readingConversation: true,
    onReadConversation,
  });
  const button = readConversationButton()!;
  expect(button.getAttribute("aria-label")).toBe("Stop reading");
  act(() => button.click());
  expect(onReadConversation).toHaveBeenCalledTimes(1);
});

it("shows no gift when the account cannot invite", () => {
  billing.status = { referral: null };
  renderHeader();
  expect(gift()).toBeNull();
});

it("shows the gift only in a bot chat, as mobile does", () => {
  billing.status = { referral: { url: "https://example.test/sign-up?ref=abc", rewards: 0 } };
  renderHeader({ inGroup: true });
  expect(gift()).toBeNull();
});

it("opens the invite with both rewards and copies the link", async () => {
  billing.status = { referral: { url: "https://example.test/sign-up?ref=abc", rewards: 2 } };
  renderHeader();
  act(() => gift()!.click());
  const dialog = container.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("Give a friend 2 weeks free");
  expect(dialog.textContent).toContain("They get 2 weeks free.");
  expect(dialog.textContent).toContain(
    "You get a free month when they start their trial with a new card.",
  );
  // The link is also shown, so it can be copied by hand.
  expect(dialog.querySelector<HTMLInputElement>('input[aria-label="Invite link"]')?.value).toBe(
    "https://example.test/sign-up?ref=abc",
  );
  expect(dialog.textContent).toContain("2 free months earned");
  const copy = [...dialog.querySelectorAll("button")].find(
    (button) => button.textContent === "Copy link",
  )!;
  await act(async () => copy.click());
  expect(writeText).toHaveBeenCalledWith("https://example.test/sign-up?ref=abc");
  expect(dialog.textContent).toContain("Copied");
});

it("shows the search button in a bot chat and in a group", () => {
  renderHeader();
  expect(searchButton()).not.toBeNull();
  renderHeader({ inGroup: true });
  expect(searchButton()).not.toBeNull();
});

it("shows the export button in a bot chat and in a group", () => {
  renderHeader();
  expect(exportButton()).not.toBeNull();
  renderHeader({ inGroup: true });
  expect(exportButton()).not.toBeNull();
});

it("shows the select-messages button in a bot chat and in a group", () => {
  renderHeader();
  expect(selectButton()).not.toBeNull();
  renderHeader({ inGroup: true });
  expect(selectButton()).not.toBeNull();
});
