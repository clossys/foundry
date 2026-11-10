import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, extname, isAbsolute, join, relative, sep } from "node:path";
import { compile } from "tailwindcss";
import { listSlots, readAgentFile, readCandidate } from "../records/slots.js";
import { agentRoot } from "./cells.js";
import { pinnedBrand, type ConsumerBrand } from "./consumer-brand.js";
import { specimenSubstrate } from "./specimen-substrate.js";
import { isAbsent, isModuleAbsent } from "../errors.js";
import { studioTheme } from "./theme.js";

/**
 * The consumer's Designer output is its compiled theme (the pinned `themes.*` tokens as
 * stock shadcn variables, `studioTheme`) after any authored stock shadcn/Tailwind v4
 * stylesheet (`clossys/agents/designer/globals.css`). Studio applies it as compiled:
 * Producer compiles it with Tailwind, keeping its variables, base layer and the
 * font/radius utilities its theme redefines, and serves the font files its imports name
 * from the consumer's own installed packages. The compiled theme comes last, so it owns
 * the tokens; no consumer value is copied into Producer or into a Studio stylesheet.
 *
 * Fonts follow the theme pipeline: each pinned `registry:font` item (`themes.font-*`) adds
 * its font package's stylesheet and sets its own variable (`font.variable`) in the theme,
 * so `font-heading` and everything that applies it render the pinned family. The package
 * resolves from the consumer's install, else from the specimen substrate where the install
 * pipeline put it. Nothing names a family by hand.
 */
export interface ConsumerGlobals { css: string; hash: string; fonts: ReadonlyMap<string, string>; missing: string[] }

const producerRequire = createRequire(import.meta.url);
const FONT_FILE = /\.(?:woff2?|ttf|otf)$/;
const FONT_TYPES: Record<string, string> = { ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".otf": "font/otf" };
export const DESIGNER_FONT_PREFIX = "/api/designer/fonts/";

function packageName(id: string): string | undefined {
  const match = /^(@[a-z0-9][\w.-]*\/[a-z0-9][\w.-]*|[a-z0-9][\w.-]*)(?:\/|$)/.exec(id);
  return match?.[1];
}

