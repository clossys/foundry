import { describe, expect, it } from "vitest";
import {
  REPOSITORY_CHOICE_CARD_ID,
  REPOSITORY_SOMETHING_ELSE_ID,
  applyRepositoryChoice,
  repositoryChoiceCard,
  type RepositoryChoiceCard,
} from "./repository-choice.js";

const LISTING = [
  { nameWithOwner: "example-owner/example-site", description: "Marketing site" },
  { nameWithOwner: "example-owner/example-app", description: "" },
  { nameWithOwner: "example-org/example-api", description: null },
];

function cardFor(listing: unknown, options: { current?: string } = {}): RepositoryChoiceCard {
  const result = repositoryChoiceCard(listing, options);
  if (result.state !== "card") throw new Error(`expected a card, got ${JSON.stringify(result)}`);
  return result.card;
}

function messagesOf(result: ReturnType<typeof repositoryChoiceCard>): string[] {
  return result.state === "invalid" ? result.findings.map((finding) => finding.message) : [];
}

describe("repositoryChoiceCard (#1179)", () => {
  it("offers every listed repository, sorted by id, with something-else last and no invented recommendation", () => {
    const card = cardFor(LISTING);
    expect(card.id).toBe(REPOSITORY_CHOICE_CARD_ID);
    expect(card.selection).toBe("many");
    expect(card.choices.map((choice) => choice.id)).toEqual([
      "example-org/example-api",
      "example-owner/example-app",
      "example-owner/example-site",
      REPOSITORY_SOMETHING_ELSE_ID,
    ]);
    expect(card).not.toHaveProperty("recommendedChoiceId");
    expect(card.somethingElseFollowUp).toMatch(/\?/);
  });

  it("labels each repository by owner/name and carries a non-blank description as detail only", () => {
    const card = cardFor(LISTING);
    expect(card.choices.find((choice) => choice.id === "example-owner/example-site")).toEqual({
      id: "example-owner/example-site",
      label: "example-owner/example-site",
      detail: "Marketing site",
    });
    expect(card.choices.find((choice) => choice.id === "example-owner/example-app")).not.toHaveProperty("detail");
    expect(card.choices.find((choice) => choice.id === "example-org/example-api")).not.toHaveProperty("detail");
  });

  it("recommends the current repository and lists it first, matching its listed spelling case-insensitively", () => {
    const card = cardFor(LISTING, { current: "Example-Owner/Example-App" });
    expect(card.recommendedChoiceId).toBe("example-owner/example-app");
    expect(card.choices[0]?.id).toBe("example-owner/example-app");
    expect(card.choices.map((choice) => choice.id).slice(1)).toEqual(["example-org/example-api", "example-owner/example-site", REPOSITORY_SOMETHING_ELSE_ID]);
  });

  it("offers a single repository (runtime choices may be one repository plus something-else)", () => {
    expect(cardFor([{ nameWithOwner: "example-owner/example-repo" }]).choices.map((choice) => choice.id)).toEqual([
      "example-owner/example-repo",
      REPOSITORY_SOMETHING_ELSE_ID,
    ]);
  });

  it("offers only ids the repository inventory contract accepts", () => {
    for (const choice of cardFor(LISTING).choices.filter((entry) => entry.id !== REPOSITORY_SOMETHING_ELSE_ID)) {
      expect(choice.id).toMatch(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/);
    }
  });

  it.each([
    ["not an array", { nameWithOwner: "example-owner/example-repo" }, /^listing must be an array \(the list of repositories\), got object$/],
    ["an empty list", [], /^listing must have at least 1 item\(s\)$/],
    ["an entry that is not an object", ["example-owner/example-repo"], /^listing\[0\] must be an object \(the repository entry\), got string$/],
    ["an entry with no nameWithOwner", [{ description: "x" }], /^listing\[0\]\.nameWithOwner is required$/],
    ["an entry with an unknown field", [{ nameWithOwner: "example-owner/example-repo", url: "x" }], /^listing\[0\]\.url is not a field the contract declares/],
    ["a description of the wrong type", [{ nameWithOwner: "example-owner/example-repo", description: 7 }], /^listing\[0\]\.description must be a string or null$/],
    ["a bare name, which GitHub never lists", [{ nameWithOwner: "example-repo" }], /^listing\[0\]\.nameWithOwner must be owner\/name, as GitHub lists a repository$/],
    ["more than one slash", [{ nameWithOwner: "example-owner/example-repo/extra" }], /^listing\[0\]\.nameWithOwner must be a bare repository name or owner\/name/],
    ["a dot-dot name", [{ nameWithOwner: "example-owner/.." }], /^listing\[0\]\.nameWithOwner must be a bare repository name or owner\/name/],
    ["whitespace", [{ nameWithOwner: " example-owner/example-repo" }], /^listing\[0\]\.nameWithOwner must be a bare repository name or owner\/name/],
  ])("refuses a malformed list: %s", (_name, listing, message) => {
    const result = repositoryChoiceCard(listing);
    expect(result.state).toBe("invalid");
    expect(messagesOf(result)).toEqual([expect.stringMatching(message)]);
    if (result.state === "invalid") expect(result.findings.every((finding) => finding.rule === "repository-listing" && finding.severity === "error")).toBe(true);
  });

  it("names every malformed entry by position, and never echoes a repository name", () => {
    const secret = "example-owner/private-thing";
    const result = repositoryChoiceCard([{ nameWithOwner: `${secret}/extra` }, { nameWithOwner: "example-owner/example-repo" }, { nameWithOwner: `${secret} ` }]);
    expect(result.state).toBe("invalid");
    if (result.state !== "invalid") return;
    expect(result.findings.map((finding) => finding.path)).toEqual(["listing[0].nameWithOwner", "listing[2].nameWithOwner"]);
    for (const finding of result.findings) expect(finding.message).not.toContain("private-thing");
  });

  it("refuses a duplicate id, including one that differs only in letter case, by position only", () => {
    const result = repositoryChoiceCard([
      { nameWithOwner: "example-owner/example-repo" },
      { nameWithOwner: "example-owner/other-repo" },
      { nameWithOwner: "Example-Owner/Example-Repo" },
      { nameWithOwner: "example-owner/other-repo" },
    ]);
    expect(messagesOf(result)).toEqual([
      "listing[2].nameWithOwner names the same repository as listing[0].nameWithOwner (repository ids are compared case-insensitively)",
      "listing[3].nameWithOwner names the same repository as listing[1].nameWithOwner (repository ids are compared case-insensitively)",
    ]);
  });

  it("refuses a current repository that is not on the list, or is not a valid id, without echoing it", () => {
    expect(messagesOf(repositoryChoiceCard(LISTING, { current: "example-owner/not-listed" }))).toEqual(["current is not one of the listed repositories"]);
    const invalid = messagesOf(repositoryChoiceCard(LISTING, { current: "example-owner/a/b" }));
    expect(invalid).toEqual([expect.stringMatching(/^current must be a bare repository name or owner\/name/)]);
    expect(invalid.join(" ")).not.toContain("example-owner/a/b");
  });
});

