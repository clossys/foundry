/**
 * A minimal JSON Schema (draft-07) checker for this repository's shared
 * contracts (issue #1475): the plan record and the engagement brief, which
 * two packages validate against without either depending on the other.
 *
 * It implements exactly the keywords those contracts use, and throws on any
 * other keyword, or keyword form, it meets instead of half-checking it.
 * `assertImplementedContract()` walks a whole contract, so a test can prove
 * every subschema is implemented, visited by a value or not. Property
 * lookups use Object.hasOwn, so an inherited name (toString, constructor,
 * __proto__) is never mistaken for a declared or present property.
 *
 * Messages never echo a value from the document under test: a brief can
 * carry founder text, and a refusal message can end up in a log.
 *
 * This file imports nothing. It is the one implementation: a package that
 * cannot import it carries a generated, byte-identical copy.
 */

export type ContractSchema = Readonly<Record<string, unknown>>;

/** One place a value breaks its contract. `path` is `""` for the document itself, else like `blockers[0].nextAction.who`. */
export interface ContractViolation {
  readonly path: string;
  readonly message: string;
}

/** Resolves a file-level `$ref` (for example `engagement-context.json`) to that contract. Throws when it cannot. */
export type ContractLoader = (name: string) => ContractSchema;

const ANNOTATIONS = new Set(["$schema", "$id", "title", "description"]);
const IMPLEMENTED = new Set([
  "$ref", "type", "const", "enum", "required", "properties", "additionalProperties",
  "items", "minItems", "maxItems", "contains", "minLength", "pattern", "oneOf", "allOf", "not", "definitions",
]);

/** Throws on any keyword, or keyword form, this checker does not implement -- for this node only. */
function assertImplementedNode(schema: ContractSchema, at: string): void {
  for (const key of Object.keys(schema)) {
    if (!ANNOTATIONS.has(key) && !IMPLEMENTED.has(key)) throw new Error(`contract checker does not implement "${key}" (at ${at})`);
  }
  if (Object.hasOwn(schema, "type") && typeof schema.type !== "string") throw new Error(`contract checker implements only a string "type" (at ${at})`);
  if (Object.hasOwn(schema, "additionalProperties") && typeof schema.additionalProperties !== "boolean") {
    throw new Error(`contract checker implements only a boolean "additionalProperties" (at ${at})`);
  }
  if (Object.hasOwn(schema, "items") && Array.isArray(schema.items)) throw new Error(`contract checker does not implement tuple "items" (at ${at})`);
}

/** Walks every subschema of `schema`, visited by a value or not, and throws on the first keyword this checker does not implement. */
export function assertImplementedContract(schema: ContractSchema, at = "#"): void {
  assertImplementedNode(schema, at);
  for (const key of ["properties", "definitions"]) {
    for (const [name, child] of Object.entries((schema[key] ?? {}) as Record<string, ContractSchema>)) assertImplementedContract(child, `${at}/${key}/${name}`);
  }
  for (const key of ["items", "contains", "not"]) if (Object.hasOwn(schema, key)) assertImplementedContract(schema[key] as ContractSchema, `${at}/${key}`);
  for (const key of ["oneOf", "allOf"]) {
    (Array.isArray(schema[key]) ? (schema[key] as ContractSchema[]) : []).forEach((child, index) => assertImplementedContract(child, `${at}/${key}/${index}`));
  }
}

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

function childPath(path: string, name: string): string {
  return path === "" ? name : `${path}.${name}`;
}

interface Scope {
  readonly root: ContractSchema;
  readonly load: ContractLoader;
}

function resolveRef(ref: string, scope: Scope, at: string): { schema: ContractSchema; scope: Scope } {
  const [file = "", pointer = ""] = ref.split("#");
  const docRoot = file === "" ? scope.root : scope.load(file);
  let target: unknown = docRoot;
  for (const segment of pointer.split("/").filter(Boolean)) {
    if (typeof target !== "object" || target === null || !Object.hasOwn(target, segment)) throw new Error(`unresolvable $ref ${ref} (at ${at})`);
    target = (target as Record<string, unknown>)[segment];
  }
  return { schema: target as ContractSchema, scope: { root: docRoot, load: scope.load } };
}

/** Follows `$ref` chains to the node that actually carries keywords. */
function dereference(schema: ContractSchema, scope: Scope, at: string): { schema: ContractSchema; scope: Scope } {
  let current = { schema, scope };
  while (typeof current.schema.$ref === "string") current = resolveRef(current.schema.$ref, current.scope, at);
  return current;
}

