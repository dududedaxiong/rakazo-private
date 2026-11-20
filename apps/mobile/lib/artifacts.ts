import type { Artifact, RpcInput, RpcOutput } from "@rakazo_mickvvw/contracts";
import type {
  ArtifactCategory,
  ArtifactCategoryMapping,
  ArtifactSoftwareKind,
} from "@rakazo_mickvvw/core";
import { artifactCategoryForFile, DEFAULT_ARTIFACT_CATEGORY_MAPPING } from "@rakazo_mickvvw/core";
import { rpc } from "./api";
import type { MobileArtifactTarget } from "./artifact-open";

/**
 * An artifact travels as base64 inside the RPC body: up to the attachment limit (10 MiB) plus
 * a third of encoding overhead. The default RPC timeout is sized for small JSON replies and
 * gives up on a multi-megabyte photo over a relayed cellular link, so downloads get a budget
 * of their own.
 */
export const ARTIFACT_DOWNLOAD_TIMEOUT_MS = 120_000;

export type MobileArtifactSummary = RpcOutput<"artifacts/listSpace">["items"][number];

export function listSpaceArtifacts(input: RpcInput<"artifacts/listSpace">) {
  return rpc("artifacts/listSpace", input);
}

export function listArtifactVersions(familyId: string) {
  return rpc("artifacts/listVersions", { familyId });
}

export function getArtifactById(artifactId: string) {
  return rpc("artifacts/getById", { artifactId }, { timeoutMs: ARTIFACT_DOWNLOAD_TIMEOUT_MS });
}

export function removeArtifact(artifactId: string) {
  return rpc("artifacts/remove", { artifactId });
}

/** Renames the family's latest version; the server returns the saved name. */
export function renameArtifact(artifactId: string, name: string) {
  return rpc("artifacts/rename", { artifactId, name });
}

/** Group scope wins: a bot-scoped read drops rows that also have a group id. */
export function artifactThreadTarget(
  artifact: Pick<Artifact, "botId" | "groupId">,
): MobileArtifactTarget | null {
  if (artifact.groupId) return { groupId: artifact.groupId };
  if (artifact.botId) return { botId: artifact.botId };
  return null;
}

/** Client-side search over an already-loaded page, matching the web Artifacts page. */
export function matchesArtifactQuery(
  item: Pick<Artifact, "name" | "description">,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    item.name.toLowerCase().includes(needle) ||
    (item.description?.toLowerCase().includes(needle) ?? false)
  );
}

/** Client-side category filter over an already-loaded page. */
export function matchesArtifactCategory(
  item: Pick<Artifact, "name" | "mimeType">,
  category: ArtifactCategory | "all",
  softwareKind: ArtifactSoftwareKind | "all",
  mapping: ArtifactCategoryMapping = DEFAULT_ARTIFACT_CATEGORY_MAPPING,
): boolean {
  if (category === "all") return true;
  const result = artifactCategoryForFile(item, mapping);
  if (result.category !== category) return false;
  if (category === "software" && softwareKind !== "all") {
    return result.softwareKind === softwareKind;
  }
  return true;
}
