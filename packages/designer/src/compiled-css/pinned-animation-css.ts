import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";

/** The admitted upstream dependency; npm verifies these archive bytes at installation. */
export const ANIMATION_CSS_PIN = Object.freeze({
  name: "tw-animate-css", version: "1.4.0", license: "MIT",
  integrity: "sha512-7bziOlRqH0hJx80h/3mbicLW7o8qLsH5+RaLR2t+OHM3D0JlWGODQKQ4cxbK7WlvmUxpcj6Kgu6EKqjrGFe3QQ==",
  shasum: "b4a06f68244cba39428aa47e65e6e4c0babc21ee",
});

function cssExport(value: unknown): string | undefined {
  if (typeof value === "string") return value.endsWith(".css") ? value : undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const conditions = value as Record<string, unknown>;
  for (const name of ["style", "default", "import", "require"]) {
    const entry = cssExport(conditions[name]);
    if (entry) return entry;
  }
  return;
}

/** Resolve the installed package's declared CSS, requiring npm's matching installation receipt. */
export function resolvePinnedAnimationCss(from: string): string {
  const require = createRequire(from);
  const manifestFile = (require.resolve.paths(ANIMATION_CSS_PIN.name) ?? [])
    .map(directory => join(directory, ANIMATION_CSS_PIN.name, "package.json"))
    .find(existsSync);
  if (!manifestFile) throw new Error("tw-animate-css@1.4.0 is not installed; install and verify the pinned dependency before compiling native animation CSS.");
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as Record<string, unknown>;
  if (manifest.name !== ANIMATION_CSS_PIN.name || manifest.version !== ANIMATION_CSS_PIN.version || manifest.license !== ANIMATION_CSS_PIN.license) {
    throw new Error("Installed tw-animate-css name, version or license differs from its admitted pin.");
  }
  const packageDirectory = dirname(manifestFile);
  const receiptFile = join(dirname(packageDirectory), ".package-lock.json");
  if (!existsSync(receiptFile)) throw new Error("tw-animate-css npm installation integrity receipt is missing.");
  const receipt = JSON.parse(readFileSync(receiptFile, "utf8")) as { packages?: Record<string, { version?: string; integrity?: string }> };
  const installed = Object.entries(receipt.packages ?? {}).find(([key]) =>
    key.endsWith(`node_modules/${ANIMATION_CSS_PIN.name}`)
    && realpathSync(resolve(dirname(receiptFile), "..", key)) === realpathSync(packageDirectory))?.[1];
  if (installed?.version !== ANIMATION_CSS_PIN.version || installed.integrity !== ANIMATION_CSS_PIN.integrity) {
    throw new Error("tw-animate-css npm installation integrity receipt differs from its admitted pin.");
  }
  const exports = manifest.exports;
  const rootExport = exports && typeof exports === "object" && !Array.isArray(exports) && "." in exports
    ? (exports as Record<string, unknown>)["."] : exports;
  const entry = cssExport(rootExport ?? manifest.style ?? manifest.main);
  if (!entry?.startsWith("./")) throw new Error("tw-animate-css does not declare a supported root CSS export.");
  const target = realpathSync(resolve(packageDirectory, entry));
  const within = relative(realpathSync(packageDirectory), target);
  if (within.startsWith("..") || !within.endsWith(".css")) throw new Error("tw-animate-css CSS export escapes its installed package.");
  return target;
}
