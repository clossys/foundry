import { expect, it } from "vitest";
import { libraryHash, applyLibraryChange, type LibraryData } from "../catalog-core/index.js";
import { liveCss, candidatesCss, LIVE_SELECTORS } from "./preview-css.js";
import { buildCandidates } from "./model.js";
import { catalog, emptyLibrary, adopt } from "./__fixtures__/studio.js";
it("emits consumer-only live CSS with balanced doubled-root selectors", () => {
 const library=emptyLibrary(); expect(liveCss({catalog,library,working:library,previous:""}).css).toBe(""); const working=adopt(); const live=liveCss({catalog,library,working,previous:""}); expect(live.safe).toBe(true); expect(live.css).toContain(LIVE_SELECTORS.light); expect((live.css.match(/\{/g)??[]).length).toBe((live.css.match(/\}/g)??[]).length); expect(live.css).toContain("--background:");
 expect(liveCss({catalog:{...catalog,fills:[]},library:working,working,previous:""}).css).toBe(live.css);
});
it("isolates candidate CSS from the live library and suppresses unsafe CSS", () => {
 const library=emptyLibrary(); const cards=buildCandidates({catalog,library,working:library,slotId:"themes.background",scope:"slot",target:"themes.background"}); const css=candidatesCss(cards); expect(css).toContain('[data-studio-candidate="1"]'); expect(library.fills).toEqual([]);
 const bad=applyLibraryChange(catalog,library,{baseHash:libraryHash(library),changes:[{op:"author",slot:"themes.background",tokens:{default:{$type:"color",$value:"red; color: blue"}}}]}); expect(liveCss({catalog,library:bad,working:bad,previous:"safe-css"})).toEqual({css:"safe-css",safe:false});
 expect(candidatesCss(cards.map(c=>({...c,previewable:false})))).toBe("");
});

it("uses real emitter variable numbering for mixed bound and unbound members", () => {
 const library=adopt(); const card=buildCandidates({catalog,library,working:library,slotId:"themes.background",scope:"slot",target:"themes.background"})[0]!;
 const first=card.members[0]!; const second={id:"themes.background.zz-unbound",member:{...first.member,emit:undefined}};
 const mixed={...card,members:[first,second],resolved:{...card.resolved,members:{[first.id]:first.member,[second.id]:second.member}}};
 expect(candidatesCss([mixed])).toContain("--studio-m-1:");
});
