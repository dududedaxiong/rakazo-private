/**
 * What a shared conversation never carries. Applied to every text that goes
 * into a share: message text, tool summaries, image alt text.
 *
 * - Credentials: `sk-…` keys and their `rk-`/`pk-` siblings, GitHub tokens,
 *   JWTs, private key blocks, `Authorization:` headers, and values assigned
 *   to names like `API_KEY=` / `"token":` that no format catches.
 * - Home folders: `/home/<name>`, `/Users/<name>`, `C:\Users\<name>` become
 *   `~` (the name is the person's account).
 * - The app's private storage (`/data/user/0/<package>/…`) becomes `…`.
 * - Pictures in Markdown (`![alt](…)`) become their alt text: a viewer must
 *   not fetch anything, and local paths mean nothing elsewhere.
 *
 * A redacted value is `[Redacted]`; the mark survives Markdown (a `*` run
 * would turn into emphasis).
 */

const REDACTED = "[Redacted]";

const PRIVATE_KEY_BLOCK =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const GITHUB_TOKEN =
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{22,255}\b/g;
const LONG_API_KEY = /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}\b/g;

// Require header context so ordinary prose such as "basic usage" stays readable.
const AUTHORIZATION_HEADER =
  /((?:proxy-)?authorization["']?\s*[:=]\s*["']?(?:Bearer|Basic)\s+)[^\s"')\]]+/gi;

/** `NAME = value` / `"name": "value"` where the name says it is a secret. */
const SECRET_ASSIGNMENT =
  /\b((?:[A-Za-z0-9]+[_-])*(?:api[_-]?key|apikey|secret|token|password|passwd|access[_-]?key|private[_-]?key|auth[_-]?token|client[_-]?secret)"?'?)(\s*[:=]\s*["']?)([^\s"',;)}]{6,})/gi;

/** A shell variable, a placeholder, or an already-redacted value, not a secret (`$TOKEN`, `${KEY}`, `<token>`, `***`, `[Redacted]`). */
const PLACEHOLDER = /^(?:\$|<|\{|\*|•|%|xxx|\[)/;

const JSON_SECRET_FIELD =
  /("(?:[A-Za-z0-9_-]*(?:password|passwd|secret|token|authorization|apikey|api_key|api-key|credential))"\s*:\s*")(?:\\.|[^"\\])*(")/gi;

const POSIX_HOME = /(?:\/Users\/|\/home\/)[^/\s]+/g;
const WINDOWS_HOME = /[A-Za-z]:\\Users\\[^\\/\s"<>|:*?]+(\\?)/gi;
const APP_STORAGE = /\/data\/(?:user\/\d+|data)\/[^\s"')\],;]+/g;

/** `[text]` as it may leave the device. */
export function redactShareText(text: string): string {
  if (!text) return text;
  let out = text.replace(PRIVATE_KEY_BLOCK, REDACTED);
  out = out.replace(JWT, REDACTED);
  out = out.replace(GITHUB_TOKEN, REDACTED);
  out = out.replace(LONG_API_KEY, REDACTED);
  out = out.replace(AUTHORIZATION_HEADER, `$1${REDACTED}`);
  out = out.replace(JSON_SECRET_FIELD, `$1${REDACTED}$2`);
  out = out.replace(SECRET_ASSIGNMENT, (match, key: string, sep: string, value: string) =>
    PLACEHOLDER.test(value) ? match : `${key}${sep}${REDACTED}`,
  );
  out = out.replace(POSIX_HOME, "~");
  out = out.replace(WINDOWS_HOME, (_match, slash: string) => (slash ? "~/" : "~"));
  out = out.replace(APP_STORAGE, "…");
  return markdownImagesToAlt(out);
}

const IMAGE_LINK = /!\[([^\]\n]*)\]\((?:[^()\s]|\([^()\s]*\))+(?:\s+"[^"\n]*")?\)/g;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

/**
 * A reply's Markdown with pictures as their alt text (`〔alt〕`), outside
 * code blocks.
 */
export function markdownImagesToAlt(markdown: string): string {
  if (!markdown.includes("![")) return markdown;
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of markdown.split("\n")) {
    if (fence !== null) {
      if (line.trimStart().startsWith(fence)) fence = null;
      out.push(line);
      continue;
    }
    const open = FENCE.exec(line);
    if (open) {
      fence = open[1]!.slice(0, 3);
      out.push(line);
      continue;
    }
    out.push(
      line.replace(IMAGE_LINK, (_match, alt: string) => {
        const trimmed = alt.trim();
        return trimmed === "" ? "" : `〔${trimmed}〕`;
      }),
    );
  }
  return out.join("\n");
}

/** `[text]` at most `[max]` characters: head and tail kept, middle replaced. */
export function cutShareText(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.round(max * 0.6);
  const tail = max - head;
  let start = head;
  let end = text.length - tail;
  // Don't split a surrogate pair.
  if (start > 0 && start < text.length) {
    const lead = text.charCodeAt(start - 1);
    if (lead >= 0xd800 && lead <= 0xdbff) start -= 1;
  }
  if (end > 0 && end < text.length) {
    const trail = text.charCodeAt(end);
    if (trail >= 0xdc00 && trail <= 0xdfff) end += 1;
  }
  return `${text.slice(0, start)}\n…\n${text.slice(end)}`;
}
