import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sha = text => createHash("sha256").update(text).digest("hex");
const rail = JSON.parse(await readFile(resolve(root, "src/importers/vendor/shadcn-aria-rail.data.json"), "utf8"));
const path = "src/frames/shadcn-aria/AppShell.tsx";
let content = await readFile(resolve(root, path), "utf8");
const bindings = [];
content = content.replace(/import \{ ([^}]+) \} from "\.\.\/\.\.\/components\/index\.js";/, (_statement, list) => {
  const groups = new Map();
  for (const name of list.split(",").map(value => value.trim())) {
    const leaf = name.startsWith("Sidebar") ? "sidebar" : name.startsWith("Sheet") ? "sheet" : ({ SemanticContent: "semantic-content", Button: "button", Logomark: "logo", Menu: "menu" })[name];
    if (!leaf) throw new Error("Unbound frame component " + name);
    const exported = name === "Logomark" ? "Logo" : name;
    const module = `../../components/${leaf}/index.js`;
    bindings.push({ file: "frames/app-shell/AppShell.tsx", module, name: exported, local: name, slot: `components.${leaf}` });
    const values = groups.get(module) ?? []; values.push(exported === name ? name : `${exported} as ${name}`); groups.set(module, values);
  }
  return [...groups].map(([module, names]) => `import { ${names.join(", ")} } from ${JSON.stringify(module)};`).join("\n");
});
for (const [from, to] of [
  ["../../components/index.js", "@clossys/designer/components"],
  ["../../blocks/index.js", "@clossys/designer/blocks"],
  ["../../theme/index.js", "@clossys/designer/theme"],
  ["../../shell/FrameSlots.js", "@clossys/designer/shell"],
  ["../../shell/SkipLink.js", "@clossys/designer/shell"],
  ["../InspectorFrame.js", "@clossys/designer/frames"],
  ["../../components/Banner.copy-context.js", "@clossys/designer/frames"],
  ["../../components/Banner.copy.js", "@clossys/designer/frames"],
  ["../app-frame-types.js", "@clossys/designer/frames"],
]) content = content.replaceAll(JSON.stringify(from), JSON.stringify(to));
content = content.replace('import { ShellI18nProvider } from "#designer-frame-i18n";', 'import { I18nProvider as ShellI18nProvider } from "react-aria-components";');
const files = rail.files.filter(file => ["sidebar", "license"].includes(file.item)).map(({ path, content, sha256 }) => ({ path, content, sha256 }));
const data = { commit: rail.commit, upstream: files, port: { path, sha256: sha(await readFile(resolve(root, path), "utf8")) }, output: { path: "frames/app-shell/AppShell.tsx", content }, bindings };
await writeFile(resolve(root, "src/importers/vendor/shadcn-app-shell.data.json"), JSON.stringify(data, null, 2) + "\n");
