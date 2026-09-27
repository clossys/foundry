/**
 * `builder hosting should-build` (issue #1526).
 *
 * Relevance is the surface's declared inputs plus every file the hosting
 * commands reference. The install command's own file is one of those, so a
 * change that touches only that file still builds.
 */

import type { HostingSurface } from "./declaration.js";
import { HOSTING_DECLARATION_FILE, HOSTING_ROUTE_FILE } from "./declaration.js";

/** The install command's own module. A change to this path is build-relevant. */
export const INSTALL_COMMAND_FILE = "src/hosting/install.ts";

export function hostingCommandReferences(): readonly string[] {
  return [
    HOSTING_DECLARATION_FILE,
    HOSTING_ROUTE_FILE,
    INSTALL_COMMAND_FILE,
    "src/hosting/should-build.ts",
    "src/hosting/cli.ts",
    "src/hosting/bin.ts",
  ];
}

export type ShouldBuildDecision = {
  readonly build: boolean;
  readonly changedInputs: readonly string[];
};

function normalizePath(value: string): string {
  const slashes = value.replace(/\\/g, "/");
  return slashes.startsWith("./") ? slashes.slice(2) : slashes;
}

function inputChanged(input: string, changedPaths: readonly string[]): boolean {
  const declared = normalizePath(input);
  return changedPaths.some((changed) => {
    const path = normalizePath(changed);
    return path === declared || path.startsWith(`${declared}/`);
  });
}

/** Declared inputs first, then the files the hosting commands reference. */
export function relevantInputs(surface: HostingSurface): readonly string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const input of [...surface.inputs, ...hostingCommandReferences()]) {
    if (seen.has(input)) continue;
    seen.add(input);
    ordered.push(input);
  }
  return ordered;
}

export function decideShouldBuild(
  surface: HostingSurface,
  changedPaths: readonly string[],
  hasPreviousRevision: boolean,
): ShouldBuildDecision {
  if (!hasPreviousRevision) return { build: true, changedInputs: ["initial"] };
  const changedInputs = relevantInputs(surface).filter((input) => inputChanged(input, changedPaths));
  return { build: changedInputs.length > 0, changedInputs };
}
