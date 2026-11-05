/** Types for flavor.mjs (`@clossys/designer/shadcn-flavor`). The Designer's shadcn flavor (scripts/ref-verbatim/flavor.mjs): the one writer of every components.json. */
export declare const DESIGNER_SHADCN_FLAVOR: Readonly<Record<string, unknown>>;
export type ShadcnComponentsJson = {
  $schema: string; style: string; rsc: boolean; tsx: boolean;
  tailwind: { config: string; css: string; baseColor: string; cssVariables: boolean; prefix: string };
  iconLibrary: string; rtl: boolean; aliases: Record<string, string>;
  menuColor: string; menuAccent: string; registries: Record<string, unknown>;
};
/** A project's components.json: the Designer's flavor with `tailwind.css` set to that project's stylesheet. */
export declare function shadcnComponentsJson(options: { css: string }): ShadcnComponentsJson;
export declare function shadcnComponentsJsonText(options: { css: string }): string;
