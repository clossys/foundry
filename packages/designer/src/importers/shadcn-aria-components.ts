import adapter from "../catalog/adapters/shadcn@aria.json" with { type: "json" };
import componentSlots from "../catalog/slots/components.json" with { type: "json" };
import datePickerRule from "../catalog/rules/components.date-picker.json" with { type: "json" };
import fileTriggerRule from "../catalog/rules/components.file-trigger.json" with { type: "json" };
import type { ComponentCheckFill } from "../catalog-core/check-components.js";
import type { ComponentSlot, FillMeta } from "../catalog-core/types.js";
import { sha256 } from "../catalog-core/digest.js";
import { componentMemberBinding } from "../catalog-core/emit-components.js";
import type { ComponentCandidate, ResolvedComponent } from "../catalog-core/resolve-components.js";
import { stableStringify } from "../catalog-core/stable.js";
import { componentRacDeclaration } from "./component-rac.js";
import { rewriteShadcnAria, SHADCN_BUTTON_MEMBERS, type RewriteIssue, type RewriteNote, type RewriteResult, type SourceFile } from "./rewrite.js";
import { normalizeSelectedSource } from "./normalize-selected-source.js";
import { selectedCaptionSource, selectedCaptionMembers } from "./selected-caption-profile.js";
import { dialogExecutableSource, dialogExecutableMembers } from "./dialog-executable-profile.js";
import { menuExecutableSource, menuExecutableMembers } from "./menu-executable-profile.js";
import { toggleExecutableSource } from "./toggle-executable-profile.js";

export const SHADCN_ARIA_COMPONENT_PIN = Object.freeze({ url: adapter.pin.url, commit: adapter.pin.commit, base: "aria", style: "nova" });
const SOURCE = "shadcn@aria";
const ROOT = "apps/v4/registry/bases/aria/ui/";
const STYLE = "apps/v4/registry/styles/style-nova.css";
export interface ShadcnRegistryItem {
  name: string; commit: string; license: string;
  files: readonly SourceFile[]; missing?: number;
}
export interface ShadcnComponentInput {
  items: readonly ShadcnRegistryItem[]; styles: SourceFile; notice: SourceFile;
  slots?: readonly ComponentSlot[];
}
export interface ShadcnItemReceipt {
  item: string; slot: string;
  /** U-V means the pinned source imports the RAC root, not runtime conformance. */
  runtime: "U-V" | "X"; status: "candidate" | "rejected" | "alternate";
  reason: string; issues: readonly RewriteIssue[]; notes?: readonly RewriteNote[];
}
export interface ShadcnComponentFillDoc {
  $extensions: { "com.clossys.fill": FillMeta };
  components: Readonly<Record<string, ComponentCheckFill & {
    transform: "shadcn-aria-rewrite@1"; item: string;
    secondaryExports?: ComponentCandidate["secondaryExports"];
    outputSha256: RewriteResult["outputSha256"];
    blockers: readonly RewriteIssue[];
  }>>;
}
export interface ShadcnComponentImport {
  fills: readonly ShadcnComponentFillDoc[]; receipt: readonly ShadcnItemReceipt[];
  rewrites: Readonly<Record<string, RewriteResult>>;
  compose: readonly ShadcnComposeReceipt[];
  /** Registered-composition templates for leaves whose every constituent is shadcn@aria. */
  composed: readonly ShadcnComposedFillDoc[];
}
export interface ShadcnComposedFillDoc {
  $extensions: { "com.clossys.fill": FillMeta & { originKinds: readonly ["composed"] } };
  components: Readonly<Record<string, ComponentCheckFill>>;
}
interface RegisteredComposeRule { id: string; kind: string; slot: string; inputs: readonly string[]; files: readonly SourceFile[] }
/** Owned wiring for a composed leaf; the rule file under catalog/rules carries its bytes. Single-axis members are served by the bare root export (pointer-only, no dispatch). */
const SHADCN_COMPOSED_TEMPLATES: Readonly<Record<string, { rule: RegisteredComposeRule; export: string; members: Readonly<Record<string, string>>; props: readonly string[] }>> = {
  "file-trigger": { rule: fileTriggerRule, export: "FileTrigger", members: { accept: "FileTrigger", directory: "FileTrigger", multiple: "FileTrigger" }, props: ["label", "acceptedFileTypes", "allowsMultiple", "acceptDirectory", "defaultCamera", "onSelect"] },
};
function composedTemplate(row: ShadcnComposeReceipt, slot: ComponentSlot): ShadcnComposedFillDoc | undefined {
  const template = SHADCN_COMPOSED_TEMPLATES[row.leaf];
  if (!template || row.status !== "composed") return;
  const { rule } = template, inputs = row.constituents.map(leaf => `components.${leaf}`);
  if (rule.kind !== "compose" || rule.slot !== row.slot || stableStringify([...rule.inputs].sort()) !== stableStringify([...inputs].sort())) throw new Error(`shadcn-compose: registered rule for ${row.leaf} differs from its compose rule`);
  const members = Object.keys(template.members).sort();
  return {
    $extensions: { "com.clossys.fill": { author: "foundry", builtOn: inputs, conforms: [], evidence: [], id: `${SOURCE}/${row.slot}`, license: "MIT", mode: "implementation", originKinds: ["composed"], relation: "same-contract", slot: row.slot, source: SOURCE, sourceAddress: `rules/components.${row.leaf}.json#${rule.id}`, status: "draft", trust: "foundry" } as FillMeta & { originKinds: readonly ["composed"] } },
    components: { [row.leaf]: {
      slot: row.slot, source: SOURCE, root: slot.contract.root, members, props: [...template.props], propMap: Object.fromEntries(members.map(member => [member, template.members[member]!])),
      reads: { tokens: [], assets: [], components: inputs }, composes: inputs,
      impl: { kind: "source", entry: `components/${row.leaf}/${row.leaf}.tsx`, export: template.export }, license: "MIT", notice: `notices/${row.leaf}.md`,
      deps: [{ name: "react", version: ">=18", license: "MIT" }, { name: "react-aria-components", version: "^1.19.0", license: "Apache-2.0" }],
      outputSha256: rule.files.map(file => ({ path: file.path, sha256: sha256(file.content) })).sort((a, b) => a.path.localeCompare(b.path)),
      rac: componentRacDeclaration({ impl: { kind: "source" }, deps: [{ name: "react-aria-components", version: "^1.19.0", license: "Apache-2.0" }] }, { peer: false }),
    } as ComponentCheckFill },
  };
}
/**
 * A compose rule builds one leaf from registered constituent leaves instead of
 * one upstream item. It names direct constituents only; a constituent may itself
 * be composed from plain leaves (one level of nesting), never deeper, never cyclic.
 * `blocker` records why the rule cannot ship without new styling or a failing
 * K1/K2 check; such a leaf stays on its Foundry gap seat.
 */
