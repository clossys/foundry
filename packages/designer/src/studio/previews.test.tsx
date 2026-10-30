import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { buildCandidates, type Candidate } from "./model.js";
import { CandidateCell } from "./CandidateCell.js";
import { completedTokenLibrary } from "../importers/__fixtures__/completed-token-library.js";
import { TOKENS } from "../tokens/tokens.js";
import { CompactPreview, SlotPreview, PREVIEW_LIMIT, isFontDeclared } from "./previews.js";
import { catalog, emptyLibrary, adopt, labels } from "./__fixtures__/studio.js";
afterEach(cleanup);
it("uses actual resolved token previews and caps member rows", () => {
 const library=adopt(); const candidate=buildCandidates({catalog,library,working:library,slotId:"tokens.surface-color",scope:"slot",target:"tokens.surface-color"})[0]!;
 const view=render(<SlotPreview members={candidate.members} labels={labels}/>); expect(view.container.querySelectorAll("figure").length).toBeGreaterThan(0);
 const members=Array.from({length:PREVIEW_LIMIT+6},(_,i)=>({...candidate.members[0]!,id:`tokens.surface-color.test${i}`})); const capped=render(<SlotPreview members={members} labels={labels}/>); expect(capped.container.querySelectorAll("li")).toHaveLength(24); expect(capped.container.querySelector("[data-preview-more]")).toHaveTextContent("+6");
});
it("does not claim an undeclared page font is loaded",()=>{expect(isFontDeclared("Unknown Font")).toBe(false);});
it("renders checked SVG assets through the existing image route rather than a token sample", () => {
 const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="black"/></svg>';
 const member={ slot:"assets.mark", source:"example", fill:"example/mark", via:"authored" as const, $type:"svg" as const, value:{light:svg}, css:{light:svg}, alias:{} };
 const view=render(<SlotPreview members={[{id:"assets.mark.positive",member}]} labels={labels}/>);
 expect(view.container.querySelector("img")?.getAttribute("src")).toBe(`data:image/svg+xml,${encodeURIComponent(svg)}`);
 expect(view.container.querySelector("figure")).toBeNull();
 expect(view.container.querySelector("svg")).toBeNull();
});
it("shows canonical Tailwind achromatic OKLCH none as a strict swatch with labelled channels and the exact source kept for copy", () => {
 const doc = catalog.fills.find(doc => doc.$extensions["com.clossys.fill"].slot.startsWith("tokens.") && doc.$extensions["com.clossys.fill"].source.includes("tailwind") && JSON.stringify(doc).includes(" none)"))!;
 expect(doc).toBeDefined();
 const meta = doc.$extensions["com.clossys.fill"], library = emptyLibrary();
 const candidate = buildCandidates({ catalog, library, working: library, slotId: meta.slot, scope: "slot", target: meta.slot }).find(candidate => candidate.source === meta.source)!;
 const entries = candidate.members.filter(({ member }) => [member.css.light, member.css.dark].some(value => value?.includes("none)")));
 expect(entries.length).toBeGreaterThan(0);
 for (const entry of entries) {
  const view = render(<CompactPreview candidate={{ ...candidate, members: [entry] }} labels={labels} />);
  expect(view.queryByText(labels.visualPreviewUnsupported)).toBeNull();
  expect(view.container.querySelector("[data-studio-color-swatch]")).not.toBeNull();
  const value = view.container.querySelector<HTMLElement>("[data-member-value]")!;
  expect(value.dataset.copyValue).toBe(entry.member.css.light);
  expect(value.getAttribute("title")).toBe(entry.member.css.light);
  expect([...value.querySelectorAll("[data-channel]")].map(channel => channel.getAttribute("data-channel"))).toEqual(["L", "C", "H"]);
  expect(candidate.findings.some(finding => finding.code === "C1" && finding.severity === "error")).toBe(false);
  view.unmount();
 }
});

it("labels the channels of oklch(97% 0 none) and keeps the exact string", () => {
 const library = emptyLibrary();
 const candidate = buildCandidates({ catalog, library, working: library, slotId: "tokens.color-ramp", scope: "slot", target: "tokens.color-ramp" }).find(candidate => candidate.members.some(({ member }) => member.css.light === "oklch(97% 0 none)"))!;
 const entry = candidate.members.find(({ member }) => member.css.light === "oklch(97% 0 none)")!;
 const view = render(<CompactPreview candidate={{ ...candidate, members: [entry] }} labels={labels} />);
 const value = view.container.querySelector<HTMLElement>("[data-member-value]")!;
 expect([...value.querySelectorAll("[data-channel]")].map(channel => `${channel.getAttribute("data-channel")}=${channel.querySelector("[data-channel-value]")?.textContent}`)).toEqual(["L=97%", "C=0", "H=none"]);
 expect(value.dataset.copyValue).toBe("oklch(97% 0 none)");
});

// ---- C21-4 token leaf specimens, exercised through the real Studio cell ----
const signed = completedTokenLibrary(catalog, { id: "specimen-consumer", kind: "consumer", author: "consumer", license: "UNLICENSED" }, "2026-10-25");
const selected = (slotId: string): Candidate => {
 const candidate = buildCandidates({ catalog, library: signed, working: signed, scope: "slot", target: slotId, slotId }).find(entry => entry.selected);
 if (!candidate) throw new Error(`no selected candidate for ${slotId}`);
 return candidate;
};
const variants = (slotId: string) => {
 const candidate = selected(slotId);
 const view = render(<CandidateCell candidate={candidate} labels={labels} />);
 return candidate.members.map(({ id, member }) => ({ id, member, key: id.slice(member.slot.length + 1), variant: [...view.container.querySelectorAll<HTMLElement>("[data-candidate-variant]")].find(element => element.dataset.candidateVariant === id)! }));
};
const binding = (element: Element | null | undefined): string | undefined => (element as HTMLElement | null | undefined)?.style.getPropertyValue("--studio-specimen-value") || undefined;

