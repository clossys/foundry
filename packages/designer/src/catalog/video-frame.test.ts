import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, type ComponentType, type ReactNode } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadBuildCatalog } from "../catalog-core/index.js";
import type { FrameContract } from "../catalog-core/frames-contract.js";
import frameSlots from "./slots/frames.json" with { type: "json" };
import componentIa from "./ia/components.json" with { type: "json" };
import placement from "./ia/frames.json" with { type: "json" };
import freeze from "./ia/frames.leaf-freeze.json" with { type: "json" };
import slotDefaults from "./slot-defaults.json" with { type: "json" };
import videoDefault from "./defaults/frames.video/stage-v1.json" with { type: "json" };
import { DESIGNER_RETIRED, literalCopyFindings, retiredFrameReferences, type DefaultFile } from "./ia/tree.js";

/**
 * CP1-VIDEO1 (owner 2026-11-26, "Ok include video, make sure all content are created natively with publisher agent/pkg and
 * follow the same level of rigor/process systematically"): frames.video is a 16:9 stage that holds one scene (a section)
 * over a named controls region built from the stock shadcn@aria Button and Slider. The scene count is plain numbers; every
 * word comes from the copy prop. Reduced motion: the frame starts paused.
 */
const ID = "frames.video";
type Copy = { sourceLocale: string; fields: { key: string; role: string; required: boolean }[] };
const video = () => frameSlots.find(slot => slot.id === ID) as unknown as { id: string; requires: string[]; status: string; contract: FrameContract & { copy: Copy } } | undefined;
const file = videoDefault as unknown as DefaultFile & { content: { export: string; registryDependencies: string[]; dependencies: string[] } };
const source = () => file.content.files![0]!.content;

describe("frames.video registration", () => {
  it("frames.video contract declares stage and controls regions", () => {
    const slot = video();
    expect(slot, ID).toBeDefined();
    const contract = slot!.contract;
    expect(slot).toMatchObject({ layer: "frames", requires: [], status: "draft" });
    expect(contract.kind).toBe("frame");
    expect(contract.slots).toEqual([{ id: "stage", required: true, accepts: "sections.*" }, { id: "controls", required: true, accepts: "host-node" }]);
    expect(contract.landmarks).toEqual([
      { slot: "stage", role: "main", topLevel: true, nameRequired: false },
      { slot: "controls", role: "region", topLevel: false, nameRequired: true },
    ]);
    expect(contract.members).toEqual({ mode: "closed", names: ["aspect.16-9", "start.paused"] });
    expect(contract.statePorts).toEqual([{ id: "playing", type: "boolean" }, { id: "scene", type: "number" }]);
    expect(contract.rendering).toBe("client");
    // Stock first (source ladder L1): the controls compose the live shadcn@aria button and slider, never the retired media player.
    // The Designer runtime VideoFrame also lays out its stage and controls landmarks with the semantic-content leaf (measured).
    expect(contract.composes).toEqual(["components.button", "components.semantic-content", "components.slider"]);
    expect(retiredFrameReferences([slot!], DESIGNER_RETIRED)).toEqual([]);
    for (const leaf of contract.composes ?? []) expect(componentIa.retired, leaf).not.toContain(leaf);
    expect(contract.copy.fields.map(field => [field.key, field.role, field.required])).toEqual([
      ["controls.label", "label", true], ["controls.play", "action", true], ["controls.pause", "action", true], ["controls.scrubber", "label", true],
    ]);
  });

  it("places frames.video once under Frames > Shells on the deck surface, live, with a slot-defaults row", () => {
    const homes = placement.nodes.flatMap(group => group.children.flatMap(family => family.leaves.filter(leaf => leaf === ID).map(() => family.id)));
    expect(homes).toEqual(["frames-shells"]);
    expect(placement.retired).not.toContain(ID);
    expect((placement.surface as Record<string, string>)[ID]).toBe("deck");
    expect((slotDefaults.slots as Record<string, unknown>)[ID]).toEqual({ standard: "frame" });
    const catalog = loadBuildCatalog();
    expect(catalog.slots.filter(slot => slot.id === ID)).toHaveLength(1);
    expect(catalog.retired.some(entry => entry.id === ID)).toBe(false);
  });

  it("leaf amendment adds frames.video without removing or renaming", () => {
    expect(freeze.leafIds).not.toContain(ID);
    expect(freeze.leafIds).toHaveLength(12);
    const amendment = freeze.amendments.find(entry => entry.add.includes(ID));
    expect(amendment).toMatchObject({ id: "cp1-video1-amendment-2026-11-26", remove: [], add: [ID] });
    expect(amendment!.why).toContain("2026-11-26");
    expect(freeze.amendments.flatMap(entry => entry.remove)).toEqual([]);
    // Frozen ids after the amendment (leafIds, then remove, then add, as Producer's frozenIds reads it) are the signed twelve plus video.
    const frozen = new Set<string>(freeze.leafIds);
    for (const entry of freeze.amendments) { for (const id of entry.remove) frozen.delete(id); for (const id of entry.add) frozen.add(id); }
    const placed = placement.nodes.flatMap(group => group.children.flatMap(family => family.leaves));
    expect([...frozen].sort()).toEqual([...placed].sort());
    expect([...frozen].filter(id => !freeze.leafIds.includes(id))).toEqual([ID]);
    expect(freeze.leafIds.filter(id => !frozen.has(id))).toEqual([]);
    expect(frameSlots.map(slot => slot.id).sort()).toEqual([...frozen].sort());
  });
});

