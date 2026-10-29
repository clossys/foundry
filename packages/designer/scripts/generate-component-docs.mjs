#!/usr/bin/env node
// Repository tooling: this script does not ship in the installed package.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const packageRoot = new URL("../", import.meta.url);
export const componentDocsPath = new URL("skill/components-guide.md", packageRoot);
export const componentSkillPath = new URL("skill/SKILL.md", packageRoot);
const start = "<!-- component-selection:start -->", end = "<!-- component-selection:end -->";
const code = value => {
  const text = String(value).replaceAll("\n", " ");
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map(match => match[0].length));
  const fence = "`".repeat(longest + 1);
  const padding = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${padding}${text}${padding}${fence}`;
};
export const tableCode = value => code(value).replaceAll("|", "\\|");
const name = () => JSON.parse(readFileSync(new URL("package.json", packageRoot), "utf8")).name;

export async function componentData() {
  const source = readFileSync(new URL("src/components/guidance/internal/data.ts", packageRoot), "utf8");
  const parsed = ts.createSourceFile("guidance.ts", source, ts.ScriptTarget.ES2022, true);
  if (parsed.statements.some(statement => ts.isImportDeclaration(statement) || ts.isImportEqualsDeclaration(statement))) throw new Error("Component runtime guidance must be import-free.");
  const { outputText, diagnostics } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }, reportDiagnostics: true });
  if (diagnostics?.some(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)) throw new Error("Cannot transpile component guidance.");
  const data = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
  const ids = Object.keys(data.COMPONENT_GUIDANCE).sort();
  if (!ids.length || JSON.stringify(ids) !== JSON.stringify(Object.keys(data.COMPONENT_API_FACTS).sort())) throw new Error("Guidance and checked facts must cover the same nonempty set exactly once.");
  const aliasSource = readFileSync(new URL("src/catalog/component-aliases.ts", packageRoot), "utf8");
  const aliasJS = ts.transpileModule(aliasSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const { resolveComponentId } = await import(`data:text/javascript;base64,${Buffer.from(aliasJS).toString("base64")}`);
  const tree = JSON.parse(readFileSync(new URL("src/catalog/ia/components.json", packageRoot), "utf8")).nodes;
  const placed = new Set();
  const groups = tree.map(group => ({ ...group, families: group.children.map(family => ({ ...family, components: ids.filter(id => family.leaves.includes(resolveComponentId(id))).map(id => (placed.add(id), id)) })) }));
  const unplaced = ids.filter(id => !placed.has(id));
  return { ...data, COMPONENT_DISPLAY_TREE: tree, documentationGroups: [...groups, ...(unplaced.length ? [{ label: "Legacy guidance outside navigation", families: [{ label: "Unregistered legacy metadata", components: unplaced }] }] : [])] };

}

export function generateComponentSkillSection() {
  return [start, "### Component selection", "",
    `Use ${code("COMPONENT_GUIDANCE")}, ${code("COMPONENT_API_FACTS")} and ${code("COMPONENT_COMPARISON")} from ${code(`${name()}/components`)}. Import ${code("COMPONENT_DISPLAY_TREE")}, ${code("ComponentDisplayTree")}, ${code("resolveComponentId")} and ${code("componentSelection")} from ${code(`${name()}/catalog`)}. The components barrel remains client-only. Import safety (${code("RENDER_ENVIRONMENT")}) is not medium support.`,
    `Read the installed companion at ${code(`node_modules/${name()}/skill/components-guide.md`)}; the launcher does not copy that file.`,
    '`COMPONENT_COMPARISON` declares finite columns and optional rows with at most 24 cells. Its `constraints` references the original rules; `constraintPolicy: "skip-violations"` skips only `requires`, `exclusive` and `paired` violations with complete authored inputs. Applicability (`effective-when`), ignored-option, `derived` and `data` rules never skip cells.',
    "Display Group > Family > Component follows authoritative catalog IA. Only canonical leaves are selectable; legacy IDs including act.link and reveal.tabs retain guidance. Unregistered legacy metadata stays outside navigation.",
    "Choose stable purpose, content and anatomy first, then medium implementation and configuration. Web is implemented with source evidence; email, print and video remain unassessed.",
    "Button has seven coupled Style preset values, not independent intent or emphasis axes. Respect ignored-option applicability, paired requirements, Icon naming/content contracts and severity/shape derivation. Represented scalar options are a bounded selection, not an exhaustive inherited API or a Cartesian product.",
    "Package support and consumer-owned demonstrations are separate. Unknown demonstration coverage, fixed controlled values and one-option fixtures prove no interaction. Callbacks, style and arbitrary children are authored inputs, not configuration axes. Token dependencies identify partial direct/transitive evidence, not every imported helper token.",
    "Regenerate with `node scripts/generate-component-docs.mjs`; verify with `node scripts/check-component-docs.mjs`. Both are repository tooling and do not ship in the installed package.", end].join("\n");
}

export function replaceComponentSkillSection(skill, replacement) {
  if (skill.split(start).length !== 2 || skill.split(end).length !== 2 || skill.indexOf(end) < skill.indexOf(start)) throw new Error("Component selection requires one ordered marker pair.");
  return skill.slice(0, skill.indexOf(start)) + replacement + skill.slice(skill.indexOf(end) + end.length);
}

export async function generateComponentDocs() {
  const { COMPONENT_GUIDANCE: guidance, COMPONENT_API_FACTS: facts, COMPONENT_DISPLAY_TREE: tree, documentationGroups: groups } = await componentData();
  const lines = ["# Component selection guide", "", "<!-- Generated by scripts/generate-component-docs.mjs. Edit shared source data and regenerate. Repository tooling does not ship. -->", "",
    `Import the shared records from ${code(`${name()}/components`)}. Import navigation and selection from ${code(`${name()}/catalog`)}. The components barrel remains client-only; charts render through the existing ${code(`${name()}/charts`)} entry point. No new package subpath is introduced.`, "",
    `${Object.keys(guidance).length} legacy guidance records appear once below. Navigation follows ${tree.length} authoritative IA groups and ${tree.flatMap(group => group.children).length} families with canonical leaf IDs. Unregistered legacy guidance appears separately, outside navigation.`, "",
    "Stable purpose, content and anatomy are separate from medium-specific implementation. Web cites current source; email, print and video are unassessed. Import safety, server rendering and visual resemblance establish no other medium’s support.", "",
    "Represented scalar options are a bounded source-checked selection, not an exhaustive inherited API or a Cartesian product. Defaults distinguish local initializers, inherited peer behavior and omitted/conditional values. Data, compound parts, callbacks, style and arbitrary children are authored inputs rather than selectable configuration axes.", "",
    '`COMPONENT_COMPARISON` declares preferred finite columns and optional rows for comparison; `maxCells` equals their product at no more than 24. `ComponentComparison` describes this data-only contract. Its `constraints` references original rules; `constraintPolicy: "skip-violations"` skips only `requires`, `exclusive` and `paired` violations with complete authored inputs. Applicability (`effective-when`), ignored-option, `derived` and `data` rules never skip cells. Components without finite options have no comparison entry.', "",
    "Consumer-owned demonstration coverage is unassessed here. A fixed controlled value or a single option cannot demonstrate toggling or switching. Runtime acceptance, visual effectiveness and type/runtime rejection differ. Token evidence is partial and distinguishes direct reads from transitive bindings; importing a helper does not consume all its tokens.", "",
    "## Display taxonomy", "", "| Group | Families | Leaves |", "| --- | --- | ---: |",
    ...tree.map(group => `| ${group.label} | ${group.children.map(family => family.label).join(", ")} | ${group.children.flatMap(family => family.leaves).length} |`), "", "## Component reference"];
  for (const group of groups) {
    lines.push("", `### ${group.label}`);
    for (const family of group.families) {
      lines.push("", `#### ${family.label}`);
      for (const id of family.components) {
        const entry = guidance[id], fact = facts[id], web = entry.media.web.implementation;
        lines.push("", `##### ${code(id)} — ${fact.exportName}`, "",
          ...[["Purpose", "purpose"], ["Use when", "useWhen"], ["Avoid when", "avoidWhen"], ["Alternatives and boundary", "alternatives"], ["Content", "content"], ["Anatomy", "anatomy"], ["Block composition example", "composition"], ["Accessibility", "accessibility"]].map(([label, key]) => `- ${label}: ${entry[key]}`),
          `- Demonstration coverage: ${entry.demonstration.state}. ${entry.demonstration.reason}`, "",
          "| Medium | State | Reason and evidence |", "| --- | --- | --- |",
          ...Object.entries(entry.media).map(([medium, value]) => `| ${medium} | ${value.state} | ${value.reason} Evidence: ${value.evidence.map(tableCode).join("; ")} |`), "",
          `Web implementation: ${code(`${name()}/${web.entrypoint}`)} → ${code(web.exportName)}. Source: ${code(fact.source)}. ${web.notes}`, "");
        if (web.options.length) {
          lines.push("| Prop | Selection guidance | Package default | Applicability and support |", "| --- | --- | --- | --- |");
          for (const option of web.options) {
            const checked = fact.options.find(item => item.prop === option.prop), def = checked.default;
            const defaultText = def.kind === "value" ? `${tableCode(def.value)} (${tableCode(def.source)}: ${tableCode(def.evidence)})` : `${def.kind}: ${def.reason}`;
            lines.push(`| ${tableCode(option.prop)} — ${option.label} | ${option.values.map(value => `${tableCode(value.value)}: ${value.purpose}`).join("<br>")} | ${defaultText} | ${option.applicability} ${option.support.state}: ${option.support.reason} Evidence: ${tableCode(checked.forwarding.source)}: ${tableCode(checked.forwarding.evidence)} |`);
          }
          lines.push("");
        } else lines.push("No finite scalar options are represented here; read the real prop type for authored content and data.", "");
        for (const rule of web.constraints) lines.push(`- ${rule.kind} (${rule.enforcement}; ${rule.props.map(code).join(", ")}): ${rule.reason} Evidence: ${code(rule.evidence.source)}: ${code(rule.evidence.evidence)}.`);
        lines.push("", `Token dependency coverage: ${fact.tokens.coverage}. ${fact.tokens.reason}`);
        for (const token of fact.tokens.dependencies) lines.push(`- ${code(token.property)} (${token.kind}): ${code(token.source)}: ${code(token.evidence)}${token.via.length ? `; consumed via ${token.via.map(edge => `${code(edge.source)}: ${code(edge.evidence)}`).join(" → ")}` : ""}.`);
      }
    }
  }
  lines.push("", "## Maintain the shared contract", "", "Import `COMPONENT_DISPLAY_TREE`, `ComponentDisplayTree`, `resolveComponentId` and `componentSelection` from the public catalog entry; guidance records and types come from the components entry. Read `COMPONENT_GUIDANCE` for curated selection semantics and medium evidence, `COMPONENT_API_FACTS` for checked facts, `COMPONENT_DISPLAY_TREE` for placement, and `COMPONENT_COMPARISON` for finite comparison axes. `ComponentGuidance`, `ComponentApiFacts`, `ComponentDisplayTree` and `ComponentComparison` describe their shapes; the README lists supporting types. Consumers reference these records rather than copying guidance.", "", "Regenerate with `node scripts/generate-component-docs.mjs`; check freshness with `node scripts/check-component-docs.mjs`. These are repository-only commands and do not ship in the installed package. The checker compares this whole guide and the skill selection section byte for byte using source, without installed dist or timestamps.", "");
  return lines.join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  writeFileSync(componentDocsPath, await generateComponentDocs());
  writeFileSync(componentSkillPath, replaceComponentSkillSection(readFileSync(componentSkillPath, "utf8"), generateComponentSkillSection()));
  console.log("Component guide and skill selection generated from shared source.");
}
