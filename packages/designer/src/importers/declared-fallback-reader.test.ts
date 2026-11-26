// @vitest-environment node
/**
 * CP1-G5: a consumer adoption of stock shadcn sidebar normalizes through the consumer's pinned-themes reader. The
 * stock file sets `--sidebar-width` and `--sidebar-width-icon` inline (SidebarProvider's style), so no theme declares
 * them: they read `unset`, the runtime-only rule, instead of refusing the adoption. Any other undeclared name is
 * still refused.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { alignImportedReads, bareReads, pinnedThemeFallbackReader, UndeclaredTokenFallbackError } from "./declared-fallback-reader.js";

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SIDEBAR = readFileSync(join(pkg, "references/shadcn-aria/sidebar@4.23.0/registry/aria-nova/ui/sidebar.tsx"), "utf8");
/** The other bare reads stock sidebar makes, each a stock shadcn theme variable the consumer pins. */
const PINS = { "--sidebar-border": "oklch(0.922 0 0)", "--sidebar-accent": "oklch(0.97 0 0)" };

describe("alignImportedReads keeps a stock shadcn sidebar's inline-set width variables", () => {
  it("normalizing stock sidebar through pinned themes keeps --sidebar-width-icon and --sidebar-width as runtime-only reads", () => {
    const aligned = alignImportedReads(SIDEBAR, pinnedThemeFallbackReader(PINS));
    expect(aligned).toContain("w-[calc(var(--sidebar-width-icon,unset)+(--spacing(4)))]");
    expect(aligned).toContain("left-[calc(var(--sidebar-width,unset)*-1)]");
    expect(aligned).toContain(`"--sidebar-width-icon": SIDEBAR_WIDTH_ICON,`);
    expect(aligned).toContain("var(--sidebar-border,oklch(0.922_0_0))");
    expect(bareReads(aligned)).toEqual([]);
  });

  it("a pinned value still wins over the runtime-only rule", () => {
    const aligned = alignImportedReads(SIDEBAR, pinnedThemeFallbackReader({ ...PINS, "--sidebar-width-icon": "3rem" }));
    expect(aligned).toContain("var(--sidebar-width-icon,3rem)");
    expect(aligned).not.toContain("var(--sidebar-width-icon,unset)");
  });

  it("still refuses a read the pins do not declare and the file does not set inline", () => {
    expect(() => alignImportedReads(SIDEBAR, pinnedThemeFallbackReader({ "--sidebar-border": "oklch(0.922 0 0)" })))
      .toThrow(expect.objectContaining({ name: "UndeclaredTokenFallbackError", message: expect.stringContaining("--sidebar-accent") }));
    expect(() => alignImportedReads(`const a = "w-[var(--sidebar-width-icon)]"`, pinnedThemeFallbackReader({}))).toThrow(UndeclaredTokenFallbackError);
  });
});
