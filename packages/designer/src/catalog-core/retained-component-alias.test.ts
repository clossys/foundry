import {expect,it} from "vitest";
import {loadComponentRegistry,componentRegistryFindings} from "./component-registry.js";
import {dogfoodComposes} from "./dogfood.js";
import {wiringScope} from "./wiring.js";

it("retains historical slot contracts while giving new symbolic references one canonical target", () => {
  const registry = loadComponentRegistry();
  const alias = registry.aliases.find(row => row.id === "components.navigation-tree")!;
  expect(alias).toEqual({id:"components.navigation-tree",target:"components.sidebar",retainsSlot:true});
  expect(registry.slots.find(row => row.id === alias.id)?.contract).toMatchObject({ root:"rac:NavigationTree", members:{names:["expand","current"]} });
  expect(componentRegistryFindings(registry)).toEqual([]);
  expect(componentRegistryFindings({...registry,aliases:[{...alias,retainsSlot:"yes"} as never]})).toContain(`alias: invalid retained mode ${alias.id}`);
  const ordinary = {...registry, aliases:[{id:alias.id,target:alias.target}]};
  expect(componentRegistryFindings(ordinary)).toContain(`alias: duplicate id ${alias.id}`);
  expect(componentRegistryFindings({...registry,aliases:[...registry.aliases,alias]})).toContain(`alias: duplicate id ${alias.id}`);
  expect(componentRegistryFindings({...registry,aliases:[{...alias,id:"components.unknown"}]})).toContain("alias: invalid retained slot components.unknown");
  expect(componentRegistryFindings({...registry,aliases:[{...alias,memberMap:{current:"current"}}]})).toContain(`alias: invalid retained slot ${alias.id}`);
  expect(componentRegistryFindings({...registry,aliases:[{...alias,target:alias.id}]})).toContain(`alias: target must be canonical ${alias.id}`);
  expect(componentRegistryFindings({...registry,aliases:[alias,{id:alias.target,target:"components.button",retainsSlot:true}]})).toContain(`alias: target must be canonical ${alias.target}`);
});

it("maps new symbolic navigation references to sidebar while retaining the old implementation boundary",()=>{
  const source='import {NavigationTree as Navigation} from "@clossys/designer/components"; const Page=()=> <Navigation/>;';
  expect(dogfoodComposes({files:[{file:"src/Page.tsx",content:source}]}).map(row=>row.slotId)).toEqual(["components.sidebar"]);
  expect(wiringScope("packages/designer/src/components/navigation-tree/index.ts")).toBe("components");
  expect(wiringScope("packages/designer/src/components/sidebar/sidebar.tsx")).toBe("components");
});
