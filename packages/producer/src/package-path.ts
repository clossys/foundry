/**
 * Package data (standards, recipes, catalog rules, references) as a consumer root reads it.
 *
 * The Foundry repository root carries the packages it develops under `packages/<name>/`, and a
 * test world may place package data under its own `packages/`. A consumer root (one with no
 * `packages/` folder) reads the same files from the installed `@clossys/<name>` package, so the
 * guards and checks judge a consumer by the package version it resolves, never by a copy.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_PACKAGES, resolveAgent, type AgentKind } from "./agents.js";

/** This Producer package's own root (dist/ or src/ sits directly below it). */
export const PRODUCER_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const PACKAGE_REL = /^packages\/([a-z][a-z0-9-]*)(?:\/(.*))?$/;

/** The installed root of `@clossys/<name>` (or this Producer package), or undefined when it is not installed. */
export function installedPackageRoot(name: string): string | undefined {
  if (name === "producer") return PRODUCER_ROOT;
  if (!(name in AGENT_PACKAGES)) return undefined;
  try { return resolveAgent(name as AgentKind).packageRoot; } catch { return undefined; }
}

/**
 * The absolute path of `rel` (`packages/<name>/<path>`) for `root`: `root/<rel>` when `root` has a
 * `packages/` folder (the Foundry repository or a test world), else the same path inside the
 * installed package. A path outside `packages/` is always `root/<rel>`.
 */
export function packagePath(root: string, rel: string): string {
  const local = join(root, rel);
  if (existsSync(join(root, "packages"))) return local;
  const match = PACKAGE_REL.exec(rel.split("\\").join("/"));
  if (!match) return local;
  const installed = installedPackageRoot(match[1]!);
  return installed === undefined ? local : join(installed, match[2] ?? "");
}