describe("applyRepositoryChoice (#1179)", () => {
  const card = cardFor(LISTING, { current: "example-owner/example-app" });

  it("returns the chosen repositories in the card's order, whatever order they were picked in", () => {
    expect(applyRepositoryChoice(card, ["example-owner/example-site", "example-owner/example-app"])).toEqual({
      kind: "chosen",
      repositories: ["example-owner/example-app", "example-owner/example-site"],
      somethingElse: false,
    });
  });

  it("keeps the chosen repositories and notes that the client also said one is missing", () => {
    expect(applyRepositoryChoice(card, ["example-org/example-api", REPOSITORY_SOMETHING_ELSE_ID])).toEqual({
      kind: "chosen",
      repositories: ["example-org/example-api"],
      somethingElse: true,
    });
  });

  it("returns something-else alone when no repository was chosen", () => {
    expect(applyRepositoryChoice(card, [REPOSITORY_SOMETHING_ELSE_ID])).toEqual({ kind: "something-else" });
  });

  it("refuses a choice the card did not offer, by position only", () => {
    const result = applyRepositoryChoice(card, ["example-owner/example-app", "example-owner/never-offered"]);
    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") return;
    expect(result.findings.map((finding) => finding.message)).toEqual(["choice[1] is not one of the choices this card offered"]);
    expect(result.findings[0]).toMatchObject({ rule: "repository-choice", severity: "error", path: "choice[1]" });
    expect(JSON.stringify(result)).not.toContain("never-offered");
  });

  it("refuses an id that differs from an offered one only in letter case: the choice must be the card's own id", () => {
    const result = applyRepositoryChoice(card, ["Example-Owner/Example-App"]);
    expect(result).toMatchObject({ kind: "refused", findings: [{ message: "choice[0] is not one of the choices this card offered" }] });
  });

  it("refuses a repository chosen twice", () => {
    const result = applyRepositoryChoice(card, ["example-owner/example-app", "example-org/example-api", "example-owner/example-app"]);
    expect(result).toMatchObject({ kind: "refused", findings: [{ message: "choice[2] repeats choice[0]" }] });
  });

  it.each([
    ["an empty choice", [], "choice must have at least 1 item(s)"],
    ["not a list", "example-owner/example-app", "choice must be an array (the list of choice ids), got string"],
    ["a non-string entry", ["example-owner/example-app", 3], "choice[1] must be a string, got integer"],
  ])("refuses %s", (_name, chosen, message) => {
    expect(applyRepositoryChoice(card, chosen)).toEqual({
      kind: "refused",
      findings: [expect.objectContaining({ rule: "repository-choice", message })],
    });
  });
});