/** `items`: pinned shadcn@aria registry items (D1 amendment) the leaf's own RAC root would wrap; they never nest. */
export interface ShadcnComposeRule { readonly leaf: string; readonly constituents: readonly string[]; readonly items?: readonly string[]; readonly blocker?: string }
export interface ShadcnComposeReceipt {
  leaf: string; slot: string; constituents: readonly string[]; items: readonly string[];
  /** Composed levels nested under this leaf: 0 = all constituents plain, 1 = a constituent is itself composed. */
  depth: number;
  source: string; status: "composed" | "gap"; reason: string;
}
export const SHADCN_COMPOSE_MAX_DEPTH = 1;
/** Registry items a composition may wrap, by planner decision D1 (amended). */
export const SHADCN_COMPOSE_ITEMS: readonly string[] = ["input", "label", "field", "input-group", "spinner", "button-group"];
/** The registered date-picker composition is the model; its inputs are read, never restated. */
const registeredDatePicker = datePickerRule.inputs.map(input => input.replace(/^components\./, ""));
export const SHADCN_COMPOSE_RULES: readonly ShadcnComposeRule[] = [
  { leaf: "date-picker", constituents: registeredDatePicker },
  { leaf: "date-field", constituents: ["field"], items: ["input-group"], blocker: "new styling: pinned input and input-group render RAC Input, not DateInput/DateSegment; segment, placeholder and focus styling would be new" },
  { leaf: "field", constituents: [], items: ["label", "field"], blocker: "K1: state.required/invalid/disabled have no owner, since a Label+Text+FieldError root takes them only from a parent field context; and K2: pinned field.tsx renders description and error as p/div, so a RAC Text/FieldError wrap needs new structure" },
  { leaf: "text-field", constituents: [], items: ["label", "input"], blocker: "K1: size.sm/md/lg unmapped; the RAC TextField wrap maps line and state, but pinned label and input carry one control size and textarea is not a D1 item" },
  { leaf: "search-field", constituents: ["button"], items: ["input-group", "input"], blocker: "K1: state.empty/state.filled have no pointer; RAC data-empty is render state, and the propMap grammar admits only exports, props, values and hovered/pressed/focus-visible" },
  { leaf: "form", constituents: [], blocker: "K2: form is absent at the pinned commit (no files), and no D1 item supplies a form; the RAC Form root alone is the Foundry seat" },
  { leaf: "file-trigger", constituents: ["button"] },
  { leaf: "spinner", constituents: [], items: ["spinner"], blocker: "K1: size.sm/md/lg unmapped; the RAC ProgressBar wrap holds role and value, but pinned spinner is one size-4 IconPlaceholder svg, so sizes and the spin glyph binding would be new" },
  { leaf: "toolbar", constituents: [], blocker: "new styling: button-group is not pinned at the commit, so no D1 item supplies the group; a bare RAC Toolbar needs new orientation layout styling" },
];

