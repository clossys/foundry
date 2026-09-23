// Records which coding-agent host(s) this run linked skill discovery for
// (#1180, Launcher side), so a consumer (Advisor's next-action phrasing)
// can name the client's actual tool instead of guessing.
//
// Codex discovery verified 2026-09-22 (developers.openai.com/codex/skills,
// developers.openai.com/codex/concepts/customization): Codex reads
// repository skills directly from `.agents/skills` -- the SAME directory
// skills.ts's AGENTS_SKILLS_REL already writes the real composed skill to.
// It needs no separate discovery symlink the way Claude Code (.claude/skills)
// and Cursor (.cursor/skills) do, so "codex" is detected by the presence of
// `.agents/skills` itself, not a host-specific prefix.

import { join } from "node:path";
import type { WorkspaceHost } from "./types.js";

export type DiscoveredHost = "claude-code" | "cursor" | "codex";

export interface HostRecord {
  readonly schemaVersion: 1;
  /** Hosts whose discovery this directory currently carries. */
  readonly linkedHosts: readonly DiscoveredHost[];
  readonly recordedAt: string;
}

export const HOSTS_REL = join("clossys", ".state", "hosts.json");

const AGENTS_SKILLS_REL = join(".agents", "skills");

// Claude Code and Cursor need their own discovery symlink; Codex reads
// .agents/skills directly (see module header) and is detected separately.
const SYMLINK_DISCOVERY_PATHS: ReadonlyArray<{ host: DiscoveredHost; prefix: string }> = [
  { host: "claude-code", prefix: ".claude/skills" },
  { host: "cursor", prefix: ".cursor/skills" },
];

/** Read-only: which hosts can actually discover skills in this directory right now. */
export function detectLinkedHosts(host: WorkspaceHost, directory: string): readonly DiscoveredHost[] {
  const found: DiscoveredHost[] = [];
  for (const { host: id, prefix } of SYMLINK_DISCOVERY_PATHS) {
    if (host.isDirectory(join(directory, prefix)) || host.isSymlink(join(directory, prefix))) {
      found.push(id);
    }
  }
  if (host.isDirectory(join(directory, AGENTS_SKILLS_REL))) {
    found.push("codex");
  }
  return found;
}

export function serializeHostRecord(record: HostRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

export function parseHostRecord(raw: string | null): HostRecord | undefined {
  if (raw === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      (parsed as Record<string, unknown>).schemaVersion === 1 &&
      Array.isArray((parsed as Record<string, unknown>).linkedHosts)
    ) {
      const record = parsed as { linkedHosts: unknown[]; recordedAt: unknown };
      const linkedHosts = record.linkedHosts.filter(
        (item): item is DiscoveredHost => item === "claude-code" || item === "cursor" || item === "codex",
      );
      return {
        schemaVersion: 1,
        linkedHosts,
        recordedAt: typeof record.recordedAt === "string" ? record.recordedAt : "",
      };
    }
  } catch {
    /* falls through */
  }
  return undefined;
}
