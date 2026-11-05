import { readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { flatConsumer, snapshot } from "../cli/__fixtures__/flat-consumer.js";
import { defaultStudioTheme, studioTheme, themeHash } from "./theme.js";
import { startProducerServer } from "./index.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const consumer = () => { const root = flatConsumer(["designer"]); roots.push(root); return root; };
const designer = (root: string) => join(root, "clossys", "agents", "designer");
const themeSlots = (root: string) => readdirSync(designer(root)).filter(id => id.startsWith("themes.")).sort();
const pinned = (root: string, id: string) => {
  const pin = JSON.parse(readFileSync(join(designer(root), id, "pin.json"), "utf8")) as { candidate: string };
  return join(designer(root), id, "candidates", pin.candidate);
};
const pinnedThemes = (root: string) => themeSlots(root).filter(id => { try { pinned(root, id); return true; } catch { return false; } });

describe("Studio theme from the pinned themes.* slots", () => {
  it("is the Foundry theme, reported as such, without a Designer slot model", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "producer-theme-"))); roots.push(root);
    const theme = await studioTheme(root);
    expect(theme).toEqual(defaultStudioTheme());
    expect(theme.source).toBe("foundry");
    expect(theme.message).toBeUndefined();
  });

  it("composes the consumer's pinned theme variables without writing into the consumer", async () => {
    const root = consumer();
    expect(pinnedThemes(root).length).toBeGreaterThan(0);
    const before = snapshot(root);
    const theme = await studioTheme(root);
    expect(theme.source).toBe("consumer");
    expect(theme.message).toBeUndefined();
    expect(theme.hash).toBe(themeHash(theme.css));
    expect(theme.css).toMatch(/^:root \{\n {2}--[a-z]/);
    expect(theme.hash).not.toBe(defaultStudioTheme().hash);
    expect(snapshot(root)).toEqual(before);
  });

  it("is the unbranded Foundry theme when the consumer pins no theme slot", async () => {
    const root = consumer();
    for (const id of pinnedThemes(root)) rmSync(join(designer(root), id, "pin.json"));
    expect(await studioTheme(root)).toEqual(defaultStudioTheme());
  });

  it("is a visible error, never a silent fallback, when a pinned theme candidate drifts", async () => {
    const root = consumer();
    const [id] = pinnedThemes(root);
    writeFileSync(pinned(root, id!), readFileSync(pinned(root, id!), "utf8") + "\n");
    const theme = await studioTheme(root);
    expect(theme.source).toBe("error");
    expect(theme.message).toBe(`Consumer theme could not be compiled: ${id} does not match its pin`);
    expect(theme.css).toBe(defaultStudioTheme().css);
  });

  it("is a visible error when the Designer IA cannot be read, and never exposes target paths", async () => {
    const root = consumer();
    const outside = realpathSync(mkdtempSync(join(tmpdir(), "producer-theme-outside-"))); roots.push(outside);
    const ia = join(designer(root), "ia.json");
    writeFileSync(join(outside, "ia.json"), readFileSync(ia));
    rmSync(ia); symlinkSync(join(outside, "ia.json"), ia);
    const theme = await studioTheme(root);
    expect(theme.source).toBe("error");
    expect(theme.message).toMatch(/^Consumer theme could not be compiled: /);
    expect(JSON.stringify(theme)).not.toContain(outside);
  });

  it("includes the consumer theme in the read-only config response", async () => {
    const root = consumer();
    const server = await startProducerServer({ root, port: 0, studioEntry: fileURLToPath(new URL("./__fixtures__/studio-child.mjs", import.meta.url)), handleSignals: false });
    try {
      const response = await fetch(`${server.url}/api/config`);
      const config = await response.json() as { readOnly: boolean; theme: { source: string; css: string; hash: string } };
      expect(response.status).toBe(200);
      expect(config.readOnly).toBe(true);
      expect(config.theme).toEqual(await studioTheme(root));
      expect(config.theme.source).toBe("consumer");
    } finally { await server.close(); }
  }, 60_000);
});
