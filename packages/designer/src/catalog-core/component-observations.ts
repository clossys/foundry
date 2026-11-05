import { componentDescriptorDigest, componentSourceHash, componentTokensHash, type ComponentCallSite, type ComponentCheckInput, type ComponentMeasurement, type ComponentObservation, type ComponentSourceFile } from "./check-components.js";
import type { ComponentCandidate, ComponentFile } from "./resolve-components.js";
import type { ComponentContract, ComponentSlot } from "./types.js";
import type { SourceBundle } from "./changeset-components.js";

/**
 * Source-side component observations for an adopted component set, in exactly the
 * `evidence` shape `check`/`resolve` consume (`componentOptions.evidence`).
 *
 * Every field is derived from bytes the consumer runs; nothing is claimed without them:
 * - source fills observe their receipted materialized output (plus the pinned upstream bytes);
 * - package fills observe the module source a caller resolves for the pinned export, or stay unobserved;
 * - ref/render-prop forwarding and state measurements come only from a caller-supplied runtime probe
 *   or browser runner. Without one they fail closed (false / no measurements), so the check reports
 *   the precise missing measurement instead of the blanket "observations unavailable".
 * - member-root measurements and size geometry come only from a per-slot browser artifact that binds to
 *   the exact descriptor, source bytes, consumer tokens and installed react-aria-components it measured.
 *   An artifact that does not bind is refused: its slot keeps no runtime evidence (and is listed in
 *   `refused`), so the check reports the missing measurements as errors rather than pending notices.
 */
export interface ComponentObservationProbe {
  forwardsRef: boolean; forwardsRenderProps: boolean;
  measurements?: readonly ComponentMeasurement[];
}
/** One slot's browser qualification, as a browser runner records it from the rendered consumer module graph. */
export interface ComponentBrowserArtifact {
  slot: string;
  /** `componentDescriptorDigest` of the adopted descriptor that was rendered (`origin.sha256` for an adopted fill). */
  descriptorHash: string;
  /** `componentSourceHash` of the observed source and `componentTokensHash` of the consumer tokens that were rendered. */
  sourceHash: string; tokensHash: string;
  /** The react-aria-components version and resolved instance the rendered module graph loaded. */
  rac: { version: string; instance: string };
  forwardsRef: boolean; forwardsRenderProps: boolean;
  /** Root-cell measurements (`member` empty). */
  measurements: readonly ComponentMeasurement[];
  /** Per member-root measurements, keyed by exactly the contract's `memberRoots` members. */
  memberMeasurements?: Readonly<Record<string, readonly ComponentMeasurement[]>>;
  /** Each `size.*` member of the descriptor mapped to the `themes.spacing.*` member its rendered control resolves. */
  geometry?: Readonly<Record<string, string>>;
}
export interface ComponentObservationInput {
  slots: readonly ComponentSlot[];
  /** Adopted descriptors, one per slot (e.g. `componentOf` of each library fill). */
  fills: readonly ComponentCandidate[];
  /** Materialized consumer files (`library.components.files`). */
  files: readonly ComponentFile[];
  /** Verified source bundles; the pinned upstream bytes of each source fill. */
  bundles?: readonly SourceBundle[];
  tokens: ComponentCheckInput["tokens"];
  installedRac: ComponentCheckInput["installedRac"];
  /** Module source for a package fill's pinned export; undefined leaves the slot unobserved. */
  packageSource?: (module: string, exportName: string) => readonly ComponentSourceFile[] | undefined;
  /** Packages that declare react-aria-components as a peer dependency. */
  racPeers?: readonly string[];
  /** Runtime probe results keyed by slot. Absent: forwarding is unproven and no measurement exists. */
  probes?: Readonly<Record<string, ComponentObservationProbe | undefined>>;
  /** Per-slot browser artifacts keyed by slot. A slot takes a probe or an artifact, never both. */
  artifacts?: Readonly<Record<string, ComponentBrowserArtifact | undefined>>;
}
export interface ComponentObservationResult {
  evidence: Required<Pick<ComponentCheckInput, "observations" | "installedRac">>;
  /** Slots with no observable bytes, and why. */
  unobserved: readonly { slot: string; reason: string }[];
  /** Slots whose supplied browser artifact did not bind; they carry no runtime evidence. */
  refused: readonly { slot: string; reason: string }[];
}

