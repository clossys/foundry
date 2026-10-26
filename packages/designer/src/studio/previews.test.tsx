import { afterEach, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { buildCandidates } from "./model.js";
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
it("shows canonical Tailwind achromatic OKLCH none as actual light/dark text without weakening the strict visual renderer", () => {
 const doc = catalog.fills.find(doc => doc.$extensions["com.clossys.fill"].slot.startsWith("tokens.") && doc.$extensions["com.clossys.fill"].source.includes("tailwind") && JSON.stringify(doc).includes(" none)"))!;
 expect(doc).toBeDefined();
 const meta = doc.$extensions["com.clossys.fill"], library = emptyLibrary();
 const candidate = buildCandidates({ catalog, library, working: library, slotId: meta.slot, scope: "slot", target: meta.slot }).find(candidate => candidate.source === meta.source)!;
 const entries = candidate.members.filter(({ member }) => [member.css.light, member.css.dark].some(value => value?.includes("none)")));
 expect(entries.length).toBeGreaterThan(0);
 for (const entry of entries) {
  const view = render(<CompactPreview candidate={{ ...candidate, members: [entry] }} labels={labels} />);
  expect(view.getByText(labels.visualPreviewUnsupported)).toBeInTheDocument();
  const texts = [...view.container.querySelectorAll("code")].map(code => code.textContent);
  expect(texts).toEqual([entry.member.css.light, entry.member.css.dark ?? entry.member.css.light]);
  expect(view.container.querySelector("[data-token-value-preview]")).toBeNull();
  expect(candidate.findings.some(finding => finding.code === "C1" && finding.severity === "error")).toBe(false);
  view.unmount();
 }
});
