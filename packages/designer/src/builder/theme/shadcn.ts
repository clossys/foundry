import { loadCatalog } from "../../catalog-core/index.js";
import type { CatalogData } from "../../catalog-core/index.js";
import type { ShadcnVar, ThemeProjection } from "./types.js";

export const SHADCN_VARS: readonly ShadcnVar[] = [
  "--background", "--foreground", "--primary", "--primary-foreground", "--secondary", "--secondary-foreground",
  "--muted", "--muted-foreground", "--accent", "--accent-foreground", "--destructive", "--border", "--input",
  "--ring", "--radius", "--font-sans", "--font-heading",
];

type Vars = ThemeProjection["vars"];

/**
 * The stock shadcn values the catalog pins (`shadcn@aria` fills, copied from the pinned upstream
 * registry): each member's `sourceVariable`, its raw CSS for light and its dark mode value.
 */
export function stockShadcnVars(catalog: Pick<CatalogData, "fills"> = loadCatalog()): Vars {
  const stock: Vars = { light: {}, dark: {} };
  const wanted = new Set<string>(SHADCN_VARS);
  for (const fill of catalog.fills) {
    const meta = fill.$extensions["com.clossys.fill"];
    if (meta.source !== "shadcn@aria" || !meta.slot.startsWith("themes.")) continue;
    for (const group of Object.values((fill as { themes?: Record<string, Record<string, any>> }).themes ?? {})) {
      for (const member of Object.values(group ?? {})) {
        const ext = member?.$extensions ?? {};
        const name = ext["com.clossys.provenance"]?.sourceVariable;
        const light = ext["com.clossys.css"]?.raw ?? (typeof member?.$value === "string" ? member.$value : undefined);
        if (typeof name !== "string" || !wanted.has(name) || typeof light !== "string") continue;
        const dark = ext["com.clossys.modes"]?.dark;
        stock.light[name as ShadcnVar] ??= light;
        stock.dark[name as ShadcnVar] ??= typeof dark === "string" ? dark : light;
      }
    }
  }
  return stock;
}

/** The projection's variables with every unset shadcn variable filled from stock; set values are kept. */
export function toShadcnVars(projection: Pick<ThemeProjection, "vars">, stock: Vars = stockShadcnVars()): Vars {
  const out: Vars = { light: { ...projection.vars.light }, dark: { ...projection.vars.dark } };
  for (const mode of ["light", "dark"] as const) {
    for (const name of SHADCN_VARS) {
      const value = stock[mode][name];
      if (out[mode][name] === undefined && value !== undefined) out[mode][name] = value;
    }
  }
  return out;
}
