/**
 * Structure criteria shared across kinds: citation grammar, ICU messages, declared props, allowed
 * compositions and APG roles.
 */
import { AGENT_LISTS } from "../../../agent-lists.generated.js";
import { excerpt, isRecord, strings, stringLeaves, tags } from "./lib.js";
import type { Criterion } from "./types.js";

const AGENT = `(?:${AGENT_LISTS.live.join("|")})`;
const SLOT = "[a-z][a-z0-9-]*(?:\\.[a-z0-9][a-z0-9-]*){1,3}";
/** A citation `[<agent>:]<slot-id>[#<key>]` (section 1); a version suffix is illegal. */
export const CITATION = new RegExp(`^(?:${AGENT}:)?${SLOT}(?:#[^\\s#@]+)?$`);

/** Every `ref` value in the subject: JSON `ref` fields at any depth and `ref:` lines of the text. */
function refs(subject: { text: string; json?: unknown }): string[] {
  const found = stringLeaves(subject.json).filter(leaf => /(?:^|\.)ref$/.test(leaf.path)).map(leaf => leaf.value);
  for (const match of subject.text.matchAll(/^\s*-?\s*ref:\s*["']?([^"'\n]+?)["']?\s*$/gm)) found.push(match[1]!);
  return found;
}

/** citation.grammar: every citation (each `ref`) is `[<agent>:]<slot-id>[#<key>]`, and no slot citation carries a version suffix. */
export const citationGrammar: Criterion = subject => {
  const failures = refs(subject).filter(ref => !CITATION.test(ref)).map(ref => `citation "${ref}" is not [<agent>:]<slot-id>[#<key>]`);
  for (const match of subject.text.matchAll(new RegExp(`(?<![\\w./-])(?:${AGENT}:)?${SLOT}@v?\\d+\\b`, "g"))) failures.push(`citation "${match[0]}" carries a version suffix`);
  return [...new Set(failures)];
};

