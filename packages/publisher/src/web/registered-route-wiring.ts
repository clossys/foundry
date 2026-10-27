import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import type { WiringCheckedProvider, WiringRoutes } from "@clossys/designer/catalog";
import { routeProviderMount, routeSourcePath } from "../core/route-registry.js";
import type { RouteRegistry } from "../core/route-registry.js";
import { checkRegisteredRoutes, parseRegisteredRouteContract } from "./registered-route-check.js";
import type { RegisteredRouteCheckInput } from "./registered-route-check.js";
import { emitRegisteredRoutePage } from "./registered-route-source.js";

/** The runtime assembly entry every emitted registered-route page renders. */
export const REGISTERED_ROUTE_WIRING_ASSEMBLY: WiringRoutes["assembly"] = Object.freeze([Object.freeze({ module: "@clossys/publisher/web/registered-route", export: "RegisteredRoutePage" })]);
const sha = (text: string): `sha256:${string}` => `sha256:${createHash("sha256").update(text).digest("hex")}`;
/** The same read discipline as the registered-route check: consumer-relative, no symlink, regular UTF-8 file. */
async function readSource(root: string, path: string): Promise<string> {
  if (!routeSourcePath(path)) throw new Error("Consumer-relative source path required");
  let at = root;
  for (const part of path.split("/")) { at = join(at, part); if ((await fs.lstat(at)).isSymbolicLink()) throw new Error("Route source symlinks are refused"); }
  const handle = await fs.open(at, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { if (!(await handle.stat()).isFile()) throw new Error("Route source must be a regular file"); return new TextDecoder("utf-8", { fatal: true }).decode(await handle.readFile()); }
  finally { await handle.close(); }
}
const readOrMissing = (root: string, path: unknown): Promise<string | undefined> => typeof path === "string" ? readSource(root, path).catch(() => undefined) : Promise.resolve(undefined);
/** The relative specifier the emitter writes from one consumer-relative file to another. */
function specifier(from: string, to: string): string {
  const a = from.split("/"), b = to.split("/"); a.pop();
  while (a.length && a[0] === b[0]) { a.shift(); b.shift(); }
  const path = [...a.map(() => ".."), ...b].join("/");
  return path.startsWith(".") ? path : `./${path}`;
}

/** WL10 input for a consumer's registered routes: every emitted page as a route module, the
 * runtime assembly entry, and a checked-provider proof for each route whose registered provider
 * passed this package's nonvisual provider check (`checkRegisteredRoutes`) and whose page is the
 * emitter's exact output. Proofs are issued only here, from bytes read before and after that
 * check and required unchanged; a route that does not qualify gets no proof, so Designer's
 * `checkWiring` keeps reporting its wrapper. A proof is integrity-bound data, not a signature. */
export async function registeredRouteWiringRoutes(input: RegisteredRouteCheckInput): Promise<{ readonly routes: WiringRoutes; readonly refused: readonly string[] }> {
  const root = await fs.realpath(resolve(input.root)), contract = parseRegisteredRouteContract(input.contract);
  const registryText = await readSource(root, contract.registry.file);
  const registry = JSON.parse(registryText) as RouteRegistry;
  const routes = Array.isArray(registry?.routes) ? registry.routes : [];
  const fileOf = (route: RouteRegistry["routes"][number]) => ({ page: route?.composition?.source?.file, provider: route?.composition?.provider?.source?.file });
  const before = new Map<string, string | undefined>();
  for (const route of routes) for (const file of Object.values(fileOf(route))) if (typeof file === "string" && !before.has(file)) before.set(file, await readOrMissing(root, file));
  const checked = await checkRegisteredRoutes({ ...input, root });
  const registryStable = await readOrMissing(root, contract.registry.file) === registryText;
  const modules: { path: string; content: string }[] = [], providers: WiringCheckedProvider[] = [], refused: string[] = [];
  for (const route of routes) {
    const { page, provider: providerFile } = fileOf(route), id = String(route?.routeId);
    const content = typeof page === "string" ? before.get(page) : undefined;
    if (content === undefined || await readOrMissing(root, page) !== content) { refused.push(`${id}: emitted page unreadable or changed during the check`); continue; }
    if (!modules.some(row => row.path === page)) modules.push({ path: page!, content });
    const provider = route.composition.provider;
    if (provider === undefined) continue;
    let emitted: string | undefined;
    try { emitted = emitRegisteredRoutePage(contract.registry.module, route); } catch { emitted = undefined; }
    const bytes = typeof providerFile === "string" ? before.get(providerFile) : undefined;
    const proved = registryStable && routeProviderMount(route) !== undefined && emitted === content && bytes !== undefined && await readOrMissing(root, providerFile) === bytes
      && checked.classifications.some(row => row.file === providerFile && row.kind === "provider") && !checked.findings.some(row => row.file === providerFile);
    if (!proved) { refused.push(`${id}: registered provider has no current nonvisual proof at the exact emitted mount`); continue; }
    const fields = { kind: "publisher.registered-provider-check" as const, version: 1 as const, route: { path: page!, hash: sha(content) }, provider: { file: providerFile!, export: provider.source.export, hash: sha(bytes!) }, mount: provider.id };
    const digest = sha(JSON.stringify([fields.kind, fields.version, fields.route.path, fields.route.hash, fields.provider.file, fields.provider.export, fields.provider.hash, fields.mount]));
    providers.push({ route: page!, module: specifier(page!, providerFile!), export: provider.source.export, proof: { ...fields, digest } });
  }
  return { routes: { modules, assembly: REGISTERED_ROUTE_WIRING_ASSEMBLY, providers }, refused };
}
