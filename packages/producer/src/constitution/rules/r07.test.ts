import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildContext } from "../context.js";
import { cleanSpec, contextOf, expectCatches, NO_HISTORY, slotDoc, type WorkspaceSpec } from "../__fixtures__/workspace.js";
import { MODULE_REPO } from "./r11.js";
import { frameRegions } from "./r07.js";

const SIDEBAR = "export function AppSidebar() { return null; }\n";
const region = { name: "app-sidebar", type: "registry:block", files: [
  { path: "LICENCE.md", content: "MIT\n" },
  { path: "components/app-sidebar.tsx", content: SIDEBAR },
  { path: "components/nav-main.tsx", content: "export const NavMain = 1;\n" },
  { path: "page.tsx", target: "app/dashboard/page.tsx", content: "export default 1;\n" },
] };
const shell = (files: { path: string; content: string }[]) => ({ name: "shell", type: "registry:block", files: [{ path: "LICENCE.md", content: "MIT\n" }, { path: "page.tsx", content: "x\n" }, ...files] });

function spec(opts: { uses?: string[]; shellFiles?: { path: string; content: string }[] } = {}): WorkspaceSpec {
  const base = cleanSpec();
  return {
    ...base,
    designer: {
      ...base.designer,
      "frames.app-sidebar": { slot: { ...slotDoc("designer", "frames.app-sidebar"), ia: { l0: "frames", l1: "frames.regions" }, contract: { kind: "frame" } }, candidates: { "app-sidebar-v1.json": region } },
      "frames.app-shell": { slot: { ...slotDoc("designer", "frames.app-shell", { uses: opts.uses ?? ["frames.app-sidebar"] }), ia: { l0: "frames", l1: "frames.page-shells" }, contract: { kind: "frame" } }, candidates: { "app-shell-v1.json": shell(opts.shellFiles ?? [{ path: "shell.tsx", content: "import { AppSidebar } from \"@/components/app-sidebar\";\n" }]) } },
    },
  };
}

describe("R07.6 frame regions", () => {
  it("failing-first: a pinned region in no frame's uses is a row", () => {
    const rows = expectCatches(frameRegions, contextOf(spec()), contextOf(spec({ uses: [] })));
    expect(rows.map(r => [r.check, r.slot, r.reason])).toEqual([["R07.6", "frames.app-sidebar", "pinned region slot is in no frame's uses (no frame composes it)"]]);
  });

  it("failing-first: a frame inlining a region's files (by name or by bytes) is a row, demo page and licence aside", () => {
    const rows = expectCatches(frameRegions, contextOf(spec()), contextOf(spec({ shellFiles: [{ path: "app-sidebar.tsx", content: "edited copy\n" }, { path: "rail.tsx", content: SIDEBAR }] })));
    expect(rows.map(r => [r.check, r.slot, r.candidate])).toEqual([["R07.6", "frames.app-shell", "app-shell-v1.json"]]);
    expect(rows[0]!.reason).toMatch(/inlines a copy of region frames\.app-sidebar \(2 files: app-sidebar\.tsx, rail\.tsx\)/);
  });
});

describe.skipIf(!existsSync(`${MODULE_REPO}/clossys/agents/designer/frames.studio-shell`))("R07.6 on this repository", () => {
  it("flags the unconsumed frames.app-sidebar and the sidebar copy in studio-shell v21", () => {
    const rows = frameRegions(buildContext(MODULE_REPO, `${MODULE_REPO}/clossys`, { history: () => NO_HISTORY }));
    expect(rows.some(r => r.slot === "frames.app-sidebar" && /in no frame's uses/.test(r.reason))).toBe(true);
    expect(rows.some(r => r.slot === "frames.studio-shell" && r.candidate === "studio-shell-v21.json" && /region frames\.app-sidebar/.test(r.reason))).toBe(true);
  }, 120_000);
});