/** Resolve compose rules against registered leaves and the sources that fill them. */
export function resolveShadcnComposeRules(rules: readonly ShadcnComposeRule[], input: { slots: ReadonlySet<string>; sources: ReadonlyMap<string, string>; items?: ReadonlySet<string> }): ShadcnComposeReceipt[] {
  const byLeaf = new Map<string, ShadcnComposeRule>();
  for (const rule of rules) {
    if (byLeaf.has(rule.leaf)) throw new Error(`shadcn-compose: duplicate rule ${rule.leaf}`);
    if (!input.slots.has(`components.${rule.leaf}`)) throw new Error(`shadcn-compose: ${rule.leaf} is not a registered leaf`);
    if (new Set(rule.constituents).size !== rule.constituents.length || rule.constituents.includes(rule.leaf)) throw new Error(`shadcn-compose: ${rule.leaf} constituents repeat or name the leaf itself`);
    for (const constituent of rule.constituents) if (!input.slots.has(`components.${constituent}`)) throw new Error(`shadcn-compose: ${rule.leaf} constituent ${constituent} is not a registered leaf`);
    const items = rule.items ?? [];
    if (new Set(items).size !== items.length) throw new Error(`shadcn-compose: ${rule.leaf} items repeat`);
    for (const item of items) {
      if (!SHADCN_COMPOSE_ITEMS.includes(item)) throw new Error(`shadcn-compose: ${rule.leaf} item ${item} is not a D1 registry item`);
      if (!input.items?.has(item)) throw new Error(`shadcn-compose: ${rule.leaf} item ${item} is not pinned`);
    }
    if (!rule.constituents.length && !items.length && !rule.blocker) throw new Error(`shadcn-compose: ${rule.leaf} composes nothing`);
    byLeaf.set(rule.leaf, rule);
  }
  // Cycles are refused over every rule edge; nesting counts only shippable
  // compositions, because a blocked rule leaves a plain Foundry seat behind.
  const visited = new Set<string>(), active: string[] = [];
  const walk = (leaf: string): void => {
    if (active.includes(leaf)) throw new Error(`shadcn-compose: cycle ${[...active.slice(active.indexOf(leaf)), leaf].join(" -> ")}`);
    if (visited.has(leaf) || !byLeaf.has(leaf)) return;
    active.push(leaf); for (const constituent of byLeaf.get(leaf)!.constituents) walk(constituent); active.pop(); visited.add(leaf);
  };
  for (const rule of rules) walk(rule.leaf);
  const composes = (leaf: string): boolean => !!byLeaf.get(leaf) && !byLeaf.get(leaf)!.blocker;
  const depths = new Map<string, number>();
  const depth = (leaf: string): number => {
    const known = depths.get(leaf); if (known !== undefined) return known;
    const value = Math.max(0, ...byLeaf.get(leaf)!.constituents.filter(composes).map(constituent => 1 + depth(constituent)));
    if (value > SHADCN_COMPOSE_MAX_DEPTH) throw new Error(`shadcn-compose: ${leaf} nests compositions ${value} levels deep; at most ${SHADCN_COMPOSE_MAX_DEPTH} is allowed`);
    depths.set(leaf, value); return value;
  };
  const resolved = new Map<string, ShadcnComposeReceipt>();
  const resolve = (leaf: string): ShadcnComposeReceipt => {
    const known = resolved.get(leaf); if (known) return known;
    const rule = byLeaf.get(leaf)!;
    const levels = depth(leaf);
    const sourceOf = (constituent: string): string => byLeaf.has(constituent) ? resolve(constituent).source : input.sources.get(`components.${constituent}`) ?? "foundry";
    const foreign = rule.constituents.filter(constituent => sourceOf(constituent) !== SOURCE);
    const reason = rule.blocker ?? (foreign.length ? `constituent ${foreign.map(constituent => `components.${constituent}=${sourceOf(constituent)}`).join(", ")} is not ${SOURCE}` : `every constituent is ${SOURCE}; no new styling`);
    const composed = !rule.blocker && !foreign.length;
    const row: ShadcnComposeReceipt = { leaf, slot: `components.${leaf}`, constituents: [...rule.constituents], items: [...rule.items ?? []], depth: levels, source: composed ? SOURCE : "foundry", status: composed ? "composed" : "gap", reason };
    resolved.set(leaf, row); return row;
  };
  return rules.map(rule => resolve(rule.leaf));
}
/** Explicit item aliases avoid deriving a contract from a registry item's name. */
export const SHADCN_COMPONENT_ITEMS: Readonly<Record<string, string>> = {
  button: "button", toggle: "toggle-button", "dropdown-menu": "menu", "context-menu": "menu", form: "form",
  input: "text-field", textarea: "text-field", checkbox: "checkbox", "radio-group": "radio-group", switch: "switch",
  select: "select", combobox: "combo-box", "toggle-group": "toggle-group", slider: "slider", calendar: "calendar", table: "table",
  badge: "badge", kbd: "keyboard", alert: "banner", progress: "progress-bar", spinner: "spinner", skeleton: "skeleton",
  breadcrumb: "breadcrumbs", separator: "separator", tabs: "tabs", avatar: "avatar", card: "card",
  accordion: "disclosure", collapsible: "disclosure", dialog: "dialog", "alert-dialog": "dialog", popover: "popover",
  "hover-card": "popover", tooltip: "tooltip", field: "field", label: "field", sidebar: "navigation-tree",
  sonner: "toast", resizable: "resize-handle",
};
const forbidden_MODULES = ["@radix-ui/", "radix-ui", "@base-ui/", "@tanstack/", "@headlessui/", "sonner", "react-resizable-panels", "embla-carousel-react", "input-otp", "recharts"];
const forbidden = new RegExp("^(?:" + forbidden_MODULES.map(module => module.endsWith("/") ? module : `${module}(?:/|$)`).join("|") + ")");
const modules = (code: string): string[] => [...code.matchAll(/(?:\bfrom\s*|\bimport\s*|\brequire\s*\(\s*)["']([^"']+)["']/g)].map(match => match[1]!);
const imports = (code: string): string[] => [...code.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']react-aria-components["']/g)].flatMap(match => match[1]!.split(",").map(binding => binding.trim()).filter(binding => binding && !binding.startsWith("type ")).map(binding => binding.split(/\s+as\s+/)[0]!));
const dependencies = (code: string): string[] => [...code.matchAll(/from\s*["']@\/(?:components\/ui|registry\/bases\/aria\/ui)\/([a-z][a-z0-9-]*)["']/g)].map(match => match[1]!);
const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort();
const expected = new Map(adapter.pin.files.map(file => [file.path, file.sha256]));

/** Validate exact upstream bytes before a parser or transform sees them. */
export function verifyShadcnSource(file: SourceFile): void {
  if (!expected.has(file.path) || sha256(file.content) !== expected.get(file.path)) throw new Error(`shadcn-components: pinned sha256 mismatch for ${file.path}`);
}

function runtimeFailure(item: ShadcnRegistryItem, slot: ComponentSlot): string | undefined {
  if (item.missing || !item.files.length) return "K2: item is absent at the pinned commit";
  const code = item.files.map(file => file.content.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "")).join("\n");
  if (modules(code).some(module => forbidden.test(module))) return "K2: foreign headless or engine import";
  if (/\b(?:import|require)\s*\(/.test(code)) return "K2: dynamic module resolution is unverified";
  const roots = imports(code);
  if (slot.contract.root.startsWith("rac:")) {
    const missing = slot.contract.root.slice(4).split("+").filter(root => !roots.includes(root));
    if (missing.length) return `K2: missing RAC root ${missing.join("+")}`;
  } else if (modules(code).some(module => module !== "react-aria-components" && /(?:radix|base-ui|headless|sonner|recharts|resizable)/.test(module))) return "K2: presentational item imports a foreign engine";
  return;
}

/**
 * Only members directly evidenced by pinned source surfaces are mapped, and only as emitter
 * pointers (`Export`, `Export.prop[=value]`, or `Export[data-state]` for an intrinsic state).
 * Evidence without such a pointer leaves the member unmapped; it is never written as prose.
 */
function memberMap(item: string, code: string, slot: ComponentSlot, own: string): Record<string, string> {
  const map: Record<string, string> = {};
  const add = (member: string, pointer: string): void => { if (slot.contract.members.mode === "closed" && slot.contract.members.names.includes(member)) map[member] = pointer; };
  if (item === "button") {
    // One table both maps these members and translates the literals a rebinding source passes (rewrite.ts).
    for (const [value, member] of Object.entries(SHADCN_BUTTON_MEMBERS.variant)) if (new RegExp(`\\b${value}:`).test(code)) add(`variant.${member}`, `Button.variant=${value}`);
    for (const [value, member] of Object.entries(SHADCN_BUTTON_MEMBERS.size)) if (new RegExp(`\\b${value}:`).test(code)) add(`size.${member}`, `Button.size=${value}`);
    add("shape.text", "Button"); if (new RegExp(`\\b${SHADCN_BUTTON_MEMBERS.iconSize}:`).test(code)) add("shape.icon-only", `Button.size=${SHADCN_BUTTON_MEMBERS.iconSize}`);
    add("ground.base", "Button");
  }
  // Forwarded RAC props retain the pinned root's public state/orientation API.
  const forwardsProps = /\{\.\.\.props\}/.test(code);
  if (item === "checkbox" && /CheckboxProps/.test(code) && forwardsProps) {
    add("scope.single", "Checkbox");
    if (/isSelected/.test(code)) add("state.checked", "Checkbox.isSelected");
    if (/isIndeterminate/.test(code)) add("state.indeterminate", "Checkbox.isIndeterminate");
  }
  if (item === "radio-group" && /RadioGroupProps/.test(code) && forwardsProps) {
    for (const orientation of ["horizontal", "vertical"]) add(`orientation.${orientation}`, `RadioGroup.orientation=${orientation}`);
  }
  if (item === "switch" && /SwitchProps/.test(code) && forwardsProps && /isSelected/.test(code)) {
    add("state.on", "Switch.isSelected=true");
    add("state.off", "Switch.isSelected=false");
  }
  if (item === "slider" && /SliderPrimitiveProps<T>/.test(code) && forwardsProps) {
    // Arity follows the value (number or number[]): the root itself serves both selections.
    if (/type SliderValue = number \| number\[\]/.test(code) && /state\.values\.map/.test(code)) { add("selection.single", "Slider"); add("selection.range", "Slider"); }
    for (const orientation of ["horizontal", "vertical"]) if (code.includes(`data-${orientation}`)) add(`orientation.${orientation}`, `Slider.orientation=${orientation}`);
  }
  if (item === "toggle" && /ToggleButtonProps/.test(code) && forwardsProps) {
    for (const [member, value] of Object.entries({ sm: "sm", md: "default", lg: "lg" })) if (new RegExp(`cn-toggle-size-${value}\\b`).test(code)) add(`size.${member}`, `Toggle.size=${value}`);
    if (/cn-toggle-variant-default/.test(code) && /bg-transparent/.test(code)) add("variant.ghost", "Toggle.variant=default");
    if (/cn-toggle-variant-outline/.test(code)) add("variant.outline", "Toggle.variant=outline");
    if (/data-selected:/.test(code)) add("state.selected", "Toggle.isSelected");
  }
  if (item === "toggle-group" && /ToggleButtonGroupProps/.test(code) && forwardsProps) {
    for (const selection of ["single", "multiple"]) add(`selection.${selection}`, `ToggleGroup.selectionMode=${selection}`);
    for (const orientation of ["horizontal", "vertical"]) if (code.includes(`"${orientation}"`)) add(`orientation.${orientation}`, `ToggleGroup.orientation=${orientation}`);
  }
  if (item === "select") {
    for (const [member, pointer] of Object.entries(selectedCaptionMembers)) add(member, pointer);
  }
  // Capability members the root forwards to its RAC primitive point at the root export itself.
  if (item === "combobox" && /ComboBox as ComboBoxPrimitive/.test(code) && /ComboBoxPrimitive as Combobox/.test(code)) add("allows-custom", "Combobox");
  if (item === "dialog") {
    for (const [member, pointer] of Object.entries(dialogExecutableMembers)) add(member, pointer);
  }
  if ((item === "popover" || item === "tooltip") && /placement = /.test(code) && /placement=\{placement\}/.test(code)) add("placement", item === "popover" ? "Popover" : "Tooltip");
  if (item === "dropdown-menu") {
    for (const [member, pointer] of Object.entries(menuExecutableMembers)) add(member, pointer);
  }
  if (item === "avatar" && /data-size=\{size\}/.test(code)) {
    for (const [member, value] of Object.entries({ sm: "sm", md: "default", lg: "lg" })) if (code.includes(`"${value}"`) && code.includes(`size=${value}`)) add(`size.${member}`, `Avatar.size=${value}`);
    // AvatarImage and AvatarFallback are children the Avatar root composes, not alternate roots.
    if (/<img\b/.test(code) && /data-slot="avatar-image"/.test(code)) add("content.image", "Avatar");
    if (/function AvatarFallback/.test(code) && /data-slot="avatar-fallback"/.test(code) && forwardsProps) add("content.initials", "Avatar");
  }
  if (item === "breadcrumb") {
    if (/isCurrent/.test(code) && /aria-current="page"/.test(code)) add("current", "Breadcrumb");
    if (/function BreadcrumbEllipsis/.test(code) && /data-slot="breadcrumb-ellipsis"/.test(code)) add("collapsed", "Breadcrumb");
  }
  if (item === "tabs" && /React.ComponentProps<typeof TabsPrimitive>/.test(code) && forwardsProps) {
    for (const orientation of ["horizontal", "vertical"]) if (code.includes(`data-${orientation}`)) add(`orientation.${orientation}`, `Tabs.orientation=${orientation}`);
  }
  if (item === "separator" && /orientation=\{orientation\}/.test(code)) {
    for (const orientation of ["horizontal", "vertical"]) if (code.includes(`orientation=${orientation}`)) add(`orientation.${orientation}`, `Separator.orientation=${orientation}`);
  }
  if (item === "kbd" && /Keyboard as KbdPrimitive/.test(code) && forwardsProps) {
    if (/data-slot="kbd"/.test(code)) add("scope.single", "Kbd");
    if (/data-slot="kbd-group"/.test(code)) add("scope.chord", "KbdGroup");
  }
  if (item === "badge") {
    for (const [member, value] of Object.entries({ neutral: "secondary", danger: "destructive" })) if (new RegExp(`\\b${value}: "cn-badge-variant-${value}"`).test(code)) add(`tone.${member}`, `Badge.variant=${value}`);
  }
  if (item === "alert") {
    for (const [member, value] of Object.entries({ info: "default", danger: "destructive" })) if (new RegExp(`\\b${value}: "cn-alert-variant-${value}"`).test(code)) add(`tone.${member}`, `Alert.variant=${value}`);
  }
  if (item === "progress" && /ProgressBar as ProgressPrimitive/.test(code) && forwardsProps) {
    if (/percentage/.test(code)) add("progress.determinate", "Progress.isIndeterminate=false");
    if (/isIndeterminate/.test(code)) add("progress.indeterminate", "Progress.isIndeterminate=true");
  }
  if (item === "skeleton" && /data-slot="skeleton"/.test(code)) add("shape.block", "Skeleton");
  if (item === "table" && /type TableProps/.test(code) && /type ColumnProps/.test(code) && forwardsProps) { add("selection", "Table"); add("sort", "Table"); }
  if (item === "calendar") { add("selection.single", "Calendar"); if (/RangeCalendar/.test(code)) add("selection.range", "RangeCalendar"); }
  if (item === "accordion" || item === "collapsible") add(item === "accordion" ? "scope.group" : "scope.single", item === "accordion" ? "Accordion" : "Collapsible");
  if (/isDisabled|disabled:/.test(code)) add("state.disabled", `${own}.isDisabled`);
  if (item !== "select" && /aria-invalid|isInvalid/.test(code)) add("state.invalid", `${own}.isInvalid`);
  if (/focus-visible:/.test(code)) add("state.focus-visible", `${own}[data-focus-visible]`);
  if (/hover:/.test(code)) add("state.hover", `${own}[data-hovered]`);
  return Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)));
}
/**
 * The persist emitter's own parser checks every pointer, so a fill that passes plan/check cannot
 * fail at persist on its propMap. A single-axis member is served only by the bare root export
 * (the emitter dispatches nothing for it); anything else has no pointer and stays unmapped.
 */
