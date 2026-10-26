// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ts from "typescript";
import userEvent from "@testing-library/user-event";
import type { LayoutCompilerPort } from "../../core/layout-source.js";
import type { FlowInstanceBinding as InstanceBinding, InstanceRegistries } from "../../core/instance-binding.js";
import { instanceFixture } from "../../core/__fixtures__/instance-binding/fixtures.js";
import { PublisherInstancesView } from "./PublisherInstancesView.js";
import { FIXTURE_BREAKPOINTS, FIXTURE_INSTANCE_LIBRARY, FIXTURE_INSTANCE_REGISTRIES, STANDARD_INSTANCE_FIXTURES } from "./__fixtures__/standard-instances.js";

const kinds = new Map(Object.entries(ts.SyntaxKind).filter(([key, value]) => typeof value === "number" && !/^(?:First|Last|Count)/.test(key)).map(([key, value]) => [value, key]));
const compiler: LayoutCompilerPort = {
  parseSourceFile: (file, source) => ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
  kind: value => kinds.get((value as ts.Node).kind) ?? "Unknown",
  children: value => { const children: ts.Node[] = []; ts.forEachChild(value as ts.Node, child => { children.push(child); }); return children; },
};
afterEach(cleanup);
const base = { instances: STANDARD_INSTANCE_FIXTURES, library: FIXTURE_INSTANCE_LIBRARY, registries: FIXTURE_INSTANCE_REGISTRIES, breakpointValues: FIXTURE_BREAKPOINTS, designerHref: "/designer", packLabels: { "pack.standard-website": "Standard website" } };
// Independent synthetic contracts exercise inspector/check behavior; never preview registration evidence.
const syntheticRegistries: InstanceRegistries = { ...FIXTURE_INSTANCE_REGISTRIES,
  frames: [{ id: "frames.site-shell", status: "draft", contract: { surface: "site", configs: ["site", "front-door"] } }],
  sections: ["hero", "page-header", "content", "article", "form", "empty-state", "error-state"].map(name => ({
    id: `sections.${name}` as `sections.${string}`, status: "draft", contract: { surface: "site", configs: ["default"], slots: [{ name: "title", type: "copy", required: true }] },
  })),
};
const inspector = () => screen.getByRole("complementary", { name: "Instance inspector" });
const choose = (label: string) => fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: new RegExp(`^${label} `) }));
function clickFinding(name: RegExp) {
  const link = screen.getAllByRole("link").find(link => name.test(link.textContent ?? ""))!;
  expect(link).toBeDefined();
  const target = link.getAttribute("href")!.slice(1);
  fireEvent.click(link);
  expect(document.getElementById(target)).toBe(document.activeElement);
  return document.getElementById(target)!;
}

