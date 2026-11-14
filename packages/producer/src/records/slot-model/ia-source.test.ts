/** check:ia-source (SOURCE-MIGRATE step 6): an ia.json source resolves to a package path or is workspace-owned. */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveIaSource } from "./ia-source.js";
import { designerIa, directorIa, producerIa, writerIa } from "./foundry-ia.js";
import { placesStudioPublication, writerDeclarationsText } from "../../publish/studio-defaults.js";

const temps: string[] = [];
afterEach(() => { for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const temp = () => { const dir = realpathSync(mkdtempSync(join(tmpdir(), "ia-source-"))); temps.push(dir); return dir; };

describe("resolveIaSource", () => {
  it("resolves every package IA source and the workspace-owned source", () => {
    for (const ia of [directorIa(), designerIa(), writerIa(), producerIa()]) expect(resolveIaSource(ia.ia.source), ia.agent).toMatchObject({ ok: true, kind: "package" });
    expect(resolveIaSource("workspace#owner")).toEqual({ ok: true, kind: "workspace" });
  });
  it("refuses a leaf-freeze label, a consumer path, a missing package path and a path that leaves the package", () => {
    const pkg = temp();
    mkdirSync(join(pkg, "src"));
    writeFileSync(join(pkg, "src", "ia.json"), "{}\n");
    const resolver = (name: string) => { if (name !== "@clossys/fixture") throw new Error("not installed"); return pkg; };
    expect(resolveIaSource("@clossys/fixture#src/ia.json", resolver)).toMatchObject({ ok: true });
    for (const [source, reason] of [
      ["@clossys/fixture#leaf-freeze:2026-10-28", /does not exist/],
      ["consumer#agents/publisher/tree.json", /neither/],
      ["@clossys/fixture#src/missing.json", /does not exist/],
      ["@clossys/fixture#../outside.json", /leaves the package/],
      ["@clossys/absent#src/ia.json", /not installed/],
      [undefined, /not a string/],
    ] as const) expect(resolveIaSource(source, resolver), String(source)).toMatchObject({ ok: false, reason: expect.stringMatching(reason) });
  });
});

describe("the Studio Writer declarations package default", () => {
  const consumer = (publisherSlots: string[] | null, own?: string) => {
    const root = temp(), agents = join(root, "clossys", "agents");
    mkdirSync(join(agents, "writer"), { recursive: true });
    if (own !== undefined) writeFileSync(join(agents, "writer", "declarations.json"), own);
    if (publisherSlots) {
      mkdirSync(join(agents, "publisher"), { recursive: true });
      writeFileSync(join(agents, "publisher", "ia.json"), JSON.stringify({ schema: "clossys.ia/1", source: "workspace#owner", extensions: [], nodes: [{ id: "site", label: "Site", children: [{ id: "site.pages", label: "Pages", slots: publisherSlots }] }] }));
    }
    return join(root, "clossys");
  };
  it("applies only to a consumer that places the Studio publication, and a consumer's own file wins", () => {
    expect(writerDeclarationsText(consumer(null))).toBeUndefined();
    expect(writerDeclarationsText(consumer(["page.home"]))).toBeUndefined();
    const studio = consumer(["publication.studio"]);
    expect(placesStudioPublication(studio)).toBe(true);
    expect(JSON.parse(writerDeclarationsText(studio)!)).toMatchObject({ schema: "clossys.writer-declarations/1" });
    expect(writerDeclarationsText(consumer(["publication.studio"], "{\"own\":true}\n"))).toBe("{\"own\":true}\n");
  });
});
