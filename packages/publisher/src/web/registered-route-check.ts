import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { resolve as resolveProfile, libraryHash, runtimeHash, emittedTokenProperties, checkConsumerRuntimeManifest } from "@clossys/designer/catalog";
import type { CompositeEngineInput, ConsumerRuntimeManifest } from "@clossys/designer/catalog";
import { deriveRouteRuntimeBinding, selectedRouteRuntimeManifest } from "../core/route-runtime.js";
import { consumerDogfoodSources, parseConsumerDogfoodContract, runConsumerDogfood } from "@clossys/designer/catalog/server";
import { registeredDesignerQuerySources } from "./registered-route-query-source.js";
export { registeredDesignerQuerySources } from "./registered-route-query-source.js";
import { materializeRegisteredDesignerRoute } from "./registered-route-query.js";
import type { RegisteredDesignerQuery } from "./registered-route-query.js";
import type { RouteRuntimeMaterialization } from "../core/route-runtime.js";
import type { ConsumerInstanceLibrary } from "../core/instance-binding.js";
import type { InstanceRegistries } from "../core/instance-binding.js";
import type { PublisherPlanDraft } from "../planning/plan.js";
import type { PublisherPlanVersion } from "../planning/change-set.js";
import { projectRouteRegistry, routeSourcePath } from "../core/route-registry.js";
import type { RouteRegistry } from "../core/route-registry.js";
import { emitRegisteredRouteAdapter, emitRegisteredRoutePage } from "./registered-route-source.js";
export { emitRegisteredRouteAdapter, emitRegisteredRoutePage } from "./registered-route-source.js";
import { isCurrentRegisteredRouteSourceEvidence, recordRegisteredRouteSourceEvidence } from "../core/route-source-evidence.js";
import type { RegisteredRouteSourceEvidence } from "../core/route-source-evidence.js";
import { beginRegisteredRouteNodeTransaction, issueRegisteredRouteNodeCurrent } from "../core/route-node-current.js";
import { runtimeSnapshot } from "@clossys/designer/catalog";
import type { PlainRegisteredRouteProjection } from "../core/route-projection.js";
import type { RegisteredRouteRuntime, RegisteredRouteHeaderActions } from "./registered-route-binding.js";
const exec = promisify(execFile);
const sha = (contents: string): `sha256:${string}` => `sha256:${createHash("sha256").update(contents).digest("hex")}`;
async function immutableSourceIdentity(root: string, files: readonly { readonly file: string; readonly content: string }[]): Promise<RegisteredRouteSourceEvidence["identity"]> {
  const [{ stdout: head }, { stdout: tree }, { stdout: directory }] = await Promise.all([
    exec("git", ["-C", root, "rev-parse", "--verify", "HEAD"]), exec("git", ["-C", root, "rev-parse", "--verify", "HEAD^{tree}"]), exec("git", ["-C", root, "rev-parse", "--show-toplevel"]),
  ]);
  if (!/^[a-f0-9]{40}$/.test(head.trim()) || !/^[a-f0-9]{40}$/.test(tree.trim())) throw new Error("Exact immutable Git source identity unavailable");
  for (const file of files) {
    const absolute = resolve(root, file.file), local = relative(root, absolute);
    // External installed library closures are bound independently by the selected
    // runtime descriptors. Every consumer-authored source must match this tree.
    if (local.startsWith("..") || local.startsWith("/")) continue;
    const path = relative(directory.trim(), absolute).split("\\").join("/");
    const { stdout } = await exec("git", ["-C", directory.trim(), "ls-tree", head.trim(), "--", path]);
    const blob = /^100(?:644|755) blob ([a-f0-9]{40})\t/.exec(stdout)?.[1];
    const bytes = Buffer.from(file.content), actual = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    if (!blob || blob !== actual) throw new Error("Consumer source differs from the immutable artifact tree");
  }
  return { kind: "git", head: head.trim(), tree: tree.trim() };
}

/** Version 1 is owned by Designer and cannot establish route closure. This is a
 * separate, strict source-discovery mode using that same consumer scanner. */
