import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdvisorRepositoryCardCliInputError, LIST_REPOSITORIES_COMMAND, USAGE, main } from "./repository-card-cli.js";

let root: string;
let log: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

const LISTING = [
  { nameWithOwner: "example-owner/example-app", description: "The product" },
  { nameWithOwner: "example-owner/example-site", description: "" },
];

function write(contents: string | Uint8Array): string {
  const path = join(root, "repositories.json");
  writeFileSync(path, contents);
  return path;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "advisor-repository-card-cli-"));
  log = vi.spyOn(console, "log").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe("advisor-repository-card (#1179)", () => {
  it("prints the card for a listed file, with the current repository recommended first", () => {
    expect(main([write(JSON.stringify(LISTING)), "--current", "example-owner/example-site"])).toBe(0);
    const card = JSON.parse(String(log.mock.calls[0]?.[0])) as { recommendedChoiceId: string; choices: { id: string }[] };
    expect(card.recommendedChoiceId).toBe("example-owner/example-site");
    expect(card.choices.map((choice) => choice.id)).toEqual(["example-owner/example-site", "example-owner/example-app", "something-else"]);
  });

  it("reads JSON Lines, one entry per line, as the skill's gh api --jq ... | tojson command writes them", () => {
    const lines = `${LISTING.map((entry) => JSON.stringify(entry)).join("\n")}\n\n`;
    expect(main([write(lines), "--current", "example-owner/example-site"])).toBe(0);
    const card = JSON.parse(String(log.mock.calls[0]?.[0])) as { choices: { id: string }[] };
    expect(card.choices.map((choice) => choice.id)).toEqual(["example-owner/example-site", "example-owner/example-app", "something-else"]);
  });

  it("refuses a JSON Lines file with a bad line, naming the line and position, not the text", () => {
    const text = `${JSON.stringify(LISTING[0])}\n{"nameWithOwner": "example-owner/secret-name"\n`;
    expect(() => main([write(text)])).toThrow(/line 2 is not valid JSON at position \d+$/);
    expect(() => main([write(text)])).not.toThrow(/secret-name/);
    expect(() => main([write(new Uint8Array([0x7b, 0xff, 0x7d, 0x0a]))])).toThrow(/is not valid UTF-8/);
  });

  it("says only that the list given is empty (exit 1), for an empty file or an empty array, never what an account can see", () => {
    for (const contents of ["", "[]"]) {
      error.mockClear();
      expect(main([write(contents)])).toBe(1);
      expect(String(error.mock.calls[0]?.[0])).toBe("advisor-repository-card: the repository list given is empty, so there is nothing to choose from");
    }
  });

  it("claims nothing about an account it cannot see, in its usage or its card", () => {
    expect(USAGE).not.toMatch(/account can see|every repository|sign-in can reach/);
    expect(USAGE).toMatch(/Use the file only when that command exits 0/);
    expect(main([write(JSON.stringify(LISTING))])).toBe(0);
    const card = JSON.parse(String(log.mock.calls[0]?.[0])) as { somethingElseFollowUp: string };
    expect(card.somethingElseFollowUp).not.toMatch(/every|all of|can reach|can see/i);
  });

  it("builds the card without a recommendation when --current is not on the list", () => {
    expect(main([write(JSON.stringify(LISTING)), "--current", "example-owner/not-listed"])).toBe(0);
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).not.toHaveProperty("recommendedChoiceId");
  });

  it("names the exact listing command in its usage", () => {
    expect(USAGE).toContain(LIST_REPOSITORIES_COMMAND);
    expect(LIST_REPOSITORIES_COMMAND).toBe(
      "gh api --paginate 'user/repos?affiliation=owner,collaborator,organization_member&per_page=100' --jq '.[] | select(.archived | not) | {nameWithOwner: .full_name, description} | tojson'",
    );
  });

  it("prints the checked choice, in the card's order, ready for launcher --repositories", () => {
    expect(main([write(JSON.stringify(LISTING)), "--choose", "example-owner/example-site,example-owner/example-app"])).toBe(0);
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual({
      kind: "chosen",
      repositories: ["example-owner/example-app", "example-owner/example-site"],
      somethingElse: false,
    });
  });

  it("exits 1 for a choice the card did not offer, naming its position and not the id", () => {
    expect(main([write(JSON.stringify(LISTING)), "--choose", "example-owner/example-app,example-owner/unlisted-project"])).toBe(1);
    const message = String(error.mock.calls[0]?.[0]);
    expect(message).toMatch(/choice\[1\] is not one of the choices this card offered/);
    expect(message).not.toContain("unlisted-project");
    expect(log).not.toHaveBeenCalled();
  });

  it("refuses a malformed list (exit 2 in the executable) by position only", () => {
    const path = write(JSON.stringify([{ nameWithOwner: "example-owner/example-app" }, { nameWithOwner: "example-owner/hidden-name/x" }]));
    expect(() => main([path])).toThrow(AdvisorRepositoryCardCliInputError);
    try {
      main([path]);
    } catch (cause) {
      expect(String(cause)).toMatch(/listing\[1\]\.nameWithOwner must be a bare repository name or owner\/name/);
      expect(String(cause)).not.toContain("hidden-name");
    }
  });

  it("refuses a duplicate id in the list", () => {
    const path = write(JSON.stringify([...LISTING, { nameWithOwner: "EXAMPLE-OWNER/example-app" }]));
    expect(() => main([path])).toThrow(/listing\[2\]\.nameWithOwner names the same repository as listing\[0\]\.nameWithOwner/);
  });

  it("reads the file as strict JSON: a syntax error by position only, and a repeated key", () => {
    expect(() => main([write('[{"nameWithOwner": "example-owner/secret-name"')])).toThrow(/is not valid JSON at position \d+$/);
    expect(() => main([write('[{"nameWithOwner": "example-owner/secret-name"')])).not.toThrow(/secret-name/);
    expect(() => main([write('[{"nameWithOwner": "example-owner/a", "nameWithOwner": "example-owner/b"}]')])).toThrow(/repeats the key "nameWithOwner"/);
  });

  it("refuses unknown or repeated flags and a missing file", () => {
    const path = write(JSON.stringify(LISTING));
    expect(() => main([path, "--choose"])).toThrow(/only --current <owner\/name> and --choose/);
    expect(() => main([path, "--choose", "example-owner/example-app", "--choose", "example-owner/example-site"])).toThrow(/each once/);
    expect(() => main([path, "--limit", "5"])).toThrow(/only --current/);
    expect(() => main([])).toThrow(/exactly one repositories file/);
    expect(() => main([join(root, "absent.json")])).toThrow(/does not exist/);
  });
});
