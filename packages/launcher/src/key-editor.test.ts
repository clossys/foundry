import { describe, expect, it } from "vitest";
import { dependencyPointer } from "./change-set-contract.js";
import { JsonEditUnstableError, editJsonPointer } from "./key-editor.js";

describe("editJsonPointer", () => {
  it("preserves two-space indent, key order, and a final newline", () => {
    const text = '{\n  "b": 1,\n  "a": 2\n}\n';
    const expected = '{\n  "b": 1,\n  "a": 3\n}\n';
    expect(editJsonPointer(text, [{ pointer: "/a", value: 3 }])).toBe(expected);
  });

  it("preserves tab indent, key order, and no final newline when appending a key", () => {
    const text = '{\n\t"b": 1,\n\t"a": 2\n}';
    const expected = '{\n\t"b": 1,\n\t"a": 2,\n\t"c": 3\n}';
    expect(editJsonPointer(text, [{ pointer: "/c", value: 3 }])).toBe(expected);
  });

  it("keeps sibling key order and indent for a dependency pointer with a slash encoded as ~1", () => {
    const text = '{\n  "devDependencies": {\n    "z": "1.0.0"\n  }\n}\n';
    const pointer = dependencyPointer("devDependencies", "@scope/name");
    const expected = '{\n  "devDependencies": {\n    "z": "1.0.0",\n    "@scope/name": "2.0.0"\n  }\n}\n';
    expect(editJsonPointer(text, [{ pointer, value: "2.0.0" }])).toBe(expected);
  });

  it("returns the original text when the edit list is empty", () => {
    const text = '{ "a": 1 }\n';
    expect(editJsonPointer(text, [])).toBe(text);
  });

  it("does not rewrite an unchanged numeric token when appending a root entry", () => {
    const text = '{"schemaVersion":1.0,"rootEntries":[]}';
    const edited = editJsonPointer(text, [
      { pointer: "/rootEntries/-", value: { name: "clossys", classification: "extension", disposition: "allowed" } },
    ]);
    expect(edited).toContain("1.0");
    expect(edited).not.toMatch(/"schemaVersion":1[^.]/u);
  });

  it("refuses an edit when a key escape does not round-trip in the source", () => {
    const append = [{ pointer: "/rootEntries/-", value: { name: "clossys", classification: "extension", disposition: "allowed" } }] as const;
    expect(() => editJsonPointer('{"sch\\u0065maVersion":1.0,"rootEntries":[]}', append)).toThrow(JsonEditUnstableError);
    expect(() => editJsonPointer('{"na\\u006de":"pkg","version":"1.0.0"}', [{ pointer: "/private", value: true }])).toThrow(JsonEditUnstableError);
    expect(() => editJsonPointer('{"a\\/b":1.0}', [{ pointer: "/a~1b", value: 2 }])).toThrow(JsonEditUnstableError);
  });

  it("refuses an edit when the source repeats an object key", () => {
    expect(() =>
      editJsonPointer('{"schemaVersion":1.0,"schemaVersion":2,"rootEntries":[]}', [
        { pointer: "/rootEntries/-", value: { name: "clossys", classification: "extension", disposition: "allowed" } },
      ]),
    ).toThrow(JsonEditUnstableError);
  });
});
