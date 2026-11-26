/**
 * Specimen assets (CP1-G2): the bound install publishes only the specimen PNGs a render index names, verified by
 * sha256, content-addressed into the site's `public/clossys/renders/`; everything else under `.state` stays there.
 */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { RENDERS_DIR } from "../specimen/render.js";
import { PNG_SIGNATURE, planSpecimenAssets, recordSpecimenRefs, resolveRecordSpecimens, SPECIMEN_PUBLIC_DIR, specimenPublicPath, writeSpecimenAssets } from "./specimen-assets.js";

const temps: string[] = [];
afterAll(() => { for (const dir of temps) rmSync(dir, { recursive: true, force: true }); });

const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const png = (seed: string) => Buffer.concat([PNG_SIGNATURE, Buffer.from(`\0\0\0\rIHDR${seed}`)]);
const CANDIDATE_DIR = `${RENDERS_DIR}/designer/sections.slot-detail/slot-detail-v1`;
const ELEMENT = `${CANDIDATE_DIR}/element-480.png`;

/** A workspace two folders below a temp base (so `../../` from it stays inside the temp base), with a site project. */
function workspace(): { base: string; root: string; site: string } {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "producer-specimen-assets-")));
  temps.push(base);
  const root = join(base, "ws", "consumer");
  const site = join(root, "apps", "site");
  mkdirSync(join(root, RENDERS_DIR), { recursive: true });
  mkdirSync(site, { recursive: true });
  return { base, root, site };
}
const put = (path: string, bytes: Buffer | string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes); };
/** A `clossys.render/1` index naming `pngs`, written at `<root>/<dir>/index.json`. */
function index(root: string, dir: string, pngs: readonly string[]) {
  put(join(root, dir, "index.json"), `${JSON.stringify({
    schema: "clossys.render/1", ref: "designer/sections.slot-detail/slot-detail-v1.json", inputsSha256: "0".repeat(64), renderedAt: "2026-11-26T00:00:00.000Z",
    by: { actor: "code", cli: "clossys render", version: "0.0.0-test" },
    specimens: pngs.map(path => ({ candidate: "slot-detail-v1.json", specimen: "element", width: 480, png: path })),
  }, null, 2)}\n`);
}
/** Every file under the site's `public/`, relative to it. */
function publicFiles(site: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name), `${prefix}${entry.name}/`);
      else out.push(`${prefix}${entry.name}`);
    }
  };
  walk(join(site, "public"), "");
  return out.sort();
}
const records = (specimens: readonly unknown[]) => ({
  ports: { candidates: { "designer/sections.slot-detail": specimens.map((specimen, at) => ({ name: `slot-detail-v${at + 1}.json`, version: at + 1, pinned: at === 0, specimen })) } },
});
/** The install step: plan from the records' references, write the accepted assets, resolve the records. */
async function install(root: string, site: string, refs: readonly unknown[]) {
  const plan = planSpecimenAssets(root, refs);
  const written = await writeSpecimenAssets(site, plan.assets);
  return { plan, written };
}
const codes = (plan: { refusals: readonly { code: string }[] }) => plan.refusals.map(row => row.code);

