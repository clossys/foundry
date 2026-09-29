import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPlanContract } from "./plan-contract.js";
import { main } from "./render-status-cli.js";
import { DELEGATED_COPY_SCOPE_PATTERN, renderAdvisorStatus, validateAdvisorPlan } from "./status.js";
import type { AdvisorPlan, AdvisorPlanDelegatedCopyApproval } from "./status.js";

const BASE_PLAN: AdvisorPlan = {
  schemaVersion: 1,
  asOf: "2026-09-22T00:00:00Z",
  mandate: { problem: "Placeholder problem statement.", primaryProblemId: "strategist-unclear-direction", roles: ["strategist", "writer"] },
  whereWeAre: ["Placeholder status line."],
  recommendedNext: { action: "Approve the first-wave plan.", owner: "sponsor", due: "2026-09-29T00:00:00Z" },
  decisions: [
    {
      at: "2026-09-20T00:00:00Z",
      recommended: "compose from confirmed problems",
      chosen: "approved",
      by: "sponsor",
      subjectDigest: `sha256:${"a".repeat(64)}`,
    },
  ],
  blockers: [],
};

const NO_FIELD_GOLDEN =
  "# Advisor status\n\n## Mandate\n\nPlaceholder problem statement.\n\nStaffed roles: strategist, writer.\n\n## Where we are\n\n- Placeholder status line.\n\n## Recommended next\n\nApprove the first-wave plan. (owner: sponsor, due 2026-09-29T00:00:00Z)\n\n## Decisions\n\n- 2026-09-20T00:00:00Z — recommended: compose from confirmed problems; chosen: approved (by sponsor)\n\n## Blockers\n\nNone.\n";

const NO_FIELD_NOTHING_PENDING_GOLDEN =
  "# Advisor status\n\n## Mandate\n\nPlaceholder problem statement.\n\nStaffed roles: strategist, writer.\n\n## Where we are\n\n- Placeholder status line.\n\n## Recommended next\n\nNothing pending.\n\n## Decisions\n\n- 2026-09-20T00:00:00Z — recommended: compose from confirmed problems; chosen: approved (by sponsor)\n\n## Blockers\n\nNone.\n";

function declaring(delegatedCopyApproval: AdvisorPlanDelegatedCopyApproval, overrides: Partial<AdvisorPlan> = {}): AdvisorPlan {
  return { ...BASE_PLAN, ...overrides, delegatedCopyApproval };
}

function statusWith(line: string, next = "Approve the first-wave plan. (owner: sponsor, due 2026-09-29T00:00:00Z)"): string {
  return `# Advisor status\n\n## Mandate\n\nPlaceholder problem statement.\n\nStaffed roles: strategist, writer.\n\n## Where we are\n\n- Placeholder status line.\n\n## Recommended next\n\n${next}\n\n${line}\n\n## Decisions\n\n- 2026-09-20T00:00:00Z — recommended: compose from confirmed problems; chosen: approved (by sponsor)\n\n## Blockers\n\nNone.\n`;
}

const ALL_ENTRIES_LINE = "Approving this plan also accepts delegate-approved copy on production, for every copy entry.";

