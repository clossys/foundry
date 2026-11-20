/**
 * The slot contract's preview fixture (`contract.fixture` in slot.json, planner decision D1,
 * 2026-11-13). The fixture belongs to the slot, not to one candidate: it is the props every
 * candidate of the slot is certified with. Its shape is a candidate preview (`clossys.element-preview/1`):
 *
 *   { "schema": "clossys.element-preview/1",
 *     "fixtures": { "file": "<file a candidate ships>", "export": "<component it exports>", "props": { ... } },
 *     "inputs"?: { "copy"?: [<Writer key>], "slots"?: [<Designer slot>] },
 *     "container"?: "canvas" | ..., "theme"?: "light" | "dark", "width"?: <px> }
 *
 * It is typed by the contract's props: every top-level key of `fixtures.props` is named in
 * `contract.props` (props every candidate must take, checked by K1) or `contract.fixtureProps`
 * (mount-only props the fixture passes, such as an overlay trigger's `children` and `defaultOpen`,
 * which K1 never requires of a candidate). It carries no copy snapshot (`copy` absent or `{}`): copy comes from the pinned
 * Writer keys `inputs.copy` declares, exactly as for a candidate's own preview.
 */
import type { SlotModelIssue } from "./validate.js";

export const CONTRACT_FIXTURE_SCHEMA = "clossys.element-preview/1";

export interface ContractFixture {
  readonly schema: typeof CONTRACT_FIXTURE_SCHEMA;
  readonly fixtures: { readonly file: string; readonly export: string; readonly props: Readonly<Record<string, unknown>> };
  readonly inputs?: { readonly copy?: readonly string[]; readonly slots?: readonly string[] };
  readonly container?: string;
  readonly theme?: string;
  readonly width?: number;
  readonly copy?: Readonly<Record<string, never>>;
}

const KEYS = new Set(["schema", "fixtures", "inputs", "container", "theme", "width", "copy"]);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(nonEmpty);

/** Why `contract.fixture` is not a well-formed, typed contract fixture; empty when it is absent or valid. */
export function contractFixtureIssues(contract: Readonly<Record<string, unknown>>, path = "slot.json"): SlotModelIssue[] {
  const fixture = contract.fixture;
  if (fixture === undefined) return [];
  const issues: SlotModelIssue[] = [];
  const fail = (message: string) => issues.push({ code: "slot-invalid", path, message: `contract.fixture ${message}` });
  if (!object(fixture)) { fail("must be an object"); return issues; }
  for (const key of Object.keys(fixture)) if (!KEYS.has(key)) fail(`has unknown key ${key}`);
  if (fixture.schema !== CONTRACT_FIXTURE_SCHEMA) fail(`schema must be ${CONTRACT_FIXTURE_SCHEMA}`);
  const fixtures = fixture.fixtures;
  if (!object(fixtures) || !nonEmpty(fixtures.file) || !nonEmpty(fixtures.export) || !object(fixtures.props) || Object.keys(fixtures).some(key => key !== "file" && key !== "export" && key !== "props")) {
    fail("fixtures must be { file, export, props } with a props object");
  } else {
    const declared = contract.props;
    const mountOnly = contract.fixtureProps ?? [];
    if (!strings(declared)) fail("is typed by contract.props, which must list prop names");
    else if (!strings(mountOnly)) fail("is typed by contract.fixtureProps, which must list prop names when present");
    else {
      const both = mountOnly.filter(key => declared.includes(key)).sort();
      if (both.length) fail(`props ${both.join(", ")} are listed in both contract.props and contract.fixtureProps`);
      const undeclared = Object.keys(fixtures.props).filter(key => !declared.includes(key) && !mountOnly.includes(key)).sort();
      if (undeclared.length) fail(`props ${undeclared.join(", ")} are not declared in contract.props or contract.fixtureProps`);
    }
  }
  const inputs = fixture.inputs;
  if (inputs !== undefined && (!object(inputs) || Object.keys(inputs).some(key => key !== "copy" && key !== "slots")
    || (inputs.copy !== undefined && !strings(inputs.copy)) || (inputs.slots !== undefined && !strings(inputs.slots)))) {
    fail("inputs must be { copy?: [<writer key>], slots?: [<designer slot>] }");
  }
  if (fixture.copy !== undefined && (!object(fixture.copy) || Object.keys(fixture.copy).length)) fail("carries no copy snapshot (copy must be empty); declare Writer keys in inputs.copy");
  if (fixture.width !== undefined && !(Number.isSafeInteger(fixture.width) && (fixture.width as number) > 0)) fail("width must be a positive integer");
  for (const key of ["container", "theme"] as const) if (fixture[key] !== undefined && !nonEmpty(fixture[key])) fail(`${key} must be a non-empty string`);
  return issues;
}

/** The slot's valid contract fixture, or undefined when it declares none or an invalid one. */
export function contractFixtureOf(contract: Readonly<Record<string, unknown>> | undefined): ContractFixture | undefined {
  if (!contract || contract.fixture === undefined || contractFixtureIssues(contract).length) return undefined;
  return contract.fixture as ContractFixture;
}