describe("specimen assets (CP1-G2)", () => {
  it("(a) copies a PNG the index names to public/clossys/renders/<sha256>.png with identical bytes, and the record resolves to it", async () => {
    const { root, site } = workspace();
    const bytes = png("a");
    put(join(root, ELEMENT), bytes);
    index(root, CANDIDATE_DIR, [ELEMENT]);
    const snapshot = records([{ sha256: sha(bytes), path: ELEMENT }]);
    const { plan, written } = await install(root, site, recordSpecimenRefs(snapshot));
    expect(plan.refusals).toEqual([]);
    expect(written.written).toEqual([`${SPECIMEN_PUBLIC_DIR}/${sha(bytes)}.png`]);
    expect(publicFiles(site)).toEqual([`clossys/renders/${sha(bytes)}.png`]);
    const resolved = resolveRecordSpecimens(snapshot, plan.assets);
    const specimen = (resolved.ports.candidates["designer/sections.slot-detail"]![0] as { specimen: { sha256: string; path: string } }).specimen;
    expect(specimen).toEqual({ sha256: sha(bytes), path: specimenPublicPath(sha(bytes)) });
    expect(specimen.path).toBe(`/clossys/renders/${sha(bytes)}.png`);
    expect(readFileSync(join(site, "public", specimen.path)).equals(bytes)).toBe(true);
    // Nothing else in the row changes.
    expect({ ...resolved.ports.candidates["designer/sections.slot-detail"]![0] as object, specimen: undefined }).toEqual({ ...snapshot.ports.candidates["designer/sections.slot-detail"][0], specimen: undefined });
  });

  it("(b) refuses an index entry ../../secret.png, an absolute path and a symlinked folder, and writes nothing", async () => {
    const { base, root, site } = workspace();
    const secret = png("secret");
    const secretPath = resolve(root, "../../secret.png");
    expect(secretPath).toBe(join(base, "secret.png"));
    put(secretPath, secret);
    // A folder inside the render root that links out to a folder holding a PNG.
    put(join(base, "elsewhere", "element-480.png"), secret);
    symlinkSync(join(base, "elsewhere"), join(root, RENDERS_DIR, "linked"));
    const linked = `${RENDERS_DIR}/linked/element-480.png`;
    index(root, RENDERS_DIR, ["../../secret.png", secretPath, linked, `${RENDERS_DIR}/../../../secret.png`]);
    const refs = [
      { sha256: sha(secret), path: "../../secret.png" },
      { sha256: sha(secret), path: secretPath },
      { sha256: sha(secret), path: linked },
      { sha256: sha(secret), path: `${RENDERS_DIR}/../../../secret.png` },
    ];
    const { plan, written } = await install(root, site, recordSpecimenRefs(records(refs)));
    expect(codes(plan)).toEqual(["specimen-outside-root", "specimen-outside-root", "specimen-outside-root", "specimen-outside-root"]);
    expect(plan.assets).toEqual([]);
    expect(written.written).toEqual([]);
    expect(publicFiles(site)).toEqual([]);
    const resolved = resolveRecordSpecimens(records(refs), plan.assets);
    expect(resolved.ports.candidates["designer/sections.slot-detail"]!.map(row => (row as { specimen: unknown }).specimen)).toEqual([null, null, null, null]);
  });

  it("(c) refuses a symlinked PNG inside the render root that points outside it, and one that points inside it", async () => {
    const { base, root, site } = workspace();
    const outside = png("outside");
    put(join(base, "outside.png"), outside);
    mkdirSync(join(root, CANDIDATE_DIR), { recursive: true });
    symlinkSync(join(base, "outside.png"), join(root, ELEMENT));
    const inside = png("inside");
    const real = `${CANDIDATE_DIR}/real.png`;
    const alias = `${CANDIDATE_DIR}/alias.png`;
    put(join(root, real), inside);
    symlinkSync(join(root, real), join(root, alias));
    index(root, CANDIDATE_DIR, [ELEMENT, alias]);
    const { plan, written } = await install(root, site, [{ sha256: sha(outside), path: ELEMENT }, { sha256: sha(inside), path: alias }]);
    expect(codes(plan)).toEqual(["specimen-symlink", "specimen-symlink"]);
    expect(written.written).toEqual([]);
    expect(publicFiles(site)).toEqual([]);
    expect(lstatSync(join(root, ELEMENT)).isSymbolicLink()).toBe(true);
  });

  it("(d) refuses a .json file and a .png without the PNG signature", async () => {
    const { root, site } = workspace();
    const json = Buffer.from('{"not":"a png"}\n');
    const fake = Buffer.from("GIF89a, not a png at all");
    const jsonPath = `${CANDIDATE_DIR}/data.json`;
    const fakePath = `${CANDIDATE_DIR}/fake.png`;
    put(join(root, jsonPath), json);
    put(join(root, fakePath), fake);
    index(root, CANDIDATE_DIR, [jsonPath, fakePath, `${CANDIDATE_DIR}/index.json`]);
    const indexBytes = readFileSync(join(root, CANDIDATE_DIR, "index.json"));
    const { plan, written } = await install(root, site, [
      { sha256: sha(json), path: jsonPath }, { sha256: sha(fake), path: fakePath }, { sha256: sha(indexBytes), path: `${CANDIDATE_DIR}/index.json` },
    ]);
    expect(codes(plan)).toEqual(["specimen-not-png", "specimen-not-png", "specimen-not-png"]);
    expect(plan.refusals[1]!.detail).toMatch(/PNG signature/);
    expect(written.written).toEqual([]);
    expect(publicFiles(site)).toEqual([]);
  });

  it("(e) refuses a sha256 that does not match the bytes", async () => {
    const { root, site } = workspace();
    const bytes = png("e");
    put(join(root, ELEMENT), bytes);
    index(root, CANDIDATE_DIR, [ELEMENT]);
    const { plan, written } = await install(root, site, [{ sha256: sha(png("other")), path: ELEMENT }]);
    expect(codes(plan)).toEqual(["specimen-sha256-mismatch"]);
    expect(written.written).toEqual([]);
    expect(publicFiles(site)).toEqual([]);
    // A reference that is no sha256 is refused before anything is read.
    expect(codes(planSpecimenAssets(root, [{ sha256: "../../x", path: ELEMENT }, { path: ELEMENT }]))).toEqual(["specimen-invalid-ref", "specimen-invalid-ref"]);
  });

  it("(f) never copies a PNG in the render folder that the index does not name", async () => {
    const { root, site } = workspace();
    const named = png("named");
    const stray = png("stray");
    const strayPath = `${CANDIDATE_DIR}/stray.png`;
    put(join(root, ELEMENT), named);
    put(join(root, strayPath), stray);
    index(root, CANDIDATE_DIR, [ELEMENT]);
    const { plan, written } = await install(root, site, [{ sha256: sha(named), path: ELEMENT }, { sha256: sha(stray), path: strayPath }]);
    expect(codes(plan)).toEqual(["specimen-not-indexed"]);
    expect(written.written).toEqual([`${SPECIMEN_PUBLIC_DIR}/${sha(named)}.png`]);
    expect(publicFiles(site)).toEqual([`clossys/renders/${sha(named)}.png`]);
    // No index at all names nothing.
    const bare = workspace();
    put(join(bare.root, ELEMENT), named);
    expect(codes(planSpecimenAssets(bare.root, [{ sha256: sha(named), path: ELEMENT }]))).toEqual(["specimen-not-indexed"]);
  });

  it("(g) a second install writes no new file", async () => {
    const { root, site } = workspace();
    const bytes = png("g");
    put(join(root, ELEMENT), bytes);
    index(root, CANDIDATE_DIR, [ELEMENT]);
    const refs = [{ sha256: sha(bytes), path: ELEMENT }];
    const first = await install(root, site, refs);
    expect(first.written.written).toHaveLength(1);
    const target = join(site, SPECIMEN_PUBLIC_DIR, `${sha(bytes)}.png`);
    const before = statSync(target);
    const second = await install(root, site, refs);
    expect(second.plan.refusals).toEqual([]);
    expect(second.written.written).toEqual([]);
    expect(second.written.unchanged).toEqual([`${SPECIMEN_PUBLIC_DIR}/${sha(bytes)}.png`]);
    const after = statSync(target);
    expect([after.ino, after.mtimeMs]).toEqual([before.ino, before.mtimeMs]);
    expect(publicFiles(site)).toEqual([`clossys/renders/${sha(bytes)}.png`]);
  });

  it("never writes through a public target that is not a regular file", async () => {
    const { base, root, site } = workspace();
    const bytes = png("target");
    put(join(root, ELEMENT), bytes);
    index(root, CANDIDATE_DIR, [ELEMENT]);
    mkdirSync(join(site, SPECIMEN_PUBLIC_DIR), { recursive: true });
    put(join(base, "victim.png"), "untouched");
    symlinkSync(join(base, "victim.png"), join(site, SPECIMEN_PUBLIC_DIR, `${sha(bytes)}.png`));
    const { plan, written } = await install(root, site, [{ sha256: sha(bytes), path: ELEMENT }]);
    expect(plan.refusals).toEqual([]);
    expect(written.refusals.map(row => row.code)).toEqual(["specimen-target-not-file"]);
    expect(written.written).toEqual([]);
    expect(readFileSync(join(base, "victim.png"), "utf8")).toBe("untouched");
  });
});
