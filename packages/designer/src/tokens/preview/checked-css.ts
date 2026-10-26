import type { ResolvedMember } from "../../catalog-core/types.js";

const NUMBER = String.raw`[+-]?(?:\d*\.)?\d+`;
/** Colour functions a shadow may carry, plus the reference and arithmetic forms the catalog authors. */
const SHADOW_FUNCTIONS = new Set(["rgb", "rgba", "hsl", "hsla", "hwb", "oklch", "oklab", "lab", "lch", "var", "calc"]);

function balanced(css: string): boolean {
  let depth = 0;
  for (const character of css) {
    if (character === "(") depth++;
    else if (character === ")" && --depth < 0) return false;
  }
  return depth === 0;
}

/**
 * The value grammar a preview may paint for one member type. Anything outside it renders as
 * text, never as a CSS value. Callers still reject `unsafeText` first.
 */
export function checkedPreviewCss(type: ResolvedMember["$type"], input: string): boolean {
  const css = input.trim();
  const reference = /^var\((--[a-zA-Z][\w-]*),\s*([\s\S]+)\)$/.exec(css);
  if (reference) return checkedPreviewCss(type, reference[2]!);
  if (type === "color") return /^(?:#[a-f\d]{3,8}|transparent|currentColor|(?:rgb|rgba|hsl|hsla|hwb|oklch|oklab|lab|lch)\([\deE.%+\-\s,/]+\)|color\((?:srgb|srgb-linear|display-p3|a98-rgb|prophoto-rgb|rec2020|xyz-d50|xyz-d65) [\deE.%+\-\s/]+\))$/i.test(css);
  if (type === "fontFamily") return /^[\p{L}\p{N}\s,\-_'".]+$/u.test(css);
  if (type === "dimension") return css === "0" || /^-?(?:\d*\.)?\d+(?:px|rem|em|%|vh|vw|vmin|vmax|ch|ex)$/.test(css) || /^(?:calc|min|max|clamp)\([\d.\s+*/(),%a-z-]+\)$/i.test(css) && !/[a-z]{4,}/i.test(css.replace(/(?:calc|min|max|clamp|rem|vmin|vmax)/g, ""));
  if (type === "duration") return /^-?(?:\d*\.)?\d+m?s$/.test(css);
  // A unitless ratio may be authored as one arithmetic step, as Tailwind's paired line heights are.
  if (type === "number" || type === "fontWeight") return /^(?:normal|bold|[+-]?(?:\d*\.)?\d+(?:em)?)$/.test(css) || new RegExp(`^calc\\(\\s*${NUMBER}\\s*[*/+-]\\s*${NUMBER}\\s*\\)$`).test(css);
  if (type === "cubicBezier") return /^cubic-bezier\([\d.\s,+-]+\)$/.test(css);
  if (type === "shadow") return css === "none" || /^[\w\s.,%()/#+-]+$/.test(css) && balanced(css)
    && [...css.matchAll(/([a-z][a-z-]*)\(/gi)].every(match => SHADOW_FUNCTIONS.has(match[1]!.toLowerCase()));
  // Other member types are rendered as text, never as a CSS property.
  return true;
}
