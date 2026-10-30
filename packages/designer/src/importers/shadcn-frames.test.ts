// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { importShadcnFrames } from "./shadcn-frames.js";
import { planSurfaceDefaults, DEFAULT_SURFACE_PREFERENCE } from "../catalog-core/surface-defaults.js";
import { importFoundryFrames } from "./foundry-frames.js";
import frameSlots from "../catalog/slots/frames.json" with { type: "json" };
import data from "./vendor/shadcn-app-shell.data.json" with { type: "json" };
import { sha256 } from "../catalog-core/digest.js";
import type { FrameSlot } from "../catalog-core/types.js";

describe("shadcn Aria application frame candidate", () => {
  it("pins actual upstream sidebar and licence bytes, and keeps port output fresh", () => {
    const { fills, upstream } = importShadcnFrames();
    expect(fills[0]!.$extensions["com.clossys.fill"]).toMatchObject({ id: "shadcn@aria/frames.app-shell", status: "draft", trust: "pinned-upstream" });
    expect(upstream.some(file => file.path.endsWith("/sidebar.tsx") && file.content.includes("SidebarInset"))).toBe(true);
    expect(upstream.some(file => file.path === "LICENSE.md" && file.content.includes("MIT License"))).toBe(true);
    expect(sha256(readFileSync(new URL("../frames/shadcn-aria/AppShell.tsx", import.meta.url), "utf8"))).toBe(data.port.sha256);
    expect(data.output.content).toContain("<SidebarProvider");
    expect(data.output.content).not.toMatch(/\bimport\s*\{\s*AppFrame\s*\}/);
    expect(data.output.content).not.toMatch(/<(?:div|nav|main|header|span|a|button|input)(?:\s|>)/);
  });

  it("offers the candidate through the normal preference and respects an explicit Foundry choice", () => {
    const fills = [...importFoundryFrames().fills, ...importShadcnFrames().fills];
    const catalog = { slots: frameSlots as unknown as FrameSlot[], fills };
    expect(DEFAULT_SURFACE_PREFERENCE).toEqual(["shadcn@aria", "foundry", "rac-starter"]);
    expect(planSurfaceDefaults({ catalog, slots: ["frames.app-shell"] }).rows[0]).toMatchObject({ source: "shadcn@aria", basis: "preference", status: "default" });
    expect(planSurfaceDefaults({ catalog, slots: ["frames.app-shell"], choices: { "frames.app-shell": "foundry" } }).rows[0]).toMatchObject({ source: "foundry", basis: "choose" });
  });

  it("retains every frame state port and refuses changed upstream source", () => {
    const result = importShadcnFrames(), candidate = Object.values(result.fills[0]!.frames!)[0]!;
    const contract = frameSlots.find(row => row.id === "frames.app-shell")!.contract;
    expect(Object.keys(candidate.statePorts).sort()).toEqual(contract.statePorts.map(port => port.id).sort());
    const changed = structuredClone(result.upstream); changed[0]!.content += "\n";
    expect(() => result.transforms[0]!.run({ candidate, upstream: changed })).toThrow("immutable source mismatch");
    expect(result.transforms[0]!.run({ candidate, upstream: result.upstream }).files).toEqual(result.files);
  });

  it("binds every emitted UI component to the consumer leaf without a private sidebar context hook", () => {
    const { fills, files } = importShadcnFrames(), frame = Object.values(fills[0]!.frames!)[0]!;
    const code = files.find(file => file.path === frame.impl.entry)!.content;
    expect(code).not.toContain('from "@clossys/designer/components"');
    expect(code).not.toContain("useSidebar");
    expect(new Set(frame.bindings.map(binding => binding.slot))).toEqual(new Set(["components.sidebar", "components.sheet", "components.semantic-content", "components.button", "components.logo", "components.menu"]));
    for (const binding of frame.bindings) expect(code).toContain(JSON.stringify(binding.module));
  });
});
