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
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Avatar } from "../atoms/Avatar.js";
import { Badge } from "../atoms/Badge.js";
import { Banner } from "../atoms/Banner.js";
import { Breadcrumb } from "../atoms/Breadcrumb.js";
import { Button } from "../atoms/Button.js";
import { Card } from "../atoms/Card.js";
import { Checkbox } from "../atoms/Checkbox.js";
import { Chip } from "../atoms/Chip.js";
import { Link } from "../atoms/Link.js";
import { Separator } from "../atoms/Separator.js";
import { Skeleton } from "../atoms/Skeleton.js";
import { Spinner } from "../atoms/Spinner.js";
import { Switch } from "../atoms/Switch.js";
import { TextField } from "../atoms/TextField.js";
import { Textarea } from "../atoms/Textarea.js";
import { scanClassCandidates } from "./class-scan.js";
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
  it("collects classes from a representative set of atoms and cross-checks against a fresh compiled.css", async () => {
    const trees: Array<[string, ReturnType<typeof render>]> = [];
    trees.push(["Button primary md", render(<Button variant="primary" size="md">Save</Button>)]);
    trees.push(["Button secondary sm", render(<Button variant="secondary" size="sm">Save</Button>)]);
    trees.push(["Button ghost lg", render(<Button variant="ghost" size="lg">Save</Button>)]);
    trees.push(["Button danger", render(<Button variant="danger">Delete</Button>)]);
    trees.push(["Badge neutral", render(<Badge>Active</Badge>)]);
    trees.push(["Badge success", render(<Badge variant="success">Active</Badge>)]);
    trees.push(["Badge warning", render(<Badge variant="warning">Active</Badge>)]);
    trees.push(["Badge danger", render(<Badge variant="danger">Active</Badge>)]);
    trees.push(["Badge info", render(<Badge variant="info">Active</Badge>)]);
    trees.push(["Card", render(<Card>Content</Card>)]);
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

    const scan = scanClassCandidates(resolve(packageRoot, "src", "atoms"));
    const generated = await generateCompiledCss({ stylesDir: resolve(packageRoot, "styles"), candidates: scan.candidates });

    const missing: string[] = [];
    for (const className of renderedClasses) {
      const selector = toSelectorText(className);
      if (!generated.css.includes(selector)) missing.push(className);
    }

    expect(missing).toEqual([]);
  });
});
