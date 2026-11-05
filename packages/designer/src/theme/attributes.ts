/**
 * The `<html>` attributes a pinned theme mode needs, applied to a rendered document server side:
 * the shadcn dark-mode strategy (`.dark` on `<html>`, matching the `@custom-variant dark
 * (&:is(.dark *))` every shadcn stylesheet and the publishing substrate declare) plus the matching
 * `color-scheme`. A static preview runs no script, so the attributes the theme script or
 * next-themes would set at runtime are written into the markup instead. Existing classes on
 * `<html>` are kept; a stale `dark`/`light` class is replaced; an existing inline style keeps its
 * declarations after `color-scheme`.
 */
export type ThemeMode = "light" | "dark";

/** The class list and `color-scheme` for one mode, as `<html>` attribute values. */
export function themeAttributes(mode: ThemeMode, classes: readonly string[] = []): { class: string; colorScheme: ThemeMode } {
  const kept = classes.filter(name => /^[^"'<>&]+$/.test(name) && name !== "dark" && name !== "light");
  return { class: [...kept, ...(mode === "dark" ? ["dark"] : [])].join(" "), colorScheme: mode };
}

/** `html` with its `<html>` tag carrying the mode's attributes; a fragment is wrapped in one. */
export function applyThemeAttributes(html: string, mode: ThemeMode): string {
  const tag = /<html\b[^>]*>/i.exec(html);
  const classAttr = (value: string) => value ? ` class="${value}"` : "";
  const scheme = `color-scheme:${mode}`;
  if (!tag) return `<html${classAttr(themeAttributes(mode).class)} style="${scheme}">${html}</html>`;
  let open = tag[0];
  const classes = /\sclass\s*=\s*("([^"]*)"|'([^']*)')/i.exec(open);
  const attribute = classAttr(themeAttributes(mode, (classes ? (classes[2] ?? classes[3] ?? "") : "").split(/\s+/)).class);
  open = classes ? open.replace(classes[0], attribute) : open.replace(/^<html\b/i, `<html${attribute}`);
  open = /\sstyle\s*=/i.test(open) ? open.replace(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/i, (_all, _q, a, b) => ` style="${scheme};${a ?? b ?? ""}"`) : open.replace(/>$/, ` style="${scheme}">`);
  return html.slice(0, tag.index) + open + html.slice(tag.index + tag[0].length);
}
