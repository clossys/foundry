// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { generateCompiledCss } from "./compiled-css/generate.js";
import { selectChromium } from "./__fixtures__/chromium-discovery.js";

/*
 * Reduced motion, proven in a real engine. Every shipped file that names an
 * animation or transition utility is collected; each of its moving utilities
 * is rendered in Chromium against the stylesheet a consumer actually loads
 * (a Tailwind compile of styles/theme.css, and the shipped compiled.css),
 * once with no motion preference and once with `prefers-reduced-motion:
 * reduce`. A utility that moves without the preference must not move with
 * it. Stock shadcn files carry no `motion-reduce:` variant, so the global
 * rule in styles/theme-keys.css is what this proves; removing it fails here.
 */
const packageRoot = resolve(import.meta.dirname, "..");
const MOTION_DIRS = ["components", "blocks", "charts", "shell", "theme", "tokens/preview"];
const MOTION_CLASS_RE = /\b(?:animate|transition)-[a-zA-Z[\]-]+/;
const REDUCED_CEILING_S = 0.00001; // 0.01ms

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) && !/\.(test|spec|check)\.tsx?$|\.d\.ts$/.test(entry) ? [full] : [];
  });
}

/** The utility a token applies once its variants (`hover:`, `data-[x=y]:`, `motion-safe:`) are peeled off. */
function baseUtility(token: string): string {
  let depth = 0, start = 0;
  for (let index = 0; index < token.length; index += 1) {
    const char = token[index];
    if (char === "[") depth += 1;
    else if (char === "]") depth -= 1;
    else if (char === ":" && depth === 0) start = index + 1;
  }
  return token.slice(start).replace(/^!|!$/g, "");
}

const MOVING_UTILITY_RE = /^(?:animate-(?!none$)[a-z[][^\s]*|transition(?:-(?!none$)[a-z[][^\s]*)?)$/;

const motionFiles = MOTION_DIRS.flatMap((dir) => sourceFiles(join(packageRoot, "src", dir)))
  .map((file) => ({ file: file.slice(packageRoot.length + 1), source: readFileSync(file, "utf8") }))
  .filter(({ source }) => MOTION_CLASS_RE.test(source))
  .map(({ file, source }) => ({
    file,
    utilities: [...new Set((source.match(/[^\s"'`{}(),]+/g) ?? []).map(baseUtility).filter((token) => MOVING_UTILITY_RE.test(token)))].sort(),
  }));
const utilities = [...new Set(motionFiles.flatMap(({ utilities }) => utilities))].sort();

type Measure = { duration: number; moves: boolean };
type Probe = { reduce: boolean; byClass: Record<string, Measure>; inline: Measure & { iterations: string } };

const probeScript = `
  const seconds = value => Math.max(0, ...value.split(",").map(part => part.trim().endsWith("ms") ? parseFloat(part) / 1000 : parseFloat(part)).filter(Number.isFinite));
  const measure = element => {
    const style = getComputedStyle(element);
    const transition = style.transitionProperty !== "none" ? seconds(style.transitionDuration) : 0;
    const animation = style.animationName !== "none" ? seconds(style.animationDuration) : 0;
    const duration = Math.max(transition, animation);
    return { duration, moves: duration > ${REDUCED_CEILING_S} };
  };
  const byClass = {};
  for (const element of document.querySelectorAll("[data-utility]")) byClass[element.dataset.utility] = measure(element);
  const inline = document.getElementById("inline");
  ({ reduce: matchMedia("(prefers-reduced-motion: reduce)").matches, byClass, inline: { ...measure(inline), iterations: getComputedStyle(inline).animationIterationCount } });
`;

function page(css: string): string {
  const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return `<!doctype html><meta charset="utf-8"><style>${readFileSync(join(packageRoot, "styles/tokens.css"), "utf8")}${css}
    @keyframes probe-spin { to { rotate: 1turn; } }</style>
    ${utilities.map((utility) => `<div class="${escape(utility)}" data-utility="${escape(utility)}"></div>`).join("")}
    <div id="inline" style="transition: opacity 1s, transform 2s; animation: probe-spin 3s infinite"></div>`;
}

async function render(html: string): Promise<{ none: Probe; reduce: Probe }> {
  const executable = selectChromium(process.env.FOUNDRY_TEST_CHROME, (path, args) => spawnSync(path, args, { stdio: "ignore", timeout: 10_000 }));
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ executablePath: executable });
  try {
    const read = async (reducedMotion: "no-preference" | "reduce") => {
      const context = await browser.newContext({ reducedMotion });
      const tab = await context.newPage();
      await tab.setContent(html);
      const probe = (await tab.evaluate(probeScript)) as Probe;
      await context.close();
      return probe;
    };
    return { none: await read("no-preference"), reduce: await read("reduce") };
  } finally {
    await browser.close();
  }
}

describe.each([
  ["Tailwind compile of styles/theme.css", async () => (await generateCompiledCss({ stylesDir: join(packageRoot, "styles"), candidates: utilities })).css],
  ["shipped styles/compiled.css", async () => readFileSync(join(packageRoot, "styles/compiled.css"), "utf8")],
])("reduced motion in Chromium: %s", (_label, stylesheet) => {
  let probes: { none: Probe; reduce: Probe };
  beforeAll(async () => { probes = await render(page(await stylesheet())); }, 120_000);

  it("emulates both preferences", () => {
    expect(probes.none.reduce).toBe(false);
    expect(probes.reduce.reduce).toBe(true);
  });

  it("collects every shipped motion file, stock shadcn included", () => {
    expect(motionFiles.length).toBeGreaterThan(0);
    expect(motionFiles.some(({ file }) => file.startsWith("src/components/preview-runtime/"))).toBe(true);
    expect(utilities.length).toBeGreaterThan(0);
  });

  it("stills every utility that moves without the preference, in every motion file [mutant: drop the theme-keys.css global rule]", () => {
    const moving = utilities.filter((utility) => probes.none.byClass[utility]?.moves);
    // The probe is not vacuous: real motion renders without the preference.
    expect(moving.length).toBeGreaterThan(0);
    const unreduced = motionFiles.flatMap(({ file, utilities: own }) =>
      own.filter((utility) => moving.includes(utility) && probes.reduce.byClass[utility]!.duration > REDUCED_CEILING_S)
        .map((utility) => `${file}: ${utility} ${probes.reduce.byClass[utility]!.duration}s`));
    expect(unreduced).toEqual([]);
  });

  it("stills motion that no shipped utility names, so a consumer's own animations are covered too", () => {
    expect(probes.none.inline.moves).toBe(true);
    expect(probes.none.inline.iterations).toBe("infinite");
    expect(probes.reduce.inline.duration).toBeLessThanOrEqual(REDUCED_CEILING_S);
    expect(probes.reduce.inline.iterations).toBe("1");
  });
});
