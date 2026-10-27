// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import adapter from "../catalog/adapters/shadcn@aria.json" with { type: "json" };
import menuFill from "../catalog/fills/shadcn@aria/components.menu.json" with { type: "json" };
import { sha256 } from "../catalog-core/digest.js";
import { menuInlineSource } from "./menu-inline-source.js";
import { importShadcnAriaComponents, type ShadcnComponentInput } from "./shadcn-aria-components.js";

const fixture = resolve(import.meta.dirname, "__fixtures__/shadcn-aria");
const read = (name: string) => readFileSync(resolve(fixture, name), "utf8");
const command = () => JSON.parse(read("command.json")).files[0] as { path: string; content: string };
const COMMAND = { path: "apps/v4/registry/bases/aria/ui/command.tsx", sha256: "911e2d5972ca64ec2565b2c18281f0d9c0cb4d5caffa139dcd4eea2c853add11" };
/** The four closed rewrites, in order; each must apply exactly once to the CommandList span. */
const REWRITES = [
  ["function CommandList<", "function InlineMenu<"],
  ["<Menu\n", "<MenuPrimitive\n"],
  ["className={cn(\n", "className={composeRenderProps(className, (className) => cn(\n"],
  ["      )}", "      ))}"],
] as const;
function input(): ShadcnComponentInput {
  return { items: readdirSync(fixture).filter(name => name.endsWith(".json") && !name.endsWith(".golden.json")).map(name => JSON.parse(read(name))).filter(item => item.type === "registry:ui"), styles: { path: "apps/v4/registry/styles/style-nova.css", content: read("style-nova.css") }, notice: { path: "LICENSE.md", content: read("LICENSE.md") } };
}
function span(content: string): string {
  return content.slice(content.indexOf("function CommandList<T extends object>"), content.indexOf("\nfunction CommandEmpty("));
}

describe("API-M1 inline Menu source lineage", () => {
  it("authenticates the pinned command source and derives one exact InlineMenu", () => {
    const source = command();
    expect({ path: source.path, sha256: sha256(source.content) }).toEqual(COMMAND);
    const derived = menuInlineSource(source);
    expect(sha256(span(source.content))).toBe("a605585dd7ec1c311166bed0876b7770d38b466d053759de31265f69ef6e992d");
    expect(sha256(derived)).toBe("8a9c9455fc3cb74776a7d5aff5ebf3dd6a027438b2dba6ae0f4ffab99469f88e");
    expect(derived).toContain('data-slot="command-list"');
    expect(derived).not.toMatch(/Popover|MenuTrigger|useState|useReducer|createContext|SubmenuTrigger/);
  });

  it("is exactly the CommandList declaration under the four closed rewrites, each applied once", () => {
    const original = span(command().content);
    for (const [from] of REWRITES) expect(original.split(from)).toHaveLength(2);
    let undone = menuInlineSource(command());
    for (const [from, to] of [...REWRITES].reverse()) {
      expect(undone.split(to)).toHaveLength(2);
      undone = undone.replace(to, from);
    }
    expect(undone).toBe(original);
  });

  it("refuses a stale command path or command bytes instead of deriving", () => {
    expect(() => menuInlineSource({ ...command(), path: "apps/v4/registry/bases/aria/ui/command-v2.tsx" })).toThrow(/pinned command receipt differs/);
    expect(() => menuInlineSource({ ...command(), content: command().content.replace("CommandList", "CommandRows") })).toThrow(/pinned command receipt differs/);
  });

  it("lands the derivation once inside the authenticated selected menu entry, beside the retained popup", () => {
    const files = importShadcnAriaComponents(input()).rewrites["dropdown-menu"]!.files;
    expect(files.map(file => file.path).filter(path => path.startsWith("components/menu/"))).toEqual(["components/menu/dropdown-menu.tsx"]);
    const entry = files.find(file => file.path === "components/menu/dropdown-menu.tsx")!.content;
    expect(entry.split("function InlineMenu<T extends object>")).toHaveLength(2);
    expect(entry.split("function DropdownMenu<T extends object>")).toHaveLength(2);
    expect(entry).toContain("<MenuPrimitive\n      {...props}\n      data-slot=\"command-list\"");
    expect(entry).toMatch(/export \{\n {2}InlineMenu,/);
  });

  it("records the command receipt in the menu fill pin, the adapter and the fixture provenance", () => {
    expect(menuFill.components.menu.impl).toEqual({ entry: "components/menu/dropdown-menu.tsx", export: "DropdownMenu", kind: "source" });
    expect(menuFill.components.menu.pin.files).toContainEqual(COMMAND);
    expect(JSON.stringify(adapter)).toContain(JSON.stringify(COMMAND.path));
    expect(JSON.stringify(adapter)).toContain(COMMAND.sha256);
    expect(JSON.parse(read("provenance.json")).files).toContainEqual(COMMAND);
  });
});