// The package default, compiled with esbuild against the vendored stock shadcn@aria button and slider (references/), so the
// rendered frame is the stock components, not a stand-in.
const references = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "references", "shadcn-aria") + "/";
function compileDefault(): ComponentType<{ scenes: readonly ReactNode[]; copy: Record<string, string>; sceneSeconds?: number }> {
  const compiled = execFileSync(process.execPath, ["--input-type=module", "-e", `
    import { build } from "esbuild";
    import { readFileSync } from "node:fs";
    const { entry, references } = JSON.parse(readFileSync(0, "utf8"));
    const stock = { "@/components/ui/button": references + "button@4.23.0/registry/aria-nova/ui/button.tsx", "@/components/ui/slider": references + "slider@4.23.0/registry/aria-nova/ui/slider.tsx" };
    const output = await build({ stdin: { contents: entry, loader: "tsx", resolveDir: references }, bundle: true, write: false, format: "cjs", platform: "node", jsx: "automatic", logLevel: "silent", plugins: [{ name: "video-default", setup(plugin) {
      plugin.onResolve({ filter: /.*/ }, args => {
        if (stock[args.path]) return { path: stock[args.path] };
        if (args.path === "@/lib/utils" || args.path === "cn") return { path: "cn", namespace: "video-cn" };
        if (args.path.startsWith("@/")) return { errors: [{ text: "unresolved registry import " + args.path }] };
        return { path: args.path, external: true };
      });
      plugin.onLoad({ filter: /.*/, namespace: "video-cn" }, () => ({ contents: "import { clsx } from 'clsx'; import { twMerge } from 'tailwind-merge'; export const cn = (...inputs) => twMerge(clsx(inputs));", loader: "js", resolveDir: references }));
    } }] });
    process.stdout.write(output.outputFiles[0].text);
  `], { input: JSON.stringify({ entry: source(), references }), encoding: "utf8" });
  const module = { exports: {} as Record<string, unknown> };
  new Function("require", "module", "exports", compiled)(createRequire(import.meta.url), module, module.exports);
  return module.exports[file.content.export] as never;
}

