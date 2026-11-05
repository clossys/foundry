import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";
import { NEXT_ROUTE_MARKER } from "@clossys/publisher/install";
import { nextFailed, publishNext } from "./install-next.js";

let root: string;
const agentsDir = (agent: string) => fileURLToPath(new URL(`../../../../clossys/agents/${agent}/`, import.meta.url));
const designerIa = () => join(root, "clossys", "agents", "designer", "ia.json");
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "producer-install-next-"));
  await cp(agentsDir("publisher"), join(root, "clossys", "agents", "publisher"), { recursive: true });
  // Parameterized page records expand through each agent's IA: tabs and leaves are IA data.
  for (const agent of ["director", "designer", "writer"]) {
    await mkdir(join(root, "clossys", "agents", agent), { recursive: true });
    await cp(join(agentsDir(agent), "ia.json"), join(root, "clossys", "agents", agent, "ia.json"));
  }
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const install = (extra: Partial<Parameters<typeof publishNext>[0]> = {}) => publishNext({ root, publication: "studio", app: join(root, "app"), assembly: "../components/Page.tsx", live: true, out: join(root, "out"), ...extra });

it("installs every page of the pinned publication, expanded into IA tabs, and a dynamic leaf route per tab over its IA slots", async () => {
  const result = await install();
  expect(nextFailed(result)).toBe(false);
  expect(result.findings).toEqual([]);
  expect(result.files.every(row => row.state === "written")).toBe(true);
  const files = (kind: "page" | "leaf") => result.files.filter(row => row.kind === kind).map(row => row.file);
  // Home, then the Content overview (publication v5 lists it before the agents, cfa277893), then one
  // page per parameterized record (agent top group) and the tabs each record expands to.
  expect(files("page").slice(0, 2)).toEqual(["page.tsx", "content/page.tsx"]);
  expect(files("page")).toEqual(expect.arrayContaining(["director/context/page.tsx", "designer/themes/page.tsx", "writer/lexicon/page.tsx", "publisher/studio/page.tsx", "designer/themes/colors/page.tsx", "publisher/studio/pages/page.tsx"]));
  // Leaf routes live under tabs only; no flat per-agent [slug] route survives.
  expect(files("leaf")).toContain("designer/themes/colors/[slug]/page.tsx");
  expect(files("leaf").every(file => file.split("/").length === 5 && file.endsWith("/[slug]/page.tsx"))).toBe(true);
  for (const agent of ["director", "designer", "writer", "publisher"]) {
    expect(files("page")).not.toContain(`${agent}/page.tsx`);
    expect(files("leaf")).not.toContain(`${agent}/[slug]/page.tsx`);
  }
  const leaf = await readFile(join(root, "app", "designer", "themes", "colors", "[slug]", "page.tsx"), "utf8");
  expect(leaf.split("\n", 1)[0]).toBe(NEXT_ROUTE_MARKER);
  expect(leaf).toContain('{ slug: "themes.background" },');
  expect(leaf).not.toContain('{ slug: "sections.hero" },');
  expect(leaf).toContain("export function generateStaticParams()");
  expect(leaf).toContain('if (!(await publishedLeaf("designer-themes.colors", slug))) notFound();');
  expect(await readFile(join(root, "app", "page.tsx"), "utf8")).toContain('from "../components/Page"');
  const report = JSON.parse(await readFile(join(root, "out", "install-report.json"), "utf8"));
  expect(report).toMatchObject({ kind: "next", publication: "studio", findings: [] });
  expect(report.pages.slice(0, 2)).toEqual([{ page: "home", route: "/", file: "page.tsx" }, { page: "producer-pipeline", route: "/content", file: "content/page.tsx" }]);
  expect(report.pages).toHaveLength(files("page").length);
  expect(report.leaves.map((row: { route: string }) => row.route)).toContain("/designer/themes/colors/[slug]");
  expect((await install()).files.every(row => row.state === "unchanged")).toBe(true);
});

it("check mode reports drift for a changed IA without writing", async () => {
  await install();
  const ia = JSON.parse(await readFile(designerIa(), "utf8")) as { nodes: { id: string; children: { id: string; slots: string[] }[] }[] };
  const colors = ia.nodes.find(node => node.id === "themes.colors")!.children[0]!;
  const dropped = colors.slots.shift()!;
  await writeFile(designerIa(), JSON.stringify(ia));
  const result = await install({ check: true });
  expect(nextFailed(result)).toBe(true);
  expect(result.files.filter(row => row.state === "drift").map(row => row.file)).toEqual([`designer/themes/colors/[slug]/page.tsx`]);
  expect(await readFile(join(root, "app", "designer", "themes", "colors", "[slug]", "page.tsx"), "utf8")).toContain(`{ slug: "${dropped}" },`);
});

it("never overwrites a route file Publisher did not install", async () => {
  await mkdir(join(root, "app", "writer", "lexicon"), { recursive: true });
  await writeFile(join(root, "app", "writer", "lexicon", "page.tsx"), "export default function Page() { return null; }\n");
  const result = await install();
  expect(nextFailed(result)).toBe(true);
  expect(result.findings).toEqual([expect.objectContaining({ code: "site-contract", slot: "writer-lexicon", detail: "writer/lexicon/page.tsx exists and was not installed by Publisher" })]);
  expect(await readFile(join(root, "app", "writer", "lexicon", "page.tsx"), "utf8")).not.toContain(NEXT_ROUTE_MARKER);
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

it("with a states module installs the publication's shell, reports it, and refuses to overwrite a hand-written layout", async () => {
  await mkdir(join(root, "app"), { recursive: true });
  await writeFile(join(root, "app", "layout.tsx"), "export default function Layout() { return null; }\n");
  const refused = await install({ states: "../components/Renderer.tsx" });
  expect(nextFailed(refused)).toBe(true);
  expect(refused.findings).toEqual([expect.objectContaining({ code: "site-contract", detail: "layout.tsx exists and was not installed by Publisher" })]);
  await rm(join(root, "app", "layout.tsx"));
  const result = await install({ states: "../components/Renderer.tsx" });
  expect(nextFailed(result)).toBe(false);
  const shell = result.files.filter(row => row.kind === "shell");
  // The refused run already wrote the states it could; only the freed layout is new.
  expect(shell.map(row => [row.file, row.shell, row.state])).toEqual([
    ["layout.tsx", "document", "written"], ["loading.tsx", "loading", "unchanged"], ["not-found.tsx", "not-found", "unchanged"], ["error.tsx", "error", "unchanged"], ["global-error.tsx", "global-error", "unchanged"],
  ]);
  for (const row of shell) expect((await readFile(join(root, "app", row.file), "utf8")).split("\n", 1)[0]).toBe(NEXT_ROUTE_MARKER);
  const report = JSON.parse(await readFile(join(root, "out", "install-report.json"), "utf8"));
  expect(report.shell.map((row: { state: string }) => row.state)).toEqual(["document", "loading", "not-found", "error", "global-error"]);
  // A reinstall without the states module retires the marked shell, as it does any route no longer planned.
  const retired = await install();
  expect(retired.files.filter(row => row.state === "removed").map(row => row.file).sort()).toEqual(["error.tsx", "global-error.tsx", "layout.tsx", "loading.tsx", "not-found.tsx"]);
});
