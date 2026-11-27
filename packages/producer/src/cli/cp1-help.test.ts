/**
 * CP1-HELP: help, skill text and refusals tell a cold consumer agent the next command to type. One named test per
 * item tag of the cold receipts (cp1-cold1 section 4, cp1-cold2, cp1-cold3); each asserts the printed text. The craft
 * stage tests (c3-10, c3-11, c3-12) and the Writer verdict examples (c2-9) run in verdict.test.ts's worlds.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import "./main.js";
import { USAGE } from "./args.js";
import { CRITIQUE_USAGE } from "./critique.js";
import { GAPS_USAGE } from "./gaps.js";
import { NEXT_USAGE } from "./next.js";
import { runSeatCli, SEAT_USAGE, seatHolderFix } from "./owner.js";
import { PIN_USAGE } from "./pin.js";
import { RUN_USAGE } from "./run.js";
import { VERDICT_USAGE } from "./verdict.js";
import { LOOP_RUN_USAGE } from "../loop/cli.js";
import { buildCandidateHeader, candidatePath, serializeCandidate, slotDir, writeCandidateFile } from "../records/candidate.js";
import { writeTargetPin } from "../records/pin-map.js";
import { cliActor } from "../records/pin.js";
import { readPipelineSeats } from "../records/slot-model/pipeline-seats.js";
import { agentCreatesText, stockFilesOf } from "../records/code-adopt.js";
import { adoptDependencyPreview } from "../records/adopt-dependencies.js";
import { requirementsVerdictSync } from "../constitution/certify/requirements.js";

const PACKAGES = fileURLToPath(new URL("../../../", import.meta.url));
const FIXTURE = fileURLToPath(new URL("../../test-fixtures/consumer/", import.meta.url));
const AT = "2026-11-26T00:00:00Z";
const temps: string[] = [];
afterEach(() => { for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const temp = (prefix: string) => { const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix))); temps.push(dir); return dir; };
const text = (rel: string) => readFileSync(join(PACKAGES, rel), "utf8");

describe("CP1-HELP seat help and refusals", () => {
  it("c3-1 seat --help and run --help point to clossys slot producer/seat.<step> --full for the seat's prompt file", async () => {
    const help = await runSeatCli(["--help"], PACKAGES);
    expect(help.message).toBe(SEAT_USAGE);
    expect(SEAT_USAGE).toContain("its holder, model, tier and prompt file): clossys slot producer/seat.<step> --full");
    expect(RUN_USAGE).toContain("--explain names each step's decider, not its seat's model, tier or prompt file: clossys slot producer/seat.<step> --full prints those.");
  });

  it("c3-2 the help names --by the holder and --decided-by the approver, and a wrong-holder refusal prints the command to type", async () => {
    expect(SEAT_USAGE).toContain("--by: the seat's holder, who does the step: owner, planner or agent:<agent>.");
    expect(SEAT_USAGE).toContain("--decided-by: who approved this seat change");
    const root = temp("cp1-help-seat-");
    mkdirSync(join(root, "clossys"), { recursive: true });
    writeFileSync(join(root, "clossys", "clossys.config.ts"), "export default {};\n");
    const at = readPipelineSeats().seats["designer.candidates"]!;
    expect(at.llm!.promptFile).toMatch(/^packages\/designer\//);
    const argv = ["designer.candidates", "--by", "owner", "--decided-by", "planner:cp1-help", "--at", AT, "--root", root, "--model", "fixture-mid", "--tier", at.llm!.tier, "--prompt-file", at.llm!.promptFile];
    const refused = await runSeatCli(argv, root);
    expect(refused.exitCode).toBe(1);
    expect(refused.message).toMatch(/seat\.prompt-owner/);
    expect(refused.message).toContain(`the prompt file's agent holds the seat; type: clossys seat designer.candidates --by agent:designer --decided-by planner:cp1-help`);
    // A Producer prompt keeps its owner holder (pipeline/seats.json's own holder of the Producer prompts).
    expect(seatHolderFix(["ia", "--by", "agent:designer"], "packages/producer/actions/ia/skill.md")).toBe("clossys seat ia --by owner");
  });

  it("c2-1 the seat help and the Producer skill state the exact-tier rule", () => {
    expect(SEAT_USAGE).toContain("Exact tier: only the seat's model and tier may serve its step");
    expect(SEAT_USAGE).toContain("only the owner's seat verb (this one) changes a seat's model or tier");
    const skill = text("producer/skill/SKILL.md");
    expect(skill).toContain("Exact tier: only the seat's model and tier may serve its step");
    expect(skill).toContain("only the owner's `clossys seat` verb changes a seat's model or tier");
  });
});

describe("CP1-HELP pin help and the record refusal", () => {
  it("c2-2 PIN_USAGE states the file name with its extension, the --by forms and --confirm by an owner queue answer", () => {
    expect(PIN_USAGE).toContain("<candidate-file> is a file name in the slot's candidates/ with its extension (`hero-v2.json`, `copy-v1.md`)");
    expect(PIN_USAGE).toContain("without its extension is refused");
    expect(PIN_USAGE).not.toMatch(/or that name without its extension/);
    expect(PIN_USAGE).toContain("owner:queue.<kind>#<id>");
    expect(PIN_USAGE).toContain("code:scorecard");
    expect(PIN_USAGE).toContain("A bare --by owner is refused");
    expect(PIN_USAGE).toMatch(/--confirm[^\n]*--by owner:queue\.<kind>#<id>/);
  });

  it("c3-13 pin refusal lists the record names and how they map from the contract record key", () => {
    const root = temp("cp1-help-pin-");
    for (const agent of ["designer", "writer", "publisher", "producer"]) {
      mkdirSync(join(root, "packages", agent), { recursive: true });
      writeFileSync(join(root, "packages", agent, "package.json"), JSON.stringify({ name: `@clossys/${agent}`, version: "1.2.3" }));
    }
    const slotId = "publication.site.meta";
    const file = join(slotDir(root, "writer", slotId), "slot.json");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ schema: "clossys.slot/2", id: `writer/${slotId}`, agent: "writer", kind: "copy", status: "open", contract: { records: { "site.meta": {} } } }));
    const name = "meta-v1.md";
    const header = buildCandidateHeader({ agent: "writer", slotId, name, createdBy: { actor: "planner", ref: "test" }, createdAt: AT, source: { kind: "original", ref: [] }, record: "meta" });
    const path = candidatePath(root, "writer", slotId, name);
    mkdirSync(dirname(path), { recursive: true });
    writeCandidateFile(path, serializeCandidate(name, header, "title: fixture\n"));
    let message = "";
    try { writeTargetPin(root, { agent: "writer", slotId, candidate: name, decidedBy: "planner", basis: "planner", at: AT, createdBy: cliActor("clossys pin") }); } catch (error) { message = (error as Error).message; }
    expect(message).toContain(`writer/${slotId} pins per record: name one (writer/${slotId}#<record>)`);
    expect(message).toContain("records: meta, site.meta");
    expect(message).toContain("the slot leaf meta (next --submit's default name, meta-v<n>)");
    expect(message).toContain("a contract records key (site.meta) named with next --submit --name <key>");
  });
});

describe("CP1-HELP verdict, craft and status help", () => {
  it("c3-7 the verdict help maps the Designer rungs against the Writer's and names the create verdict first", () => {
    expect(VERDICT_USAGE).toContain("Rungs: Designer L1 and L2 = adopt (no verdict), L3 = adapt, L4 = create; the Writer's rungs are adopt, adapt and create.");
    expect(VERDICT_USAGE).toContain("needs a create verdict first (P2)");
  });

  it("c3-9 clossys --help lists critique and next --stage gives the Writer create order", () => {
    expect(USAGE).toMatch(/\nCritique: clossys critique-packet <agent>\/<slot> [^\n]*clossys critique <agent>\/<slot> --record <file>/);
    expect(NEXT_USAGE).toContain("Writer create order: clossys verdict (a create), then next --stage\n  brief, next --stage diverge --file <directions.json>, next --stage render --file <renders.json>, clossys critique-packet\n  and clossys critique --record, then next --submit --rung create.");
  });

  it("c3-10 critique --help says what the packet must hash and where to read the hashes", () => {
    expect(CRITIQUE_USAGE).toContain("The packet manifest must hash: taste.md");
    expect(CRITIQUE_USAGE).toContain("clossys critique-packet prints\n  them (role, ref, sha256), so the critic never opens package files.");
  });

  it("c2-12 gaps help says what unclear means for a Director cell and that it blocks no pin", () => {
    expect(GAPS_USAGE).toContain("\"unclear\" on a Director cell");
    expect(GAPS_USAGE).toContain("it blocks\n  no pin");
  });

  it("c2-13 check help says --suites and --slots exit 1 while any slot is unpinned, and names the one-slot scope", () => {
    expect(USAGE).toMatch(/Slots: clossys check [^\n]*exits 1 while any slot anywhere is unpinned/);
    expect(USAGE).toMatch(/Record suites: clossys check --suites [^\n]*exits 1 while any slot anywhere is unpinned: scope to one slot with clossys check --constitution --slot <agent>\/<slot>/);
  });

  it("c1-12 run --help says what --step-exit 0, 1 and 2 mean and how to close a blocked run", () => {
    for (const usage of [RUN_USAGE, LOOP_RUN_USAGE]) {
      expect(usage).toMatch(/0 the step did its work and the run moves on; 1 it ran and found a problem/);
      expect(usage).toMatch(/2 it could not\s+run at all/);
      expect(usage).toContain("To close a blocked run you cannot finish:");
      expect(usage).toContain("--step-exit 2 --model <serving model>");
    }
  });

  it("c3-16 the Writer skill says a publication.*.meta slot cites the voice in its reason and the guard accepts it", () => {
    const skill = text("writer/skill/SKILL.md");
    expect(skill).toContain("A `publication.*.meta` slot does not declare the voice as an input.");
    expect(skill).toMatch(/provenance\.voice/);
    expect(skill).toMatch(/guard accepts/);
  });
});

describe("CP1-HELP images exemplar", () => {
  it("the assets.image exemplar passes asset.media-rule", () => {
    const bytes = text("designer/recipes/create.element/exemplars/assets.image.json");
    const item = JSON.parse(bytes) as { files: { content: string }[]; meta: { source: { kind: string; license: string } } };
    const image = JSON.parse(item.files[0]!.content) as Record<string, unknown>;
    expect(image).toMatchObject({ kind: "illustration", width: 160, height: 90 });
    expect(String(image.src)).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(Buffer.from(String(image.src).split(",")[1]!, "base64").toString("utf8")).toMatch(/^<svg /);
    expect(typeof image.alt).toBe("string");
    expect(item.meta.source).toMatchObject({ kind: "original", license: "CC0-1.0" });
    const standard = JSON.parse(text("designer/standards/asset.media-rule/requirements.json")) as { requirements: unknown[] };
    const verdict = requirementsVerdictSync({ candidate: { name: "image-v1.json", bytes }, kind: "element/asset", standard: { id: "asset.media-rule", sha256: "fixture", requirements: standard.requirements as never }, contract: {}, pinSet: "fixture" });
    expect(verdict.results.filter(result => !result.pass)).toEqual([]);
    expect(verdict.pass).toBe(true);
  });
});

describe("CP1-HELP the CP1-PKGS review notes", () => {
  const fixture = () => { const root = temp("cp1-help-pkgs-"); cpSync(FIXTURE, root, { recursive: true }); return root; };

  it("PKGS-a the verdict pointer names the required --model, --tier and --by flags", () => {
    expect(agentCreatesText("designer/components.button")).toContain("clossys verdict designer/components.button --record <file> --model <id> --tier <tier> --by agent:<seat>");
  });

  it("PKGS-b a crafted stock slot's dependency plan reads its files without the theme reader", () => {
    const root = fixture();
    const found = stockFilesOf(root, "frames.app-header", { themeReader: false });
    if ("none" in found) throw new Error(found.none);
    expect(found.reader).toBeUndefined();
    expect(found.files.length).toBeGreaterThan(0);
  });

  it("PKGS-c a components slot that holds candidates names the next command", () => {
    const root = fixture();
    const preview = adoptDependencyPreview(root, "designer", "components.button");
    expect("skip" in preview && preview.skip).toMatch(/holds .*; next: the agent creates|holds .*; next: .*clossys verdict designer\/components\.button --record <file> --model <id> --tier <tier> --by agent:<seat>/);
    expect("skip" in preview && preview.skip).toContain("or retire the held candidates (clossys retire designer/components.button <candidate> --by <who> --reason <code>) so code adopts");
  });
});
