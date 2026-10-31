import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TokenValuePreview } from "./index.js";
import { resolve } from "../../catalog-core/resolve.js";
import { loadCatalog } from "../../catalog-core/index.js";
import { applyLibraryChange, libraryHash } from "../../catalog-core/library.js";
import type { LibraryData } from "../../catalog-core/types.js";
import { checkedPreviewCss } from "./checked-css.js";
afterEach(cleanup);
function value() {
  const catalog=loadCatalog();const base: LibraryData={source:{id:"preview-host",kind:"consumer",author:"consumer",license:"MIT",extends:"foundry"},adoptedAt:"2026-10-24",fills:[]};
  const library=applyLibraryChange(catalog,base,{baseHash:libraryHash(base),changes:[{op:"adopt",slot:"themes.primary",source:"shadcn@aria"}]});
  return resolve({catalog,library}).members["themes.primary.default"]!;
}
const labels={sampleText:"Host sample",lightLabel:"Light",darkLabel:"Dark"};
it("paints the checked selected member in both modes with explicit token identity",()=>{
  const member=value();const {container}=render(<TokenValuePreview id="themes.primary.default" member={member} {...labels} compact/>);
  expect(container.querySelector('[data-token-value-preview="themes.primary.default"]')).not.toBeNull();
  expect(screen.getByRole("img",{name:`Light ${member.css.light}`})).toBeInTheDocument();
  expect(screen.getByRole("img",{name:`Dark ${member.css.dark??member.css.light}`})).toBeInTheDocument();
});
it("refuses foreign member, wrong type/property and unsafe or missing mode values",()=>{
  const member=value();
  for(const [id,changed] of [
    ["themes.primary.foreign",member],
    ["themes.primary.default",{...member,$type:"fontFamily"}],
    ["themes.primary.default",{...member,emit:"--foreign-property"}],
    ["themes.primary.default",{...member,css:{...member.css,light:"12px"}}],
    ["themes.primary.default",{...member,css:{...member.css,dark:"system-ui"}}],
    ["themes.primary.default",{...member,css:{...member.css,dark:"red;display:none"}}],
    ["themes.primary.default",{...member,css:{...member.css,dark:""}}],
  ] as const)expect(()=>render(<TokenValuePreview id={id} member={changed as typeof member} {...labels}/>)).toThrow(/TokenValuePreview/);
});
// No themes leaf carries a gradient value any more; the shared checker still refuses malformed or injected gradient CSS.
it("refuses malformed or injected gradient CSS in the shared preview checker",()=>{
  expect(checkedPreviewCss("gradient","linear-gradient(180deg, #ffffff 0%, #000000 100%)")).toBe(true);
  for(const light of ["linear-gradient(garbage)","radial-gradient(red, blue)","linear-gradient(180deg, var(--x, red;display:none) 0%, blue 100%)","linear-gradient(180deg, var(--x, url(x)) 0%, blue 100%)",'linear-gradient(red, blue), image-set("https://example.invalid/x.png" 1x)',"linear-gradient(red, blue), linear-gradient(white, black)","var(--arbitrary, linear-gradient(red, blue))","linear-gradient(180deg, var(--unresolved) 0%, blue 100%)"]){
    expect(checkedPreviewCss("gradient",light)).toBe(false);
  }
});