function emittablePropMap(slot: string, impl: { kind: "source"; entry: string; export: string }, map: Readonly<Record<string, string>>): Record<string, string> {
  const component = { slot, impl, descriptor: { slot, impl } } as unknown as ResolvedComponent;
  const bindings = Object.entries(map).map(([member, pointer]) => [member, componentMemberBinding(component, member, pointer)] as const);
  const root = (binding: (typeof bindings)[number][1]) => binding.name === impl.export && !("property" in binding);
  return Object.fromEntries(bindings.filter(([member, binding]) => "intrinsic" in binding || root(binding) || /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/.test(member)).map(([member]) => [member, map[member]!]));
}
const exportNames: Record<string, string> = { toggle: "Toggle", "dropdown-menu": "DropdownMenu", "context-menu": "ContextMenu", combobox: "Combobox", kbd: "Kbd", alert: "Alert", progress: "Progress", breadcrumb: "Breadcrumb", accordion: "Accordion", collapsible: "Collapsible", "alert-dialog": "AlertDialog", "hover-card": "HoverCard", "radio-group": "RadioGroup", "toggle-group": "ToggleGroup" };
/**
 * Approved same-entry secondary exports, by caller checkpoint. Each name is a local function value of the
 * item's own authenticated entry (proved again by componentSecondaryExports at resolve/emit); nothing else
 * in an entry's export list becomes public. Select: the five Calendar-caption parts (API-S1).
 */
