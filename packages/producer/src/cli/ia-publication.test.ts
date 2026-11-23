/**
 * R6 (foundry-build-0048): `clossys ia publisher --publication <pub>` writes one `publications` entry of the Publisher
 * workspace IA from package data: the directory L2 whose `publication` is <pub> (node, pages) and the package starter
 * (root, chrome, release, redirects). A release slot then places for that publication. It is refused without a
 * started IA, for a publication the package does not declare, and for an entry that differs from the package; a
 * second run writes nothing. Synthetic: an empty workspace that reads the installed Publisher package.
 */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "./main.js";
import { packagePublication } from "./owner.js";

const AT = "2026-11-23T00:00:00Z";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function workspace(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ia-publication-")));
  roots.push(root);
  mkdirSync(join(root, "clossys"), { recursive: true });
  copyFileSync(fileURLToPath(new URL("../../test-fixtures/consumer/clossys/clossys.config.ts", import.meta.url)), join(root, "clossys", "clossys.config.ts"));
  return root;
}
const IA = "clossys/agents/publisher/ia.json";
const iaDoc = (root: string) => JSON.parse(readFileSync(join(root, IA), "utf8")) as { publications?: Record<string, Record<string, unknown>> };
const ia = (root: string, ...argv: string[]) => runCli(["ia", ...argv, "--root", root], root);

describe("clossys ia publisher --publication <pub> (R6)", () => {
  it("records the package publication in the workspace IA, once, and a release slot then places for it", async () => {
    const root = workspace();
    expect((await ia(root, "publisher", "--start")).exitCode).toBe(0);
    const made = await ia(root, "publisher", "--publication", "docs");
    expect(made.exitCode, made.message).toBe(0);
    expect(iaDoc(root).publications).toEqual({
      docs: { node: "directory/docs/docs", starter: "docs", root: "/", pages: ["page.docs-index", "page.guide", "page.article", "page.changelog"], chrome: ["chrome.site-header", "chrome.site-footer", "chrome.docs-sidebar"], release: "release.docs", redirects: [] },
    });
    expect(packagePublication(root, "docs")).toEqual(iaDoc(root).publications!.docs);
    const bytes = readFileSync(join(root, IA), "utf8");
    const again = await ia(root, "publisher", "--publication", "docs");
    expect(again.exitCode).toBe(0);
    expect(again.message).toContain("nothing written");
    expect(readFileSync(join(root, IA), "utf8")).toBe(bytes);
    // releasePlacement accepts the entry: the release slot is created with no publisher/publication.docs slot.
    const contract = join(root, "release.json");
    writeFileSync(contract, `${JSON.stringify({ kind: "release", publication: "docs", requirements: [{ check: "release.manifest" }] })}\n`);
    const release = await ia(root, "publisher/release.docs", "--contract", contract, "--kind", "release", "--standard", "release", "--under", "web/docs", "--inputs", "", "--at", AT);
    expect(release.exitCode, release.message).toBe(0);
  });

  it("refuses without a started IA, an undeclared publication, a changed entry and other flags", async () => {
    const root = workspace();
    const none = await ia(root, "publisher", "--publication", "site");
    expect(none.exitCode).toBe(1);
    expect(none.message).toContain("publisher has no ia.json");
    expect((await ia(root, "publisher", "--start")).exitCode).toBe(0);
    const unknown = await ia(root, "publisher", "--publication", "company-one-pager");
    expect(unknown.exitCode).toBe(1);
    expect(unknown.message).toContain("no live L2 group with publication company-one-pager");
    expect(iaDoc(root).publications).toBeUndefined();
    expect((await ia(root, "publisher", "--publication", "site")).exitCode).toBe(0);
    const doc = iaDoc(root);
    writeFileSync(join(root, IA), `${JSON.stringify({ ...doc, publications: { site: { ...doc.publications!.site, root: "/home" } } }, null, 2)}\n`);
    const changed = await ia(root, "publisher", "--publication", "site");
    expect(changed.exitCode).toBe(1);
    expect(changed.message).toContain("differs from the package");
    const usage = await ia(root, "designer", "--publication", "site");
    expect(usage.exitCode).toBe(2);
    expect(usage.message).toContain("takes no other flag");
  });
});
