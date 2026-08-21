/**
 * `passage.adversarial.test.ts` — the adversarial proof issue #373 itself
 * names: "A weaker tool that checks 'every referenced entry id exists'
 * passes a passage built entirely from inline literals, because it has no
 * references to check. The separating fixture is a passage with zero
 * references and real prose in it: the reference-checker reports clean,
 * this gate must exit 1."
 *
 * THE WEAKER TOOL NAMED, EXACTLY: a reference-existence checker. It reads
 * a `PassageRecord`, collects every `{ ref: "entry", id }` it finds across
 * every passage's every field, and reports OK as long as every collected
 * id is a non-empty string. It never asks whether a field is a REFERENCE
 * AT ALL — a plain string field is invisible to it, because there is no
 * `id` to check. That is exactly the gap the fixture below exploits: a
 * passage with a `title` field holding a literal sentence has zero
 * references, so the weak tool's own loop body never runs, and "zero
 * problems found" is indistinguishable, to it, from "everything is a
 * valid reference."
 *
 * BOTH ASSERTIONS RUN AGAINST THE IDENTICAL FIXTURE, IN THE SAME TEST:
 * asserting only "the real gate exits 1" proves nothing on its own — a
 * gate that always exits 1 would pass that alone. The adversarial claim
 * is comparative: the real gate and the weaker tool must DISAGREE on the
 * same input, with the real gate catching what the weaker tool misses.
 *
 * THE REAL GATE IS EXERCISED THE WAY IT ACTUALLY SHIPS: as the compiled
 * CLI (`writer-check passages <registry-file>`), spawned by ITS COMPILED
 * `dist/cli.js` PATH — never a plain function call standing in for the
 * CLI's own argv-to-exit-code contract, and never through an installed
 * `bin` name (see `cli.ts`'s own top doc comment for why this repository
 * invokes every gate by compiled path, and why dispatch is keyed on an
 * explicit `argv[0]` subcommand rather than on how the file was invoked).
 * Needs `npm run build` to have already produced `dist/`, the same
 * precondition `addressability.test.ts`'s own compiled-path suite and
 * `environment-conformance.adversarial.test.ts` (packages/designer) both
 * hold themselves to.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(packageRoot, "dist", "cli.js");

if (!existsSync(cliPath)) {
  throw new Error(
    `passage.adversarial.test.ts requires a built dist/ (run "npm run build" in ${packageRoot} first) — ` +
      "this suite spawns the REAL compiled CLI, by compiled path, the same way this repository invokes every gate.",
  );
}

let dir: string;
let registryPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "passage-adversarial-"));
  registryPath = join(dir, "passages.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * THE SEPARATING FIXTURE, exactly as issue #373 describes it: one passage,
 * zero references, real prose sitting directly in its fields. Nothing
 * here cites an entry id at all — the weak tool (below) has literally
 * nothing to check.
 */
function writeInlineLiteralFixture(): void {
  writeFileSync(
    registryPath,
    JSON.stringify(
      {
        id: "fixture-app",
        passages: [
          {
            id: "onboarding.empty-state",
            context: "onboarding empty-state card",
            fields: {
              title: "Nothing here yet.",
              body: "Once you add your first item, it will show up here.",
            },
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );
}

/**
 * A fixture where every field genuinely IS a well-formed `{ ref: "entry",
 * id }`/`{ ref: "term", term }` reference — the sanity-check case both
 * tools must agree is clean.
 */
function writeCleanFixture(): void {
  writeFileSync(
    registryPath,
    JSON.stringify(
      {
        id: "fixture-app",
        passages: [
          {
            id: "onboarding.empty-state",
            context: "onboarding empty-state card",
            fields: {
              title: { ref: "entry", id: "onboarding.empty-state.title" },
              body: { ref: "entry", id: "onboarding.empty-state.body" },
              action: { ref: "term", term: "get-started" },
            },
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );
}

/**
 * THE WEAKER TOOL: exactly what its name says, nothing more. Collects
 * every `{ ref: "entry", id }` across every passage/field and reports
 * clean as long as every collected id is a non-empty string — never asks
 * whether a field is a reference AT ALL. A `PassageRecord` with zero
 * references (the fixture above) walks this loop zero times and returns
 * 0, precisely because there is nothing for it to check.
 */
function referenceExistenceCheckerExitCode(registry: string): number {
  const record = JSON.parse(readFileSync(registry, "utf8")) as {
    passages?: Array<{ fields?: Record<string, unknown> }>;
  };
  const ids: unknown[] = [];
  for (const passage of record.passages ?? []) {
    for (const value of Object.values(passage.fields ?? {})) {
      if (value !== null && typeof value === "object" && (value as { ref?: unknown }).ref === "entry") {
        ids.push((value as { id?: unknown }).id);
      }
    }
  }
  const everyReferencedIdExists = ids.every((id) => typeof id === "string" && id.length > 0);
  return everyReferencedIdExists ? 0 : 1;
}

function runRealCli(registry: string): number {
  try {
    execFileSync(process.execPath, [cliPath, "passages", registry], { encoding: "utf8" });
    return 0;
  } catch (error) {
    const asExecError = error as { status?: number | null };
    if (typeof asExecError.status === "number") return asExecError.status;
    throw error;
  }
}

describe("adversarial proof: an inline-literal passage separates the real gate from a reference-existence checker", () => {
  it("the real gate (writer-check passages, by compiled dist/cli.js path) exits 1, while a reference-existence checker exits 0, on the identical inline-literal fixture, in this one test", () => {
    writeInlineLiteralFixture();

    const realGateExitCode = runRealCli(registryPath);
    const weakToolExitCode = referenceExistenceCheckerExitCode(registryPath);

    // The two tools must DISAGREE on the identical input — that
    // disagreement is the entire adversarial claim, not either exit code
    // read in isolation.
    expect(realGateExitCode).toBe(1);
    expect(weakToolExitCode).toBe(0);
    expect(realGateExitCode).not.toBe(weakToolExitCode);
  });

  it("sanity check: the weak tool is not simply broken — both tools agree (0) when every field truly is a valid reference", () => {
    writeCleanFixture();

    expect(referenceExistenceCheckerExitCode(registryPath)).toBe(0);
    expect(runRealCli(registryPath)).toBe(0);
  });
});
