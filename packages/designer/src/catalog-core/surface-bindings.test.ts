/** @vitest-environment node */
import {expect,it} from "vitest";
import {syntheticSurface} from "./__fixtures__/surface-engine/synthetic.js";
import {bindSurfaceSource} from "./surface-bindings.js";
import {adoptedComponentIntegration} from "./__fixtures__/component-integration.js";
import {resolve} from "./api.js";
it("SYNTHETIC selected-only APIs never use conflicting candidates",()=>{const f=syntheticSurface(),profile=resolve(f.input);const fill={...f.candidate,bindings:[{file:f.source.path,module:"../../components/button/index.js",name:"Button",local:"Button",slot:"components.button" as const}]};const files=[{...f.source,content:'import { Button } from "../../components/button/index.js"; export function Synthetic() { return <Button />; }'}];const bound=bindSurfaceSource(fill,files,profile,[]);expect(bound.proof.findings.some(f=>f.code==="S4")).toBe(true);const plain=bindSurfaceSource(f.candidate,[f.source],profile,[]);expect(plain.proof.findings).toEqual([]);expect(bindSurfaceSource({...f.candidate,api:{version:1,exports:[{name:"Synthetic",export:"Unknown"}]}},[f.source],profile,[]).apiHash).not.toBe(plain.apiHash);});

it("SYNTHETIC selected API inventory change invalidates the surface API identity",()=>{const f=syntheticSurface();const profile=resolve(adoptedComponentIntegration());const fill={...f.candidate,bindings:[{file:f.source.path,module:"../../components/button/index.js",name:"Button",local:"Button",slot:"components.button" as const}]};const before=bindSurfaceSource(fill,[f.source],profile,[]).apiHash;const component=profile.components.components["components.button"]!;component.descriptor.secondaryExports=[{name:"ButtonCaption",export:"ButtonCaption"}];expect(bindSurfaceSource(fill,[f.source],profile,[]).apiHash).not.toBe(before);});
