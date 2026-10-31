import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TokenValuePreview } from "./index.js";
import { resolve } from "../../catalog-core/resolve.js";
import { loadCatalog } from "../../catalog-core/index.js";
import { applyLibraryChange, libraryHash } from "../../catalog-core/library.js";
import type { LibraryData } from "../../catalog-core/types.js";
import { checkedPreviewCss } from "./checked-css.js";
import { TokenLeafSpecimen } from "./specimens.js";
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
    ["themes.primary.default",member],
    ["themes.primary.default",{...member,$type:"fontFamily"}],
    ["themes.primary.default",{...member,emit:"--foreign-property"}],
    ["themes.primary.default",{...member,css:{...member.css,light:"12px"}}],
    ["themes.primary.default",{...member,css:{...member.css,dark:"system-ui"}}],
    ["themes.primary.default",{...member,css:{...member.css,dark:"red;display:none"}}],
    ["themes.primary.default",{...member,css:{...member.css,dark:""}}],
  ] as const)expect(()=>render(<TokenValuePreview id={id} member={changed as typeof member} {...labels}/>)).toThrow(/TokenValuePreview/);
});
it("paints materialized gradient roles in both modes and refuses malformed or injected fallback CSS",()=>{
  const catalog=loadCatalog();const base: LibraryData={source:{id:"preview-host",kind:"consumer",author:"consumer",license:"MIT"},adoptedAt:"2026-10-28",fills:[]};
  const library=applyLibraryChange(catalog,base,{baseHash:libraryHash(base),changes:[{op:"adopt",slot:"tokens.gradient",source:"foundry"}]});
  const member=resolve({catalog,library}).members["tokens.gradient.wash"]!;
  const {container}=render(<TokenValuePreview id="tokens.gradient.wash" member={member} {...labels} compact/>);
  expect(container.querySelectorAll('[data-studio-color-swatch] [role="img"]')).toHaveLength(2);
  expect(screen.getByRole("img",{name:`Light ${member.css.light}`})).toBeInTheDocument();
  expect(screen.getByRole("img",{name:`Dark ${member.css.dark}`})).toBeInTheDocument();
  expect(checkedPreviewCss("gradient",member.css.light)).toBe(true);
  expect(checkedPreviewCss("gradient",member.css.dark!)).toBe(true);
  for(const light of ["linear-gradient(garbage)","radial-gradient(red, blue)","linear-gradient(180deg, var(--x, red;display:none) 0%, blue 100%)","linear-gradient(180deg, var(--x, url(x)) 0%, blue 100%)",'linear-gradient(red, blue), image-set("https://example.invalid/x.png" 1x)',"linear-gradient(red, blue), linear-gradient(white, black)","var(--arbitrary, linear-gradient(red, blue))","linear-gradient(180deg, var(--unresolved) 0%, blue 100%)"]){
    expect(checkedPreviewCss("gradient",light)).toBe(false);
    expect(()=>render(<TokenValuePreview id="tokens.gradient.wash" member={{...member,css:{...member.css,light}}} {...labels} compact/>)).toThrow(/TokenValuePreview/);
  }
});
it("applies the checked optical-size member to the text specimen's opsz axis",()=>{
  const catalog=loadCatalog();const base: LibraryData={source:{id:"preview-host",kind:"consumer",author:"consumer",license:"MIT"},adoptedAt:"2026-10-28",fills:[]};
  const library=applyLibraryChange(catalog,base,{baseHash:libraryHash(base),changes:[{op:"adopt",slot:"themes.font-heading",source:"tailwind-default"}]});
  const member=resolve({catalog,library}).members["themes.font-heading.default"]!;
  const {container}=render(<TokenLeafSpecimen id="themes.font-heading.default" member={member} sampleText={labels.sampleText}/>);
  const frame=container.querySelector<HTMLElement>('[data-token-specimen="text-metric"]')!;
  expect(frame).toHaveAttribute("data-override-reason","token-under-review");
  expect(frame.style.getPropertyValue("--studio-specimen-value")).toBe("72");
  const sample=frame.querySelector<HTMLElement>("[data-specimen-target]")!;
  expect(sample.style.fontVariationSettings).toBe('"opsz" var(--studio-specimen-value)');
  expect(sample.style.getPropertyValue("--studio-specimen-value")).toBe("72");
  expect(sample).toHaveTextContent(labels.sampleText);
});
