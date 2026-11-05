// @vitest-environment node
import { describe, expect, it } from "vitest";
import { synthetic } from "../catalog-core/__fixtures__/component-engine/synthetic.js";
import { applyComponentLibraryChange } from "../catalog-core/changeset-components.js";
import { componentLibraryHash, resolveComponents } from "../catalog-core/resolve-components.js";
import { emitComponents } from "../catalog-core/emit-components.js";
import { assertQualifiedFacadeEquality, assertSourceMeasurement, sourceMeasurement } from "./__fixtures__/source-measurement.js";
function profile(observed:boolean){
  const input=synthetic();
  const library=applyComponentLibraryChange(input.catalog,input.library,{baseHash:componentLibraryHash(input.library),changes:[{op:"adopt",slot:input.candidate.slot,source:input.candidate.source}]});
  return resolveComponents({catalog:input.catalog,library,values:input.check,evidence:{...input.check,observations:observed?input.check.observations:{}},packageExports:{"test-kit/components":["Button"],"react-aria-components":["Button"]}});
}
describe("SYNTHETIC source measurement bootstrap; no real component qualification",()=>{
  it("returns an explicitly nonadoptable proposal while the normal emitter still refuses missing observations",()=>{
    const blocked=profile(false);expect(blocked.check.ok).toBe(false);
    const result=sourceMeasurement(blocked);
    expect(result.status).toBe("source-measurement-only");
    expect(result.adoptable).toBe(false);
    expect(result.receipt.status).toBe("UNQUALIFIED");
    expect(()=>assertSourceMeasurement(result)).not.toThrow();
    expect(()=>emitComponents(blocked,["component-index"])).toThrow(/observations/);
    expect(()=>assertQualifiedFacadeEquality(result,blocked)).toThrow(/observations/);
  });
  it("refuses an adoptable receipt and changed input bytes",()=>{
    const result=sourceMeasurement(profile(false));
    expect(()=>assertSourceMeasurement({...result,adoptable:true} as unknown as typeof result)).toThrow(/never adoption/);
    expect(()=>assertSourceMeasurement({...result,receipt:{...result.receipt,status:"QUALIFIED"}} as unknown as typeof result)).toThrow(/never adoption/);
    const changed=structuredClone(result);changed.files[0]!.content+=" ";
    expect(()=>assertSourceMeasurement(changed)).toThrow(/bytes changed/);
  });
  it("requires whole-graph equality after real guarded emission, including the provider",()=>{
    const checked=profile(true);expect(checked.check.ok).toBe(true);
    const result=sourceMeasurement(checked);
    expect(()=>assertQualifiedFacadeEquality(result,checked)).not.toThrow();
    const changed=structuredClone(result), index=changed.files.find(file=>file.path==="component-index.ts")!;
    index.content+=" ";
    expect(()=>assertQualifiedFacadeEquality(changed,checked)).toThrow(/bytes changed/);
    const changedSelection={...checked,selectionHash:`sha256:${"f".repeat(64)}`};
    expect(()=>assertQualifiedFacadeEquality(result,changedSelection)).toThrow(/selection differs/);
  });
});
