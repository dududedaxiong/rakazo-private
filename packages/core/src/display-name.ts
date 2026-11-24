import type { MessageBlock } from "@rakazo_mickvvw/contracts";
import { identitySource, preserveIdentitySource } from "./identity-source.js";

/** Deliberately narrow: complete tokens only, never substrings of prose or short handles. */
export function isOpaqueName(name: string): boolean {
  return (
    /^__[A-Za-z0-9_-]+__$/.test(name) ||
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(name) ||
    // Cuid v1 has a fixed prefix/length; cuid2 is 24 lowercase alphanumerics.
    (/^c[a-z0-9]{24}$/.test(name) && /[0-9]/.test(name)) ||
    (/^[a-z][a-z0-9]{23}$/.test(name) && /[0-9]/.test(name)) ||
    // Require interspersed digits and unstructured casing; numbered words/handles stay names.
    // Short generated codes read the same way, so the floor is 6 characters: a bot or skill
    // named "Ff1dE9" is a bare code, while five-character handles such as "Gpt4o" stay names.
    // A version segment after a separator ("-V4" in "krisphyn-DeepSeek-V4-Pro") is structured too.
    (/^[A-Za-z0-9_-]{6,}$/.test(name) &&
      /[a-z]/.test(name) &&
      /[A-Z]/.test(name) &&
      /[0-9]/.test(name) &&
      !/^[A-Za-z_-]+[0-9]+$/.test(name) &&
      !/^[A-Za-z][a-z]*(?:[A-Z][a-z]+|[0-9]|[_-][A-Za-z][a-z]+|[_-][A-Z][0-9]+)*$/.test(name))
  );
}

export function displayName(name: string | null | undefined, fallback: string): string {
  const trimmed = name?.trim() ?? "";
  return trimmed && /[\p{L}\p{N}]/u.test(trimmed) && !isOpaqueName(trimmed) ? trimmed : fallback;
}

/**
 * Same-named spaces are indistinguishable by name alone, so only the
 * colliding ones carry their short creation date (MM-DD) after the name.
 * Names that do not collide, and spaces without a usable creation time,
 * show the bare name.
 */
export function spaceDisplayName(
  space: { name: string; createdAt?: string | null },
  spaces: readonly { name: string }[],
): string {
  if (spaces.filter((other) => other.name === space.name).length <= 1) return space.name;
  if (!space.createdAt) return space.name;
  const date = new Date(space.createdAt);
  if (Number.isNaN(date.getTime())) return space.name;
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${space.name} · ${month}-${day}`;
}

/**
 * A model sometimes echoes its own short id as a lone first line of a
 * translation; that line is not content. Drop it only when it is an isolated
 * opaque code and real text follows — a lone code with nothing after it, or a
 * first line that is a real word, stays untouched.
 */
export function stripLeadingOpaqueCodeLine(text: string): string {
  const newline = text.indexOf("\n");
  if (newline === -1) return text;
  if (!isOpaqueName(text.slice(0, newline).trim())) return text;
  const rest = text.slice(newline + 1).replace(/^\n+/, "");
  return rest.trim() ? rest : text;
}

export function accountDisplay(
  account: { name?: string | null; email?: string | null; image?: string | null },
  fallback: string,
): { label: string; initial: string | null; image: string | null } {
  const email = account.email?.trim() ?? "";
  const name = displayName(account.name, "");
  const comparable = name.toLowerCase();
  const emailDerived =
    email &&
    (comparable === email.toLowerCase() || comparable === email.split("@")[0]?.toLowerCase());
  const label = (emailDerived ? "" : name) || email || fallback;
  return {
    label,
    initial: label.match(/[\p{L}\p{N}]/u)?.[0]?.toUpperCase() ?? null,
    image: account.image || null,
  };
}

/** Only identity metadata changes; message text, filenames and tool identifiers stay literal. */
export function displayMessageBlock(
  block: MessageBlock,
  labels = { bot: "Bot", member: "Member", subagent: "subagent" },
): MessageBlock {
  const source = block;
  block = identitySource(block);
  const named = (next: MessageBlock) => preserveIdentitySource(source, next);
  switch (block.kind) {
    case "bot_message_sent":
      return named({ ...block, toBotName: displayName(block.toBotName, labels.bot) });
    case "bot_message_received":
      return named({ ...block, fromBotName: displayName(block.fromBotName, labels.bot) });
    case "subagent":
      return named({ ...block, name: displayName(block.name, labels.subagent) });
    case "child_bot":
      return named({ ...block, name: displayName(block.name, labels.bot) });
    case "channel_message":
      return named({ ...block, fromLabel: displayName(block.fromLabel, labels.member) });
    default:
      return block;
  }
}
