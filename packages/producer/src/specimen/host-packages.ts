/**
 * Host packages: the workspace's own `@clossys/*` packages. They ship as vendored tarballs, never
 * from the npm registry, so the specimen substrate (a standalone Vite project in the temp dir) can
 * neither `npm install` nor resolve them. A Designer item whose code imports one (Studio's own
 * sections) renders through the host specimen mount, which resolves them from this workspace.
 */
const HOST_SCOPE = "@clossys/";
const CODE_FILE = /\.(?:[cm]?[jt]sx?)$/;
const BARE_IMPORT = /\bfrom\s*["']([^"'\n]+)["']|\bimport\s*\(?\s*["']([^"'\n]+)["']/g;

/** Whether a bare package name is a host package (`@clossys/designer-ui`). */
export const isHostPackage = (name: string): boolean => name.startsWith(HOST_SCOPE);

/** The host packages one registry item's code files import, sorted; empty for an item the substrate can build. */
export function hostPackageImports(item: { files?: readonly { path?: unknown; content?: unknown }[] }): string[] {
  const found = new Set<string>();
  for (const file of item.files ?? []) {
    if (typeof file.path !== "string" || !CODE_FILE.test(file.path) || typeof file.content !== "string") continue;
    for (const match of file.content.matchAll(BARE_IMPORT)) {
      const specifier = match[1] ?? match[2]!;
      if (isHostPackage(specifier)) found.add(specifier.split("/").slice(0, 2).join("/"));
    }
  }
  return [...found].sort();
}
