# Agent Note: Same-named spaces show their creation date

Status: implemented

## Problem

Two spaces can share the name "Personal" (one created 2026-11-07, another 2026-11-09 in a different organization), and the sidebar showed both as "Personal" with nothing to tell them apart. The user could not tell which space held their old skills and artifacts.

## Decision

- `SpaceSchema` gains an optional `createdAt` (ISO string), and the spaces list endpoint returns each space's creation time.
- In the web sidebar, when more than one visible space shares a name, the header shows the creation date after it ("Personal · 11-07", "Personal · 11-09"). Names that do not collide show no date, so the sidebar does not get noisier for everyone else.
- The mobile list is not changed in this round; it will use the same `createdAt` field when its turn comes in the next App build, so no extra App package is spent on this alone.

## Alternatives considered

- Show the date on every space: strongest reason is consistency; not used, it adds noise to the common case where names already disambiguate.
- Show the full timestamp (date and time): strongest reason is it also separates two spaces created on the same day; not used, it is too long for a sidebar header, and same-day same-name spaces are not a case seen so far.
- Rename one of the duplicate spaces server-side: strongest reason is it fixes the display without a code change; not used, the names are the user's data and the other "Personal" belongs to a different organization.

## Consequences

- `createdAt` is optional on the Space type, so older clients and the bootstrap fallback object keep working without it.
- A space without a creation time (or with an unparseable one) falls back to the bare name.
- The date is rendered in the viewer's local timezone, month-day only.
