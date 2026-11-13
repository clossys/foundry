/**
 * Where a shadcn registry file lands in a consumer app: its `target`, else the directory shadcn
 * writes that file type to. The install pipeline and the specimen bundler share this one mapping,
 * so `@/components/ui/card` in a specimen resolves to the same file the real app build imports.
 */
import { isAbsolute, posix } from "node:path";

/**
 * Where shadcn writes a registry file without a `target`, by registry file type. A
 * `registry:example` lands in the components directory, as shadcn's own fallback does;
 * `registry:page` and `registry:file` need a `target`, as they do in shadcn.
 */
export const REGISTRY_DEFAULT_DIRS: Readonly<Record<string, string>> = {
  "registry:ui": "components/ui", "registry:component": "components", "registry:block": "components",
  "registry:example": "components", "registry:hook": "hooks", "registry:lib": "lib",
};

/** The app-relative path a registry file installs to, or undefined when it has none (or leaves the app). */
export function installedPath(file: { readonly path: string; readonly type?: string; readonly target?: string }): string | undefined {
  const target = file.target ?? (file.type && REGISTRY_DEFAULT_DIRS[file.type] ? `${REGISTRY_DEFAULT_DIRS[file.type]}/${posix.basename(file.path)}` : undefined);
  if (!target) return undefined;
  const normal = posix.normalize(target.replace(/^~\//, ""));
  return isAbsolute(normal) || normal.startsWith("..") ? undefined : normal;
}