const secondaryExportApprovals: Readonly<Record<string, readonly { name: string; export: string }[]>> = {
  select: ["SelectContent", "SelectGroup", "SelectItem", "SelectTrigger", "SelectValue"].map(name => ({ name, export: name })),
};
const partExports: Readonly<Record<string, readonly string[]>> = { "input-group": ["InputGroup", "InputGroupAddon", "InputGroupButton", "InputGroupText", "InputGroupInput", "InputGroupTextarea"] };
const utils = 'import { clsx, type ClassValue } from "clsx"\nimport { twMerge } from "tailwind-merge"\nexport function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)) }\n';
const npmDeps = [
  { name: "react", version: "19.2.3", license: "MIT" },
  { name: "react-aria-components", version: "1.20.0", license: "Apache-2.0" },
  { name: "class-variance-authority", version: "0.7.1", license: "Apache-2.0" },
  { name: "clsx", version: "2.1.1", license: "MIT" },
  { name: "tailwind-merge", version: "3.3.1", license: "MIT" },
];

/** Calendar-specific adaptation; selected child exports are never synthesized here. */
function calendarContextSource(source: string): string {
  let code = source.replace('import { Button, buttonVariants }', 'import { Button }')
    .replace(/^[ \t]*buttonVariants\(\{ variant: "ghost", size: "icon" \}\),\n/m, "");
  for (const [name, generic, root, inner] of [
    ["Calendar", 'T extends DateValue, M extends "single" | "multiple" = "single"', "AriaCalendar", "<CalendarInner {...props} />"],
    ["RangeCalendar", "T extends DateValue", "AriaRangeCalendar", "<CalendarInner {...props} isRange />"],
  ] as const) {
    const start = code.indexOf(`function ${name}<`);
    const body = code.indexOf(") {\n  return (", start);
    const typeStart = code.indexOf("props: ", start) + 7;
    const propsType = code.slice(typeStart, body).trim();
    if (start < 0 || body < 0 || !propsType) throw new Error("shadcn-components: calendar root protocol source changed");
    const end = code.indexOf("\n}\n", body) + 3;
    let implementation = code.slice(body + 3, end - 2);
    implementation = implementation.replace(`    <${root}\n`, `    <${root}\n      ref={ref}\n`)
      .replace('className={cn(', 'className={state => cn(')
      .replace('        props.className', '        typeof props.className === "function" ? props.className(state) : props.className')
      .replace(inner, `{state => typeof props.children === "function" ? props.children({ ...state, defaultChildren: ${inner} }) : props.children ?? ${inner}}`);
    const typeName = `Consumer${name}Props`;
    const params = name === "Calendar" ? "T, M" : "T";
    const replacement = `type ${typeName}<${generic}> = ${propsType};\nconst ${name} = React.forwardRef(function ${name}<${generic}>(\n  props: ${typeName}<${params}>, ref: React.Ref<HTMLDivElement>,\n) {${implementation}\n}) as <${generic}>(props: ${typeName}<${params}> & React.RefAttributes<HTMLDivElement>) => React.ReactElement;`;
    code = code.slice(0, start) + replacement + code.slice(end);
  }
  return code;
}

