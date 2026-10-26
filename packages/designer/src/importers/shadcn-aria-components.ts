import adapter from "../catalog/adapters/shadcn@aria.json" with { type: "json" };
import componentSlots from "../catalog/slots/components.json" with { type: "json" };
import type { ComponentCheckFill } from "../catalog-core/check-components.js";
import type { ComponentSlot, FillMeta } from "../catalog-core/types.js";
import { sha256 } from "../catalog-core/digest.js";
import { stableStringify } from "../catalog-core/stable.js";
import { rewriteShadcnAria, type RewriteIssue, type RewriteNote, type RewriteResult, type SourceFile } from "./rewrite.js";
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
    outputSha256: RewriteResult["outputSha256"];
    blockers: readonly RewriteIssue[];
  }>>;
}
export interface ShadcnComponentImport {
  fills: readonly ShadcnComponentFillDoc[]; receipt: readonly ShadcnItemReceipt[];
  rewrites: Readonly<Record<string, RewriteResult>>;
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

/** Only members directly evidenced by pinned source surfaces are mapped. */
function memberMap(item: string, code: string, slot: ComponentSlot): Record<string, string> {
  const map: Record<string, string> = {};
  const add = (member: string, pointer: string): void => { if (slot.contract.members.mode === "closed" && slot.contract.members.names.includes(member)) map[member] = pointer; };
  if (item === "button") {
    for (const [member, value] of Object.entries({ primary: "default", secondary: "secondary", ghost: "ghost", danger: "destructive", outline: "outline" })) if (new RegExp(`\\b${value}:`).test(code)) add(`variant.${member}`, `Button.variant=${value}`);
    for (const [member, value] of Object.entries({ sm: "sm", md: "default", lg: "lg" })) if (new RegExp(`\\b${value}:`).test(code)) add(`size.${member}`, `Button.size=${value}`);
    add("shape.text", "Button"); if (/icon:/.test(code)) add("shape.icon-only", "Button.size=icon");
    add("ground.base", "Button");
  }
  // Forwarded RAC props retain the pinned root's public state/orientation API.
  const forwardsProps = /\{\.\.\.props\}/.test(code);
  if (item === "checkbox" && /CheckboxProps/.test(code) && forwardsProps) {
    add("scope.single", "Checkbox: CheckboxProps forwarded to CheckboxPrimitive");
    if (/isSelected/.test(code)) add("state.checked", "Checkbox composeRenderProps.isSelected");
    if (/isIndeterminate/.test(code)) add("state.indeterminate", "Checkbox composeRenderProps.isIndeterminate");
  }
  if (item === "radio-group" && /RadioGroupProps/.test(code) && forwardsProps) {
    for (const orientation of ["horizontal", "vertical"]) add(`orientation.${orientation}`, `RadioGroupProps.orientation=${orientation} forwarded to RadioGroupPrimitive`);
  }
  if (item === "switch" && /SwitchProps/.test(code) && forwardsProps && /isSelected/.test(code)) {
    add("state.on", "Switch composeRenderProps.isSelected=true");
    add("state.off", "Switch composeRenderProps.isSelected=false");
  }
  if (item === "slider" && /SliderPrimitiveProps<T>/.test(code) && forwardsProps) {
    if (/type SliderValue = number \| number\[\]/.test(code) && /state\.values\.map/.test(code)) {
      add("selection.single", "SliderProps<number>.value; state.values maps one thumb");
      add("selection.range", "SliderProps<number[]>.value; state.values maps indexed thumbs");
    }
    for (const orientation of ["horizontal", "vertical"]) if (code.includes(`data-${orientation}`)) add(`orientation.${orientation}`, `SliderPrimitiveProps.orientation=${orientation}`);
  }
  if (item === "toggle" && /ToggleButtonProps/.test(code) && forwardsProps) {
    for (const [member, value] of Object.entries({ sm: "sm", md: "default", lg: "lg" })) if (new RegExp(`cn-toggle-size-${value}\\b`).test(code)) add(`size.${member}`, `Toggle.size=${value}`);
    if (/cn-toggle-variant-default/.test(code) && /bg-transparent/.test(code)) add("variant.ghost", "Toggle.variant=default: transparent surface");
    if (/cn-toggle-variant-outline/.test(code)) add("variant.outline", "Toggle.variant=outline");
    if (/data-selected:/.test(code)) add("state.selected", "ToggleButtonProps.isSelected; data-selected styles");
  }
  if (item === "toggle-group" && /ToggleButtonGroupProps/.test(code) && forwardsProps) {
    for (const selection of ["single", "multiple"]) add(`selection.${selection}`, `ToggleButtonGroupProps.selectionMode=${selection} forwarded to ToggleGroupPrimitive`);
    for (const orientation of ["horizontal", "vertical"]) if (code.includes(`"${orientation}"`)) add(`orientation.${orientation}`, `ToggleGroup.orientation=${orientation}`);
  }
  if (item === "select") {
    for (const [member, pointer] of Object.entries(selectedCaptionMembers)) add(member, pointer);
  }
  if (item === "combobox" && /ComboBox as ComboBoxPrimitive/.test(code) && /ComboBoxPrimitive as Combobox/.test(code)) add("allows-custom", "Combobox directly exports RAC ComboBox.allowsCustomValue");
  if (item === "dialog") {
    for (const [member, pointer] of Object.entries(dialogExecutableMembers)) add(member, pointer);
  }
  if ((item === "popover" || item === "tooltip") && /placement = /.test(code) && /placement=\{placement\}/.test(code)) {
    add("placement", `${item === "popover" ? "Popover" : "Tooltip"}.placement forwarded to RAC primitive`);
  }
  if (item === "dropdown-menu") {
    for (const [member, pointer] of Object.entries(menuExecutableMembers)) add(member, pointer);
  }
  if (item === "avatar" && /data-size=\{size\}/.test(code)) {
    for (const [member, value] of Object.entries({ sm: "sm", md: "default", lg: "lg" })) if (code.includes(`"${value}"`) && code.includes(`size=${value}`)) add(`size.${member}`, `Avatar.size=${value}: data-size and matching utility variants`);
    if (/<img\b/.test(code) && /data-slot="avatar-image"/.test(code)) add("content.image", "AvatarImage: img src/alt and loading/error state");
    if (/function AvatarFallback/.test(code) && /data-slot="avatar-fallback"/.test(code) && forwardsProps) add("content.initials", "AvatarFallback: children forwarded to fallback div");
  }
  if (item === "breadcrumb") {
    if (/isCurrent/.test(code) && /aria-current="page"/.test(code)) add("current", "BreadcrumbItem.isCurrent; BreadcrumbPage aria-current=page");
    if (/function BreadcrumbEllipsis/.test(code) && /data-slot="breadcrumb-ellipsis"/.test(code)) add("collapsed", "BreadcrumbEllipsis: collapsed-path visual; unresolved glyph retained as K7");
  }
  if (item === "tabs" && /React.ComponentProps<typeof TabsPrimitive>/.test(code) && forwardsProps) {
    for (const orientation of ["horizontal", "vertical"]) if (code.includes(`data-${orientation}`)) add(`orientation.${orientation}`, `TabsPrimitive.orientation=${orientation}: forwarded RAC prop and data-${orientation} layout`);
  }
  if (item === "separator" && /orientation=\{orientation\}/.test(code)) {
    for (const orientation of ["horizontal", "vertical"]) if (code.includes(`orientation=${orientation}`)) add(`orientation.${orientation}`, `Separator.orientation=${orientation}: RAC prop and aria-orientation utility`);
  }
  if (item === "kbd" && /Keyboard as KbdPrimitive/.test(code) && forwardsProps) {
    if (/data-slot="kbd"/.test(code)) add("scope.single", "Kbd: children forwarded to RAC Keyboard");
    if (/data-slot="kbd-group"/.test(code)) add("scope.chord", "KbdGroup: chord children forwarded to RAC Keyboard");
  }
  if (item === "calendar") { add("selection.single", "Calendar"); if (/RangeCalendar/.test(code)) add("selection.range", "RangeCalendar"); }
  if (item === "accordion" || item === "collapsible") add(item === "accordion" ? "scope.group" : "scope.single", item === "accordion" ? "Accordion" : "Collapsible");
  if (/isDisabled|disabled:/.test(code)) add("state.disabled", "isDisabled");
  if (item !== "select" && /aria-invalid|isInvalid/.test(code)) add("state.invalid", "isInvalid");
  if (/focus-visible:/.test(code)) add("state.focus-visible", "data-focus-visible");
  if (/hover:/.test(code)) add("state.hover", "data-hovered");
  return Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)));
}
const exportNames: Record<string, string> = { toggle: "Toggle", "dropdown-menu": "DropdownMenu", "context-menu": "ContextMenu", combobox: "Combobox", kbd: "Kbd", alert: "Alert", progress: "Progress", breadcrumb: "Breadcrumb", accordion: "Accordion", collapsible: "Collapsible", "alert-dialog": "AlertDialog", "hover-card": "HoverCard", "radio-group": "RadioGroup", "toggle-group": "ToggleGroup" };
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
      return ["select", "calendar"].includes(name) ? selectedCaptionSource(normalized) : normalized;
    });
    files.push({ path: adapter.notice, content: `# Third-party notice\n\nSource: ${SHADCN_ARIA_COMPONENT_PIN.url}\nCommit: ${SHADCN_ARIA_COMPONENT_PIN.commit}\nTransform: shadcn-aria-rewrite@1\n\n${input.notice.content}` });
    if (result.parts.includes("utils")) files.push({ path: "components/_parts/utils/index.ts", content: utils });
    if (!["select", "combobox", "calendar", "popover", "checkbox"].includes(name)) files.push({ path: `components/${leaf}/index.ts`, content: `export * from "./${name}.js"\n` });
    for (const part of result.parts.filter(part => part !== "utils")) files.push({ path: `components/_parts/${part}/index.ts`, content: part === "input-group" ? 'export { InputGroup, InputGroupAddon, InputGroupButton, InputGroupText, InputGroupInput, InputGroupTextarea } from "./input-group.js"\n' : `export * from "./${part}.js"\n` });
    for (const dep of sorted([...closure.values()].flatMap(file => dependencies(file.content)))) {
      const dependency = items.get(dep), contract = slots.get(`components.${SHADCN_COMPONENT_ITEMS[dep]}`);
      if (dependency && contract && runtimeFailure(dependency, contract) && !result.contextualInputs?.includes(dep)) closureIssues.push({ code: "K9", file: original.path, value: dep, message: "Dependency cannot fill its required leaf at this pin; consumer rebind must pass CC" });
    }
    const rewritten: RewriteResult = { ...result, files: files.sort((a, b) => a.path.localeCompare(b.path)), outputSha256: files.map(file => ({ path: file.path, sha256: sha256(file.content) })).sort((a, b) => a.path.localeCompare(b.path)), issues: [...result.issues, ...closureIssues] };
    rewrites[name] = rewritten;
    receipt.push({ item: name, slot: slot.id, runtime: "U-V", status: filled.has(slot.id) ? "alternate" : "candidate", reason: `${slot.contract.root.startsWith("rac:") ? "Pinned root import verified" : "Pinned source has no foreign headless engine"}; token, glyph, dependency and runtime checks remain required`, issues: rewritten.issues, ...(rewritten.notes ? { notes: rewritten.notes } : {}) });
    if (filled.has(slot.id)) continue;
    filled.add(slot.id);
    const propMap = memberMap(name, original.content + (rewritten.files.find(file => file.path === `components/${leaf}/${name}.tsx`)?.content ?? ""), slot);
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
      impl: { kind: "source", entry: `components/${leaf}/${name}.tsx`, export: exportNames[name] ?? name.split("-").map(word => word[0]!.toUpperCase() + word.slice(1)).join("") },
      license: "MIT", pin, notice: adapter.notice, transform: "shadcn-aria-rewrite@1", item: name,
      deps: [...npmDeps.filter(dep => dep.name === "react" || dep.name === "react-aria-components" && imports(original.content).length > 0 || dep.name === "class-variance-authority" && [...closure.values()].some(file => file.content.includes('from "class-variance-authority"')) || ["clsx", "tailwind-merge"].includes(dep.name)),
        ...sorted([...closure.values()].flatMap(file => dependencies(file.content))).filter(dep => !result.contextualInputs?.includes(dep)).map(dep => ({ name: dep, version: SHADCN_ARIA_COMPONENT_PIN.commit, license: "MIT", registryItem: dep, ...(SHADCN_COMPONENT_ITEMS[dep] ? { slot: `components.${SHADCN_COMPONENT_ITEMS[dep]}` } : {}) }))],
      parts: result.parts.map(item => ({ item })), outputSha256: rewritten.outputSha256, blockers: rewritten.issues,
    };
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
  return { fills: fills.sort((a, b) => a.$extensions["com.clossys.fill"].slot.localeCompare(b.$extensions["com.clossys.fill"].slot)), receipt, rewrites };
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
  return Object.fromEntries([...result.fills.map(fill => [fill.$extensions["com.clossys.fill"].slot + ".json", stableStringify(fill)]),
    ["components.coverage.json", stableStringify({ source: SOURCE, pin: SHADCN_ARIA_COMPONENT_PIN, receipt: result.receipt, unmeasured: ["ref and render-prop forwarding", "consumer RAC singleton", "axe", "keyboard", "forced colours", "contrast", "state/mode/ground matrix", "consumer Tailwind v4 build"] })]]);
}