describe("Publisher Instances", () => {
  it("lists the eight Standard identities by pack and surface with pathless status pages", () => {
    render(<PublisherInstancesView {...base} />);
    const nav = screen.getByRole("navigation", { name: "Instances by pack and surface" });
    expect(within(nav).getAllByRole("button")).toHaveLength(8);
    expect(within(nav).getByRole("region", { name: "Standard website" })).toBeVisible();
    expect(within(nav).getAllByRole("region").map(node => node.getAttribute("aria-label"))).toEqual(["Standard website", "site instances"]);
    expect(STANDARD_INSTANCE_FIXTURES.map(item => item.instanceId)).toEqual(["home", "about", "contact", "terms", "privacy", "sign-in", "not-found", "error"].map(id => `standard.${id}`));
    expect(STANDARD_INSTANCE_FIXTURES[1]!.layout.config).toBe("stack.default");
    expect(STANDARD_INSTANCE_FIXTURES[2]!.layout.config).toBe("split.default");
    choose("Not found"); expect(inspector()).toHaveTextContent("No route path");
    expect(screen.queryByRole("tree")).toBeNull();
    expect(screen.getByRole("link", { name: "Adopt in Designer" })).toHaveAttribute("href", "/designer");
  });

  it("inspects contract-ordered sections, optional frame slots, and required content refs", () => {
    const binding: InstanceBinding = { ...STANDARD_INSTANCE_FIXTURES[0]!, fills: { body: STANDARD_INSTANCE_FIXTURES[0]!.fills.body!, lead: STANDARD_INSTANCE_FIXTURES[0]!.fills.lead! }, frame: { ...STANDARD_INSTANCE_FIXTURES[0]!.frame, slotFills: { consent: { section: "sections.content", config: "default", content: {} } } } };
    render(<PublisherInstancesView {...base} instances={[binding]} registries={syntheticRegistries} />);
    const slots = screen.getByRole("region", { name: "Ordered slot fills" });
    expect(within(slots).getAllByRole("heading").map(node => node.textContent)).toEqual(["Slot fills", "lead", "body", "close", "Frame optional slots"]);
    const content = screen.getByRole("region", { name: "Content refs" });
    expect(content).toHaveTextContent("copy.home.title");
    expect(content).toHaveTextContent("frame.slotFills.consent · sections.contenttitle (required): missing ref");
    expect(screen.getByRole("region", { name: "Content checks" })).toHaveTextContent("LK10");
  });

  it("exposes actual missing fill/content/source refusals and target links", () => {
    render(<PublisherInstancesView {...base} registries={syntheticRegistries} />);
    const checks = screen.getByRole("region", { name: "Instance checks" });
    for (const name of ["Structure", "Content", "Responsive", "Outline"]) expect(within(checks).getByRole("region", { name: `${name} checks` })).toBeVisible();
    expect(checks).toHaveTextContent("LK7 · frame: Fill must resolve exactly in the consumer library");
    expect(checks).toHaveTextContent("LK10"); expect(checks).toHaveTextContent("LK11 · layout.renderer: Actual layout renderer source is required");
    const node = clickFinding(/^LK10 · fills.lead.0.content.title:/);
    expect(node).toHaveTextContent("title (required): copy · copy.home.title");
    expect(checks).toHaveTextContent("LK12 pending");
    expect(screen.queryByText(/^Static checks pass$/)).toBeNull();
  });

  it("requires the real parser and qualifies a static pass with LK12 pending", () => {
    const f = instanceFixture();
    const props = { ...base, instances: [f.binding], library: f.library, registries: f.registries };
    const { rerender } = render(<PublisherInstancesView {...props} />);
    expect(screen.getByRole("region", { name: "Responsive checks" })).toHaveTextContent("LK11");
    rerender(<PublisherInstancesView {...props} compiler={compiler} />);
    expect(screen.getByRole("region", { name: "Instance checks" })).toHaveTextContent("Home: Static checks pass · LK12 pending");
    expect(screen.getByRole("region", { name: "Responsive checks" })).not.toHaveTextContent("LK11 · layout.renderer:");
  });

  it("retains duplicate rows, links cross-row pack findings to the destination frame/content/fill", () => {
    const first = STANDARD_INSTANCE_FIXTURES[0]!;
    const second: InstanceBinding = { ...first, label: "Duplicate", frame: { leaf: "frames.app-shell", config: "page" }, fills: { ...first.fills, body: [{ section: "sections.content", config: "unregistered", content: {} }] } };
    render(<PublisherInstancesView {...base} instances={[first, second]} registries={syntheticRegistries} />);
    expect(within(screen.getByRole("navigation")).getAllByRole("button")).toHaveLength(2);
    const frame = clickFinding(/^Duplicate \[row 2\] · LK15 · frame:/);
    expect(frame).toHaveTextContent("frames.app-shell");
    choose("Home");
    const fill = clickFinding(/^Duplicate \[row 2\] · LK4 · fills.body.0:/);
    expect(fill).toHaveTextContent("unregistered");
    choose("Home");
    const content = clickFinding(/^Duplicate \[row 2\] · LK10 · fills.body.0.content.title:/);
    expect(content).toHaveTextContent("missing ref");
    expect(screen.getByRole("region", { name: "Structure checks" })).toHaveTextContent("LK15 · instanceId: Instance ids must be unique");
  });

  it("maps per-pack local indices back to original rows", () => {
    const home = STANDARD_INSTANCE_FIXTURES[0]!;
    const outside = { ...home, instanceId: "outside", label: "Outside", packIds: ["other-pack"] };
    const duplicate = { ...home, label: "Third row" };
    render(<PublisherInstancesView {...base} instances={[outside, home, duplicate]} />);
    const target = clickFinding(/^Third row \[row 3\] · LK15 · instanceId:/);
    expect(target).toHaveTextContent("standard.home");
    expect(inspector()).toHaveTextContent("Third row inspector");
  });

  it("shows actual unknown configs and missing required fills without a preview crash", () => {
    const bad = { ...STANDARD_INSTANCE_FIXTURES[0]!, layout: { leaf: "layouts.stack" as const, config: "missing" }, fills: {} };
    const { rerender } = render(<PublisherInstancesView {...base} instances={[bad]} />);
    expect(screen.getByRole("region", { name: "Structure checks" })).toHaveTextContent("LK2 · layout: Unknown config");
    rerender(<PublisherInstancesView {...base} instances={[{ ...bad, layout: { leaf: "layouts.stack", config: "stack.landing" } }]} />);
    expect(screen.getByRole("region", { name: "Structure checks" })).toHaveTextContent("LK5 · fills.body:");
  });

  it("changes viewport/theme/declared state without rerunning structural lookups", async () => {
    const user = userEvent.setup();
    const select = async (label: string, option: string) => {
      await user.click(screen.getByRole("button", { name: new RegExp(label) }));
      await user.click(await screen.findByRole("option", { name: option, exact: true }));
    };
    const resolveFill = vi.fn(() => undefined);
    const library = { ...FIXTURE_INSTANCE_LIBRARY, resolveFill };
    render(<PublisherInstancesView {...base} library={library} />);
    choose("Sign in");
    const calls = resolveFill.mock.calls.length;
    for (const width of [1280, 768]) {
      await select("Viewport", `${width} px`);
      expect(screen.getByTitle(`Sign in · ${width} px light placeholder preview`)).toHaveStyle({ width: `${width}px` });
    }
    await select("Viewport", "320 px");
    await select("Theme", "dark");
    await select("State", "error");
    expect(resolveFill).toHaveBeenCalledTimes(calls);
    const frame = screen.getByTitle("Sign in · 320 px dark placeholder preview") as HTMLIFrameElement;
    fireEvent.load(frame);
    expect(frame.style.width).toBe("320px");
    expect(frame.contentDocument!.body).toHaveTextContent("state: error · LK12 pending");
    expect(frame.contentDocument!.body).toHaveTextContent("pending S4");
    expect(frame.contentDocument!.body.querySelector("[data-section-placeholder]")).toBeTruthy();
    expect(frame.contentDocument!.body.querySelector("[data-section]")).toBeNull();
    choose("About"); expect(screen.getByRole("button", { name: /State/ })).toHaveTextContent("default");
  });

  it("keeps selection across immutable props replacement and falls back when selection disappears", () => {
    const { rerender } = render(<PublisherInstancesView {...base} />);
    choose("Contact");
    rerender(<PublisherInstancesView {...base} instances={structuredClone(STANDARD_INSTANCE_FIXTURES)} />);
    expect(inspector()).toHaveTextContent("Contact inspector");
    rerender(<PublisherInstancesView {...base} instances={[STANDARD_INSTANCE_FIXTURES[0]!]} />);
    expect(inspector()).toHaveTextContent("Home inspector");
    rerender(<PublisherInstancesView {...base} instances={[]} />);
    expect(screen.getByText("No instance bindings supplied.")).toBeVisible();
  });
  it("puts LK16 in Structure and links a concept-format refusal to its inspector field", () => {
    render(<PublisherInstancesView {...base} instances={[{ ...STANDARD_INSTANCE_FIXTURES[0]!, format: "email.html" }]} />);
    const structure = screen.getByRole("region", { name: "Structure checks" });
    expect(structure).toHaveTextContent("LK16 · format:");
    const target = clickFinding(/^LK16 · format:/);
    expect(target).toHaveTextContent("email.html");
    expect(target).toHaveTextContent("Format");
  });

  it("focuses the named slot heading from a layout-position finding and keeps render evidence pending", () => {
    const fixture = instanceFixture();
    const layout = fixture.registries.layouts.find(leaf => leaf.id === fixture.binding.layout.leaf)!;
    const slot = layout.contract.slots[0]!;
    const registries = { ...fixture.registries, layouts: fixture.registries.layouts.map(leaf => leaf === layout ? {
      ...leaf, contract: { ...leaf.contract, slots: leaf.contract.slots.map(entry => entry.id === slot.id ? { ...entry, position: "last" as const } : entry) },
    } : leaf) };
    render(<PublisherInstancesView {...base} instances={[fixture.binding]} library={fixture.library} registries={registries} />);
    const target = clickFinding(new RegExp(`^LK6 · layout\\.slots\\.${slot.id}:`));
    expect(within(target).getByRole("heading", { level: 5 })).toHaveTextContent(slot.id);
    expect(screen.getByRole("region", { name: "Responsive checks" })).toHaveTextContent("LK12 pending");
  });

});


