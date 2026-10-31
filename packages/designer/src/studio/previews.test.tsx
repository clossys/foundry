import { afterEach, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { buildCandidates, type Candidate } from "./model.js";
import { CandidateCell } from "./CandidateCell.js";
import { completedTokenLibrary } from "../importers/__fixtures__/completed-token-library.js";
import { CompactPreview, SlotPreview, PREVIEW_LIMIT, isFontDeclared } from "./previews.js";
import { catalog, adopt, labels } from "./__fixtures__/studio.js";
afterEach(cleanup);
it("uses actual resolved token previews and caps member rows", () => {
 const library=adopt(); const candidate=buildCandidates({catalog,library,working:library,slotId:"themes.background",scope:"slot",target:"themes.background"})[0]!;
 const view=render(<SlotPreview members={candidate.members} labels={labels}/>); expect(view.container.querySelectorAll("figure").length).toBeGreaterThan(0);
 const members=Array.from({length:PREVIEW_LIMIT+6},(_,i)=>({...candidate.members[0]!,id:`themes.background.default${i}`})); const capped=render(<SlotPreview members={members} labels={labels}/>); expect(capped.container.querySelectorAll("li")).toHaveLength(24); expect(capped.container.querySelector("[data-preview-more]")).toHaveTextContent("+6");
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
it("labels the channels of oklch(97% 0 none) and keeps the exact string", () => {
 // SYNTHETIC: no shipped theme fill carries a `none` channel, so one real color member carries the value.
 const library = adopt();
 const candidate = buildCandidates({ catalog, library, working: library, slotId: "themes.background", scope: "slot", target: "themes.background" }).find(candidate => candidate.selected)!;
 const real = candidate.members[0]!;
 const entry = { ...real, member: { ...real.member, css: { light: "oklch(97% 0 none)" } } };
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
 ["themes.radius", "radius"], ["themes.shadow", "shadow"], ["themes.tracking-tight", "text-metric"],
] as const)("every member of %s shows the same %s specimen bound to its own value", (slotId, kind) => {
 const shapes = new Set<string>();
 for (const { member, key, variant } of variants(slotId)) {
  const figure = variant.querySelector<HTMLElement>(`figure[data-token-specimen="${kind}"]`);
  expect(figure, key).not.toBeNull();
  expect(binding(figure), key).toBe(member.css.light);
  const target = figure!.querySelector<HTMLElement>("[data-specimen-target]")!;
  expect(target.className, key).toContain("--studio-specimen-value");
  shapes.add(target.className);
 }
 // One shape per leaf: only the bound value differs between members.
 expect(shapes.size).toBe(1);
 cleanup();
});
