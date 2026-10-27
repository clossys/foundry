import { validateInstalledComponentRule, type ComponentCompositionContext } from "./component-rule-validation.js";
import type { ComponentCandidate, ComponentOrigin } from "./resolve-components.js";
import { sha256 } from "./digest.js";
import { stableStringify } from "./stable.js";
import { contrastRatio } from "../tokens/color.js";
import type { ComponentContract, ComponentSlot } from "./types.js";

export type ComponentCheckCode = `K${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12}`;
export type ComponentCompatibilityCode = `CC${1 | 2 | 3 | 4 | 5}`;
export interface ComponentFinding {
  code: ComponentCheckCode; compatibility?: ComponentCompatibilityCode;
  /** `notice` is only ever a runtime-pending finding (see `isObservationPending`); every other finding is an error. */
  rule: string; severity: "error" | "notice"; subject: string; message: string;
}
/** Descriptors carry claims. Independently gathered observations are supplied separately. */
export interface ComponentCheckFill {
  slot: string; source: string; root: ComponentContract["root"];
  members: readonly string[]; props: readonly string[]; propMap: Readonly<Record<string, string>>;
  reads: { tokens: readonly string[]; assets: readonly string[]; components: readonly string[] };
  composes: readonly string[];
  impl: { kind: "package"; module: string; export: string } | { kind: "source"; entry: string; export: string } | { kind: "composed"; rule: string };
  license: string;
  pin?: { package?: string; version?: string; export?: string; url?: string; commit?: string; files?: readonly { path: string; sha256: string }[] };
  notice?: string;
  deps: readonly { name: string; version: string; license: string; registryItem?: string; slot?: string }[];
  parts?: readonly { item: string; slot?: string }[];
  rac?: { range: string; peer: boolean; instance: string };
}
export interface ComponentSourceFile {
  path: string; content: string;
  /** Exact source ranges independently classified as chart data, never icon artwork. */
  geometry?: readonly { start: number; end: number; kind: "chart-data" }[];
}
export interface ComponentMeasurement {
  state: string; mode: "light" | "dark"; ground: string;
  roles: readonly string[]; keyboard: readonly string[]; axeViolations: readonly string[];
  focusTokens: readonly string[];
  /** Direct composed child independently observed to own this focus indicator. */
  focusOwner?: string;
  forcedColors: { foreground: string; background: string };
  target: { width: number; height: number };
  contrast: readonly { foreground: string; background: string; kind: "text" | "large-text" | "ui" }[];
}
export interface ComponentCallSite {
  target: string; props: readonly string[]; members: readonly string[];
  /** Local JSX binding when it differs from the dependency export. */
  local?: string;
  /** A RAC context consumer must retain this exact root, ref and render-prop protocol. */
  contextRoot?: string;
}
export interface ComponentObservation {
  files: readonly ComponentSourceFile[];
  /** Registry input bytes and rewritten output receipts are separate hash domains. */
  upstreamFiles?: readonly ComponentSourceFile[];
  outputSha256?: readonly { path: string; sha256: string }[];
  /** Observed source and consumer-token digests bind measurements to the inspected bytes. */
  sourceHash: string; tokensHash: string;
  root: ComponentContract["root"]; forwardsRef: boolean; forwardsRenderProps: boolean;
  rac: { version: string; instance: string; dependency: "peer" | "bundled" | "source" };
  calls: readonly ComponentCallSite[];
  /** Measured size-member bindings (`size.*` member -> `tokens.control-size.*`), needed when controls mix sources. */
  geometry?: Readonly<Record<string, string>>;
  /**
   * Digest of the exact adopted descriptor the runtime evidence was measured against
   * (`componentDescriptorDigest`, equal to `origin.sha256` for an adopted fill). When present it must
   * equal the checked descriptor's digest, so evidence measured for another descriptor is refused.
   */
  descriptorHash?: string;
  measurements: readonly ComponentMeasurement[];
  memberObservations?: Readonly<Record<string, Pick<ComponentObservation, "root" | "forwardsRef" | "forwardsRenderProps" | "calls" | "measurements">>>;
}
export interface ComponentCheckInput {
  compositions?: ComponentCompositionContext;
  slots: readonly ComponentSlot[]; fills: readonly ComponentCheckFill[];
  observations: Readonly<Record<string, ComponentObservation | undefined>>;
  tokens: Readonly<Record<string, { property: string; light: string; dark?: string }>>;
  assets: readonly string[];
  installedRac: { version: string; instance: string };
  requiredMembers?: Readonly<Record<string, readonly string[]>>;
  operations?: readonly { op: string; slot: string; members?: readonly string[] }[];
  /** Classes whose compiled declaration has been independently mapped to this token member. */
  classBindings?: Readonly<Record<string, string>>;
  coherenceGroups?: readonly { id: string; slots: readonly string[]; kind: "controls" | "charts" | "date" | "preferred" }[];
  /** Descriptor digests keyed by slot, computed before checking rewrites a fill's display source. Absent: digested from the fill as given. */
  descriptorHashes?: Readonly<Record<string, string>>;
}
export interface ComponentCheckResult { ok: boolean; findings: readonly ComponentFinding[] }
const FOREIGN_ICON_MODULES = ["lucide-react", "@phosphor-icons/react", "react-icons"];
const FOREIGN_ICONS = new RegExp("^(?:" + FOREIGN_ICON_MODULES.join("|") + ")(?:/|$)");
const LICENSES = new Set(["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "OFL-1.1", "CC0-1.0"]);
const CHARTS = new Set(["bar", "line", "area", "scatter", "sparkline", "heatmap", "range", "waterfall", "status-strip"].map(name => `components.chart-${name}`));
const FORBIDDEN_MODULES = ["@radix-ui/", "radix-ui", "@base-ui/", "@tanstack/", "sonner", "react-resizable-panels", "embla-carousel-react", "input-otp", "recharts", "@headlessui/", "@shadcn/react"];
const FORBIDDEN = new RegExp("^(?:" + FORBIDDEN_MODULES.map(module => module.endsWith("/") ? module : `${module}(?:/|$)`).join("|") + ")");
/** Emitted per fill (or `member: ` prefixed) when no source/runtime observation was gathered. */
export const OBSERVATIONS_UNAVAILABLE = "Source and runtime observations are unavailable";
const RUNTIME_PENDING: readonly ComponentCheckCode[] = ["K2", "K4", "K5", "K6", "K7", "K10", "K12"];
/** K9 (a declared private part) and K11 (controls geometry parity) are proven only from observed source, so they are pending on an unobserved fill too. */
const PENDING_CODES: readonly ComponentCheckCode[] = [...RUNTIME_PENDING, "K9", "K11"];
/**
 * Absent observations are runtime-pending, not a refusal: the fill is statically checked and
 * adoptable, never runtime-qualified. They are notices, so `ok` (no errors) admits adoption and
 * persistence, while emitted consumption reports `runtime-pending` and runtime assembly stays
 * pending until real observations are supplied. Supplied observations that fail stay errors.
 */
export function isObservationPending(finding: { code: string; severity: string; message: string }): boolean {
  return finding.severity === "notice" && (PENDING_CODES as readonly string[]).includes(finding.code)
    && (finding.message === OBSERVATIONS_UNAVAILABLE || finding.message.endsWith(`: ${OBSERVATIONS_UNAVAILABLE}`));
}
/** Coherence groups every profile check applies, before caller-supplied groups. */
/** form is a validation container (rac:Form) and field a label/description/error wrapper around a caller-supplied control;
 * neither renders control geometry of its own, so neither is a controls-group member. */
export const DEFAULT_COHERENCE_GROUPS: NonNullable<ComponentCheckInput["coherenceGroups"]> = [
  { id: "controls", kind: "controls", slots: ["text-field", "search-field", "checkbox", "radio-group", "switch", "select", "combo-box", "toggle-group", "tag-group", "number-field", "slider", "date-field"].map(name => `components.${name}`) },
  { id: "charts", kind: "charts", slots: [...CHARTS] }, { id: "date", kind: "date", slots: ["components.date-field", "components.calendar", "components.date-picker"] },
];
/** Protocol keys that activate a control; a disabled state must show they are not handled. */
const ACTIVATION_KEYS: readonly string[] = ["Enter", "Space"];
const GLYPHS = /[✓✔✕✖×✗▾▴▸◂▶◀▲▼←→↑↓⌄⌃⌵⌫⊕⊖⚠ℹ]/u;
const SYSTEM_COLORS = new Set(["Canvas", "CanvasText", "ButtonFace", "ButtonText", "Highlight", "HighlightText", "Field", "FieldText", "LinkText"]);
export const ROOT_PROTOCOL: Readonly<Record<string, { roles: readonly string[]; keys: readonly string[] }>> = {
  Button: { roles: ["button"], keys: ["Enter", "Space"] }, ToggleButton: { roles: ["button"], keys: ["Enter", "Space"] },
  Select: { roles: ["button", "listbox"], keys: ["ArrowDown", "ArrowUp", "Enter", "Escape"] },
  ComboBox: { roles: ["combobox", "listbox"], keys: ["ArrowDown", "ArrowUp", "Enter", "Escape"] },
  Checkbox: { roles: ["checkbox"], keys: ["Space"] }, CheckboxGroup: { roles: ["group", "checkbox"], keys: ["Space"] },
  Switch: { roles: ["switch"], keys: ["Space"] }, RadioGroup: { roles: ["radiogroup", "radio"], keys: ["ArrowDown", "ArrowUp"] },
  Menu: { roles: ["menu", "menuitem"], keys: ["ArrowDown", "ArrowUp", "Escape"] },
  Toolbar: { roles: ["toolbar"], keys: ["ArrowLeft", "ArrowRight"] },
  TextField: { roles: ["textbox"], keys: [] }, SearchField: { roles: ["searchbox"], keys: ["Escape"] },
  Slider: { roles: ["slider"], keys: ["ArrowLeft", "ArrowRight", "Home", "End"] },
  NumberField: { roles: ["spinbutton"], keys: ["ArrowUp", "ArrowDown"] },
  Tree: { roles: ["tree", "treeitem"], keys: ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"] },
  Tabs: { roles: ["tablist", "tab", "tabpanel"], keys: ["ArrowLeft", "ArrowRight"] },
  Dialog: { roles: ["dialog"], keys: ["Escape", "Tab"] }, Modal: { roles: ["dialog"], keys: ["Escape", "Tab"] },
  Link: { roles: ["link"], keys: ["Enter"] }, ProgressBar: { roles: ["progressbar"], keys: [] },
  Meter: { roles: ["meter"], keys: [] }, Separator: { roles: ["separator"], keys: [] },
  Label: { roles: [], keys: [] }, Text: { roles: [], keys: [] }, FieldError: { roles: [], keys: [] },
  Form: { roles: [], keys: [] }, FileTrigger: { roles: [], keys: [] }, Keyboard: { roles: [], keys: [] },
  Calendar: { roles: ["grid"], keys: ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"] },
  RangeCalendar: { roles: ["grid"], keys: ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"] },
  DatePicker: { roles: ["group"], keys: ["ArrowUp", "ArrowDown", "Escape"] }, DateRangePicker: { roles: ["group"], keys: ["ArrowUp", "ArrowDown", "Escape"] },
  DateField: { roles: ["group", "spinbutton"], keys: ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"] },
  TimeField: { roles: ["group", "spinbutton"], keys: ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"] },
  ColorPicker: { roles: [], keys: [] },
  Table: { roles: ["grid", "row", "columnheader"], keys: ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"] },
  GridList: { roles: ["grid", "row"], keys: ["ArrowUp", "ArrowDown"] },
  ToggleButtonGroup: { roles: ["group", "button"], keys: ["ArrowLeft", "ArrowRight"] },
  TagGroup: { roles: ["grid", "row"], keys: ["ArrowLeft", "ArrowRight"] },
  Breadcrumbs: { roles: ["navigation"], keys: [] },
  NavigationTree: { roles: ["tree", "treeitem"], keys: ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"] },
  Disclosure: { roles: ["button"], keys: ["Enter", "Space"] }, DisclosureGroup: { roles: ["button"], keys: ["Enter", "Space"] },
  UNSTABLE_Toast: { roles: ["alertdialog"], keys: ["Tab", "Escape"] },
  Popover: { roles: ["dialog"], keys: ["Escape", "Tab"] }, Tooltip: { roles: ["tooltip"], keys: ["Escape"] },
};

/** A narrow semver evaluator: unsupported expressions fail closed. No package-manager resolution is performed. */
export function componentRacRangeIncludes(range: string, version: string): boolean {
  const parse = (value: string): number[] | undefined => /^\d+\.\d+\.\d+$/.test(value) ? value.split(".").map(Number) : undefined;
  const installed = parse(version); if (!installed) return false;
  const compare = (a: number[], b: number[]): number => { for (let n = 0; n < 3; n++) if (a[n] !== b[n]) return a[n]! - b[n]!; return 0; };
  return range.split("||").some(part => {
    const terms = part.trim().split(/\s+/); if (!terms[0]) return false;
    return terms.every(term => {
      const match = /^(\^|~|>=|<=|>|<|=)?(\d+\.\d+\.\d+)$/.exec(term); if (!match) return false;
      const minimum = parse(match[2]!)!; const order = compare(installed, minimum);
      switch (match[1] ?? "=") {
        case "^": { const upper = minimum[0]! > 0 ? [minimum[0]! + 1, 0, 0] : minimum[1]! > 0 ? [0, minimum[1]! + 1, 0] : [0, 0, minimum[2]! + 1]; return order >= 0 && compare(installed, upper) < 0; }
        case "~": return order >= 0 && compare(installed, [minimum[0]!, minimum[1]! + 1, 0]) < 0;
        case ">=": return order >= 0; case "<=": return order <= 0; case ">": return order > 0; case "<": return order < 0; default: return order === 0;
      }
    });
  });
}
export function componentSourceHash(files: readonly ComponentSourceFile[]): string {
  return sha256(stableStringify([...files].map(({ path, content }) => ({ path, content })).sort((a, b) => a.path.localeCompare(b.path))));
}
export function componentTokensHash(tokens: ComponentCheckInput["tokens"]): string { return sha256(stableStringify(tokens)); }
/** Descriptor digest; the hash domain excludes only provenance (`origin`), so local descriptor edits remain detectable. */
export function componentDescriptorDigest(fill: ComponentCheckFill): string {
  const { origin: _origin, ...descriptor } = fill as ComponentCheckFill & { origin?: unknown };
  return sha256(stableStringify(descriptor));
}
export const RAC_PACKAGE = "react-aria-components";
/**
 * A descriptor declares the RAC package it binds (`rac.instance`), never a consumer's install path, which it
 * cannot know. It matches the consumer singleton when it names the installed instance exactly, or names the
 * package and the installed instance is that package's own `node_modules/<package>` directory. Anything else fails closed.
 */
export function componentRacInstanceMatches(declared: string, installed: string): boolean {
  if (!declared || !installed) return false;
  if (declared === installed) return true;
  return declared === RAC_PACKAGE && (installed === `node_modules/${RAC_PACKAGE}` || installed.endsWith(`/node_modules/${RAC_PACKAGE}`));
}

/** Remove comments without deleting string contents (URLs and quoted module names stay observable). */
function codeText(source: string): string {
  let result = ""; let quote = "";
  for (let i = 0; i < source.length; i++) {
    const char = source[i]!; const next = source[i + 1];
    if (quote) { result += char; if (char === "\\") result += source[++i] ?? ""; else if (char === quote) quote = ""; continue; }
    if (char === '"' || char === "'" || char === "`") { quote = char; result += char; continue; }
    if (char === "/" && next === "/") { while (i < source.length && source[i] !== "\n") { result += " "; i++; } result += "\n"; continue; }
    if (char === "/" && next === "*") { result += "  "; i += 2; while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) { result += source[i] === "\n" ? "\n" : " "; i++; } result += "  "; i++; continue; }
    result += char;
  }
  return result;
}
function imports(source: string): string[] {
  return [...source.matchAll(/(?:\bfrom\s*|\bimport\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["']([^"']+)["']/g)].map(match => match[1]!);
}
/** K4 utility families; each named value needs a bound consumer token. */
const UTILITY = /^(?:h|w|min-h|min-w|max-h|max-w|p[trblxy]?|m[trblxy]?|gap|rounded|text|bg|border)-[\w./-]+/;
/**
 * K4 utilities, read from whole class tokens (split on whitespace and quotes). Variants are stripped at the
 * last top-level `:`, then a utility is matched only at the start of what remains, so a family name inside a
 * `--custom-property`, a `(length:--…)` argument, an arbitrary variant (`[.border-b]:`) or a longer utility
 * (`scroll-py-1`) is never a match. A Tailwind v4 `-(…)` or `-[…]` value is read whole, never truncated, and is
 * not a named value: its contents are judged by the unbound-property and literal rules, exactly as `border-(…)`
 * always was, so `border-t-(…)` no longer fails as a truncated `border-t-`.
 */
function classUtilities(code: string): string[] {
  const found: string[] = [];
  for (const token of code.split(/[\s"'`]+/)) {
    let depth = 0; let start = 0;
    for (let i = 0; i < token.length; i++) {
      const char = token[i]!;
      if (char === "[" || char === "(") depth++; else if (char === "]" || char === ")") depth = Math.max(0, depth - 1); else if (char === ":" && depth === 0) start = i + 1;
    }
    const base = token.slice(start).replace(/^!/, "").replace(/^-(?=[a-z])/, "");
    const match = UTILITY.exec(base);
    if (match && !/^[[(]/.test(base.slice(match[0].length))) found.push(match[0]);
  }
  return found;
}
/**
 * K4 utilities whose compiled Tailwind declaration carries no length, colour or spacing value: a keyword
 * (auto, fit/min/max-content, none, transparent, currentcolor, inherit, alignment, wrap, clip, blend, border
 * style), zero, 100% (`full`) or the maximum radius. Closed per family; every other value, including `px`,
 * `screen`, fractions, theme steps and arbitrary values, still needs a bound consumer token or fails as a literal.
 */
const VALUE_FREE_UTILITIES: readonly RegExp[] = [
  /^(?:min-|max-)?[hw]-(?:0|auto|full|fit|min|max)$/, /^max-[hw]-none$/,
  /^[pm][trblxy]?-0$/, /^m[trblxy]?-auto$/, /^gap(?:-[xy])?-0$/,
  /^rounded(?:-(?:[trblse]|[tb][lr]|[se][se]))?-(?:none|full)$/,
  /^border(?:-[xytrblse])?-(?:0|transparent|current|inherit)$/, /^border-(?:solid|dashed|dotted|double|hidden|none|collapse|separate)$/,
  /^bg-(?:transparent|current|inherit|none)$/, /^bg-(?:clip-(?:border|padding|content|text)|origin-(?:border|padding|content))$/,
  /^bg-blend-(?:normal|multiply|screen|overlay|darken|lighten|color-dodge|color-burn|hard-light|soft-light|difference|exclusion|hue|saturation|color|luminosity)$/,
  /^text-(?:left|center|right|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip|transparent|current|inherit)$/,
];
/**
 * Custom properties React Aria Components itself sets at runtime, so a consumer token can never bind them. Each is
 * listed in the "CSS variables" table of its RAC docs page (source: adobe/react-spectrum
 * `packages/dev/s2-docs/pages/react-aria/<Page>.mdx`, published at react-aria.adobe.com/<Page>) and set in the
 * installed `react-aria-components` / `react-aria` dist. Only a fill whose observed source imports
 * `react-aria-components` is exempted for them.
 */
const RAC_RUNTIME_PROPERTIES: Readonly<Record<string, string>> = {
  "--trigger-width": "Popover: the width of the popover trigger element (also styling guide, CSS variables)",
  "--trigger-anchor-point": "Popover and Tooltip: the position of the trigger relative to the overlay, for transform-origin",
  "--disclosure-panel-width": "Disclosure: the panel's intrinsic width, for animations",
  "--disclosure-panel-height": "Disclosure: the panel's intrinsic height, for animations",
  "--tab-panel-width": "Tabs: the width of the active tab panel, for animations",
  "--tab-panel-height": "Tabs: the height of the active tab panel, for animations",
  "--visual-viewport-width": "Modal: the width of the visual viewport",
  "--visual-viewport-height": "Modal: the height of the visual viewport",
  "--page-width": "Modal: the width of the <body> element, for the backdrop",
  "--page-height": "Modal: the height of the <body> element, for the backdrop",
  "--tree-item-level": "Tree: the depth of the item within the tree, for indentation",
  "--table-row-level": "Table: the depth of the row within the table, for indentation",
};
/**
 * Custom properties a file defines itself: a Tailwind arbitrary property `[--name:value]` (behind any variant), a
 * style-object key `"--name": value`, or a CSS declaration `--name: value`. A use of such a property is not an
 * unbound consumer property; the defining value stays in the file and is judged by the same property and literal rules.
 */
function definedProperties(code: string): Set<string> {
  return new Set([...code.matchAll(/(?:^|[[{;,\s"'])(--[a-zA-Z][\w-]*)["']?\]?\s*:/gm)].map(match => match[1]!));
}
function rootNames(root: string): string[] { return root.startsWith("rac:") ? root.slice(4).split("+") : []; }
/** Contracts grant leaves; declarations may name a leaf or one exact member. */
function tokenLeaf(read: string): string | undefined {
  return /^tokens\.[a-z0-9-]+(?:\.[a-z0-9-]+)?$/.test(read) ? read.split(".").slice(0, 2).join(".") : undefined;
}
function tokenReadResolves(tokens: ComponentCheckInput["tokens"], read: string): boolean {
  const leaf = tokenLeaf(read);
  if (!leaf) return false;
  if (read !== leaf) return Object.hasOwn(tokens, read);
  return Object.keys(tokens).some(member => member !== leaf && tokenLeaf(member) === leaf);
}
function isRead(fill: ComponentCheckFill, member: string): boolean {
  const leaf = tokenLeaf(member);
  return !!leaf && member !== leaf && (fill.reads.tokens.includes(member) || fill.reads.tokens.includes(leaf));
}
function readLeaves(fill: ComponentCheckFill): string[] {
  return [...new Set(fill.reads.tokens.map(tokenLeaf).filter((leaf): leaf is string => leaf !== undefined))];
}
function matrix(contract: ComponentContract): { states: string[]; grounds: string[] } {
  const members = contract.members.mode === "closed" ? contract.members.names : contract.members.required ?? [];
  const values = (prefix: string, fallback: string): string[] => { const found = members.filter(member => member.startsWith(`${prefix}.`)).map(member => member.slice(prefix.length + 1)); return found.length ? [...new Set(found)] : [fallback]; };
  return { states: values("state", "default"), grounds: values("ground", "base") };
}

/** Checks gathered source/evidence; never fetches, installs, mounts React, or invents missing measurements. */
export function checkComponentProfile(input: ComponentCheckInput): ComponentCheckResult {
  const findings: ComponentFinding[] = [];
  const add = (code: ComponentCheckCode, subject: string, message: string, compatibility?: ComponentCompatibilityCode): void => { findings.push({ code, rule: compatibility ?? code, subject, severity: "error", message, ...(compatibility ? { compatibility } : {}) }); };
  const slots = new Map(input.slots.map(slot => [slot.id, slot]));
  const fills = new Map<string, ComponentCheckFill>();
  for (const fill of input.fills) { if (fills.has(fill.slot)) add("K1", fill.slot, "A component slot must have one whole implementation"); else fills.set(fill.slot, fill); }
  for (const slot of Object.keys(input.requiredMembers ?? {})) if (!fills.has(slot)) add("K1", slot, "Required consumer component has no implementation");
  for (const operation of input.operations ?? []) if (operation.slot.startsWith("components.") && operation.members !== undefined) add("K1", operation.slot, "Component operations are slot-scope only; members are forbidden");
  const tokenHash = componentTokensHash(input.tokens);
  for (const fill of input.fills) {
    const canonicalContract = slots.get(fill.slot)?.contract;
    const contract = canonicalContract;
    if (!contract) { add("K1", fill.slot, "Unknown component contract"); continue; }
    const known = contract.members.mode === "closed" ? contract.members.names : undefined;
    const required = input.requiredMembers?.[fill.slot] ?? (contract.members.mode === "closed" ? contract.members.names : contract.members.required ?? []);
    if (fill.root !== contract.root) add("K1", fill.slot, `Root must equal ${contract.root}`);
    for (const member of fill.members) if (known ? !known.includes(member) : !new RegExp(contract.members.mode === "open" ? contract.members.pattern : "^$").test(member)) add("K1", fill.slot, `Unknown member ${member}`);
    for (const member of required) if (!fill.members.includes(member) || !(member in fill.propMap)) add("K1", fill.slot, `Required member ${member} is not mapped`);
    for (const prop of contract.props) if (!fill.props.includes(prop)) add("K1", fill.slot, `Required prop ${prop} is missing`);
    for (const member of Object.keys(fill.propMap)) if (!fill.members.includes(member)) add("K1", fill.slot, `Mapping names unsupported member ${member}`);
    for (const [layer, reads] of Object.entries(fill.reads)) for (const read of reads) {
      if (layer === "tokens" && !tokenReadResolves(input.tokens, read)) add("K3", fill.slot, `Token read ${read} does not resolve`);
      if (layer === "assets" && (!read.startsWith("assets.") || !input.assets.includes(read))) add("K3", fill.slot, `Asset read ${read} does not resolve`);
      if (layer === "components" && (!read.startsWith("components.") || !fills.has(read))) add("K3", fill.slot, `Component read ${read} does not resolve`);
      if (layer === "tokens" ? !contract.allowedReads.tokens.includes(tokenLeaf(read) ?? "") : layer === "assets" && !contract.allowedReads.assets.includes(read)) add("K3", fill.slot, `Read ${read} is outside the contract`);
    }
    for (const target of fill.composes) if (!fill.reads.components.includes(target) || !fills.has(target)) add("K3", fill.slot, `Composition ${target} is undeclared or unresolved`);
    if (!LICENSES.has(fill.license) || fill.deps.some(dep => !LICENSES.has(dep.license))) add("K8", fill.slot, "Fill and every dependency require an allowed SPDX licence");
    if (fill.impl.kind === "package" && fill.pin?.package && !(fill.impl.module === fill.pin.package || fill.impl.module.startsWith(`${fill.pin.package}/`))) add("K8", fill.slot, "Package module differs from its pinned package");
    if (fill.impl.kind === "package" && (!fill.pin?.package || !/^\d+\.\d+\.\d+$/.test(fill.pin.version ?? "") || !fill.pin.export)) add("K8", fill.slot, "Package fill requires exact package/version/export pin");
    let ownedRule = false;
    if (fill.impl.kind === "source" && (fill as ComponentCandidate & { origin?: ComponentOrigin }).origin?.kind === "composed") {
      try {
        if (!input.compositions) throw new Error("consumer rule context unavailable");
        validateInstalledComponentRule(fill as ComponentCandidate & { origin?: ComponentOrigin }, input.compositions);
        ownedRule = true;
      } catch (error) { add("K8", fill.slot, `Registered composition proof failed: ${(error as Error).message}`); }
    }
    if (fill.impl.kind === "source" && !ownedRule && (!fill.pin?.url || !/^[a-f0-9]{40}$/.test(fill.pin.commit ?? "") || !fill.pin.files?.length || !fill.notice?.trim())) add("K8", fill.slot, "Source fill requires commit, file hashes and licence notice");
    const observedFiles = input.observations[fill.slot]?.files;
    for (const dep of fill.deps) if (dep.registryItem && (!dep.slot || !fill.composes.includes(dep.slot))) {
      const declared = !!fill.parts?.some(part => part.item === dep.registryItem);
      if (declared && observedFiles?.some(file => file.path.includes(`_parts/${dep.registryItem}/`))) continue;
      // A declared part is proven only by observed source: unobserved it is runtime-pending; observed without it, or undeclared, it fails.
      if (declared && !observedFiles?.length) findings.push({ code: "K9", rule: "K9", subject: fill.slot, severity: "notice", message: `Registry dependency ${dep.registryItem}: ${OBSERVATIONS_UNAVAILABLE}` });
      else add("K9", fill.slot, `Registry dependency ${dep.registryItem} is neither materialized nor rebound`);
    }
    for (const part of fill.parts ?? []) if (part.slot || slots.has(`components.${part.item}`)) add("K12", fill.slot, `Private part ${part.item} duplicates a component leaf`, "CC4");
    const commonObservation = input.observations[fill.slot];
    const mappedRoots = Object.entries(contract.memberRoots ?? {});
    for (const [member] of mappedRoots) if (!fill.members.includes(member)) add("K1", fill.slot, `Root mapping names unsupported member ${member}`);
    for (const member of Object.keys(commonObservation?.memberObservations ?? {})) if (!Object.hasOwn(contract.memberRoots ?? {}, member)) add("K2", fill.slot, `Unknown root observation ${member}`);
    for (const [observedMember, observedRoot] of mappedRoots.length ? mappedRoots : [["", contract.root]] as const) {
    const contract = { ...canonicalContract!, root: observedRoot };
    const add = (code: ComponentCheckCode, subject: string, message: string, compatibility?: ComponentCompatibilityCode): void => { findings.push({ code, rule: compatibility ?? code, subject, severity: "error", message: observedMember ? `${observedMember}: ${message}` : message, ...(compatibility ? { compatibility } : {}) }); };
    const memberObservation = observedMember ? commonObservation?.memberObservations?.[observedMember] : undefined;
    const observation = observedMember ? memberObservation && commonObservation ? { ...commonObservation, ...memberObservation } : undefined : commonObservation;
    // An unobserved fill is runtime-pending; a supplied observation that omits a mapped member is incomplete evidence and fails.
    if (!observation?.files.length) { for (const code of RUNTIME_PENDING) findings.push({ code, rule: code, subject: fill.slot, severity: commonObservation?.files.length ? "error" : "notice", message: observedMember ? `${observedMember}: ${OBSERVATIONS_UNAVAILABLE}` : OBSERVATIONS_UNAVAILABLE }); continue; }
    if (ownedRule && (!input.compositions || !observation.files.some(file => file.path === (fill.impl.kind === "source" ? fill.impl.entry : "")) || observation.files.some(file => !input.compositions!.library.files.some(actual => actual.path === file.path && actual.content === file.content)))) add("K8", fill.slot, "Observed composition source differs from current materialized output");
    const freshEvidence = observation.sourceHash === componentSourceHash(observation.files) && observation.tokensHash === tokenHash;
    if (!freshEvidence) { add("K5", fill.slot, "Accessibility evidence is stale for source or consumer tokens"); add("K6", fill.slot, "Contrast evidence is stale for source or consumer tokens"); }
    if (observation.descriptorHash !== undefined && observation.descriptorHash !== (input.descriptorHashes?.[fill.slot] ?? componentDescriptorDigest(fill))) { add("K5", fill.slot, "Accessibility evidence was measured for a different descriptor"); add("K6", fill.slot, "Contrast evidence was measured for a different descriptor"); }
    const files = observation.files.map(file => ({ ...file, code: codeText(file.content) }));
    const modules = files.flatMap(file => imports(file.code));
    for (const path of [...files.map(file => file.path), ...modules]) {
      const privateItem = /(?:^|\/)_parts\/([^/]+)/.exec(path)?.[1];
      if (privateItem && slots.has(`components.${privateItem}`)) add("K12", fill.slot, `Private source path duplicates leaf ${privateItem}`, "CC4");
    }
    if (modules.some(module => FORBIDDEN.test(module))) add("K2", fill.slot, "A foreign headless or engine import is forbidden");
    if (observation.root !== contract.root) add("K2", fill.slot, `Observed root differs from ${contract.root}`);
    if (contract.root.startsWith("rac:") && (!observation.forwardsRef || !observation.forwardsRenderProps)) add("K2", fill.slot, "RAC implementations must forward refs and render props");
    for (const root of rootNames(contract.root)) if (!files.some(file => [...file.code.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']react-aria-components["']/g)].some(match => match[1]!.split(",").some(binding => binding.trim().split(/\s+as\s+/)[0] === root)))) add("K2", fill.slot, `Missing RAC root import ${root}`);
    if (files.some(file => /\b(?:import|require)\s*\(\s*[^"'\s]/.test(file.code))) add("K2", fill.slot, "Dynamic module resolution is unverified");
    const racImported = modules.includes(RAC_PACKAGE);
    for (const file of files) {
      const local = definedProperties(file.code);
      const properties = [...file.code.matchAll(/--[a-zA-Z][\w-]*/g)].map(match => match[0]).filter(property => !local.has(property) && !(racImported && Object.hasOwn(RAC_RUNTIME_PROPERTIES, property)));
      for (const property of properties) if (!Object.entries(input.tokens).some(([member, token]) => token.property === property && isRead(fill, member))) add("K4", fill.slot, `Unbound CSS property ${property} in ${file.path}`);
      if (/(?:#[\da-f]{3,8}\b|\b(?:rgb|hsl|oklch|oklab|lab|lch)a?\s*\(|\b\d*\.?\d+(?:px|rem|em|vh|vw|ch)\b)/i.test(file.code)) add("K4", fill.slot, `Literal colour or length in ${file.path}`);
      for (const utility of classUtilities(file.code)) {
        const binding = input.classBindings?.[utility];
        // A value-free utility is exempt only while the compiled CSS bound it to no token; a bound class is judged by its binding.
        if (!binding && VALUE_FREE_UTILITIES.some(pattern => pattern.test(utility))) continue;
        if (!binding || !input.tokens[binding] || !isRead(fill, binding)) add("K4", fill.slot, `Utility ${utility} has no bound consumer token`);
      }
      if (modules.some(module => FOREIGN_ICONS.test(module) || /\.svg(?:\?|$)/.test(module)) || GLYPHS.test(file.code)) add("K7", fill.slot, `Foreign icon import or text glyph in ${file.path}`);
      for (const match of file.code.matchAll(/<svg\b[^>]*>/g)) {
        const range = file.geometry?.find(range => range.start === match.index && range.end > range.start && range.end <= file.content.length && range.kind === "chart-data");
        const chartData = CHARTS.has(fill.slot) && contract.root === "engine:none" && range && /<\/svg>\s*$/.test(file.content.slice(range.start, range.end)) && !/\b(?:aria-hidden|role\s*=\s*["']img)/.test(match[0]);
        if (!chartData) add("K7", fill.slot, `Inline icon SVG in ${file.path}`);
      }
      for (const match of file.code.matchAll(/["'](assets\.icon-[a-z0-9-]+)["']/g)) if (!fill.reads.assets.includes(match[1]!)) add("K7", fill.slot, `Undeclared glyph ${match[1]}`);
    }
    if (fill.impl.kind === "source" && !ownedRule) {
      const pinnedFiles = observation.upstreamFiles ?? files;
      for (const pin of fill.pin?.files ?? []) { const file = pinnedFiles.find(file => file.path === pin.path); if (!file || sha256(file.content) !== pin.sha256) add("K8", fill.slot, `Pinned file ${pin.path} is absent or its hash differs`); }
      if (pinnedFiles.some(file => !fill.pin?.files?.some(pin => pin.path === file.path))) add("K8", fill.slot, "An inspected upstream source file has no pin");
      if (observation.upstreamFiles) {
        for (const file of files) if (observation.outputSha256?.filter(receipt => receipt.path === file.path && receipt.sha256 === sha256(file.content)).length !== 1) add("K8", fill.slot, `Rewritten output ${file.path} has no matching materialization hash`);
        if (observation.outputSha256?.some(receipt => !files.some(file => file.path === receipt.path))) add("K8", fill.slot, "Output receipt names an unobserved file");
      }
    }
    const { states, grounds } = matrix(contract);
    for (const state of states) for (const mode of ["light", "dark"] as const) for (const ground of grounds) {
      const matching = observation.measurements.filter(item => item.state === state && item.mode === mode && item.ground === ground);
      if (matching.length !== 1) { add("K10", fill.slot, `Expected one measurement for ${state}/${mode}/${ground}`); add("K5", fill.slot, `A11y measurement unavailable for ${state}/${mode}/${ground}`); add("K6", fill.slot, `Contrast measurement unavailable for ${state}/${mode}/${ground}`); continue; }
      const measurement = matching[0]!;
      const roots = rootNames(contract.root);
      const protocols = roots.map(root => ROOT_PROTOCOL[root]);
      // A disabled state proves its activation keys produce no activation (the key is not handled), rather than being observed.
      const noActivation = state === "disabled";
      if (measurement.axeViolations.length || protocols.some(protocol => protocol && (protocol.roles.some(role => !measurement.roles.includes(role)) || protocol.keys.some(key => noActivation && ACTIVATION_KEYS.includes(key) ? measurement.keyboard.includes(key) : !measurement.keyboard.includes(key)))) || protocols.some(protocol => !protocol)) add("K5", fill.slot, `Roles, keyboard or axe evidence fails for ${state}/${mode}/${ground}`);
      const interactive = protocols.some(protocol => !!protocol?.keys.length) || fill.slot === "components.resize-handle";
      const directFocus = measurement.focusTokens.length > 0 && measurement.focusTokens.every(member => /^tokens\.focus-/.test(member) && !!input.tokens[member] && isRead(fill, member));
      let delegatedFocus = false;
      if (ownedRule && /^rac:Date(?:Range)?Picker$/.test(contract.root) && measurement.focusOwner === "components.date-field" && measurement.focusTokens.length === 0 && fill.composes.includes(measurement.focusOwner)) {
        const owner = fills.get(measurement.focusOwner);
        const ownerCommon = input.observations[measurement.focusOwner];
        const ownerContract = slots.get(measurement.focusOwner)?.contract;
        const ownerRoot = ownerContract?.memberRoots?.[observedMember] ?? ownerContract?.root;
        const ownerObservation = ownerContract?.memberRoots ? ownerCommon?.memberObservations?.[observedMember] : ownerCommon;
        const ownerMeasurements = ownerObservation?.measurements.filter(item => item.state === state && item.mode === mode && item.ground === ground) ?? [];
        const call = observation.calls.some(call => call.target === measurement.focusOwner && call.contextRoot === ownerRoot);
        delegatedFocus = !!owner && !!ownerCommon && !!ownerObservation && call && ownerObservation.root === ownerRoot && ownerObservation.forwardsRef && ownerObservation.forwardsRenderProps &&
          ownerCommon.sourceHash === componentSourceHash(ownerCommon.files) && ownerCommon.tokensHash === tokenHash && ownerMeasurements.length === 1 &&
          ownerMeasurements[0]!.focusTokens.length > 0 && ownerMeasurements[0]!.focusTokens.every(member => /^tokens\.focus-/.test(member) && !!input.tokens[member] && isRead(owner, member));
      }
      const focus = measurement.focusOwner ? delegatedFocus : directFocus;
      if (interactive && !focus) add("K5", fill.slot, "Focus-visible indicator lacks bound focus tokens");
      if (!SYSTEM_COLORS.has(measurement.forcedColors.foreground) || !SYSTEM_COLORS.has(measurement.forcedColors.background) || measurement.forcedColors.foreground === measurement.forcedColors.background) add("K5", fill.slot, "Forced-colours evidence is missing or illegible");
      if (interactive && ![measurement.target.width, measurement.target.height].every(value => Number.isFinite(value) && value >= 24) && !fill.reads.tokens.includes("tokens.touch-target")) add("K5", fill.slot, "Target is below 24 by 24 CSS pixels without touch-target binding");
      if (!measurement.contrast.length) add("K6", fill.slot, `No contrast measurements for ${state}/${mode}/${ground}`);
      for (const pair of measurement.contrast) {
        const foreground = input.tokens[pair.foreground]; const background = input.tokens[pair.background];
        const minimum = pair.kind === "text" ? 4.5 : 3;
        try {
          if (!foreground || !background || !isRead(fill, pair.foreground) || !isRead(fill, pair.background)) throw new Error("unbound pair");
          const ratio = contrastRatio(mode === "dark" ? foreground.dark ?? foreground.light : foreground.light, mode === "dark" ? background.dark ?? background.light : background.light);
          if (!Number.isFinite(ratio) || ratio < minimum) throw new Error("insufficient contrast");
        } catch { add("K6", fill.slot, `Contrast ${pair.foreground} on ${pair.background} fails in ${state}/${mode}/${ground}`); }
      }
    }
    // CC3 applies to every fill, including presentational fills that compose RAC descendants.
    if (!fill.rac || !componentRacInstanceMatches(fill.rac.instance, input.installedRac.instance) || observation.rac.instance !== input.installedRac.instance || observation.rac.version !== input.installedRac.version || observation.rac.dependency === "bundled" || fill.impl.kind === "package" && (!fill.rac.peer || observation.rac.dependency !== "peer") || !componentRacRangeIncludes(fill.rac.range, input.installedRac.version)) add("K12", fill.slot, "RAC range, peer declaration or observed install differs from consumer singleton", "CC3");
    for (const target of fill.composes) if (!observation.calls.some(call => call.target === target)) add("K12", fill.slot, `No call-site observation for composed leaf ${target}`, "CC1");
    // Compare literal JSX call surfaces as well as the independently gathered
    // protocol observations. Unsupported spreads/dynamic members fail closed.
    for (const target of fill.composes) {
      const dependency = fills.get(target); if (!dependency || dependency.impl.kind === "composed") continue;
      const names = new Set([dependency.impl.export, ...observation.calls.filter(call => call.target === target).map(call => call.local).filter((name): name is string => !!name)]);
      const targetContract = slots.get(target)?.contract;
      const targetMembers = targetContract?.members.mode === "closed" ? targetContract.members.names : [];
      let seen = false;
      for (const file of files) for (const tag of file.code.matchAll(/<([A-Z][A-Za-z0-9]*)\b([^>]*)>/g)) {
        if (!names.has(tag[1]!)) continue;
        seen = true; const attributes = tag[2]!;
        if (/\{\s*\.\.\./.test(attributes)) add("K12", fill.slot, `Spread call surface to ${target} is unverified`, "CC1");
        for (const attribute of attributes.matchAll(/\b([A-Za-z][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^}]*)\})/g)) {
          const prop = attribute[1]!; const dimension = targetMembers.some(member => member.startsWith(`${prop}.`));
          const value = attribute[2] ?? attribute[3] ?? (/^\s*["']([^"']*)["']\s*$/.exec(attribute[4] ?? "")?.[1]);
          if (dimension) {
            const member = value === undefined ? undefined : `${prop}.${value}`;
            if (!member || !dependency.members.includes(member) || !(member in dependency.propMap)) add("K12", fill.slot, `Static call to ${target} passes unsupported ${prop}=${value ?? "dynamic"}`, "CC1");
          } else if (!dependency.props.includes(prop)) add("K12", fill.slot, `Static call to ${target} passes unsupported prop ${prop}`, "CC1");
        }
      }
      if (!seen) add("K12", fill.slot, `No inspectable JSX call to composed leaf ${target}`, "CC1");
    }
    for (const call of observation.calls) {
      const dependency = fills.get(call.target);
      if (!fill.composes.includes(call.target) || !dependency) { add("K12", fill.slot, `Call to undeclared or unresolved component ${call.target}`, "CC1"); continue; }
      if (call.props.some(prop => !dependency.props.includes(prop)) || call.members.some(member => !dependency.members.includes(member) || !(member in dependency.propMap))) add("K12", fill.slot, `Dependent ${call.target} does not cover passed props or members`, "CC1");
      const childCommon = input.observations[call.target];
      const childContract = slots.get(call.target)?.contract;
      const childMember = observedMember && childContract?.memberRoots?.[observedMember] ? observedMember : undefined;
      const child = childMember ? childCommon?.memberObservations?.[childMember] : childCommon;
      const childRoot = childMember ? childContract?.memberRoots?.[childMember] : childContract?.root;
      const inferredRoot = ((contract.root === "rac:Select" || contract.root === "rac:ComboBox") && call.target === "components.button" ? "rac:Button" : /^rac:Date(?:Range)?Picker$/.test(contract.root) && ["components.date-field", "components.popover", "components.calendar"].includes(call.target) ? childRoot : undefined);
      const contextualRoot = inferredRoot ?? call.contextRoot;
      if (inferredRoot && call.contextRoot && inferredRoot !== call.contextRoot) add("K12", fill.slot, `Context observation for ${call.target} contradicts ${inferredRoot}`, "CC2");
      if (contextualRoot && (dependency.root !== childContract?.root || child?.root !== contextualRoot || !child.forwardsRef || !child.forwardsRenderProps)) add("K12", fill.slot, `Dependent ${call.target} breaks RAC context root/ref/render props`, "CC2");
    }
    }
  }
  const visited = new Set<string>(); const active = new Set<string>();
  const walk = (slot: string, trail: string[]): void => {
    if (active.has(slot)) { const cycle = [...trail.slice(trail.indexOf(slot)), slot].join(" -> "); add("K3", slot, `Component cycle ${cycle}`); add("K12", slot, `Component cycle ${cycle}`, "CC5"); return; }
    if (visited.has(slot)) return;
    active.add(slot); for (const target of [...new Set([...(fills.get(slot)?.composes ?? []), ...(fills.get(slot)?.reads.components ?? [])])].sort()) if (fills.has(target)) walk(target, [...trail, slot]); active.delete(slot); visited.add(slot);
  };
  for (const slot of [...fills.keys()].sort()) walk(slot, []);
  for (const group of [...DEFAULT_COHERENCE_GROUPS, ...(input.coherenceGroups ?? [])]) {
    const members = group.slots.map(slot => fills.get(slot)).filter((fill): fill is ComponentCheckFill => !!fill);
    if (new Set(members.map(fill => fill.source)).size < 2) continue;
    if (group.kind === "charts") { add("K11", group.id, "Chart coherence group must have one source"); continue; }
    if (group.kind !== "controls") continue;
    // A member that renders no label of its own binds no label type; only members that bind label type are compared.
    const labelLeaves = members.map(fill => readLeaves(fill).filter(read => /(?:body-size|caption-size|typeface|font-size)$/.test(read)).sort().join(",")).filter(leaves => leaves !== "");
    if (new Set(labelLeaves).size > 1) add("K11", group.id, "Mixed controls bind labels to different type leaves");
    for (const fill of members) {
      const observation = input.observations[fill.slot];
      const leaves = readLeaves(fill);
      const parity = "Mixed controls lack joint control-size/focus/type geometry parity";
      // Descriptor reads and real K4 errors refuse statically; geometry and focus measurements need observations.
      if (!leaves.includes("tokens.control-size") || !leaves.some(read => /^tokens\.focus-/.test(read)) || findings.some(finding => finding.subject === fill.slot && finding.code === "K4" && finding.severity === "error")) { add("K11", fill.slot, parity); continue; }
      if (!observation?.files.length) { findings.push({ code: "K11", rule: "K11", subject: fill.slot, severity: "notice", message: `Mixed controls geometry parity: ${OBSERVATIONS_UNAVAILABLE}` }); continue; }
      if (!observation.measurements.length || fill.members.filter(member => member.startsWith("size.")).some(member => { const token = observation.geometry?.[member]; return !token || !token.startsWith("tokens.control-size.") || !input.tokens[token]; }) || observation.measurements.some(measurement => measurement.focusTokens.some(member => !/^tokens\.focus-/.test(member))) || findings.some(finding => finding.subject === fill.slot && finding.code === "K4")) add("K11", fill.slot, parity);
    }
  }
  const unique = new Map(findings.map(finding => [stableStringify(finding), finding]));
  const sorted = [...unique.values()].sort((a, b) => a.code.localeCompare(b.code) || a.subject.localeCompare(b.subject) || a.message.localeCompare(b.message));
  return { ok: !sorted.some(finding => finding.severity === "error"), findings: sorted };
}
