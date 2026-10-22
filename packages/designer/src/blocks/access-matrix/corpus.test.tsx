import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { AccessMatrix, type AccessMatrixProps } from "../AccessMatrix.js";
import { accessMatrixSample } from "./sample.js";

// The seven classes and accepted cases are the cutter-written #2373 appendix.
// Each generated entry varies exactly one field of the real sample render.
type Entry = { name: string; accepted: boolean; change: (p: AccessMatrixProps) => unknown };
const cell = (value: unknown) => (p: AccessMatrixProps) => ({ ...p, value: { ...p.value, viewer: { ...p.value.viewer, "create-projects": value } } });
const states = [
  ["single-character", ["grante", "granter", "denid", "inherted", "inheritedd"]],
  ["case", ["Granted", "GRANTED", "Denied", "Inherited"]],
  ["separators", ["granted ", " granted", "in-herited", "in_herited", "granted\u200b"]],
  ["lookalikes", ["gr\u0430nted", "d\u0435nied", "\uff47ranted"]],
  ["neighbours", ["grant", "allow", "allowed", "deny", "inherit", "none", "mixed", "partial"]],
] as const;
const entries: Entry[] = states.flatMap(([group, values]) => values.map(state => ({ name: `${group}: ${state}`, accepted: false, change: cell({ state }) })));
for (const [name, value] of [
  ["boolean state", { state: true }], ["numeric state", { state: 1 }], ["null state", { state: null }], ["array state", { state: ["granted"] }],
  ["bare string", "granted"], ["bare boolean", true], ["empty reason", { state: "inherited", reason: "" }], ["numeric reason", { state: "inherited", reason: 42 }], ["absent reason", { state: "inherited" }],
] as const) entries.push({ name: `wrong-type: ${name}`, accepted: false, change: cell(value) });
entries.push(
  { name: "container: value array", accepted: false, change: p => ({ ...p, value: [p.value.viewer] }) },
  { name: "container: role array", accepted: false, change: p => ({ ...p, value: { ...p.value, viewer: [] } }) },
  { name: "container: role Map", accepted: false, change: p => ({ ...p, value: { ...p.value, viewer: new Map() } }) },
  { name: "container: permissions object", accepted: false, change: p => ({ ...p, groups: [{ ...p.groups[0], permissions: { "view-projects": p.groups[0]!.permissions[0] } }, ...p.groups.slice(1)] }) },
  { name: "container: roles object", accepted: false, change: p => ({ ...p, roles: { viewer: p.roles[0] } }) },
  { name: "accepted granted", accepted: true, change: cell({ state: "granted" }) },
  { name: "accepted denied", accepted: true, change: cell({ state: "denied" }) },
  { name: "accepted inherited", accepted: true, change: cell({ state: "inherited", reason: "Granted by the Editor role" }) },
  { name: "accepted missing", accepted: true, change: p => { const viewer = { ...p.value.viewer }; delete viewer["create-projects"]; return { ...p, value: { ...p.value, viewer } }; } },
);

describe("AccessMatrix immutable near-miss render corpus (MA1–MA4)", () => {
  it.each(entries)("$name", ({ change, accepted }) => {
    const attempt = () => render(<AccessMatrix {...change(accessMatrixSample) as AccessMatrixProps} />);
    if (accepted) expect(attempt).not.toThrow();
    else expect(attempt).toThrow(TypeError);
  });
});
