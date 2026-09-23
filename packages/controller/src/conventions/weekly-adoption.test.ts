import { describe, expect, it } from "vitest";
import {
  RULE_GROUPED_SCHEDULE,
  RULE_NO_OTHER_AUTOMATION,
  RULE_NO_TIMEZONE_DECLARED,
  RULE_NO_UPDATER_CONFIGURED,
  RULE_PROVENANCE_CHECK_REQUIRED,
  RULE_SECURITY_BYPASS,
  evaluateWeeklyAdoption,
  type UpdaterConfigFile,
  type WeeklyAdoptionDeclaration,
} from "./weekly-adoption.js";

function stateOf(results: readonly { rule: string; state: string }[], rule: string): string | undefined {
  return results.find((r) => r.rule === rule)?.state;
}

const BASE: WeeklyAdoptionDeclaration = { applies: true, timezone: "America/Los_Angeles" };
const REQUIRED_CONTEXTS = ["verify-build", "integrator-provenance-check"];

function renovate(config: unknown): UpdaterConfigFile {
  return { path: ".github/renovate.json", kind: "renovate", content: JSON.stringify(config) };
}

function dependabot(yaml: string): UpdaterConfigFile {
  return { path: ".github/dependabot.yml", kind: "dependabot", content: yaml };
}

const CONFORMING_RENOVATE = renovate({
  packageRules: [
    { matchPackagePatterns: ["^@clossys/"], groupName: "clossys weekly", schedule: ["on sunday"] },
  ],
});

const CONFORMING_DEPENDABOT = dependabot(
  [
    "version: 2",
    "updates:",
    "  - package-ecosystem: npm",
    '    directory: "/"',
    "    schedule:",
    "      interval: weekly",
    "      day: sunday",
    "    groups:",
    "      clossys:",
    "        patterns:",
    '          - "@clossys/*"',
  ].join("\n"),
);

