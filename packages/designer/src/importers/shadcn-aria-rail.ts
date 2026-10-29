import data from "./vendor/shadcn-aria-rail.data.json" with { type: "json" };
import adapter from "../catalog/adapters/shadcn@aria.json" with { type: "json" };
import slots from "../catalog/slots/components.json" with { type: "json" };
import { sha256 } from "../catalog-core/digest.js";
import { componentDescriptorHash, type ComponentCandidateDocument } from "../catalog-core/resolve-components.js";
import type { SourceBundle } from "../catalog-core/changeset-components.js";
import { rewriteShadcnAria, type SourceFile } from "./rewrite.js";

/** Current official Aria source additions; existing v1 fills keep their authenticated pin. */
export const SHADCN_ARIA_RAIL_ITEMS = ["sidebar", "command", "sheet", "empty", "item", "scroll-area", "dropdown-menu", "kbd"] as const;
export const SHADCN_ARIA_INPUT_LEAVES = ["field", "text-field", "search-field", "number-field", "date-field", "form", "tag-group", "toolbar", "link", "native-action"] as const;
const leafOf = (item: string): string => item === "kbd" ? "keyboard" : item;
const exportsOf = (code: string): string[] => [...code.matchAll(/export\s*\{([^}]+)\}/g)].flatMap(match => match[1]!.split(",").map(x => x.trim()).filter(x => x && !x.startsWith("type ")));
const dependencies = (code: string): string[] => [...code.matchAll(/from\s*"@\/registry\/bases\/aria\/ui\/([a-z-]+)"/g)].map(match => match[1]!);
const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort();
const utils = 'import { clsx, type ClassValue } from "clsx"\nimport { twMerge } from "tailwind-merge"\nexport function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)) }\n';