/** Utilities whose value the consumer's own `@theme` redefines (fonts and radii). */
function themedCandidates(css: string): string[] {
  const candidates = new Set<string>();
  for (const block of css.matchAll(/@theme[^{]*\{([\s\S]*?)\n\}/g)) {
    for (const [, name] of block[1]!.matchAll(/--font-([a-z0-9-]+)\s*:/g)) candidates.add(`font-${name}`);
    for (const [, name] of block[1]!.matchAll(/--radius-([a-z0-9-]+)\s*:/g)) candidates.add(`rounded-${name}`);
  }
  return [...candidates].sort();
}

export interface PinnedFont { slot: string; element: string; version: number; family: string; variable: string; dependency: string }

const CSS_VARIABLE = /^--[a-z][a-z0-9-]*$/;
const FONT_FAMILY = /^[\w\s'",.-]+$/;
const PACKAGE = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/;

/** The workspace's pinned font items: Designer `themes.font*` pins and the registry items they name. */
export function pinnedFonts(root: string): PinnedFont[] {
  const library = join(root, "clossys");
  const fonts: PinnedFont[] = [];
  for (const entry of listSlots(library, "designer").filter(row => row.id.startsWith("themes.font") && row.pin)) {
    const pin = entry.pin!;
    // A pinned candidate that cannot be read or parsed surfaces; a drifted one is not the pin.
    const candidate = readCandidate(library, "designer", entry.id, pin.candidate);
    if (candidate.sha256 !== pin.sha256) continue;
    const item: Record<string, any> | undefined = JSON.parse(candidate.bytes);
    const version = Number(/-v([1-9][0-9]*)\.json$/.exec(pin.candidate)?.[1] ?? 0);
    const { family, variable, dependency } = item?.font ?? {};
    if (typeof item?.name !== "string" || !version || typeof family !== "string" || !FONT_FAMILY.test(family) || typeof variable !== "string" || !CSS_VARIABLE.test(variable) || typeof dependency !== "string" || !PACKAGE.test(dependency)) continue;
    fonts.push({ slot: entry.id, element: item.name, version, family, variable, dependency });
  }
  return fonts.sort((a, b) => a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0);
}

/** Source text added around the consumer globals: the pinned font packages first, their theme variables last. */
function withPinnedFonts(source: string, fonts: readonly PinnedFont[]): string {
  if (!fonts.length) return source;
  const imports = fonts.map(font => `@import "${font.dependency}"; /* ${font.slot} -> ${font.element} v${font.version} */`).join("\n");
  const theme = fonts.map(font => `  ${font.variable}: ${font.family};`).join("\n");
  return `${imports}\n${source}\n\n/* Pinned theme fonts (the theme pipeline's own variables). */\n@theme inline {\n${theme}\n}\n`;
}

let cached: { key: string; value: ConsumerGlobals } | undefined;

/** Compile the consumer's Designer globals: any authored globals, then the compiled consumer theme. */
export async function consumerGlobals(root: string): Promise<ConsumerGlobals> {
  const designer = agentRoot(root, "designer");
  const authored = readAgentFile(join(root, "clossys"), "designer", "globals.css");
  const theme = await studioTheme(root);
  const pinned = pinnedFonts(root);
  // Packages resolve from the consumer workspace that owns the Designer output, then from the specimen substrate.
  const consumerRequire = createRequire(join(root, "clossys", "package.json"));
  const substrate = specimenSubstrate(root);
  const substrateRequire = createRequire(join(substrate, "package.json"));
  const resolvePackage = (id: string): string => {
    // Not installed in the consumer: the substrate is the declared second root. A broken install surfaces.
    try { return consumerRequire.resolve(id); } catch (error) { if (!isModuleAbsent(error)) throw error; return substrateRequire.resolve(id); }
  };
  // A pinned font only joins once its package resolves somewhere, so the cache key tracks that too.
  const available = pinned.filter(font => { try { resolvePackage(font.dependency); return true; } catch { return false; } });
  // With no authored globals the compiled theme still needs the utility engine for its font/radius utilities.
  const head = authored ?? '@import "tailwindcss";\n';
  const source = withPinnedFonts(`${head}\n/* Compiled consumer theme (${theme.source}, ${theme.hash}). */\n${theme.css}`, available);
  const key = createHash("sha256").update(root).update("\0").update(source).digest("hex");
  if (cached?.key === key) return cached.value;
  const fonts = new Map<string, string>();
  const missing: string[] = [];
  const compiled = await compile(source, {
    base: designer,
    loadStylesheet: async (id, base) => {
      // Studio already ships Tailwind's preflight and utilities; only the utility
      // engine is needed here so the consumer theme can be applied on top.
      if (id === "tailwindcss") return { path: id, base, content: '@layer theme, base, components, utilities;\n@import "tailwindcss/utilities.css" layer(utilities);' };
      if (id.startsWith("tailwindcss/")) {
        const path = producerRequire.resolve(id);
        return { path, base: dirname(path), content: await readFile(path, "utf8") };
      }
      let path: string;
      try { path = resolvePackage(id); }
      catch { missing.push(id); return { path: id, base, content: "" }; }
      const name = packageName(id);
      if (!name || !path.endsWith(".css")) { missing.push(id); return { path: id, base, content: "" }; }
      const packageRoot = path.slice(0, path.lastIndexOf(`${sep}node_modules${sep}${name.split("/").join(sep)}${sep}`)) + `${sep}node_modules${sep}${name.split("/").join(sep)}`;
      fonts.set(name, packageRoot);
      const content = (await readFile(path, "utf8")).replace(/url\((['"]?)(\.{1,2}\/[^'")]+)\1\)/g, (match, _quote: string, url: string) => {
        const file = join(dirname(path), url);
        const inside = relative(packageRoot, file);
        if (isAbsolute(inside) || inside.startsWith("..") || !FONT_FILE.test(file)) return match;
        return `url(${DESIGNER_FONT_PREFIX}${name}/${inside.split(sep).join("/")})`;
      });
      return { path, base: dirname(path), content };
    },
  });
  const css = compiled.build(themedCandidates(source));
  for (const font of pinned) if (!available.includes(font)) missing.push(font.dependency);
  const value: ConsumerGlobals = { css, hash: `sha256:${createHash("sha256").update(css).digest("hex")}`, fonts, missing };
  cached = { key, value };
  return value;
}

/** A font file named by the consumer globals' own imports, confined to its package. */
export async function consumerFontFile(root: string, path: string): Promise<{ body: Buffer; type: string } | undefined> {
  const globals = await consumerGlobals(root);
  if (!path.startsWith(DESIGNER_FONT_PREFIX)) return undefined;
  const rest = path.slice(DESIGNER_FONT_PREFIX.length);
  const name = [...globals.fonts.keys()].find(entry => rest.startsWith(`${entry}/`));
  if (!name) return undefined;
  const file = rest.slice(name.length + 1);
  if (!FONT_FILE.test(file) || file.split("/").some(part => !part || part === "." || part === "..")) return undefined;
  const packageRoot = await realpath(globals.fonts.get(name)!);
  let target: string;
  try { target = await realpath(join(packageRoot, ...file.split("/"))); } catch (error) { if (isAbsent(error)) return undefined; throw error; }
  const inside = relative(packageRoot, target);
  if (isAbsolute(inside) || inside.startsWith("..")) return undefined;
  return { body: await readFile(target), type: FONT_TYPES[extname(target)] ?? "application/octet-stream" };
}

export type { ConsumerBrand } from "./consumer-brand.js";

/** The consumer brand: name, mark, favicon, app icon, lockup and image from the consumer's own pinned assets.* slots. */
export async function consumerBrand(root: string, library = join(root, "clossys")): Promise<ConsumerBrand> {
  return pinnedBrand(library);
}
