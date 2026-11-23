/**
 * `clossys config --init` writes the consumer's shadcn flavor file, clossys/components.json, with the Designer's one
 * components.json writer (`@clossys/designer/shadcn-flavor`), the file scripts/check-generated-derived.mjs regenerates
 * and compares (R-SHADCN-FLAVOR), so code adopt and ref-verbatim can normalize stock items in a consumer
 * that has only installed the packages. A second run is idempotent: it writes nothing and the bytes stay the same.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { shadcnComponentsJsonText } from "@clossys/designer/shadcn-flavor";
import { PRODUCER_ROOT } from "../package-path.js";
import { consumerStylesheet, FLAVOR_FILE } from "../records/consumer-flavor.js";
import { runCli } from "./main.js";

const consumer = (): string => realpathSync(mkdtempSync(join(tmpdir(), "config-flavor-")));
const flavorAt = (root: string): string => readFileSync(join(root, ...FLAVOR_FILE.split("/")), "utf8");

describe("clossys config --init writes clossys/components.json", () => {
  it("writes the Designer writer's output for the consumer's stylesheet, next to the config", async () => {
    const root = consumer();
    const init = await runCli(["config", "--init", "--root", root], root);
    expect(init.exitCode, init.message).toBe(0);
    expect(init.message).toContain(`wrote ${FLAVOR_FILE} (the Designer's shadcn flavor)`);
    expect(existsSync(join(root, "clossys", "clossys.config.ts"))).toBe(true);
    const css = consumerStylesheet(join(root, "clossys"));
    expect(flavorAt(root)).toBe(shadcnComponentsJsonText({ css }));
    // The stylesheet it names exists, read from the consumer's folder (shadcn writes theme variables into it).
    expect(existsSync(resolve(root, "clossys", css))).toBe(true);
    const parsed = JSON.parse(flavorAt(root)) as { style: string; iconLibrary: string; aliases: Record<string, string> };
    expect(parsed.style).toBe("aria-nova");
    expect(parsed.iconLibrary).toBe("lucide");
    expect(parsed.aliases.ui).toBe("@/components/ui");
  }, 60_000);

  it("is the file the generated-derived check regenerates for that consumer (R-SHADCN-FLAVOR) and the seeder writes", async () => {
    const root = consumer();
    expect((await runCli(["config", "--init", "--root", root], root)).exitCode).toBe(0);
    const script = await import(pathToFileURL(join(PRODUCER_ROOT, "scripts", "check-generated-derived.mjs")).href) as {
      flavorJson: (css: string) => string; consumerStylesheet: (clossysRoot: string) => string; writeFlavor: (clossysRoot: string) => boolean;
    };
    expect(flavorAt(root)).toBe(script.flavorJson(script.consumerStylesheet(join(root, "clossys"))));
    const seeded = consumer();
    mkdirSync(join(seeded, "clossys"));
    expect(script.writeFlavor(join(seeded, "clossys"))).toBe(true);
    expect(flavorAt(root)).toBe(flavorAt(seeded));
  }, 60_000);

  it("is idempotent: a second run writes nothing and leaves the bytes as they were", async () => {
    const root = consumer();
    expect((await runCli(["config", "--init", "--root", root], root)).exitCode).toBe(0);
    const first = flavorAt(root);
    const again = await runCli(["config", "--init", "--root", root], root);
    expect(again.exitCode, again.message).toBe(0);
    expect(again.message).toBe("config: clossys/clossys.config.ts exists and is valid; nothing written");
    expect(flavorAt(root)).toBe(first);
  }, 60_000);

  it("brings a workspace that already has a config, but no flavor or another one, to the flavor", async () => {
    const root = consumer();
    expect((await runCli(["config", "--init", "--root", root], root)).exitCode).toBe(0);
    const expected = flavorAt(root);
    writeFileSync(join(root, "clossys", "components.json"), "{}\n");
    const rerun = await runCli(["config", "--init", "--root", root], root);
    expect(rerun.exitCode, rerun.message).toBe(0);
    expect(rerun.message).toBe(`config: clossys/clossys.config.ts exists and is valid; wrote ${FLAVOR_FILE} (the Designer's shadcn flavor)`);
    expect(flavorAt(root)).toBe(expected);
  }, 60_000);

  it("writes no flavor when the workspace's config is invalid", async () => {
    const root = consumer();
    mkdirSync(join(root, "clossys"));
    writeFileSync(join(root, "clossys", "clossys.config.ts"), "not a config\n");
    const init = await runCli(["config", "--init", "--root", root], root);
    expect(init.exitCode).toBe(1);
    expect(init.message).toMatch(/^config refused: clossys\/clossys\.config\.ts exists and is invalid/);
    expect(existsSync(join(root, "clossys", "components.json"))).toBe(false);
  }, 60_000);
});
