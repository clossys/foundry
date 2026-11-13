/**
 * Runtime manifest producer. Derives ConsumerRuntimeManifest from a consumer library's
 * adopted surfaces: one descriptor per adopted package-pointer fill whose leaf has a
 * package-owned renderer. Renderer identity is a closure that reads the named registry
 * export of an installed package artifact; no React or renderer code is imported here.
 */
import { libraryHash, resolve } from "./api.js";
import { isRuntimeDigest, runtimeHash, runtimeStageModuleIdentity } from "./runtime-ports.js";
import type { ConsumerRuntimeManifest, RuntimeFillDescriptor, RuntimePageHeaderModule, RuntimeRendererDescriptor, RuntimeSourceClosure, RuntimeStageModule } from "./runtime-ports.js";
import { surfaceRuntimeIdentity } from "./surface-check.js";
import { isSurfacePackageEntry, surfaceEntryOf } from "./surface-library.js";
import type { SurfacePackageEvidence } from "./surface-types.js";
import type { CompositeEngineInput } from "./types.js";

/** A public registry export keyed by leaf, e.g. `@clossys/designer/frames#surfaceRuntimeRenderers`. */
export interface SurfaceRuntimePointer { readonly module: string; readonly export: string }
export const RUNTIME_PAGE_HEADER_POINTER = Object.freeze({ module: "@clossys/designer/shell", export: "PageHeaderModule" } as const);
export interface SurfaceRuntimePlanInput {
  readonly engine: CompositeEngineInput;
  /** Installed artifact evidence for every renderer, header and Stage module named below. */
  readonly packages: readonly SurfacePackageEvidence[];
  /** Leaf → the registry export that owns its renderer (the caller's registry keys). */
  readonly renderers: Readonly<Record<string, SurfaceRuntimePointer>>;
  /** Restrict to these leaves; default every adopted surface leaf. */
  readonly leaves?: readonly string[];
  /** Assets the renderers read beyond component reads; completeness stays caller-owned. */
  readonly assets?: { readonly complete: boolean; readonly ids: readonly string[] };
}
export interface SurfaceRuntimeGap { readonly leaf: string; readonly reason: string }
export interface SurfaceRuntimePlan {
  readonly manifest: ConsumerRuntimeManifest;
  readonly gaps: readonly SurfaceRuntimeGap[];
  /**
   * Adopted consumer fill id → the package fill it points at (`origin.fill`). Package renderers stamp
   * their origin fill (e.g. `foundry/frames.app-shell`) while selection names the consumer pointer
   * (`<consumer>/frames.app-shell`); provenance-scan's `fillOrigins` input reads this map for WL7.
   */
  readonly origins: Readonly<Record<string, string>>;
}

const packageName = (module: string): string => module.split("/").slice(0, module.startsWith("@") ? 2 : 1).join("/");
/** Exact closure: one file reading `export` (optionally one key of it) from the installed module artifact. */
export function surfaceRuntimeRenderer(id: string, entry: string, pointer: SurfaceRuntimePointer, evidence: SurfacePackageEvidence, key?: string): RuntimeRendererDescriptor {
  const body = key === undefined
    ? `export { ${pointer.export} } from ${JSON.stringify(pointer.module)};\n`
    : `import { ${pointer.export} } from ${JSON.stringify(pointer.module)};\nexport default ${pointer.export}[${JSON.stringify(key)}].render;\n`;
  const source: RuntimeSourceClosure = { entry, files: { [entry]: body }, dependencies: { [packageName(pointer.module)]: { version: evidence.version, artifact: `sha256:${evidence.artifactSha256}` } } };
  return { id, source, sourceHash: runtimeHash(source) };
}

export function planSurfaceRuntime(input: SurfaceRuntimePlanInput): SurfaceRuntimePlan {
  const profile = resolve(input.engine), consumer = profile.consumer, gaps: SurfaceRuntimeGap[] = [];
  const evidence = (pointer: SurfaceRuntimePointer): SurfacePackageEvidence | undefined => {
    const row = input.packages.find(item => item.module === pointer.module);
    return row && row.values.includes(pointer.export) && isRuntimeDigest(`sha256:${row.artifactSha256}`) ? row : undefined;
  };
  const fills: RuntimeFillDescriptor[] = [], origins: Record<string, string> = {};
  const adopted: Readonly<Record<string, NonNullable<typeof profile.surfaces>["fills"][keyof NonNullable<typeof profile.surfaces>["fills"]]>> = profile.surfaces?.fills ?? {};
  for (const leaf of input.leaves ?? Object.keys(adopted).sort()) {
    const row = adopted[leaf];
    if (!row) { gaps.push({ leaf, reason: "no adopted surface fill" }); continue; }
    const entry = surfaceEntryOf(row.document);
    if (!isSurfacePackageEntry(entry)) { gaps.push({ leaf, reason: "adopted fill is not a package pointer" }); continue; }
    const fillId = row.document.$extensions["com.clossys.fill"].id;
    if (entry.origin) origins[fillId] = entry.origin.fill;
    const pointer = input.renderers[leaf];
    if (!pointer) { gaps.push({ leaf, reason: "no package-owned renderer" }); continue; }
    const owner = evidence(pointer);
    if (!owner) { gaps.push({ leaf, reason: `renderer module evidence missing: ${pointer.module}#${pointer.export}` }); continue; }
    const kind = leaf.startsWith("frames.") ? "frame" as const : "section" as const;
    const slots = Object.keys("slotMap" in entry ? entry.slotMap : entry.slots);
    const members = "members" in entry ? [...entry.members] : Object.keys(entry.propMap);
    const descriptor: RuntimeFillDescriptor = {
      kind, library: consumer, fill: fillId, leaf: leaf as RuntimeFillDescriptor["leaf"], config: null,
      slots, members, states: ["default"], surface: surfaceRuntimeIdentity(row),
      renderer: surfaceRuntimeRenderer(`package:${leaf}`, `runtime/${leaf.replace(".", "/")}.ts`, pointer, owner, leaf),
    };
    if (kind === "frame") {
      const stagePointer = { module: runtimeStageModuleIdentity.package, export: runtimeStageModuleIdentity.export };
      const header = evidence(RUNTIME_PAGE_HEADER_POINTER), stage = evidence(stagePointer);
      if (!header || !stage) { gaps.push({ leaf, reason: "Frame header or Stage module evidence missing" }); continue; }
      const headerModule: RuntimePageHeaderModule = { package: "@clossys/designer/shell", export: "PageHeaderModule", renderer: surfaceRuntimeRenderer("package:shell#PageHeaderModule", "runtime/shell/page-header-module.ts", RUNTIME_PAGE_HEADER_POINTER, header) };
      const stageModule: RuntimeStageModule = { package: runtimeStageModuleIdentity.package, export: runtimeStageModuleIdentity.export, renderer: surfaceRuntimeRenderer("package:frames#FrameStage", "runtime/frames/frame-stage.ts", stagePointer, stage) };
      fills.push({ ...descriptor, headerModule, stageModule });
    } else fills.push(descriptor);
  }
  const componentAssets = Object.values(profile.components.components).flatMap(component => component.reads.assets);
  const ids = [...new Set([...componentAssets, ...(input.assets?.ids ?? [])])].sort();
  const manifest: ConsumerRuntimeManifest = { version: 1, consumer, libraryHash: libraryHash(input.engine.library) as ConsumerRuntimeManifest["libraryHash"], selectionHash: profile.selectionHash as ConsumerRuntimeManifest["selectionHash"], fills, assetClosure: { complete: input.assets?.complete ?? true, ids } };
  return { manifest, gaps, origins };
}
