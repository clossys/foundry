/**
 * The Designer's shadcn flavor: the one writer of every components.json a Clossys workspace holds.
 *
 * Every pinned Designer component renders in this flavor (style, iconLibrary, aliases, menu
 * options), so ref-verbatim proves pins against it and the publishing substrate installs items in
 * it. Each components.json differs only in `tailwind.css`, the stylesheet of the project it sits in:
 *
 *   packages/designer/ui/components.json   the Designer's own ui workspace   (src/index.css)
 *   clossys/components.json                the consumer root                 (the stylesheet its pins render in)
 *   <substrate>/components.json            the publishing substrate          (app.css)
 *
 * Node builtins only, no I/O: the build scripts, the Producer and the ref-verbatim check all import it.
 */

/** The flavor itself. `tailwind.css` is per project; everything else is the Designer's. */
export const DESIGNER_SHADCN_FLAVOR = Object.freeze({
  $schema: "https://ui.shadcn.com/schema.json",
  style: "aria-nova",
  rsc: false,
  tsx: true,
  tailwind: Object.freeze({ config: "", baseColor: "neutral", cssVariables: true, prefix: "" }),
  iconLibrary: "lucide",
  rtl: false,
  aliases: Object.freeze({ components: "@/components", utils: "@/lib/utils", ui: "@/components/ui", lib: "@/lib", hooks: "@/hooks" }),
  menuColor: "default",
  menuAccent: "subtle",
  registries: Object.freeze({}),
});

/**
 * The `utils` alias module (`aliases.utils`) `shadcn init` writes in this flavor: the stock
 * aria-nova `utils` item (references/shadcn-aria/utils@4.23.0), `cn` from the `cn` package.
 * Partner items (reactflow's base-node, base-handle, labeled-handle, node-status) import `cn`
 * from `@/lib/utils` and list no registry dependency for it: every project in this flavor has it.
 */
export const DESIGNER_SHADCN_UTILS = Object.freeze({
  path: "lib/utils.ts",
  content: 'export { cn } from "cn"\n',
  dependencies: Object.freeze({ cn: "^0.5.2" }),
});

/** A project's components.json: the Designer's flavor, with `tailwind.css` set to that project's stylesheet. */
export function shadcnComponentsJson({ css }) {
  if (typeof css !== "string" || !css || css.startsWith("/") || css.includes("\\")) {
    throw new TypeError(`components.json tailwind.css must be a relative posix stylesheet path, got ${JSON.stringify(css)}`);
  }
  const { tailwind, ...rest } = DESIGNER_SHADCN_FLAVOR;
  const { config, ...tail } = tailwind;
  // Key order matches what `shadcn init` writes, so a generated file reads like a stock one.
  return {
    $schema: rest.$schema, style: rest.style, rsc: rest.rsc, tsx: rest.tsx,
    tailwind: { config, css, ...tail },
    iconLibrary: rest.iconLibrary, rtl: rest.rtl, aliases: { ...rest.aliases },
    menuColor: rest.menuColor, menuAccent: rest.menuAccent, registries: { ...rest.registries },
  };
}

/** The file text: two-space JSON with a trailing newline. */
export function shadcnComponentsJsonText(options) {
  return `${JSON.stringify(shadcnComponentsJson(options), null, 2)}\n`;
}
