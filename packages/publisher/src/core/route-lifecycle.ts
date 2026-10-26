import { validateRuntimeAssemblyEvidence, prepareRuntimeAssembly, runtimeHash, runtimeSnapshot, resolve } from "@clossys/designer/catalog";
import type { RuntimeAssemblyInput, RuntimeAssemblyEvidence, RuntimeEvidenceResult } from "@clossys/designer/catalog";
import { validateReviewEvidence } from "@clossys/controller/review";
import type { ReviewEvidenceBundle, ReviewPolicy } from "@clossys/controller/review";
import { sha256 } from "../planning/digest.js";
import type { RouteRuntimeMaterialization } from "./route-runtime.js";
import { deriveRouteRuntimeBinding } from "./route-runtime.js";
import { routeCompositionDigest, registeredRouteBrandLink } from "./route-registry.js";
import type { RouteRegistration, RouteRegistry } from "./route-registry.js";
import { isCurrentRegisteredRouteSourceEvidence } from "./route-source-evidence.js";
import type { RegisteredRouteSourceEvidence } from "./route-source-evidence.js";
import { registeredRouteNodeCurrentSnapshot } from "./route-node-current.js";
import type { RegisteredRouteNodeCurrentContext } from "./route-node-current.js";
export type { RegisteredRouteNodeCurrentContext } from "./route-node-current.js";

export interface RegisteredRouteLifecycleEvidence {
  readonly routeId: string;
  readonly composition: `sha256:${string}`;
  readonly source: RegisteredRouteSourceEvidence;
  readonly runtime: { readonly evidence: string; readonly snapshot: string; readonly bundle: string };
  readonly review?: ReviewEvidenceBundle;
}
export type RegisteredRouteLifecycleResult = { readonly status: "planned"; readonly findings: readonly string[] }
  | { readonly status: "built" | "reviewed"; readonly evidence: RegisteredRouteLifecycleEvidence; readonly findings: readonly string[] };
const derived = new WeakMap<object, { readonly status: "built" | "reviewed"; readonly current: RegisteredRouteNodeCurrentContext }>();
/** Promotion consumes fresh real runtime evidence. Retained JSON, editable
 * booleans, matching template bytes and synthetic measurements cannot promote. */
