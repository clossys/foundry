import type { ConsumerInstanceLibrary, FlowInstanceBinding as InstanceBinding, InstanceFinding, InstanceRegistries } from "../../../core/instance-binding.js";
import type { LayoutCompilerPort } from "../../../core/layout-source.js";
import { derivePackPipeline } from "../pipeline.js";
import type { PublisherPipelineItem } from "../pipeline.js";
import type { ProductionSettingsByItem, PublisherInputRequest, PublisherInputRequests } from "../production-settings.js";
import { requiredContentQuestions } from "../production-settings.js";
import { APP_DETAIL_TAB_STAGES, APP_STAGES, APP_STATE_NAMES, deriveAppRouteStages } from "./inventory.js";
import type { AppInventory, AppRoute, AppStage, AppStageEvidence } from "./inventory.js";

/** A route reference joins an existing host binding; inventory never manufactures one. */
export interface AppPageBindingInput { readonly pageId: string; readonly binding: InstanceBinding }
export interface AppSubrowBindingInput {
  readonly subrowId: string;
  readonly parentPageId: string;
  /** Exact section paths in the parent source binding, never a second page assembly. */
  readonly fillPaths: readonly string[];
}
export interface AppPipelineMessages {
  /** @default "Which consumer instance binding implements this page?" */
  readonly bindingQuestion: string;
  /** @default "Which parent section paths implement this subrow?" */
  readonly subrowQuestion: string;
  /** @default "Instance binding or consumer library unavailable" */
  readonly bindingPending: string;
  /** @default "Parent section ownership is unavailable" */
  readonly subrowPending: string;
  /** @default "LK14 execution or declared instance states are unavailable" */
  readonly statesPending: string;
  /** @default "No applicable state has been checked" */
  readonly noStatesPending: string;
  /** @default "State declaration has a different scope; implementation proof pending" */
  readonly stateScopePending: string;
  /** @default "Requires every stage, including States and whole-instance LK12, to pass" */
  readonly readyPending: string;
  /** @default "Is STATE required here, and where is its scoped declaration?" */
  readonly stateQuestion: (state: string) => string;
}
const defaults: AppPipelineMessages = {
  bindingQuestion: "Which consumer instance binding implements this page?",
  subrowQuestion: "Which parent section paths implement this subrow?",
  bindingPending: "Instance binding or consumer library unavailable",
  subrowPending: "Parent section ownership is unavailable",
  statesPending: "LK14 execution or declared instance states are unavailable",
  noStatesPending: "No applicable state has been checked",
  stateScopePending: "State declaration has a different scope; implementation proof pending",
  readyPending: "Requires every stage, including States and whole-instance LK12, to pass",
  stateQuestion: state => `Is ${state} required here, and where is its scoped declaration?`,
};
export interface AppPipelineInput {
  readonly inventory: AppInventory;
  readonly pageBindings?: readonly AppPageBindingInput[];
  readonly subrowBindings?: readonly AppSubrowBindingInput[];
  readonly library?: ConsumerInstanceLibrary;
  readonly registries?: InstanceRegistries;
  readonly compiler?: LayoutCompilerPort;
  readonly settings?: ProductionSettingsByItem;
  readonly inputRequests?: PublisherInputRequests;
  readonly messages?: Partial<AppPipelineMessages>;
}
export interface AppPipelineItem {
  readonly route: AppRoute;
  /** Parent evidence is retained intact, including original and effective bindings. */
  readonly pipeline?: PublisherPipelineItem;
  readonly configured: boolean;
  readonly stages: readonly AppStageEvidence[];
  readonly findings: readonly InstanceFinding[];
  readonly inputRequests: readonly PublisherInputRequest[];
  readonly column: AppStage;
  readonly state: PublisherPipelineItem["state"];
}
const within = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}.`);
function sectionPaths(binding: InstanceBinding): string[] {
  return [...Object.entries(binding.fills).flatMap(([slot, fills]) => fills.map((_, index) => `fills.${slot}.${index}`)),
    ...Object.keys(binding.frame.slotFills ?? {}).map(slot => `frame.slotFills.${slot}`)];
}

/** App presentation over the shared checker; page and panel declarations cannot clear each other. */
export function deriveAppPipeline({ inventory, pageBindings = [], subrowBindings = [], library, registries, compiler, settings = {}, inputRequests = {}, messages }: AppPipelineInput) {
  const m = { ...defaults, ...messages };
  const pages = inventory.routes.filter(route => route.kind !== "detail-tab");
  const bindings = new Map<string, InstanceBinding>();
  const instanceIds = new Set<string>();
  for (const entry of pageBindings) {
    const page = pages.find(route => route.id === entry.pageId);
    if (!page || bindings.has(entry.pageId) || instanceIds.has(entry.binding.instanceId) || entry.binding.surface !== "app" || !entry.binding.packIds.includes("pack.app") || entry.binding.path !== page.path) throw new Error("Invalid App page binding identity");
    bindings.set(entry.pageId, entry.binding); instanceIds.add(entry.binding.instanceId);
  }
  const subrows = new Map<string, AppSubrowBindingInput>();
  for (const entry of subrowBindings) {
    const row = inventory.routes.find(route => route.id === entry.subrowId && route.kind === "detail-tab");
    const parent = bindings.get(entry.parentPageId);
    if (!row || row.parentRecordRoute !== entry.parentPageId || subrows.has(entry.subrowId) || !parent || new Set(entry.fillPaths).size !== entry.fillPaths.length || entry.fillPaths.some(path => !sectionPaths(parent).includes(path))) throw new Error("Invalid App subrow section ownership");
    subrows.set(entry.subrowId, entry);
  }
  for (const entry of subrowBindings) {
    const row = inventory.routes.find(route => route.id === entry.subrowId)!;
    if (row.parentSubrowId !== undefined) {
      const parent = subrows.get(row.parentSubrowId);
      if (!parent || parent.parentPageId !== entry.parentPageId || entry.fillPaths.some(path => !parent.fillPaths.includes(path))) throw new Error("Invalid nested App subrow ownership");
    }
  }
  const mapped = pages.flatMap(page => bindings.has(page.id) ? [{ page, binding: bindings.get(page.id)! }] : []);
  const pack = library && registries ? derivePackPipeline(mapped.map(entry => entry.binding), library, registries, compiler,
    Object.fromEntries(mapped.flatMap(({ page, binding }) => settings[page.id] ? [[binding.instanceId, settings[page.id]!]] : [])),
    Object.fromEntries(mapped.map(({ page, binding }) => [binding.instanceId, inputRequests[page.id] ?? []]))) : undefined;
  const checked = new Map(mapped.map(({ page }, index) => [page.id, pack?.items[index]]));
  const items: AppPipelineItem[] = inventory.routes.map(route => {
    const owner = route.parentRecordRoute ?? route.id;
    const pipeline = checked.get(owner), configured = settings[owner] !== undefined;
    const tab = route.kind === "detail-tab", assignment = subrows.get(route.id);
    const ownPaths = assignment?.fillPaths ?? [];
    const hasScope = !tab || ownPaths.length > 0;
    const findings = pipeline?.findings.filter(finding => !tab || finding.path === "states" || ownPaths.some(path => within(finding.path, path))) ?? [];
    const requests: PublisherInputRequest[] = pipeline && !tab ? [...pipeline.inputRequests] : [...requiredContentQuestions(findings), ...(inputRequests[route.id] ?? [])];
    if (!pipeline) requests.push({ slot: "binding", question: m.bindingQuestion });
    if (tab && !hasScope) requests.push({ slot: "fills", question: m.subrowQuestion });
    const required = APP_STATE_NAMES.filter(name => route.declaredStates[name].applicability === "required");
    for (const name of APP_STATE_NAMES) {
      const declaration = route.declaredStates[name];
      if (declaration.applicability === undefined || declaration.applicability === "undecided" || declaration.applicability === "required" && (!declaration.declared || declaration.scopeKind === undefined || declaration.scopeKind === "none")) requests.push({ slot: `states.${name}`, question: m.stateQuestion(name) });
    }
    const stageNames = tab ? APP_DETAIL_TAB_STAGES : APP_STAGES;
    const fallback = deriveAppRouteStages(route, settings[owner], registries);
    const stages: AppStageEvidence[] = stageNames.map(name => {
      if (name === "States") {
        const related = configured ? findings.filter(finding => finding.code === "LK14") : [];
        const pending: string[] = [];
        if (!configured || !pipeline || !hasScope || pipeline.stateCoverage !== "checked") pending.push(m.statesPending);
        if (!required.length) pending.push(m.noStatesPending);
        // Whole-page all-fill metadata is not evidence for a local runtime state.
        if (tab) pending.push(m.stateScopePending);
        for (const state of required) {
          const declaration = route.declaredStates[state];
          if (!declaration.declared || declaration.scopeKind !== (tab ? "panel" : "page") || !pipeline?.binding.states?.includes(state)) pending.push(m.stateScopePending);
        }
        if (requests.some(request => request.slot.startsWith("states."))) pending.push(m.statesPending);
        return { name, status: related.length ? "failed" : pending.length ? "pending" : "passed", reasons: [...related.map(finding => `${finding.code}: ${finding.message}`), ...new Set(pending)] };
      }
      if (!pipeline) {
        const stage = fallback.find(stage => stage.name === name)!;
        return { ...stage, reasons: name === "Configure" ? stage.reasons : [m.bindingPending] };
      }
      const stage = pipeline.stages.find(stage => stage.name === name)!;
      if (tab && !hasScope) return { name, status: "pending", reasons: [m.subrowPending] };
      const related = tab ? stage.findings.filter(finding => findings.includes(finding)) : stage.findings;
      // LK14 belongs to the additional States column. Other actual checker failures stay intact.
      const nonState = related.filter(finding => finding.code !== "LK14");
      const pending = [...stage.pending];
      if (name === "Checks" && tab && pipeline.staticCoverage !== "complete") pending.push(m.subrowPending);
      return { name, status: nonState.length ? stage.status === "pending" ? "pending" : "failed" : pending.length ? "pending" : stage.status === "failed" ? "passed" : stage.status,
        reasons: [...nonState.map(finding => `${finding.code}: ${finding.message}`), ...pending] };
    });
    const ready = stages.find(stage => stage.name === "Ready")!;
    const preceding = stages.filter(stage => !["Ready", "Export", "Deploy"].includes(stage.name));
    const readyIndex = stages.indexOf(ready);
    stages[readyIndex] = preceding.every(stage => stage.status === "passed") && pipeline?.wholeInstanceLK12 !== "pending" ? { ...ready, status: "passed", reasons: [] } : { name: "Ready", status: "pending", reasons: [m.readyPending] };
    const column = !configured ? "Configure" : stages.find(stage => stage.status === "failed")?.name ?? stages.find(stage => stage.status === "pending")?.name ?? "Ready";
    const state = !configured ? "to do" : requests.length ? "needs input" : stages.some(stage => stage.status === "failed") ? "failed" : column === "Ready" ? "ready" : "pending";
    return { route, pipeline, configured, stages, findings, inputRequests: configured ? requests : [], column, state };
  });
  return { items, pages: items.filter(item => item.route.kind !== "detail-tab"), readyCount: items.filter(item => item.route.kind !== "detail-tab" && item.state === "ready").length, frameLeaves: pack?.frameLeaves ?? [] };
}