export interface RegisteredRouteContract {
  readonly version: 2;
  readonly sources: Readonly<Record<string, string>>;
  readonly registry: { readonly file: string; readonly export: "default" };
  readonly routeRoots: readonly { readonly directory: string; readonly basePath: string }[];
}
export interface RegisteredRouteStyling { readonly engine: CompositeEngineInput; readonly manifest: ConsumerRuntimeManifest; readonly designer?: Readonly<Record<string, { readonly query: RegisteredDesignerQuery; readonly instanceLibrary: ConsumerInstanceLibrary }>> }
export interface RegisteredRouteFinding { readonly code: "RR1" | "RR2" | "RR3" | "RR4" | "RR5"; readonly file: string; readonly message: string }
const fields = (v: object, allowed: readonly string[]) => Object.keys(v).sort().join(",") === [...allowed].sort().join(",");
export function parseRegisteredRouteContract(value: unknown): RegisteredRouteContract {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Route contract must be an object");
  const c = value as RegisteredRouteContract;
  if (!fields(c, ["version", "sources", "registry", "routeRoots"]) || c.version !== 2 || !c.registry || !fields(c.registry, ["file", "export"]) || c.registry.export !== "default" || !routeSourcePath(c.registry.file) || !c.registry.file.endsWith(".json") || !Array.isArray(c.routeRoots) || !c.routeRoots.length) throw new Error("Strict version 2 registry source and nonempty route roots required");
  // Reuse HOST1's exact source-boundary validation, without weakening v1 fields.
  parseConsumerDogfoodContract({ version: 1, sources: c.sources, pages: ["contract-validation.tsx"] });
  if (Object.keys(c.sources).some(module => module === "@clossys/publisher" || module.startsWith("@clossys/publisher/"))) throw new Error("Publisher registered execution source cannot be remapped by the consumer");
  const roots = new Set<string>();
  for (const root of c.routeRoots as RegisteredRouteContract["routeRoots"]) {
    if (!root || !fields(root, ["directory", "basePath"]) || !routeSourcePath(root.directory) || !/^\/(?:[^/?#\\]+\/?)*$/.test(root.basePath) || root.basePath.includes("//") || root.basePath.split("/").some(p => p === "." || p === "..") || roots.has(root.directory)) throw new Error("Unique consumer route directories and canonical base paths required");
    roots.add(root.directory);
  }
  return c;
}
async function read(root: string, path: string): Promise<string> {
  if (!routeSourcePath(path)) throw new Error("Consumer-relative source path required");
  let at = root;
  for (const part of path.split("/")) { at = join(at, part); if ((await fs.lstat(at)).isSymbolicLink()) throw new Error("Route source symlinks are refused"); }
  const h = await fs.open(at, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { if (!(await h.stat()).isFile()) throw new Error("Route source must be a regular file"); return new TextDecoder("utf-8", { fatal: true }).decode(await h.readFile()); }
  finally { await h.close(); }
}
/** Recognize a closed redirect-only form from real source. Anything more complex
 * remains executable/unsupported and needs registration; names never exempt it. */
export function redirectOnlyRoute(source: string): boolean {
  return /^\s*import\s*\{\s*(?:redirect|permanentRedirect)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*\}\s*from\s*["']next\/navigation["'];?\s*export\s+default\s+(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(\s*\)\s*\{\s*(?:return\s+)?(?:redirect|permanentRedirect|[A-Za-z_$][\w$]*)\(\s*["'][^"'\n]+["']\s*\);?\s*\}\s*$/.test(source) && (() => {
    const imported = /\{\s*(redirect|permanentRedirect)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*\}/.exec(source)!;
    const called = /\{\s*(?:return\s+)?([A-Za-z_$][\w$]*)\(/.exec(source.slice(source.indexOf("export default")));
    return called?.[1] === (imported[2] ?? imported[1]);
  })();
}
/** Only a closed document wrapper is classified as non-page infrastructure.
 * Any visual helper, additional component or executable wrapper stays refused. */
export function documentOnlyLayout(source: string): boolean {
  const prefix = source.replace(/^\s*(?:import\s+type\s*\{\s*ReactNode\s*\}\s*from\s*["']react["'];?\s*)?/, "");
  return /^\s*export\s+default\s+function\s+[A-Za-z_$][\w$]*\(\s*\{\s*children\s*\}\s*(?::\s*\{\s*children\s*:\s*(?:React\.)?ReactNode\s*;?\s*\})?\s*\)\s*\{\s*return\s*(?:children|\(?\s*<html(?:\s+lang=["'][a-zA-Z-]+["'])?>\s*<body>\s*\{children\}\s*<\/body>\s*<\/html>\s*\)?)\s*;?\s*\}\s*$/.test(prefix);
}
/** Read-only filesystem discovery, exact emitter linkage and the original HOST1
 * source findings. A passing result is source closure, never rendered qualification. */
export interface RegisteredRouteCheckInput { readonly root: string; readonly contract: RegisteredRouteContract; readonly plan?: PublisherPlanDraft | PublisherPlanVersion; readonly registries: InstanceRegistries; readonly styling?: RegisteredRouteStyling }
export async function checkRegisteredRoutes(input: RegisteredRouteCheckInput) {
  return (await checkRegisteredRoutesInternal(input)).checked;
}
async function checkRegisteredRoutesInternal(input: RegisteredRouteCheckInput) {
  const root = await fs.realpath(resolve(input.root)), contract = parseRegisteredRouteContract(input.contract);
  const registryText = await read(root, contract.registry.file);
  const registry = JSON.parse(registryText) as RouteRegistry;
  const projection = projectRouteRegistry(registry, input.plan, input.registries, {}, {});
  const findings: RegisteredRouteFinding[] = projection.findings.map(f => ({ code: "RR1", file: contract.registry.file, message: `${f.routeId}:${f.path}: ${f.message}` }));
  const entries = new Map<string, string>(), classifications: { file: string; kind: "page" | "redirect" | "document" | "http" }[] = [];
  const allRoots = contract.routeRoots.map(r => r.directory);
  for (const boundary of contract.routeRoots) {
    async function visit(path: string): Promise<void> {
      const info = await fs.lstat(join(root, path));
      if (info.isSymbolicLink()) throw new Error("Route root symlinks are refused");
      if (info.isDirectory()) { for (const name of (await fs.readdir(join(root, path))).sort()) await visit(`${path}/${name}`); return; }
      if (!info.isFile()) return;
      const name = path.split("/").at(-1)!;
      if (!/^(?:page|layout|route)\.[jt]sx?$/.test(name)) return;
      const source = await read(root, path);
      if (/^layout\./.test(name)) {
        if (documentOnlyLayout(source)) classifications.push({ file: path, kind: "document" });
        else findings.push({ code: "RR2", file: path, message: "Layout is not a closed document wrapper; implicit visual composition is unsupported" });
        return;
      }
      if (/^route\./.test(name)) {
        if (/export\s+(?:async\s+)?function\s+(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b|export\s+(?:const|let)\s+(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/.test(source) && !/export\s+default\b|<\s*[A-Za-z]/.test(source)) classifications.push({ file: path, kind: "http" });
        else findings.push({ code: "RR2", file: path, message: "Unsupported HTTP route source classification" });
        return;
      }
      if (redirectOnlyRoute(source)) { classifications.push({ file: path, kind: "redirect" }); return; }
      classifications.push({ file: path, kind: "page" });
      const segments = relative(join(root, boundary.directory), dirname(join(root, path))).split(/[\\/]/).filter(Boolean);
      if (segments.some(p => p.startsWith("@") || /^\(\./.test(p))) findings.push({ code: "RR2", file: path, message: "Parallel/intercepted route semantics are not supported by this route root" });
      const parts = segments.filter(part => !/^\([^/]+\)$/.test(part));
      entries.set(path, `${boundary.basePath.replace(/\/$/, "")}/${parts.join("/")}`.replace(/\/$/, "") || "/");
    }
    await visit(boundary.directory);
  }
  if (!entries.size) findings.push({ code: "RR2", file: "", message: "No executable visual page entries discovered in admitted roots" });
  for (const [file, path] of entries) {
    const matches = registry.routes?.filter(route => route.entry.file === file) ?? [];
    if (matches.length !== 1 || matches[0]!.path !== path) findings.push({ code: "RR3", file, message: "Discovered page must join exactly one registered route and derived URL path" });
  }
  for (const route of registry.routes ?? []) {
    if (!entries.has(route.entry.file)) findings.push({ code: "RR3", file: route.entry.file, message: "Registry entry has no discovered executable page" });
    try {
      const generated = emitRegisteredRoutePage(contract.registry.file, route);
      if (await read(root, route.composition.source.file) !== generated) findings.push({ code: "RR4", file: route.composition.source.file, message: "Page implementation differs from its deterministic registered composition" });
      if (route.entry.file !== route.composition.source.file && await read(root, route.entry.file) !== emitRegisteredRouteAdapter(route)) findings.push({ code: "RR4", file: route.entry.file, message: "Route adapter does not execute the exact generated composition" });
    } catch { findings.push({ code: "RR4", file: route.entry.file, message: "Registered composition source is absent or invalid" }); }
  }
  let dogfood: ReturnType<typeof runConsumerDogfood> | undefined;
  const sourceEvidence: RegisteredRouteSourceEvidence[] = [];
  const sourceEvidencePending: string[] = [];
  const materializations = new Map<string, RouteRuntimeMaterialization>();
  if (entries.size) {
    try {
      const source = await consumerDogfoodSources(allRoots, { version: 1, sources: { ...contract.sources, "@clossys/publisher/web/registered-route": join(dirname(fileURLToPath(import.meta.url)), "registered-route.js") }, pages: [...entries.keys()] }, root, root);
      let styling: { profile: string; manifest: ConsumerRuntimeManifest; css: Readonly<Record<string, `sha256:${string}`>> } | undefined;
      const css = source.files.filter(file => file.file.endsWith(".css"));
      if (input.styling) {
        const { engine, manifest } = input.styling, profile = resolveProfile(engine);
        const catalog = { ...engine.catalog.components, slots: [...engine.catalog.components.slots, ...(engine.catalog.surfaces?.slots ?? [])] };
        const checked = checkConsumerRuntimeManifest(manifest, catalog, { consumer: registry.consumer, libraryHash: libraryHash(engine.library), selectionHash: profile.selectionHash });
        for (const route of registry.routes) if (route.composition.binding.body?.source.kind === "derived") {
          const current = input.styling.designer?.[route.routeId];
          if (!current) { sourceEvidencePending.push(`${route.routeId}: current original Designer query/provider projection pending`); continue; }
          const expected = await registeredDesignerQuerySources();
          if (runtimeHash(current.query.implementation) !== runtimeHash(expected.implementation) || runtimeHash(current.query.provider) !== runtimeHash(expected.provider)) throw new Error("Fixed query/original provider bytes differ from actual public implementation");
          const providerSource = resolve(dirname(fileURLToPath(import.meta.resolve("@clossys/designer/studio/queries"))), "../../src/studio/WholeStudioProvider.tsx");
          if (!source.files.some(file => resolve(root, file.file) === providerSource)) throw new Error("Original Designer provider is not reached by the actual composition graph");
          const result = materializeRegisteredDesignerRoute(route.composition.binding, engine, input.registries, current.instanceLibrary, current.query);
          if (result.status !== "materialized") { sourceEvidencePending.push(...result.findings); continue; }
          materializations.set(route.routeId, result.materialization);
        }
        const bindings = registry.routes.map(route => deriveRouteRuntimeBinding(route.composition.binding, engine, manifest, materializations.get(route.routeId)));
        if (!profile.check.ok || checked.status !== "valid" || profile.consumer !== registry.consumer || bindings.some(binding => binding.status !== "resolved")) findings.push({ code: "RR5", file: "", message: "Current styling profile/manifest differs from exact selected route bindings" });
        else if (css.length) {
          const tokens = [...emittedTokenProperties(profile.values)].flatMap(([id, output]) => {
            const parts = id.split("."), leaf = parts.slice(0, 2).join("."), member = parts.slice(2).join(".");
            return [...new Set([output.property, ...(output.theme ? [output.theme] : [])])].map(property => ({ id: leaf, contract: { emit: { [member]: property } } }));
          });
          dogfood = runConsumerDogfood({
            ...source, tokens, themeCss: css.map(file => file.content).join("\n"),
            tokenLibrary: {
              catalog: engine.catalog.values,
              library: { ...engine.library.values, source: engine.library.source, adoptedAt: engine.library.adoptedAt },
            },
          });
          styling = { profile: runtimeHash(profile), manifest, css: Object.fromEntries(css.map(file => [file.file, sha(file.content)])) };
        }
      }
      if (!dogfood) dogfood = runConsumerDogfood(source);
      if (!styling) sourceEvidencePending.push("Exact selected styling profile and reached consumer stylesheets pending");
      if (!findings.length && dogfood.ok && styling) {
        try {
          const data = await Promise.all(source.data.filter(file => !file.startsWith("..")).map(async file => ({ file, content: await read(root, file) })));
          const files = [...source.files, ...data];
          if (await read(root, contract.registry.file) !== registryText) throw new Error("Registry changed during source scan");
          const identity = await immutableSourceIdentity(root, files);
          const hashes = Object.fromEntries(files.map(file => [file.file, sha(file.content)]));
          const planDigest = input.plan?.status === "aligned" && !projection.rows.some(row => row.pending.includes("Exact plan alignment pending")) ? input.plan.digest : undefined;
          for (const route of registry.routes) {
            const selection = deriveRouteRuntimeBinding(route.composition.binding, input.styling!.engine, styling.manifest, materializations.get(route.routeId));
            if (selection.status !== "resolved") throw new Error("Selected styling binding changed");
            sourceEvidence.push(recordRegisteredRouteSourceEvidence(registry, route, identity, hashes, planDigest, { profile: styling.profile, manifest: runtimeHash(selectedRouteRuntimeManifest(selection.binding, styling.manifest)), css: styling.css }, materializations.get(route.routeId)?.digest));
          }
        } catch { sourceEvidencePending.push("Immutable generated/source artifact identity pending"); }
      }
    }
    catch (error) { findings.push({ code: "RR5", file: "", message: `Consumer source resolution refused: ${(error as Error).message}` }); }
  }
  return { materializations, checked: { version: 2 as const, ok: !findings.length && dogfood?.ok === true && sourceEvidencePending.length === 0, scope: contract.routeRoots, registry, projection, classifications, findings, dogfood, sourceEvidence, sourceEvidencePending, runtime: "pending" as const } };
}

/** Stateless Node operation. The browser receives only projection, whose tag is
 * explicitly unverified; source/materialization receipts remain server artifacts. */
export async function prepareRegisteredNodeRoute(input: RegisteredRouteCheckInput & { readonly routeId: string; readonly runtime: RegisteredRouteRuntime; readonly renderActions?: RegisteredRouteHeaderActions }) {
  const transaction = beginRegisteredRouteNodeTransaction(await fs.realpath(input.root).catch(() => resolve(input.root)), input.routeId);
  const planReading = runtimeHash(input.plan ?? null);
  const { checked, materializations } = await checkRegisteredRoutesInternal(input);
  if (runtimeHash(input.plan ?? null) !== planReading) return { status: "refused" as const, findings: ["Aligned Node plan changed during source preparation"] };
  if (!checked.ok || input.plan?.status !== "aligned") return { status: "pending" as const, findings: [...checked.findings.map(row => row.message), ...(checked.dogfood?.findings.map(row => `${row.code}: ${row.evidence}`) ?? []), ...checked.sourceEvidencePending, ...(input.plan?.status !== "aligned" ? ["Exact aligned Node plan required"] : [])] };
  const rows: PlainRegisteredRouteProjection["routes"][number][] = [];
  for (const route of checked.registry.routes) {
    const materialization = materializations.get(route.routeId), source = checked.sourceEvidence.find(value => value.routeId === route.routeId);
    if (!source || source.planDigest !== input.plan.digest || !isCurrentRegisteredRouteSourceEvidence(source, checked.registry, route, materialization?.digest)) return { status: "refused" as const, findings: ["Exact Node source/plan/materialization join required"] };
    const registration = materialization ? { ...route, composition: { ...route.composition, binding: materialization.binding } } : route;
    if (registration.composition.binding.body?.source.kind === "derived") {
      const query = input.styling?.designer?.[route.routeId]?.query;
      if (!materialization || !query) return { status: "pending" as const, findings: ["Current fixed Node query materialization unavailable"] };
      rows.push({ kind: "derived-route-view", registration, derivation: { id: "designer.layer-boards", version: 1, renderer: query.implementation, state: materialization.facts } });
    } else rows.push({ kind: "static-route-view", registration });
  }
  const route = checked.registry.routes.find(value => value.routeId === input.routeId), source = checked.sourceEvidence.find(value => value.routeId === input.routeId);
  if (!route || !source) return { status: "refused" as const, findings: ["Unknown Node route identity"] };
  const { prepareRegisteredRouteFromNode } = await import("./registered-route-binding.js");
  const prepared = prepareRegisteredRouteFromNode(checked.registry, input.routeId, input.runtime, { source, materialization: materializations.get(input.routeId) }, input.renderActions);
  if (prepared.status !== "ready") return prepared;
  const projection: PlainRegisteredRouteProjection = runtimeSnapshot({ kind: "publisher.route-projection", version: 1, authentication: "unverified", consumer: checked.registry.consumer, routes: rows });
  // Deliberately expose no receipt in the plain projection. Prepared is a Node
  // verification artifact and must not be serialized as browser input.
  if (!prepared.input) return { status: "refused" as const, findings: ["Canonical Node assembly input unavailable"] };
  try {
    const current = issueRegisteredRouteNodeCurrent({ transaction, registry: checked.registry, route, source, plan: input.plan, assembly: prepared.input, original: input.runtime.assembly, materialization: prepared.materialization, query: input.runtime.designerQuery });
    return { ...prepared, projection, current };
  } catch { return { status: "refused" as const, findings: ["Exact current Node source/query/assembly transaction unavailable"] }; }
}