function check(input: ContractSchema, value: unknown, inputScope: Scope, path: string): ContractViolation[] {
  // Draft-07: $ref replaces every sibling keyword (siblings are annotations only).
  const { schema, scope } = dereference(input, inputScope, path);
  assertImplementedNode(schema, path);
  const kind = typeOf(value);
  const expected = schema.type;
  if (typeof expected === "string" && !(expected === kind || (expected === "number" && kind === "integer"))) {
    return [{ path, message: `must be ${typeof schema.title === "string" ? schema.title : `of type ${expected}`}, got ${kind}` }];
  }
  const violations: ContractViolation[] = [];
  if (Object.hasOwn(schema, "const") && JSON.stringify(schema.const) !== JSON.stringify(value)) violations.push({ path, message: `must equal ${JSON.stringify(schema.const)}` });
  if (Array.isArray(schema.enum) && !schema.enum.some((option) => JSON.stringify(option) === JSON.stringify(value))) {
    violations.push({ path, message: `must be one of: ${schema.enum.map((option) => JSON.stringify(option)).join(", ")}` });
  }
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) violations.push({ path, message: `must be at least ${schema.minLength} character(s) long` });
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(value)) {
      violations.push({ path, message: typeof schema.title === "string" ? `must be ${schema.title}` : `must match the pattern ${schema.pattern}` });
    }
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) violations.push({ path, message: `must have at least ${schema.minItems} item(s)` });
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) violations.push({ path, message: `must have at most ${schema.maxItems} item(s)` });
    if (schema.items !== undefined) value.forEach((item, index) => violations.push(...check(schema.items as ContractSchema, item, scope, `${path}[${index}]`)));
    if (schema.contains !== undefined && !value.some((item, index) => check(schema.contains as ContractSchema, item, scope, `${path}[${index}]`).length === 0)) {
      violations.push({ path, message: `must contain an item matching ${JSON.stringify(schema.contains)}` });
    }
  }
  if (kind === "object") {
    const record = value as Record<string, unknown>;
    const properties = (schema.properties ?? {}) as Record<string, ContractSchema>;
    for (const name of (schema.required ?? []) as string[]) {
      if (!Object.hasOwn(record, name)) violations.push({ path: childPath(path, name), message: "is required" });
    }
    for (const [name, child] of Object.entries(record)) {
      if (Object.hasOwn(properties, name)) violations.push(...check(properties[name] as ContractSchema, child, scope, childPath(path, name)));
      else if (schema.additionalProperties === false) violations.push({ path: childPath(path, name), message: "is not a field the contract declares, and unknown fields are refused" });
    }
  }
  if (Array.isArray(schema.oneOf)) violations.push(...checkOneOf(schema.oneOf as ContractSchema[], value, scope, path));
  if (Array.isArray(schema.allOf)) for (const branch of schema.allOf as ContractSchema[]) violations.push(...check(branch, value, scope, path));
  if (schema.not !== undefined && check(schema.not as ContractSchema, value, scope, path).length === 0) violations.push({ path, message: `must not match ${JSON.stringify(schema.not)}` });
  return violations;
}

/**
 * Exactly one branch must pass. When none does, the violations of the one
 * closest branch are reported -- the branch whose `type` fits the value, or
 * failing that the unique branch with the fewest violations -- so a refusal
 * names the actual field at fault rather than only "no branch matched".
 */
function checkOneOf(branches: readonly ContractSchema[], value: unknown, scope: Scope, path: string): ContractViolation[] {
  const results = branches.map((branch) => check(branch, value, scope, path));
  const passing = results.filter((result) => result.length === 0).length;
  if (passing === 1) return [];
  if (passing > 1) return [{ path, message: `matches ${passing} of the ${branches.length} allowed forms, and must match exactly one` }];
  const kind = typeOf(value);
  const typed = branches
    .map((branch, index) => ({ index, type: dereference(branch, scope, path).schema.type }))
    .filter((entry) => entry.type === kind || (entry.type === "number" && kind === "integer"));
  if (typed.length === 1) return results[typed[0]!.index]!;
  const fewest = Math.min(...results.map((result) => result.length));
  const closest = results.filter((result) => result.length === fewest);
  if (closest.length === 1) return closest[0]!;
  return [{ path, message: `does not match any of the ${branches.length} allowed forms` }];
}

/**
 * Every violation of `value` against `contract`, in document order; empty
 * when it conforms. Never throws for a bad value. Throws only when the
 * contract itself uses a keyword this checker does not implement, or a
 * `$ref` it cannot resolve -- a defect in the contract, not in the value.
 */
export function validateAgainstContract(contract: ContractSchema, value: unknown, load: ContractLoader): ContractViolation[] {
  return check(contract, value, { root: contract, load }, "");
}

/** `label.path message` (for example `plan.blockers[0].capabilityId is required`), or `label message` for the document itself. */
export function formatContractViolation(label: string, violation: ContractViolation): string {
  const where = violation.path === "" ? label : violation.path.startsWith("[") ? `${label}${violation.path}` : `${label}.${violation.path}`;
  return `${where} ${violation.message}`;
}