const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const rootNames = (root: string): string[] => root.startsWith("rac:") ? root.slice(4).split("+") : [];
const RAC_IMPORT = /import\s*\{([^}]+)\}\s*from\s*["']react-aria-components["']/g;
/** A module that re-exports the RAC root unchanged (`export { Form } from "react-aria-components"`) is that root. */
const RAC_REEXPORT = /export\s*\{([^}]+)\}\s*from\s*["']react-aria-components["']/g;

/** A RAC root is observed only when it is imported from react-aria-components and rendered, or re-exported unchanged. */
function observedRoot(root: ComponentContract["root"], files: readonly ComponentSourceFile[]): ComponentContract["root"] {
  const names = rootNames(root);
  if (!names.length) return root;
  const rendered = names.every(name => files.some(file => {
    const locals = [...file.content.matchAll(RAC_IMPORT)].flatMap(match => match[1]!.split(",").map(binding => binding.trim().split(/\s+as\s+/))).filter(([imported]) => imported === name).map(([imported, local]) => local ?? imported!);
    const reexported = [...file.content.matchAll(RAC_REEXPORT)].some(match => match[1]!.split(",").some(binding => binding.trim() === name));
    return reexported || locals.some(local => new RegExp(`<${local}\\b`).test(file.content));
  }));
  return rendered ? root : "engine:none";
}

/** A composed leaf is called when its export (or a local alias of it) is rendered as JSX. */
function callSites(fill: ComponentCandidate, byslot: ReadonlyMap<string, ComponentCandidate>, files: readonly ComponentSourceFile[]): ComponentCallSite[] {
  const calls: ComponentCallSite[] = [];
  for (const target of [...fill.composes].sort(compare)) {
    const dependency = byslot.get(target);
    if (!dependency || dependency.impl.kind === "composed") continue;
    const exported = dependency.impl.export;
    const locals = new Set([exported]);
    for (const file of files) for (const match of file.content.matchAll(/import\s*\{([^}]+)\}\s*from\s*["'][^"']+["']/g)) {
      for (const binding of match[1]!.split(",")) { const [imported, local] = binding.trim().split(/\s+as\s+/); if (imported === exported && local) locals.add(local); }
    }
    for (const local of [...locals].sort(compare)) if (files.some(file => new RegExp(`<${local}\\b`).test(file.content))) {
      calls.push({ target, props: [], members: [], ...(local === exported ? {} : { local }) });
      break;
    }
  }
  return calls;
}

const posixJoin = (from: string, relative: string): string => {
  const out = from.split("/").slice(0, -1);
  for (const part of relative.split("/")) { if (part === "..") out.pop(); else if (part !== "." && part !== "") out.push(part); }
  return out.join("/");
};
/**
 * The file that defines `name`, starting from `paths` (candidate module files, repo-relative posix).
 * An `export function|const|class name`, a local `export { name }` list or an
 * `export { name } from "react-aria-components"` passthrough defines it; a relative
 * `export { name } from "./x.js"` re-export is followed, through renames (`a as name`) and
 * chained re-exports, to the file that declares it, never to the shim. Package import
 * aliases follow only the explicitly supplied source target for the active runtime condition;
 * targets from mutually exclusive conditions are never combined. Unresolvable, missing
 * or cyclic re-exports give `undefined`, so the slot stays unobserved.
 */
