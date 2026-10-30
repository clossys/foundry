import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, extname, isAbsolute, join, relative, sep } from "node:path";
import { compile } from "tailwindcss";
import { agentRoot, readCells } from "./cells.js";

/**
 * The consumer's Designer output (`clossys/agents/designer/globals.css`) is a stock
 * shadcn/Tailwind v4 stylesheet. Studio applies it as authored: Producer compiles it
 * with Tailwind, keeping its variables, base layer and the font/radius utilities its
 * theme redefines, and serves the font files its imports name from the consumer's
 * own installed packages. No consumer value is copied into Producer.
 */
export interface ConsumerGlobals { css: string; hash: string; fonts: ReadonlyMap<string, string>; missing: string[] }

const producerRequire = createRequire(import.meta.url);
const FONT_FILE = /\.(?:woff2?|ttf|otf)$/;
const FONT_TYPES: Record<string, string> = { ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".otf": "font/otf" };
export const DESIGNER_FONT_PREFIX = "/api/designer/fonts/";

async function readNoFollow(path: string): Promise<string | undefined> {
  let handle;
  try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  try { return await handle.readFile("utf8"); } finally { await handle.close(); }
}

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

let cached: { key: string; value: ConsumerGlobals } | undefined;

/** Compile the consumer's Designer globals. Undefined when the consumer has none. */
export async function consumerGlobals(root: string): Promise<ConsumerGlobals | undefined> {
  const designer = agentRoot(root, "designer");
  const source = await readNoFollow(join(designer, "globals.css"));
  if (source === undefined) return undefined;
  const key = createHash("sha256").update(root).update("\0").update(source).digest("hex");
  if (cached?.key === key) return cached.value;
  // Packages resolve from the consumer workspace that owns the Designer output.
  const consumerRequire = createRequire(join(root, "clossys", "package.json"));
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
      try { path = consumerRequire.resolve(id); }
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
  const value: ConsumerGlobals = { css, hash: `sha256:${createHash("sha256").update(css).digest("hex")}`, fonts, missing };
  cached = { key, value };
  return value;
}

/** A font file named by the consumer globals' own imports, confined to its package. */
export async function consumerFontFile(root: string, path: string): Promise<{ body: Buffer; type: string } | undefined> {
  const globals = await consumerGlobals(root);
  if (!globals || !path.startsWith(DESIGNER_FONT_PREFIX)) return undefined;
  const rest = path.slice(DESIGNER_FONT_PREFIX.length);
  const name = [...globals.fonts.keys()].find(entry => rest.startsWith(`${entry}/`));
  if (!name) return undefined;
  const file = rest.slice(name.length + 1);
  if (!FONT_FILE.test(file) || file.split("/").some(part => !part || part === "." || part === "..")) return undefined;
  const packageRoot = await realpath(globals.fonts.get(name)!);
  let target: string;
  try { target = await realpath(join(packageRoot, ...file.split("/"))); } catch { return undefined; }
  const inside = relative(packageRoot, target);
  if (isAbsolute(inside) || inside.startsWith("..")) return undefined;
  return { body: await readFile(target), type: FONT_TYPES[extname(target)] ?? "application/octet-stream" };
}

export interface ConsumerBrand { name?: string; mark?: { light: string; dark: string } }

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** The consumer's active Designer mark: the positive variant on light grounds, reversed on dark. */
export async function consumerBrand(root: string): Promise<ConsumerBrand> {
  let cells;
  try { cells = await readCells(root, "designer", true); } catch { return {}; }
  const cell = cells.find(entry => entry.id === "assets.mark");
  if (!cell) return {};
  const json = /(?:^|\n)## Fill\s*\n[\s\S]*?```json\s*\n([\s\S]*?)\n```/.exec(cell.source)?.[1];
  let fill: unknown;
  try { fill = json ? JSON.parse(json) : undefined; } catch { return {}; }
  const variants = object(fill) && object(fill.assets) && object(fill.assets.mark) ? fill.assets.mark : undefined;
  const svg = (variant: string) => {
    const entry = variants?.[variant];
    const value = object(entry) && typeof entry.$value === "string" ? entry.$value.trim() : "";
    return value.startsWith("<svg") && value.endsWith("</svg>") && !/<script|\son[a-z]+=|javascript:|<foreignObject/i.test(value) ? value : undefined;
  };
  const light = svg("positive") ?? svg("mono");
  const dark = svg("reversed") ?? light;
  if (!light || !dark) return {};
  const name = /\baria-label="([^"<>]{1,80})"/.exec(light)?.[1];
  return { ...(name ? { name } : {}), mark: { light, dark } };
}