it.each([
 ["tokens.duration", "duration"], ["tokens.behavior-timing", "duration"], ["tokens.transition-duration", "duration"],
 ["tokens.easing", "easing"], ["tokens.transition-easing", "easing"],
] as const)("motion specimens of %s bind the member's %s and Play toggles data-playing", (slotId, role) => {
 for (const { member, key, variant } of variants(slotId)) {
  const figure = variant.querySelector<HTMLElement>('figure[data-token-specimen="motion"]');
  expect(figure, key).not.toBeNull();
  expect(binding(figure), key).toBe(member.css.light);
  const mover = figure!.querySelector<HTMLElement>("[data-motion-target]")!;
  expect(mover.className).toContain("transition-transform");
  expect(mover.className).toContain(role === "duration" ? "duration-(--studio-specimen-value)" : "ease-(--studio-specimen-value)");
  // Reduced motion shows the end state, never a frozen start.
  expect(mover.className).toContain("motion-reduce:transition-none");
  expect(mover.className).toMatch(/motion-reduce:translate-x-/);
  expect(figure!.dataset.playing).toBe("false");
  fireEvent.click(figure!.querySelector("button")!);
  expect(figure!.dataset.playing, key).toBe("true");
  fireEvent.click(figure!.querySelector("button")!);
  expect(figure!.dataset.playing).toBe("false");
 }
 cleanup();
});

it.each(["tokens.breakpoint", "tokens.control-size", "tokens.content-size", "tokens.region-width"])("size members of %s render distinct true-px ruler bindings on one shared scale", slotId => {
 const rows = variants(slotId);
 const scales = new Set<string>();
 for (const { member, key, variant } of rows) {
  const figure = variant.querySelector<HTMLElement>('figure[data-token-specimen="ruler"]');
  expect(figure, key).not.toBeNull();
  expect(binding(figure), key).toBe(member.css.light);
  const bar = figure!.querySelector<HTMLElement>("[data-ruler-bar]")!;
  // The bar is the member's own length at the leaf's one scale factor.
  expect(bar.className).toContain("w-(--studio-ruler-bar)");
  expect(figure!.style.getPropertyValue("--studio-ruler-bar"), key).toMatch(new RegExp(`^calc\\(${member.css.light.replace(/[()*+.?[\]\\^$|]/g, "\\$&")} \\* [\\d.]+\\)$`));
  scales.add(figure!.dataset.rulerScale!);
  expect(figure!.querySelectorAll("[data-ruler-tick]").length).toBeGreaterThanOrEqual(3);
 }
 expect(scales.size).toBe(1);
 const distinctValues = new Set(rows.map(row => row.member.css.light));
 expect(new Set(rows.map(row => binding(row.variant.querySelector('figure[data-token-specimen="ruler"]')))).size).toBe(distinctValues.size);
 cleanup();
});

it("z-index shows the 11 registered layers as a fan stack in rank order with the member raised at its own value", () => {
 const ranks = Object.values(TOKENS).filter(token => token.family === "z").sort((a, b) => Number(a.value) - Number(b.value)).map(token => token.property);
 expect(ranks).toHaveLength(11);
 for (const { member, key, variant } of variants("tokens.z-index")) {
  const figure = variant.querySelector<HTMLElement>('figure[data-token-specimen="layer-fan"]');
  expect(figure, key).not.toBeNull();
  const plates = [...figure!.querySelectorAll<HTMLElement>("[data-layer-rank]")];
  expect(plates.map(plate => plate.dataset.layerProperty)).toEqual(ranks);
  expect(plates.map(plate => Number(plate.dataset.layerRank))).toEqual(ranks.map((_, index) => index));
  const current = plates.filter(plate => plate.hasAttribute("data-current"));
  expect(current.map(plate => plate.dataset.layerProperty), key).toEqual([member.emit]);
  expect(current[0]!.style.getPropertyValue("--plate-z")).toBe(member.css.light);
 }
 cleanup();
});

it.each([
 ["tokens.radius", "radius"], ["tokens.shadow", "shadow"], ["tokens.blur", "blur"],
 ["tokens.font-size", "text-metric"], ["tokens.font-weight", "text-metric"], ["tokens.letter-spacing", "text-metric"], ["tokens.line-height", "text-metric"],
 ["tokens.density", "density"], ["tokens.focus-outline", "focus"],
] as const)("every member of %s shows the same %s specimen bound to its own value", (slotId, kind) => {
 const shapes = new Set<string>();
 for (const { member, key, variant } of variants(slotId)) {
  const figure = variant.querySelector<HTMLElement>(`figure[data-token-specimen="${kind}"]`);
  expect(figure, key).not.toBeNull();
  expect(binding(figure), key).toBe(member.css.light);
  const target = figure!.querySelector<HTMLElement>("[data-specimen-target]")!;
  expect(target.className, key).toContain("--studio-specimen-value");
  if (kind !== "density" && kind !== "focus") shapes.add(target.className);
 }
 // One shape per leaf: only the bound value differs between members.
 if (kind !== "density" && kind !== "focus") expect(shapes.size).toBe(1);
 cleanup();
});
