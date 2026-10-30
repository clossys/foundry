import { createRef, Suspense } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as components from "../components/index.js";
import { ConsumerComponentProvider, SelectedComponentLeaf, type ConsumerComponentSelection } from "./component-leaf.client.js";
import { componentLeaf } from "./component-leaf.js";
import { fixtureConsumerComponents as selection } from "../catalog-core/__fixtures__/surface-consumer-components.js";
const Checkbox = componentLeaf<typeof components.Checkbox>("components.checkbox");
const Button = componentLeaf<typeof components.Button>("components.button");

describe("consumer selected component bridge", () => {
  it.each([false, true])("renders the actual checkbox selection, forwards refs and preserves interaction (override=%s)", async override => {
    const user = userEvent.setup(), ref = createRef<HTMLButtonElement>(), events: boolean[] = [];
    const { container } = render(<ConsumerComponentProvider value={selection(override)}><Suspense><Checkbox onChange={value => events.push(value)}>Select record</Checkbox><Button ref={ref}>Continue</Button></Suspense></ConsumerComponentProvider>);
    await user.click(await screen.findByRole("checkbox", { name: "Select record" }));
    expect(events).toEqual([true]);
    expect(Boolean(container.querySelector("[data-slot=checkbox]"))).toBe(!override);
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(ref.current).toBe(screen.getByRole("button", { name: "Continue" }));
  });
  it("server renders selected semantic content without a fallback implementation", () => {
    const value = selection();
    expect(() => renderToStaticMarkup(<SelectedComponentLeaf leaf="components.button" parts={[]} componentProps={{}} />)).toThrow(/NEED component selection/);
    const html = renderToStaticMarkup(<ConsumerComponentProvider value={value}><SelectedComponentLeaf leaf="components.semantic-content" parts={[]} componentProps={{ as: "p", children: "Consumer copy" }} /></ConsumerComponentProvider>);
    expect(html).toContain("<p"); expect(html).toContain("Consumer copy");
  });
  it("refuses missing selections, forged descriptors and undeclared compound parts", () => {
    const draw = (value: ConsumerComponentSelection, leaf: string, parts: string[] = []) => () => renderToStaticMarkup(<ConsumerComponentProvider value={value}><SelectedComponentLeaf leaf={leaf} parts={parts} componentProps={{}} /></ConsumerComponentProvider>);
    const value = selection();
    expect(draw(value, "components.absent")).toThrow(/NEED component selection/);
    expect(draw({ ...value, descriptors: {} }, "components.button")).toThrow(/stale descriptor/);
    expect(draw({ ...value, modules: {} }, "components.button")).toThrow(/NEED component selection/);
    expect(draw(value, "components.disclosure", ["Row"])).toThrow(/NEED component selection/);
    expect(draw(value, "components.dialog", ["Heading"])).toThrow(/NEED component selection/);
    const checkbox = value.profile.components.components["components.checkbox"]!;
    expect(checkbox.impl.kind).toBe("source");
    const module = checkbox.impl.kind === "source" ? checkbox.impl.entry : checkbox.impl.module;
    const injected = { ...value, modules: { ...value.modules, [module]: { ...value.modules[module], [checkbox.impl.export]: Object.assign(() => null, { Invented: () => null }) } } };
    expect(draw(injected, "components.checkbox", ["Invented"])).toThrow(/undeclared/);
  });
  it("imports and creates the universal facade under the actual React server condition", () => {
    const module = resolve(import.meta.dirname, "../../dist/runtime/component-leaf.js");
    const output = execFileSync(process.execPath, ["--conditions=react-server", "--input-type=module", "-e", `const {componentLeaf}=await import(${JSON.stringify(module)}); const leaf=componentLeaf('components.button'); if(!leaf) throw Error('missing facade'); console.log('server-import-ok')`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    expect(output.trim()).toBe("server-import-ok");
  });
});
