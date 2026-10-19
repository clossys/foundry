/**
 * Independent, non-circular proof that `compiled.css` has a real CSS rule
 * for every class a REAL, RENDERED component actually applies. This is
 * deliberately NOT derived from `class-scan.ts`'s own candidate list (that
 * would only prove the generator is internally consistent with itself,
 * never that its static string-literal extraction actually found every
 * class a component renders) — it renders real components with
 * `@testing-library/react`, collects the real DOM `className`s, and checks
 * each one against a freshly generated `compiled.css`.
 *
 * SCOPE, STATED HONESTLY: this exercises a representative set of atoms
 * spanning every structural pattern this package's README documents
 * (plain markup, a variant table, a size table, a boolean-state control, a
 * labeled field, a homogeneous collection, link variants) — not all 31
 * atoms in every documented prop combination. The atoms it does NOT render
 * here (`Select`, `Menu`, `Dialog`, `Popover`, `ComboBox`, `Tabs`,
 * `RadioGroup`, `DateField`, `SearchField`, `FileTrigger`, `Disclosure`,
 * `ProgressBar`, `Table`, `Field`, `Tooltip`) mostly require opening a
 * portalled overlay or richer state setup to reach their real classes in
 * the DOM; `class-scan.ts`'s static extraction (not rendering) is what
 * keeps `compiled.css` complete for those, since it reads every atom's
 * source text directly rather than needing to drive its UI. This test's
 * job is narrower and different: catch a REGEX BUG in `class-scan.ts`
 * (a class shape it silently fails to extract), not exhaustively enumerate
 * every atom. See the introducing PR body for the same statement.
 */
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Avatar } from "../atoms/Avatar.js";
import { Badge } from "../atoms/Badge.js";
import { Banner } from "../atoms/Banner.js";
import { Breadcrumb } from "../atoms/Breadcrumb.js";
import { Button } from "../atoms/Button.js";
import { Card } from "../atoms/Card.js";
import { Checkbox } from "../atoms/Checkbox.js";
import { Chip } from "../atoms/Chip.js";
import { Link } from "../atoms/Link.js";
import { Meter } from "../atoms/Meter.js";
import { Separator } from "../atoms/Separator.js";
import { ResizeHandle } from "../atoms/ResizeHandle.js";
import { Panel } from "../blocks/Panel.js";
import { Drawer } from "../blocks/Drawer.js";
import { ResizablePane } from "../blocks/ResizablePane.js";
import { AppNavigation } from "../blocks/AppNavigation.js";
import { Skeleton } from "../atoms/Skeleton.js";
import { Spinner } from "../atoms/Spinner.js";
import { StatusMark } from "../atoms/StatusMark.js";
import { Switch } from "../atoms/Switch.js";
import { TextField } from "../atoms/TextField.js";
import { Textarea } from "../atoms/Textarea.js";
import { Hero } from "../blocks/Hero.js";
import { Item } from "../blocks/items/Item.js";
import { Items } from "../blocks/items/Items.js";
import { Items as NativeItems } from "../blocks/items/Items.server.js";
import { Matrix } from "../blocks/Matrix.js";
import { ContentSection } from "../blocks/ContentSection.js";
import { FeatureGrid } from "../blocks/FeatureGrid.js";
import { NavGrid } from "../blocks/NavGrid.js";
import { RecordLedger } from "../blocks/RecordLedger.js";
import { OrderedStepSequence } from "../blocks/OrderedStepSequence.js";
import { Specimen } from "../blocks/specimen/Specimen.js";
import { SpecimenPanel } from "../blocks/specimen/SpecimenPanel.js";
import type { SpecimenPanelItem } from "../blocks/specimen/SpecimenPanel.js";
import { scanCompiledCssSources } from "./scan-sources.js";
import { generateCompiledCss } from "./generate.js";

const packageRoot = resolve(import.meta.dirname, "..", "..");

/**
 * `Element.classList` (a `DOMTokenList`) works identically for HTML and SVG
 * elements — unlike `Element.className`, which is a plain `string` on an
 * `HTMLElement` but an `SVGAnimatedString` OBJECT on an `SVGElement`
 * (`Icon`/`Spinner` render `<svg>`). Reading `.className` directly here
 * would silently stringify that object instead of the class list on any
 * SVG-rendering atom — a real bug caught while building this test.
 */
function collectClassNames(container: HTMLElement): Set<string> {
  const classes = new Set<string>();
  const all = container.querySelectorAll("*");
  for (const el of [container, ...Array.from(all)]) {
    for (const c of Array.from(el.classList)) classes.add(c);
  }
  return classes;
}

