/** @vitest-environment node */
import {expect,it} from "vitest";
import {adoptedSurface} from "./__fixtures__/surface-engine/synthetic.js";
import {resolve,check} from "./api.js";
it("SYNTHETIC no measurement is inspectable S8, never code clearance",()=>{const {input}=adoptedSurface();const result=resolve(input);expect(result.surfaces!.check.findings.some(f=>f.code==="S8"&&f.severity==="error")).toBe(true);expect(check(input).ok).toBe(false);});
it("SYNTHETIC descriptor edits cannot retain adopted origin",()=>{const {input}=adoptedSurface();input.library.surfaces!.fills[0]!.sections!.synthetic!.members=["invented"];expect(()=>resolve(input)).toThrow(/hand edit/);});
