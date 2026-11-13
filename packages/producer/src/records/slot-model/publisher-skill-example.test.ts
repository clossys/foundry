import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { jsonBytes, validateCandidate } from "./index.js";

// The Publisher skill teaches agents the clossys.page/1 candidate shape; its worked example must
// pass the same validator `clossys check --slots` runs, so a skill-written page is never refused.
const skill = readFileSync(join(import.meta.dirname, "..", "..", "..", "..", "publisher", "skill", "SKILL.md"), "utf8");
const examples = [...skill.matchAll(/```json\n([\s\S]*?)\n```/g)].map(match => JSON.parse(match[1]!));
const pages = examples.filter(example => example?.schema === "clossys.page/1");

describe("Publisher SKILL.md page example", () => {
  it("is a valid clossys.page/1 candidate with <writer slot>#<key> copy refs", () => {
    expect(pages).toHaveLength(1);
    const [page] = pages;
    expect(validateCandidate("page", "page.home", "home-v1.json", jsonBytes(page))).toEqual([]);
    const refs = [page.copy, ...Object.values(page.bindings ?? {}).map((binding: any) => binding.copy ?? {})].flatMap(copy => Object.values(copy));
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) expect(ref).toMatch(/^[^#\s]+#[^#\s]+$/);
  });

  it("would be refused with the bare Writer ids the skill used to teach", () => {
    const [page] = pages;
    const bare = { ...page, copy: Object.fromEntries(Object.entries(page.copy).map(([slot, ref]) => [slot, String(ref).replace("#", ".")])) };
    expect(validateCandidate("page", "page.home", "home-v1.json", jsonBytes(bare)).map(issue => issue.message).join("\n")).toMatch(/<writer slot>#<key>/);
  });
});