const PLURAL_KEYS = /^(?:=\d+|zero|one|two|few|many|other)$/;
/** The issues of one ICU MessageFormat string: balanced braces, and plural/select arguments with an `other` case. */
export function icuIssues(message: string): string[] {
  const issues: string[] = [];
  let depth = 0;
  for (const char of message.replace(/'[^']*'/g, "")) {
    if (char === "{") depth++;
    if (char === "}" && --depth < 0) { issues.push("unbalanced }"); depth = 0; }
  }
  if (depth > 0) issues.push("unclosed {");
  if (issues.length) return issues;
  for (const match of message.matchAll(/\{\s*[\w.]+\s*,\s*(plural|select|selectordinal)\s*,/g)) {
    // Walk the cases of this argument at its own depth.
    let at = match.index! + match[0].length, level = 0, key = "";
    const keys: string[] = [];
    for (; at < message.length; at++) {
      const char = message[at]!;
      if (char === "{") { if (level === 0) { keys.push(key.trim().replace(/^offset:\d+\s*/, "")); key = ""; } level++; }
      else if (char === "}") { if (level === 0) break; level--; }
      else if (level === 0) key += char;
    }
    if (!keys.includes("other")) issues.push(`${match[1]} argument has no "other" case`);
    if (match[1] !== "select") for (const key of keys) if (!PLURAL_KEYS.test(key)) issues.push(`${match[1]} case "${key}" is not a plural category`);
  }
  return issues;
}

/** icu.valid: every string of the subject (JSON string leaves, else the text) is a valid ICU message. */
export const icuValid: Criterion = subject => {
  const leaves = subject.json === undefined ? [{ path: "text", value: subject.text }] : stringLeaves(subject.json);
  return leaves.flatMap(leaf => icuIssues(leaf.value).map(issue => `${leaf.path || "text"}: ${issue}`));
};

/** The prop names a component declares: JSON `props` (names or keys), else the members of its `*Props` interface or type. */
function declaredProps(subject: { text: string; json?: unknown }): Set<string> {
  const json = isRecord(subject.json) ? subject.json.props : undefined;
  if (Array.isArray(json)) return new Set(strings(json));
  if (isRecord(json)) return new Set(Object.keys(json));
  const names = new Set<string>();
  for (const block of subject.text.matchAll(/(?:interface\s+\w*Props(?:\s+extends[^{]+)?|type\s+\w*Props\s*=[^{]*)\s*\{([^}]*)\}/g)) {
    for (const member of block[1]!.matchAll(/^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\??\s*:/gm)) names.add(member[1]!);
  }
  return names;
}

/** props.declared: every `params.required` prop is declared, and none of `params.forbidden` is. */
export const propsDeclared: Criterion = (subject, params) => {
  const props = declaredProps(subject);
  return [
    ...strings(params.required).filter(name => !props.has(name)).map(name => `prop ${name} is not declared`),
    ...strings(params.forbidden).filter(name => props.has(name)).map(name => `prop ${name} must not be declared`),
  ];
};

/** composes.allowed: every `@/` import (and every JSON `uses` entry) starts with an entry of `params.allowed`. */
export const composesAllowed: Criterion = (subject, params) => {
  const allowed = strings(params.allowed);
  const used = [...subject.text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)["'](@\/[^"']+)["']/g)].map(match => match[1]!);
  if (isRecord(subject.json)) used.push(...strings(subject.json.uses));
  const ok = (target: string) => allowed.some(prefix => target === prefix || target.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`));
  return [...new Set(used.filter(target => !ok(target)))].map(target => `composes ${target}, which the contract does not allow`);
};

/** WAI-ARIA 1.2 roles (abstract roles excluded). */
export const ARIA_ROLES = new Set(("alert alertdialog application article banner blockquote button caption cell checkbox code columnheader combobox complementary contentinfo definition deletion dialog directory document emphasis feed figure form generic grid gridcell group heading img insertion link list listbox listitem log main marquee math menu menubar menuitem menuitemcheckbox menuitemradio meter navigation none note option paragraph presentation progressbar radio radiogroup region row rowgroup rowheader scrollbar search searchbox separator slider spinbutton status strong subscript superscript switch tab table tablist tabpanel term textbox time timer toolbar tooltip tree treegrid treeitem").split(" "));
/** The states and properties the APG patterns require on an element with each role (any one of a list). */
const REQUIRED: Readonly<Record<string, readonly string[][]>> = {
  checkbox: [["aria-checked", "checked", "defaultChecked", "isSelected"]],
  switch: [["aria-checked", "checked", "defaultChecked", "isSelected"]],
  radio: [["aria-checked", "checked", "defaultChecked"]],
  slider: [["aria-valuenow", "value", "defaultValue"]],
  tab: [["aria-selected"]],
  combobox: [["aria-expanded"]],
  dialog: [["aria-label", "aria-labelledby"]],
  alertdialog: [["aria-label", "aria-labelledby"]],
  heading: [["aria-level"]],
  scrollbar: [["aria-controls"], ["aria-valuenow"]],
};
/** apg.roles: every `role` is a WAI-ARIA role (or one of `params.extraRoles`), carrying the states its APG pattern requires. */
export const apgRoles: Criterion = (subject, params) => {
  const extra = new Set(strings(params.extraRoles));
  const failures: string[] = [];
  for (const tag of tags(subject.text)) {
    const role = tag.attrs.get("role");
    if (role === undefined) continue;
    if (!ARIA_ROLES.has(role) && !extra.has(role)) { failures.push(`role "${role}" is not a WAI-ARIA role: ${excerpt(tag.source)}`); continue; }
    for (const anyOf of REQUIRED[role] ?? []) if (!anyOf.some(attr => tag.attrs.has(attr))) failures.push(`role ${role} needs ${anyOf.join(" or ")}: ${excerpt(tag.source)}`);
  }
  return failures;
};