export function deriveRegisteredRouteLifecycle<Node>(input: {
  readonly current: RegisteredRouteNodeCurrentContext | undefined;
  readonly route: RouteRegistration;
  readonly registry: RouteRegistry;
  readonly source: RegisteredRouteSourceEvidence;
  readonly assembly: RuntimeAssemblyInput<Node>;
  readonly materialization?: RouteRuntimeMaterialization;
  readonly runtime: RuntimeAssemblyEvidence;
  readonly fresh: RuntimeEvidenceResult;
  readonly review?: { readonly evidence: ReviewEvidenceBundle; readonly policy: ReviewPolicy };
}): RegisteredRouteLifecycleResult {
  try {
    const { registry, route, source, assembly } = input;
    const current = registeredRouteNodeCurrentSnapshot(input.current, registry, route, source, input.materialization);
    const prepared = current && prepareRuntimeAssembly(assembly);
    if (!input.current || !current || !prepared || prepared.status !== "ready" || prepared.assembly.snapshot.hash !== current) return { status: "planned", findings: ["Current authenticated Node route transaction does not join the canonical assembly"] };
    if (!isCurrentRegisteredRouteSourceEvidence(source, registry, route, input.materialization?.digest) || !source.planDigest || runtimeHash(source.identity) !== runtimeHash(assembly.identity)) return { status: "planned", findings: ["Current aligned plan, discovered/generated source and exact runtime artifact identity do not join"] };
    const selection = deriveRouteRuntimeBinding(route.composition.binding, assembly.engine, assembly.ports.manifest, input.materialization);
    if (selection.status !== "resolved" || runtimeHash(selection.binding) !== runtimeHash(assembly.binding)) return { status: "planned", findings: ["Runtime assembly differs from the exact registered selected composition"] };
    const binding = selection.instance;
    if (input.materialization && runtimeHash(assembly.query?.state) !== runtimeHash(input.materialization.facts)) return { status: "planned", findings: ["Runtime query differs from current source materialization"] };
    const body = binding.body;
    const frame = assembly.ports.manifest.fills.find(fill => fill.kind === "frame" && fill.leaf === selection.binding.frame.leaf && fill.fill === selection.binding.frame.fill);
    const bodyAvailable = body?.kind === "flow"
      ? !!binding.layout && !!assembly.layout && assembly.layout.descriptor.leaf === binding.layout.leaf && assembly.layout.descriptor.config === binding.layout.config
      : body?.kind === "canvas" && assembly.layout === undefined && !!assembly.stage && assembly.stage.bodyDigest === runtimeHash(selection.binding.body) && !!frame?.stageModule && runtimeHash(assembly.stage.module) === runtimeHash(frame.stageModule);
    if (!bodyAvailable) return { status: "planned", findings: ["Exact registered body execution is unavailable"] };
    const header = assembly.pageHeader, brand = registeredRouteBrandLink(registry, route);
    if (!brand || !header || runtimeHash(header.brand ?? null) !== runtimeHash(brand) || header.id !== route.composition.header.id || runtimeHash(header.data) !== runtimeHash(route.composition.header.data) || !!header.actions !== !!route.composition.header.actions || header.actions && header.actions.renderer.source.entry !== route.composition.header.actions!.file) return { status: "planned", findings: ["Runtime provider/header/actions differ from registration"] };
    if (!source.styling || source.styling.profile !== runtimeHash(resolve(assembly.engine)) || source.styling.manifest !== runtimeHash(assembly.ports.manifest) || Object.entries(source.styling.css).some(([id, digest]) => !assembly.css.some(file => file.id === id && `sha256:${sha256(file.contents)}` === digest))) return { status: "planned", findings: ["Runtime styling differs from current reached source/profile evidence"] };
    const measured = validateRuntimeAssemblyEvidence(input.runtime, assembly, input.fresh);
    if (measured.status !== "measured") return { status: "planned", findings: measured.findings };
    let status: "built" | "reviewed" = "built";
    const findings: string[] = [];
    if (input.review) {
      const { evidence, policy } = input.review;
      if (evidence.headSha !== source.identity.head || policy.decisionUse !== "authoritative" || policy.requireApproval !== true || policy.requireSecondaryReview !== true || validateReviewEvidence(evidence, policy).length) findings.push("Exact artifact review evidence is unavailable or incomplete");
      else status = "reviewed";
    } else findings.push("Exact artifact review evidence pending");
    const evidence = Object.freeze({ routeId: route.routeId, composition: routeCompositionDigest(route), source, runtime: Object.freeze({ evidence: input.runtime.hash, snapshot: input.runtime.snapshot.hash, bundle: input.runtime.measurements.bundle.hash }), ...(status === "reviewed" ? { review: runtimeSnapshot(input.review!.evidence) } : {}) });
    derived.set(evidence, { status, current: input.current });
    return { status, evidence, findings };
  } catch { return { status: "planned", findings: ["Invalid joined route lifecycle evidence"] }; }
}
/** Read an already derived immutable receipt; caller-authored records never count. */
export function registeredRouteLifecycleStatus(registry: RouteRegistry, route: RouteRegistration, evidence: RegisteredRouteLifecycleEvidence | undefined, current: RegisteredRouteNodeCurrentContext | undefined): "planned" | "built" | "reviewed" {
  if (!evidence || evidence.composition !== routeCompositionDigest(route)) return "planned";
  const snapshot = registeredRouteNodeCurrentSnapshot(current, registry, route, evidence.source);
  const receipt = derived.get(evidence);
  return snapshot && snapshot === evidence.runtime.snapshot && receipt && receipt.current === current ? receipt.status : "planned";
}
