import { createHash } from "node:crypto";
import { join } from "node:path";
import type { SkillManifestDocument, SkillManifestEntry, SkillsManifestSummary, WorkspaceHost } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** sha256 hex digest of a skill's final composed content (post contract injection). */
export function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** Tiny semver-ish compare, duplicated from core.ts to keep this module dependency-free within the package. */
function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const parse = (version: string): readonly number[] | null => {
    const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
  };
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return null;
  for (let index = 0; index < 3; index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? 0;
    if (l < r) return -1;
    if (l > r) return 1;
  }
  return 0;
}

/** Parses `clossys/.state/skills.json`. An unreadable or malformed document is treated as absent. */
export function parseSkillManifest(raw: string | null): SkillManifestDocument | undefined {
  if (raw === null) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !Array.isArray(parsed.skills)) return undefined;
  const skills: SkillManifestEntry[] = [];
  for (const entry of parsed.skills) {
    if (!isRecord(entry)) continue;
    const { name, source, sha256 } = entry;
    if (typeof name !== "string" || name.trim() === "") continue;
    if (source !== "installed" && source !== "catalogue") continue;
    if (typeof sha256 !== "string" || sha256.trim() === "") continue;
    skills.push({
      name,
      source,
      sha256,
      ...(typeof entry.version === "string" && entry.version.trim() !== "" ? { version: entry.version } : {}),
    });
  }
  return {
    schemaVersion: 1,
    generatedAt: typeof parsed.generatedAt === "string" ? parsed.generatedAt : "",
    skills,
  };
}

export function serializeSkillManifest(document: SkillManifestDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

/**
 * Freshness summary for the health report: "N skills out of date, M
 * retired". `stale` counts catalogue-sourced entries whose recorded version
 * is older than `liveLauncherVersion` (a client running an old launcher
 * carries a catalogue only as fresh as that release, #1033) — unknown or
 * unparseable versions are never counted stale. `retiredThisRun` is supplied
 * by the composition step that just ran; a read-only inspection (no
 * composition) reports 0 retired, which is correct — retirement is a
 * this-run event, not a property of the manifest at rest.
 */
export function summarizeSkillsManifest(
  manifest: SkillManifestDocument | undefined,
  liveLauncherVersion: string | undefined,
  retiredThisRun: readonly string[],
): SkillsManifestSummary {
  if (manifest === undefined) {
    return { status: "missing", total: 0, stale: 0, retired: retiredThisRun.length };
  }
  const stale = manifest.skills.filter((entry) => {
    if (entry.source !== "catalogue" || liveLauncherVersion === undefined || entry.version === undefined) return false;
    return compareVersions(entry.version, liveLauncherVersion) === -1;
  }).length;
  return { status: "present", total: manifest.skills.length, stale, retired: retiredThisRun.length };
}

/** Reads `installed` version from `<composeTargetDirectory>/node_modules/@clossys/<pkg>/package.json`. */
export function readInstalledVersion(host: WorkspaceHost, composeTargetDirectory: string, packageDir: string): string | undefined {
  const raw = host.readText(join(composeTargetDirectory, "node_modules", "@clossys", packageDir, "package.json"));
  if (raw === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isRecord(parsed) && typeof parsed.version === "string" && parsed.version.trim() !== "") return parsed.version;
  } catch {
    /* unreadable manifest; no version */
  }
  return undefined;
}
