import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultThemeCss, themeHash } from "@clossys/designer/build/theme";
import { afterEach, describe, expect, it } from "vitest";
import { FIXTURE_CONSUMER } from "../consumer-root.js";
import { studioTheme } from "../server/theme.js";
import { PINNED_CANDIDATES, pinnedConsumer } from "./__fixtures__/theme-pins/pinned-consumer.js";
import { packageDefaultTheme, pinnedThemeCss, readConsumerTheme, resolveThemePins } from "./theme-pins.js";

/** Goldens: the Studio server's `studioTheme` CSS on the int2 fixture, captured before the move. */
const golden = (name: string) => readFileSync(fileURLToPath(new URL(`./__fixtures__/theme-pins/${name}`, import.meta.url)), "utf8");
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const pinned = () => { const root = pinnedConsumer(); roots.push(root); return root; };

describe("theme pins (designer.md 9.8, system.md 14.2)", () => {
  it("with no consumer pin, the int2 fixture resolves to the package default, byte-equal to the server", async () => {
    expect(resolveThemePins(join(FIXTURE_CONSUMER, "clossys"))).toEqual({});
    const theme = readConsumerTheme(FIXTURE_CONSUMER);
    expect(theme).toEqual({ source: "foundry", css: golden("int2-default.css"), hash: themeHash(golden("int2-default.css")) });
    expect(theme.css).toBe(defaultThemeCss());
    expect(theme).toEqual(packageDefaultTheme());
    expect(await studioTheme(FIXTURE_CONSUMER)).toEqual(theme);
  });

  it("resolves the consumer's themes.* pins and projects them to the server's CSS bytes", async () => {
    const root = pinned();
    const pins = resolveThemePins(join(root, "clossys"));
    expect(Object.keys(pins).sort()).toEqual(Object.keys(PINNED_CANDIDATES).sort());
    for (const [slot, { name, item }] of Object.entries(PINNED_CANDIDATES)) expect(pins[slot]).toMatchObject({ slot, candidate: name, sample: false, content: item });
    const theme = readConsumerTheme(root);
    expect(theme.source).toBe("consumer");
    expect(theme.css).toBe(golden("int2-pinned.css"));
    expect(theme.css).toContain("  --primary: oklch(0.45 0.09 160);");
    expect(theme.css).toMatch(/\n\.dark \{\n {2}--primary: oklch\(0\.78 0\.11 160\);\n\}\n$/);
    expect(pinnedThemeCss(join(root, "clossys"))).toBe(theme.css);
    expect(await studioTheme(root)).toEqual(theme);
  });

  it("is a visible error, never the default, when a pinned theme candidate drifts", () => {
    const root = pinned();
    const file = join(root, "clossys", "agents", "designer", "themes.primary", "candidates", PINNED_CANDIDATES["themes.primary"]!.name);
    writeFileSync(file, readFileSync(file, "utf8") + "\n");
    const theme = readConsumerTheme(root);
    expect(theme.source).toBe("error");
    expect(theme.message).toBe("Consumer theme could not be compiled: themes.primary does not match its pin");
    expect(theme.css).toBe(defaultThemeCss());
  });
});
