/**
 * An ia.json `source` (SOURCE-MIGRATE step 6, check:ia-source): where the agent's IA comes from.
 * It is either `@clossys/<package>#<path>`, a file or folder inside that installed package (the
 * package IA `clossys ia sync` writes from), or `workspace#owner`, an IA the workspace owns
 * (`clossys ia <agent> --start`). Any other value, or a package path that does not exist, is refused.
 */
import { existsSync } from "node:fs";
import { isAbsolute, join, normalize, sep } from "node:path";
import { resolveInstalledPackage } from "../../agents.js";
import { PRODUCER_ROOT } from "../../package-path.js";

export const WORKSPACE_OWNED_SOURCE = "workspace#owner";
const PACKAGE_SOURCE = /^(@clossys\/[a-z0-9-]+)#(.+)$/;

export type IaSourceResolution =
  | { readonly ok: true; readonly kind: "package"; readonly packageName: string; readonly path: string }
  | { readonly ok: true; readonly kind: "workspace" }
  | { readonly ok: false; readonly reason: string };

/** `@clossys/<package>#<path>` for a path inside a package (posix separators). */
export const packageIaSource = (packageName: string, path: string) => `${packageName}#${path}`;

/** Resolve one ia.json `source`; `resolver` maps a package name to its root. */
export function resolveIaSource(source: unknown, resolver: (name: string) => string = name => name === "@clossys/producer" ? PRODUCER_ROOT : resolveInstalledPackage(name)): IaSourceResolution {
  if (source === WORKSPACE_OWNED_SOURCE) return { ok: true, kind: "workspace" };
  if (typeof source !== "string") return { ok: false, reason: "source is not a string" };
  const match = PACKAGE_SOURCE.exec(source);
  if (!match) return { ok: false, reason: `${source} is neither @clossys/<package>#<path> nor ${WORKSPACE_OWNED_SOURCE}` };
  const [, packageName, rel] = match as unknown as [string, string, string];
  const clean = normalize(rel);
  if (isAbsolute(rel) || clean === ".." || clean.startsWith(`..${sep}`)) return { ok: false, reason: `${source}: the path leaves the package` };
  let root: string;
  try { root = resolver(packageName); } catch (error) { return { ok: false, reason: `${source}: ${packageName} is not installed (${(error as Error).message})` }; }
  const path = join(root, clean);
  if (!existsSync(path)) return { ok: false, reason: `${source}: ${clean} does not exist in ${packageName}` };
  return { ok: true, kind: "package", packageName, path };
}