it.each(["resolved", "missing", "foreign", "throws"] as const)("shows %s frame host references inside the existing content inspector without claiming runtime verification", outcome => {
  const f = instanceFixture();
  const reference = f.binding.fills.lead![0]!.content.title!;
  const binding = { ...f.binding, frame: { ...f.binding.frame, content: { "skip-link": reference } } };
  const library = { ...f.library, resolveContent: () => {
    if (outcome === "throws") throw new Error("Content unavailable");
    return outcome === "resolved" ? reference : outcome === "foreign" ? { ...reference, ref: "foreign.reference" } : undefined;
  } };
  render(<PublisherInstancesView {...base} instances={[binding]} library={library} registries={f.registries} />);
  const content = within(inspector()).getByRole("region", { name: "Content refs" });
  const host = within(content).getByRole("group", { name: "Frame host content references" });
  const entry = within(host).getByText(new RegExp(`^skip-link: ${reference.kind}`));
  expect(entry).toHaveTextContent(`${reference.kind} · ${reference.ref} · ${outcome === "resolved" ? "reference resolved" : "missing resolution"}`);
  expect(entry).toHaveAttribute("tabindex", "-1");
  expect(entry.id).toBe(`${host.id}.skip-link`);
  expect(host).toHaveTextContent("Frame host content required-slot, value and hash verification pending");
  expect(host).not.toHaveTextContent("bound");
  expect(within(screen.getByRole("region", { name: "Ordered slot fills" })).queryByText("skip-link")).toBeNull();
  expect(screen.getAllByRole("complementary", { name: "Instance inspector" })).toHaveLength(1);
  expect(screen.getByRole("region", { name: "Responsive checks" })).toHaveTextContent("LK12 pending");
});

it("keeps absent frame host content explicit without inferring required slots", () => {
  render(<PublisherInstancesView {...base} />);
  const host = within(inspector()).getByRole("group", { name: "Frame host content references" });
  expect(host).toHaveTextContent("No frame host content references supplied");
  expect(host).toHaveTextContent("required-slot, value and hash verification pending");
  expect(within(host).queryByText(/required.*missing/i)).toBeNull();
});
