import { createHash } from "node:crypto";
import type { Mode, ResolvedThemePins, ThemeProjection, ThemeSource } from "./types.js";

const CSS_NAME = /^[a-z][a-z0-9-]*$/;
const CSS_VALUE = /^[^;{}<>]+$/;

/** Valid `name: value` pairs of a shadcn `cssVars` group, in authored order. */
function declarations(vars: unknown): [string, string][] {
  return Object.entries(vars && typeof vars === "object" ? vars as Record<string, unknown> : {})
    .filter((entry): entry is [string, string] => CSS_NAME.test(entry[0]) && typeof entry[1] === "string" && CSS_VALUE.test(entry[1]));
}

/**
 * Project resolved `themes.*` pins to CSS variables (pure: no file, server or model). Pins are read
 * in slot-id order. A `registry:font` item contributes its one variable to light (`:root`); any
 * other item contributes `cssVars.theme` then `cssVars.light` to light and `cssVars.dark` to dark.
 * Names and values that are not plain CSS custom-property text are dropped, never escaped.
 * A variable declared by two pins keeps its first position and the later pin's value, the value the
 * browser cascade would apply.
 */
export function projectTheme(pins: ResolvedThemePins): ThemeProjection {
  const vars: ThemeProjection["vars"] = { light: {}, dark: {} };
  const sources: Record<string, ThemeSource> = {};
  const slots = Object.keys(pins).filter(slot => slot.startsWith("themes.")).sort((a, b) => a.localeCompare(b));
  for (const slot of slots) {
    const { content, ...source } = pins[slot]!;
    const item = (content && typeof content === "object" ? content : {}) as Record<string, any>;
    const set = (mode: Mode, name: string, value: string) => {
      vars[mode][`--${name}`] = value;
      sources[`--${name}`] = { ...source, slot };
    };
    if (item.type === "registry:font") {
      const font = item.font;
      const name = String(font?.variable ?? "").replace(/^--/, "");
      if (CSS_NAME.test(name) && typeof font?.family === "string" && CSS_VALUE.test(font.family)) set("light", name, font.family);
      continue;
    }
    for (const [name, value] of [...declarations(item.cssVars?.theme), ...declarations(item.cssVars?.light)]) set("light", name, value);
    for (const [name, value] of declarations(item.cssVars?.dark)) set("dark", name, value);
  }
  const inputs = slots.map(slot => { const { candidate, sha256, sample } = pins[slot]!; return [slot, candidate, sha256, sample]; });
  return { schema: "clossys.theme/1", vars, sources, inputsSha256: createHash("sha256").update(JSON.stringify(inputs), "utf8").digest("hex") };
}

/** True when the projection declares no variable in either mode. */
export function isEmptyProjection(projection: Pick<ThemeProjection, "vars">): boolean {
  return !Object.keys(projection.vars.light).length && !Object.keys(projection.vars.dark).length;
}
