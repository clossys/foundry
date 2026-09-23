import { join } from "node:path";
import type { WorkspaceHost } from "./types.js";

/**
 * One check from docs/contracts/product-repository-layout.json's `cloudSessionBootstrap`.
 * Read-only: verifies a product repository has what a cloud agent session
 * (browser plus GitHub only, no local setup) needs to install and run the
 * team, without foundry's own heavy governance gates.
 */
export interface CloudBootstrapCheck {
  readonly id: "package-manifest" | "agents-pointer" | "hub-marker";
  readonly label: string;
  readonly satisfied: boolean;
  readonly note?: string;
}

export interface CloudBootstrapReport {
  readonly schemaVersion: 1;
  readonly checks: readonly CloudBootstrapCheck[];
  readonly ready: boolean;
}

const PACKAGE_JSON_REL = "package.json";
const PACKAGE_LOCK_REL = "package-lock.json";
const AGENTS_MD_REL = "AGENTS.md";
const HUB_MARKER_REL = join("clossys", ".state", "workspace.json");

/**
 * Runs the three product-repository-layout.json cloudSessionBootstrap checks
 * against `directory`. Never mutates anything, never runs `npm ci` itself
 * -- it checks that the manifest and lockfile are BOTH present, which is
 * the precondition a real `npm ci` needs, not a substitute for running it.
 */
export function checkCloudSessionBootstrap(host: WorkspaceHost, directory: string): CloudBootstrapReport {
  const hasManifest = host.exists(join(directory, PACKAGE_JSON_REL));
  const hasLock = host.exists(join(directory, PACKAGE_LOCK_REL));
  const manifestCheck: CloudBootstrapCheck = {
    id: "package-manifest",
    label: "package.json and package-lock.json are both present",
    satisfied: hasManifest && hasLock,
    ...(hasManifest && hasLock
      ? {}
      : {
          note: !hasManifest && !hasLock
            ? "Neither package.json nor package-lock.json exists yet."
            : !hasManifest
              ? "package-lock.json exists but package.json does not."
              : "package.json exists but package-lock.json does not -- npm ci needs both.",
        }),
  };

  const agentsRaw = host.readText(join(directory, AGENTS_MD_REL));
  const agentsPointsAtClossys = agentsRaw !== null && agentsRaw.includes("clossys/");
  const agentsCheck: CloudBootstrapCheck = {
    id: "agents-pointer",
    label: "AGENTS.md exists at the repository root and points at clossys/",
    satisfied: agentsPointsAtClossys,
    ...(agentsPointsAtClossys
      ? {}
      : { note: agentsRaw === null ? "AGENTS.md does not exist at the repository root." : "AGENTS.md exists but does not mention clossys/." }),
  };

  const hasHubMarker = host.exists(join(directory, HUB_MARKER_REL));
  const markerCheck: CloudBootstrapCheck = {
    id: "hub-marker",
    label: "clossys/.state/workspace.json (the hub marker) is present",
    satisfied: hasHubMarker,
    ...(hasHubMarker ? {} : { note: "clossys/.state/workspace.json does not exist yet." }),
  };

  const checks = [manifestCheck, agentsCheck, markerCheck];
  return { schemaVersion: 1, checks, ready: checks.every((check) => check.satisfied) };
}