describe("evaluateWeeklyAdoption", () => {
  it("is satisfied end to end for a conforming Renovate config", () => {
    const results = evaluateWeeklyAdoption(
      { ...BASE, updaterConfig: CONFORMING_RENOVATE },
      REQUIRED_CONTEXTS,
    );
    expect(stateOf(results, RULE_GROUPED_SCHEDULE)).toBe("satisfied");
    expect(stateOf(results, RULE_SECURITY_BYPASS)).toBe("satisfied");
    expect(stateOf(results, RULE_NO_OTHER_AUTOMATION)).toBe("satisfied");
    expect(stateOf(results, RULE_PROVENANCE_CHECK_REQUIRED)).toBe("satisfied");
    expect(results.every((r) => r.state === "satisfied")).toBe(true);
  });

  it("is satisfied end to end for a conforming Dependabot config", () => {
    const results = evaluateWeeklyAdoption(
      { ...BASE, updaterConfig: CONFORMING_DEPENDABOT },
      REQUIRED_CONTEXTS,
    );
    expect(stateOf(results, RULE_GROUPED_SCHEDULE)).toBe("satisfied");
    expect(stateOf(results, RULE_SECURITY_BYPASS)).toBe("satisfied");
    expect(stateOf(results, RULE_NO_OTHER_AUTOMATION)).toBe("satisfied");
    expect(stateOf(results, RULE_PROVENANCE_CHECK_REQUIRED)).toBe("satisfied");
    expect(results.every((r) => r.state === "satisfied")).toBe(true);
  });

  it("reports missing grouping when no packageRules/groups entry matches @clossys/*", () => {
    const noGroupRenovate = renovate({ packageRules: [{ matchPackagePatterns: ["^left-pad$"], groupName: "misc" }] });
    const results = evaluateWeeklyAdoption({ ...BASE, updaterConfig: noGroupRenovate }, REQUIRED_CONTEXTS);
    expect(stateOf(results, RULE_GROUPED_SCHEDULE)).toBe("missing");

    const noGroupDependabot = dependabot(
      ["version: 2", "updates:", "  - package-ecosystem: npm", '    directory: "/"', "    schedule:", "      interval: weekly"].join(
        "\n",
      ),
    );
    const depResults = evaluateWeeklyAdoption({ ...BASE, updaterConfig: noGroupDependabot }, REQUIRED_CONTEXTS);
    expect(stateOf(depResults, RULE_GROUPED_SCHEDULE)).toBe("missing");
  });

  it("reports violated grouping when a matching packageRule has no groupName", () => {
    const ungrouped = renovate({
      packageRules: [{ matchPackagePatterns: ["^@clossys/"], schedule: ["on sunday"] }],
    });
    const results = evaluateWeeklyAdoption({ ...BASE, updaterConfig: ungrouped }, REQUIRED_CONTEXTS);
    expect(stateOf(results, RULE_GROUPED_SCHEDULE)).toBe("violated");
  });

  it("reports violated when the schedule is not Sunday (Renovate)", () => {
    const wrongDay = renovate({
      packageRules: [{ matchPackagePatterns: ["^@clossys/"], groupName: "clossys", schedule: ["on monday"] }],
    });
    const results = evaluateWeeklyAdoption({ ...BASE, updaterConfig: wrongDay }, REQUIRED_CONTEXTS);
    expect(stateOf(results, RULE_GROUPED_SCHEDULE)).toBe("violated");
    expect(results.find((r) => r.rule === RULE_GROUPED_SCHEDULE)?.message).toMatch(/sunday/i);
  });

  it("reports violated when the schedule day is not Sunday (Dependabot)", () => {
    const wrongDay = dependabot(
      [
        "version: 2",
        "updates:",
        "  - package-ecosystem: npm",
        '    directory: "/"',
        "    schedule:",
        "      interval: weekly",
        "      day: monday",
        "    groups:",
        "      clossys:",
        "        patterns:",
        '          - "@clossys/*"',
      ].join("\n"),
    );
    const results = evaluateWeeklyAdoption({ ...BASE, updaterConfig: wrongDay }, REQUIRED_CONTEXTS);
    expect(stateOf(results, RULE_GROUPED_SCHEDULE)).toBe("violated");
  });

  it("reports violated when the Dependabot interval is not weekly", () => {
    const wrongInterval = dependabot(
      [
        "version: 2",
        "updates:",
        "  - package-ecosystem: npm",
        '    directory: "/"',
        "    schedule:",
        "      interval: daily",
        "    groups:",
        "      clossys:",
        "        patterns:",
        '          - "@clossys/*"',
      ].join("\n"),
    );
    const results = evaluateWeeklyAdoption({ ...BASE, updaterConfig: wrongInterval }, REQUIRED_CONTEXTS);
    expect(stateOf(results, RULE_GROUPED_SCHEDULE)).toBe("violated");
  });

  it("reports missing when no updater is configured at all", () => {
    const results = evaluateWeeklyAdoption(BASE, REQUIRED_CONTEXTS);
    expect(stateOf(results, RULE_NO_UPDATER_CONFIGURED)).toBe("missing");
    // Config-dependent rules are not separately reported when there is no config to evaluate.
    expect(results.map((r) => r.rule)).not.toContain(RULE_GROUPED_SCHEDULE);
  });

  it("reports missing when no timezone is declared", () => {
    const results = evaluateWeeklyAdoption(
      { applies: true, updaterConfig: CONFORMING_RENOVATE },
      REQUIRED_CONTEXTS,
    );
    expect(stateOf(results, RULE_NO_TIMEZONE_DECLARED)).toBe("missing");
  });

  it("flags a Renovate vulnerabilityAlerts override that restricts security updates to a schedule", () => {
    const restricted = renovate({
      packageRules: [{ matchPackagePatterns: ["^@clossys/"], groupName: "clossys", schedule: ["on sunday"] }],
      vulnerabilityAlerts: { schedule: ["on sunday"] },
    });
    const results = evaluateWeeklyAdoption({ ...BASE, updaterConfig: restricted }, REQUIRED_CONTEXTS);
    expect(stateOf(results, RULE_SECURITY_BYPASS)).toBe("violated");
  });

  it("treats vulnerabilityAlerts.schedule: ['at any time'] as satisfying the security-bypass rule", () => {
    const explicit = renovate({
      packageRules: [{ matchPackagePatterns: ["^@clossys/"], groupName: "clossys", schedule: ["on sunday"] }],
      vulnerabilityAlerts: { schedule: ["at any time"] },
    });
    const results = evaluateWeeklyAdoption({ ...BASE, updaterConfig: explicit }, REQUIRED_CONTEXTS);
    expect(stateOf(results, RULE_SECURITY_BYPASS)).toBe("satisfied");
  });

  it("flags more than one Renovate packageRules entry matching @clossys/*", () => {
    const duplicated = renovate({
      packageRules: [
        { matchPackagePatterns: ["^@clossys/"], groupName: "clossys", schedule: ["on sunday"] },
        { matchPackageNames: ["@clossys/controller"], groupName: "controller-only" },
      ],
    });
    const results = evaluateWeeklyAdoption({ ...BASE, updaterConfig: duplicated }, REQUIRED_CONTEXTS);
    expect(stateOf(results, RULE_NO_OTHER_AUTOMATION)).toBe("violated");
  });

  it("flags a second Dependabot npm updates entry that neither groups nor ignores @clossys/*", () => {
    const stray = dependabot(
      [
        "version: 2",
        "updates:",
        "  - package-ecosystem: npm",
        '    directory: "/"',
        "    schedule:",
        "      interval: weekly",
        "      day: sunday",
        "    groups:",
        "      clossys:",
        "        patterns:",
        '          - "@clossys/*"',
        "  - package-ecosystem: npm",
        '    directory: "/packages/foo"',
        "    schedule:",
        "      interval: daily",
      ].join("\n"),
    );
    const results = evaluateWeeklyAdoption({ ...BASE, updaterConfig: stray }, REQUIRED_CONTEXTS);
    expect(stateOf(results, RULE_NO_OTHER_AUTOMATION)).toBe("violated");
  });

  it("does not flag a second Dependabot npm updates entry that ignores @clossys/*", () => {
    const ignored = dependabot(
      [
        "version: 2",
        "updates:",
        "  - package-ecosystem: npm",
        '    directory: "/"',
        "    schedule:",
        "      interval: weekly",
        "      day: sunday",
        "    groups:",
        "      clossys:",
        "        patterns:",
        '          - "@clossys/*"',
        "  - package-ecosystem: npm",
        '    directory: "/packages/foo"',
        "    schedule:",
        "      interval: daily",
        "    ignore:",
        '      - dependency-name: "@clossys/*"',
      ].join("\n"),
    );
    const results = evaluateWeeklyAdoption({ ...BASE, updaterConfig: ignored }, REQUIRED_CONTEXTS);
    expect(stateOf(results, RULE_NO_OTHER_AUTOMATION)).toBe("satisfied");
  });

  it("always satisfies the security-bypass rule for Dependabot -- it is a repository-level setting, not in this file", () => {
    const results = evaluateWeeklyAdoption({ ...BASE, updaterConfig: CONFORMING_DEPENDABOT }, REQUIRED_CONTEXTS);
    expect(stateOf(results, RULE_SECURITY_BYPASS)).toBe("satisfied");
  });

  it("reports missing when integrator-provenance-check is not among the required contexts", () => {
    const results = evaluateWeeklyAdoption({ ...BASE, updaterConfig: CONFORMING_RENOVATE }, ["verify-build"]);
    expect(stateOf(results, RULE_PROVENANCE_CHECK_REQUIRED)).toBe("missing");
  });

  it("reports violated (not throws) for an unparsable Renovate config", () => {
    const bad: UpdaterConfigFile = { path: ".github/renovate.json", kind: "renovate", content: "{ not json" };
    const results = evaluateWeeklyAdoption({ ...BASE, updaterConfig: bad }, REQUIRED_CONTEXTS);
    expect(stateOf(results, RULE_GROUPED_SCHEDULE)).toBe("violated");
    expect(stateOf(results, RULE_SECURITY_BYPASS)).toBe("violated");
    expect(stateOf(results, RULE_NO_OTHER_AUTOMATION)).toBe("violated");
  });

  it("reports violated (not throws) for an unparsable Dependabot config", () => {
    const bad: UpdaterConfigFile = {
      path: ".github/dependabot.yml",
      kind: "dependabot",
      content: "updates:\n  build:\n    not a mapping entry at all\n",
    };
    const results = evaluateWeeklyAdoption({ ...BASE, updaterConfig: bad }, REQUIRED_CONTEXTS);
    expect(stateOf(results, RULE_GROUPED_SCHEDULE)).toBe("violated");
  });
});
