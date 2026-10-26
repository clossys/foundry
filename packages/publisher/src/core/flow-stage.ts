import { emit } from "@clossys/designer/catalog";
import type { CompositeResolved } from "@clossys/designer/catalog";
import { getEffectiveLayoutContract } from "../layouts/resolve.js";
import type { LayoutId, PageLayoutContract } from "../layouts/index.js";
export type BreakpointValues = Readonly<Partial<Record<`tokens.breakpoint.${string}`, number>>>;
export interface FlowStagePlan {
  readonly leaf: LayoutId;
  readonly config?: string;
  readonly members: Readonly<Record<string, string>>;
  readonly width: number;
  readonly columns: number;
  readonly slotOrder: readonly string[];
}
export function breakpoint(at: `tokens.breakpoint.${string}`, values: BreakpointValues): number {
  const value = values[at];
  if (!Number.isFinite(value) || value! <= 0) throw new Error(`Unresolved layout breakpoint: ${at}`);
  return value!;
}
export function columnsAt(contract: PageLayoutContract, width: number, values: BreakpointValues): number {
  return contract.reflow.reduce((columns, step) => width >= breakpoint(step.at, values) ? step.columns : columns, 1);
}
/** Pure Stage plan. The caller supplies one measured Stage width; Layouts never
 * measure or branch on viewport width and never use CSS order for reading order. */
export function planFlowStage(leaf: LayoutId, config: string | undefined, explicit: Readonly<Record<string, string>> | undefined, width: number, values: BreakpointValues): FlowStagePlan {
  if (!Number.isFinite(width) || width < 0) throw new Error("Stage width must be finite and nonnegative");
  const contract = getEffectiveLayoutContract(leaf, config, explicit);
  const members = { ...Object.fromEntries(Object.entries(contract.members).map(([key, options]) => [key, options[0]!])), ...contract.memberValues };
  if (leaf === "layouts.stack") breakpoint("tokens.breakpoint.mobile", values);
  let slotOrder = contract.slots.map(slot => slot.id);
  if (leaf === "layouts.split") slotOrder = members.collapse === "end-first" ? ["lead", "end", "start"] : ["lead", "start", "end"];
  if (leaf === "layouts.sidebar-content") {
    const wide = contract.reflow.some(step => width >= breakpoint(step.at, values));
    const before = wide ? members.side === "start" : members["stacked-aside"] === "before";
    slotOrder = before ? ["lead", "aside", "main"] : ["lead", "main", "aside"];
  }
  return Object.freeze({ leaf, config, members: Object.freeze({ ...contract.memberValues }), width, columns: columnsAt(contract, width, values), slotOrder: Object.freeze(slotOrder) });
}
const BASE = `[data-layout="layouts.stack"],
[data-layout="layouts.stack"]>[data-layout-slot="lead"],
[data-layout="layouts.stack"]>[data-layout-slot="lead"]>[data-layout-item],
[data-layout="layouts.stack"]>[data-layout-slot="body"],
[data-layout="layouts.stack"]>[data-layout-slot="body"]>[data-layout-item],
[data-layout="layouts.stack"]>[data-layout-slot="close"],
[data-layout="layouts.stack"]>[data-layout-slot="close"]>[data-layout-item],
[data-layout="layouts.split"],
[data-layout="layouts.split"]>[data-layout-slot="lead"],
[data-layout="layouts.split"]>[data-layout-slot="lead"]>[data-layout-item],
[data-layout="layouts.split"]>[data-layout-columns],
[data-layout="layouts.split"]>[data-layout-columns]>[data-layout-slot="start"],
[data-layout="layouts.split"]>[data-layout-columns]>[data-layout-slot="start"]>[data-layout-item],
[data-layout="layouts.split"]>[data-layout-columns]>[data-layout-slot="end"],
[data-layout="layouts.split"]>[data-layout-columns]>[data-layout-slot="end"]>[data-layout-item],
[data-layout="layouts.sidebar-content"],
[data-layout="layouts.sidebar-content"]>[data-layout-slot="lead"],
[data-layout="layouts.sidebar-content"]>[data-layout-slot="lead"]>[data-layout-item],
[data-layout="layouts.sidebar-content"]>[data-layout-columns],
[data-layout="layouts.sidebar-content"]>[data-layout-columns]>[data-layout-slot="main"],
[data-layout="layouts.sidebar-content"]>[data-layout-columns]>[data-layout-slot="main"]>[data-layout-item],
[data-layout="layouts.sidebar-content"]>[data-layout-columns]>[data-layout-slot="aside"],
[data-layout="layouts.sidebar-content"]>[data-layout-columns]>[data-layout-slot="aside"]>[data-layout-item],
[data-layout="layouts.bento"],
[data-layout="layouts.bento"]>[data-layout-slot="lead"],
[data-layout="layouts.bento"]>[data-layout-slot="lead"]>[data-layout-item],
[data-layout="layouts.bento"]>[data-layout-slot="tiles"],
[data-layout="layouts.bento"]>[data-layout-slot="tiles"]>[data-layout-item],
[data-layout="layouts.bento"]>[data-layout-slot="tiles"]>[data-span]{min-width:0}
[data-layout="layouts.stack"]{width:100%;margin-inline:auto}
[data-layout-stage]{container-type:inline-size;container-name:publisher-stage;min-inline-size:0}
[data-layout="layouts.stack"]{max-inline-size:100%;align-content:start}
[data-layout="layouts.stack"][data-align="center"]{min-block-size:100%}
[data-layout="layouts.stack"][data-align="center"]{align-content:center}
[data-layout="layouts.split"]>[data-layout-columns]>:is([data-layout-slot="start"],[data-layout-slot="end"]),[data-layout="layouts.sidebar-content"]>[data-layout-columns]>:is([data-layout-slot="main"],[data-layout-slot="aside"]){inline-size:100%;min-inline-size:0}
[data-layout="layouts.split"]>[data-layout-columns]>:is([data-layout-slot="start"],[data-layout-slot="end"]){flex-basis:0;flex-grow:1}
[data-layout="layouts.split"]>[data-layout-columns][data-align="center"]>:is([data-layout-slot="start"],[data-layout-slot="end"]){align-self:center}
[data-layout="layouts.split"]>[data-layout-columns][data-align="top"]>:is([data-layout-slot="start"],[data-layout-slot="end"]){align-self:start}
[data-layout="layouts.split"]>[data-layout-columns][data-ratio="3:2"]>[data-layout-slot="start"]{flex-grow:3}
[data-layout="layouts.split"]>[data-layout-columns][data-ratio="3:2"]>[data-layout-slot="end"]{flex-grow:2}
[data-layout="layouts.split"]>[data-layout-columns][data-ratio="2:3"]>[data-layout-slot="start"]{flex-grow:2}
[data-layout="layouts.split"]>[data-layout-columns][data-ratio="2:3"]>[data-layout-slot="end"]{flex-grow:3}
[data-layout="layouts.sidebar-content"]>[data-layout-columns]>:is([data-layout-slot="main"],[data-layout-slot="aside"]){align-self:start}
[data-layout="layouts.bento"]{gap:var(--spacing-lg)}
[data-layout="layouts.bento"][data-density="airy"]{gap:var(--spacing-xl)}
[data-layout="layouts.bento"][data-density="dense"]{gap:var(--spacing-md)}
[data-layout="layouts.bento"]>[data-layout-slot="tiles"]{gap:inherit}
[data-layout="layouts.bento"]>[data-layout-slot="tiles"]{grid-auto-flow:row;grid-template-columns:repeat(1,minmax(0,1fr))}
[data-layout="layouts.bento"]>[data-layout-slot="tiles"]>[data-span="1x2"],[data-layout="layouts.bento"]>[data-layout-slot="tiles"]>[data-span="2x2"]{grid-row:span 2}
`;
/** Query thresholds come from the canonical consumer CSS emitter, never catalog
 * literals or CSS var() queries (which cannot resolve custom properties). */
