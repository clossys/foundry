import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";
import { NEXT_ROUTE_MARKER } from "@clossys/publisher/install";
import { nextFailed, publishNext } from "./install-next.js";

let root: string;
const leaves = { director: [], designer: [{ slug: "sections.hero", title: "Hero" }, { slug: "frames.studio-shell", title: "Studio shell" }], writer: [], publisher: [{ slug: "page.home", title: "Home" }] };
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "producer-install-next-"));
  await cp(fileURLToPath(new URL("../../../../clossys/agents/publisher/", import.meta.url)), join(root, "clossys", "agents", "publisher"), { recursive: true });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const install = (extra: Partial<Parameters<typeof publishNext>[0]> = {}) => publishNext({ root, publication: "studio", app: join(root, "app"), assembly: "../components/Page.tsx", live: true, out: join(root, "out"), leaves, ...extra });

it("installs every page of the pinned publication and a dynamic leaf route per gallery, fed by the record store's leaves", async () => {
  const result = await install();
  expect(nextFailed(result)).toBe(false);
  expect(result.files.map(row => [row.file, row.kind, row.state])).toEqual([
    ["page.tsx", "page", "written"], ["director/page.tsx", "page", "written"], ["designer/page.tsx", "page", "written"], ["writer/page.tsx", "page", "written"], ["publisher/page.tsx", "page", "written"],
    ["director/[slug]/page.tsx", "leaf", "written"], ["designer/[slug]/page.tsx", "leaf", "written"], ["writer/[slug]/page.tsx", "leaf", "written"], ["publisher/[slug]/page.tsx", "leaf", "written"],
  ]);
  const leaf = await readFile(join(root, "app", "designer", "[slug]", "page.tsx"), "utf8");
  expect(leaf.split("\n", 1)[0]).toBe(NEXT_ROUTE_MARKER);
  expect(leaf).toContain('{ slug: "sections.hero" },');
  expect(leaf).toContain('{ slug: "frames.studio-shell" },');
  expect(leaf).toContain("export function generateStaticParams()");
  expect(leaf).toContain('if (!(await publishedLeaf("designer", slug))) notFound();');
  expect(await readFile(join(root, "app", "page.tsx"), "utf8")).toContain('from "../components/Page"');
  const report = JSON.parse(await readFile(join(root, "out", "install-report.json"), "utf8"));
  expect(report).toMatchObject({ kind: "next", publication: "studio", pages: [{ page: "home", route: "/", file: "page.tsx" }, { page: "director" }, { page: "designer" }, { page: "writer" }, { page: "publisher" }], findings: [] });
  expect(report.leaves.map((row: { route: string }) => row.route)).toEqual(["/director/[slug]", "/designer/[slug]", "/writer/[slug]", "/publisher/[slug]"]);
  expect((await install()).files.every(row => row.state === "unchanged")).toBe(true);
});

it("check mode reports drift for a changed record store without writing", async () => {
  await install();
  const result = await install({ check: true, leaves: { ...leaves, designer: [{ slug: "sections.hero", title: "Hero" }] } });
  expect(nextFailed(result)).toBe(true);
  expect(result.files.filter(row => row.state === "drift").map(row => row.file)).toEqual(["designer/[slug]/page.tsx"]);
  expect(await readFile(join(root, "app", "designer", "[slug]", "page.tsx"), "utf8")).toContain("frames.studio-shell");
});

it("never overwrites a route file Publisher did not install", async () => {
  await mkdir(join(root, "app", "writer"), { recursive: true });
  await writeFile(join(root, "app", "writer", "page.tsx"), "export default function Page() { return null; }\n");
  const result = await install();
  expect(nextFailed(result)).toBe(true);
  expect(result.findings).toEqual([expect.objectContaining({ code: "site-contract", slot: "writer", detail: "writer/page.tsx exists and was not installed by Publisher" })]);
  expect(await readFile(join(root, "app", "writer", "page.tsx"), "utf8")).not.toContain(NEXT_ROUTE_MARKER);
  expect(existsSync(join(root, "out", "install-report.json"))).toBe(false);
});

it("removes a marked route no page installs any more, and leaves other files alone", async () => {
  await install();
  await mkdir(join(root, "app", "retired", "[slug]"), { recursive: true });
  await writeFile(join(root, "app", "retired", "[slug]", "page.tsx"), `${NEXT_ROUTE_MARKER}\nexport default function Page() { return null; }\n`);
  await writeFile(join(root, "app", "layout.tsx"), "export default function Layout() { return null; }\n");
  const checked = await install({ check: true });
  expect(checked.files.filter(row => row.state === "drift").map(row => row.file)).toEqual(["retired/[slug]/page.tsx"]);
  const result = await install();
  expect(result.files.filter(row => row.state === "removed").map(row => row.file)).toEqual(["retired/[slug]/page.tsx"]);
  expect(existsSync(join(root, "app", "retired"))).toBe(false);
  expect(existsSync(join(root, "app", "layout.tsx"))).toBe(true);
});

it("refuses an unknown publication and a non-publication out dir", async () => {
  await expect(install({ publication: "../x" })).rejects.toThrow(/publication id/);
  await mkdir(join(root, "out"), { recursive: true });
  await writeFile(join(root, "out", "keep.txt"), "user file\n");
  await expect(install()).rejects.toThrow(/was not written by clossys publish --install/);
});