export function importShadcnAriaRail() {
  const byItem = new Map(data.files.map(file => [file.item, file]));
  for (const file of data.files) if (sha256(file.content) !== file.sha256) throw new Error(`shadcn-rail: source pin mismatch: ${file.path}`);
  const style = byItem.get("style")!, license = byItem.get("license")!;
  const source = "shadcn@aria", transform = "shadcn-aria-rewrite@2";
  const leafByItem = Object.fromEntries(SHADCN_ARIA_RAIL_ITEMS.map(item => [item, leafOf(item)]));
  const allFiles = new Map<string, SourceFile>();
  const fills: ComponentCandidateDocument[] = [], sourceBundles: SourceBundle[] = [];
  const candidates = [];
  const rewrites: Record<string, ReturnType<typeof rewriteShadcnAria>> = {};
  for (const item of SHADCN_ARIA_RAIL_ITEMS) {
    const leaf = leafOf(item), slot = `components.${leaf}`, original = byItem.get(item)!;
    const closure = new Set<string>();
    const visit = (name: string): void => {
      if (closure.has(name)) return;
      closure.add(name);
      const file = byItem.get(name); if (!file) throw new Error(`shadcn-rail: missing dependency ${name}`);
      for (const dep of dependencies(file.content)) if (!Object.hasOwn(leafByItem, dep)) visit(dep);
      if (file.content.includes('/hooks/use-mobile"')) closure.add("use-mobile");
    };
    visit(item);
    const files: SourceFile[] = [];
    const tokens = new Set<string>(), assets = new Set<string>(), components = new Set<string>();
    const issues: ReturnType<typeof rewriteShadcnAria>["issues"][number][] = [];
    const notes: NonNullable<ReturnType<typeof rewriteShadcnAria>["notes"]>[number][] = [];
    for (const name of closure) {
      const upstream = byItem.get(name)!;
      if (name === "use-mobile") {
        const content = upstream.content.replace('const MOBILE_BREAKPOINT = 768', `function mobileBreakpoint() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--breakpoint-mobile-lg").trim()
  const match = /^(\\d+(?:\\.\\d+)?)(px|rem)$/.exec(raw)
  if (!match) throw new Error("Missing mobile breakpoint token")
  return Number(match[1]) * (match[2] === "rem" ? parseFloat(getComputedStyle(document.documentElement).fontSize) : 1)
}`).replace('    const mql =', '    const MOBILE_BREAKPOINT = mobileBreakpoint()\n    const mql =');
        files.push({ path: "components/_parts/rail-use-mobile/index.ts", content });
        tokens.add("tokens.breakpoint.mobile-lg"); continue;
      }
      const privatePart = name !== item;
      const inputPath = privatePart ? `components/_parts/rail-${name}/${name}.tsx` : upstream.path;
      const result = rewriteShadcnAria({ item: name, leaf: privatePart ? name : leaf, files: [{ path: inputPath, content: upstream.content.replaceAll("@/registry/bases/aria/hooks/use-mobile", `${privatePart ? "../../" : "../"}_parts/rail-use-mobile/index`) }], styles: style.content, leafByItem, transformVersion: 2, retainRegistryButtonProps: true });
      result.reads.tokens.forEach(x => tokens.add(x)); result.reads.assets.forEach(x => assets.add(x)); result.reads.components.forEach(x => components.add(x));
      issues.push(...result.issues); notes.push(...result.notes ?? []);
      for (const file of result.files) {
        let content = file.content.replace(/(_parts\/)(?!rail-)([a-z-]+)\//g, "$1rail-$2/")
          .replaceAll('@/registry/bases/aria/hooks/use-mobile', `${privatePart ? "../../" : "../"}_parts/rail-use-mobile/index`);
        if (!/import\s+(?:\*\s+as\s+React|type\s+\*\s+as\s+React)/.test(content) && /\bReact\./.test(content)) content = 'import type * as React from "react"\n' + content;
        files.push({ ...file, content });
      }
    }
    if (files.some(file => file.content.includes("rail-utils/index"))) files.push({ path: "components/_parts/rail-utils/index.ts", content: utils });
    for (const name of closure) if (name !== item && name !== "use-mobile") files.push({ path: `components/_parts/rail-${name}/index.ts`, content: `export { ${exportsOf(byItem.get(name)!.content).join(", ")} } from "./${name}"\n` });
    const notice = "notices/SHADCN-ARIA-RAIL.md";
    files.push({ path: notice, content: `# Third-party notice\n\nSource: ${adapter.pin.url}\nCommit: ${data.commit}\nTransform: ${transform}\n\n${license.content}` });
    const unique = [...new Map(files.map(file => [file.path, file])).values()].sort((a,b) => a.path.localeCompare(b.path));
    for (const file of unique) {
      const previous = allFiles.get(file.path); if (previous && previous.content !== file.content) throw new Error(`shadcn-rail: conflicting output ${file.path}`);
      allFiles.set(file.path, file);
    }
    const pinned = [...closure].map(name => byItem.get(name)!).concat(style, license);
    const pin = { url: adapter.pin.url, commit: data.commit, files: pinned.map(file => ({ path: file.path, sha256: file.sha256 })).sort((a,b) => a.path.localeCompare(b.path)) };
    const names = exportsOf(original.content), root = names.find(name => name.toLowerCase() === item.replaceAll("-", "")) ?? names[0]!;
    const contract = slots.find(row => row.id === slot)!;
    const propMap = item === "kbd" ? { "scope.single": "Kbd", "scope.chord": "KbdGroup" } : {};
    // Only component anatomy values enter the generated leaf facade; hooks stay private to the source module.
    const secondaryExports = names.filter(name => name !== root && /^[A-Z][A-Za-z0-9]*$/.test(name)).map(name => ({ name, export: name }));
    const descriptor = { slot, source, root: contract.contract.root, members: Object.keys(propMap), props: [], propMap, reads: { tokens: sorted(tokens), assets: sorted(assets), components: sorted(components) }, composes: sorted(components), impl: { kind: "source", entry: `components/${leaf}/${item}.tsx`, export: root }, ...(secondaryExports.length ? { secondaryExports } : {}), license: "MIT", pin, notice, transform, item, deps: [{ name: "react", version: "19.3.0", license: "MIT" }, { name: "react-aria-components", version: "1.21.1", license: "Apache-2.0" }, { name: "class-variance-authority", version: "0.7.1", license: "Apache-2.0" }, { name: "clsx", version: "2.1.1", license: "MIT" }, { name: "tailwind-merge", version: "3.7.0", license: "MIT" }], parts: [...closure].filter(name => name !== item).map(item => ({ item: `rail-${item}` })), outputSha256: unique.map(file => ({ path: file.path, sha256: sha256(file.content) })), blockers: issues, rac: { instance: "react-aria-components", range: "^1.21.1", peer: false } };
    const document = { $extensions: { "com.clossys.fill": { id: `${source}/${slot}`, slot, source, mode: "implementation", sourceAddress: `${adapter.pin.url}/blob/${data.commit}/${original.path}`, relation: "same-contract", builtOn: sorted(components), conforms: [], evidence: [], author: "third-party", trust: "pinned-upstream", license: "MIT", status: "draft", pin: { url: adapter.pin.url, commit: data.commit, sha256: original.sha256 }, unmapped: [] } }, components: { [leaf]: descriptor } } as unknown as ComponentCandidateDocument;
    fills.push(document);
    const fill = Object.values(document.components)[0]!;
    const descriptorHash = componentDescriptorHash(fill), upstreamFiles = pinned.map(({path,content}) => ({path,content}));
    const bundle = { slot, descriptorHash, transform, upstream: upstreamFiles, files: unique, blockers: issues };
    if (!issues.length) sourceBundles.push(bundle);
    candidates.push({ fill: `${source}/${slot}`, slot, descriptorHash, transform, upstreamFiles, outputFiles: unique, blockers: issues, status: issues.length ? "blocked" as const : "ready" as const });
    rewrites[item] = { transform, files: unique, outputSha256: descriptor.outputSha256, reads: descriptor.reads, parts: descriptor.parts.map(x=>x.item), issues, notes };
  }
  const inputs = importInputLeaves();
  return { fills: [...fills, ...inputs.fills], sourceBundles: [...sourceBundles, ...inputs.sourceBundles], candidates: [...candidates, ...inputs.candidates], rewrites: { ...rewrites, ...inputs.rewrites }, files: [...allFiles.values(), ...inputs.files] };
}

/** Owned RAC wiring; all visual bytes come from the authenticated Aria registry parts. */
const inputSources: Record<(typeof SHADCN_ARIA_INPUT_LEAVES)[number], { parts: string[]; name: string; members: Record<string, string>; code: string }> = {
  field: { parts: ["field", "label"], name: "Field", members: { "part.label": "Field.label", "part.description": "Field.description", "part.error": "Field.errorMessage", "state.required": "Field.isRequired=true", "state.invalid": "Field.isInvalid=true", "state.disabled": "Field.isDisabled=true" }, code: `
import { type ComponentProps, type ReactNode, useId } from "react";
import { TextField, Text, FieldError } from "react-aria-components";
import { Field as Layout, FieldLabel, FieldDescription, FieldError as ErrorContent, FieldGroup as LayoutGroup, FieldSet as LayoutSet } from "../_parts/rail-field/index";
export function FieldGroup(props: ComponentProps<typeof LayoutGroup>) { return <LayoutGroup {...props} />; }
export function FieldSet(props: ComponentProps<typeof LayoutSet>) { return <LayoutSet {...props} />; }
type Props = { label: ReactNode; description?: ReactNode; errorMessage?: ReactNode; children: ReactNode | ((props: { id: string; disabled?: boolean; "aria-invalid"?: boolean; "aria-required"?: boolean }) => ReactNode); isRequired?: boolean; isInvalid?: boolean; isDisabled?: boolean };
export function Field({ label, description, errorMessage, children, ...props }: Props) {
  const id = useId();
  return <TextField {...props} id={id} validationBehavior="aria"><Layout data-invalid={props.isInvalid} data-disabled={props.isDisabled}>
    <FieldLabel htmlFor={id}>{label}</FieldLabel>
    {typeof children === "function" ? children({ id, disabled: props.isDisabled, "aria-invalid": props.isInvalid, "aria-required": props.isRequired }) : children}
    {description ? <Text slot="description"><FieldDescription>{description}</FieldDescription></Text> : null}
    <FieldError><ErrorContent>{errorMessage}</ErrorContent></FieldError>
  </Layout></TextField>;
}
` },
  "text-field": { parts: ["input", "textarea", "label"], name: "TextField", members: { "line.single-line": "TextField.line=single-line", "line.multiline": "TextField.line=multiline", "state.invalid": "TextField.isInvalid=true", "state.disabled": "TextField.isDisabled=true", "state.read-only": "TextField.isReadOnly=true", "size.md": "TextField.size=md" }, code: `
import { type ComponentProps, type ReactNode } from "react";
import { TextField as Root, Text, FieldError } from "react-aria-components";
import { Input } from "../_parts/rail-input/index";
import { Textarea } from "../_parts/rail-textarea/index";
import { Label } from "../_parts/rail-label/index";
type Props = Omit<ComponentProps<typeof Root>, "children"> & { label: ReactNode; description?: ReactNode; errorMessage?: ReactNode; line?: "single-line" | "multiline"; size?: "md"; placeholder?: string };
export function TextField({ label, description, errorMessage, line = "single-line", size = "md", placeholder, ...props }: Props) {
  return <Root {...props} data-size={size}><Label>{label}</Label>{line === "multiline" ? <Textarea placeholder={placeholder} /> : <Input placeholder={placeholder} />}{description ? <Text slot="description">{description}</Text> : null}<FieldError>{errorMessage}</FieldError></Root>;
}
` },
  "search-field": { parts: ["input-group", "input", "label", "button"], name: "SearchField", members: { "part.clear": "SearchField.clearLabel", "part.submit": "SearchField.submitLabel" }, code: `
import { type ComponentProps, type ReactNode } from "react";
import { SearchField as Root, FieldError, Text } from "react-aria-components";
import { InputGroup, InputGroupInput, InputGroupButton } from "../_parts/rail-input-group/index";
import { Label } from "../_parts/rail-label/index";
type Props = Omit<ComponentProps<typeof Root>, "children"> & { label: ReactNode; clearLabel?: string; copy?: InputCopyResolver; submitLabel?: string; placeholder?: string; description?: ReactNode; errorMessage?: ReactNode };
export function SearchField({ label, clearLabel, copy, submitLabel, placeholder, description, errorMessage, ...props }: Props) {
 const clear = inputCopy(copy, "searchClear", clearLabel);
 return <Root {...props}>{({ isEmpty }) => <><Label>{label}</Label><InputGroup><InputGroupInput placeholder={placeholder} />{!isEmpty ? <InputGroupButton aria-label={clear} data-copy-ref={INPUT_COPY_REFS.searchClear.id}>{clear}</InputGroupButton> : null}{submitLabel ? <InputGroupButton slot={null} onPress={() => props.onSubmit?.(props.value ?? "")}>{submitLabel}</InputGroupButton> : null}</InputGroup>{description ? <Text slot="description">{description}</Text> : null}<FieldError>{errorMessage}</FieldError></>}</Root>;
}
` },
  "number-field": { parts: ["input-group", "input", "label", "button"], name: "NumberField", members: { format: "NumberField.formatOptions", step: "NumberField.step", "state.invalid": "NumberField.isInvalid=true" }, code: `
import { type ComponentProps, type ReactNode } from "react";
import { NumberField as Root, Text, FieldError } from "react-aria-components";
import { InputGroup, InputGroupInput, InputGroupButton } from "../_parts/rail-input-group/index";
import { Label } from "../_parts/rail-label/index";
type Props = Omit<ComponentProps<typeof Root>, "children"> & { label: ReactNode; incrementLabel?: string; decrementLabel?: string; copy?: InputCopyResolver; description?: ReactNode; errorMessage?: ReactNode };
export function NumberField({ label, incrementLabel, decrementLabel, copy, description, errorMessage, ...props }: Props) {
 const values = { fieldLabel: typeof label === "string" ? label : "" };
 const increment = inputCopy(copy, "numberIncrement", incrementLabel, values), decrement = inputCopy(copy, "numberDecrement", decrementLabel, values);
 return <Root {...props}><Label>{label}</Label><InputGroup><InputGroupButton slot="decrement" aria-label={decrement} data-copy-ref={INPUT_COPY_REFS.numberDecrement.id}>{decrement}</InputGroupButton><InputGroupInput /><InputGroupButton slot="increment" aria-label={increment} data-copy-ref={INPUT_COPY_REFS.numberIncrement.id}>{increment}</InputGroupButton></InputGroup>{description ? <Text slot="description">{description}</Text> : null}<FieldError>{errorMessage}</FieldError></Root>;
}
` },
  "date-field": { parts: ["input", "input-group", "label"], name: "DateField", members: { "content.date": "DateField", "content.time": "TimeField", granularity: "DateField.granularity", "state.invalid": "DateField.isInvalid=true" }, code: `
import { type ComponentProps, type ReactNode } from "react";
import { DateField as Root, TimeField as TimeRoot, DateInput, DateSegment, FieldError } from "react-aria-components";
import { Label } from "../_parts/rail-label/index";
import { inputClasses } from "../_parts/rail-input-classes/index";
type Props = Omit<ComponentProps<typeof Root>, "children"> & { label: ReactNode; errorMessage?: ReactNode; pickerContext?: boolean };
export function DateField({ label, errorMessage, pickerContext, ...props }: Props) {
 if (pickerContext) return <DateInput slot={props.slot} className={inputClasses}>{segment => <DateSegment segment={segment} />}</DateInput>;
 return <Root {...props}><Label>{label}</Label><DateInput className={inputClasses}>{segment => <DateSegment segment={segment} />}</DateInput><FieldError>{errorMessage}</FieldError></Root>;
}
export function TimeField({ label, errorMessage, ...props }: Omit<ComponentProps<typeof TimeRoot>, "children"> & { label: ReactNode; errorMessage?: ReactNode }) {
 return <TimeRoot {...props}><Label>{label}</Label><DateInput className={inputClasses}>{segment => <DateSegment segment={segment} />}</DateInput><FieldError>{errorMessage}</FieldError></TimeRoot>;
}
` },
  form: { parts: ["field"], name: "Form", members: { "validation.native": "Form.validationBehavior=native", "validation.aria": "Form.validationBehavior=aria" }, code: `
import { type ComponentProps } from "react";
import { Form as Root } from "react-aria-components";
import { FieldGroup, FieldSet } from "../field/index";
export function Form({ children, ...props }: ComponentProps<typeof Root>) {
 return <Root {...props}><FieldSet><FieldGroup>{children}</FieldGroup></FieldSet></Root>;
}
` },
  "tag-group": { parts: ["badge", "button"], name: "TagGroup", members: { removable: "TagGroup.removable=true", "selection.none": "TagGroup.selectionMode=none", "selection.single": "TagGroup.selectionMode=single", "selection.multiple": "TagGroup.selectionMode=multiple" }, code: `
import { type ComponentProps, type ReactNode } from "react";
import { TagGroup as Root, TagList, Tag, Label, Button } from "react-aria-components";
import { badgeVariants } from "../_parts/rail-badge/badge";
import { buttonVariants } from "../_parts/rail-button/button";
type Item = { id: string; label: string };
type Props = Omit<ComponentProps<typeof Root>, "children"> & { label: ReactNode; items: Item[]; removable?: boolean; removeLabel?: string; copy?: InputCopyResolver };
export function TagGroup({ label, items, removable, removeLabel, copy, ...props }: Props) {
 const remove = removable ? inputCopy(copy, "tagRemove", removeLabel) : undefined;
 return <Root {...props}><Label>{label}</Label><TagList items={items}>{item => <Tag id={item.id} textValue={item.label} className={({ isSelected }) => badgeVariants({ variant: isSelected ? "default" : "secondary" })}>{item.label}{removable ? <Button slot="remove" aria-label={remove} data-copy-ref={INPUT_COPY_REFS.tagRemove.id} className={buttonVariants({ variant: "ghost", size: "icon" })}>{remove}</Button> : null}</Tag>}</TagList></Root>;
}
` },
  toolbar: { parts: ["button-group"], name: "Toolbar", members: { "orientation.horizontal": "Toolbar.orientation=horizontal", "orientation.vertical": "Toolbar.orientation=vertical" }, code: `
import { type ComponentProps } from "react";
import { Toolbar as Root, composeRenderProps } from "react-aria-components";
import { buttonGroupVariants } from "../_parts/rail-button-group/button-group";
export function Toolbar({ className, orientation = "horizontal", ...props }: ComponentProps<typeof Root>) {
 return <Root {...props} orientation={orientation} className={composeRenderProps(className, (className) => buttonGroupVariants({ orientation, className }))} />;
}
` },
  link: { parts: ["button"], name: "Link", members: { "appearance.inline": "Link.appearance=inline", "appearance.button": "Link.appearance=button" }, code: `
import { type ComponentProps } from "react";
import { LinkButton } from "../_parts/rail-button/index";
type Props = ComponentProps<typeof LinkButton> & { appearance?: "inline" | "button" };
export function Link({ appearance = "inline", className, ...props }: Props) {
 return <LinkButton {...props} variant={appearance === "inline" ? "link" : props.variant} className={[appearance === "inline" ? "h-auto p-0" : "", className].filter(Boolean).join(" ")} />;
}
` },
  "native-action": { parts: ["native-button-variants"], name: "NativeAction", members: { "appearance.primary": "NativeAction", "size.md": "NativeAction", "ground.base": "NativeAction", "state.hover": "NativeAction:hovered", "state.pressed": "NativeAction:pressed", "state.focus-visible": "NativeAction:focus-visible", "state.disabled": "NativeAction.disabled=true" }, code: `
import { type ComponentProps } from "react";
import { buttonVariants } from "../_parts/rail-native-button-variants/index";
export function NativeAction({ className, ...props }: ComponentProps<"button">) {
 return <button {...props} className={buttonVariants({ variant: "default", size: "default", className })} />;
}
` },
};

function importInputLeaves() {
  const byItem = new Map(data.files.map(file => [file.item, file]));
  const style = byItem.get("style")!, license = byItem.get("license")!;
  const all = new Map<string, SourceFile>();
  const fills: ComponentCandidateDocument[] = [], sourceBundles: SourceBundle[] = [], candidates = [];
  const rewrites: Record<string, ReturnType<typeof rewriteShadcnAria>> = {};
  for (const leaf of SHADCN_ARIA_INPUT_LEAVES) {
    const spec = inputSources[leaf], closure = new Set<string>();
    const visit = (item: string): void => {
      if (closure.has(item)) return; closure.add(item);
      if (item === "native-button-variants") return;
      const file = byItem.get(item); if (!file) throw new Error(`shadcn-inputs: missing part ${item}`);
      dependencies(file.content).forEach(visit);
    };
    spec.parts.forEach(visit);
    const files: SourceFile[] = [], tokens = new Set<string>(), assets = new Set<string>();
    const issues: ReturnType<typeof rewriteShadcnAria>["issues"][number][] = [];
    for (const item of closure) {
      const original = byItem.get(item === "native-button-variants" ? "button" : item)!;
      let source = original.content;
      if (item === "native-button-variants") {
        const variants = /^const buttonVariants = cva\([\s\S]*?\n\)\n/m.exec(source)?.[0];
        if (!variants) throw new Error("shadcn-inputs: button variants source changed");
        source = 'import { cva } from "class-variance-authority"\n' + variants + '\nexport { buttonVariants }\n';
      }
      // Exact style restyles remain visible token bindings, never literal scanner exceptions.
      source = source.replace(/(?<![a-z-])mt-px/g, "mt-(--spacing-xs)").replace(/(?<![a-z-])mx-px/g, "mx-(--spacing-xs)").replace(/(?<![a-z-])my-px/g, "my-(--spacing-xs)");
      const result = rewriteShadcnAria({ item: item === "native-button-variants" ? "button" : item, leaf: item === "native-button-variants" ? "button" : item, files: [{ path: `components/_parts/rail-${item}/${item}.tsx`, content: source }], styles: style.content, leafByItem: {}, transformVersion: 2, retainRegistryButtonProps: true });
      result.reads.tokens.forEach(token => tokens.add(token)); result.reads.assets.forEach(asset => assets.add(asset)); issues.push(...result.issues);
      if (source.includes("--spacing-xs")) tokens.add("tokens.spacing.xs");
      for (const file of result.files) {
        let content = file.content.replace(/(_parts\/)(?!rail-)([a-z-]+)\//g, "$1rail-$2/")
          .replace(/(?<![a-z-])(?:ml-|mr-|pl-|pr-|left-|right-|text-left|text-right|border-l-|border-r-|rounded-l-|rounded-r-)/g, atom => ({ "ml-": "ms-", "mr-": "me-", "pl-": "ps-", "pr-": "pe-", "left-": "start-", "right-": "end-", "text-left": "text-start", "text-right": "text-end", "border-l-": "border-s-", "border-r-": "border-e-", "rounded-l-": "rounded-s-", "rounded-r-": "rounded-e-" })[atom]!);
        if (!/import\s+(?:\*\s+as\s+React|type\s+\*\s+as\s+React)/.test(content) && /\bReact\./.test(content)) content = 'import type * as React from "react"\n' + content;
        files.push({ ...file, content });
      }
      files.push({ path: `components/_parts/rail-${item}/index.ts`, content: `export { ${exportsOf(source).join(", ")} } from "./${item}"\n` });
      if (item === "input") {
        const input = result.files[0]!.content;
        const start = input.indexOf('cn(', input.indexOf('className={')), end = input.indexOf(',\n          className', start);
        if (start < 0 || end < 0) throw new Error("shadcn-inputs: input class source changed");
        const expression = input.slice(start + 'cn('.length, end).trim();
        files.push({ path: "components/_parts/rail-input-classes/index.ts", content: `export const inputClasses = [${expression}].join(" ")\n` });
      }
    }
    if (files.some(file => file.content.includes("rail-utils/index"))) files.push({ path: "components/_parts/rail-utils/index.ts", content: utils });
    const entry = `components/${leaf}/${leaf}.tsx`;
    for (const file of files) { file.path = file.path.replaceAll("rail-", "rail-u1-"); file.content = file.content.replaceAll("rail-", "rail-u1-"); }
    const hasCopy = ["search-field", "number-field", "tag-group"].includes(leaf);
    const copyImport = 'import { inputCopy, INPUT_COPY_REFS, type InputCopyResolver } from "../_parts/rail-u1-copy/index";\n';
    files.push({ path: entry, content: (hasCopy ? copyImport : "") + spec.code.trimStart().replaceAll("rail-", "rail-u1-") });
    if (hasCopy) files.push({ path: "components/_parts/rail-u1-copy/index.ts", content: inputCopySource });
    if (leaf === "form") {
      files.splice(0, files.length, ...files.filter(file => file.path === entry));
      tokens.clear(); assets.clear();
    }
    if (leaf === "native-action") for (const file of files) {
      file.path = file.path.replace("components/_parts/rail-u1-native-button-variants/native-button-variants.tsx", "components/native-action/button-variants.tsx");
      file.content = file.content.replaceAll("../_parts/rail-u1-native-button-variants/index", "./button-variants");
    }
    if (leaf === "native-action") files.splice(0, files.length, ...files.filter(file => !file.path.startsWith("components/_parts/")));
    const notice = ["form", "native-action"].includes(leaf) ? `notices/${leaf}.md` : "notices/SHADCN-ARIA-INPUTS.md";
    files.push({ path: notice, content: `# Third-party notice\n\nSource: ${adapter.pin.url}\nCommit: ${data.commit}\nTransform: shadcn-aria-rewrite@2\n\n${license.content}` });
    const unique = [...new Map(files.map(file => [file.path, file])).values()].sort((a,b) => a.path.localeCompare(b.path));
    for (const file of unique) {
      const previous = all.get(file.path); if (previous && previous.content !== file.content) throw new Error(`shadcn-inputs: conflicting part ${file.path}`);
      all.set(file.path, file);
    }
    const upstream = [...closure].map(item => byItem.get(item === "native-button-variants" ? "button" : item)!).concat(style, license);
    const pin = { url: adapter.pin.url, commit: data.commit, files: upstream.map(file => ({ path: file.path, sha256: file.sha256 })).sort((a,b) => a.path.localeCompare(b.path)) };
    const composedInputs = leaf === "form" ? ["components.field"] : leaf === "native-action" ? ["components.button"] : [];
    const descriptor = { slot: `components.${leaf}`, source: "shadcn@aria", root: slots.find(slot => slot.id === `components.${leaf}`)!.contract.root, members: Object.keys(spec.members), props: [], propMap: spec.members, reads: { tokens: sorted(tokens), assets: sorted(assets), components: composedInputs }, composes: composedInputs, impl: { kind: "source", entry, export: spec.name }, ...(leaf === "date-field" ? { secondaryExports: [{ name: "TimeField", export: "TimeField" }] } : leaf === "field" ? { secondaryExports: [{ name: "FieldGroup", export: "FieldGroup" }, { name: "FieldSet", export: "FieldSet" }] } : {}), license: "MIT", pin, notice, transform: "shadcn-aria-rewrite@2", item: leaf, deps: [{ name: "react", version: "19.3.0", license: "MIT" }, ...(leaf === "native-action" ? [] : [{ name: "react-aria-components", version: "1.21.1", license: "Apache-2.0" }]), { name: "class-variance-authority", version: "0.7.1", license: "Apache-2.0" }, { name: "clsx", version: "2.1.1", license: "MIT" }, { name: "tailwind-merge", version: "3.7.0", license: "MIT" }], outputSha256: unique.map(file => ({ path: file.path, sha256: sha256(file.content) })), blockers: issues, ...(leaf === "native-action" ? {} : { rac: { instance: "react-aria-components", range: "^1.21.1", peer: false } }) };
    const document = { $extensions: { "com.clossys.fill": { id: `shadcn@aria/components.${leaf}`, slot: descriptor.slot, source: "shadcn@aria", mode: "implementation", sourceAddress: `${adapter.pin.url}/blob/${data.commit}/${upstream[0]!.path}`, relation: "same-contract", builtOn: [], conforms: [], evidence: [], author: "third-party", trust: "pinned-upstream", license: "MIT", status: "draft", pin: { url: adapter.pin.url, commit: data.commit, sha256: upstream[0]!.sha256 }, unmapped: [], ...(composedInputs.length ? { originKinds: ["composed"] } : {}) } }, components: { [leaf]: descriptor } } as unknown as ComponentCandidateDocument;
    fills.push(document);
    const descriptorHash = componentDescriptorHash(Object.values(document.components)[0]!);
    const bundle = { slot: descriptor.slot, descriptorHash, transform: descriptor.transform, upstream: upstream.map(({path,content})=>({path,content})), files: unique, blockers: issues };
    if (!issues.length) sourceBundles.push(bundle);
    candidates.push({ fill: `shadcn@aria/${descriptor.slot}`, slot: descriptor.slot, descriptorHash, transform: descriptor.transform, upstreamFiles: bundle.upstream, outputFiles: unique, blockers: issues, status: issues.length ? "blocked" as const : "ready" as const });
    rewrites[leaf] = { transform: "shadcn-aria-rewrite@2", files: unique, outputSha256: descriptor.outputSha256, reads: descriptor.reads, parts: [...closure], issues };
  }
  return { fills, sourceBundles, candidates, rewrites, files: [...all.values()] };
}

/** Structural presentation seam, matching Banner.copy; locale/approval/ICU stay host-owned. */
const inputCopySource = `
export const INPUT_COPY_REFS = { searchClear: { id: "st.kcathn07y7" }, numberIncrement: { id: "st.46j4bj35p9" }, numberDecrement: { id: "st.vc888ap8qn" }, tagRemove: { id: "st.cxp8286800" } } as const;
type Ref = { id: string; values?: Readonly<Record<string, string | number | boolean>> };
export type InputCopyResolver = (ref: Ref) => { ref: Ref; text: string } | undefined;
export function inputCopy(copy: InputCopyResolver | undefined, key: keyof typeof INPUT_COPY_REFS, explicit?: string, values?: Ref["values"]): string {
  if (explicit?.trim()) return explicit;
  const ref = { ...INPUT_COPY_REFS[key], ...(values ? { values } : {}) };
  const resolved = copy?.(ref);
  if (!resolved || resolved.ref.id !== ref.id || !resolved.text.trim()) throw new TypeError("Input copy requires host resolution or explicit labels");
  return resolved.text;
}
`;