describe("renderAdvisorStatus delegated copy declaration (issue #1614)", () => {
  it("a plan without the field renders byte-identically to the output captured from main", () => {
    expect(renderAdvisorStatus(BASE_PLAN)).toBe(NO_FIELD_GOLDEN);
    expect(renderAdvisorStatus({ ...BASE_PLAN, recommendedNext: null })).toBe(NO_FIELD_NOTHING_PENDING_GOLDEN);
  });

  it("names the declaration for every copy entry when there are no scopes", () => {
    const plan = declaring({ target: "production" });
    expect(validateAdvisorPlan(plan)).toEqual([]);
    expect(renderAdvisorStatus(plan)).toBe(statusWith(ALL_ENTRIES_LINE));
  });

  it("lists two scopes as code spans in the order given", () => {
    const plan = declaring({ target: "production", scopes: ["site.home", "pricing-page"] });
    expect(validateAdvisorPlan(plan)).toEqual([]);
    expect(renderAdvisorStatus(plan)).toBe(
      statusWith("Approving this plan also accepts delegate-approved copy on production, only for copy entries under: `site.home`, `pricing-page`."),
    );
  });

  it("shows a repeated scope once, at its first occurrence", () => {
    const plan = declaring({ target: "production", scopes: ["site.home", "about", "site.home", "about", "faq"] });
    expect(validateAdvisorPlan(plan)).toEqual([]);
    expect(renderAdvisorStatus(plan)).toBe(
      statusWith("Approving this plan also accepts delegate-approved copy on production, only for copy entries under: `site.home`, `about`, `faq`."),
    );
  });

  it("sits in Recommended next, before the Decisions section", () => {
    const markdown = renderAdvisorStatus(declaring({ target: "production" }));
    const headings = [...markdown.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
    expect(headings).toEqual(["Mandate", "Where we are", "Recommended next", "Decisions", "Blockers"]);
    expect(markdown.indexOf("## Recommended next")).toBeLessThan(markdown.indexOf(ALL_ENTRIES_LINE));
    expect(markdown.indexOf(ALL_ENTRIES_LINE)).toBeLessThan(markdown.indexOf("## Decisions"));
    expect(markdown.split(ALL_ENTRIES_LINE)).toHaveLength(2);
  });

  it("still shows the line after 'Nothing pending.' when recommendedNext is null", () => {
    const markdown = renderAdvisorStatus(declaring({ target: "production" }, { recommendedNext: null }));
    expect(markdown).toBe(statusWith(ALL_ENTRIES_LINE, "Nothing pending."));
  });

  it("changes nothing else: removing the line gives the no-field output", () => {
    const markdown = renderAdvisorStatus(declaring({ target: "production", scopes: ["site.home"] }));
    const line = "Approving this plan also accepts delegate-approved copy on production, only for copy entries under: `site.home`.";
    expect(markdown.replace(`${line}\n\n`, "")).toBe(NO_FIELD_GOLDEN);
  });

  it("holds its scope pattern equal to the packed contract's copyDelegateScope pattern", () => {
    const contract = loadPlanContract("advisor-plan.json") as { definitions: { copyDelegateScope: { pattern: string } } };
    expect(DELEGATED_COPY_SCOPE_PATTERN.source).toBe(contract.definitions.copyDelegateScope.pattern);
  });
});

describe("renderAdvisorStatus refuses a declaration outside the contract's shape", () => {
  const refusals: ReadonlyArray<readonly [string, unknown, RegExp]> = [
    ["a target other than production", { target: "preview" }, /delegatedCopyApproval\.target/],
    ["an empty scopes list", { target: "production", scopes: [] }, /delegatedCopyApproval\.scopes/],
    ["a scope with a capital letter and a dot", { target: "production", scopes: ["Site.Home"] }, /delegatedCopyApproval\.scopes\[0\]/],
    ["a scope holding a backtick", { target: "production", scopes: ["site.home", "a`b"] }, /delegatedCopyApproval\.scopes\[1\]/],
    ["a scope holding a newline", { target: "production", scopes: ["site.home\nInjected line"] }, /delegatedCopyApproval\.scopes\[0\]/],
    ["a scope ending in a newline", { target: "production", scopes: ["site.home\n"] }, /delegatedCopyApproval\.scopes\[0\]/],
    ["scopes present but undefined", { target: "production", scopes: undefined }, /delegatedCopyApproval\.scopes/],
    ["a scope that is not a string", { target: "production", scopes: [7] }, /delegatedCopyApproval\.scopes\[0\]/],
    ["scopes that is not an array", { target: "production", scopes: "site.home" }, /delegatedCopyApproval\.scopes/],
  ];

  for (const [name, declaration, position] of refusals) {
    it(`throws a TypeError naming the position, never the value, for ${name}`, () => {
      const plan = { ...BASE_PLAN, delegatedCopyApproval: declaration } as unknown as AdvisorPlan;
      let thrown: unknown;
      try {
        renderAdvisorStatus(plan);
      } catch (cause) {
        thrown = cause;
      }
      expect(thrown).toBeInstanceOf(TypeError);
      const message = (thrown as TypeError).message;
      expect(message).toMatch(position);
      for (const leaked of ["preview", "Site.Home", "a`b", "Injected", "site.home"]) expect(message).not.toContain(leaked);
      expect(message).not.toContain("`");
      expect(message).not.toContain("\n");
    });
  }

  it("refuses a declaration that is not an object", () => {
    for (const declaration of [null, "production", ["production"]]) {
      const plan = { ...BASE_PLAN, delegatedCopyApproval: declaration } as unknown as AdvisorPlan;
      expect(() => renderAdvisorStatus(plan)).toThrow(TypeError);
      expect(() => renderAdvisorStatus(plan)).toThrow(/delegatedCopyApproval/);
    }
  });

  it("refuses an undeclared member of the declaration by position", () => {
    const plan = { ...BASE_PLAN, delegatedCopyApproval: { target: "production", extra: true } } as unknown as AdvisorPlan;
    expect(() => renderAdvisorStatus(plan)).toThrow(TypeError);
    expect(() => renderAdvisorStatus(plan)).toThrow(/delegatedCopyApproval has a member/);
    expect(() => renderAdvisorStatus(plan)).not.toThrow(/extra/);
  });
});

describe("advisor-render-status with a declaring plan", () => {
  afterEach(() => vi.restoreAllMocks());

  it("prints the delegated copy line", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const path = join(mkdtempSync(join(tmpdir(), "advisor-status-delegated-copy-")), "plan.json");
    writeFileSync(path, JSON.stringify(declaring({ target: "production", scopes: ["site.home"] })));
    expect(main([path])).toBe(0);
    expect(log).toHaveBeenCalledTimes(1);
    const printed = String(log.mock.calls[0]?.[0]);
    expect(printed).toContain("Approving this plan also accepts delegate-approved copy on production, only for copy entries under: `site.home`.");
    expect(printed.indexOf("Approving this plan")).toBeLessThan(printed.indexOf("## Decisions"));
  });
});