export function exportSource(read: (path: string) => string | undefined, paths: readonly string[], name: string, seen: ReadonlySet<string> = new Set(), packageImports: Readonly<Record<string, string>> = {}): ComponentSourceFile[] | undefined {
  for (const path of paths) {
    if (seen.has(path)) continue;
    const content = read(path);
    if (content === undefined) continue;
    if (new RegExp(`export\\s+(?:function|const|class)\\s+${name}\\b`).test(content)) return [{ path, content }];
    for (const match of content.matchAll(/export\s*\{([^}]+)\}(?:\s*from\s*["']([^"']+)["'])?/g)) {
      for (const binding of match[1]!.split(",")) {
        const [imported, exported = imported] = binding.trim().split(/\s+as\s+/).map(part => part.trim());
        if (exported !== name || !imported) continue;
        const specifier = match[2];
        if (specifier === undefined || specifier === "react-aria-components") return [{ path, content }];
        const alias = specifier.startsWith("#") ? packageImports[specifier] : undefined;
        // A package import must resolve to a local source path, never a foreign
        // module, absolute path or traversal supplied as purported evidence.
        if (alias !== undefined && (!/^[\w@.-]+(?:\/[\w@.-]+)*\.[jt]sx?$/.test(alias) || alias.split("/").some(part => part === "." || part === ".."))) continue;
        if (!specifier.startsWith(".") && alias === undefined) continue;
        const stem = (alias ?? posixJoin(path, specifier)).replace(/\.[jt]sx?$/, "");
        const found = exportSource(read, [`${stem}.tsx`, `${stem}.ts`], imported, new Set([...seen, path]), packageImports);
        if (found) return found;
      }
    }
  }
  return undefined;
}

const sameKeys = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && [...a].sort(compare).every((key, index) => key === [...b].sort(compare)[index]);
/** Why a browser artifact does not bind to this slot's descriptor, observed bytes, tokens and RAC install; undefined when it binds. */
function artifactRefusal(artifact: ComponentBrowserArtifact, fill: ComponentCandidate, contract: ComponentContract, files: readonly ComponentSourceFile[], input: ComponentObservationInput, tokensHash: string): string | undefined {
  if (artifact.slot !== fill.slot) return `Artifact slot ${artifact.slot} differs from ${fill.slot}`;
  if (artifact.descriptorHash !== componentDescriptorDigest(fill)) return "Artifact was measured for a different descriptor";
  if (artifact.sourceHash !== componentSourceHash(files)) return "Artifact was measured for different source bytes";
  if (artifact.tokensHash !== tokensHash) return "Artifact was measured for different consumer tokens";
  if (!artifact.rac || artifact.rac.version !== input.installedRac.version || artifact.rac.instance !== input.installedRac.instance) return "Artifact react-aria-components identity differs from the installed singleton";
  const memberRoots = Object.keys(contract.memberRoots ?? {});
  if (!sameKeys(Object.keys(artifact.memberMeasurements ?? {}), memberRoots)) return "Artifact member-root measurements differ from the contract's member roots";
  if (artifact.geometry) {
    const sizes = fill.members.filter(member => member.startsWith("size."));
    const reads = new Set(fill.reads.themes.map(read => read.split(".").slice(0, 2).join(".")));
    if (!sameKeys(Object.keys(artifact.geometry), sizes)) return "Artifact geometry does not cover exactly the descriptor's size members";
    if (Object.values(artifact.geometry).some(token => !/^themes\.spacing\.[a-z0-9-]+$/.test(token) || !Object.hasOwn(input.tokens, token) || !reads.has("themes.spacing"))) return "Artifact geometry names a token that is not a read consumer spacing member";
  }
  return undefined;
}

