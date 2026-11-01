/** Package-owned inputs for canonical Studio records; consumer paths never select files. */
import { lstat, readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SpecimenDependencies, SpecimenRecord } from "@clossys/publisher/specimen";

const STUDIO_ROOT = fileURLToPath(new URL("../../studio/", import.meta.url));
/** The finite runtime closure used by Studio's frame and section records. */
export const STUDIO_DEPENDENCY_FILES = Object.freeze([
  "lib/studio-icons.tsx", "components/StudioProviders.tsx", "components/StudioRouteMap.tsx",
  "lib/cells-client.ts", "lib/cell-events.ts", "lib/studio-report.ts", "lib/studio-route-map.ts",
  "lib/agents.ts", "lib/agent-library.ts", "lib/designer-library.ts", "lib/leaf-status.ts",
  "generated/studio-map.ts", "generated/studio-map.json",
] as const);

const safePath = (path: unknown): path is string => typeof path === "string" && !!path && !path.startsWith("/") && !/[\\:\x00-\x1f\x7f]/.test(path) && !path.split("/").some(part => !part || part === "." || part === "..");

/** Only the inline manifest may bind payload bytes to their existing native placement. */
function studioLocations(record: SpecimenRecord): SpecimenDependencies["locations"] | undefined {
  const [slot, element, extra] = record.id.split("/");
  const layer = slot?.split(".")[0];
  const studio = slot === "frames.studio-shell" || /^sections\.studio\.[a-z0-9][a-z0-9.-]*$/.test(slot ?? "");
  if (extra || !element || !studio || (layer !== "frames" && layer !== "sections")) return undefined;
  const manifests = record.payload.files.filter(file => file.path === "registry-item.json");
  if (!manifests.length) return undefined;
  if (manifests.length !== 1) throw new Error("ambiguous Studio registry manifest");
  const manifest = JSON.parse(manifests[0]!.content);
  if (manifest.name !== element || !Array.isArray(manifest.files)) throw new Error("Studio registry manifest identity differs from its record");
  const paths = new Set<string>(), targets = new Set<string>();
  const locations: { path: string; target: string }[] = [];
  for (const file of manifest.files) {
    if (!safePath(file?.path) || !safePath(file?.target) || file.target !== `studio/${layer}/${element}/${file.path}` || paths.has(file.path) || targets.has(file.target)) throw new Error("invalid or conflicting Studio registry target");
    const payload = record.payload.files.filter(payload => payload.path === file.path);
    if (payload.length !== 1 || typeof payload[0]!.content !== "string" || (Object.hasOwn(file, "content") && (typeof file.content !== "string" || payload[0]!.content !== file.content))) throw new Error(`Studio registry target differs from payload ${file.path}`);
    paths.add(file.path); targets.add(file.target);
    locations.push({ path: file.path, target: file.target });
  }
  const code = record.payload.files.filter(file => /\.(?:[cm]?[jt]sx?)$/.test(file.path));
  if (!code.length || code.some(file => !paths.has(file.path))) throw new Error("Studio registry targets must cover every payload code file");
  return locations;
}

/** Refuse symlinks at the package root or any owned file segment. No directory traversal. */
async function ownedFile(root: string, path: string): Promise<string> {
  let current = resolve(root);
  if ((await lstat(current)).isSymbolicLink() || await realpath(current) !== current) throw new Error("Studio dependency root must be a real package directory");
  for (const segment of path.split("/")) {
    current = join(current, segment);
    if ((await lstat(current)).isSymbolicLink()) throw new Error(`Studio dependency is a symlink: ${path}`);
  }
  if (!(await lstat(current)).isFile()) throw new Error(`Studio dependency is not a file: ${path}`);
  return readFile(current, "utf8");
}

/** The root parameter is package construction input, never consumer or HTTP input. */
export async function studioDependencies(record: SpecimenRecord, root = STUDIO_ROOT): Promise<SpecimenDependencies | undefined> {
  const locations = studioLocations(record);
  if (!locations) return undefined;
  const files = [];
  for (const path of STUDIO_DEPENDENCY_FILES) files.push({ path: `studio/${path}`, content: await ownedFile(root, path) });
  return { identity: "producer-studio-host-1", locations, files };
}
