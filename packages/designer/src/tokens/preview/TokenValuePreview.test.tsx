import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TokenValuePreview } from "./index.js";
import { resolve } from "../../catalog-core/resolve.js";
import { loadCatalog } from "../../catalog-core/index.js";
import { applyLibraryChange, libraryHash } from "../../catalog-core/library.js";
import type { LibraryData } from "../../catalog-core/types.js";
afterEach(cleanup);
function value() {
  const catalog=loadCatalog();const base: LibraryData={source:{id:"preview-host",kind:"consumer",author:"consumer",license:"MIT",extends:"foundry"},adoptedAt:"2026-10-24",fills:[]};
  const library=applyLibraryChange(catalog,base,{baseHash:libraryHash(base),changes:[{op:"adopt",slot:"tokens.accent-color",source:"foundry"}]});
  return resolve({catalog,library}).members["tokens.accent-color.default"]!;
}
const labels={sampleText:"Host sample",lightLabel:"Light",darkLabel:"Dark"};
it("paints the checked selected member in both modes with explicit token identity",()=>{
  const member=value();const {container}=render(<TokenValuePreview id="tokens.accent-color.default" member={member} {...labels} compact/>);
  expect(container.querySelector('[data-token-value-preview="tokens.accent-color.default"]')).not.toBeNull();
  expect(screen.getByRole("img",{name:`Light ${member.css.light}`})).toBeInTheDocument();
  expect(screen.getByRole("img",{name:`Dark ${member.css.dark??member.css.light}`})).toBeInTheDocument();
});
it("refuses foreign member, wrong type/property and unsafe or missing mode values",()=>{
  const member=value();
  for(const [id,changed] of [
    ["tokens.accent-color.foreign",member],
    ["tokens.accent-color.default",{...member,$type:"fontFamily"}],
    ["tokens.accent-color.default",{...member,emit:"--foreign-property"}],
    ["tokens.accent-color.default",{...member,css:{...member.css,light:"12px"}}],
    ["tokens.accent-color.default",{...member,css:{...member.css,dark:"system-ui"}}],
    ["tokens.accent-color.default",{...member,css:{...member.css,dark:"red;display:none"}}],
    ["tokens.accent-color.default",{...member,css:{...member.css,dark:""}}],
  ] as const)expect(()=>render(<TokenValuePreview id={id} member={changed as typeof member} {...labels}/>)).toThrow(/TokenValuePreview/);
});