/** Pure import: pinned input is caller-supplied; no registry calls or runtime claims. */
/**
 * Applied after every normalized-source receipt. The emitter owns each `components/<leaf>/index.ts`
 * and exports only the leaf's contract name from it, whichever source fills that leaf. An import of
 * that name alone stays on the entrypoint, so it composes with any source. An import that also needs
 * a sub-part binds the sibling's own module (`components/<leaf>/<item>.tsx`), which exists only when
 * this source fills that leaf; otherwise the emitter refuses it as missing. The asset Icon adapter is
 * a contract-only import. A leaf filled by several items is left unbound for the caller to refuse.
 */
export function bindSiblingLeafModules(content: string, leafByItem: Readonly<Record<string, string>>): { content: string; ambiguous: string[] } {
  const ambiguous: string[] = [];
  const bound = content.replace(/(\bimport\s+(?:type\s+)?\{([^}]*)\}\s*from\s*")((?:\.\.\/)+)([a-z][a-z0-9-]*)\/index(")/g, (all, before: string, list: string, up: string, leaf: string, after: string) => {
    // The emitter's contract name for components.<leaf>.
    const contract = leaf.split("-").map(word => word[0]!.toUpperCase() + word.slice(1)).join("");
    const names = list.replace(/,\s*$/, "").split(",").map(binding => binding.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]);
    if (names.every(name => name === contract)) return all;
    const items = Object.keys(leafByItem).filter(item => leafByItem[item] === leaf);
    if (items.length !== 1) { ambiguous.push(leaf); return all; }
    return `${before}${up}${leaf}/${items[0]}${after}`;
  });
  return { content: bound, ambiguous };
}
export function importShadcnAriaComponents(input: ShadcnComponentInput): ShadcnComponentImport {
  if (input.styles.path !== STYLE || input.notice.path !== "LICENSE.md") throw new Error("shadcn-components: missing style or licence input");
  verifyShadcnSource(input.styles); verifyShadcnSource(input.notice);
  const items = new Map<string, ShadcnRegistryItem>();
  for (const item of input.items) {
    if (!/^[a-z][a-z0-9-]*$/.test(item.name) || items.has(item.name) || item.commit !== SHADCN_ARIA_COMPONENT_PIN.commit || item.license !== "MIT") throw new Error("shadcn-components: invalid item identity, pin or licence");
    if (item.missing && (item.name !== "form" || item.missing !== 404 || item.files.length)) throw new Error("shadcn-components: unverified missing item");
    if (!item.missing && (item.files.length !== 1 || item.files[0]!.path !== `${ROOT}${item.name}.tsx`)) throw new Error("shadcn-components: invalid source file set");
    for (const file of item.files) verifyShadcnSource(file);
    items.set(item.name, item);
  }
  const slots = new Map((input.slots ?? componentSlots as unknown as ComponentSlot[]).map(slot => [slot.id, slot]));
  const fills: ShadcnComponentFillDoc[] = [], receipt: ShadcnItemReceipt[] = [];
  const rewrites: Record<string, RewriteResult> = {}, filled = new Set<string>();
  // Pin descriptors repeat shared upstream bytes; retain only hashes of exact
  // current content during this import. Verification and materialization stay fresh.
  const pinDigests = new Map<string, string>();
  const pinDigest = (content: string): string => {
    let value = pinDigests.get(content);
    if (value === undefined) { value = sha256(content); pinDigests.set(content, value); }
    return value;
  };
  // Preferred whole-slot item precedes alternates; never merge two implementations.
  for (const [name, leaf] of Object.entries(SHADCN_COMPONENT_ITEMS)) {
    const item = items.get(name); if (!item) throw new Error(`shadcn-components: missing inspection input ${name}`);
    const slot = slots.get(`components.${leaf}`); if (!slot) throw new Error(`shadcn-components: missing contract components.${leaf}`);
    const failure = runtimeFailure(item, slot);
    if (failure) { receipt.push({ item: name, slot: slot.id, runtime: "X", status: "rejected", reason: failure, issues: [] }); continue; }
    const original = item.files[0]!;
    const closure = new Map<string, SourceFile>([[original.path, original]]);
    const privateFiles: SourceFile[] = [], closureIssues: RewriteIssue[] = [];
    const visit = (current: ShadcnRegistryItem, trail: string[]): void => {
      for (const dep of sorted(dependencies(current.files[0]!.content))) {
        const target = items.get(dep);
        if (!target || !target.files.length || trail.includes(dep)) { closureIssues.push({ code: "K9", file: original.path, value: dep, message: "Dependency is absent or cyclic" }); continue; }
        // A component leaf is rebound to the consumer, so its own dependency
        // graph is checked through that leaf's selected fill, not copied here.
        if (SHADCN_COMPONENT_ITEMS[dep]) continue;
        if (closure.has(target.files[0]!.path)) continue;
        closure.set(target.files[0]!.path, target.files[0]!);
        privateFiles.push({ path: `components/_parts/${dep}/${dep}.tsx`, content: target.files[0]!.content });
        visit(target, [...trail, dep]);
      }
    };
    visit(item, [name]);
    const command = name === "dropdown-menu" ? items.get("command")?.files[0] : undefined;
    if (name === "dropdown-menu" && !command) throw new Error("menu-profile: authenticated Command source required");
    // Menu borrows only CommandList (RAC Menu + cn) from command.tsx: the file is
    // pinned provenance, but its dialog/input-group imports never ship.
    if (command) verifyShadcnSource(command);
    const selected = name === "dialog" ? dialogExecutableSource(original) : name === "dropdown-menu" ? menuExecutableSource(original, command!) : name === "toggle" || name === "toggle-group" ? toggleExecutableSource(name, original) : original;
    const result = rewriteShadcnAria({ item: name, leaf, files: [selected, ...privateFiles], styles: input.styles.content, leafByItem: SHADCN_COMPONENT_ITEMS, styleDefaults: true });
    const files: SourceFile[] = result.files.map(file => {
      const normalized = normalizeSelectedSource(name === "calendar" && file.path === "components/calendar/calendar.tsx" ? { ...file, content: calendarContextSource(file.content) } : file);
      const received = ["select", "calendar"].includes(name) ? selectedCaptionSource(normalized) : normalized;
      const bound = bindSiblingLeafModules(received.content, SHADCN_COMPONENT_ITEMS);
      for (const leaf of bound.ambiguous) closureIssues.push({ code: "K9", file: file.path, value: leaf, message: "Sibling leaf module is ambiguous" });
      return { ...received, content: bound.content };
    });
    files.push({ path: adapter.notice, content: `# Third-party notice\n\nSource: ${SHADCN_ARIA_COMPONENT_PIN.url}\nCommit: ${SHADCN_ARIA_COMPONENT_PIN.commit}\nTransform: shadcn-aria-rewrite@1\n\n${input.notice.content}` });
    if (result.parts.includes("utils")) files.push({ path: "components/_parts/utils/index.ts", content: utils });
    // The consumer's emitter owns every `components/<leaf>/index.ts` entrypoint, so no leaf barrel is
    // materialized here. A private part re-exports an explicit name list; one without a list is a blocker,
    // never a wildcard the emitter would refuse.
    for (const part of result.parts.filter(part => part !== "utils")) {
      if (!partExports[part]) { closureIssues.push({ code: "K9", file: original.path, value: part, message: "Private part needs an explicit export list" }); continue; }
      files.push({ path: `components/_parts/${part}/index.ts`, content: `export { ${partExports[part]!.join(", ")} } from "./${part}"\n` });
    }
    for (const dep of sorted([...closure.values()].flatMap(file => dependencies(file.content)))) {
      const dependency = items.get(dep), contract = slots.get(`components.${SHADCN_COMPONENT_ITEMS[dep]}`);
      if (dependency && contract && runtimeFailure(dependency, contract) && !result.contextualInputs?.includes(dep)) closureIssues.push({ code: "K9", file: original.path, value: dep, message: "Dependency cannot fill its required leaf at this pin; consumer rebind must pass CC" });
    }
    const rewritten: RewriteResult = { ...result, files: files.sort((a, b) => a.path.localeCompare(b.path)), outputSha256: files.map(file => ({ path: file.path, sha256: sha256(file.content) })).sort((a, b) => a.path.localeCompare(b.path)), issues: [...result.issues, ...closureIssues] };
    rewrites[name] = rewritten;
    receipt.push({ item: name, slot: slot.id, runtime: "U-V", status: filled.has(slot.id) ? "alternate" : "candidate", reason: `${slot.contract.root.startsWith("rac:") ? "Pinned root import verified" : "Pinned source has no foreign headless engine"}; token, glyph, dependency and runtime checks remain required`, issues: rewritten.issues, ...(rewritten.notes ? { notes: rewritten.notes } : {}) });
    if (filled.has(slot.id)) continue;
    filled.add(slot.id);
    const impl = { kind: "source" as const, entry: `components/${leaf}/${name}.tsx`, export: exportNames[name] ?? name.split("-").map(word => word[0]!.toUpperCase() + word.slice(1)).join("") };
    const propMap = emittablePropMap(slot.id, impl, memberMap(name, original.content + (rewritten.files.find(file => file.path === `components/${leaf}/${name}.tsx`)?.content ?? ""), slot, impl.export));
    const members = Object.keys(propMap), required = slot.contract.members.mode === "closed" ? slot.contract.members.names : slot.contract.members.required ?? [];
    const pin = { url: SHADCN_ARIA_COMPONENT_PIN.url, commit: SHADCN_ARIA_COMPONENT_PIN.commit, files: [...closure.values(), ...(command ? [command] : []), input.styles, input.notice].map(file => ({ path: file.path, sha256: pinDigest(file.content) })).sort((a, b) => a.path.localeCompare(b.path)) };
    const composes = result.reads.components;
    // A composed leaf's variants call renders that leaf's control height and focus outline on this item's own elements.
    const primary = rewritten.files.find(file => file.path === `components/${leaf}/${name}.tsx`)?.content ?? "";
    const inherited = sorted(dependencies(original.content).filter(dep => SHADCN_COMPONENT_ITEMS[dep] && new RegExp(`\\b${dep.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase())}Variants\\(`).test(primary))
      .flatMap(dep => (rewrites[dep]?.reads.tokens ?? []).filter(read => /^tokens\.(?:control-size|focus-outline|focus-color)\./.test(read))));
    const reads = inherited.length ? { ...result.reads, tokens: sorted([...result.reads.tokens, ...inherited]) } : result.reads;
    const descriptor: ShadcnComponentFillDoc["components"][string] = {
      slot: slot.id, source: SOURCE, root: slot.contract.root, members, props: name === "calendar" ? ["id", "className", "style", "children", "aria-label", "aria-labelledby", "value", "defaultValue", "onChange", "isDisabled", "isReadOnly", "isInvalid", "minValue", "maxValue", "defaultFocusedValue", "focusedValue", "onFocusChange", "isDateUnavailable", "firstDayOfWeek", "numberOfMonths", "buttonVariant", "captionLayout", "showWeekNumber", "headerFormat", "renderCell"] : [], propMap, reads, composes,
      impl,
      license: "MIT", pin, notice: adapter.notice, transform: "shadcn-aria-rewrite@1", item: name,
      deps: [...npmDeps.filter(dep => dep.name === "react" || dep.name === "react-aria-components" && imports(original.content).length > 0 || dep.name === "class-variance-authority" && [...closure.values()].some(file => file.content.includes('from "class-variance-authority"')) || ["clsx", "tailwind-merge"].includes(dep.name)),
        ...sorted([...closure.values()].flatMap(file => dependencies(file.content))).filter(dep => !result.contextualInputs?.includes(dep)).map(dep => ({ name: dep, version: SHADCN_ARIA_COMPONENT_PIN.commit, license: "MIT", registryItem: dep, ...(SHADCN_COMPONENT_ITEMS[dep] ? { slot: `components.${SHADCN_COMPONENT_ITEMS[dep]}` } : {}) }))],
      parts: result.parts.map(item => ({ item })), outputSha256: rewritten.outputSha256, blockers: rewritten.issues,
      ...(secondaryExportApprovals[name] ? { secondaryExports: secondaryExportApprovals[name]!.map(row => ({ ...row })) } : {}),
    };
    // Source descriptors resolve the consumer's own react-aria-components install; never a peer (CC3).
    descriptor.rac = componentRacDeclaration(descriptor, { peer: false });
    fills.push({ $extensions: { "com.clossys.fill": {
      id: `${SOURCE}/${slot.id}`, slot: slot.id, source: SOURCE, mode: "implementation", sourceAddress: `${SHADCN_ARIA_COMPONENT_PIN.url}/blob/${pin.commit}/${original.path}`,
      relation: members.length === required.length ? "same-contract" : "subset", builtOn: composes, conforms: [], evidence: [],
      author: "third-party", trust: "pinned-upstream", license: "MIT", status: "draft", pin: { url: SHADCN_ARIA_COMPONENT_PIN.url, commit: pin.commit, sha256: sha256(original.content) }, unmapped: required.filter(member => !members.includes(member)),
    } }, components: { [leaf]: descriptor } });
  }
  const inputGroup = items.get("input-group");
  if (!inputGroup) throw new Error("shadcn-components: missing inspection input input-group");
  receipt.push({ item: "input-group", slot: "components.text-field", runtime: "X", status: "rejected", reason: "K2: Group is not TextField; retained only as a private registry part", issues: [] });
  receipt.push({ item: "button#LinkButton", slot: "components.link", runtime: "U-V", status: "alternate", reason: "Pinned button item imports Link; a derived link rule belongs to the component change engine", issues: [] });
  const compose = resolveShadcnComposeRules(SHADCN_COMPOSE_RULES, { slots: new Set(slots.keys()), sources: new Map([...filled].map(slot => [slot, SOURCE])),
    items: new Set([...items].filter(([, item]) => !item.missing && item.files.length).map(([name]) => name)) });
  const composed = compose.flatMap(row => composedTemplate(row, slots.get(row.slot)!) ?? []);
  return { fills: fills.sort((a, b) => a.$extensions["com.clossys.fill"].slot.localeCompare(b.$extensions["com.clossys.fill"].slot)), receipt, rewrites, compose, composed };
}

