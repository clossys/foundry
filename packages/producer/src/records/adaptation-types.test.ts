import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import ts from "typescript";

const fixture = join(dirname(fileURLToPath(import.meta.url)), "adaptation-assignment.fixture.ts");
function diagnostics(source: string): readonly ts.Diagnostic[] {
  const options: ts.CompilerOptions = {
    strict: true, noEmit: true, skipLibCheck: true, types: [],
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  };
  const host = ts.createCompilerHost(options);
  const read = host.readFile.bind(host), exists = host.fileExists.bind(host);
  host.readFile = path => path === fixture ? source : read(path);
  host.fileExists = path => path === fixture || exists(path);
  return ts.getPreEmitDiagnostics(ts.createProgram([fixture], options, host));
}
const prelude = `import type { ElementRecord } from "./types.js";
type Adaptation = NonNullable<ElementRecord["lineage"]["adaptations"]>[number];
const base = { file: "index.tsx", reason: "Bind the existing finite stock input." };
const sourceHash = "sha256:${"0".repeat(64)}" as const;
`;

it("type-checks every supported finite adaptation through ElementRecord", () => {
  const result = diagnostics(prelude + `
const adaptations: readonly Adaptation[] = [
  { ...base, kind: "import-paths", hash: sourceHash },
  { ...base, kind: "token-mapping", hash: sourceHash },
  { ...base, kind: "data-binding", hash: sourceHash },
  { ...base, kind: "slot-bound-copy", hash: sourceHash },
  { ...base, kind: "slot-bound-identity", hash: sourceHash },
  { ...base, kind: "data-fit", hash: sourceHash },
  { ...base, kind: "data-fit", operation: "single-option-static-row", optionCount: 1, menu: "<DropdownMenu />" },
  { ...base, kind: "data-fit", operation: "sidebar15-frame-split", sourceHash, bindings: { region: "app" } },
  { ...base, kind: "data-fit", operation: "sidebar15-frame-split", sourceHash, bindings: { region: "page" } },
  { ...base, kind: "data-fit", operation: "sidebar15-right-offcanvas", sourceHash, bindings: { side: "right", collapsible: "offcanvas" } },
  { ...base, kind: "data-fit", operation: "sidebar07-single-option", sourceHash, bindings: { input: "teams", values: [{}] } },
  { ...base, kind: "data-fit", operation: "sidebar07-single-option", sourceHash, bindings: { input: "user", values: [{}] } },
  { ...base, kind: "data-fit", operation: "sidebar-mirrored-edge", sourceHash, bindings: { side: "left" } },
  { ...base, kind: "data-fit", operation: "sidebar-mirrored-edge", sourceHash, bindings: { side: "right" } },
  { ...base, kind: "data-fit", operation: "sidebar-resizable-panels", sourceHash, bindings: { orientation: "horizontal" } },
];
const lineage: ElementRecord["lineage"] = { mode: "customized", adaptations };
`);
  expect(result.map(d => `${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`)).toEqual([]);
});

it("keeps unknown operations and mismatched finite binding values unassignable", () => {
  const result = diagnostics(prelude + `
// @ts-expect-error No arbitrary replay operation.
const unknown: Adaptation = { ...base, kind: "data-fit", operation: "invent-layout", sourceHash, bindings: {} };
// @ts-expect-error Frame split has only app/page regions.
const region: Adaptation = { ...base, kind: "data-fit", operation: "sidebar15-frame-split", sourceHash, bindings: { region: "footer" } };
// @ts-expect-error Right/offcanvas does not accept the left edge.
const edge: Adaptation = { ...base, kind: "data-fit", operation: "sidebar15-right-offcanvas", sourceHash, bindings: { side: "left", collapsible: "offcanvas" } };
// @ts-expect-error Panel replay is horizontal only.
const orientation: Adaptation = { ...base, kind: "data-fit", operation: "sidebar-resizable-panels", sourceHash, bindings: { orientation: "vertical" } };
// @ts-expect-error Existing Hash contract requires its prefix.
const hash: Adaptation = { ...base, kind: "data-fit", operation: "sidebar-mirrored-edge", sourceHash: "not-a-hash", bindings: { side: "left" } };
`);
  expect(result.map(d => `${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`)).toEqual([]);
});
