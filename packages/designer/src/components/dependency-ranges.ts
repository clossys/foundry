/** Offline SemVer constraints for copied source. Unsupported syntax fails closed. */
interface Version { parts: readonly number[]; pre: readonly string[]; text: string }
interface Bound { version: Version; inclusive: boolean }
interface Arm { lower?: Bound; upper?: Bound; prereleases: ReadonlySet<string>; text: string }
const core = (version: Version) => version.parts.join(".");
function version(text: string): Version {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/.exec(text);
  if (!match) throw new Error("Invalid dependency version range");
  const parts = match.slice(1, 4).map(Number), pre = match[4]?.split(".") ?? [];
  if (parts.some(part => !Number.isSafeInteger(part)) || pre.some(part => /^\d+$/.test(part) && part.length > 1 && part.startsWith("0"))) throw new Error("Invalid dependency version range");
  return { parts, pre, text };
}
function compare(left: Version, right: Version): number {
  for (let index = 0; index < 3; index++) if (left.parts[index] !== right.parts[index]) return left.parts[index]! < right.parts[index]! ? -1 : 1;
  if (!left.pre.length || !right.pre.length) return left.pre.length ? -1 : right.pre.length ? 1 : 0;
  for (let index = 0; index < Math.max(left.pre.length, right.pre.length); index++) {
    const a = left.pre[index], b = right.pre[index];
    if (a === b) continue;
    if (a === undefined || b === undefined) return a === undefined ? -1 : 1;
    const numericA = /^\d+$/.test(a), numericB = /^\d+$/.test(b);
    if (numericA !== numericB) return numericA ? -1 : 1;
    if (numericA && a.length !== b.length) return a.length < b.length ? -1 : 1;
    return a < b ? -1 : 1;
  }
  return 0;
}
const stable = (parts: readonly number[]) => version(parts.join("."));
const before = (parts: readonly number[]) => version(`${parts.join(".")}-0`);
function tighter(a: Bound | undefined, b: Bound | undefined, lower: boolean): Bound | undefined {
  if (!a || !b) return a ?? b;
  const order = compare(a.version, b.version);
  if (!order) return { version: a.version, inclusive: a.inclusive && b.inclusive };
  return (lower ? order > 0 : order < 0) ? a : b;
}
function inside(value: Version, arm: Arm): boolean {
  const low = arm.lower && compare(value, arm.lower.version), high = arm.upper && compare(value, arm.upper.version);
  return !(low !== undefined && (low < 0 || low === 0 && !arm.lower!.inclusive) || high !== undefined && (high > 0 || high === 0 && !arm.upper!.inclusive));
}
function nonempty(arm: Arm): boolean {
  const low = arm.lower;
  let candidate = low ? stable(low.version.parts) : stable([0, 0, 0]);
  if (low && !low.version.pre.length && !low.inclusive) candidate = stable([candidate.parts[0]!, candidate.parts[1]!, candidate.parts[2]! + 1]);
  if (inside(candidate, arm)) return true;
  for (const tuple of arm.prereleases) {
    let pre = version(`${tuple}-0`);
    if (low && (compare(pre, low.version) < 0 || compare(pre, low.version) === 0 && !low.inclusive)) {
      if (!low.version.pre.length) continue;
      pre = low.inclusive ? low.version : version(`${low.version.text.split("+")[0]}.0`);
    }
    if (pre.pre.length && core(pre) === tuple && inside(pre, arm)) return true;
  }
  return false;
}
function parse(input: string): Arm[] {
  if (typeof input !== "string" || !input.trim() || input.length > 4096) throw new Error("Invalid dependency version range");
  const branches = input.trim().split(/\s*\|\|\s*/);
  if (branches.length > 32 || branches.some(branch => !branch)) throw new Error("Invalid dependency version range");
  return branches.map(branch => {
    let lower: Bound | undefined, upper: Bound | undefined;
    const prereleases = new Set<string>(), tokens: string[] = [];
    const add = (operator: string, value: Version, explicit = true) => {
      if (explicit && value.pre.length) prereleases.add(core(value));
      if (operator === ">" || operator === ">=" || !operator) lower = tighter(lower, { version: value, inclusive: operator !== ">" }, true);
      if (operator === "<" || operator === "<=" || !operator) upper = tighter(upper, { version: value, inclusive: operator !== "<" }, false);
      tokens.push(`${operator || "="}${value.text}`);
    };
    const expand = (operator: string, raw: string) => {
      const partial = /^(?:v)?(0|[1-9]\d*|[xX*])(?:\.(0|[1-9]\d*|[xX*]))?(?:\.(0|[1-9]\d*|[xX*]))?((?:-[\da-zA-Z.-]+)?(?:\+[\da-zA-Z.-]+)?)$/.exec(raw);
      if (!partial) throw new Error("Invalid dependency version range");
      const fields = partial.slice(1, 4), index = fields.findIndex(field => field === undefined || /^[xX*]$/.test(field)), count = index < 0 ? 3 : index;
      if (fields.slice(count).some(field => field !== undefined && !/^[xX*]$/.test(field)) || partial[4] && count < 3) throw new Error("Invalid dependency version range");
      const parts = fields.map(field => field === undefined || /^[xX*]$/.test(field) ? 0 : Number(field));
      const value = version(`${parts.join(".")}${partial[4] ?? ""}`);
      if (count === 0) { if (operator && operator !== "=" && operator !== "^" && operator !== "~") throw new Error("Unsupported dependency version range"); return; }
      const next = count === 1 ? [parts[0]! + 1, 0, 0] : [parts[0]!, parts[1]! + 1, 0];
      if (operator === "^" || operator === "~") {
        add(">=", value);
        const limit = operator === "~" ? count === 1 ? [parts[0]! + 1, 0, 0] : [parts[0]!, parts[1]! + 1, 0]
          : parts[0]! > 0 || count === 1 ? [parts[0]! + 1, 0, 0] : parts[1]! > 0 || count === 2 ? [0, parts[1]! + 1, 0] : [0, 0, parts[2]! + 1];
        add("<", before(limit), false); return;
      }
      if (count === 3) { add(operator === "=" ? "" : operator, value); return; }
      if (!operator || operator === "=") { add(">=", value); add("<", before(next), false); }
      else if (operator === ">") add(">=", stable(next));
      else if (operator === "<=") add("<", before(next), false);
      else if (operator === "<") add("<", before(parts), false);
      else add(operator, value);
    };
    const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(branch);
    if (hyphen) { expand(">=", hyphen[1]!); expand("<=", hyphen[2]!); }
    else {
      const normalized = branch.replace(/(>=|<=|[><=^~])\s+/g, "$1");
      for (const token of normalized.split(/\s+/)) {
        const match = /^(>=|<=|[><=^~])?(\S+)$/.exec(token);
        if (!match) throw new Error("Invalid dependency version range");
        expand(match[1] ?? "", match[2]!);
      }
    }
    return { lower, upper, prereleases, text: tokens.join(" ") || "*" };
  }).filter(nonempty);
}
function subset(candidate: Arm[], required: Arm[]): boolean {
  return candidate.every(arm => required.some(target => {
    if (target.lower && (!arm.lower || compare(arm.lower.version, target.lower.version) < 0 || compare(arm.lower.version, target.lower.version) === 0 && arm.lower.inclusive && !target.lower.inclusive)) return false;
    if (target.upper && (!arm.upper || compare(arm.upper.version, target.upper.version) > 0 || compare(arm.upper.version, target.upper.version) === 0 && arm.upper.inclusive && !target.upper.inclusive)) return false;
    return [...arm.prereleases].every(tuple => target.prereleases.has(tuple) || !nonempty({ ...arm, lower: tighter(arm.lower, { version: version(`${tuple}-0`), inclusive: true }, true), upper: tighter(arm.upper, { version: version(tuple), inclusive: false }, false), prereleases: new Set([tuple]) }));
  }));
}
function boundsText(arm: Arm): string {
  return [arm.lower && `${arm.lower.inclusive ? ">=" : ">"}${arm.lower.version.text}`, arm.upper && `${arm.upper.inclusive ? "<=" : "<"}${arm.upper.version.text}`].filter(Boolean).join(" ") || "*";
}
function renderIntersection(arm: Arm): string[] {
  // A comparator mentioning a prerelease opts that tuple into an npm range.
  // Emit stable versions separately, then only tuples admitted by BOTH inputs.
  const releases: Arm = {
    lower: arm.lower && { version: stable(arm.lower.version.parts), inclusive: arm.lower.version.pre.length > 0 || arm.lower.inclusive },
    upper: arm.upper && { version: stable(arm.upper.version.parts), inclusive: !arm.upper.version.pre.length && arm.upper.inclusive },
    prereleases: new Set(), text: "",
  };
  const result = nonempty(releases) ? [boundsText(releases)] : [];
  for (const tuple of arm.prereleases) {
    const prerelease: Arm = { ...arm, lower: tighter(arm.lower, { version: version(`${tuple}-0`), inclusive: true }, true), upper: tighter(arm.upper, { version: version(tuple), inclusive: false }, false) };
    if (nonempty(prerelease)) result.push(boundsText(prerelease));
  }
  return result;
}
/** Preserve an existing declared subset; otherwise emit the complete conjunction. */
export function mergeSourceDependencyRanges(previous: string | undefined, next: string): string {
  const right = parse(next);
  if (!right.length) throw new Error("Dependency range conflict");
  if (previous === undefined) return next;
  const left = parse(previous);
  if (!left.length) throw new Error("Dependency range conflict");
  if (subset(left, right)) return previous;
  if (subset(right, left)) return next;
  const intersections: Arm[] = [];
  for (const a of left) for (const b of right) {
    const prereleases = new Set([...a.prereleases].filter(tuple => b.prereleases.has(tuple)));
    const arm = { lower: tighter(a.lower, b.lower, true), upper: tighter(a.upper, b.upper, false), prereleases, text: `${a.text === "*" ? "" : a.text} ${b.text === "*" ? "" : b.text}`.trim() || "*" };
    if (!nonempty(arm)) continue;
    intersections.push(arm);
  }
  if (!intersections.length) throw new Error("Dependency range conflict");
  return intersections.flatMap(renderIntersection).join(" || ");
}