export function observeComponentSources(input: ComponentObservationInput): ComponentObservationResult {
  const tokensHash = componentTokensHash(input.tokens);
  const refused: { slot: string; reason: string }[] = [];
  const slots = new Map(input.slots.map(slot => [slot.id, slot]));
  const byslot = new Map(input.fills.map(fill => [fill.slot, fill]));
  const observations: Record<string, ComponentObservation> = {};
  const unobserved: { slot: string; reason: string }[] = [];
  for (const fill of [...input.fills].sort((a, b) => compare(a.slot, b.slot))) {
    const contract = slots.get(fill.slot)?.contract;
    if (!contract) { unobserved.push({ slot: fill.slot, reason: "Unknown component contract" }); continue; }
    let files: ComponentSourceFile[];
    let upstream: Pick<ComponentObservation, "upstreamFiles" | "outputSha256"> = {};
    if (fill.impl.kind === "source") {
      const receipts = fill.outputSha256 ?? [];
      files = receipts.map(receipt => input.files.find(file => file.path === receipt.path)).filter((file): file is ComponentFile => !!file).map(file => ({ path: file.path, content: file.content }));
      if (!receipts.length || files.length !== receipts.length) { unobserved.push({ slot: fill.slot, reason: "Receipted output files are not materialized" }); continue; }
      const bundle = input.bundles?.find(bundle => bundle.slot === fill.slot && fill.pin?.files?.every(pin => bundle.upstream.some(file => file.path === pin.path)));
      if (bundle) upstream = { upstreamFiles: bundle.upstream.map(file => ({ path: file.path, content: file.content })).sort((a, b) => compare(a.path, b.path)), outputSha256: [...receipts].sort((a, b) => compare(a.path, b.path)) };
    } else if (fill.impl.kind === "package") {
      const resolved = input.packageSource?.(fill.impl.module, fill.impl.export);
      if (!resolved?.length) { unobserved.push({ slot: fill.slot, reason: `No module source for ${fill.impl.module}#${fill.impl.export}` }); continue; }
      files = resolved.map(file => ({ ...file }));
    } else { unobserved.push({ slot: fill.slot, reason: "Unmaterialized composition" }); continue; }
    files.sort((a, b) => compare(a.path, b.path));
    const supplied = input.artifacts?.[fill.slot];
    const refusal = supplied && (input.probes?.[fill.slot] ? "Slot has both a probe and a browser artifact" : artifactRefusal(supplied, fill, contract, files, input, tokensHash));
    if (refusal) refused.push({ slot: fill.slot, reason: refusal });
    const artifact = refusal ? undefined : supplied;
    const probe = refusal ? undefined : artifact ?? input.probes?.[fill.slot];
    const peer = fill.impl.kind === "package" && !!fill.pin?.package && (input.racPeers ?? []).includes(fill.pin.package);
    const dependency: ComponentObservation["rac"]["dependency"] = fill.impl.kind === "source" ? "source" : peer ? "peer" : "bundled";
    const memberRoots = Object.entries(contract.memberRoots ?? {}).sort(([a], [b]) => compare(a, b));
    const calls = callSites(fill, byslot, files);
    observations[fill.slot] = {
      files, ...upstream, sourceHash: componentSourceHash(files), tokensHash,
      root: observedRoot(contract.root, files), forwardsRef: probe?.forwardsRef ?? false, forwardsRenderProps: probe?.forwardsRenderProps ?? false,
      rac: { version: artifact?.rac.version ?? input.installedRac.version, instance: artifact?.rac.instance ?? input.installedRac.instance, dependency },
      calls, measurements: [...(probe?.measurements ?? [])],
      ...(artifact ? { descriptorHash: artifact.descriptorHash, ...(artifact.geometry ? { geometry: { ...artifact.geometry } } : {}) } : {}),
      ...(memberRoots.length ? { memberObservations: Object.fromEntries(memberRoots.map(([member, root]) => [member, { root: observedRoot(root, files), forwardsRef: probe?.forwardsRef ?? false, forwardsRenderProps: probe?.forwardsRenderProps ?? false, calls, measurements: [...(artifact?.memberMeasurements?.[member] ?? [])] }])) } : {}),
    };
  }
  for (const slot of Object.keys(input.artifacts ?? {})) if (input.artifacts![slot] && !byslot.has(slot)) refused.push({ slot, reason: "Artifact names no adopted descriptor" });
  return { evidence: { observations, installedRac: { ...input.installedRac } }, unobserved, refused };
}
