/** @vitest-environment node */
import { afterEach, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { readAuditor, launchChromium } from "./__fixtures__/selected-module-harness/chromium.js";
import { hash } from "./__fixtures__/selected-module-harness/inventory.js";
const roots: string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
it("refuses altered auditor bytes before a browser is launched",()=>{
  const root=mkdtempSync(resolve(tmpdir(),"auditor-identity-"));roots.push(root);const path=resolve(root,"auditor.js");
  writeFileSync(path,"original");const artifact={path,sha256:hash("original")};expect(readAuditor(artifact)).toBe("original");writeFileSync(path,"altered");expect(()=>readAuditor(artifact)).toThrow("auditor artifact identity differs");
});
const artifactPath=process.env.FOUNDRY_AUDITOR_ARTIFACT,artifactHash=process.env.FOUNDRY_AUDITOR_SHA256;
it.runIf(!!artifactPath&&!!artifactHash)("actual auditor full-rule SYNTHETIC unnamed-button positive control detects and then clears button-name",async()=>{
  const root=mkdtempSync(resolve(tmpdir(),"auditor-browser-"));roots.push(root);const bundle=resolve(root,"bundle.js");
  writeFileSync(bundle,'document.getElementById("root").innerHTML="<button></button>";');
  const browser=await launchChromium(root,bundle,"",{path:artifactPath!,sha256:artifactHash!});
  try{
    const observed=await browser.audit();const report=observed.report as {violations:{id:string}[]};
    expect(observed.status).toBe("observed-audit");expect(report.violations.some(v=>v.id==="button-name")).toBe(true);
    await browser.evaluate('document.querySelector("button").setAttribute("aria-label","Named control")');
    const corrected=await browser.audit();expect((corrected.report as typeof report).violations.some(v=>v.id==="button-name")).toBe(false);
    if(process.env.FOUNDRY_SELECTED_EVIDENCE_ROOT)writeFileSync(resolve(process.env.FOUNDRY_SELECTED_EVIDENCE_ROOT,"auditor-positive-control.json"),JSON.stringify({scope:"SYNTHETIC auditor control, not selected component qualification",environment:browser.environment,observed,corrected},null,2));
  }finally{await browser.close();}
},30000);
