import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { candidateRevisionContent, computeContentDigest } from "../digest.js";
import { releaseInput } from "../release/__fixtures__/release.js";
import { reviewInput } from "../review/__fixtures__/review.js";
import { loadContentStore, writeContentStore } from "../store/index.js";
import { readConsumerLibrarySnapshot } from "../store/library.js";
import * as releaseStore from "../store/release.js";
import { loadPublisherContext } from "./context.js";
import { executePublisherCommand } from "./workflow.js";
import type { PublisherCommand, PublisherCommandInput } from "./types.js";

vi.mock("./context.js", () => ({ loadPublisherContext: vi.fn() }));
vi.mock("../store/library.js", () => ({ readConsumerLibrarySnapshot: vi.fn() }));
const roots: string[] = [];
const at = "2026-02-05T05:06:07Z";
const catalog = {} as PublisherCommandInput["catalog"];
let root: string;
let libraries = reviewInput().libraries;
async function loaded() { return (await loadContentStore(root, { designer: { root: "library", catalog } })).registry; }
function command(command: PublisherCommand, input: unknown) {
  return executePublisherCommand({ command, input, root, designerRoot: "library", catalog, at });
}
async function candidate() { return (await loaded()).candidates[0]!; }
beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), "publisher-cli-")); roots.push(root);
  libraries = reviewInput().libraries;
  vi.mocked(readConsumerLibrarySnapshot).mockImplementation(async () => libraries[0]!);
  vi.mocked(loadPublisherContext).mockImplementation(async () => ({ registry: await loaded(), libraries }));
  const registry = releaseInput().registry;
  delete registry.slots[0]!.activeCandidateId;
  registry.candidates[0]!.state = "draft";
  delete registry.candidates[0]!.approval;
  await writeContentStore(root, registry);
});
afterEach(async () => {
  await Promise.all(roots.splice(0).map(value => fs.rm(value, { recursive: true, force: true })));
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("Publisher command workflow", () => {
  it("creates slots and globally unique candidates while refusing workflow fields", async () => {
    const registry = await loaded();
    const { id: _id, createdAt: _createdAt, releases: _releases, ...slot } = registry.slots[0]!;
    const created = await command("slot-create", { slot: { ...slot, aliases: ["websites/admin/another"], route: "/another" } });
    expect(created.exitCode).toBe(0);
    const next = await loaded();
    const addedSlot = next.slots.find(value => value.id !== registry.slots[0]!.id)!;
    expect(addedSlot.id).toMatch(/^sl_[a-z2-7]{10}$/);
    expect(addedSlot.releases).toEqual([]);
    expect(addedSlot.createdAt).toBe(at);
    const content = candidateRevisionContent(registry.candidates[0]!);
    expect((await command("candidate-add", { slotId: addedSlot.id, content })).exitCode).toBe(0);
    expect((await command("candidate-add", { slotId: addedSlot.id, content })).exitCode).toBe(0);
    expect((await loaded()).candidates.map(value => value.id)).toEqual(expect.arrayContaining(["c1", "c2"]));
    const refused = await command("candidate-add", { slotId: addedSlot.id, content: { ...content, state: "approved" } });
    expect(refused.exitCode).toBe(1);
    expect(refused.findings.some(value => value.rule === "unknown-field")).toBe(true);
    expect((await command("slot-create", { slot: { ...slot, id: "sl_aaaaaaaaaa" } })).exitCode).toBe(1);
  });

  it("requires requested review, explicit approval, and activation before writing a local release", async () => {
    const current = await candidate();
    const premature = await command("release", { candidateId: current.id, approvedBy: "owner" });
    expect(premature.exitCode).toBe(1);
    expect(premature.findings.map(value => value.rule)).toContain("publish-active-candidate");
    expect((await command("approve", { candidateId: current.id, by: "owner", revision: "r1", digest: computeContentDigest(current) })).exitCode).toBe(1);
    const reviewed = await command("review", { candidateId: current.id });
    expect(reviewed.exitCode).toBe(0);
    expect((await candidate()).state).toBe("in-review");
    expect((await candidate()).approval).toBeUndefined();
    const stored = JSON.parse(await fs.readFile(join(root, ".generated/reviews", `${current.id}.json`), "utf8"));
    expect(stored.requestedAt).toBe(at);
    expect(stored.report.checkedAgainst.locales).toEqual(["en", "fr"]);
    expect((await command("approve", { candidateId: current.id, by: "owner", revision: "r1", digest: computeContentDigest(current) })).exitCode).toBe(0);
    expect((await candidate()).state).toBe("approved");
    expect((await loaded()).slots[0]!.activeCandidateId).toBeUndefined();
    expect((await command("activate", { candidateId: current.id })).exitCode).toBe(0);
    expect((await loaded()).slots[0]!.activeCandidateId).toBe(current.id);
    expect((await command("release", { candidateId: current.id, approvedBy: "owner" })).exitCode).toBe(0);
    const handover = JSON.parse(await fs.readFile(join(root, "_releases/product-admin/1.handover.json"), "utf8"));
    expect(handover).toMatchObject({ matches: false, status: "pending", observedAt: null });
    expect((await loaded()).slots[0]!.releases).toEqual([]);
    expect((await command("candidate-revise", { candidateId: current.id, content: { ...candidateRevisionContent(current), name: "Changed" } })).exitCode).toBe(1);
  });

  it("reports publish failure when the actual release writer refuses a clean preflight", async () => {
    const current = await candidate();
    await command("review", { candidateId: current.id });
    await command("approve", { candidateId: current.id, by: "owner", revision: "r1", digest: computeContentDigest(current) });
    await command("activate", { candidateId: current.id });
    vi.spyOn(releaseStore, "writeContentRelease").mockResolvedValueOnce({
      ok: false, releases: [], findings: [{ path: "_releases", rule: "release-store-busy", message: "Release store lock could not be acquired" }],
    });
    const result = await command("release", { candidateId: current.id, approvedBy: "owner" });
    expect(result.exitCode).toBe(1);
    expect(result.findings.map(value => value.rule)).toContain("release-store-busy");
    expect(result.data).toMatchObject({ stages: { stages: { publish: { status: "Failing" } } } });
    expect(result.data).not.toHaveProperty("releases");
    await expect(fs.stat(join(root, "_releases"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("appends immutable content revisions, clears approval, and invalidates old review", async () => {
    const current = await candidate();
    await command("review", { candidateId: current.id });
    await command("approve", { candidateId: current.id, by: "owner", revision: "r1", digest: computeContentDigest(current) });
    const path = join(root, "_registry/candidates", current.slotId, current.id, "r1.json");
    const original = await fs.readFile(path);
    const result = await command("candidate-revise", { candidateId: current.id, content: { ...candidateRevisionContent(current), name: "Revised" } });
    expect(result.exitCode).toBe(0);
    const revised = await candidate();
    expect(revised.state).toBe("draft");
    expect(revised.approval).toBeUndefined();
    expect(revised.revision).toBe("r2");
    expect(revised.history).toHaveLength(2);
    expect(await fs.readFile(path)).toEqual(original);
    expect((await command("approve", { candidateId: revised.id, by: "owner", revision: revised.revision, digest: computeContentDigest(revised) })).exitCode).toBe(1);
  });

  it("returns actual review findings and Needs without autoapproval or caller proof", async () => {
    const current = await candidate();
    const content = candidateRevisionContent(current);
    const changed = { ...content, composition: { ...content.composition!, sections: [{ ...content.composition!.sections[0]!, sectionId: "sections.missing" }] } };
    expect((await command("candidate-revise", { candidateId: current.id, content: changed })).exitCode).toBe(0);
    const result = await command("review", { candidateId: current.id });
    expect(result.exitCode).toBe(1);
    expect(result.findings.some(value => value.rule === "unregistered-section")).toBe(true);
    expect((await candidate()).approval).toBeUndefined();
    expect((await candidate()).state).toBe("draft");
    expect((await command("review", { candidateId: current.id, proof: { status: "Done" } })).exitCode).toBe(1);
    const stored = JSON.parse(await fs.readFile(join(root, ".generated/reviews", `${current.id}.json`), "utf8"));
    expect(stored.report.needs.length).toBeGreaterThan(0);
  });

  it("refuses stale or tampered review and reports operational failures separately", async () => {
    const current = await candidate();
    await command("review", { candidateId: current.id });
    const path = join(root, ".generated/reviews", `${current.id}.json`);
    const stored = JSON.parse(await fs.readFile(path, "utf8"));
    stored.report.checkedAgainst.locales = ["en"];
    await fs.writeFile(path, JSON.stringify(stored));
    const result = await command("approve", { candidateId: current.id, by: "owner", revision: "r1", digest: computeContentDigest(current) });
    expect(result.exitCode).toBe(1);
    expect(result.findings.some(value => value.rule === "review-stale")).toBe(true);
    vi.mocked(loadPublisherContext).mockRejectedValueOnce(new Error("Store unavailable"));
    expect((await command("review", { candidateId: current.id })).exitCode).toBe(2);
  });
});
