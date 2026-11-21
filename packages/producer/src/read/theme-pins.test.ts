import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultThemeCss, themeHash } from "@clossys/designer/build/theme";
import { afterEach, describe, expect, it } from "vitest";
import { FIXTURE_CONSUMER } from "../consumer-root.js";
import { studioTheme } from "../server/theme.js";
import { PINNED_CANDIDATES, pinnedConsumer, unpinnedConsumer } from "./__fixtures__/theme-pins/pinned-consumer.js";
import { validateAgainst, type JsonSchema } from "../records/schema.js";
import { readCandidate } from "../records/slots.js";
import { consumerThemeProjection, packageDefaultTheme, pinnedThemeCss, readConsumerTheme, resolveThemePins } from "./theme-pins.js";

/** Goldens: the Studio server's `studioTheme` CSS on the int2 fixture, captured before the move. */
const golden = (name: string) => readFileSync(fileURLToPath(new URL(`./__fixtures__/theme-pins/${name}`, import.meta.url)), "utf8");
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const pinned = () => { const root = pinnedConsumer(); roots.push(root); return root; };
const unpinned = () => { const root = unpinnedConsumer(); roots.push(root); return root; };

/**
 * The `themes.*` pins the fixture holds, read from each Designer slot's ledger (its last `pin` event) and the candidate
 * candidate that event names: an account independent of the pin.json files the resolver reads, never a typed list.
 */
function ledgerThemePins(library: string): Record<string, unknown> {
  const designer = join(library, "agents", "designer"), pins: Record<string, unknown> = {};
  for (const slot of readdirSync(designer).filter(name => name.startsWith("themes.")).sort()) {
    const ledger = join(designer, slot, "ledger.json");
    if (!existsSync(ledger)) continue;
    const events = (JSON.parse(readFileSync(ledger, "utf8")) as { events: { op: string; candidate?: string; sha256?: string }[] }).events;
    const pin = events.filter(event => event.op === "pin").at(-1);
    if (!pin) continue;
    // The candidate the ledger names, decoded by the record reader; its bytes must still be the ones the ledger pinned.
    const candidate = readCandidate(library, "designer", slot, pin.candidate!);
    expect(candidate.sha256, slot).toBe(pin.sha256);
    pins[slot] = { slot, candidate: pin.candidate, sha256: pin.sha256, sample: false, content: JSON.parse(candidate.bytes) as unknown };
  }
  return pins;
}

describe("theme pins (designer.md 9.8, system.md 14.2)", () => {
  it("resolves exactly the themes.* pins the int2 fixture holds, as its ledgers record them", () => {
    const library = join(FIXTURE_CONSUMER, "clossys");
    const held = ledgerThemePins(library);
    expect(Object.keys(held).length).toBeGreaterThan(0);
    expect(resolveThemePins(library)).toEqual(held);
    expect(readConsumerTheme(FIXTURE_CONSUMER).source).toBe("consumer");
  });

  it("with no consumer pin, the int2 slots resolve to the package default, byte-equal to the server", async () => {
    const root = unpinned();
    expect(resolveThemePins(join(root, "clossys"))).toEqual({});
    const theme = readConsumerTheme(root);
    expect(theme).toEqual({ source: "foundry", css: golden("int2-default.css"), hash: themeHash(golden("int2-default.css")) });
    expect(theme.css).toBe(defaultThemeCss());
    expect(theme).toEqual(packageDefaultTheme());
    expect(await studioTheme(root)).toEqual(theme);
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

  it("projects to a record that validates against the clossys.theme/1 schema", () => {
    const schema = JSON.parse(readFileSync(fileURLToPath(new URL("../../schemas/theme.json", import.meta.url)), "utf8")) as JsonSchema;
    const projection = consumerThemeProjection(join(pinned(), "clossys"));
    expect(projection.vars.dark["--primary"]).toBe("oklch(0.78 0.11 160)");
    expect(validateAgainst(schema, projection)).toEqual([]);
    expect(validateAgainst(schema, consumerThemeProjection(join(FIXTURE_CONSUMER, "clossys")))).toEqual([]);
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