describe("frames.video package default", () => {
  afterEach(() => { vi.useRealTimers(); });
  const copy = { "controls.label": "COPY controls", "controls.play": "COPY play", "controls.pause": "COPY pause", "controls.scrubber": "COPY scrubber" };
  const scenes = ["one", "two", "three"].map(name => createElement("section", { key: name, "data-scene": name }, `SCENE ${name}`));

  it("frames.video default passes its contract", () => {
    const contract = video()!.contract;
    // A package default of designer/frames.video: a stock-first registry block on the stock button and slider, no new dependency.
    expect(file.clossys).toMatchObject({ schema: "clossys.candidate/1", id: "designer/frames.video/package:stage-v1.json", slot: "designer/frames.video", source: { kind: "package-default" } });
    expect(file.content).toMatchObject({ type: "registry:block", export: "VideoFrame", variants: { aspect: ["16:9"], start: ["paused"] }, dependencies: [], registryDependencies: ["button", "slider", "utils"] });
    // Every registry dependency is a declared compose; the one other compose is the runtime's semantic-content landmarks.
    expect(contract.composes!.filter(leaf => leaf !== "components.semantic-content")).toEqual(file.content.registryDependencies.filter(name => name !== "utils").map(name => `components.${name}`));
    expect([...source().matchAll(/from "(@\/[^"]+)"/g)].map(match => match[1])).toEqual(["@/lib/utils", "@/components/ui/button", "@/components/ui/slider"]);
    // Words come from Writer through the copy prop: no literal JSX text, and every copy key the default reads is declared.
    expect(literalCopyFindings(file)).toEqual([]);
    expect([...new Set([...source().matchAll(/copy\["([a-z.]+)"\]/g)].map(match => match[1]))].sort()).toEqual(contract.copy.fields.map(field => field.key).sort());

    vi.useFakeTimers();
    const VideoFrame = compileDefault();
    const { container } = render(createElement(VideoFrame, { scenes, copy, sceneSeconds: 2 }));
    const frame = container.querySelector("[data-slot=video-frame]")!;
    // Member aspect.16-9 and start.paused: a 16:9 stage, paused on the first scene.
    expect(frame.getAttribute("data-aspect")).toBe("16:9");
    expect(frame.getAttribute("data-start")).toBe("paused");
    expect(frame.getAttribute("data-playing")).toBe("false");
    // Landmarks: the stage is the one main region holding exactly one scene; the controls are a region named by copy.
    const stage = screen.getByRole("main");
    expect(stage.getAttribute("data-slot")).toBe("video-stage");
    expect(stage.className).toContain("aspect-video");
    expect(stage.querySelectorAll("[data-scene]")).toHaveLength(1);
    expect(within(stage).getByText("SCENE one")).toBeTruthy();
    const controls = screen.getByRole("region", { name: "COPY controls" });
    expect(controls.getAttribute("data-slot")).toBe("video-controls");
    expect(stage.contains(controls)).toBe(false);
    // Controls: the stock button (play/pause), the stock slider (scene scrubber) and the scene count.
    const play = within(controls).getByRole("button", { name: "COPY play" });
    expect(play.getAttribute("data-slot")).toBe("button");
    const scrubber = within(controls).getByRole("slider", { name: "COPY scrubber" });
    expect(controls.querySelector("[data-slot=slider]")).toBeTruthy();
    // React Aria's slider thumb is a native range input: one step per scene, first to last.
    const range = scrubber as HTMLInputElement;
    expect([range.type, range.min, range.max, range.step, range.value]).toEqual(["range", "0", "2", "1", "0"]);
    expect(controls.querySelector("[data-slot=video-scene-count]")!.textContent).toBe("1 / 3");
    // Paused means nothing moves: time passing alone never advances the scene.
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(within(stage).getByText("SCENE one")).toBeTruthy();
    // Play advances one scene per sceneSeconds and stops on the last scene.
    fireEvent.click(play);
    expect(within(controls).getByRole("button", { name: "COPY pause" })).toBeTruthy();
    expect(frame.getAttribute("data-playing")).toBe("true");
    act(() => { vi.advanceTimersByTime(2_000); });
    expect(within(stage).getByText("SCENE two")).toBeTruthy();
    expect(controls.querySelector("[data-slot=video-scene-count]")!.textContent).toBe("2 / 3");
    act(() => { vi.advanceTimersByTime(2_000); });
    expect(within(stage).getByText("SCENE three")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(0); });
    expect(frame.getAttribute("data-playing")).toBe("false");
    expect(within(controls).getByRole("button", { name: "COPY play" })).toBeTruthy();
    expect((within(controls).getByRole("slider", { name: "COPY scrubber" }) as HTMLInputElement).value).toBe("2");
  });
});
