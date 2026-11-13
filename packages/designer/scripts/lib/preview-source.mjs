/** The one deterministic emitted-module -> preview-runtime transform, shared by the generator and the checks that verify its bytes. */
import { posix } from "node:path";

const logical = { "left-": "start-", "right-": "end-", "ml-": "ms-", "mr-": "me-", "pl-": "ps-", "pr-": "pe-", "border-l-": "border-s-", "border-r-": "border-e-", "rounded-l-": "rounded-s-", "rounded-r-": "rounded-e-", "text-left": "text-start", "text-right": "text-end" };
function previewSource(content, path) {
  let code = content.replace(/(?<![\w-])(?:-?(?:left|right)-|[mp][lr]-|border-[lr]-|rounded-[lr]-|text-(?:left|right)(?![\w-]))/g, token => (token.startsWith("-") ? "-" : "") + logical[token.startsWith("-") ? token.slice(1) : token]).replaceAll("max-w-xs", "max-w-[20rem]").replaceAll("max-w-sm", "max-w-[24rem]");
  if (path.endsWith("/dialog.tsx") || path.endsWith("/radio-group.tsx")) code = code.replaceAll("-translate-x-1/2 ", "-translate-x-1/2 rtl:translate-x-1/2 ");
  return code;
}

/**
 * Public barrel bindings whose defining Designer module is known. A named import that takes only
 * such bindings relocates to that module, not the barrel: the rail host's `cn` (its declared
 * `source`, components/_parts/utils) through the components barrel loaded every component, so the
 * shell's stock sheet reached RichText and rejected without the optional tiptap peers (WD-REG).
 */
const DEFINING_MODULE = { "@clossys/designer/components": { cn: "components/_parts/utils" } };
function narrowBarrelImports(content) {
  return content.replace(/(import\s*\{([^}]*)\}\s*from\s*["'])(@clossys\/designer\/[^"']+)(["'])/g, (all, before, names, specifier, after) => {
    const homes = new Set(names.split(",").map(part => part.trim()).filter(Boolean).map(part => DEFINING_MODULE[specifier]?.[part.split(/\s+as\s+/)[0]]));
    return homes.size === 1 && !homes.has(undefined) ? `${before}@clossys/designer/${[...homes][0]}${after}` : all;
  });
}

/** Preview bytes of one retained emitted module: package specifiers relocate to Designer modules, relative ESM gains `.js`, then the documented source adaptations. */
export function previewModuleSource(content, path, { root, target }) {
  const code = /\.[cm]?tsx?$/.test(path) ? narrowBarrelImports(content).replace(/((?:from\s*|import\s*)["'])([^"']+)(["'])/g, (_all, before, original, after) => {
    let specifier = original;
    if (specifier.startsWith("@clossys/designer/")) {
      specifier = posix.relative(posix.dirname(posix.join(target, path)), posix.join(root, "src", specifier.slice("@clossys/designer/".length), "index.js"));
      if (!specifier.startsWith(".")) specifier = `./${specifier}`;
    } else if (specifier.startsWith(".") && !/\.(?:js|json|mjs)$/.test(specifier)) specifier += ".js";
    return before + specifier + after;
  }) : content;
  return previewSource(code, path);
}