/**
 * Escapes a class name for use as a plain-text search inside compiled.css
 * — the SAME escaping Tailwind itself applies to every character a CSS
 * identifier can't contain unescaped (`:` in `hover\:bg-accent-hover`, but
 * also `[`, `]`, `/`, `'` in an arbitrary-value class like
 * `not-last\:after\:content-\[\'\/\'\]` — verified against this package's
 * own real generated output, which is why every non-alphanumeric,
 * non-hyphen, non-underscore character is escaped here, not just the
 * handful that showed up in the first pass at this test).
 */
function toSelectorText(className: string): string {
  return "." + className.replace(/[^a-zA-Z0-9_-]/g, (ch) => "\\" + ch);
}

describe("coverage: real rendered classes are all present in compiled.css", () => {
  it("covers actual expanded, rail and narrow Drawer navigation classes", async () => {
    const classes = new Set<string>();
    const tree = [{ id: "catalogs", label: "Catalogs", href: "#catalogs", children: [
      { id: "blocks", label: "Blocks", href: "#blocks" },
      { id: "actions", label: "Actions", onAction: () => {} },
    ] }];
    try {
      for (const state of ["expanded", "rail", "drawer"]) {
        vi.stubGlobal("matchMedia", vi.fn((media: string) => ({
          matches: media === "(min-width: 768px)" && state !== "drawer", media,
          addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
        })));
        const view = render(<AppNavigation tree={tree} activeId="blocks" collapsed={state === "rail"} footer={<Button>Profile</Button>} />);
        try {
          if (state === "drawer") await userEvent.click(view.getByRole("button", { name: "Open navigation" }));
          for (const name of collectClassNames(document.body)) classes.add(name);
        } finally { view.unmount(); }
      }
      const generated = await generateCompiledCss({ stylesDir: resolve(packageRoot, "styles"), candidates: scanCompiledCssSources(packageRoot).candidates });
      const shipped = readFileSync(resolve(packageRoot, "styles/compiled.css"), "utf8");
      for (const name of classes) {
        expect(generated.css, `navigation fresh: ${name}`).toContain(toSelectorText(name));
        expect(shipped, `navigation shipped: ${name}`).toContain(toSelectorText(name));
      }
      for (const css of [generated.css, shipped]) {
        for (const [utility, declaration] of [["border-0", /border-width:\s*0(?:px)?;/], ["bg-transparent", /background-color:\s*transparent;/],
          ["icon-control-md", /inline-size:\s*var\(--ui-layout-tap-target,\s*44px\)/]] as const) {
          const start = css.indexOf(toSelectorText(utility));
          expect(start).toBeGreaterThanOrEqual(0);
          const rule = css.slice(start, css.indexOf("}", start) + 1);
          expect(rule).toMatch(declaration);
          if (utility === "icon-control-md") expect(rule).toMatch(/block-size:\s*var\(--ui-layout-tap-target,\s*44px\)/);
        }
      }
      expect(shipped).toContain("forced-colors: active");
      expect(shipped).toContain("prefers-reduced-motion: reduce");
    } finally { vi.unstubAllGlobals(); }
  });

  it("covers AppFrame Material and resize states in fresh and shipped CSS", async () => {
    const classes = new Set<string>();
    const collect = (container: HTMLElement) => { for (const name of collectClassNames(container)) classes.add(name); };
    for (const orientation of ["vertical", "horizontal"] as const) {
      for (const ground of ["base", "inverse"] as const) {
        const view = render(<ResizablePane ground={ground} orientation={orientation} min={100} max={300} defaultValue={180} label="Tools" handleLabel="Resize tools">Content</ResizablePane>);
        collect(view.container);
        view.unmount();
      }
    }
    const atom = render(<ResizeHandle value={100} min={50} max={200} resetValue={100} label="Resize tools" onChange={() => {}} />);
    collect(atom.container);
    atom.unmount();
    for (const ground of ["base", "sunken", "inverse"] as const) {
      const view = render(<Panel ground={ground} header="Header" footer="Footer">Content</Panel>);
      collect(view.container);
      view.unmount();
    }
    for (const placement of ["start", "end", "bottom"] as const) {
      const view = render(<Drawer placement={placement} heading="Tools" closeLabel="Close tools" trigger={<Button>Open tools</Button>}>Content</Drawer>);
      await userEvent.click(view.getByRole("button", { name: "Open tools" }));
      collect(document.body);
      view.unmount();
    }
    const generated = await generateCompiledCss({ stylesDir: resolve(packageRoot, "styles"), candidates: scanCompiledCssSources(packageRoot).candidates });
    const shipped = readFileSync(resolve(packageRoot, "styles/compiled.css"), "utf8");
    for (const name of classes) {
      expect(generated.css, `fresh: ${name}`).toContain(toSelectorText(name));
      expect(shipped, `shipped: ${name}`).toContain(toSelectorText(name));
    }
    for (const [label, css] of [["fresh", generated.css], ["shipped", shipped]] as const) {
      expect(css, `${label}: solid outline`).toContain(".focus-visible\\:outline-solid:focus-visible");
      const selector = ".focus-visible\\:outline-accent-on-inverse:focus-visible";
      expect(css, `${label}: inverse focus selector`).toContain(selector);
      const rule = css.slice(css.indexOf(selector)).split("}", 1)[0];
      expect(rule, `${label}: inverse focus color`).toContain("outline-color: var(--color-accent-on-inverse,");
    }
  });

  it("covers actual ordered tracks and native/React Aria disclosure states", async () => {
    const classes = new Set<string>();
    const user = userEvent.setup();
    const collect = (tree: ReturnType<typeof render>) => { for (const cls of collectClassNames(tree.container)) classes.add(cls); tree.unmount(); };
    for (const ground of ["base", "sunken", "inverse"] as const) {
      for (const columns of [2, 3] as const) collect(render(<Items arrangement="columns" columns={columns} order="connected" ground={ground} end="continues" endLabel="Next" items={[0,1,2,3,4].map(i => ({ id: String(i), heading: "Step", description: "Support", visual: i === 1 ? <span>Visual</span> : undefined }))} />));
      for (const count of [3, 5]) collect(render(<Items arrangement="stacked" order="connected" ground={ground} lanes={[{ id: "a", label: "First" }, { id: "b", label: "Second" }]} end="continues" endLabel="Next" items={Array.from({ length: count }, (_, i) => ({ id: String(i), heading: "Step", description: "Support", lane: i % 2 ? "b" : "a", visual: <span>Visual</span> }))} />));
      for (const Component of [Items, NativeItems]) for (const treatment of ["plain", "rule", "plate"] as const) {
        const tree = render(<Component arrangement="rows" columns={2} reveal="disclose" order="numbered" ground={ground} treatment={treatment} items={[0,1,2,3].map(i => ({ id: String(i), heading: "Question", description: "Answer", badge: { label: "Beta", tone: "info" }, meta: "Actor" }))} groups={[{ id: "a", label: "A", items: ["1","0"] }, { id: "b", label: "B", items: ["3","2"] }]} />);
        if (Component === Items) await user.click(tree.container.querySelector("button")!);
        else tree.container.querySelector("details")!.open = true;
        collect(tree);
      }
    }
    const scan = scanCompiledCssSources(packageRoot);
    const generated = await generateCompiledCss({ stylesDir: resolve(packageRoot, "styles"), candidates: scan.candidates });
    expect([...classes].filter(cls => !generated.css.includes(toSelectorText(cls)))).toEqual([]);
    expect(generated.css).toContain("::details-content");
    expect(generated.css).toContain("--disclosure-panel-height");
    expect(generated.css).toContain("forced-colors: active");
    for (const utility of ["details-motion", "disclosure-panel-motion", "disclosure-icon-motion"]) {
      const start = generated.css.indexOf(`.${utility} {`); expect(start).toBeGreaterThanOrEqual(0);
      let end = generated.css.indexOf("{", start) + 1, depth = 1;
      while (depth && end < generated.css.length) { const ch = generated.css[end++]!; if (ch === "{") depth++; else if (ch === "}") depth--; }
      const rule = generated.css.slice(start, end);
      expect(rule, utility).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
      const mediaStart = rule.lastIndexOf("@media");
      let mediaEnd = rule.indexOf("{", mediaStart) + 1, mediaDepth = 1;
      while (mediaDepth && mediaEnd < rule.length) { const ch = rule[mediaEnd++]!; if (ch === "{") mediaDepth++; else if (ch === "}") mediaDepth--; }
      expect(rule.slice(mediaStart, mediaEnd), utility).toMatch(/transition-duration:\s*0s/);
      expect(rule.slice(0, mediaStart), utility).toMatch(/transition-duration:\s*var\(--ui-duration-default/);
    }
  }, 30_000);
  it("covers canonical item treatments, scales, badge tones and arrangements from actual rendering", async () => {
    const classes = new Set<string>();
    const tones = ["neutral", "success", "warning", "danger", "info"] as const;
    for (const ground of ["base", "sunken", "inverse"] as const) for (const treatment of ["plain", "rule", "plate"] as const) {
      const tree = render(<Item id="one" heading="Title" size="display" treatment={treatment} ground={ground} href="/one" icon={<svg />} eyebrow="Area" meta="Actor" description="Support" visual={<div>Visual</div>} badge={{ label: "Beta", tone: "info" }} />);
      for (const cls of collectClassNames(tree.container)) classes.add(cls); tree.unmount();
    }
    for (const tone of tones) { const tree = render(<Item id={tone} heading="Title" size="standard" treatment="plain" ground="base" badge={{ label: "State", tone }} />); for (const cls of collectClassNames(tree.container)) classes.add(cls); tree.unmount(); }
    for (const arrangement of ["columns", "rows", "bento", "stacked"] as const) {
      const count = arrangement === "columns" ? 3 : 2;
      const tree = render(<Items arrangement={arrangement} items={Array.from({ length: count }, (_, i) => ({ id: String(i), heading: "Title" }))} />);
      for (const cls of collectClassNames(tree.container)) classes.add(cls); tree.unmount();
    }
    const grouped = render(<Items arrangement="rows" columns={2} items={[0,1,2,3].map(i => ({ id: String(i), heading: "Title" }))} groups={[{ id: "a", label: "A", items: ["1","0"] }, { id: "b", label: "B", items: ["3","2"] }]} />);
    for (const cls of collectClassNames(grouped.container)) classes.add(cls); grouped.unmount();
    const scan = scanCompiledCssSources(packageRoot);
    const generated = await generateCompiledCss({ stylesDir: resolve(packageRoot, "styles"), candidates: scan.candidates });
    expect([...classes].filter(cls => !generated.css.includes(toSelectorText(cls)))).toEqual([]);
  }, 30_000);

  it("Hero (with media) and primary Button render classes present in a fresh compiled.css", async () => {
    const trees: Array<ReturnType<typeof render>> = [];
    trees.push(
      render(
        <Hero
          heading="Placeholder heading"
          description="Placeholder description."
          actions={<Button variant="primary">Continue</Button>}
          media={<img src="/placeholder.png" alt="Placeholder still" />}
          composition="split"
        />,
      ),
    );

    const renderedClasses = new Set<string>();
    for (const result of trees) {
      for (const c of collectClassNames(result.container)) renderedClasses.add(c);
      result.unmount();
    }

    for (const required of ["text-display-m", "tablet:text-display-l", "font-display", "bg-accent", "rounded-control", "tablet:grid-cols-2"]) {
      expect(renderedClasses.has(required), required).toBe(true);
    }

    const scan = scanCompiledCssSources(packageRoot);
    const generated = await generateCompiledCss({ stylesDir: resolve(packageRoot, "styles"), candidates: scan.candidates });

    const missing: string[] = [];
    for (const className of renderedClasses) {
      const selector = toSelectorText(className);
      if (!generated.css.includes(selector)) missing.push(className);
    }
    expect(missing).toEqual([]);
  });

  it("collects classes from a representative set of atoms and cross-checks against a fresh compiled.css", async () => {
    const trees: Array<[string, ReturnType<typeof render>]> = [];
    trees.push(["Button primary md", render(<Button variant="primary" size="md">Save</Button>)]);
    trees.push(["Button secondary sm", render(<Button variant="secondary" size="sm">Save</Button>)]);
    trees.push(["Button ghost lg", render(<Button variant="ghost" size="lg">Save</Button>)]);
    trees.push(["Button danger", render(<Button variant="danger">Delete</Button>)]);
    trees.push(["Button outline lg", render(<Button variant="outline" size="lg">See an example</Button>)]);
    trees.push(["Badge neutral", render(<Badge>Active</Badge>)]);
    trees.push(["Badge success", render(<Badge variant="success">Active</Badge>)]);
    trees.push(["Badge warning", render(<Badge variant="warning">Active</Badge>)]);
    trees.push(["Badge danger", render(<Badge variant="danger">Active</Badge>)]);
    trees.push(["Badge info", render(<Badge variant="info">Active</Badge>)]);
    trees.push(["Card", render(<Card>Content</Card>)]);
    for (const ground of ["base", "sunken", "inverse"] as const) {
      trees.push([`Card plate ${ground}`, render(<Card variant="plate" ground={ground}>Content</Card>)]);
      trees.push([`Card outline ${ground}`, render(<Card variant="outline" ground={ground}>Content</Card>)]);
    }
    for (const tone of ["success", "warning", "danger", "info", "neutral"] as const) {
      trees.push([`StatusMark ${tone}`, render(<StatusMark tone={tone}>State</StatusMark>)]);
      trees.push([
        `Meter ${tone}`,
        render(<Meter value={2} scaleMax={4} limit={3} tone={tone} valueText="2.0x" limitText="limit 3.0x" />),
      ]);
      trees.push([
        `Meter history ${tone}`,
        render(<Meter value={2} scaleMax={4} limit={3} previous={1} previousText="Previously 1.0x" tone={tone} valueText="2.0x" limitText="limit 3.0x" />),
      ]);
    }
    trees.push(["Avatar sm", render(<Avatar alt="A" size="sm" />)]);
    trees.push(["Avatar md", render(<Avatar alt="A" size="md" />)]);
    trees.push(["Avatar lg", render(<Avatar alt="A" size="lg" />)]);
    trees.push(["Spinner labeled", render(<Spinner label="Loading" size="md" />)]);
    trees.push(["Spinner decorative", render(<Spinner size="sm" />)]);
    trees.push(["Checkbox", render(<Checkbox>Select all</Checkbox>)]);
    trees.push(["Checkbox indeterminate", render(<Checkbox isIndeterminate>Select all</Checkbox>)]);
    trees.push(["Switch", render(<Switch>Notifications</Switch>)]);
    trees.push([
      "TextField with error",
      render(<TextField label="Email" description="We'll never share this." errorMessage="Required" isInvalid />),
    ]);
    trees.push(["Textarea", render(<Textarea label="Description" rows={4} />)]);
    trees.push([
      "Breadcrumb",
      render(
        <Breadcrumb>
          <Breadcrumb.Item href="/">Home</Breadcrumb.Item>
          <Breadcrumb.Item>Current</Breadcrumb.Item>
        </Breadcrumb>,
      ),
    ]);
    trees.push(["Link default", render(<Link href="/x">Go</Link>)]);
    trees.push(["Link muted", render(<Link href="/x" variant="muted">Go</Link>)]);
    trees.push(["Link standalone", render(<Link href="/x" variant="standalone">Go</Link>)]);
    trees.push(["Chip", render(<Chip onRemove={() => {}} removeLabel="Remove">Tag</Chip>)]);
    trees.push(["Separator", render(<Separator />)]);
    trees.push(["Skeleton", render(<Skeleton style={{ width: 100, height: 20 }} />)]);
    trees.push(["Banner info", render(<Banner variant="info">Heads up</Banner>)]);
    trees.push(["Banner danger", render(<Banner variant="danger">Careful</Banner>)]);

    const renderedClasses = new Set<string>();
    for (const [, result] of trees) {
      for (const c of collectClassNames(result.container)) renderedClasses.add(c);
      result.unmount();
    }

    expect(renderedClasses.size).toBeGreaterThan(20);

    const scan = scanCompiledCssSources(packageRoot);
    const generated = await generateCompiledCss({ stylesDir: resolve(packageRoot, "styles"), candidates: scan.candidates });

    const missing: string[] = [];
    for (const className of renderedClasses) {
      const selector = toSelectorText(className);
      if (!generated.css.includes(selector)) missing.push(className);
    }

    expect(missing).toEqual([]);
  });

  it("content layout blocks render classes present in a fresh compiled.css", async () => {
    const trees: Array<ReturnType<typeof render>> = [];
    const item = (id: string) => ({ id, heading: `Heading ${id}`, description: "Description.", icon: <span>i</span> });
    for (const ground of ["base", "sunken", "inverse"] as const) {
      for (const mediaSide of ["end", "start"] as const) {
        trees.push(
          render(
            <ContentSection layout="split" mediaSide={mediaSide} ground={ground} eyebrow="E" heading="H" media={<div>M</div>}>
              <p>T</p>
            </ContentSection>,
          ),
        );
      }
      trees.push(render(<ContentSection ground={ground} heading="H" media={<div>M</div>} />));
      trees.push(render(<FeatureGrid ground={ground} heading="Features" items={[item("a"), item("b"), item("c")]} />));
      trees.push(render(<ContentSection ground={ground} align="center" heading="H" actions={<a href="/a">A</a>} footnote={<>Aside.</>} />));
      for (const columns of [2, 3] as const) {
        for (const treatment of ["plain", "rule", "plate"] as const) {
          trees.push(render(<Items arrangement="columns" ground={ground} columns={columns} treatment={treatment} items={Array.from({ length: columns }, (_, i) => item(String(i)))} />));
        }
      }
      trees.push(render(<Items arrangement="columns" ground={ground} scale="statement" items={["a", "b", "c"].map(id => ({ id, heading: `Heading ${id}`, description: "Description." }))} />));
      trees.push(render(<Items arrangement="columns" ground={ground} columns={2} treatment="plate" items={[{ ...item("a"), eyebrow: "E" }, item("b")]} />));
      trees.push(
        render(
          <Items arrangement="bento" treatment="plate"
            ground={ground}
            items={[
              { ...item("a"), eyebrow: "E", span: "two-thirds", visual: <div>V</div> },
              { ...item("b"), span: "third" },
              { ...item("c"), span: "half" },
              { ...item("d"), span: "half" },
              { ...item("e"), span: "full" },
            ]}
          />,
        ),
      );
      for (const visual of [undefined, <div key="v">V</div>]) {
        for (const featured of [undefined, "a", "b"]) {
          trees.push(render(<Matrix ground={ground} featured={featured} sides={[
            { id: "a", label: "A", heading: "First view", description: "Supporting copy", ...(visual === undefined ? { points: ["One", "Two"] } : { visual }) },
            { id: "b", label: "B", heading: "Second view", ...(visual === undefined ? { points: ["One", "Two"] } : { visual }) },
          ]} />));
        }
        trees.push(
          render(
            <OrderedStepSequence
              ground={ground}
              items={[
                { id: "1", ordinal: "01", label: "L", heading: "H", description: "D" },
                { id: "2", ordinal: "02", heading: "H" },
              ]}
            />,
          ),
        );
      }
      trees.push(render(<Items arrangement="rows" treatment="rule" ground={ground} items={[item("a"), item("b")]} />));
      trees.push(render(<Items arrangement="rows" treatment="rule" ground={ground} columns={1} items={[item("a"), item("b")]} />));
      // Linked items: the stretched-link anchor, its hit area and ring, and a bare item's hover plate.
      const linked = (id: string) => ({ ...item(id), href: `/${id}` });
      for (const surface of ["plate", "rule"] as const) {
        for (const count of [2, 3, 4, 5, 6]) {
          trees.push(render(<Items arrangement="rows" ground={ground} treatment={surface} items={Array.from({ length: count }, (_, index) => ({ id: String(index), heading: "Topic", description: "Details.", icon: <svg />, href: `/topics/${index}` }))} />));
        }
      }
      for (const treatment of ["plain", "rule", "plate"] as const) {
        trees.push(render(<Items arrangement="columns" ground={ground} columns={2} treatment={treatment} items={[linked("a"), linked("b")]} />));
      }
      trees.push(render(<Items arrangement="bento" treatment="plate" ground={ground} items={[{ ...linked("a"), span: "half" }, { ...linked("b"), span: "half" }]} />));
      trees.push(render(<Items arrangement="rows" treatment="rule" ground={ground} items={[linked("a"), linked("b")]} />));
      trees.push(
        render(
          <OrderedStepSequence
            ground={ground}
            items={[
              { id: "1", ordinal: "01", heading: "H" },
              { id: "2", ordinal: "02", heading: "H" },
            ]}
          />,
        ),
      );
    }
    const navTrees = [
      render(<NavGrid items={[{ id: "a", title: "A", description: "D", href: "/a" }, { id: "b", title: "B", href: "/b" }]} />),
      render(<NavGrid items={[{ id: "a", title: "A", href: "/a" }]} />),
      render(<NavGrid items={["a", "b", "c"].map(id => ({ id, title: id, icon: <svg />, href: `/${id}` }))} />),
    ];
    trees.push(...navTrees);
    const navActiveClasses = [...new Set(navTrees.flatMap(tree => [...collectClassNames(tree.container)]).filter(className => className.startsWith("active:")))].sort();
    expect(navActiveClasses).toEqual(["active:bg-surface-raised", "active:decoration-current"]);

    const renderedClasses = new Set<string>();
    for (const result of trees) {
      for (const c of collectClassNames(result.container)) renderedClasses.add(c);
      result.unmount();
    }
    for (const required of [
      "tablet-lg:col-span-5",
      "tablet-lg:col-span-7",
      "tablet-lg:col-start-8",
      "gap-y-3xl",
      "tablet-lg:col-span-8",
      "after:absolute",
      "after:-inset-x-sm",
      "tablet:after:-inset-x-md",
      "after:-inset-y-sm",
      "tablet:after:-inset-y-md",
      "after:-bottom-sm",
      "tablet:after:-bottom-md",
      "before:-inset-x-sm",
      "tablet:before:-inset-x-md",
      "before:-inset-y-sm",
      "tablet:before:-inset-y-md",
      "before:-bottom-sm",
      "tablet:before:-bottom-md",
      "focus-visible:after:outline-accent-on-inverse",
      "has-focus-visible:before:bg-surface-inverse-raised",
      "after:rounded-control",
      "tablet:grid-cols-6",
      "tablet:col-span-2",
      "tablet:col-span-3",
      "link-grid-icon",
      "link-grid-active",
      ...navActiveClasses,
    ]) {
      expect(renderedClasses.has(required), required).toBe(true);
    }

    const scan = scanCompiledCssSources(packageRoot);
    const generated = await generateCompiledCss({ stylesDir: resolve(packageRoot, "styles"), candidates: scan.candidates });
    const themeKeys = readFileSync(resolve(packageRoot, "styles/theme-keys.css"), "utf8");
    expect(themeKeys).toMatch(/@utility link-grid-icon\s*\{\s*inline-size: var\(--ui-icon-md, var\(--spacing-xl, 24px\)\);\s*block-size: var\(--ui-icon-md, var\(--spacing-xl, 24px\)\);\s*& > svg\s*\{\s*width: 100%;\s*height: 100%;/);
    expect(generated.css).toContain(".link-grid-icon");
    expect(generated.css).toContain("inline-size: var(--ui-icon-md, var(--spacing-xl, 24px))");
    expect(generated.css).toContain("block-size: var(--ui-icon-md, var(--spacing-xl, 24px))");
    for (const className of navActiveClasses) {
      const selector = toSelectorText(className) + ":active";
      expect(generated.css).toContain(selector);
      const offset = generated.css.indexOf(selector);
      const openBlocks: string[] = [];
      for (const match of generated.css.slice(0, offset).matchAll(/([^{}]+)\{|\}/g)) {
        if (match[1]) openBlocks.push(match[1].trim());
        else openBlocks.pop();
      }
      expect(openBlocks.some((block) => block.includes("hover: hover"))).toBe(false);
    }
    expect(generated.css).toContain(".link-grid-active:active > svg:last-child");
    expect(generated.css).toContain(".link-grid-active:dir(rtl):active > svg:last-child");
    const missing: string[] = [];
    for (const className of renderedClasses) {
      if (!generated.css.includes(toSelectorText(className))) missing.push(className);
    }
    expect(missing).toEqual([]);
  }, 30_000);

  it("the Specimen family renders classes present in a fresh compiled.css", async () => {
    const status = { tone: "success" as const, label: "Done" };
    const panel: SpecimenPanelItem = {
      id: "p1",
      title: "Record",
      meta: "Meta",
      status,
      parts: [
        { id: "f4", type: "fields", label: "Fields", columns: 4, items: [{ id: "a", label: "A", value: "1" }] },
        { id: "f1", type: "fields", columns: 1, items: [{ id: "a", label: "A", value: "1" }] },
        { id: "rows", type: "status-rows", label: "Rows", items: [{ id: "a", label: "A", detail: "d", status }, { id: "b", label: "B", status }] },
      ],
      footer: { assignee: { initials: "AB", name: "A B", note: "owner" }, note: "Note" },
    };
    const panelB: SpecimenPanelItem = {
      id: "p2",
      title: "Second",
      parts: [
        { id: "m", type: "meter", label: "M", value: 2, scaleMax: 4, limit: 3, tone: "warning", valueText: "2", limitText: "3", status, note: "n" },
        {
          id: "t",
          type: "table",
          caption: "Caption",
          columns: [{ id: "c1", label: "C1" }, { id: "c2", label: "C2" }],
          rows: [{ id: "r", cells: [{ text: "R" }, { status }] }],
        },
        { id: "s", type: "schedule", items: [{ id: "a", date: "1 Jan", label: "L", amount: "10", status }] },
      ],
    };
    const panelC: SpecimenPanelItem = {
      id: "p3",
      parts: [
        { id: "sh", type: "shares", items: [{ id: "a", name: "A", share: 50, shareText: "50%", status }] },
        { id: "fi", type: "files", items: [{ id: "a", format: "PDF", name: "N", source: "S" }, { id: "b", format: "XLS", name: "M" }] },
      ],
    };
    const trees = [
      render(<Specimen label="A single specimen panel." panels={[panel]} />),
      render(<Specimen label="Two panels in a row." arrangement="row" panels={[panel, panelB]} />),
      render(<Specimen label="Three panels in a row." arrangement="row" panels={[panel, panelB, panelC]} />),
      render(<Specimen label="Stacked panels." arrangement="stack" panels={[panel, panelB]} />),
      render(<Specimen label="Panels in a flow." arrangement="flow" connector="Then" panels={[panel, panelB, panelC]} />),
    ];
    for (const tone of [undefined, "neutral", "success", "warning", "danger", "info"] as const) {
      trees.push(render(<Specimen label="A badged specimen panel." panels={[{ ...panel, badge: { label: "Reviewed record", tone } }]} />));
    }
    trees.push(render(<Specimen label="A specimen with capped status rows." panels={[{
      id: "capped", parts: [{ id: "rows", type: "status-rows", mobileRows: 3, label: "Checks", items: Array.from({ length: 4 }, (_, index) => ({ id: String(index), label: `Check ${index + 1}`, detail: "Detail", status })) }],
    }]} />));
    trees.push(render(<Specimen label="A specimen with meter history." panels={[{
      ...panelB, parts: panelB.parts.map(part => part.type === "meter" ? { ...part, previous: 1, previousText: "Previously 1" } : part),
    }]} />));

    const renderedClasses = new Set<string>();
    for (const result of trees) {
      for (const c of collectClassNames(result.container)) renderedClasses.add(c);
      result.unmount();
    }
    for (const required of ["@container", "@md:table", "@md:not-sr-only", "@md:table-cell", "@lg:grid-cols-4", "desktop:grid-cols-3", "size-2xl", "font-mono", "max-tablet:hidden", "border-s", "border-dashed", "border-ink-secondary", "bg-surface-sunken", "text-ink-secondary", "bg-status-success-tint", "text-status-success-text", "bg-status-warning-tint", "text-status-warning-text", "bg-status-danger-tint", "text-status-danger-text", "bg-status-info-tint", "text-status-info-text"]) {
      expect(renderedClasses.has(required), required).toBe(true);
    }

    const scan = scanCompiledCssSources(packageRoot);
    const generated = await generateCompiledCss({ stylesDir: resolve(packageRoot, "styles"), candidates: scan.candidates });
    const missing: string[] = [];
    for (const className of renderedClasses) {
      if (!generated.css.includes(toSelectorText(className))) missing.push(className);
    }
    expect(missing).toEqual([]);
  }, 30_000);
});


it("emits every real Ledger form, cap, ground and rule-card layout class", async () => {
  const classes = new Set<string>();
  const row = (id: string, flag = false) => ({ id, label: "Row", detail: "Detail", flag, status: { tone: "info" as const, label: "Received" } });
  const group = (id: string) => ({ id, label: "Checks", rows: [row(id, true)] });
  for (const ground of ["base", "sunken", "inverse"] as const) {
    for (const columns of [1, 2, 3] as const) {
      for (const owner of [false, true]) {
        const groups = Array.from({ length: columns }, (_, index) => owner && index === columns - 1 ? { id: "owner", label: "Owner", owner: { initials: "AB", name: "Reviewer" }, note: "Next check." } : group(String(index)));
        // The record permits one accent across all groups.
        const safeGroups = groups.map((entry, index) => "rows" in entry ? { ...entry, rows: [row(String(index), index === 0)] } : entry);
        const tree = render(<RecordLedger id={`ledger-${ground}-${columns}-${owner}`} form="record" head={{ title: "Record", meta: "Metadata", status: { tone: "neutral", label: "Open" } }} groups={safeGroups} columns={columns} ground={ground} flagLabel="Attention:" caption="Sample data." />);
        for (const cls of collectClassNames(tree.container)) classes.add(cls);
        tree.unmount();
      }
    }
    const tile = <SpecimenPanel ground={ground} parts={[{ id: "checks", type: "status-rows", label: "Record", mobileRows: 3, items: Array.from({ length: 5 }, (_, i) => row(String(i))) }]} />;
    const cards = render(<Items arrangement="bento" treatment="rule" ground={ground} items={[{ id: "wide", span: "two-thirds", heading: "Record", eyebrow: "Function", description: "Details", href: "/one", visual: tile }, { id: "small", span: "third", heading: "Another", href: "/two", visual: tile }]} />);
    for (const cls of collectClassNames(cards.container)) classes.add(cls);
    cards.unmount();
  }
  const generated = await generateCompiledCss({ stylesDir: resolve(packageRoot, "styles"), candidates: scanCompiledCssSources(packageRoot).candidates });
  expect([...classes].filter(cls => !generated.css.includes(toSelectorText(cls)))).toEqual([]);
  expect(classes.has("max-tablet:hidden")).toBe(true);
  expect(generated.css).toContain(toSelectorText("max-tablet:hidden"));
  const groupDividers = [...generated.css.matchAll(/[^{}]*\.ledger-group-divided[^{}]*\{([^}]*)\}/g)];
  expect(groupDividers).toHaveLength(3);
  for (const divider of groupDividers) {
    // Width and style must retain the rendered ground line-color utility.
    expect(divider[1]).not.toMatch(/border-(?:block|inline)-start:/);
  }
  for (const cls of ["ledger-columns-two", "ledger-columns-three", "ledger-owner-columns", "ledger-owner-disc"]) expect(generated.css).toContain(toSelectorText(cls));
}, 30_000);


it("scans Anatomy marker, ground and responsive source classes without generated output", () => {
  const candidates = new Set(scanCompiledCssSources(packageRoot).candidates);
  for (const candidate of ["anatomy-disc", "anatomy-key-row", "anatomy-key-measure", "tablet-lg:anatomy-columns", "tablet-lg:gap-x-3xl", "text-surface-raised", "text-surface-base", "text-surface-sunken", "text-surface-inverse", "text-body-l", "font-body", "text-h2", "leading-heading"]) expect(candidates.has(candidate), candidate).toBe(true);
  expect(candidates.has("row-span-2")).toBe(false);
});