/** Adoption may only consume a fully rewritten bundle; draft descriptors are inspectable. */
export function materializeShadcnComponent(result: ShadcnComponentImport, item: string): readonly SourceFile[] {
  const rewrite = result.rewrites[item];
  if (!rewrite || rewrite.issues.length) throw new Error("shadcn-components: rejected or unresolved rewrite cannot be materialized");
  const seen = new Set<string>();
  for (const file of rewrite.files) {
    if (seen.has(file.path) || rewrite.outputSha256.filter(pin => pin.path === file.path && pin.sha256 === sha256(file.content)).length !== 1) throw new Error("shadcn-components: rewritten output hash differs");
    seen.add(file.path);
  }
  if (rewrite.outputSha256.length !== seen.size) throw new Error("shadcn-components: rewritten output receipt differs");
  return rewrite.files;
}

export function generatedShadcnComponentFiles(input: ShadcnComponentInput): Readonly<Record<string, string>> {
  const result = importShadcnAriaComponents(input);
  return Object.fromEntries([...[...result.fills, ...result.composed].map(fill => [fill.$extensions["com.clossys.fill"].slot + ".json", stableStringify(fill)]),
    ["components.coverage.json", stableStringify({ source: SOURCE, pin: SHADCN_ARIA_COMPONENT_PIN, receipt: result.receipt, compose: result.compose, unmeasured: ["ref and render-prop forwarding", "consumer RAC singleton", "axe", "keyboard", "forced colours", "contrast", "state/mode/ground matrix", "consumer Tailwind v4 build"] })]]);
}