export function flowStageStyleSheet(profile: CompositeResolved, leaf: LayoutId, config?: string, explicit?: Readonly<Record<string, string>>): string {
  const theme = emit(profile.values, ["tailwind-theme"], { header: false })[0]!.contents;
  const contract = getEffectiveLayoutContract(leaf, config, explicit);
  const members = { ...Object.fromEntries(Object.entries(contract.members).map(([key, options]) => [key, options[0]!])), ...contract.memberValues };
  const threshold = (at: string) => {
    const property = `--breakpoint-${at.slice("tokens.breakpoint.".length)}`;
    const values = [...theme.matchAll(/(--[\w-]+):\s*([^;]+);/g)].filter(match => match[1] === property);
    if (values.length !== 1 || !/^(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em)$/.test(values[0]![2]!.trim())) throw new Error(`NEED: literal canonical container-query threshold ${at}`);
    return values[0]![2]!.trim();
  };
  let css = BASE;
  const query = (at: string, rules: string) => { css += `@container publisher-stage (min-width:${threshold(at)}){${rules}}\n`; };
  if (leaf === "layouts.stack") {
    const token = ({ wide: "wide", content: "content", prose: "prose", form: "form" } as Readonly<Record<string, string>>)[members.measure ?? ""];
    if (token) query("tokens.breakpoint.mobile", `[data-layout="layouts.stack"][data-measure="${members.measure}"]{max-inline-size:var(--ui-width-${token}-max)}`);
  }
  if (leaf === "layouts.split") for (const step of contract.reflow) query(step.at, `[data-layout="layouts.split"]>[data-layout-columns]{flex-direction:row}[data-layout="layouts.split"]>[data-layout-columns]>:is([data-layout-slot="start"],[data-layout-slot="end"]){inline-size:auto}`);
  if (leaf === "layouts.sidebar-content") for (const step of contract.reflow) query(step.at, `[data-layout="layouts.sidebar-content"]>[data-layout-columns]{flex-direction:row}[data-layout="layouts.sidebar-content"]>[data-layout-columns]>[data-layout-slot="main"]{flex-grow:2;flex-basis:0;inline-size:auto}[data-layout="layouts.sidebar-content"]>[data-layout-columns]>[data-layout-slot="aside"]{flex-shrink:0;inline-size:var(--ui-layout-aside-w)}[data-layout="layouts.sidebar-content"]>[data-layout-columns][data-aside-width="third"]>[data-layout-slot="aside"]{flex-grow:1;flex-basis:0;inline-size:auto}[data-layout="layouts.sidebar-content"]>[data-layout-columns][data-sticky="aside"]>[data-layout-slot="aside"]{position:sticky;inset-block-start:0}`);
  if (leaf === "layouts.bento") for (const step of contract.reflow) query(step.at, `[data-layout="layouts.bento"]>[data-layout-slot="tiles"]{grid-template-columns:repeat(${step.columns},minmax(0,1fr))}[data-layout="layouts.bento"]>[data-layout-slot="tiles"]>[data-span="2x1"],[data-layout="layouts.bento"]>[data-layout-slot="tiles"]>[data-span="2x2"]{grid-column:span 2}`);
  return css;
}
