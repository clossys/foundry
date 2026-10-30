import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sha = text => createHash("sha256").update(text).digest("hex");
const rail = JSON.parse(await readFile(resolve(root, "src/importers/vendor/shadcn-aria-rail.data.json"), "utf8"));
const animation = JSON.parse(await readFile(resolve(root, "src/catalog/fills/foundry/tokens.animation.json"), "utf8"));
const sources = [
  ["src/frames/shadcn-aria/AppShell.tsx", "frames/app-shell/AppShell.tsx"],
  ["src/frames/shadcn-aria/chrome.tsx", "frames/app-shell/chrome.tsx"],
  ["src/frames/PageFrame.tsx", "frames/app-shell/PageFrame.tsx"],
  ["src/frames/ModuleFrame.tsx", "frames/app-shell/ModuleFrame.tsx"],
];
const bindings = [], ports = [], outputs = [];
for (const [path, destination] of sources) {
  const original = await readFile(resolve(root, path), "utf8");
  ports.push({ path, sha256: sha(original) });
  let content = original.replace(/import \{ ([^}]+) \} from "(?:\.\.\/){1,2}components\/index\.js";/g, (_statement, list) => {
    const groups = new Map();
    for (const name of list.split(",").map(value => value.trim())) {
      const leaf = name.startsWith("Sidebar") ? "sidebar" : name.startsWith("Sheet") ? "sheet" : ({ SemanticContent: "semantic-content", Button: "button", Logomark: "logo", Menu: "menu", Breadcrumb: "breadcrumbs", Tooltip: "tooltip", Disclosure: "disclosure" })[name];
      if (!leaf) throw new Error("Unbound frame component " + name);
      const exported = ({ Logomark: "Logo", Breadcrumb: "Breadcrumbs" })[name] ?? name;
      const module = `../../components/${leaf}/index.js`;
      bindings.push({ file: destination, module, name: exported, local: name, slot: `components.${leaf}` });
      const values = groups.get(module) ?? []; values.push(exported === name ? name : `${exported} as ${name}`); groups.set(module, values);
    }
    return [...groups].map(([module, names]) => `import { ${names.join(", ")} } from ${JSON.stringify(module)};`).join("\n");
  });
  if (content.includes('import { Icon as AssetIcon } from "../../components/icon/index.js";')) bindings.push({ file: destination, module: "../../components/icon/index.js", name: "Icon", local: "AssetIcon", slot: "components.icon" });
  for (const [from, to] of [
    ["../../blocks/index.js", "@clossys/designer/blocks"],
    ["../../theme/index.js", "@clossys/designer/theme"],
    ["../../shell/FrameSlots.js", "@clossys/designer/shell"],
    ["../../shell/SkipLink.js", "@clossys/designer/shell"],
    ["../../components/Banner.copy-context.js", "@clossys/designer/frames"],
    ["../../components/Banner.copy.js", "@clossys/designer/frames"],
    ["../app-frame-types.js", "@clossys/designer/frames"],
    ["../PageFrame.js", "./PageFrame.js"],
    ["./shadcn-aria/chrome.js", "./chrome.js"],
  ]) content = content.replaceAll(JSON.stringify(from), JSON.stringify(to));
  content = content.replace('import { ShellI18nProvider } from "#designer-frame-i18n";', 'import { I18nProvider as ShellI18nProvider } from "react-aria-components";');
  content = content.replace('import animation from "../../catalog/fills/foundry/tokens.animation.json" with { type: "json" };', `const animation = ${JSON.stringify(animation)};`);
  // The canonical consumer Button facade names its icon shape independently from size.
  content = content.replace('<Button variant="ghost" size="md" data-page-action=', '<Button variant="ghost" shape="icon-only" data-page-action=');
  outputs.push({ path: destination, content });
}
const upstream = rail.files.filter(file => ["sidebar", "license"].includes(file.item)).map(({ path, content, sha256 }) => ({ path, content, sha256 }));
const data = { commit: rail.commit, upstream, port: ports[0], ports, output: outputs[0], outputs, bindings };
await writeFile(resolve(root, "src/importers/vendor/shadcn-app-shell.data.json"), JSON.stringify(data, null, 2) + "\n");
