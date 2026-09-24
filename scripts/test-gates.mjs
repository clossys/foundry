#!/usr/bin/env node
// test-gates — regression tests for the publish-safety gates themselves.
//
//   node scripts/test-gates.mjs [--verbose]
//
// Exit 0 = every gate behaves as specified. Exit 1 = a gate regressed.
//
// WHY THIS EXISTS
// ---------------
// The gates are the only thing standing between an unreviewed working tree and an
// irreversible public disclosure, and until now they had no tests at all. A
// gate with no tests is a gate that rots silently: every rule here is one
// refactor away from matching nothing and still exiting 0, which looks
// identical to "clean" from CI.
//
// Each case below is a NEGATIVE test — it plants something that must be caught
// and asserts the gate catches it. A gate that passes its own positive case
// proves very little; a gate that fails to catch planted contamination is the
// only failure mode that matters.
//
// Fixtures are built in a temp directory and torn down. Nothing here writes to
// the repository, and no fixture contains a real credential — the secret-shaped
// strings are structurally valid but issued by no one.
//
// Cases marked KNOWN-GAP document behaviour that is currently wrong. They assert
// the CURRENT behaviour so the suite stays green, and they name what should
// change. Deleting a KNOWN-GAP case without fixing the underlying rule is how a
// known hole becomes an unknown one.

import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, cpSync, existsSync, chmodSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import zlib from "node:zlib";

import { publishQualifiedDirectory } from "./publish-qualified-directory.mjs";
import { ReproducibilityMismatch, assertTarballReproducible, cleanRebuildAndPack, packAsIs } from "./lib/artifact-reproducibility.mjs";
import { packageManifestDigest } from "./lib/candidate-qualification.mjs";
import { ALL_PACKAGE_RELEASE_ORDER } from "./check-release-catalog.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..");
const verbose = process.argv.includes("--verbose");

// Fixture packages are named under a scope that appears in no denylist term, so
// a fixture's own name can never be the thing a case trips over. The collision
// gate is the one exception — it must use the real scope, because it is
// specifically checking names under the real registry owner.
const FIXTURE_SCOPE = "@gate-fixture";

// This suite runs against a SYNTHETIC denylist, never the real one.
//
// Two reasons, and the second is the load-bearing one:
//   1. Hermetic. The tests assert the gate's MECHANISM — that an identity term
//      matches, that neutralize confines to its paths — which needs some terms,
//      not the real terms. Real terms would make these tests fail whenever the
//      denylist is edited for unrelated reasons.
//   2. This file lives in a public repository and is scanned by the very gate
//      it tests. Hardcoding real denylist terms as fixtures would commit, in
//      plaintext, exactly the strings the denylist exists to keep out — the
//      same reason the real denylist is not in this repo. (Caught the honest
//      way: an earlier draft of this file did precisely that and the gate
//      rejected it.)
//
// Properties of the REAL denylist are checked separately by
// check-denylist-quality.mjs, which reads it without ever echoing a term.
const SYNTH_DENYLIST = {
  version: "synthetic-test",
  terms: [
    { pattern: "acme-corp", why: "synthetic sibling product", severity: "high" },
    { pattern: "zeta\\.example", why: "synthetic product domain", severity: "high" },
    { pattern: "quux(-|\\.| )corp", why: "synthetic separated name", severity: "medium" },
  ],
  neutralize: [
    { pattern: "@gate-fixture/acme-corp-allowed", paths: ["allowed.md"] },
  ],
};

const SAFETY = join(scriptDir, "check-public-safety.mjs");
const ARTIFACT = join(scriptDir, "check-artifact-safety.mjs");
const COLLISION = join(scriptDir, "check-name-collision.mjs");
const PUBLIC_NPM_REGISTRY_LIB = join(scriptDir, "lib", "public-npm-registry.mjs");
const PACKAGE_IDENTITY_TRANSITION_LIB = join(scriptDir, "lib", "package-identity-transition.mjs");
const LEGACY_PACKAGE_REGISTRY = ["https://npm", "pkg", "github", "com"].join(".");
const CONTAM = join(scriptDir, "check-contamination-classes.mjs");
const QUALITY = join(scriptDir, "check-denylist-quality.mjs");
const SET_SCOPE = join(scriptDir, "set-scope.mjs");
const SET_REGISTRY = join(scriptDir, "set-registry.mjs");
const SET_PREPUBLISH_HOOK = join(scriptDir, "set-prepublish-hook.mjs");
const ROOT_README = join(scriptDir, "check-root-readme-parity.mjs");
const TYPECHECKED = join(scriptDir, "check-typechecked-assertions.mjs");
const COMMIT_MESSAGES = join(scriptDir, "check-commit-messages.mjs");
const CONVERSATION = join(scriptDir, "check-conversation-safety.mjs");
const FOREIGN_REFS = join(scriptDir, "check-foreign-references.mjs");

let passed = 0;
let skipped = 0;
const failures = [];

function run(cmd, args, opts = {}) {
  // execFileSync's `input` option is documented to "override stdio[0]", but
  // in practice an explicit stdio[0] of "ignore" wins instead and `input` is
  // silently dropped — verified empirically, not from the docs alone. Every
  // existing caller here relies on stdin being ignored (none of the other
  // ~150 cases in this file pass `input`), so stdio only switches to fully
  // piped when a case actually supplies `input` — this can't change behavior
  // for any case that doesn't.
  const stdio = opts.input !== undefined ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"];
  // maxBuffer well above Node's 1 MiB default, because this harness has to be
  // able to observe the very outputs most likely to be mishandled. A --json
  // report over a large fixture runs to megabytes; at the default, execFileSync
  // raises ENOBUFS and the catch below returns a TRUNCATED stdout, so a test
  // asserting on that output would be judging a fragment while looking like it
  // read the whole thing. That failure mode is indistinguishable from the
  // product bug these large-output cases exist to detect.
  try {
    const stdout = execFileSync(cmd, args, { encoding: "utf8", stdio, maxBuffer: 1 << 28, ...opts });
    return { code: 0, out: stdout };
  } catch (error) {
    return { code: error.status ?? 1, out: (error.stdout ?? "") + (error.stderr ?? "") };
  }
}

function check(name, condition, detail) {
  if (condition) {
    passed++;
    if (verbose) console.log(`  ok   ${name}`);
  } else {
    failures.push({ name, detail });
    console.log(`  FAIL ${name}\n         ${detail}`);
  }
}

// --------------------------------------------------- opaque fixture builders
//
// Built from bytes, not downloaded: a real sample PDF/PNG off the internet
// would (a) not be reproducible/hermetic and (b) not let a case control
// exactly where the planted synthetic identity term sits (plain vs. behind
// zlib). Neither fixture needs to be a fully spec-valid file — the gate under
// test never parses PDF/PNG structure, it walks raw bytes — but the PNG is
// built with a real CRC32 anyway so it is legible as an actual minimal PNG.

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

// A minimal, structurally real 1x1 truecolor PNG carrying a tEXt chunk —
// PNG's own plaintext metadata chunk type — whose payload is `text`.
function buildPngWithText(keyword, text) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(1, 0); // width
  ihdrData.writeUInt32BE(1, 4); // height
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type: truecolor
  const ihdr = pngChunk("IHDR", ihdrData);
  const tEXt = pngChunk("tEXt", Buffer.concat([Buffer.from(keyword, "ascii"), Buffer.from([0]), Buffer.from(text, "ascii")]));
  const idat = pngChunk("IDAT", zlib.deflateSync(Buffer.from([0, 255, 0, 0]))); // filter byte + one RGB pixel
  const iend = pngChunk("IEND", Buffer.alloc(0));
  return Buffer.concat([sig, ihdr, tEXt, idat, iend]);
}

// A random-noise "PNG" with no embedded text at all — used to prove refusal
// does not depend on the best-effort extractor finding anything: an opaque
// file with no readable planted content must still be refused when
// unacknowledged, because this gate can never prove a negative about a
// format it does not fully parse.
function buildOpaqueNoise(byteLength) {
  const buf = Buffer.alloc(byteLength);
  for (let i = 0; i < byteLength; i++) buf[i] = (i * 137 + 41) % 256; // deterministic, non-printable-heavy
  return buf;
}

// A minimal PDF whose page-content stream is real zlib/FlateDecode — the
// compression nearly every real PDF writer applies to page text — with
// `text` drawn via a `Tj` show-text operator. The rest of the object graph
// (xref table, etc.) is intentionally not spec-complete: the gate under test
// never parses PDF structure, only finds `stream ... endstream` blocks whose
// nearest preceding dictionary mentions /FlateDecode and inflates them.
function buildFlateDecodePdf(text) {
  const contentStream = Buffer.from(`BT /F1 12 Tf 72 712 Td (${text}) Tj ET`, "latin1");
  const compressed = zlib.deflateSync(contentStream);
  const parts = [
    "%PDF-1.4\n",
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n",
    `4 0 obj\n<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`,
  ].map((s) => Buffer.from(s, "latin1"));
  const tail = ["\nendstream\nendobj\n", "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n", "trailer\n<< /Root 1 0 R /Size 6 >>\n%%EOF\n"].map(
    (s) => Buffer.from(s, "latin1"),
  );
  return Buffer.concat([...parts, compressed, ...tail]);
}

function gitInit(dir) {
  run("git", ["-C", dir, "init", "-q"]);
  run("git", ["-C", dir, "add", "-A"]);
  run("git", ["-C", dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "fixture"]);
}

// A package directory this fixture repository ONCE HAD and has since retired.
// check-contamination-classes CLASS 1 only claims rot for a `packages/<dir>/…`
// citation when `<dir>` names a package the repository has or ever had — the
// test that separates a retired donor from an illustrative placeholder naming
// the reader's own tree. A fixture that wants the rot half has to supply the
// history that makes the claim true, rather than relying on the citation's
// SHAPE, which is the thing that turned out not to separate them.
//
// Call after gitInit: the manifest is committed and then deleted, which is
// what retirement actually looks like in git.
function gitRetirePackageDir(dir, name) {
  const pkgDir = join(dir, "packages", name);
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(
    join(pkgDir, "package.json"),
    JSON.stringify({ name: `${FIXTURE_SCOPE}/${name}`, version: "0.0.1" }, null, 2) + "\n",
  );
  run("git", ["-C", dir, "add", "-A"]);
  run("git", ["-C", dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", `fixture: add ${name}`]);
  rmSync(pkgDir, { recursive: true, force: true });
  run("git", ["-C", dir, "add", "-A"]);
  run("git", ["-C", dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", `fixture: retire ${name}`]);
}

const work = mkdtempSync(join(tmpdir(), "gate-tests-"));
const synthPath = join(work, "synth-denylist.json");
writeFileSync(synthPath, JSON.stringify(SYNTH_DENYLIST, null, 2));
// Every gate invocation in this suite uses the synthetic list.
const DL = ["--denylist", synthPath];

// check-commit-messages.mjs validates its historical-exceptions file
// UNCONDITIONALLY, before it even looks at the denylist — so every fixture
// invocation below needs a *valid* exceptions file, or every one of them
// would fail for a reason that has nothing to do with what it is actually
// testing. This one is deliberately empty: none of these fixture commits
// are real repository history, so none of them could ever be validly
// admitted by an exception (see the dedicated exception-mechanism cases
// further down, which build their own fixture-specific exceptions files).
const emptyExceptionsPath = join(work, "empty-exceptions.json");
writeFileSync(
  emptyExceptionsPath,
  JSON.stringify({ $comment: "test fixture — no historical exceptions", schemaVersion: 1, sealedAtCommit: "0".repeat(40), exceptions: [] }),
);
const EX = ["--exceptions", emptyExceptionsPath];

try {
  // ---------------------------------------------------------------- secrets
  console.log("\n# credential-shaped strings");
  {
    const dir = join(work, "secrets");
    mkdirSync(dir, { recursive: true });
    // Structurally valid, issued by nobody — and assembled from fragments at
    // run time so that no complete credential-shaped string is ever a literal in
    // this file. Written out whole, each of these would (correctly) trip the
    // gate on the gate's own test suite.
    const planted = [
      ["anthropic", "sk-" + "ant-" + "A".repeat(24)],
      ["openai", "sk" + "-" + "B".repeat(28)],
      ["github-pat", "ghp" + "_" + "C".repeat(28)],
      ["aws", "AKI" + "A" + "D".repeat(16)],
      ["stripe-live", "sk_" + "live_" + "E".repeat(16)],
      ["slack", "xox" + "b-" + "1".repeat(16)],
      ["db-url", "postgre" + "s://u:p@h:5432/d"],
      ["private-key", "-----BEGIN " + "RSA PRIVATE KEY" + "-----"],
    ];
    for (const [label, value] of planted) {
      writeFileSync(join(dir, `${label}.js`), `const x = ${JSON.stringify(value)};\n`);
    }
    gitInit(dir);
    const r = run("node", [SAFETY, dir, ...DL, "--require-denylist", "--json"]);
    let report;
    try { report = JSON.parse(r.out); } catch { report = { failures: [] }; }
    for (const [label] of planted) {
      const hit = (report.failures ?? []).some((f) => f.kind === "SECRET" && f.rel === `${label}.js`);
      check(`catches ${label}`, hit, `no SECRET finding for ${label}.js`);
    }
    const leaked = (report.failures ?? []).some((f) => f.kind === "SECRET" && f.text && f.text !== "<redacted>");
    check("never echoes a matched secret", !leaked, "a SECRET finding carried the raw matching line");
  }

  // -------------------------------------------------------- forbidden files
  console.log("\n# forbidden files");
  {
    const dir = join(work, "forbidden");
    mkdirSync(join(dir, ".claude"), { recursive: true });
    mkdirSync(join(dir, "packages", "example"), { recursive: true });
    writeFileSync(join(dir, ".claude", "settings.json"), "{}\n");
    writeFileSync(join(dir, "packages", "example", "CLAUDE.md"), "# internal\n");
    writeFileSync(join(dir, ".env"), "TOKEN=x\n");
    writeFileSync(join(dir, ".npmrc"), "//r/:_authToken=x\n");
    writeFileSync(join(dir, "CONSUMPTION.json"), "{}\n");
    gitInit(dir);
    // .gitignore is absent so nothing is skipped as ignored.
    const r = run("node", [SAFETY, dir, ...DL, "--require-denylist", "--json"]);
    let report;
    try { report = JSON.parse(r.out); } catch { report = { failures: [] }; }
    for (const f of [".claude/settings.json", "packages/example/CLAUDE.md", ".env", ".npmrc", "CONSUMPTION.json"]) {
      const hit = (report.failures ?? []).some((x) => x.kind === "forbidden-file" && x.rel === f);
      check(`refuses ${f}`, hit, `no forbidden-file finding for ${f}`);
    }
  }

  // ------------------------------------------------------------ fail-closed
  console.log("\n# fail-closed behaviour");
  {
    const dir = join(work, "failclosed");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "a.md"), "clean\n");
    gitInit(dir);

    const missing = run("node", [SAFETY, dir, "--require-denylist", "--denylist", "/nonexistent/dl.json"]);
    check("--require-denylist exits 2 when the denylist is missing", missing.code === 2, `exit was ${missing.code}`);

    const partial = run("node", [SAFETY, dir, "--denylist", "/nonexistent/dl.json"]);
    check("PARTIAL mode exits 0 but never claims a bare PASS", partial.code === 0 && /PASS \(partial\)/.test(partial.out), "expected an explicitly-partial PASS");
    check("PARTIAL mode prints a visible banner", /PARTIAL SCAN/.test(partial.out), "no PARTIAL SCAN banner");
    check("PARTIAL mode says a pass is not a clearance", /does NOT clear/i.test(partial.out), "banner did not disclaim clearance");
  }

  // ---------------------------------------- npm lock integrity normalization
  console.log("\n# npm lock integrity normalization");
  {
    const dir = join(work, "lock-integrity");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "package-lock.json"),
      JSON.stringify({ lockfileVersion: 3, packages: { "node_modules/example": { integrity: "sha512-acme-corp" } } }, null, 2) + "\n",
    );
    gitInit(dir);
    const r = run("node", [SAFETY, dir, ...DL, "--require-denylist"]);
    check(
      "does not treat an opaque npm integrity hash as identity prose",
      r.code === 0,
      `lock integrity fixture exited ${r.code}: ${r.out.slice(0, 200)}`,
    );
  }

  // --------------------------------------------------------- opaque content
  //
  // Issue #588: PDF/image/font/video/wasm formats used to be silently
  // skipped (SKIP_CONTENT -> `continue`, no bytes ever opened) while both
  // this gate and check-artifact-safety.mjs's pass banner claimed the
  // COMPLETE tree/tarball carried no private identity or credential-shaped
  // content. That claim was never actually checked for these formats. Fixed
  // shape: opaque files are refused by default (fail closed), extracted
  // best-effort via deterministic printable-string/PDF-inflate scanning
  // regardless, and pass only with an explicit sha256-pinned exemption in
  // governance/opaque-content-exemptions.json.
  console.log("\n# opaque content (issue #588)");
  {
    // (a) The core fix: an opaque file with NO findable planted content
    // must still be refused when unacknowledged. This is deliberately
    // content-empty so it cannot pass "by accident" via the best-effort
    // extractor finding nothing — refusal here can only come from the
    // fail-closed default itself, which is exactly what regressed to a
    // silent skip before this fix.
    const dir = join(work, "opaque-noise");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "asset.png"), buildOpaqueNoise(256));
    gitInit(dir);
    const r = run("node", [SAFETY, dir, ...DL, "--require-denylist", "--json"]);
    let report;
    try { report = JSON.parse(r.out); } catch { report = { failures: [] }; }
    const hit = (report.failures ?? []).some((f) => f.kind === "opaque-unacknowledged" && f.rel === "asset.png");
    check(
      "an unacknowledged opaque file with no findable content is still refused, not silently passed",
      r.code === 1 && hit,
      `expected exit 1 with an opaque-unacknowledged finding for asset.png, got ${r.code}: ${r.out.slice(0, 600)}`,
    );
  }
  {
    // (b) Plaintext metadata: a PNG tEXt chunk carrying a denylisted term in
    // raw ASCII must be caught by the printable-strings extractor, not just
    // refused as unacknowledged.
    const dir = join(work, "opaque-png-text");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "logo.png"), buildPngWithText("Author", "made by acme-corp"));
    gitInit(dir);
    const r = run("node", [SAFETY, dir, ...DL, "--require-denylist", "--json"]);
    let report;
    try { report = JSON.parse(r.out); } catch { report = { failures: [] }; }
    const identityHit = (report.failures ?? []).some((f) => f.kind === "identity" && f.rel === "logo.png");
    const unackHit = (report.failures ?? []).some((f) => f.kind === "opaque-unacknowledged" && f.rel === "logo.png");
    check(
      "a denylisted term inside a PNG tEXt chunk is caught by printable-string extraction",
      r.code === 1 && identityHit,
      `expected an identity finding for logo.png, got ${r.code}: ${r.out.slice(0, 600)}`,
    );
    check(
      "the same unacknowledged PNG is also refused as opaque, independent of the content match",
      unackHit,
      `expected an opaque-unacknowledged finding for logo.png alongside the identity finding`,
    );
  }
  {
    // (c) Compressed content: a PDF whose page-content stream is
    // /FlateDecode (how nearly every real PDF writer stores text) must have
    // that stream inflated and scanned — a raw printable-strings pass alone
    // would see only zlib-compressed bytes and miss it entirely.
    const dir = join(work, "opaque-pdf-flate");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "report.pdf"), buildFlateDecodePdf("Prepared for acme-corp"));
    gitInit(dir);
    const r = run("node", [SAFETY, dir, ...DL, "--require-denylist", "--json"]);
    let report;
    try { report = JSON.parse(r.out); } catch { report = { failures: [] }; }
    const identityHit = (report.failures ?? []).some((f) => f.kind === "identity" && f.rel === "report.pdf");
    check(
      "a denylisted term inside a PDF's FlateDecode content stream is caught by the inflate extractor",
      r.code === 1 && identityHit,
      `expected an identity finding for report.pdf, got ${r.code}: ${r.out.slice(0, 600)}`,
    );
  }
  {
    // (d)+(e) The exemption mechanism: sha256-pinned, mirroring
    // check-package-evidence.mjs's `gaps` (reason + issue, and an
    // acknowledgement that cannot outlive what it was reviewed against —
    // here enforced by the hash rather than by re-derived evidence).
    const dir = join(work, "opaque-exempt");
    mkdirSync(dir, { recursive: true });
    const bytes = buildOpaqueNoise(128);
    writeFileSync(join(dir, "font.woff"), bytes);
    gitInit(dir);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const exemptPath = join(work, "opaque-exempt-registry.json");
    writeFileSync(
      exemptPath,
      JSON.stringify({
        schemaVersion: 1,
        exemptions: [{ path: "font.woff", sha256, reason: "Inert synthetic test font fixture, byte-reviewed by hand.", issue: 588 }],
      }),
    );
    const ok = run("node", [SAFETY, dir, ...DL, "--require-denylist", "--opaque-exemptions", exemptPath, "--json"]);
    let okReport;
    try { okReport = JSON.parse(ok.out); } catch { okReport = { failures: [] }; }
    const okHit = (okReport.failures ?? []).some((f) => f.rel === "font.woff");
    check(
      "a sha256-pinned exemption lets an otherwise-refused opaque file pass",
      ok.code === 0 && !okHit,
      `expected exit 0 with no finding for font.woff, got ${ok.code}: ${ok.out.slice(0, 600)}`,
    );

    // Mutate the file after exemption: the exemption must not outlive the
    // exact bytes it was reviewed against.
    writeFileSync(join(dir, "font.woff"), Buffer.concat([bytes, Buffer.from([0])]));
    const stale = run("node", [SAFETY, dir, ...DL, "--require-denylist", "--opaque-exemptions", exemptPath, "--json"]);
    let staleReport;
    try { staleReport = JSON.parse(stale.out); } catch { staleReport = { failures: [] }; }
    const staleHit = (staleReport.failures ?? []).some((f) => f.kind === "opaque-unacknowledged" && f.rel === "font.woff");
    check(
      "an exemption does not outlive the bytes it was reviewed against — a changed file is refused again",
      stale.code === 1 && staleHit,
      `expected exit 1 with opaque-unacknowledged for the mutated font.woff, got ${stale.code}: ${stale.out.slice(0, 600)}`,
    );
  }
  {
    // (f) A malformed exemption entry must be a loud, visible failure of its
    // own — never a silent no-op that could be mistaken for "no exemptions
    // configured" while actually meaning "this reviewer forgot the reason".
    const dir = join(work, "opaque-exempt-invalid");
    mkdirSync(dir, { recursive: true });
    const bytes = buildOpaqueNoise(64);
    writeFileSync(join(dir, "clip.mp4"), bytes);
    gitInit(dir);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const exemptPath = join(work, "opaque-exempt-invalid-registry.json");
    writeFileSync(exemptPath, JSON.stringify({ schemaVersion: 1, exemptions: [{ path: "clip.mp4", sha256, issue: 588 }] })); // no `reason`
    const r = run("node", [SAFETY, dir, ...DL, "--require-denylist", "--opaque-exemptions", exemptPath, "--json"]);
    let report;
    try { report = JSON.parse(r.out); } catch { report = { failures: [] }; }
    const invalidHit = (report.failures ?? []).some((f) => f.kind === "opaque-exemption-invalid");
    const stillRefused = (report.failures ?? []).some((f) => f.kind === "opaque-unacknowledged" && f.rel === "clip.mp4");
    check(
      "an exemption entry missing a reason is reported as its own invalid-exemption finding",
      r.code === 1 && invalidHit,
      `expected an opaque-exemption-invalid finding, got ${r.code}: ${r.out.slice(0, 600)}`,
    );
    check(
      "a file covered only by an invalid exemption entry stays refused, not silently granted",
      stillRefused,
      `expected clip.mp4 to still be opaque-unacknowledged despite the (invalid) exemption entry`,
    );
  }
  {
    // The honest-claim requirement: the PASS banner must not claim a bare
    // "no private identity found" when opaque content was present and only
    // checked via best-effort extraction plus a reviewed exemption.
    const dir = join(work, "opaque-pass-wording");
    mkdirSync(dir, { recursive: true });
    const bytes = buildOpaqueNoise(64);
    writeFileSync(join(dir, "icon.ico"), bytes);
    gitInit(dir);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const exemptPath = join(work, "opaque-pass-wording-registry.json");
    writeFileSync(
      exemptPath,
      JSON.stringify({ schemaVersion: 1, exemptions: [{ path: "icon.ico", sha256, reason: "Synthetic inert icon fixture, byte-reviewed by hand.", issue: 588 }] }),
    );
    const r = run("node", [SAFETY, dir, ...DL, "--require-denylist", "--opaque-exemptions", exemptPath]);
    check("a pass with an acknowledged opaque file present still exits 0", r.code === 0, `exited ${r.code}: ${r.out.slice(0, 400)}`);
    check(
      "the pass banner names the opaque file count and points at the exemption registry rather than claiming a blanket clean tarball",
      /1 opaque file/.test(r.out) && /opaque-content-exemptions\.json/.test(r.out),
      `pass banner did not narrow its claim for opaque content: ${r.out.slice(0, 600)}`,
    );
  }

  // ---------------------------- check-public-safety: a stray NUL byte must
  // not switch the scan off for a whole file. The ordinary `if (contents has
  // a NUL) continue` binary heuristic does exactly that, and it is not
  // hypothetical: scripts/check-contamination-classes.mjs embeds a literal
  // NUL as the needle of its own identical binary check, and an earlier
  // version of THIS gate skipped that file wholesale as a result — the same
  // file a real identity leak later shipped in and survived a FULL-mode scan
  // (see check-foreign-references's identical regression case above for the
  // sibling gate this was first caught in).
  console.log("\n# check-public-safety: a stray NUL byte does not make a whole file invisible to the scan");
  {
    const dir = join(work, "safety-nul-byte");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "notes.md"),
      ["# notes", "", `A binary sentinel: "${String.fromCharCode(0)}" is one NUL.`, "Mentions acme-corp in passing.", ""].join("\n"),
      "utf8",
    );
    gitInit(dir);
    const r = run("node", [SAFETY, dir, ...DL, "--require-denylist", "--json"]);
    let report;
    try { report = JSON.parse(r.out); } catch { report = { failures: [] }; }
    const hit = (report.failures ?? []).some((f) => f.kind === "identity" && f.rel === "notes.md");
    check(
      "a denylisted term after a stray NUL is still caught",
      r.code === 1 && hit,
      `expected exit 1 with an identity finding for notes.md, got ${r.code}: ${r.out.slice(0, 600)}`,
    );
  }

  // -------------------- check-contamination-classes: same NUL-byte hardening
  // check-contamination-classes.mjs had the identical `if (contents has a
  // NUL) continue` heuristic, applied to the exact file that motivated this
  // whole class of fix -- this file, before its own literal NUL byte was
  // replaced with a \u0000 escape. Proven directly against a fixture
  // rather than against the script's own source, so the case still holds
  // after that byte is gone.
  console.log("\n# check-contamination-classes: a stray NUL byte does not make a whole file invisible to the scan");
  {
    const dir = join(work, "contam-nul-byte");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "@clossys/probe", version: "1.0.0" }, null, 2) + "\n");
    writeFileSync(
      join(dir, "notes.md"),
      ["# notes", "", `A binary sentinel: "${String.fromCharCode(0)}" is one NUL.`, "See KIT-CONVENTIONS.md for the house rules.", ""].join("\n"),
      "utf8",
    );
    const r = run("node", [CONTAM, dir, "--class", "1", "--json"]);
    let report;
    try { report = JSON.parse(r.out); } catch { report = { findings: [] }; }
    const hit = (report.findings ?? []).some((x) => x.file === "notes.md");
    check(
      "a dangling internal doc citation after a stray NUL is still caught",
      r.code === 1 && hit,
      `expected exit 1 naming notes.md, got ${r.code}: ${JSON.stringify(report.findings)}`,
    );
  }

  // ------------------------------- check-contamination-classes: fail-closed
  console.log("\n# check-contamination-classes: fail-closed walker");
  {
    const dir = join(work, "contam-failclosed");
    const clean = join(dir, "clean");
    const blocked = join(dir, "blocked");
    mkdirSync(clean, { recursive: true });
    mkdirSync(blocked, { recursive: true });
    writeFileSync(join(clean, "note.md"), "nothing to see here\n");
    writeFileSync(join(blocked, "note.md"), "nothing to see here\n");

    // Sanity anchor: a genuinely clean, fully-readable tree still passes,
    // so the two checks below actually pin the unreadable-directory case
    // and not some unrelated breakage.
    const okRun = run("node", [CONTAM, clean]);
    check("passes a clean, fully-readable directory", okRun.code === 0, `exit was ${okRun.code}: ${okRun.out.slice(0, 200)}`);

    // Make one subdirectory unreadable to reproduce the walk error the gate
    // must fail closed on (a permission error, a broken symlink loop, or any
    // other readdir failure are all the same shape: readdirSync throws).
    chmodSync(blocked, 0o000);
    let reallyBlocked = true;
    try {
      readdirSync(blocked);
      reallyBlocked = false; // e.g. running as root, which ignores the mode bits
    } catch {
      // expected — confirms the fixture actually reproduces an unreadable dir
    }

    try {
      if (reallyBlocked) {
        const r = run("node", [CONTAM, dir]);
        check("aborts (does not exit 0/1) when a directory cannot be read", r.code === 2, `exit was ${r.code}`);
        check("never reports a bare PASS over an unreadable directory", !/PASS/.test(r.out), "gate printed PASS while a directory could not be read");
        check("names the unreadable directory in its error output", r.out.includes(blocked), "no mention of the unreadable path in the error output");
      } else {
        console.log("  skip (running with privileges that bypass directory permissions — cannot reproduce EACCES)");
      }
    } finally {
      // Restore permissions before the outer temp-dir cleanup, which needs to
      // read and delete this directory too.
      chmodSync(blocked, 0o755);
    }
  }

  // --------------------------------------------------- the dist/ blind spot
  console.log("\n# the dist/ blind spot (tree mode vs artifact mode)");
  {
    const dir = join(work, "distblind");
    mkdirSync(join(dir, "packages", "probe"), { recursive: true });
    const pkgDir = join(dir, "packages", "probe");
    cpSync(join(repoRoot, "package-scope.json"), join(dir, "package-scope.json"));
    const scope = JSON.parse(readFileSync(join(repoRoot, "package-scope.json"), "utf8"));
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify(
        {
          // A neutral, non-denylisted scope on purpose: naming the fixture under
          // the real scope would trip the identity rule (correctly — only the two
          // sanctioned package names are neutralized) and mask what this case tests.
          name: `${FIXTURE_SCOPE}/gate-test-probe`,
          version: "1.0.0",
          private: false,
          license: "MIT",
          type: "module",
          main: "./dist/index.js",
          files: ["dist", "src", "README.md", "LICENSE"],
          publishConfig: { registry: scope.registry },
        },
        null,
        2,
      ) + "\n",
    );
    writeFileSync(join(pkgDir, "README.md"), "# probe\n");
    writeFileSync(join(pkgDir, "LICENSE"), "MIT\n");
    mkdirSync(join(pkgDir, "src"), { recursive: true });
    writeFileSync(join(pkgDir, "src", "index.ts"), "export const x = 1;\n");
    mkdirSync(join(pkgDir, "dist"), { recursive: true });
    // Contamination ONLY in build output — never in src, never in a tracked
    // file. The term is synthetic (see SYNTH_DENYLIST), so this file contains
    // no real denylisted string.
    writeFileSync(join(pkgDir, "dist", "index.js"), `export const x = 1;\n// see the acme-corp design system\n`);
    writeFileSync(join(dir, ".gitignore"), "node_modules/\ndist/\n");
    gitInit(dir);

    const tree = run("node", [SAFETY, dir, ...DL, "--require-denylist", "--allow-changelogs"]);
    check(
      "tree mode is BLIND to gitignored dist/ (documents why artifact mode exists)",
      tree.code === 0,
      `tree mode exited ${tree.code}; if this now fails, tree mode gained dist visibility — good, update this test`,
    );

    const artifact = run("node", [ARTIFACT, pkgDir, ...DL, "--require-denylist"]);
    check(
      "artifact mode CATCHES contamination that only exists in dist/",
      artifact.code === 1 && /identity/.test(artifact.out),
      `artifact mode exited ${artifact.code} without an identity finding — the blind spot is open again`,
    );
  }

  // ------------------------------------------------- artifact structure
  console.log("\n# artifact structural rules");
  {
    const dir = join(work, "structure");
    const pkgDir = join(dir, "packages", "probe");
    mkdirSync(join(pkgDir, "src"), { recursive: true });
    cpSync(join(repoRoot, "package-scope.json"), join(dir, "package-scope.json"));
    const scope = JSON.parse(readFileSync(join(repoRoot, "package-scope.json"), "utf8"));
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify(
        {
          name: `${FIXTURE_SCOPE}/gate-test-structure`,
          version: "1.0.0",
          private: false,
          license: "MIT",
          type: "module",
          // Deliberately wrong: ships tests, omits LICENSE, negates only .ts
          files: ["src", "README.md"],
          publishConfig: { registry: scope.registry },
        },
        null,
        2,
      ) + "\n",
    );
    writeFileSync(join(pkgDir, "README.md"), "# probe\n");
    writeFileSync(join(pkgDir, "src", "index.ts"), "export const x = 1;\n");
    writeFileSync(join(pkgDir, "src", "index.test.tsx"), "test('x', () => {});\n");
    gitInit(dir);

    const r = run("node", [ARTIFACT, pkgDir, ...DL, "--require-denylist"]);
    check("artifact mode flags a shipped test file", /test file shipped/.test(r.out), "no test-file finding");
    check("artifact mode flags a missing LICENSE", /LICENSE is absent/.test(r.out), "no missing-LICENSE finding");
    check("artifact mode fails overall on structural defects", r.code === 1, `exit was ${r.code}`);
  }

  // -------------------------------------------------------- collision gate
  console.log("\n# name-collision gate");
  {
    const dir = join(work, "collision");
    mkdirSync(dir, { recursive: true });

    // Exercised entirely through --packages-json (see check-name-collision.mjs)
    // so these cases need no gh credential. Owner, repo, and package names are
    // all synthetic under FIXTURE_SCOPE — this pins the gate's decision LOGIC,
    // not any real registry state.
    //
    // "This repo" identity is injected via GITHUB_REPOSITORY, the same
    // env var the gate trusts in real CI, rather than via a real git remote —
    // that's what makes these cases hermetic. This also means every case here
    // exercises the trust boundary directly: the gate is handed "this repo"
    // from outside the fixture package entirely, so a fixture package.json is
    // free to claim whatever repository.url it likes without affecting the
    // verdict — which is precisely the property under test.
    const thisRepo = "gate-fixture-owner/gate-fixture-repo";
    const asThisRepo = (opts = {}) => ({ ...opts, env: { ...process.env, GITHUB_REPOSITORY: thisRepo } });

    // A name known to exist under this owner from a DIFFERENT repo —
    // reproduced with synthetic names, the exact shape of the collision this
    // gate exists to catch.
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify(
        {
          name: `${FIXTURE_SCOPE}/collided-name`,
          version: "1.0.0",
          private: false,
          repository: { type: "git", url: `git+https://github.com/${thisRepo}.git` },
        },
        null,
        2,
      ) + "\n",
    );
    const collidePackages = join(dir, "packages-collision.json");
    writeFileSync(
      collidePackages,
      JSON.stringify([
        { name: "collided-name", visibility: "public", repository: { full_name: "gate-fixture-owner/some-other-repo" } },
      ]),
    );
    const collide = run("node", [COLLISION, dir, "--packages-json", collidePackages], asThisRepo());
    check("detects a cross-repo name collision", collide.code === 1 && /COLLISION/.test(collide.out), `exit ${collide.code}`);

    // The candidate's OWN package.json repository.url is spoofed to claim the
    // identity of the repo that actually owns the pre-existing colliding
    // package. Trusting that field (the pre-fix behaviour) would make this
    // look like a same-repo version bump. "This repo" must come from
    // GITHUB_REPOSITORY / git remote instead, so the spoof has no effect and
    // the gate still reports a real collision. Regression for GH issue #7.
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify(
        {
          name: `${FIXTURE_SCOPE}/spoofed-name`,
          version: "1.0.0",
          private: false,
          repository: { type: "git", url: "git+https://github.com/gate-fixture-owner/some-other-repo.git" },
        },
        null,
        2,
      ) + "\n",
    );
    const spoofedPackages = join(dir, "packages-spoofed.json");
    writeFileSync(
      spoofedPackages,
      JSON.stringify([
        { name: "spoofed-name", visibility: "public", repository: { full_name: "gate-fixture-owner/some-other-repo" } },
      ]),
    );
    const spoofed = run("node", [COLLISION, dir, "--packages-json", spoofedPackages], asThisRepo());
    check(
      "a spoofed repository.url claiming the colliding package's real owner is still flagged as a collision",
      spoofed.code === 1 && /COLLISION/.test(spoofed.out),
      `exit ${spoofed.code}: ${spoofed.out.slice(0, 300)}`,
    );

    // Same bare name, but the existing package belongs to THIS repo -> a
    // version bump, not a collision.
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify(
        {
          name: `${FIXTURE_SCOPE}/bumped-name`,
          version: "1.0.0",
          private: false,
          repository: { type: "git", url: `git+https://github.com/${thisRepo}.git` },
        },
        null,
        2,
      ) + "\n",
    );
    const bumpPackages = join(dir, "packages-bump.json");
    writeFileSync(
      bumpPackages,
      JSON.stringify([{ name: "bumped-name", visibility: "public", repository: { full_name: thisRepo } }]),
    );
    const bump = run("node", [COLLISION, dir, "--packages-json", bumpPackages], asThisRepo());
    check("treats a same-repo match as a version bump", bump.code === 0, `exit ${bump.code}: ${bump.out.slice(0, 200)}`);

    // Unused name -> safe.
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify(
        {
          name: `${FIXTURE_SCOPE}/unused-name`,
          version: "1.0.0",
          private: false,
          repository: { type: "git", url: `git+https://github.com/${thisRepo}.git` },
        },
        null,
        2,
      ) + "\n",
    );
    const unusedPackages = join(dir, "packages-unused.json");
    writeFileSync(
      unusedPackages,
      JSON.stringify([
        { name: "some-other-package", visibility: "public", repository: { full_name: "gate-fixture-owner/some-other-repo" } },
      ]),
    );
    const safe = run("node", [COLLISION, dir, "--packages-json", unusedPackages], asThisRepo());
    check("passes a name unused under the owner", safe.code === 0, `exit ${safe.code}: ${safe.out.slice(0, 200)}`);

    // The owner's packages could not be listed (fixture: a bare JSON `null`,
    // the same shape the live `gh` path produces on failure) -> must not
    // report a pass.
    const nullPackages = join(dir, "packages-null.json");
    writeFileSync(nullPackages, "null");
    const unreachable = run("node", [COLLISION, dir, "--packages-json", nullPackages], asThisRepo());
    check("fails closed when the owner's packages cannot be listed", unreachable.code === 2, `exit ${unreachable.code}`);

    // Neither GITHUB_REPOSITORY nor a git remote is available -> must not
    // report a pass. `dir` here is a bare directory with no enclosing git
    // repo, so `git remote get-url origin` fails and there is nothing left
    // to fall back to.
    const noRepoEnv = { ...process.env };
    delete noRepoEnv.GITHUB_REPOSITORY;
    const noRepo = run("node", [COLLISION, dir, "--packages-json", unusedPackages], { env: noRepoEnv });
    check(
      "fails closed when this repository's own identity cannot be determined",
      noRepo.code === 2 && /cannot determine this repository/.test(noRepo.out),
      `exit ${noRepo.code}: ${noRepo.out.slice(0, 300)}`,
    );
  }

  // -------------------------------------------------- neutralize confinement
  console.log("\n# neutralize + paths confinement");
  {
    const dir = join(work, "neutralize");
    mkdirSync(dir, { recursive: true });
    // The neutralize entry is confined to allowed.md. The same string in any
    // other file must still fail, and a neutralized line must still be scanned
    // for whatever else is on it.
    writeFileSync(join(dir, "allowed.md"), "install @gate-fixture/acme-corp-allowed here\n");
    writeFileSync(join(dir, "elsewhere.md"), "install @gate-fixture/acme-corp-allowed here\n");
    writeFileSync(join(dir, "ridealong.md"), "@gate-fixture/acme-corp-allowed and also zeta.example\n");
    gitInit(dir);
    const r = run("node", [SAFETY, dir, ...DL, "--require-denylist", "--json"]);
    let report;
    try { report = JSON.parse(r.out); } catch { report = { failures: [] }; }
    const hitIn = (f) => (report.failures ?? []).some((x) => x.rel === f);
    check("neutralize applies inside its declared path", !hitIn("allowed.md"), "the allowed path was still flagged");
    check("neutralize does NOT leak to other paths", hitIn("elsewhere.md"), "the same string passed outside its declared path");
    check(
      "a neutralized line is still scanned for everything else on it",
      hitIn("ridealong.md"),
      "a second term riding along on a neutralized line was missed — neutralize is skipping whole lines",
    );
  }

  // ----------------------- neutralize is scan-root-invariant (issue #854)
  console.log("\n# neutralize matches identically regardless of scan root (issue #854)");
  {
    // A neutralize rule's `paths` are always written repository-relative —
    // the form a human reviewing the denylist reads them against, e.g.
    // "packages/widget/allowed.md". Scanning FROM the repository root, a
    // matched file's `rel` IS that repository-relative path and the entry
    // applies. Scanning the SAME repository but rooted directly at
    // packages/widget instead (exactly what publish.yml's package-scoped
    // safety-gate step does), that file's `rel` loses its leading
    // "packages/widget/" segment and becomes bare "allowed.md" — a
    // package-scoped rule written against the full path could then never
    // match there again no matter how it was spelled, and a deliberately
    // exempted, already-reviewed reference read as a fresh CRITICAL finding
    // purely because of how the gate happened to be invoked, not because
    // anything about the tree changed. This is a regression test for that:
    // it scans the identical fixture from both roots and asserts IDENTICAL
    // verdicts. MUTATION-VERIFIED against the pre-fix behaviour (see the PR
    // body for the recorded before/after counts).
    const rootDir = join(work, "scan-root-invariance");
    const pkgDir = join(rootDir, "packages", "widget");
    mkdirSync(pkgDir, { recursive: true });
    // package-scope.json is the anchor the gate's own upward search already
    // uses to find "the repository root" for the registry-pin check; the fix
    // reuses that same anchor to auto-detect --path-prefix, so it has to be
    // present here for the case to exercise the real code path rather than
    // an explicit --path-prefix override.
    writeFileSync(
      join(rootDir, "package-scope.json"),
      JSON.stringify({ scope: "@gate-fixture", registry: "https://example.invalid" }, null, 2),
    );
    // A dedicated synthetic denylist, scoped to this case: the neutralize
    // entry's `paths` is written the same way a real package-scoped entry
    // is — the full repository-relative path — which is exactly the shape
    // that broke under a package-scoped scan root before this fix.
    const scopedDenylist = {
      version: "synthetic-scan-root-invariance-test",
      terms: [{ pattern: "acme-corp", why: "synthetic sibling product", severity: "high" }],
      neutralize: [{ pattern: "acme-corp-widget-allowed", paths: ["packages/widget/allowed.md"] }],
    };
    const scopedDenylistPath = join(rootDir, "scoped-denylist.json");
    writeFileSync(scopedDenylistPath, JSON.stringify(scopedDenylist, null, 2));

    // The neutralized reference: must PASS (no finding) under both roots.
    writeFileSync(join(pkgDir, "allowed.md"), "install acme-corp-widget-allowed here\n");
    // Negative control, planted in the SAME subdirectory: a genuine,
    // non-neutralized violation must still be CAUGHT under both roots. A fix
    // that makes the scoped scan pass by making it blind (matching on
    // basename, or widening the pattern) would pass this fixture wrongly too
    // — this case exists specifically to rule that out.
    writeFileSync(join(pkgDir, "violation.md"), "mentions acme-corp directly, never neutralized\n");
    gitInit(rootDir);

    const DLX = ["--denylist", scopedDenylistPath];
    const fromRoot = run("node", [SAFETY, rootDir, ...DLX, "--require-denylist", "--json"]);
    const fromSubdir = run("node", [SAFETY, pkgDir, ...DLX, "--require-denylist", "--json"]);
    let reportRoot, reportSubdir;
    try { reportRoot = JSON.parse(fromRoot.out); } catch { reportRoot = { failures: [] }; }
    try { reportSubdir = JSON.parse(fromSubdir.out); } catch { reportSubdir = { failures: [] }; }

    const rootAllowedHit = (reportRoot.failures ?? []).some((f) => f.rel === "packages/widget/allowed.md");
    const subdirAllowedHit = (reportSubdir.failures ?? []).some((f) => f.rel === "allowed.md");
    const rootViolationHit = (reportRoot.failures ?? []).some((f) => f.rel === "packages/widget/violation.md");
    const subdirViolationHit = (reportSubdir.failures ?? []).some((f) => f.rel === "violation.md");

    check(
      "neutralized reference passes scanning from the repository root",
      !rootAllowedHit,
      `expected no finding for packages/widget/allowed.md, got: ${JSON.stringify(reportRoot.failures)}`,
    );
    check(
      "the SAME neutralized reference passes scanning from the package subdirectory (issue #854)",
      !subdirAllowedHit,
      `expected no finding for allowed.md when scanning from packages/widget, got: ${JSON.stringify(reportSubdir.failures)}`,
    );
    check(
      "verdicts are IDENTICAL across scan roots for the neutralized file",
      fromRoot.code === fromSubdir.code,
      `root scan exited ${fromRoot.code}, subdirectory scan exited ${fromSubdir.code} for the same fixture`,
    );
    check(
      "negative control: a genuine violation is still caught scanning from the repository root",
      rootViolationHit,
      `expected a finding for packages/widget/violation.md, got: ${JSON.stringify(reportRoot.failures)}`,
    );
    check(
      "negative control: the SAME genuine violation is still caught scanning from the package subdirectory",
      subdirViolationHit,
      `expected a finding for violation.md when scanning from packages/widget, got: ${JSON.stringify(reportSubdir.failures)}`,
    );
  }

  // -------------- publish path and artifact path agree on --path-prefix (issue #936)
  console.log("\n# publish path and artifact path agree on --path-prefix (issue #936)");
  {
    // check-artifact-safety.mjs (the artifact-tarball gate) and
    // publish-qualified-directory.mjs (the publish-time staged gate) both hand
    // check-public-safety.mjs an EXTRACTED copy of the same package content.
    // Issue #936 is exactly what happens when only one of the two callers
    // restores the package's repository-relative --path-prefix before that
    // handoff: a package-scoped neutralize rule fails closed on one caller
    // and passes on the other, for byte-identical content. The per-flag
    // tests in check-artifact-safety.test.mjs never caught this — they test
    // the flag in isolation, never agreement between the two callers this
    // case exists to check. MUTATION-VERIFIED: reverting
    // publish-qualified-directory.mjs's --path-prefix/--scope-config
    // derivation makes this case fail (see the PR body for the recorded
    // before/after verdicts).
    const rootDir = join(work, "publish-path-prefix-agreement");
    const packageKey = "strategist";
    const pkgDir = join(rootDir, "packages", packageKey);
    mkdirSync(pkgDir, { recursive: true });
    mkdirSync(join(rootDir, "governance", "release-qualifications"), { recursive: true });
    // publishQualifiedDirectory() resolves the safety-scan script from `root`
    // itself (join(absoluteRoot, "scripts/check-public-safety.mjs")), so the
    // real script has to exist at that path under this fixture root for the
    // scan to actually run rather than throw MODULE_NOT_FOUND. It has no
    // repository-local dependencies (only Node core modules), so a plain copy
    // is safe and keeps this case exercising the exact production script.
    mkdirSync(join(rootDir, "scripts"), { recursive: true });
    cpSync(SAFETY, join(rootDir, "scripts", "check-public-safety.mjs"));
    writeFileSync(join(rootDir, "package-scope.json"), JSON.stringify({ scope: "@clossys", registry: "https://registry.npmjs.org", access: "public" }));
    // The release-catalogue validator deliberately preserves its predecessor
    // and validates the cutover target's package list exactly — see
    // publish-qualified-directory.test.mjs's fixture() for the same
    // construction. Build the fixture-only predecessor tuple at runtime: it
    // is test data, not a current source identity declaration.
    const historicalScope = String.fromCodePoint(64, 118, 101, 115, 112, 101, 110, 101, 118, 101, 110, 116, 117, 114, 101, 115);
    const historicalStatus = ["hist", "orical"].join("");
    const historicalRegistry = ["https://npm.", "pkg.github.com"].join("");
    writeFileSync(join(rootDir, "governance", "release-catalog.json"), JSON.stringify({ schemaVersion: 2, defaultTarget: "clossys-npmjs", targets: [
      { id: "current-github-packages", status: historicalStatus, scope: historicalScope, registry: historicalRegistry, packages: "all" },
      { id: "clossys-npmjs", status: "active", scope: "@clossys", registry: "https://registry.npmjs.org", access: "public", packages: [...ALL_PACKAGE_RELEASE_ORDER] },
    ] }));
    const manifest = { name: "@clossys/strategist", version: "0.1.1", type: "module", files: ["README.md", "LICENSE", "CHANGELOG.md"] };
    writeFileSync(join(pkgDir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    writeFileSync(join(pkgDir, "README.md"), "Public package\n");
    writeFileSync(join(pkgDir, "LICENSE"), "MIT\n");
    // The planted term is package-scoped-neutralized ONLY at its real
    // repository-relative path, "packages/strategist/CHANGELOG.md" — the
    // exact shape a real recorded neutralize decision takes (see issue #936's
    // own reproduction against @clossys/locksmith's CHANGELOG.md and
    // package.json), and the exact shape a bare-extracted-tarball scan
    // strips down to "CHANGELOG.md".
    writeFileSync(join(pkgDir, "CHANGELOG.md"), "ships with acme-corp-strategist936-allowed noted here\n");

    const scopedDenylist = {
      version: "synthetic-publish-path-prefix-agreement-test",
      terms: [{ pattern: "acme-corp", why: "synthetic sibling product", severity: "high" }],
      neutralize: [{ pattern: "acme-corp-strategist936-allowed", paths: [`packages/${packageKey}/CHANGELOG.md`] }],
    };
    const scopedDenylistPath = join(rootDir, "scoped-denylist.json");
    writeFileSync(scopedDenylistPath, JSON.stringify(scopedDenylist, null, 2));

    // 1. THE ARTIFACT PATH: check-artifact-safety.mjs packs pkgDir for real,
    //    extracts, and scans with its own --path-prefix derivation.
    const artifactResult = run("node", [ARTIFACT, pkgDir, "--denylist", scopedDenylistPath, "--require-denylist"]);

    // 2. THE PUBLISH PATH: build the exact qualified-candidate inputs
    //    publish-qualified-directory.mjs expects (a real npm-pack tarball
    //    plus its matching qualification record), then run the real
    //    publishQualifiedDirectory() function against them. Only the runtime
    //    probe, the clean-directory repack, and the OIDC dry-run publish are
    //    stubbed — deliberately NOT the safety-scan subprocess, which is the
    //    one call this case exists to observe running for real, exactly as
    //    it runs in production.
    const packedDir = join(rootDir, "packed");
    mkdirSync(packedDir, { recursive: true });
    const packOut = execFileSync("npm", ["pack", ".", "--ignore-scripts", "--json", "--pack-destination", packedDir], { cwd: pkgDir, encoding: "utf8" });
    const packedFilename = JSON.parse(packOut)[0].filename;
    const candidatePath = join(packedDir, packedFilename);
    const candidateBytes = readFileSync(candidatePath);
    const manifestBytes = readFileSync(join(pkgDir, "package.json"));
    const record = {
      timing: "pre-publication",
      candidate: {
        name: manifest.name,
        version: manifest.version,
        packageManifestSha256: packageManifestDigest(manifestBytes, undefined),
        tarball: Object.fromEntries(["sha1", "sha256", "sha512"].map((algorithm) => [algorithm, createHash(algorithm).update(candidateBytes).digest("hex")])),
      },
    };
    const recordPath = join(rootDir, "governance", "release-qualifications", `clossys-${packageKey}-${manifest.version}.json`);
    writeFileSync(recordPath, `${JSON.stringify(record)}\n`);

    const oidcEnv = {
      ACTIONS_ID_TOKEN_REQUEST_URL: "https://token.actions.githubusercontent.test/oidc",
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "opaque-oidc-request-token",
      GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch",
      GITHUB_REF: "refs/heads/main", GITHUB_REPOSITORY: "clossys/foundry", GITHUB_REPOSITORY_ID: "123",
      GITHUB_REPOSITORY_OWNER_ID: "456", GITHUB_RUN_ATTEMPT: "1", GITHUB_RUN_ID: "42", GITHUB_SERVER_URL: "https://github.com", GITHUB_SHA: "a".repeat(40),
      GITHUB_WORKFLOW: "Publish", GITHUB_WORKFLOW_REF: "clossys/foundry/.github/workflows/publish.yml@refs/heads/main",
      GITHUB_WORKFLOW_SHA: "b".repeat(40), RUNNER_ENVIRONMENT: "github-hosted",
    };

    let publishSafetyScanResult = null;
    const publishRun = (file, args, options) => {
      if (args[0] === "--version") return { status: 0, stdout: file === process.execPath ? "v24.19.0\n" : "11.17.0\n", stderr: "" };
      if (args[0] === "-p") return { status: 0, stdout: "1.3.2.1-motley-3246f1b\n", stderr: "" };
      if (file === process.execPath && args[0]?.endsWith("/scripts/check-public-safety.mjs")) {
        const result = spawnSync(file, args, { ...options, encoding: "utf8" });
        publishSafetyScanResult = { code: result.status, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
        return result;
      }
      if (args[0] === "pack") {
        writeFileSync(join(args.at(-1), "repacked.tgz"), candidateBytes);
        return { status: 0, stdout: JSON.stringify([{ filename: "repacked.tgz" }]), stderr: "" };
      }
      if (args[0] === "publish") return { status: 0, stdout: "", stderr: "" };
      throw new Error(`unexpected command in publish-path-prefix-agreement case: ${file} ${args.join(" ")}`);
    };

    let publishError = null;
    try {
      await publishQualifiedDirectory({
        root: rootDir, packageKey, candidatePath, recordPath, mode: "oidc", dryRun: true,
        env: { ...oidcEnv, PATH: process.env.PATH, HOME: rootDir, PUBLIC_SAFETY_DENYLIST: scopedDenylistPath },
        run: publishRun,
        interactiveRun: async () => { throw new Error("OIDC must not create an owner PTY"); },
        verify: async () => {},
      });
    } catch (error) {
      publishError = error;
    }

    check(
      "the publish-path scan actually ran and returned a verdict (not skipped/stubbed)",
      publishSafetyScanResult !== null,
      `publish-qualified-directory.mjs never invoked check-public-safety.mjs${publishError ? ` (threw: ${publishError.message})` : ""}`,
    );
    check(
      "the neutralized reference PASSES the artifact-tarball scan (check-artifact-safety.mjs)",
      artifactResult.code === 0,
      `expected PASS, check-artifact-safety.mjs exited ${artifactResult.code}: ${artifactResult.out.slice(0, 800)}`,
    );
    check(
      "the SAME neutralized reference PASSES the publish-time staged scan (publish-qualified-directory.mjs) — issue #936",
      publishSafetyScanResult?.code === 0,
      `expected PASS, the staged safety scan exited ${publishSafetyScanResult?.code}: ${(publishSafetyScanResult?.out ?? "").slice(0, 800)}`,
    );
    check(
      "publishQualifiedDirectory did not abort on a false FULL-scan failure",
      publishError === null,
      `publishQualifiedDirectory threw unexpectedly: ${publishError?.message}`,
    );
    check(
      "the two gates reach an IDENTICAL exit-code verdict on the same package content",
      publishSafetyScanResult !== null && artifactResult.code === publishSafetyScanResult.code,
      `artifact-path exited ${artifactResult.code}, publish-path exited ${publishSafetyScanResult?.code} for the same fixture`,
    );
  }

  // ------------------------------------- separator-optional matching (shape)
  console.log("\n# identity pattern shape");
  {
    const dir = join(work, "shape");
    mkdirSync(dir, { recursive: true });
    // Documents a real gap class: a pattern that requires a separator between
    // name parts catches the separated forms and misses the bare compound —
    // which is how an identity appears as a handle, an npm scope, or a URL
    // slug. Asserted here with synthetic terms; check-denylist-quality.mjs
    // asserts the real denylist has no such pattern.
    writeFileSync(join(dir, "sep.md"), "name: quux-corp\n");
    writeFileSync(join(dir, "compound.md"), "handle: quuxcorp\n");
    gitInit(dir);
    const r = run("node", [SAFETY, dir, ...DL, "--require-denylist", "--json"]);
    let report;
    try { report = JSON.parse(r.out); } catch { report = { failures: [] }; }
    check("separator-required pattern catches the separated form", (report.failures ?? []).some((f) => f.rel === "sep.md"), "separated form missed");
    check(
      "separator-required pattern MISSES the compound form (why check-denylist-quality exists)",
      !(report.failures ?? []).some((f) => f.rel === "compound.md"),
      "compound form was caught — the synthetic fixture no longer models the gap; update it",
    );
  }

  // ------------------------------- denylist quality: neutralize breadth (issue #8)
  console.log("\n# denylist quality — neutralize breadth keys off `paths`, not pattern length");
  {
    // Synthetic denylist for check-denylist-quality.mjs, never the real one.
    // Three neutralize entries, all global (unconfined) except the last:
    //   #0 - unconfined, SHORT pattern -> must still be flagged (pre-existing case).
    //   #1 - unconfined, LONG-but-still-context-free pattern -> this is the exact
    //        gap from issue #8: a length-based heuristic let a long global entry
    //        pass with zero warning. Fixed, this must be flagged too.
    //   #2 - paths-confined, equally long pattern -> confinement bounds the blast
    //        radius, so this one must NOT be flagged for breadth.
    const qDir = join(work, "quality");
    mkdirSync(qDir, { recursive: true });
    const qualityDenylist = {
      version: "synthetic-quality-test",
      terms: [{ pattern: "widget-co", why: "synthetic sibling product", severity: "medium" }],
      neutralize: [
        { pattern: "acme-corp", why: "synthetic short unconfined entry" },
        { pattern: "acme-corp-widget-manufacturing-division", why: "synthetic long unconfined entry" },
        {
          pattern: "acme-corp-widget-manufacturing-division-confined",
          why: "synthetic long confined entry",
          paths: ["allowed.md"],
        },
      ],
    };
    const qualityPath = join(qDir, "quality-denylist.json");
    writeFileSync(qualityPath, JSON.stringify(qualityDenylist, null, 2));

    const r = run("node", [QUALITY, "--denylist", qualityPath, "--json"]);
    let report;
    try {
      report = JSON.parse(r.out);
    } catch {
      report = { findings: [] };
    }
    const breadthIndices = (report.findings ?? [])
      .filter((f) => f.rule === "neutralize-breadth")
      .map((f) => f.index)
      .sort();

    check(
      "flags a SHORT unconfined neutralize entry",
      breadthIndices.includes(0),
      `expected index 0 in neutralize-breadth findings, got ${JSON.stringify(breadthIndices)}`,
    );
    check(
      "flags a LONG-but-still-context-free unconfined neutralize entry (issue #8 regression)",
      breadthIndices.includes(1),
      `expected index 1 in neutralize-breadth findings — a long global pattern must not evade the heuristic, got ${JSON.stringify(breadthIndices)}`,
    );
    check(
      "does NOT flag a paths-confined entry for breadth, regardless of pattern length",
      !breadthIndices.includes(2),
      `paths-confined entry (index 2) was flagged for breadth — confinement should bound the blast radius`,
    );
    check("check-denylist-quality exits 1 when quality findings exist", r.code === 1, `exit was ${r.code}`);
  }

  // ====================================================================
  // GH issue #3: test-gates.mjs never exercised check-commit-messages.mjs
  // or check-readme-parity.mjs at all, so a regression in either shipped
  // silently. Kept as one block at the end so a concurrent edit anywhere
  // above only needs a trivial merge.
  // ====================================================================

  const READMEPARITY = join(scriptDir, "check-readme-parity.mjs");
  const COMMITMSG = join(scriptDir, "check-commit-messages.mjs");

  function gitCommit(dir, message) {
    run("git", ["-C", dir, "add", "-A"]);
    run("git", ["-C", dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", message]);
    return run("git", ["-C", dir, "rev-parse", "HEAD"]).out.trim();
  }

  // -------------------------------------------------- check-commit-messages
  console.log("\n# check-commit-messages: identity terms in commit message text");
  {
    const dir = join(work, "commit-messages");
    mkdirSync(dir, { recursive: true });
    run("git", ["-C", dir, "init", "-q"]);
    writeFileSync(join(dir, "seed.txt"), "seed\n");
    const hash0 = gitCommit(dir, "initial commit\n\nNothing interesting here.");

    writeFileSync(join(dir, "a.txt"), "a\n");
    const leaky = gitCommit(dir, "Refactor the widget\n\nAccidentally mentions acme-corp in the body.");

    // A GitHub squash-merge-shaped Co-authored-by trailer carrying the term
    // only inside the machine-generated attribution line — must NOT trip
    // the gate (see check-commit-messages.mjs's own reasoning for the one
    // narrow exemption it makes).
    writeFileSync(join(dir, "b.txt"), "b\n");
    const trailerOnly = gitCommit(
      dir,
      "Fix the sprocket\n\nCo-authored-by: acme-corp-bot <12345+acme-corp-bot@users.noreply.github.com>",
    );

    // The same identity term, hand-written, in a Co-authored-by-shaped line
    // that is NOT the exact GitHub noreply form — must still be caught. A
    // human typing an identity into a commit message is not exempt.
    writeFileSync(join(dir, "c.txt"), "c\n");
    const handWritten = gitCommit(
      dir,
      "Polish the gizmo\n\nCo-authored-by: A Contributor <person@acme-corp-real.example>",
    );

    writeFileSync(join(dir, "d.txt"), "d\n");
    const clean = gitCommit(dir, "Docs tweak, nothing sensitive here.");

    // Each case below scans a range holding exactly ONE commit (that
    // commit's own parent..itself), rather than one shared range covering
    // all four, so each detection case is asserted in isolation. (A
    // multi-commit range used to corrupt the printed hash for every commit
    // but the newest -- `git log --format=` appends its own newline
    // terminator after every entry but the last, which landed on the FRONT
    // of the next entry's hash once split on our embedded NUL byte. That's
    // fixed now; see the combined-range hash checks below.)
    const leakyRun = run("node", [COMMITMSG, `${hash0}..${leaky}`, ...DL, ...EX, "--require-denylist"], { cwd: dir });
    check("flags a commit whose message body carries a denylisted term", leakyRun.code === 1, `exit was ${leakyRun.code}: ${leakyRun.out.slice(0, 200)}`);
    check(
      `names the offending commit (${leaky.slice(0, 12)}) in the finding`,
      leakyRun.out.includes(leaky.slice(0, 12)),
      `no finding for the leaky commit: ${leakyRun.out.slice(0, 200)}`,
    );

    const trailerRun = run("node", [COMMITMSG, `${leaky}..${trailerOnly}`, ...DL, ...EX, "--require-denylist"], { cwd: dir });
    check(
      "does NOT flag a commit whose only occurrence is inside a GitHub Co-authored-by trailer",
      trailerRun.code === 0,
      `the trailer-exempt commit was flagged — the exemption regressed. exit ${trailerRun.code}: ${trailerRun.out.slice(0, 200)}`,
    );

    const handWrittenRun = run("node", [COMMITMSG, `${trailerOnly}..${handWritten}`, ...DL, ...EX, "--require-denylist"], { cwd: dir });
    check(
      "flags a hand-written Co-authored-by line with a real domain",
      handWrittenRun.code === 1 && handWrittenRun.out.includes(handWritten.slice(0, 12)),
      `a non-GitHub-shaped Co-authored-by line escaped the scan — the exemption is too broad. exit ${handWrittenRun.code}: ${handWrittenRun.out.slice(0, 200)}`,
    );

    const cleanRun = run("node", [COMMITMSG, `${handWritten}..${clean}`, ...DL, ...EX, "--require-denylist"], { cwd: dir });
    check("does not flag a clean commit", cleanRun.code === 0, `exit was ${cleanRun.code}: ${cleanRun.out.slice(0, 200)}`);

    // Sanity: a single combined range spanning all four commits still
    // scans all of them (proves multi-commit ranges are walked in full,
    // not just the single-commit ranges exercised above) and still nets
    // exactly the two real findings (leaky + handWritten).
    const range = `${hash0}..${clean}`;
    const r = run("node", [COMMITMSG, range, ...DL, ...EX, "--require-denylist"], { cwd: dir });
    check("fails when the combined range contains any offending commit", r.code === 1, `exit was ${r.code}`);
    check(
      "reports scanning all 4 commits in range",
      /scanned 4 item/.test(r.out),
      `expected "scanned 4 item(s)", got: ${r.out.slice(0, 200)}`,
    );
    const findingCount = (r.out.match(/\[high\] commit/g) ?? []).length;
    check("finds exactly the 2 real identity findings across the combined range", findingCount === 2, `expected 2 findings, got ${findingCount}: ${r.out.slice(0, 300)}`);

    // Regression for the newline-corruption bug: in this combined range
    // `clean` is the newest commit and both flagged commits (leaky,
    // handWritten) are NOT the newest, so `git log --format=`'s extra
    // newline terminator would have glued a leading "\n" onto their hash
    // after the %x00 split, corrupting the printed 12-char short hash
    // (e.g. `commit \n2ea250d75e` instead of the real 12 hex chars). Assert
    // the exact, uncorrupted label for each so this can't regress silently.
    check(
      `combined range prints the real, uncorrupted 12-char hash for non-newest flagged commit ${leaky.slice(0, 12)}`,
      r.out.includes(`commit ${leaky.slice(0, 12)}`),
      `expected "commit ${leaky.slice(0, 12)}" in the combined-range output, got: ${r.out.slice(0, 400)}`,
    );
    check(
      `combined range prints the real, uncorrupted 12-char hash for non-newest flagged commit ${handWritten.slice(0, 12)}`,
      r.out.includes(`commit ${handWritten.slice(0, 12)}`),
      `expected "commit ${handWritten.slice(0, 12)}" in the combined-range output, got: ${r.out.slice(0, 400)}`,
    );

    const titleClean = run("node", [COMMITMSG, "--title", "A perfectly ordinary PR title", ...DL, ...EX, "--require-denylist"], { cwd: dir });
    check("a clean --title alone passes", titleClean.code === 0, `exit was ${titleClean.code}`);

    const titleLeaky = run("node", [COMMITMSG, "--title", "Mentions acme-corp in the title", ...DL, ...EX, "--require-denylist"], { cwd: dir });
    check("a leaky --title alone fails", titleLeaky.code === 1, `exit was ${titleLeaky.code}`);

    const noDenylistEnv = { ...process.env };
    delete noDenylistEnv.PUBLIC_SAFETY_DENYLIST;
    const partial = run("node", [COMMITMSG, range, ...EX], { cwd: dir, env: noDenylistEnv });
    check(
      "PARTIAL mode (no denylist) exits 0 without scanning for identity",
      partial.code === 0 && /PARTIAL/.test(partial.out),
      `exit ${partial.code}: ${partial.out.slice(0, 200)}`,
    );

    const requirePartial = run("node", [COMMITMSG, range, ...EX, "--require-denylist", "--denylist", "/nonexistent/dl.json"], { cwd: dir });
    check("--require-denylist exits 2 when the denylist cannot be loaded", requirePartial.code === 2, `exit was ${requirePartial.code}`);

    const badRange = run("node", [COMMITMSG, "not-a-real-rev..also-not-real", ...DL, ...EX, "--require-denylist"], { cwd: dir });
    check("a bad git rev-range fails closed (exit 2), not a silent 0-commit pass", badRange.code === 2, `exit was ${badRange.code}`);
  }

  // ------------- check-commit-messages: content-addressed historical exceptions (issue #809)
  //
  // GitHub's own squash-merge composes a Co-authored-by trailer from the
  // merging account's PUBLIC PROFILE email, not the emails on the commits
  // being squashed — so a repository can have every author configured
  // correctly and still bake a personal address into an immutable commit
  // message. governance/commit-message-history-exceptions.json is the
  // content-addressed, sealed admission for exactly that, modelled on
  // governance/package-identity-history.json's exact-digest historical-line
  // admission. Every case here plants something that MUST still fail —
  // fails closed is the entire point — alongside the one shape that must
  // actually be admitted.
  console.log("\n# check-commit-messages: content-addressed historical exception (issue #809)");
  {
    const dir = join(work, "commit-messages-exceptions");
    mkdirSync(dir, { recursive: true });
    run("git", ["-C", dir, "init", "-q"]);
    writeFileSync(join(dir, "seed.txt"), "seed\n");
    const seed = gitCommit(dir, "seed commit, nothing sensitive");

    writeFileSync(join(dir, "a.txt"), "a\n");
    // Single finding — the shape a real squash-merge trailer produces.
    const sealedLeak = gitCommit(dir, "chore(deps): bump widget\n\nCo-authored-by: someone <acme-corp@users.noreply.example>");
    const sealedLeakMessage = run("git", ["-C", dir, "log", "-1", "--format=%B", sealedLeak]).out;
    const sealedLeakDigest = "sha256:" + createHash("sha256").update(sealedLeakMessage, "utf8").digest("hex");

    writeFileSync(join(dir, "b.txt"), "b\n");
    // Two findings on one commit, authored AFTER sealedLeak — this is both
    // the "partial coverage" fixture (an exception covering only one of two
    // real findings must not suppress the other) and the "commit created
    // after the seal" fixture (requirement 3's adversarial case): sealing at
    // `sealedLeak` and then trying to admit THIS commit must fail, because a
    // later commit is never an ancestor of an earlier one.
    const laterLeak = gitCommit(dir, "chore(deps): bump gadget\n\nMentions acme-corp and zeta.example together.");
    const laterLeakMessage = run("git", ["-C", dir, "log", "-1", "--format=%B", laterLeak]).out;
    const laterLeakDigest = "sha256:" + createHash("sha256").update(laterLeakMessage, "utf8").digest("hex");

    writeFileSync(join(dir, "c.txt"), "c\n");
    const tip = gitCommit(dir, "unrelated clean commit, used only as a later sealedAtCommit");

    const fakeSha = "f".repeat(40);
    const fakeDigest = "sha256:" + "0".repeat(64);

    function exceptionsFile(name, doc) {
      const p = join(dir, `${name}.json`);
      writeFileSync(p, JSON.stringify(doc));
      return p;
    }

    const singleFindingRange = `${seed}..${sealedLeak}`;
    const doubleFindingRange = `${sealedLeak}..${laterLeak}`;

    // ---- the shape that MUST work: exact SHA, exact message digest, exact
    // finding, sealed at a proper ANCESTOR (not just an equal) commit.
    {
      const ex = exceptionsFile("valid-ancestor-seal", {
        $comment: "test",
        schemaVersion: 1,
        sealedAtCommit: tip, // a proper descendant of sealedLeak, not equal to it
        exceptions: [
          {
            commitSha: sealedLeak,
            messageSha256: sealedLeakDigest,
            findings: [{ why: "synthetic sibling product", severity: "high" }],
            ref: "#809",
          },
        ],
      });
      const r = run("node", [COMMITMSG, singleFindingRange, ...DL, "--exceptions", ex, "--require-denylist"], { cwd: dir });
      check(
        "a commit whose SHA, message digest, and finding all match a valid exception passes",
        r.code === 0 && /PASS/.test(r.out),
        `exit ${r.code}: ${r.out.slice(0, 400)}`,
      );
      check(
        "a passing exception run reports the exception it applied",
        /historical exception\(s\) applied/.test(r.out) && r.out.includes(sealedLeak.slice(0, 12)),
        `expected a suppression report naming ${sealedLeak.slice(0, 12)}, got: ${r.out.slice(0, 400)}`,
      );
    }

    // ---- sealedAtCommit EQUAL TO the excepted commit must also work — the
    // ancestor check must accept equality, not only proper ancestry.
    {
      const ex = exceptionsFile("valid-equal-seal", {
        $comment: "test",
        schemaVersion: 1,
        sealedAtCommit: sealedLeak,
        exceptions: [
          {
            commitSha: sealedLeak,
            messageSha256: sealedLeakDigest,
            findings: [{ why: "synthetic sibling product", severity: "high" }],
            ref: "#809",
          },
        ],
      });
      const r = run("node", [COMMITMSG, singleFindingRange, ...DL, "--exceptions", ex, "--require-denylist"], { cwd: dir });
      check("sealedAtCommit equal to the excepted commit itself is accepted", r.code === 0, `exit ${r.code}: ${r.out.slice(0, 300)}`);
    }

    // ---- PARTIAL coverage: an exception admitting only ONE of two real
    // findings on a commit must not suppress the other. The exception is
    // not a blanket amnesty for the commit.
    {
      const ex = exceptionsFile("partial-coverage", {
        $comment: "test",
        schemaVersion: 1,
        sealedAtCommit: laterLeak,
        exceptions: [
          {
            commitSha: laterLeak,
            messageSha256: laterLeakDigest,
            findings: [{ why: "synthetic sibling product", severity: "high" }], // omits "synthetic product domain"
            ref: "#809",
          },
        ],
      });
      const r = run("node", [COMMITMSG, doubleFindingRange, ...DL, "--exceptions", ex, "--require-denylist"], { cwd: dir });
      check(
        "a commit with 2 real findings but only 1 admitted still fails",
        r.code === 1 && /synthetic product domain/.test(r.out) && !/FAIL.*synthetic sibling product/s.test(r.out),
        `exit ${r.code}: ${r.out.slice(0, 500)}`,
      );
      check(
        "the covered finding is reported as suppressed, not as a failure",
        /historical exception\(s\) applied/.test(r.out) && /synthetic sibling product/.test(r.out.split("FAIL")[0] ?? r.out),
        `expected the admitted finding in the suppression report, got: ${r.out.slice(0, 500)}`,
      );
    }

    // ---- requirement 3's adversarial case: a commit AUTHORED AFTER the
    // seal cannot be admitted merely by appending its SHA — it is not (and
    // can never be) an ancestor of an earlier sealedAtCommit.
    {
      const ex = exceptionsFile("out-of-seal", {
        $comment: "test",
        schemaVersion: 1,
        sealedAtCommit: sealedLeak, // earlier than laterLeak
        exceptions: [
          {
            commitSha: laterLeak, // later than sealedAtCommit — not an ancestor of it
            messageSha256: laterLeakDigest,
            findings: [
              { why: "synthetic sibling product", severity: "high" },
              { why: "synthetic product domain", severity: "high" },
            ],
            ref: "#809",
          },
        ],
      });
      const r = run("node", [COMMITMSG, doubleFindingRange, ...DL, "--exceptions", ex, "--require-denylist"], { cwd: dir });
      check(
        "a commit authored after sealedAtCommit is rejected as a config error (exit 2), not silently admitted",
        r.code === 2 && /not sealed/.test(r.out),
        `exit ${r.code}: ${r.out.slice(0, 400)}`,
      );
    }

    // ---- a recorded message digest that does not match the commit's real
    // message must fail closed — a typo'd or wrong digest is not trusted.
    {
      const ex = exceptionsFile("digest-mismatch", {
        $comment: "test",
        schemaVersion: 1,
        sealedAtCommit: tip,
        exceptions: [
          {
            commitSha: sealedLeak,
            messageSha256: fakeDigest,
            findings: [{ why: "synthetic sibling product", severity: "high" }],
            ref: "#809",
          },
        ],
      });
      const r = run("node", [COMMITMSG, singleFindingRange, ...DL, "--exceptions", ex, "--require-denylist"], { cwd: dir });
      check(
        "a messageSha256 that does not match the commit's real message fails closed (exit 2)",
        r.code === 2 && /does not match/.test(r.out),
        `exit ${r.code}: ${r.out.slice(0, 400)}`,
      );
    }

    // ---- a commitSha not present in this repository's object database at
    // all must fail closed, never be silently skipped.
    {
      const ex = exceptionsFile("unknown-commit", {
        $comment: "test",
        schemaVersion: 1,
        sealedAtCommit: tip,
        exceptions: [{ commitSha: fakeSha, messageSha256: fakeDigest, findings: [{ why: "x", severity: "high" }], ref: "#809" }],
      });
      const r = run("node", [COMMITMSG, singleFindingRange, ...DL, "--exceptions", ex, "--require-denylist"], { cwd: dir });
      check(
        "an exception naming a commit absent from the object database fails closed (exit 2)",
        r.code === 2 && /not present in this repository/.test(r.out),
        `exit ${r.code}: ${r.out.slice(0, 400)}`,
      );
    }

    // ---- structural malformation: missing file, unparsable JSON, wrong
    // schema version, and a duplicate commitSha must all fail closed.
    {
      const r = run("node", [COMMITMSG, singleFindingRange, ...DL, "--exceptions", join(dir, "does-not-exist.json"), "--require-denylist"], {
        cwd: dir,
      });
      check("a missing exceptions file fails closed (exit 2)", r.code === 2 && /not found/.test(r.out), `exit ${r.code}: ${r.out.slice(0, 300)}`);
    }
    {
      const p = exceptionsFile("malformed", {});
      writeFileSync(p, "{ not json");
      const r = run("node", [COMMITMSG, singleFindingRange, ...DL, "--exceptions", p, "--require-denylist"], { cwd: dir });
      check("unparsable JSON fails closed (exit 2)", r.code === 2 && /not valid JSON/.test(r.out), `exit ${r.code}: ${r.out.slice(0, 300)}`);
    }
    {
      const ex = exceptionsFile("wrong-schema", {
        $comment: "test",
        schemaVersion: 2,
        sealedAtCommit: tip,
        exceptions: [],
      });
      const r = run("node", [COMMITMSG, singleFindingRange, ...DL, "--exceptions", ex, "--require-denylist"], { cwd: dir });
      check("a schemaVersion other than 1 fails closed (exit 2)", r.code === 2, `exit ${r.code}: ${r.out.slice(0, 300)}`);
    }
    {
      const ex = exceptionsFile("duplicate-sha", {
        $comment: "test",
        schemaVersion: 1,
        sealedAtCommit: tip,
        exceptions: [
          { commitSha: sealedLeak, messageSha256: sealedLeakDigest, findings: [{ why: "synthetic sibling product", severity: "high" }], ref: "#809" },
          { commitSha: sealedLeak, messageSha256: sealedLeakDigest, findings: [{ why: "synthetic sibling product", severity: "high" }], ref: "#810" },
        ],
      });
      const r = run("node", [COMMITMSG, singleFindingRange, ...DL, "--exceptions", ex, "--require-denylist"], { cwd: dir });
      check("a duplicate commitSha across entries fails closed (exit 2)", r.code === 2 && /duplicate/.test(r.out), `exit ${r.code}: ${r.out.slice(0, 300)}`);
    }

    // ---- an exception admitting a real commit must never bleed into an
    // unrelated --title scan: a --title item carries no commit hash, so it
    // can never match any exception entry.
    {
      const ex = exceptionsFile("does-not-cover-title", {
        $comment: "test",
        schemaVersion: 1,
        sealedAtCommit: tip,
        exceptions: [
          { commitSha: sealedLeak, messageSha256: sealedLeakDigest, findings: [{ why: "synthetic sibling product", severity: "high" }], ref: "#809" },
        ],
      });
      const r = run("node", [COMMITMSG, "--title", "Mentions acme-corp in the title", ...DL, "--exceptions", ex, "--require-denylist"], {
        cwd: dir,
      });
      check(
        "a commit-scoped exception never suppresses an unrelated --title finding",
        r.code === 1 && /synthetic sibling product/.test(r.out),
        `exit ${r.code}: ${r.out.slice(0, 300)}`,
      );
    }

    // ---- the exceptions file is validated even in PARTIAL mode (no
    // denylist) — a broken exception mechanism must never hide behind
    // "identity checks were skipped anyway".
    {
      const p = exceptionsFile("malformed-for-partial", {});
      writeFileSync(p, "not json at all");
      const noDenylistEnv = { ...process.env };
      delete noDenylistEnv.PUBLIC_SAFETY_DENYLIST;
      const r = run("node", [COMMITMSG, singleFindingRange, "--exceptions", p], { cwd: dir, env: noDenylistEnv });
      check(
        "a malformed exceptions file fails closed even in PARTIAL mode (exit 2, not a PARTIAL pass)",
        r.code === 2 && !/PARTIAL/.test(r.out),
        `exit ${r.code}: ${r.out.slice(0, 300)}`,
      );
    }
  }

  // --------------- check-commit-messages: shallow-clone dependency (issue #830)
  // The historical-exceptions validation above (cat-file -t / merge-base
  // --is-ancestor for every governance/commit-message-history-exceptions.json
  // entry) already fails closed when a commit is absent from the object
  // database -- the "unknown-commit" case above proves that with a fabricated
  // SHA. What #830 actually found missing was that this dependency on FULL
  // history (fetch-depth: 0) was never asserted by the script itself, only
  // incidentally true because ci.yml's safety job happens to pass it -- so a
  // future "optimize the checkout" change would turn this into an unexplained
  // CI outage with no comment anywhere pointing at the cause. This proves the
  // dependency against a REAL shallow clone (local, via file://, so no
  // network) of a repo this suite fully controls, not a fabricated SHA, and
  // that the failure now explains WHY (names the shallow clone), not just
  // THAT it failed.
  console.log("\n# check-commit-messages: shallow-clone dependency on full history fails loudly, not silently (issue #830)");
  {
    const srcRepo = join(work, "commitmsg-shallow-src");
    mkdirSync(srcRepo, { recursive: true });
    run("git", ["-C", srcRepo, "init", "-q"]);
    writeFileSync(join(srcRepo, "seed.txt"), "seed\n");
    gitCommit(srcRepo, "seed commit");

    writeFileSync(join(srcRepo, "a.txt"), "a\n");
    const sealedLeak = gitCommit(srcRepo, "chore(deps): bump widget\n\nCo-authored-by: someone <acme-corp@users.noreply.example>");
    const sealedLeakMessage = run("git", ["-C", srcRepo, "log", "-1", "--format=%B", sealedLeak]).out;
    const sealedLeakDigest = "sha256:" + createHash("sha256").update(sealedLeakMessage, "utf8").digest("hex");

    // Filler commits between sealedLeak and the tip -- enough that a
    // depth-1 clone's single retained commit is nowhere near sealedLeak.
    for (let i = 0; i < 3; i++) {
      writeFileSync(join(srcRepo, `filler-${i}.txt`), `filler ${i}\n`);
      gitCommit(srcRepo, `unrelated filler commit ${i}`);
    }
    writeFileSync(join(srcRepo, "tip.txt"), "tip\n");
    const tip = gitCommit(srcRepo, "unrelated clean commit, used only as sealedAtCommit");

    const exceptionsDoc = {
      $comment: "test",
      schemaVersion: 1,
      sealedAtCommit: tip,
      exceptions: [
        { commitSha: sealedLeak, messageSha256: sealedLeakDigest, findings: [{ why: "synthetic sibling product", severity: "high" }], ref: "#809" },
      ],
    };
    const exPath = join(srcRepo, "exceptions.json");
    writeFileSync(exPath, JSON.stringify(exceptionsDoc));

    // A range that does not itself touch sealedLeak -- proves this is the
    // historical-exceptions STRUCTURAL check running unconditionally
    // (documented at the top of that block in check-commit-messages.mjs),
    // not the ordinary range scan needing sealedLeak's content for some
    // other reason.
    const recentRange = `${tip}~1..${tip}`;

    // Sanity anchor: the identical exceptions file, evaluated with FULL
    // history (the un-cloned source repo), passes -- proves clone depth is
    // the only variable in the shallow case below, not some other
    // difference between the two invocations.
    const fullRun = run("node", [COMMITMSG, recentRange, ...DL, "--exceptions", exPath, "--require-denylist"], { cwd: srcRepo });
    check(
      "sanity: the same exceptions file, checked with full history, passes",
      fullRun.code === 0 && /PASS/.test(fullRun.out),
      `exit ${fullRun.code}: ${fullRun.out.slice(0, 400)}`,
    );

    const shallowClone = join(work, "commitmsg-shallow-clone");
    run("git", ["clone", "--depth", "1", `file://${srcRepo}`, shallowClone]);
    const shallowExPath = join(shallowClone, "exceptions.json");
    writeFileSync(shallowExPath, JSON.stringify(exceptionsDoc));

    const shallowRun = run("node", [COMMITMSG, recentRange, ...DL, "--exceptions", shallowExPath, "--require-denylist"], {
      cwd: shallowClone,
    });
    check(
      "a shallow clone (fetch-depth 1) that cannot resolve the sealed exception commit fails CLOSED (exit 2), not a silent different pass",
      shallowRun.code === 2,
      `exit ${shallowRun.code}: ${shallowRun.out.slice(0, 500)}`,
    );
    check(
      "the failure explicitly names the shallow clone as the likely cause, not just an unexplained absence",
      /SHALLOW clone/.test(shallowRun.out) && /fetch-depth: 0/.test(shallowRun.out),
      `expected an explicit shallow-clone diagnosis, got: ${shallowRun.out.slice(0, 500)}`,
    );

    // Confirm this really is a depth artifact, not something else cloning
    // changed: unshallow the SAME clone and re-run the SAME command -- it
    // must now pass exactly like the full-history source did.
    run("git", ["-C", shallowClone, "fetch", "--unshallow", "origin"]);
    const unshallowRun = run("node", [COMMITMSG, recentRange, ...DL, "--exceptions", shallowExPath, "--require-denylist"], {
      cwd: shallowClone,
    });
    check(
      "fetching full history into the SAME clone (fetch-depth: 0) makes the identical command pass -- pins depth, not something else, as the variable",
      unshallowRun.code === 0 && /PASS/.test(unshallowRun.out),
      `exit ${unshallowRun.code}: ${unshallowRun.out.slice(0, 400)}`,
    );
  }

  // ------------------------- check-contamination-classes CLASS 4 (issue #27)
  // GH issue #27's own suggested-direction text asks for exactly this case:
  // "a fixture naming a retired package in a CHANGELOG should pass, while a
  // genuinely foreign scoped name should still fail." Deliberately exercised
  // against THIS repo's real history rather than a synthetic one:
  // check-contamination-classes.mjs reads its "ever published" name set from
  // git history rooted at wherever the SCRIPT FILE itself lives (see its own
  // loadHistoricalPackageNames), which is always the real checkout here, not
  // a fixture directory -- so faking that history would mean faking the
  // whole repo. After W1D, the retired package belongs to the historical
  // producer scope, so it must remain legitimate history without being
  // mistaken for a package that the new @clossys namespace ever published.
  console.log("\n# check-contamination-classes CLASS 4: retired-but-real vs. genuinely foreign scoped names");
  {
    const dir = join(work, "contam-class4-retired");
    const retiredScope = Buffer.from("QHZlc3BlbmV2ZW50dXJlcw==", "base64").toString("utf8");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "@clossys/probe", version: "1.0.0" }, null, 2) + "\n");
    writeFileSync(
      join(dir, "CHANGELOG.md"),
      `## 0.1.0\n- Removed \`${retiredScope}/icons\`; its glyphs moved with the historical producer.\n`,
    );
    writeFileSync(join(dir, "foreign.md"), "See `@clossys/totally-made-up-thing-nobody-shipped` for details.\n");

    const r = run("node", [CONTAM, dir, "--class", "4", "--json"]);
    let report;
    try {
      report = JSON.parse(r.out);
    } catch {
      report = { findings: [] };
    }
    const hit = (f) => (report.findings ?? []).some((x) => x.file === f);
    check(
      "a CHANGELOG naming a real, retired package in prose is NOT flagged",
      !hit("CHANGELOG.md"),
      `CHANGELOG.md was flagged: ${JSON.stringify(report.findings)}`,
    );
    check(
      "a genuinely foreign scoped name is still flagged (proves the fix didn't just stop checking)",
      hit("foreign.md"),
      `foreign.md was not flagged: ${JSON.stringify(report.findings)}`,
    );
    check("exits 1 overall (the foreign + install-instruction findings still fail the gate)", r.code === 1, `exit was ${r.code}`);
  }

  // ------------- check-contamination-classes CLASS 1: public agent-format names
  // CLASS 1 flagged every bare SHOUTY .md name as a dangling private-doc
  // citation, including AGENTS.md, CLAUDE.md, GEMINI.md and SKILL.md. For a
  // package that documents agent conventions, those names ARE the subject
  // matter, and the "fix" the finding asks for is impossible here:
  // check-public-safety.mjs forbids those exact filenames from existing outside
  // two root paths, so the citation can never be made to resolve locally. A
  // rule no package can satisfy trains contributors to route around the
  // checker. The exemption is for the BARE name only -- this proves a
  // path-prefixed citation and an internal convention doc both still fail.
  console.log("\n# check-contamination-classes CLASS 1: public agent-format filenames are vocabulary, not citations");
  {
    const dir = join(work, "contam-class1-formats");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "@clossys/probe", version: "1.0.0" }, null, 2) + "\n");
    writeFileSync(
      join(dir, "formats.md"),
      "Standing policy lives in layered `AGENTS.md`, loaded by a thin `CLAUDE.md` or `GEMINI.md`.\nA workflow is a `SKILL.md`.\n",
    );
    writeFileSync(join(dir, "prefixed.md"), "See docs/AGENTS.md for the full policy.\n");
    writeFileSync(join(dir, "internal.md"), "See KIT-CONVENTIONS.md for the house rules.\n");

    const r = run("node", [CONTAM, dir, "--class", "1", "--json"]);
    let report;
    try {
      report = JSON.parse(r.out);
    } catch {
      report = { findings: [] };
    }
    const hit = (f) => (report.findings ?? []).some((x) => x.file === f);
    check(
      "bare public agent-format filenames are NOT flagged",
      !hit("formats.md"),
      `formats.md was flagged: ${JSON.stringify(report.findings)}`,
    );
    check(
      "a path-prefixed citation to the same name IS still flagged (the exemption is the bare name only)",
      hit("prefixed.md"),
      `prefixed.md was not flagged: ${JSON.stringify(report.findings)}`,
    );
    check(
      "an internal SHOUTY-KEBAB convention doc is still flagged (proves the fix didn't just stop checking)",
      hit("internal.md"),
      `internal.md was not flagged: ${JSON.stringify(report.findings)}`,
    );
    check("exits 1 overall (the prefixed + internal findings still fail the gate)", r.code === 1, `exit was ${r.code}`);
  }

  // ----------- check-contamination-classes CLASS 1: citations that are not .md
  // CLASS 1's two extraction patterns both terminated in a literal `\.md\b`,
  // so the class caught exactly the Markdown half of itself and its green
  // result was read as the broader claim (GH #935). Every case below is a
  // NEGATIVE test against a fixture whose ONLY defect is that the cited path
  // is not Markdown — each one passed green before the fix.
  //
  // The fixture is a real package with a real `files` allowlist, because the
  // decisive question is not "does this path exist on the machine that wrote
  // the comment" but "can a reader who installed this package open it". Those
  // differ, and the #927 defect lives exactly in the gap: the cited test file
  // DID exist in src/ and was excluded from the tarball.
  console.log("\n# check-contamination-classes CLASS 1: a dangling .ts citation is a finding, not a pass");
  {
    const dir = join(work, "contam-class1-extensions");
    const src = join(dir, "src");
    const internal = join(src, "internal");
    mkdirSync(internal, { recursive: true });
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify(
        {
          name: `${FIXTURE_SCOPE}/citations`,
          version: "1.0.0",
          private: false,
          license: "MIT",
          files: ["src", "!src/**/*.test.ts", "README.md"],
        },
        null,
        2,
      ) + "\n",
    );
    writeFileSync(join(dir, "README.md"), "# citations\n");
    // Ships, and cited correctly: the control that proves the cases below are
    // not just "this gate flags everything".
    writeFileSync(join(internal, "helper.ts"), "export const helper = 1;\n");
    // Exists in src/, excluded from the tarball by the `files` negation above.
    writeFileSync(join(internal, "helper.test.ts"), "// fixture test\n");

    writeFileSync(join(src, "ok.ts"), "// See `internal/helper.ts` for the shape.\nexport const ok = 1;\n");
    writeFileSync(
      join(src, "unreachable.ts"),
      "// See `internal/helper.test.ts` for the exact checked shape.\nexport const a = 1;\n",
    );
    writeFileSync(join(src, "rot.ts"), "// Ported from `packages/retired/src/gone.ts`.\nexport const b = 1;\n");
    writeFileSync(
      join(src, "disclosed.ts"),
      [
        "/**",
        " * The range algorithm here is a hand port of the one in",
        " * `internal/helper.test.ts` — that file does not ship with this package,",
        " * so importing it would resolve nothing for a real consumer.",
        " */",
        "export const c = 1;",
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(src, "specifier.ts"),
      '// A module specifier is not a citation.\nimport { helper } from "./internal/helper.js";\nexport const d = helper;\n',
    );
    writeFileSync(
      join(src, "vocabulary.ts"),
      `// Reads \`${FIXTURE_SCOPE}/tokens/theme.css\` and $RUNNER_TEMP/receipt.json.\n` +
        "// Docs live at https://example.invalid/docs/DESIGN.md too.\nexport const e = 1;\n",
    );
    gitInit(dir);
    gitRetirePackageDir(dir, "retired");

    const r = run("node", [CONTAM, dir, "--class", "1", "--json"]);
    let report;
    try {
      report = JSON.parse(r.out);
    } catch {
      report = { findings: [], indeterminate: [] };
    }
    const findings = report.findings ?? [];
    const on = (f) => findings.filter((x) => x.file.split("/").join("/") === f);
    const cites = (f, path) => on(f).some((x) => x.detail.includes(`cites "${path}"`));

    check(
      "a .ts citation that exists in src/ but is excluded from the tarball IS a finding",
      cites("src/unreachable.ts", "internal/helper.test.ts"),
      `no finding for src/unreachable.ts: ${JSON.stringify(findings)}`,
    );
    check(
      "a .ts citation that resolves nowhere in the repository IS a finding",
      cites("src/rot.ts", "packages/retired/src/gone.ts"),
      `no finding for src/rot.ts: ${JSON.stringify(findings)}`,
    );
    check(
      "a citation to a path that actually ships is NOT a finding",
      on("src/ok.ts").length === 0,
      `src/ok.ts was flagged: ${JSON.stringify(on("src/ok.ts"))}`,
    );
    check(
      "a module specifier is not read as a citation",
      on("src/specifier.ts").length === 0,
      `src/specifier.ts was flagged: ${JSON.stringify(on("src/specifier.ts"))}`,
    );
    check(
      "a @scope subpath export, a $VAR path and an absolute URL are not citations",
      on("src/vocabulary.ts").length === 0,
      `src/vocabulary.ts was flagged: ${JSON.stringify(on("src/vocabulary.ts"))}`,
    );
    check("exits 1 overall on the planted citations", r.code === 1, `exit was ${r.code}: ${r.out.slice(0, 400)}`);

    // ---- the self-disclosing exception, and the bound that keeps it honest
    check(
      "a citation that discloses inline that it does not ship is NOT a finding",
      on("src/disclosed.ts").length === 0,
      `src/disclosed.ts was flagged: ${JSON.stringify(on("src/disclosed.ts"))}`,
    );

    // The bound. A "does not ship" qualifier is a claim about SHIPPING, so it
    // must not excuse a path that exists in no checkout at any commit — the
    // reader was still told to go and look, and there is nothing to find. If
    // this ever passes, the exemption has become a general-purpose mute and
    // the class has a suppression comment in all but name.
    const rotDir = join(work, "contam-class1-rot-disclosure");
    mkdirSync(join(rotDir, "src"), { recursive: true });
    writeFileSync(
      join(rotDir, "package.json"),
      JSON.stringify({ name: `${FIXTURE_SCOPE}/rot-disclosure`, version: "1.0.0", files: ["src"] }, null, 2) + "\n",
    );
    writeFileSync(
      join(rotDir, "src", "index.ts"),
      [
        "/**",
        " * Ported from `packages/retired/src/gone.ts` — that file does not ship",
        " * with this package, and this package's own (unshipped) test suite",
        " * confirms the port.",
        " */",
        "export const x = 1;",
        "",
      ].join("\n"),
    );
    gitInit(rotDir);
    gitRetirePackageDir(rotDir, "retired");
    const rot = run("node", [CONTAM, rotDir, "--class", "1", "--json"]);
    let rotReport;
    try {
      rotReport = JSON.parse(rot.out);
    } catch {
      rotReport = { findings: [] };
    }
    check(
      'a "does not ship" disclosure does NOT excuse a path that exists nowhere',
      (rotReport.findings ?? []).some((x) => x.detail.includes('cites "packages/retired/src/gone.ts"')),
      `rot was excused by a shipping disclosure: ${JSON.stringify(rotReport.findings)}`,
    );
  }

  // ---- the ROT exemption's own bounds: by file kind, and by sentence
  //
  // The rot vocabulary (`no longer exists`, `was deleted`, …) is the mirror of
  // the shipping vocabulary, but it CANNOT borrow the shipping one's
  // block-wide licence. A shipping qualifier's worst case is excusing a real,
  // findable file; a rot qualifier's worst case is excusing a pointer at
  // nothing. Searched block-wide it did exactly that: `does not exist`,
  // written in shipped source about a quoted `tsc` error and about a
  // validation rule, silently excused three genuine rot citations twenty
  // lines away — so they never reached the waiver either.
  //
  // Both halves of the bound are asserted here: shipped source can never
  // excuse rot by any wording, and inside a CHANGELOG the qualifier has to be
  // in the citation's OWN sentence, not merely the same entry. The file half
  // is a path, not a basename: only `CHANGELOG.md` at the scanned root and
  // `packages/<name>/CHANGELOG.md` qualify.
  console.log("\n# check-contamination-classes CLASS 1: the rot exemption is bounded by file kind and by sentence");
  {
    // (a) shipped source. The rot citation and an unrelated `no longer exists`
    // sentence sit in ONE comment block, twenty lines apart — the exact
    // arrangement that used to pass.
    const srcDir = join(work, "contam-class1-rot-block-source");
    mkdirSync(join(srcDir, "src"), { recursive: true });
    writeFileSync(
      join(srcDir, "package.json"),
      JSON.stringify({ name: `${FIXTURE_SCOPE}/rot-block-source`, version: "1.0.0", files: ["src"] }, null, 2) + "\n",
    );
    writeFileSync(
      join(srcDir, "src", "index.ts"),
      [
        "/**",
        " * Ported from `packages/retired/src/gone.ts` — read that file's header",
        " * before touching this one.",
        ...Array.from({ length: 20 }, (_, n) => ` * Filler line ${n + 1}, describing the port in detail.`),
        " * NOTE ON THE LEGACY CACHE: the v1 on-disk cache format no longer exists;",
        " * nothing reads it any more.",
        " */",
        "export const x = 1;",
        "",
      ].join("\n"),
    );
    gitInit(srcDir);
    gitRetirePackageDir(srcDir, "retired");
    const srcRun = run("node", [CONTAM, srcDir, "--class", "1", "--json"]);
    let srcReport;
    try {
      srcReport = JSON.parse(srcRun.out);
    } catch {
      srcReport = { findings: [] };
    }
    check(
      "a rot qualifier elsewhere in the same comment block does NOT excuse rot in shipped source",
      (srcReport.findings ?? []).some((x) => x.detail.includes('cites "packages/retired/src/gone.ts"')),
      `rot was excused block-wide in shipped source: ${JSON.stringify(srcReport.findings)}`,
    );
    check(
      "…and the run fails rather than passing clean",
      srcRun.code === 1,
      `exit was ${srcRun.code}: ${srcRun.out.slice(0, 400)}`,
    );

    // (b) a CHANGELOG. Same sentence exempts; a different sentence in the same
    // entry does not.
    const clDir = join(work, "contam-class1-rot-changelog");
    mkdirSync(join(clDir, "src"), { recursive: true });
    writeFileSync(
      join(clDir, "package.json"),
      JSON.stringify(
        { name: `${FIXTURE_SCOPE}/rot-changelog`, version: "1.0.0", files: ["src", "CHANGELOG.md"] },
        null,
        2,
      ) + "\n",
    );
    writeFileSync(join(clDir, "src", "index.ts"), "export const y = 1;\n");
    writeFileSync(
      join(clDir, "CHANGELOG.md"),
      [
        "# Changelog",
        "",
        "## [1.0.0] - 2026-01-01",
        "",
        "### Fixed",
        "",
        "- Dropped a citation of `packages/retired/src/gone.ts`, which no longer",
        "  exists at any commit in this repository.",
        "",
        "- Dropped a second citation, of `packages/retired/src/also-gone.ts`. The",
        "  path named in the entry above no longer exists, but that sentence says",
        "  nothing whatever about this one.",
        "",
      ].join("\n"),
    );
    gitInit(clDir);
    gitRetirePackageDir(clDir, "retired");
    const clRun = run("node", [CONTAM, clDir, "--class", "1", "--json"]);
    let clReport;
    try {
      clReport = JSON.parse(clRun.out);
    } catch {
      clReport = { findings: [] };
    }
    const clCites = (path) => (clReport.findings ?? []).some((x) => x.detail.includes(`cites "${path}"`));
    check(
      "a changelog entry that records its own citation as gone, in that sentence, is NOT a finding",
      !clCites("packages/retired/src/gone.ts"),
      `the same-sentence changelog disclosure was flagged: ${JSON.stringify(clReport.findings)}`,
    );
    check(
      "a rot qualifier in a DIFFERENT sentence of the same changelog entry does NOT excuse it",
      clCites("packages/retired/src/also-gone.ts"),
      `a different sentence excused rot in a changelog: ${JSON.stringify(clReport.findings)}`,
    );

    // (b2) where that changelog may live. The same-sentence disclosure above
    // is exempt only because it sits in `CHANGELOG.md` at the scanned root.
    // The identical disclosure in a nested path, or under any extension other
    // than `.md`, is still a finding. `packages/<name>/CHANGELOG.md` is the
    // other path that qualifies — one segment, Markdown, nothing deeper.
    const anchorDir = join(work, "contam-class1-rot-changelog-anchor");
    mkdirSync(join(anchorDir, "src"), { recursive: true });
    mkdirSync(join(anchorDir, "packages", "pkg", "src"), { recursive: true });
    writeFileSync(
      join(anchorDir, "package.json"),
      JSON.stringify(
        { name: `${FIXTURE_SCOPE}/rot-changelog-anchor`, version: "1.0.0", files: ["src", "packages"] },
        null,
        2,
      ) + "\n",
    );
    writeFileSync(join(anchorDir, "src", "index.ts"), "export const anchor = 1;\n");
    const anchorChangelog = [
      "# Changelog",
      "",
      "## [1.0.0] - 2026-01-01",
      "",
      "### Fixed",
      "",
      "- Dropped a citation of `packages/retired/src/gone.ts`, which no longer",
      "  exists at any commit in this repository.",
      "",
    ].join("\n");
    writeFileSync(join(anchorDir, "src", "CHANGELOG.md"), anchorChangelog);
    writeFileSync(join(anchorDir, "packages", "pkg", "src", "CHANGELOG.md"), anchorChangelog);
    writeFileSync(join(anchorDir, "packages", "pkg", "CHANGELOG.md"), anchorChangelog);
    writeFileSync(
      join(anchorDir, "src", "CHANGELOG.ts"),
      [
        "// Dropped a citation of `packages/retired/src/gone.ts`, which no longer",
        "// exists at any commit in this repository.",
        "export const anchorTs = 1;",
        "",
      ].join("\n"),
    );
    gitInit(anchorDir);
    gitRetirePackageDir(anchorDir, "retired");
    const anchorRun = run("node", [CONTAM, anchorDir, "--class", "1", "--json"]);
    let anchorReport;
    try {
      anchorReport = JSON.parse(anchorRun.out);
    } catch {
      anchorReport = { findings: [] };
    }
    const anchorCites = (file) =>
      (anchorReport.findings ?? []).some(
        (x) => x.file === file && x.detail.includes('cites "packages/retired/src/gone.ts"'),
      );
    check(
      "a same-sentence rot disclosure in src/CHANGELOG.md is STILL a finding — the exemption does not apply",
      anchorCites("src/CHANGELOG.md"),
      `src/CHANGELOG.md was exempted: ${JSON.stringify(anchorReport.findings)}`,
    );
    check(
      "a same-sentence rot disclosure in src/CHANGELOG.ts is STILL a finding",
      anchorCites("src/CHANGELOG.ts"),
      `src/CHANGELOG.ts was exempted: ${JSON.stringify(anchorReport.findings)}`,
    );
    check(
      "a same-sentence rot disclosure in packages/pkg/src/CHANGELOG.md is STILL a finding",
      anchorCites("packages/pkg/src/CHANGELOG.md"),
      `packages/pkg/src/CHANGELOG.md was exempted: ${JSON.stringify(anchorReport.findings)}`,
    );
    check(
      "a same-sentence rot disclosure in packages/pkg/CHANGELOG.md is NOT a finding",
      !anchorCites("packages/pkg/CHANGELOG.md"),
      `packages/pkg/CHANGELOG.md was flagged: ${JSON.stringify(anchorReport.findings)}`,
    );

    // (b3) the package changelog at docs/changelogs/<name>.md. It no longer
    // sits under the scanned package directory, and it must not leave this
    // gate with it: scanning packages/<name> also scans
    // docs/changelogs/<name>.md, judged exactly as packages/<name>/CHANGELOG.md
    // was (same-sentence rot disclosure still exempts; a different sentence
    // still does not), with findings reported under the real path. A bare
    // `CHANGELOG.md` inside that changelog names the changelog itself; the
    // same bare name in shipped package text still reports, since the
    // tarball no longer carries it.
    const compRepo = join(work, "contam-class1-companion-changelog");
    const compPkg = join(compRepo, "packages", "pkg");
    mkdirSync(join(compPkg, "src"), { recursive: true });
    mkdirSync(join(compRepo, "docs", "changelogs"), { recursive: true });
    writeFileSync(
      join(compPkg, "package.json"),
      JSON.stringify({ name: `${FIXTURE_SCOPE}/companion`, version: "1.0.0", files: ["src", "README.md"] }, null, 2) + "\n",
    );
    writeFileSync(join(compPkg, "src", "index.ts"), "export const companion = 1;\n");
    writeFileSync(join(compPkg, "README.md"), "# companion\n\nRelease notes are in CHANGELOG.md.\n");
    writeFileSync(
      join(compRepo, "docs", "changelogs", "pkg.md"),
      [
        "# Changelog",
        "",
        "## [1.0.0] - 2026-01-01",
        "",
        "### Fixed",
        "",
        "- Dropped a citation of `packages/retired/src/gone.ts`, which no longer",
        "  exists at any commit in this repository.",
        "",
        "- Dropped a second citation, of `packages/retired/src/also-gone.ts`. The",
        "  path named in the entry above no longer exists, but that sentence says",
        "  nothing whatever about this one.",
        "",
        "- Recorded this entry in `CHANGELOG.md`, as every release does.",
        "",
      ].join("\n"),
    );
    gitInit(compRepo);
    gitRetirePackageDir(compRepo, "retired");
    const compRun = run("node", [CONTAM, compPkg, "--class", "1", "--json"]);
    let compReport;
    try {
      compReport = JSON.parse(compRun.out);
    } catch {
      compReport = { findings: [] };
    }
    const compCites = (file, path) =>
      (compReport.findings ?? []).some((x) => x.file === file && x.detail.includes(`cites "${path}"`));
    check(
      "docs/changelogs/<name>.md is scanned with packages/<name>: rot in it is a finding, reported under its real path",
      compCites("docs/changelogs/pkg.md", "packages/retired/src/also-gone.ts"),
      `the moved changelog was not scanned: ${compRun.out.slice(0, 600)}`,
    );
    check(
      "…and a same-sentence rot disclosure in it is still exempt, exactly as in packages/<name>/CHANGELOG.md",
      !compCites("docs/changelogs/pkg.md", "packages/retired/src/gone.ts"),
      `the same-sentence disclosure was flagged in the moved changelog: ${JSON.stringify(compReport.findings)}`,
    );
    check(
      "…a bare `CHANGELOG.md` inside the moved changelog names itself and is not a finding",
      !compCites("docs/changelogs/pkg.md", "CHANGELOG.md"),
      `the changelog's self-reference was flagged: ${JSON.stringify(compReport.findings)}`,
    );
    check(
      "…but a bare `CHANGELOG.md` in shipped package text IS a finding — the tarball no longer carries one",
      compCites("README.md", "CHANGELOG.md"),
      `a shipped pointer at the removed in-package changelog was not flagged: ${JSON.stringify(compReport.findings)}`,
    );
    check("…and the run fails", compRun.code === 1, `exit was ${compRun.code}: ${compRun.out.slice(0, 400)}`);

    // Both an in-package CHANGELOG.md and docs/changelogs/<name>.md: two
    // files claim the one changelog position — refused, never guessed.
    writeFileSync(join(compPkg, "CHANGELOG.md"), "# Changelog\n");
    const bothRun = run("node", [CONTAM, compPkg, "--class", "1", "--json"]);
    check(
      "a package with BOTH its own CHANGELOG.md and docs/changelogs/<name>.md cannot run (exit 2)",
      bothRun.code === 2 && /a package changelog lives only at/.test(bothRun.out),
      `exit was ${bothRun.code}: ${bothRun.out.slice(0, 400)}`,
    );

    // (c) `packages/…` is a SHAPE, not proof of self-reference. A package whose
    // job is walking other repositories' `packages/` trees documents its own
    // parameters with placeholder paths that name the READER's tree — the same
    // case as `app/layout.tsx`, which this class already declines to claim.
    // Separated by identity (does this repository have, or have it ever had,
    // that package directory?), never by a list of placeholder names.
    const phDir = join(work, "contam-class1-packages-placeholder");
    mkdirSync(join(phDir, "src"), { recursive: true });
    writeFileSync(
      join(phDir, "package.json"),
      JSON.stringify({ name: `${FIXTURE_SCOPE}/placeholder`, version: "1.0.0", files: ["src"] }, null, 2) + "\n",
    );
    writeFileSync(
      join(phDir, "src", "depth.ts"),
      [
        "// `maxDepth` counts directory levels below the scanned root:",
        "// `packages/a/package.json` is depth 1; `packages/tier/foo/package.json`",
        "// is depth 2.",
        "export const maxDepth = 2;",
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(phDir, "src", "real.ts"),
      "// Ported from `packages/retired/src/gone.ts`.\nexport const z = 1;\n",
    );
    gitInit(phDir);
    gitRetirePackageDir(phDir, "retired");
    const phRun = run("node", [CONTAM, phDir, "--class", "1", "--json"]);
    let phReport;
    try {
      phReport = JSON.parse(phRun.out);
    } catch {
      phReport = { findings: [] };
    }
    const phFindings = phReport.findings ?? [];
    check(
      "a `packages/<dir>` citation naming a directory this repository never had is NOT claimed as rot",
      !phFindings.some((x) => x.file === "src/depth.ts"),
      `an illustrative placeholder was reported as rot: ${JSON.stringify(phFindings.filter((x) => x.file === "src/depth.ts"))}`,
    );
    check(
      "…while a `packages/<dir>` citation naming a directory it DID have still is",
      phFindings.some((x) => x.detail.includes('cites "packages/retired/src/gone.ts"')),
      `the retired-donor citation stopped being reported: ${JSON.stringify(phFindings)}`,
    );
  }

  // ------- check-contamination-classes CLASS 1: the surface, and the allowlist
  // Two properties that a widened extraction alone would not give:
  //
  //   `tsc` preserves comments, so the #927 citation reached dist/index.js and
  //   six .d.ts files — the copies a consumer actually reads — and no tree scan
  //   ever looked there.
  //
  //   The pre-existing instances this widening surfaces are waived, not fixed,
  //   so the waiver has to be a ratchet: it cannot grow, and an entry that
  //   stops matching anything has to be a finding, or a fixed citation leaves
  //   its waiver behind and the list never shrinks.
  console.log("\n# check-contamination-classes CLASS 1: built output, and the allowlist ratchet");
  {
    const dir = join(work, "contam-class1-surface");
    mkdirSync(join(dir, "src"), { recursive: true });
    mkdirSync(join(dir, "dist"), { recursive: true });
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify(
        { name: `${FIXTURE_SCOPE}/surface`, version: "1.0.0", files: ["dist", "src"] },
        null,
        2,
      ) + "\n",
    );
    writeFileSync(join(dir, "src", "index.ts"), "export const x = 1;\n");
    // Only in build output — the artifact surface, never a tracked file.
    writeFileSync(join(dir, "dist", "index.js"), "// See `packages/retired/src/gone.ts`.\nexport const x = 1;\n");
    writeFileSync(join(dir, ".gitignore"), "dist/\n");
    gitInit(dir);
    gitRetirePackageDir(dir, "retired");

    const tree = run("node", [CONTAM, dir, "--class", "1"]);
    check(
      "the default tree scan does not read gitignored build output",
      tree.code === 0,
      `default run exited ${tree.code}; if this now fails the default gained dist visibility — good, update this test`,
    );
    const built = run("node", [CONTAM, dir, "--class", "1", "--include-built"]);
    check(
      "--include-built CATCHES a citation that exists only in compiled output",
      built.code === 1 && built.out.includes('cites "packages/retired/src/gone.ts"'),
      `--include-built exited ${built.code} without the dist finding: ${built.out.slice(0, 400)}`,
    );

    const allowPath = join(dir, "allow.json");
    writeFileSync(
      allowPath,
      JSON.stringify(
        { issue: "#941", packages: { [basename(dir)]: { "dist/index.js": ["packages/retired/src/gone.ts"] } } },
        null,
        2,
      ) + "\n",
    );
    const waived = run("node", [CONTAM, dir, "--class", "1", "--include-built", "--allowlist", allowPath]);
    check(
      "an allowlisted citation passes, and the run says so rather than reporting a clean bill",
      waived.code === 0 && /KNOWN, WAIVED/.test(waived.out) && /not a clean one/.test(waived.out),
      `waived run exited ${waived.code}: ${waived.out.slice(0, 500)}`,
    );

    const stalePath = join(dir, "stale.json");
    writeFileSync(
      stalePath,
      JSON.stringify(
        {
          issue: "#941",
          packages: {
            [basename(dir)]: {
              "dist/index.js": ["packages/retired/src/gone.ts"],
              "src/index.ts": ["packages/retired/src/never-cited.ts"],
            },
          },
        },
        null,
        2,
      ) + "\n",
    );
    const stale = run("node", [CONTAM, dir, "--class", "1", "--include-built", "--allowlist", stalePath]);
    check(
      "a waiver that no longer matches anything is itself a finding (the list has to shrink)",
      stale.code === 1 && /never-cited\.ts/.test(stale.out),
      `stale waiver did not fail the gate; exit ${stale.code}: ${stale.out.slice(0, 500)}`,
    );
  }

  // ------- check-contamination-classes CLASS 1: src waiver mirrors to built output
  // When `tsc` copies a comment from src into dist, waiving only the source path
  // must waive the matching built artifact too — otherwise every src-only entry
  // regresses the moment --include-built is turned on.
  console.log("\n# check-contamination-classes CLASS 1: src waiver mirrors to built output");
  {
    const dir = join(work, "contam-class1-src-waiver-dist");
    mkdirSync(join(dir, "src"), { recursive: true });
    mkdirSync(join(dir, "dist"), { recursive: true });
    const citation = "// See `packages/retired/src/gone.ts`.\nexport const x = 1;\n";
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify(
        { name: `${FIXTURE_SCOPE}/src-waiver-dist`, version: "1.0.0", files: ["dist", "src"] },
        null,
        2,
      ) + "\n",
    );
    writeFileSync(join(dir, "src", "index.ts"), citation);
    writeFileSync(join(dir, "dist", "index.js"), citation);
    writeFileSync(join(dir, ".gitignore"), "dist/\n");
    gitInit(dir);
    gitRetirePackageDir(dir, "retired");

    const srcOnlyAllowPath = join(dir, "src-only-allow.json");
    writeFileSync(
      srcOnlyAllowPath,
      JSON.stringify(
        {
          issue: "#941",
          packages: { [basename(dir)]: { "src/index.ts": ["packages/retired/src/gone.ts"] } },
        },
        null,
        2,
      ) + "\n",
    );
    const srcWaived = run("node", [CONTAM, dir, "--class", "1", "--include-built", "--allowlist", srcOnlyAllowPath]);
    check(
      "a src-only allowlist entry waives the matching dist citation under --include-built",
      srcWaived.code === 0 && /KNOWN, WAIVED/.test(srcWaived.out) && /not a clean one/.test(srcWaived.out),
      `src-only waiver run exited ${srcWaived.code}: ${srcWaived.out.slice(0, 500)}`,
    );

    const noAllow = run("node", [CONTAM, dir, "--class", "1", "--include-built"]);
    check(
      "the same dist citation still fails with no allowlist when src is not waived",
      noAllow.code === 1 && noAllow.out.includes('cites "packages/retired/src/gone.ts"'),
      `unwaived run exited ${noAllow.code}: ${noAllow.out.slice(0, 500)}`,
    );

    const wrongSrcAllowPath = join(dir, "wrong-src-allow.json");
    writeFileSync(
      wrongSrcAllowPath,
      JSON.stringify(
        {
          issue: "#941",
          packages: {
            [basename(dir)]: { "src/index.ts": ["packages/retired/src/never-cited.ts"] },
          },
        },
        null,
        2,
      ) + "\n",
    );
    const wrongSrc = run("node", [CONTAM, dir, "--class", "1", "--include-built", "--allowlist", wrongSrcAllowPath]);
    check(
      "a src waiver for a path the files never cite is a stale-waiver finding",
      wrongSrc.code === 1 && /never-cited\.ts/.test(wrongSrc.out),
      `wrong src waiver run exited ${wrongSrc.code}: ${wrongSrc.out.slice(0, 500)}`,
    );

    writeFileSync(
      join(dir, "src", "invoke.ts"),
      "// CI runs `node packages/fixture/dist/cli.js`.\nexport const y = 1;\n",
    );
    const invoke = run("node", [CONTAM, dir, "--class", "1", "--include-built", "--allowlist", srcOnlyAllowPath]);
    check(
      "a src comment that names a gitignored dist invocation path is not ROT under --include-built",
      invoke.code === 0 && !invoke.out.includes('cites "packages/fixture/dist/cli.js"'),
      `dist-invocation citation was reported: exit ${invoke.code}: ${invoke.out.slice(0, 500)}`,
    );
  }

  // tsc copies `./peer.ts` from src/index.ts into dist/index.js. From src the
  // relative path ships (src is packed). From dist it looks for dist/peer.ts,
  // misses, and would report the packed src file as unreachable. The src-layout
  // remapping treats that copy as shipping without a #941 key.
  console.log("\n# check-contamination-classes CLASS 1: src-relative citation in dist ships via src layout");
  {
    const dir = join(work, "contam-class1-src-ships-dist");
    mkdirSync(join(dir, "src"), { recursive: true });
    mkdirSync(join(dir, "dist"), { recursive: true });
    const citation = "// See `./peer.ts` for the helper.\nexport const x = 1;\n";
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify(
        { name: `${FIXTURE_SCOPE}/src-ships-dist`, version: "1.0.0", files: ["dist", "src"] },
        null,
        2,
      ) + "\n",
    );
    writeFileSync(join(dir, "src", "index.ts"), citation);
    writeFileSync(join(dir, "src", "peer.ts"), "export const peer = 1;\n");
    writeFileSync(join(dir, "dist", "index.js"), citation);
    writeFileSync(join(dir, "dist", "peer.js"), "export const peer = 1;\n");
    gitInit(dir);
    const ships = run("node", [CONTAM, dir, "--class", "1", "--include-built"]);
    check(
      "a tsc-copied ./peer.ts citation in dist is not CLASS 1 when src/peer.ts ships",
      ships.code === 0 && !ships.out.includes('cites "./peer.ts"'),
      `src-ships-dist run exited ${ships.code}: ${ships.out.slice(0, 500)}`,
    );

    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify(
        { name: `${FIXTURE_SCOPE}/src-ships-dist`, version: "1.0.0", files: ["dist"] },
        null,
        2,
      ) + "\n",
    );
    const unpacked = run("node", [CONTAM, dir, "--class", "1", "--include-built"]);
    check(
      "a tsc-copied ./peer.ts citation in dist still fails when src/peer.ts is not packed",
      unpacked.code === 1 && unpacked.out.includes('cites "./peer.ts"'),
      `unpacked-src-peer run exited ${unpacked.code}: ${unpacked.out.slice(0, 500)}`,
    );
  }

  // --------------- check-contamination-classes CLASS 4: shallow clones fail closed
  // CLASS 4's git-history read for "did this repo ever publish that name" is
  // silently WRONG, not absent, on a shallow checkout: `git log` still
  // succeeds, it just can't see the commit where a retired package was ever
  // added. GitHub Actions' default checkout is shallow (fetch-depth 1) --
  // exactly the environment the previous case above never actually tested,
  // since this suite's own worktree always has full history. This case
  // builds a real shallow clone (local, via `file://`, so no network) of a
  // SYNTHETIC source repo the suite fully controls, so it pins the fix
  // against the actual failure mode rather than this worktree's incidental
  // full history.
  console.log("\n# check-contamination-classes CLASS 4: fails closed on a shallow clone, not a silent wrong answer");
  {
    const srcRepo = join(work, "class4-shallow-src");
    mkdirSync(join(srcRepo, "packages", "probe-lib"), { recursive: true });
    mkdirSync(join(srcRepo, "scripts"), { recursive: true });
    // The script reads git history rooted at wherever IT ITSELF lives (see
    // loadHistoricalPackageNames), so a real copy of it has to actually live
    // inside this synthetic repo to pick up ITS history instead of the real
    // repo's -- copying the file, not just referencing CONTAM's real path.
    cpSync(CONTAM, join(srcRepo, "scripts", "check-contamination-classes.mjs"));
    // ...along with the one module it imports (where a package changelog lives).
    mkdirSync(join(srcRepo, "scripts", "lib"), { recursive: true });
    cpSync(join(scriptDir, "lib", "changelog-location.mjs"), join(srcRepo, "scripts", "lib", "changelog-location.mjs"));
    writeFileSync(
      join(srcRepo, "packages", "probe-lib", "package.json"),
      JSON.stringify({ name: `${FIXTURE_SCOPE}/probe-lib`, version: "1.0.0" }, null, 2) + "\n",
    );
    run("git", ["-C", srcRepo, "init", "-q"]);
    gitCommit(srcRepo, "add probe-lib");
    run("git", ["-C", srcRepo, "rm", "-q", "-r", "packages/probe-lib"]); // retire it
    gitCommit(srcRepo, "retire probe-lib");
    const fullScript = join(srcRepo, "scripts", "check-contamination-classes.mjs");

    const shallowClone = join(work, "class4-shallow-clone");
    run("git", ["clone", "--depth", "1", `file://${srcRepo}`, shallowClone]);
    const shallowScript = join(shallowClone, "scripts", "check-contamination-classes.mjs");

    const fixtureDir = join(work, "class4-shallow-fixture");
    mkdirSync(fixtureDir, { recursive: true });
    writeFileSync(join(fixtureDir, "package.json"), JSON.stringify({ name: `${FIXTURE_SCOPE}/probe`, version: "1.0.0" }, null, 2) + "\n");
    writeFileSync(join(fixtureDir, "CHANGELOG.md"), `## 0.2.0\n- Removed \`${FIXTURE_SCOPE}/probe-lib\`.\n`);

    function parseReport(out) {
      try {
        return JSON.parse(out);
      } catch {
        return { findings: [], indeterminate: [] };
      }
    }

    // Sanity anchor: the SAME fixture, checked by the SAME script content
    // but from the un-cloned, full-history source repo, passes clean --
    // proves clone depth is the only variable in the shallow case below,
    // not some other difference between the two invocations.
    const fullRun = run("node", [fullScript, fixtureDir, "--class", "4", "--json"]);
    const fullReport = parseReport(fullRun.out);
    check(
      "sanity: the same CHANGELOG, checked with full history, passes clean",
      fullRun.code === 0 && (fullReport.findings ?? []).length === 0 && (fullReport.indeterminate ?? []).length === 0,
      `exit ${fullRun.code}: ${fullRun.out.slice(0, 300)}`,
    );

    const shallowRun = run("node", [shallowScript, fixtureDir, "--class", "4", "--json"]);
    const shallowReport = parseReport(shallowRun.out);
    check(
      "a shallow clone (fetch-depth 1) fails CLOSED (exit 2) on the same CHANGELOG -- neither a silent pass nor a false flag",
      shallowRun.code === 2,
      `exit was ${shallowRun.code}: ${shallowRun.out.slice(0, 300)}`,
    );
    check(
      "the shallow-clone run reports the case as indeterminate, not as a confirmed finding either way",
      (shallowReport.indeterminate ?? []).some((f) => f.file === "CHANGELOG.md") && (shallowReport.findings ?? []).length === 0,
      `report: ${JSON.stringify(shallowReport).slice(0, 300)}`,
    );

    // The one case that never needed history at all -- a live install
    // instruction for a name that isn't currently live -- must still
    // resolve determinately (exit 1) even from the SAME shallow clone.
    const instructionFixture = join(work, "class4-shallow-instruction-fixture");
    mkdirSync(instructionFixture, { recursive: true });
    writeFileSync(join(instructionFixture, "package.json"), JSON.stringify({ name: `${FIXTURE_SCOPE}/probe`, version: "1.0.0" }, null, 2) + "\n");
    writeFileSync(join(instructionFixture, "install.md"), `\`\`\`\nnpm install ${FIXTURE_SCOPE}/probe-lib\n\`\`\`\n`);
    const instructionRun = run("node", [shallowScript, instructionFixture, "--class", "4", "--json"]);
    const instructionReport = parseReport(instructionRun.out);
    check(
      "an install-instruction case still resolves determinately (exit 1) from the same shallow clone -- it never needed history",
      instructionRun.code === 1 && (instructionReport.indeterminate ?? []).length === 0,
      `exit ${instructionRun.code}: ${instructionRun.out.slice(0, 300)}`,
    );
  }

  // ---------------------------------------------------- check-readme-parity
  console.log("\n# check-readme-parity: README vs. real exports");
  {
    const dir = join(work, "readme-parity");

    function writePackage(name, indexTs, readmeMd, dependencies, peerDependencies) {
      const pkgDir = join(dir, name);
      mkdirSync(join(pkgDir, "src"), { recursive: true });
      const manifest = { name: `${FIXTURE_SCOPE}/${name}`, version: "1.0.0", private: false };
      if (dependencies) manifest.dependencies = dependencies;
      if (peerDependencies) manifest.peerDependencies = peerDependencies;
      writeFileSync(join(pkgDir, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
      writeFileSync(join(pkgDir, "src", "index.ts"), indexTs);
      writeFileSync(join(pkgDir, "README.md"), readmeMd);
      return pkgDir;
    }

    function parseJson(out) {
      try {
        return JSON.parse(out);
      } catch {
        return { findings: [] };
      }
    }

    // Happy path: every export documented, table entries real, examples use
    // the real package name.
    const clean = writePackage(
      "clean",
      `export const Foo = 1;\nexport type Bar = string;\n`,
      [
        "# clean",
        "",
        "```ts",
        `import { Foo } from "${FIXTURE_SCOPE}/clean";`,
        "```",
        "",
        "## API",
        "",
        "| Export | Type |",
        "| --- | --- |",
        "| `Foo` | number |",
        "",
        "Also exports the `Bar` type.",
        "",
      ].join("\n"),
    );
    const okRun = run("node", [READMEPARITY, clean, "--json"]);
    check("passes a README that fully documents real exports", okRun.code === 0, `exit ${okRun.code}: ${okRun.out.slice(0, 300)}`);

    // CHECK A: a real VALUE export that appears nowhere in the README.
    const undocumented = writePackage(
      "undocumented",
      `export const Foo = 1;\nexport const Baz = 2;\n`,
      ["# undocumented", "", "Only mentions `Foo`.", ""].join("\n"),
    );
    const undocRun = run("node", [READMEPARITY, undocumented, "--json"]);
    const undocReport = parseJson(undocRun.out);
    check(
      "CHECK A flags a value export missing from README entirely",
      undocRun.code === 1 && (undocReport.findings ?? []).some((f) => f.check === "A" && f.severity === "high" && /Baz/.test(f.message)),
      `exit ${undocRun.code}: ${undocRun.out.slice(0, 300)}`,
    );

    // Sanity for CHECK A's severity split: an undocumented TYPE-only export
    // is still recorded as a finding (proves the scan actually inspected
    // real exports, rather than passing on zero coverage) but is "low"
    // severity and must NOT fail the gate on its own.
    const typeOnly = writePackage(
      "type-only",
      // The parser only recognises the barrel re-export shape used
      // throughout this repo's real packages (`export type { X }`), not a
      // direct `export type X = ...` alias declaration — matching
      // src/index.ts in every real package here.
      `type Ghost = string;\nexport const Foo = 1;\nexport type { Ghost };\n`,
      ["# type-only", "", "Mentions `Foo` only.", ""].join("\n"),
    );
    const typeOnlyRun = run("node", [READMEPARITY, typeOnly, "--json"]);
    const typeOnlyReport = parseJson(typeOnlyRun.out);
    check(
      "an undocumented TYPE export is recorded as a low-severity finding",
      (typeOnlyReport.findings ?? []).some((f) => f.check === "A" && f.severity === "low" && /Ghost/.test(f.message)),
      `findings: ${JSON.stringify(typeOnlyReport.findings)}`,
    );
    check("a lone low-severity finding does not fail the gate", typeOnlyRun.code === 0, `exit was ${typeOnlyRun.code}`);

    // CHECK B: a copy-pasteable import/install line naming the WRONG
    // package under the same scope.
    const wrongName = writePackage(
      "wrong-name",
      `export const Foo = 1;\n`,
      [
        "# wrong-name",
        "",
        "```ts",
        `import { Foo } from "${FIXTURE_SCOPE}/not-this-package";`,
        "```",
        "",
        "Mentions `Foo`.",
        "",
      ].join("\n"),
    );
    const wrongNameRun = run("node", [READMEPARITY, wrongName, "--json"]);
    const wrongNameReport = parseJson(wrongNameRun.out);
    check(
      "CHECK B flags an import example naming the wrong package under this scope",
      wrongNameRun.code === 1 && (wrongNameReport.findings ?? []).some((f) => f.check === "B" && /not-this-package/.test(f.message)),
      `exit ${wrongNameRun.code}: ${wrongNameRun.out.slice(0, 300)}`,
    );

    // CHECK B regression: prose containing a word like "important" that
    // starts with the literal substring "import" must NOT be mistaken for an
    // `import` statement just because a `@scope/other-package` reference sits
    // on the same line. This is the exact shape that tripped the gate in
    // the former standalone media-registry README (worked around by rewording; see PR #53) —
    // a bare `\bimport` (no trailing boundary) matches "important" too.
    const proseImportant = writePackage(
      "prose-important",
      `export const Foo = 1;\n`,
      [
        "# prose-important",
        "",
        `See \`${FIXTURE_SCOPE}/other-package\`'s README, "The single most important constraint", for the fuller argument.`,
        "",
        "Mentions `Foo`.",
        "",
      ].join("\n"),
    );
    const proseImportantRun = run("node", [READMEPARITY, proseImportant, "--json"]);
    check(
      "CHECK B does not flag prose containing \"important\" alongside an unrelated @scope reference",
      proseImportantRun.code === 0,
      `exit ${proseImportantRun.code}: ${proseImportantRun.out.slice(0, 300)}`,
    );

    // CHECK C: the API table documents an export that does not exist.
    const phantom = writePackage(
      "phantom",
      `export const Foo = 1;\n`,
      [
        "# phantom",
        "",
        "Mentions `Foo`.",
        "",
        "## API",
        "",
        "| Export | Type |",
        "| --- | --- |",
        "| `Foo` | number |",
        "| `Ghost` | number |",
        "",
      ].join("\n"),
    );
    const phantomRun = run("node", [READMEPARITY, phantom, "--json"]);
    const phantomReport = parseJson(phantomRun.out);
    check(
      "CHECK C flags an API table row for an export that doesn't exist",
      phantomRun.code === 1 && (phantomReport.findings ?? []).some((f) => f.check === "C" && /Ghost/.test(f.message)),
      `exit ${phantomRun.code}: ${phantomRun.out.slice(0, 300)}`,
    );

    // CHECK D1: README claims "zero/no runtime dependencies" while the real
    // manifest declares a non-empty `dependencies` object -- the exact shape
    // that shipped, undetected, across five READMEs in this repo (catalog,
    // repository, review, gates, release) after they all started depending
    // on `@scope/governance` for real.
    const zeroDepsClaim = writePackage(
      "zero-deps-claim",
      `export const Foo = 1;\n`,
      [
        "# zero-deps-claim",
        "",
        "Mentions `Foo`.",
        "",
        "## Requirements",
        "",
        "Node 20+. ESM only. Zero runtime dependencies.",
        "",
      ].join("\n"),
      { [`${FIXTURE_SCOPE}/governance`]: "^0.2.0" },
    );
    const zeroDepsClaimRun = run("node", [READMEPARITY, zeroDepsClaim, "--json"]);
    const zeroDepsClaimReport = parseJson(zeroDepsClaimRun.out);
    check(
      'CHECK D flags "zero runtime dependencies" prose when package.json declares a real dependency',
      zeroDepsClaimRun.code === 1 &&
        (zeroDepsClaimReport.findings ?? []).some((f) => f.check === "D" && f.severity === "high" && /governance/.test(f.message)),
      `exit ${zeroDepsClaimRun.code}: ${zeroDepsClaimRun.out.slice(0, 300)}`,
    );

    // Regression: a "zero runtime dependencies" claim about a DIFFERENT
    // package, quoted as a worked example outside the "## Requirements"
    // section, must NOT be misread as a claim about this README's own
    // package -- this is the real false positive found by dogfooding CHECK D
    // against packages/release/README.md, which legitimately describes
    // packages/policy's clean round-trip result this way.
    const zeroDepsOtherPackage = writePackage(
      "zero-deps-other-package",
      `export const Foo = 1;\n`,
      [
        "# zero-deps-other-package",
        "",
        "Mentions `Foo`.",
        "",
        "## What this actually found",
        "",
        `**The clean case: \`packages/some-other-thing\`.** Zero runtime dependencies.`,
        "Packed and installed cleanly.",
        "",
        "## Requirements",
        "",
        `Node 20+. ESM only. Runtime dependency: \`${FIXTURE_SCOPE}/governance\`.`,
        "",
      ].join("\n"),
      { [`${FIXTURE_SCOPE}/governance`]: "^0.2.0" },
    );
    const zeroDepsOtherPackageRun = run("node", [READMEPARITY, zeroDepsOtherPackage, "--json"]);
    check(
      'CHECK D does not misread a "zero runtime dependencies" claim about a DIFFERENT package (outside "## Requirements") as a claim about this one',
      zeroDepsOtherPackageRun.code === 0,
      `exit ${zeroDepsOtherPackageRun.code}: ${zeroDepsOtherPackageRun.out.slice(0, 300)}`,
    );

    // Sanity: the identical claim is NOT a finding when it's actually true --
    // proves CHECK D reads the real manifest rather than reacting to the
    // phrase alone.
    const zeroDepsTrue = writePackage(
      "zero-deps-true",
      `export const Foo = 1;\n`,
      [
        "# zero-deps-true",
        "",
        "Mentions `Foo`.",
        "",
        "## Requirements",
        "",
        "Node 20+. ESM only. No runtime dependencies.",
        "",
      ].join("\n"),
    );
    const zeroDepsTrueRun = run("node", [READMEPARITY, zeroDepsTrue, "--json"]);
    check(
      'CHECK D does not flag "no runtime dependencies" when the manifest really has none',
      zeroDepsTrueRun.code === 0,
      `exit ${zeroDepsTrueRun.code}: ${zeroDepsTrueRun.out.slice(0, 300)}`,
    );

    // Fallback: a package with a real dependency and a "no runtime
    // dependencies" claim but NO "## Requirements" heading at all must still
    // be caught (whole-document fallback), so the section-scoping fix above
    // can't accidentally make CHECK D silent for a README that doesn't
    // follow this repo's own "## Requirements" convention.
    const zeroDepsNoHeading = writePackage(
      "zero-deps-no-heading",
      `export const Foo = 1;\n`,
      ["# zero-deps-no-heading", "", "Mentions `Foo`. This package has no runtime dependencies at all.", ""].join("\n"),
      { [`${FIXTURE_SCOPE}/governance`]: "^0.2.0" },
    );
    const zeroDepsNoHeadingRun = run("node", [READMEPARITY, zeroDepsNoHeading, "--json"]);
    check(
      'CHECK D still flags a "no runtime dependencies" claim in a README with no "## Requirements" heading at all (whole-document fallback)',
      zeroDepsNoHeadingRun.code === 1,
      `exit ${zeroDepsNoHeadingRun.code}: ${zeroDepsNoHeadingRun.out.slice(0, 300)}`,
    );

    // CHECK D2: a same-scope package named in "runtime dependencies" prose
    // that is not a key in the real manifest `dependencies` -- catches a
    // pre-consolidation dependency list (e.g. naming `catalog`/`policy`
    // after the real dependency changed to `governance`) without trying to
    // parse arbitrary English.
    const staleDepName = writePackage(
      "stale-dep-name",
      `export const Foo = 1;\n`,
      [
        "# stale-dep-name",
        "",
        "Mentions `Foo`.",
        "",
        "## Runtime availability",
        "",
        `\`stale-dep-name\` has runtime dependencies on \`${FIXTURE_SCOPE}/catalog\` and \`${FIXTURE_SCOPE}/policy\`.`,
        "",
      ].join("\n"),
      { [`${FIXTURE_SCOPE}/governance`]: "^0.2.0" },
    );
    const staleDepNameRun = run("node", [READMEPARITY, staleDepName, "--json"]);
    const staleDepNameReport = parseJson(staleDepNameRun.out);
    check(
      "CHECK D flags a same-scope package named as a runtime dependency that isn't actually in package.json's dependencies",
      staleDepNameRun.code === 1 &&
        (staleDepNameReport.findings ?? []).some((f) => f.check === "D" && new RegExp(`${FIXTURE_SCOPE}/catalog`).test(f.message)) &&
        (staleDepNameReport.findings ?? []).some((f) => f.check === "D" && new RegExp(`${FIXTURE_SCOPE}/policy`).test(f.message)),
      `exit ${staleDepNameRun.code}: ${staleDepNameRun.out.slice(0, 300)}`,
    );

    // Sanity: the same paragraph shape, but naming the package that is
    // ACTUALLY in `dependencies`, is clean -- proves CHECK D isn't just
    // flagging every scoped name mentioned near "runtime dependencies".
    const correctDepName = writePackage(
      "correct-dep-name",
      `export const Foo = 1;\n`,
      [
        "# correct-dep-name",
        "",
        "Mentions `Foo`.",
        "",
        "## Runtime availability",
        "",
        `\`correct-dep-name\` has a runtime dependency on \`${FIXTURE_SCOPE}/governance\`.`,
        "",
      ].join("\n"),
      { [`${FIXTURE_SCOPE}/governance`]: "^0.2.0" },
    );
    const correctDepNameRun = run("node", [READMEPARITY, correctDepName, "--json"]);
    check(
      "CHECK D does not flag a runtime-dependency mention that matches the real manifest",
      correctDepNameRun.code === 0,
      `exit ${correctDepNameRun.code}: ${correctDepNameRun.out.slice(0, 300)}`,
    );

    // Regression: an unrelated sentence that merely mentions another
    // same-scope package (not inside a "runtime dependencies" paragraph)
    // must NOT be treated as a dependency claim at all.
    const unrelatedMention = writePackage(
      "unrelated-mention",
      `export const Foo = 1;\n`,
      [
        "# unrelated-mention",
        "",
        "Mentions `Foo`.",
        "",
        `See \`${FIXTURE_SCOPE}/other-package\`'s README for the fuller argument about an unrelated topic.`,
        "",
      ].join("\n"),
    );
    const unrelatedMentionRun = run("node", [READMEPARITY, unrelatedMention, "--json"]);
    check(
      'CHECK D ignores a same-scope package mention outside any "runtime dependencies" paragraph',
      unrelatedMentionRun.code === 0,
      `exit ${unrelatedMentionRun.code}: ${unrelatedMentionRun.out.slice(0, 300)}`,
    );

    // Regression: a real false positive found by dogfooding the old,
    // paragraph-wide CHECK D2 against packages/strategy/README.md -- a
    // purely rhetorical COMPARISON naming several sibling packages that all
    // happen to have zero runtime dependencies of their own, sharing a
    // paragraph with the bare phrase "runtime dependencies" that never
    // introduces a declaration about THIS package at all (no ":" or "on"
    // right after it). None of the named siblings are in this package's own
    // `dependencies`, so the old heuristic misread this as three stale
    // dependency claims. Must be entirely clean.
    const comparativeSiblings = writePackage(
      "comparative-siblings",
      `export const Foo = 1;\n`,
      [
        "# comparative-siblings",
        "",
        "Mentions `Foo`.",
        "",
        "Validation here is hand-rolled on purpose, not built on a schema",
        `library: \`${FIXTURE_SCOPE}/catalog\`, \`${FIXTURE_SCOPE}/policy\`, and`,
        `\`${FIXTURE_SCOPE}/ui-tokens\` all ship with **zero** runtime`,
        "dependencies, and this package's own pitch is only really true if",
        "installing it doesn't also mean resolving a schema library's own",
        "major version into a consumer's tree.",
        "",
      ].join("\n"),
    );
    const comparativeSiblingsRun = run("node", [READMEPARITY, comparativeSiblings, "--json"]);
    check(
      'CHECK D2 does not flag a rhetorical comparison ("all ship with zero runtime dependencies") naming sibling packages',
      comparativeSiblingsRun.code === 0,
      `exit ${comparativeSiblingsRun.code}: ${comparativeSiblingsRun.out.slice(0, 300)}`,
    );

    // Regression: a real false positive found by dogfooding the old CHECK D2
    // against packages/ui/README.md -- a BOUNDARY statement ("X belongs to
    // sibling A; Y belongs to sibling B") sharing a paragraph with the
    // phrase "runtime dependencies" is not a dependency claim about this
    // package at all. Must be entirely clean.
    const boundaryStatement = writePackage(
      "boundary-statement",
      `export const Foo = 1;\n`,
      [
        "# boundary-statement",
        "",
        "Mentions `Foo`.",
        "",
        "`boundary-statement` never exports page views, routes, metadata,",
        "strategy facts, or copy. Components receive resolved props.",
        "Product/page composition belongs to",
        `\`${FIXTURE_SCOPE}/surface\`; audience-facing words belong to`,
        `\`${FIXTURE_SCOPE}/copy\`.`,
        "",
        "## Requirements",
        "",
        "Node 20+. ESM only. No regular runtime dependencies. React and",
        "friends are optional peers.",
        "",
      ].join("\n"),
    );
    const boundaryStatementRun = run("node", [READMEPARITY, boundaryStatement, "--json"]);
    check(
      'CHECK D2 does not flag a boundary statement ("belongs to `@scope/x`") sharing a paragraph with "runtime dependencies"',
      boundaryStatementRun.code === 0,
      `exit ${boundaryStatementRun.code}: ${boundaryStatementRun.out.slice(0, 300)}`,
    );

    // CHECK D2 positive: a real declaration clause naming TWO packages that
    // are both absent from the real manifest must fail, naming both.
    const staleDepPair = writePackage(
      "stale-dep-pair",
      `export const Foo = 1;\n`,
      [
        "# stale-dep-pair",
        "",
        "Mentions `Foo`.",
        "",
        "## Requirements",
        "",
        `Node 20+. ESM only. Runtime dependencies: \`${FIXTURE_SCOPE}/a\` and \`${FIXTURE_SCOPE}/b\`.`,
        "",
      ].join("\n"),
    );
    const staleDepPairRun = run("node", [READMEPARITY, staleDepPair, "--json"]);
    const staleDepPairReport = parseJson(staleDepPairRun.out);
    check(
      'CHECK D2 flags "Runtime dependencies: `@scope/a` and `@scope/b`." naming both, when neither is in the manifest',
      staleDepPairRun.code === 1 &&
        (staleDepPairReport.findings ?? []).some((f) => f.check === "D" && new RegExp(`${FIXTURE_SCOPE}/a\\b`).test(f.message)) &&
        (staleDepPairReport.findings ?? []).some((f) => f.check === "D" && new RegExp(`${FIXTURE_SCOPE}/b\\b`).test(f.message)),
      `exit ${staleDepPairRun.code}: ${staleDepPairRun.out.slice(0, 300)}`,
    );

    // CHECK D2 positive: a real declaration clause naming a package WITH a
    // range attached, where the name IS a real dependency, must pass.
    const declaredWithRange = writePackage(
      "declared-with-range",
      `export const Foo = 1;\n`,
      [
        "# declared-with-range",
        "",
        "Mentions `Foo`.",
        "",
        "## Requirements",
        "",
        `Node 20+. ESM only. Runtime dependency: \`${FIXTURE_SCOPE}/a\` (\`^1.0.0\`).`,
        "",
      ].join("\n"),
      { [`${FIXTURE_SCOPE}/a`]: "^1.0.0" },
    );
    const declaredWithRangeRun = run("node", [READMEPARITY, declaredWithRange, "--json"]);
    check(
      "CHECK D2 does not flag a declared dependency with a matching range",
      declaredWithRangeRun.code === 0,
      `exit ${declaredWithRangeRun.code}: ${declaredWithRangeRun.out.slice(0, 300)}`,
    );

    // CHECK D3: the right package, cited with the right range, is clean.
    // This is the real prose shape (packages/*/README.md's "Requirements"
    // section): a backticked package name immediately followed by a
    // backticked, parenthesized range, on the same line.
    const rangeMatch = writePackage(
      "range-match",
      `export const Foo = 1;\n`,
      [
        "# range-match",
        "",
        "Mentions `Foo`.",
        "",
        "## Requirements",
        "",
        `Node 20+. ESM only. Runtime dependency: \`${FIXTURE_SCOPE}/governance\` (\`^0.3.0\`), which this package re-exports from.`,
        "",
      ].join("\n"),
      { [`${FIXTURE_SCOPE}/governance`]: "^0.3.0" },
    );
    const rangeMatchRun = run("node", [READMEPARITY, rangeMatch, "--json"]);
    check(
      "CHECK D3 does not flag a README range that matches the manifest",
      rangeMatchRun.code === 0,
      `exit ${rangeMatchRun.code}: ${rangeMatchRun.out.slice(0, 300)}`,
    );

    // CHECK D3's actual incident, reproduced exactly: the README still says
    // the OLD range (`^0.2.0`) after the manifest moved to `^0.3.0`. This is
    // the shape that shipped undetected across five READMEs -- D1 and D2
    // both pass it (the right package is named, and "zero dependencies" is
    // never claimed), so only a check that reads the range itself can catch
    // it. The failure message must name the package and both ranges.
    const rangeStale = writePackage(
      "range-stale",
      `export const Foo = 1;\n`,
      [
        "# range-stale",
        "",
        "Mentions `Foo`.",
        "",
        "## Requirements",
        "",
        `Node 20+. ESM only. Runtime dependency: \`${FIXTURE_SCOPE}/governance\` (\`^0.2.0\`), which this package re-exports from.`,
        "",
      ].join("\n"),
      { [`${FIXTURE_SCOPE}/governance`]: "^0.3.0" },
    );
    const rangeStaleRun = run("node", [READMEPARITY, rangeStale, "--json"]);
    const rangeStaleReport = parseJson(rangeStaleRun.out);
    check(
      "CHECK D3 flags a stale README range and names both the claimed and real range",
      rangeStaleRun.code === 1 &&
        (rangeStaleReport.findings ?? []).some(
          (f) => f.check === "D" && f.severity === "high" && /governance/.test(f.message) && /\^0\.2\.0/.test(f.message) && /\^0\.3\.0/.test(f.message),
        ),
      `exit ${rangeStaleRun.code}: ${rangeStaleRun.out.slice(0, 300)}`,
    );

    // CHECK D3 must NOT invent a documentation burden: naming a dependency
    // with no range attached at all is exactly as valid as it is for D2,
    // and must stay clean.
    const rangeNone = writePackage(
      "range-none",
      `export const Foo = 1;\n`,
      [
        "# range-none",
        "",
        "Mentions `Foo`.",
        "",
        "## Requirements",
        "",
        `Node 20+. ESM only. Runtime dependency: \`${FIXTURE_SCOPE}/governance\`, which this package re-exports from.`,
        "",
      ].join("\n"),
      { [`${FIXTURE_SCOPE}/governance`]: "^0.3.0" },
    );
    const rangeNoneRun = run("node", [READMEPARITY, rangeNone, "--json"]);
    check(
      "CHECK D3 does not require a README that names a dependency to also state its range",
      rangeNoneRun.code === 0,
      `exit ${rangeNoneRun.code}: ${rangeNoneRun.out.slice(0, 300)}`,
    );

    // CHECK D3 across a line break, matching -- the actual real-world prose
    // shape (packages/catalog/README.md:164-165): the package name ends one
    // line, and "(`range`)" opens the next.
    const rangeMatchBroken = writePackage(
      "range-match-broken",
      `export const Foo = 1;\n`,
      [
        "# range-match-broken",
        "",
        "Mentions `Foo`.",
        "",
        "## Requirements",
        "",
        `Node 20+. ESM only. Runtime dependency: \`${FIXTURE_SCOPE}/governance\``,
        "(`^0.3.0`), which this package re-exports from.",
        "",
      ].join("\n"),
      { [`${FIXTURE_SCOPE}/governance`]: "^0.3.0" },
    );
    const rangeMatchBrokenRun = run("node", [READMEPARITY, rangeMatchBroken, "--json"]);
    check(
      "CHECK D3 matches a package name and its range even when a line break separates them",
      rangeMatchBrokenRun.code === 0,
      `exit ${rangeMatchBrokenRun.code}: ${rangeMatchBrokenRun.out.slice(0, 300)}`,
    );

    // CHECK D3 across a line break, stale -- same line-break shape as above,
    // but the range itself is wrong.
    const rangeStaleBroken = writePackage(
      "range-stale-broken",
      `export const Foo = 1;\n`,
      [
        "# range-stale-broken",
        "",
        "Mentions `Foo`.",
        "",
        "## Requirements",
        "",
        `Node 20+. ESM only. Runtime dependency: \`${FIXTURE_SCOPE}/governance\``,
        "(`^0.2.0`), which this package re-exports from.",
        "",
      ].join("\n"),
      { [`${FIXTURE_SCOPE}/governance`]: "^0.3.0" },
    );
    const rangeStaleBrokenRun = run("node", [READMEPARITY, rangeStaleBroken, "--json"]);
    const rangeStaleBrokenReport = parseJson(rangeStaleBrokenRun.out);
    check(
      "CHECK D3 flags a stale range even when a line break separates the package name from it",
      rangeStaleBrokenRun.code === 1 &&
        (rangeStaleBrokenReport.findings ?? []).some(
          (f) => f.check === "D" && /\^0\.2\.0/.test(f.message) && /\^0\.3\.0/.test(f.message),
        ),
      `exit ${rangeStaleBrokenRun.code}: ${rangeStaleBrokenRun.out.slice(0, 300)}`,
    );

    // CHECK D3 covers peerDependencies too, not just dependencies -- a stale
    // peer range misleads identically, and the real-world phrasing for a
    // peer ("Peer dependency: ...") never says "runtime dependency" at all,
    // so this also proves D3 isn't accidentally riding on D2's
    // "runtime dependenc(y|ies)" paragraph anchor.
    const peerStale = writePackage(
      "peer-stale",
      `export const Foo = 1;\n`,
      [
        "# peer-stale",
        "",
        "Mentions `Foo`.",
        "",
        "## Requirements",
        "",
        `Node 20+. ESM only. Peer dependency: \`${FIXTURE_SCOPE}/governance\` (\`^0.2.0\`).`,
        "",
      ].join("\n"),
      undefined,
      { [`${FIXTURE_SCOPE}/governance`]: "^0.3.0" },
    );
    const peerStaleRun = run("node", [READMEPARITY, peerStale, "--json"]);
    const peerStaleReport = parseJson(peerStaleRun.out);
    check(
      "CHECK D3 flags a stale range in a peerDependencies entry",
      peerStaleRun.code === 1 &&
        (peerStaleReport.findings ?? []).some(
          (f) => f.check === "D" && /governance/.test(f.message) && /\^0\.2\.0/.test(f.message) && /\^0\.3\.0/.test(f.message),
        ),
      `exit ${peerStaleRun.code}: ${peerStaleRun.out.slice(0, 300)}`,
    );

    // Fail-closed: a package directory missing a required file must abort
    // (exit 2), never report a silent pass.
    const missing = join(dir, "missing-readme");
    mkdirSync(join(missing, "src"), { recursive: true });
    writeFileSync(join(missing, "package.json"), JSON.stringify({ name: `${FIXTURE_SCOPE}/missing-readme` }) + "\n");
    writeFileSync(join(missing, "src", "index.ts"), "export const Foo = 1;\n");
    const missingRun = run("node", [READMEPARITY, missing]);
    check("aborts (exit 2) when README.md is absent", missingRun.code === 2, `exit was ${missingRun.code}`);
  }

  // ---------------------------- set-scope: scope rename, not name capture (issue #9)
  console.log("\n# set-scope: a third-party name sharing a first-party package name (issue #9)");
  {
    // set-scope.mjs resolves its own repo root from its own file location
    // (dirname(import.meta.url) + ".."), not from a CLI argument like the
    // other gates take — so exercising it hermetically means giving it its
    // own fixture repo, with its own copy of the script, rather than pointing
    // it at a fixture directory the way SAFETY/ARTIFACT/CONTAM are pointed.
    const dir = join(work, "set-scope-names");
    mkdirSync(join(dir, "packages", "ui"), { recursive: true });
    mkdirSync(join(dir, "scripts"), { recursive: true });
    cpSync(SET_SCOPE, join(dir, "scripts", "set-scope.mjs"));
    writeFileSync(
      join(dir, "package-scope.json"),
      JSON.stringify({ scope: "@fixture-first-party", registry: "https://example.invalid" }, null, 2) + "\n",
    );
    writeFileSync(
      join(dir, "packages", "ui", "package.json"),
      JSON.stringify({ name: "@fixture-first-party/ui", version: "1.0.0" }, null, 2) + "\n",
    );
    // The whole point: a THIRD-PARTY package whose local name ("ui") happens
    // to collide with a package we own, sitting in a lockfile-shaped file —
    // exactly the shape of the real corruption (@vitest/ui, in
    // package-lock.json's own peerDependencies, rewritten to
    // @example/ui). Nothing here carries our declared scope.
    writeFileSync(
      join(dir, "package-lock.json"),
      JSON.stringify({ packages: { "node_modules/@some-other-vendor/ui": { peerDependencies: { "@some-other-vendor/ui": "4.1.10" } } } }, null, 2) + "\n",
    );
    gitInit(dir);

    const before = readFileSync(join(dir, "package-lock.json"), "utf8");
    const check1 = run("node", [join(dir, "scripts", "set-scope.mjs"), "--check"], { cwd: dir });
    check(
      "--check does not flag a third-party name sharing a first-party package name",
      check1.code === 0,
      `expected exit 0, got ${check1.code}: ${check1.out}`,
    );

    // Also run the rewrite for real (no --check) and confirm the file on disk
    // is byte-for-byte unchanged — --check passing is not enough on its own,
    // since a bug in --check's own logic could mask a bug in the rewrite.
    run("node", [join(dir, "scripts", "set-scope.mjs")], { cwd: dir });
    const after = readFileSync(join(dir, "package-lock.json"), "utf8");
    check(
      "the rewrite itself never touches the third-party reference",
      after === before,
      "package-lock.json changed even though nothing in it carries our declared scope",
    );
    check(
      "the third-party scope is still intact",
      after.includes("@some-other-vendor/ui") && !after.includes("@fixture-first-party/ui\":") ,
      `expected @some-other-vendor/ui to survive untouched, got: ${after}`,
    );
  }

  // --------------------------- set-scope: walk skips gitignored paths (issue #25)
  console.log("\n# set-scope: walk never descends into gitignored paths, e.g. .claude/ (issue #25)");
  {
    const dir = join(work, "set-scope-gitignore");
    mkdirSync(join(dir, "packages", "probe"), { recursive: true });
    mkdirSync(join(dir, "scripts"), { recursive: true });
    cpSync(SET_SCOPE, join(dir, "scripts", "set-scope.mjs"));
    writeFileSync(join(dir, ".gitignore"), ".claude/\n");
    writeFileSync(
      join(dir, "package-scope.json"),
      JSON.stringify({ scope: "@fixture-old-scope", registry: "https://example.invalid" }, null, 2) + "\n",
    );
    writeFileSync(
      join(dir, "packages", "probe", "package.json"),
      JSON.stringify({ name: "@fixture-old-scope/probe", version: "1.0.0" }, null, 2) + "\n",
    );
    // A file sitting inside a gitignored directory — modelling another
    // agent's live, uncommitted worktree under .claude/ — that legitimately
    // carries the declared scope and so WOULD be rewritten by a scope rename
    // if the walk ever reached it. gitInit's `git add -A` will not stage
    // this: .gitignore already excludes .claude/, exactly like the real repo.
    mkdirSync(join(dir, ".claude", "worktrees", "foreign-session", "packages", "probe"), { recursive: true });
    writeFileSync(
      join(dir, ".claude", "worktrees", "foreign-session", "packages", "probe", "package.json"),
      JSON.stringify({ name: "@fixture-old-scope/probe", version: "1.0.0" }, null, 2) + "\n",
    );
    gitInit(dir);

    const r = run("node", [join(dir, "scripts", "set-scope.mjs"), "--scope", "@fixture-new-scope"], { cwd: dir });
    check("a real scope rename still exits cleanly", r.code === 0, `exit was ${r.code}: ${r.out}`);

    const tracked = readFileSync(join(dir, "packages", "probe", "package.json"), "utf8");
    check(
      "the rename still applies to a tracked, non-ignored file",
      tracked.includes("@fixture-new-scope/probe"),
      `tracked package.json was not renamed: ${tracked}`,
    );

    const foreign = readFileSync(
      join(dir, ".claude", "worktrees", "foreign-session", "packages", "probe", "package.json"),
      "utf8",
    );
    check(
      "a file inside a gitignored directory (.claude/) is left untouched",
      foreign.includes("@fixture-old-scope/probe") && !foreign.includes("@fixture-new-scope"),
      `expected the foreign worktree's file to be untouched by the rename, got: ${foreign}`,
    );

    // This case is deliberately only exercised via --scope, not bare --check:
    // with the scope-anchored regex (issue #9's fix), bare --check's tree-wide
    // rewrite maps @declaredScope/x to @declaredScope/x -- an identity
    // transform regardless of what walk() returns -- so .claude/'s contents
    // cannot affect a bare --check's outcome at all, by construction, not
    // because walk() is untested. The --scope rename is the only operation
    // where walk() reaching .claude/ has any observable effect (writing into
    // a foreign worktree), which is exactly what this case pins.
  }

  // ------------------- set-scope: bare --check must not be vacuous (regression)
  //
  // The bug this section exists to pin: with no --scope override, line ~42's
  // nextScope defaults to config.scope, and oldScope (read a few lines later)
  // is also config.scope -- the same string. The tree-wide rewrite's replace
  // then maps every match to itself, `changed` is always empty, and a version
  // of this script that relied on `changed` alone for --check's verdict would
  // report a clean pass on ANY tree, forever, including one where every
  // package name is wrong -- CI's `check:scope` step runs exactly this bare
  // form. The structural check (reading each packages/*/package.json's own
  // `name` directly) is what actually closes this.
  console.log("\n# set-scope: bare --check (no --scope) still catches a wrong-scope package name");
  {
    const dir = join(work, "set-scope-vacuous-check");
    mkdirSync(join(dir, "packages", "ui"), { recursive: true });
    mkdirSync(join(dir, "scripts"), { recursive: true });
    cpSync(SET_SCOPE, join(dir, "scripts", "set-scope.mjs"));
    writeFileSync(
      join(dir, "package-scope.json"),
      JSON.stringify({ scope: "@real", registry: "https://example.invalid" }, null, 2) + "\n",
    );
    // Wrong scope, hand-typed. This never carried the declared scope to begin
    // with, so the text-rewrite regex (anchored on @real/, issue #9's fix)
    // never even matches it -- it is invisible to the rewrite/check path by
    // construction, which is exactly why the structural check has to exist.
    writeFileSync(
      join(dir, "packages", "ui", "package.json"),
      JSON.stringify({ name: "@wrong/ui", version: "1.0.0" }, null, 2) + "\n",
    );
    gitInit(dir);

    const r = run("node", [join(dir, "scripts", "set-scope.mjs"), "--check"], { cwd: dir });
    check(
      "bare --check fails when a package's own name carries the wrong scope",
      r.code === 1,
      `expected exit 1, got ${r.code}: ${r.out}`,
    );
    check(
      "the failure names the offending package and its actual (wrong) name",
      /packages\/ui\/package\.json/.test(r.out) && /@wrong\/ui/.test(r.out),
      `expected the finding to name packages/ui/package.json and @wrong/ui, got: ${r.out}`,
    );
  }

  // --------------------------- set-scope: structural check fails closed (issue #9 review)
  console.log("\n# set-scope: the structural check fails closed, never green on \"could not check\"");
  {
    // "Could not check" (packages/ missing or empty) must exit 2, not 0 --
    // silently passing over zero packages is the same shape of bug (a check
    // that can never fail) this file was just fixed for, one layer up.
    const zeroDir = join(work, "set-scope-zero-packages");
    mkdirSync(join(zeroDir, "scripts"), { recursive: true });
    cpSync(SET_SCOPE, join(zeroDir, "scripts", "set-scope.mjs"));
    writeFileSync(
      join(zeroDir, "package-scope.json"),
      JSON.stringify({ scope: "@real", registry: "https://example.invalid" }, null, 2) + "\n",
    );
    // No packages/ directory at all.
    gitInit(zeroDir);
    const zeroResult = run("node", [join(zeroDir, "scripts", "set-scope.mjs"), "--check"], { cwd: zeroDir });
    check(
      "zero packages under packages/ exits 2, not 0",
      zeroResult.code === 2,
      `expected exit 2, got ${zeroResult.code}: ${zeroResult.out}`,
    );

    // A package.json that exists but has no "name" field: also "could not
    // check", also exit 2 -- never silently skipped as if it matched.
    const noNameDir = join(work, "set-scope-missing-name");
    mkdirSync(join(noNameDir, "packages", "ui"), { recursive: true });
    mkdirSync(join(noNameDir, "scripts"), { recursive: true });
    cpSync(SET_SCOPE, join(noNameDir, "scripts", "set-scope.mjs"));
    writeFileSync(
      join(noNameDir, "package-scope.json"),
      JSON.stringify({ scope: "@real", registry: "https://example.invalid" }, null, 2) + "\n",
    );
    writeFileSync(join(noNameDir, "packages", "ui", "package.json"), JSON.stringify({ version: "1.0.0" }, null, 2) + "\n");
    gitInit(noNameDir);
    const noNameResult = run("node", [join(noNameDir, "scripts", "set-scope.mjs"), "--check"], { cwd: noNameDir });
    check(
      'a package.json with no "name" field exits 2, not 0',
      noNameResult.code === 2,
      `expected exit 2, got ${noNameResult.code}: ${noNameResult.out}`,
    );

    // Contrast: a genuinely clean, fully-checkable tree still exits 0 — the
    // fail-closed cases above are about ambiguity, not about the gate being
    // generally trigger-happy.
    const cleanDir = join(work, "set-scope-clean-for-contrast");
    mkdirSync(join(cleanDir, "packages", "ui"), { recursive: true });
    mkdirSync(join(cleanDir, "scripts"), { recursive: true });
    cpSync(SET_SCOPE, join(cleanDir, "scripts", "set-scope.mjs"));
    writeFileSync(
      join(cleanDir, "package-scope.json"),
      JSON.stringify({ scope: "@real", registry: "https://example.invalid" }, null, 2) + "\n",
    );
    writeFileSync(
      join(cleanDir, "packages", "ui", "package.json"),
      JSON.stringify({ name: "@real/ui", version: "1.0.0" }, null, 2) + "\n",
    );
    gitInit(cleanDir);
    const cleanResult = run("node", [join(cleanDir, "scripts", "set-scope.mjs"), "--check"], { cwd: cleanDir });
    check(
      "a genuinely clean, fully-checkable tree still exits 0",
      cleanResult.code === 0,
      `expected exit 0, got ${cleanResult.code}: ${cleanResult.out}`,
    );

    // A removed package can leave only ignored build output behind in a
    // worktree. That directory is not a package and must not make the scope
    // checker demand a manifest, while a tracked or nonignored directory
    // without one remains fail-closed above.
    const ignoredOnlyDir = join(work, "set-scope-ignored-only-remnant");
    mkdirSync(join(ignoredOnlyDir, "packages", "ui"), { recursive: true });
    mkdirSync(join(ignoredOnlyDir, "packages", "stale", "dist"), { recursive: true });
    mkdirSync(join(ignoredOnlyDir, "scripts"), { recursive: true });
    cpSync(SET_SCOPE, join(ignoredOnlyDir, "scripts", "set-scope.mjs"));
    writeFileSync(join(ignoredOnlyDir, ".gitignore"), "packages/stale/dist/\n");
    writeFileSync(
      join(ignoredOnlyDir, "package-scope.json"),
      JSON.stringify({ scope: "@real", registry: "https://example.invalid" }, null, 2) + "\n",
    );
    writeFileSync(
      join(ignoredOnlyDir, "packages", "ui", "package.json"),
      JSON.stringify({ name: "@real/ui", version: "1.0.0" }, null, 2) + "\n",
    );
    writeFileSync(join(ignoredOnlyDir, "packages", "stale", "dist", "placeholder"), "generated\n");
    gitInit(ignoredOnlyDir);
    const ignoredOnlyResult = run("node", [join(ignoredOnlyDir, "scripts", "set-scope.mjs"), "--check"], { cwd: ignoredOnlyDir });
    check(
      "an ignored-only package-directory remnant is not treated as a package",
      ignoredOnlyResult.code === 0,
      `expected exit 0, got ${ignoredOnlyResult.code}: ${ignoredOnlyResult.out}`,
    );

    // A tracked package removed in the working tree is a deliberate
    // retirement. It must not be treated as a malformed live package merely
    // because `git ls-files --cached` still sees its former manifest.
    const retiredDir = join(work, "set-scope-retired-package");
    mkdirSync(join(retiredDir, "packages", "current"), { recursive: true });
    mkdirSync(join(retiredDir, "packages", "retired"), { recursive: true });
    mkdirSync(join(retiredDir, "scripts"), { recursive: true });
    cpSync(SET_SCOPE, join(retiredDir, "scripts", "set-scope.mjs"));
    writeFileSync(
      join(retiredDir, "package-scope.json"),
      JSON.stringify({ scope: "@real", registry: "https://example.invalid" }, null, 2) + "\n",
    );
    writeFileSync(join(retiredDir, "packages", "current", "package.json"), JSON.stringify({ name: "@real/current", version: "1.0.0" }, null, 2) + "\n");
    writeFileSync(join(retiredDir, "packages", "retired", "package.json"), JSON.stringify({ name: "@real/retired", version: "1.0.0" }, null, 2) + "\n");
    gitInit(retiredDir);
    rmSync(join(retiredDir, "packages", "retired", "package.json"));
    const retiredResult = run("node", [join(retiredDir, "scripts", "set-scope.mjs"), "--check"], { cwd: retiredDir });
    check(
      "a fully removed tracked package is not treated as a missing-manifest live package",
      retiredResult.code === 0,
      `expected exit 0, got ${retiredResult.code}: ${retiredResult.out}`,
    );
  }

  // -------------------------- set-registry: clean tree checks and rewrites
  console.log("\n# set-registry: --check passes on a genuinely clean, fully-pinned tree");
  {
    const dir = join(work, "set-registry-clean");
    mkdirSync(join(dir, "packages", "ui"), { recursive: true });
    mkdirSync(join(dir, "scripts"), { recursive: true });
    cpSync(SET_REGISTRY, join(dir, "scripts", "set-registry.mjs"));
    writeFileSync(
      join(dir, "package-scope.json"),
      JSON.stringify({ scope: "@real", registry: "https://example.invalid" }, null, 2) + "\n",
    );
    writeFileSync(
      join(dir, "packages", "ui", "package.json"),
      JSON.stringify(
        { name: "@real/ui", version: "1.0.0", private: false, publishConfig: { registry: "https://example.invalid" } },
        null,
        2,
      ) + "\n",
    );
    gitInit(dir);
    const r = run("node", [join(dir, "scripts", "set-registry.mjs"), "--check"], { cwd: dir });
    check("a fully-pinned tree exits 0", r.code === 0, `expected exit 0, got ${r.code}: ${r.out}`);
  }

  console.log("\n# set-registry: --check catches a mismatched publishConfig.registry");
  {
    const dir = join(work, "set-registry-mismatch");
    mkdirSync(join(dir, "packages", "ui"), { recursive: true });
    mkdirSync(join(dir, "scripts"), { recursive: true });
    cpSync(SET_REGISTRY, join(dir, "scripts", "set-registry.mjs"));
    writeFileSync(
      join(dir, "package-scope.json"),
      JSON.stringify({ scope: "@real", registry: "https://example.invalid" }, null, 2) + "\n",
    );
    // Stale pin, hand-edited, pointing somewhere package-scope.json no longer declares.
    writeFileSync(
      join(dir, "packages", "ui", "package.json"),
      JSON.stringify(
        { name: "@real/ui", version: "1.0.0", private: false, publishConfig: { registry: "https://stale.invalid" } },
        null,
        2,
      ) + "\n",
    );
    gitInit(dir);
    const r = run("node", [join(dir, "scripts", "set-registry.mjs"), "--check"], { cwd: dir });
    check("a mismatched publishConfig.registry exits 1, not 0", r.code === 1, `expected exit 1, got ${r.code}: ${r.out}`);
    check(
      "the failure names the offending package, its actual pin, and the expected value",
      /packages\/ui\/package\.json/.test(r.out) && /stale\.invalid/.test(r.out) && /example\.invalid/.test(r.out),
      `expected the finding to name packages/ui/package.json, "stale.invalid" and "example.invalid", got: ${r.out}`,
    );
  }

  console.log("\n# set-registry: --check catches a missing publishConfig.registry");
  {
    const dir = join(work, "set-registry-missing-pin");
    mkdirSync(join(dir, "packages", "ui"), { recursive: true });
    mkdirSync(join(dir, "scripts"), { recursive: true });
    cpSync(SET_REGISTRY, join(dir, "scripts", "set-registry.mjs"));
    writeFileSync(
      join(dir, "package-scope.json"),
      JSON.stringify({ scope: "@real", registry: "https://example.invalid" }, null, 2) + "\n",
    );
    writeFileSync(
      join(dir, "packages", "ui", "package.json"),
      JSON.stringify({ name: "@real/ui", version: "1.0.0", private: false }, null, 2) + "\n",
    );
    gitInit(dir);
    const r = run("node", [join(dir, "scripts", "set-registry.mjs"), "--check"], { cwd: dir });
    check("an unpinned published package exits 1, not 0", r.code === 1, `expected exit 1, got ${r.code}: ${r.out}`);
    check(
      "a private:true package is never required to declare a registry pin",
      (() => {
        const privDir = join(work, "set-registry-private-package");
        mkdirSync(join(privDir, "packages", "internal-only"), { recursive: true });
        mkdirSync(join(privDir, "scripts"), { recursive: true });
        cpSync(SET_REGISTRY, join(privDir, "scripts", "set-registry.mjs"));
        writeFileSync(
          join(privDir, "package-scope.json"),
          JSON.stringify({ scope: "@real", registry: "https://example.invalid" }, null, 2) + "\n",
        );
        writeFileSync(
          join(privDir, "packages", "internal-only", "package.json"),
          JSON.stringify({ name: "@real/internal-only", version: "1.0.0", private: true }, null, 2) + "\n",
        );
        gitInit(privDir);
        const privResult = run("node", [join(privDir, "scripts", "set-registry.mjs"), "--check"], { cwd: privDir });
        return privResult.code === 0;
      })(),
      "a private:true package with no publishConfig.registry unexpectedly failed the check",
    );
  }

  // -------------------------- set-registry: fails closed, never green on "could not check"
  console.log("\n# set-registry: the structural check fails closed, never green on \"could not check\"");
  {
    const zeroDir = join(work, "set-registry-zero-packages");
    mkdirSync(join(zeroDir, "scripts"), { recursive: true });
    cpSync(SET_REGISTRY, join(zeroDir, "scripts", "set-registry.mjs"));
    writeFileSync(
      join(zeroDir, "package-scope.json"),
      JSON.stringify({ scope: "@real", registry: "https://example.invalid" }, null, 2) + "\n",
    );
    // No packages/ directory at all.
    gitInit(zeroDir);
    const zeroResult = run("node", [join(zeroDir, "scripts", "set-registry.mjs"), "--check"], { cwd: zeroDir });
    check("zero packages under packages/ exits 2, not 0", zeroResult.code === 2, `expected exit 2, got ${zeroResult.code}: ${zeroResult.out}`);

    const noRegDir = join(work, "set-registry-no-declared-registry");
    mkdirSync(join(noRegDir, "packages", "ui"), { recursive: true });
    mkdirSync(join(noRegDir, "scripts"), { recursive: true });
    cpSync(SET_REGISTRY, join(noRegDir, "scripts", "set-registry.mjs"));
    // package-scope.json with no "registry" field at all, and no --registry override.
    writeFileSync(join(noRegDir, "package-scope.json"), JSON.stringify({ scope: "@real" }, null, 2) + "\n");
    writeFileSync(
      join(noRegDir, "packages", "ui", "package.json"),
      JSON.stringify({ name: "@real/ui", version: "1.0.0", private: false }, null, 2) + "\n",
    );
    gitInit(noRegDir);
    const noRegResult = run("node", [join(noRegDir, "scripts", "set-registry.mjs"), "--check"], { cwd: noRegDir });
    check(
      "no declared registry to check against exits 2, not 0",
      noRegResult.code === 2,
      `expected exit 2, got ${noRegResult.code}: ${noRegResult.out}`,
    );
  }

  // ----------------------------------------- set-registry: propagation rewrite
  console.log("\n# set-registry: --registry propagates and rewrites publishConfig.registry in place");
  {
    const dir = join(work, "set-registry-propagate");
    mkdirSync(join(dir, "packages", "compact"), { recursive: true });
    mkdirSync(join(dir, "packages", "multiline"), { recursive: true });
    mkdirSync(join(dir, "scripts"), { recursive: true });
    cpSync(SET_REGISTRY, join(dir, "scripts", "set-registry.mjs"));
    writeFileSync(
      join(dir, "package-scope.json"),
      JSON.stringify({ scope: "@real", registry: "https://old.invalid" }, null, 2) + "\n",
    );
    // One package with a compact single-line publishConfig, one multi-line —
    // this repository's own packages/*/package.json actually mix both
    // styles (see e.g. packages/surface vs. packages/policy), and this
    // script must never round-trip either through JSON.stringify, which
    // would silently reformat it.
    writeFileSync(
      join(dir, "packages", "compact", "package.json"),
      '{\n  "name": "@real/compact",\n  "version": "1.0.0",\n  "private": false,\n  "publishConfig": { "registry": "https://old.invalid" }\n}\n',
    );
    writeFileSync(
      join(dir, "packages", "multiline", "package.json"),
      JSON.stringify(
        { name: "@real/multiline", version: "1.0.0", private: false, publishConfig: { registry: "https://old.invalid" } },
        null,
        2,
      ) + "\n",
    );
    gitInit(dir);

    const r = run("node", [join(dir, "scripts", "set-registry.mjs"), "--registry", "https://new.invalid"], { cwd: dir });
    check("propagation exits 0", r.code === 0, `expected exit 0, got ${r.code}: ${r.out}`);

    const compactAfter = readFileSync(join(dir, "packages", "compact", "package.json"), "utf8");
    check(
      "the compact single-line publishConfig is rewritten in place, formatting untouched",
      compactAfter === '{\n  "name": "@real/compact",\n  "version": "1.0.0",\n  "private": false,\n  "publishConfig": { "registry": "https://new.invalid" }\n}\n',
      `unexpected content: ${compactAfter}`,
    );

    const multilineAfter = readFileSync(join(dir, "packages", "multiline", "package.json"), "utf8");
    check(
      "the multi-line publishConfig is rewritten too",
      multilineAfter.includes('"registry": "https://new.invalid"') && !multilineAfter.includes("old.invalid"),
      `unexpected content: ${multilineAfter}`,
    );

    const scopeAfter = JSON.parse(readFileSync(join(dir, "package-scope.json"), "utf8"));
    check(
      "package-scope.json's own registry field is updated too",
      scopeAfter.registry === "https://new.invalid",
      `expected package-scope.json.registry to be updated, got: ${JSON.stringify(scopeAfter)}`,
    );

    const recheck = run("node", [join(dir, "scripts", "set-registry.mjs"), "--check"], { cwd: dir });
    check("a bare --check after propagation now passes", recheck.code === 0, `expected exit 0, got ${recheck.code}: ${recheck.out}`);
  }

  console.log("\n# set-registry: a package already out of sync with BOTH the old and new registry is left untouched");
  {
    const dir = join(work, "set-registry-already-diverged");
    mkdirSync(join(dir, "packages", "ui"), { recursive: true });
    mkdirSync(join(dir, "scripts"), { recursive: true });
    cpSync(SET_REGISTRY, join(dir, "scripts", "set-registry.mjs"));
    writeFileSync(
      join(dir, "package-scope.json"),
      JSON.stringify({ scope: "@real", registry: "https://old.invalid" }, null, 2) + "\n",
    );
    writeFileSync(
      join(dir, "packages", "ui", "package.json"),
      JSON.stringify(
        { name: "@real/ui", version: "1.0.0", private: false, publishConfig: { registry: "https://already-wrong.invalid" } },
        null,
        2,
      ) + "\n",
    );
    gitInit(dir);
    const before = readFileSync(join(dir, "packages", "ui", "package.json"), "utf8");
    const r = run("node", [join(dir, "scripts", "set-registry.mjs"), "--registry", "https://new.invalid"], { cwd: dir });
    check("propagation reports a finding (exit 1) rather than guessing", r.code === 1, `expected exit 1, got ${r.code}: ${r.out}`);
    const after = readFileSync(join(dir, "packages", "ui", "package.json"), "utf8");
    check("the already-diverged file is left byte-for-byte untouched", after === before, `file was rewritten anyway: ${after}`);
  }

  // -------------------------- set-prepublish-hook: drift check + rewrite (issue #273)
  console.log("\n# set-prepublish-hook: --check catches a manifest missing the collision-check hook (issue #273)");
  {
    const dir = join(work, "prepublish-hook-drift");
    mkdirSync(join(dir, "packages", "probe"), { recursive: true });
    mkdirSync(join(dir, "scripts"), { recursive: true });
    cpSync(SET_PREPUBLISH_HOOK, join(dir, "scripts", "set-prepublish-hook.mjs"));
    // The exact pre-fix shape every manifest under packages/ actually had:
    // prepublishOnly runs the build and nothing else.
    writeFileSync(
      join(dir, "packages", "probe", "package.json"),
      JSON.stringify({ name: "@real/probe", version: "1.0.0", private: false, scripts: { prepublishOnly: "npm run build" } }, null, 2) + "\n",
    );
    const r = run("node", [join(dir, "scripts", "set-prepublish-hook.mjs"), "--check"], { cwd: dir });
    check("a bare `npm run build` prepublishOnly exits 1, not 0", r.code === 1, `expected exit 1, got ${r.code}: ${r.out}`);
    check(
      "the failure names the offending manifest and the expected hook",
      /packages\/probe\/package\.json/.test(r.out) && /check-name-collision\.mjs/.test(r.out),
      `expected the finding to name packages/probe/package.json and check-name-collision.mjs, got: ${r.out}`,
    );

    const rewrite = run("node", [join(dir, "scripts", "set-prepublish-hook.mjs")], { cwd: dir });
    check("the rewrite exits 0", rewrite.code === 0, `expected exit 0, got ${rewrite.code}: ${rewrite.out}`);
    const after = JSON.parse(readFileSync(join(dir, "packages", "probe", "package.json"), "utf8"));
    check(
      "the rewrite installs the exact collision-check hook",
      after.scripts.prepublishOnly === "node ../../scripts/check-name-collision.mjs . && npm run build",
      `unexpected prepublishOnly: ${after.scripts?.prepublishOnly}`,
    );
    const recheck = run("node", [join(dir, "scripts", "set-prepublish-hook.mjs"), "--check"], { cwd: dir });
    check("a bare --check after the rewrite now passes", recheck.code === 0, `expected exit 0, got ${recheck.code}: ${recheck.out}`);
  }

  console.log("\n# set-prepublish-hook: a private:true package is never required to carry the hook");
  {
    const dir = join(work, "prepublish-hook-private");
    mkdirSync(join(dir, "packages", "internal-only"), { recursive: true });
    mkdirSync(join(dir, "scripts"), { recursive: true });
    cpSync(SET_PREPUBLISH_HOOK, join(dir, "scripts", "set-prepublish-hook.mjs"));
    writeFileSync(
      join(dir, "packages", "internal-only", "package.json"),
      JSON.stringify({ name: "@real/internal-only", version: "1.0.0", private: true, scripts: { prepublishOnly: "npm run build" } }, null, 2) + "\n",
    );
    const r = run("node", [join(dir, "scripts", "set-prepublish-hook.mjs"), "--check"], { cwd: dir });
    check("a private:true package with a bare prepublishOnly does not fail the check", r.code === 0, `expected exit 0, got ${r.code}: ${r.out}`);
  }

  console.log("\n# set-prepublish-hook: fails closed, never green on \"could not check\"");
  {
    const zeroDir = join(work, "prepublish-hook-zero-packages");
    mkdirSync(join(zeroDir, "scripts"), { recursive: true });
    cpSync(SET_PREPUBLISH_HOOK, join(zeroDir, "scripts", "set-prepublish-hook.mjs"));
    // No packages/ directory at all.
    const zeroResult = run("node", [join(zeroDir, "scripts", "set-prepublish-hook.mjs"), "--check"], { cwd: zeroDir });
    check("zero packages under packages/ exits 2, not 0", zeroResult.code === 2, `expected exit 2, got ${zeroResult.code}: ${zeroResult.out}`);
  }

  // ---- the real bypass, closed: running the ACTUAL npm lifecycle event, not
  // just inspecting the manifest text (issue #273's core claim) ----------
  //
  // `npm publish` only fires `prepublishOnly` for a directory-type publish
  // (confirmed by reading the installed npm CLI's own lib/commands/publish.js:
  // `if (spec.type === 'directory' && !ignoreScripts)`), and that lifecycle
  // event is reachable directly as `npm run prepublishOnly` without needing
  // any registry contact (unlike `npm publish` itself, which performs a
  // version-conflict lookup against the real registry even under --dry-run,
  // and would make this case both networked and credentialed for no reason —
  // the lifecycle hook itself needs neither). Running the real script through
  // the real `npm` binary, rather than asserting on the JSON text, is what
  // proves the WIRING and not just the manifest's spelling.
  //
  // check-name-collision.mjs itself calls the real `gh` CLI when
  // --packages-json is not supplied — exactly what a bare `npm publish` run
  // by hand would do. Shadowing `gh` on PATH with a fixture binary (rather
  // than passing --packages-json) keeps this case faithful to that exact,
  // real invocation instead of a parameterised stand-in for it.
  console.log("\n# set-prepublish-hook: the real npm lifecycle actually runs check-name-collision.mjs before build (issue #273)");
  {
    const dir = join(work, "prepublish-hook-wiring");
    const binDir = join(dir, "bin");
    mkdirSync(binDir, { recursive: true });
    mkdirSync(join(dir, "scripts"), { recursive: true });
    mkdirSync(join(dir, "scripts", "lib"), { recursive: true });
    mkdirSync(join(dir, "packages", "probe"), { recursive: true });
    cpSync(COLLISION, join(dir, "scripts", "check-name-collision.mjs"));
    cpSync(PUBLIC_NPM_REGISTRY_LIB, join(dir, "scripts", "lib", "public-npm-registry.mjs"));
    cpSync(PACKAGE_IDENTITY_TRANSITION_LIB, join(dir, "scripts", "lib", "package-identity-transition.mjs"));
    writeFileSync(join(dir, "package-scope.json"), JSON.stringify({ scope: "@gate-fixture", registry: LEGACY_PACKAGE_REGISTRY }));

    // A fixture `gh` on PATH ahead of the real one. It answers exactly the
    // one call check-name-collision.mjs makes (`gh api <path> --paginate`)
    // by echoing a canned response file, or by failing outright when
    // GH_FAKE_FAIL=1 — the same shape an unauthenticated `gh` produces.
    const ghScriptPath = join(binDir, "gh");
    writeFileSync(
      ghScriptPath,
      "#!/bin/sh\n" +
        'if [ "$GH_FAKE_FAIL" = "1" ]; then echo "fake gh: unauthenticated" >&2; exit 1; fi\n' +
        'cat "$GH_FAKE_RESPONSE_FILE"\n',
    );
    chmodSync(ghScriptPath, 0o755);

    writeFileSync(
      join(dir, "packages", "probe", "package.json"),
      JSON.stringify(
        {
          name: "@gate-fixture/wired-probe",
          version: "1.0.0",
          private: false,
          repository: { type: "git", url: "git+https://github.com/gate-fixture-owner/gate-fixture-repo.git" },
          scripts: {
            // The EXACT string this fix installs into every real manifest —
            // not a paraphrase of it.
            prepublishOnly: "node ../../scripts/check-name-collision.mjs . && npm run build",
            // A stub "build" that leaves a sentinel file behind so the test
            // can observe whether the chain ever reached it, without needing
            // a real compiler.
            build: 'node -e "require(\'fs\').writeFileSync(\'BUILD_RAN\',\'1\')"',
          },
        },
        null,
        2,
      ) + "\n",
    );

    const pkgDir = join(dir, "packages", "probe");
    const buildSentinel = join(pkgDir, "BUILD_RAN");
    const baseEnv = {
      ...process.env,
      PATH: `${binDir}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}`,
      GITHUB_REPOSITORY: "gate-fixture-owner/gate-fixture-repo",
    };

    // Case 1: the name collides with a package a DIFFERENT repo owns ->
    // check-name-collision.mjs exits 1 -> the `&&` chain must never reach
    // `npm run build`.
    {
      if (existsSync(buildSentinel)) rmSync(buildSentinel);
      const responseFile = join(dir, "gh-response-collision.json");
      writeFileSync(
        responseFile,
        JSON.stringify([{ name: "wired-probe", visibility: "public", repository: { full_name: "gate-fixture-owner/some-other-repo" } }]),
      );
      const r = run("npm", ["run", "prepublishOnly", "--prefix", pkgDir], {
        cwd: pkgDir,
        env: { ...baseEnv, GH_FAKE_RESPONSE_FILE: responseFile },
      });
      check(
        "a real `npm run prepublishOnly` is blocked by a genuine name collision",
        r.code !== 0 && /COLLISION/.test(r.out),
        `expected a nonzero exit mentioning COLLISION, got ${r.code}: ${r.out.slice(-500)}`,
      );
      check("build never ran when the collision check failed", !existsSync(buildSentinel), "BUILD_RAN sentinel exists — the bypass this fix closes is still open");
    }

    // Case 2: `gh` cannot be consulted at all (the unauthenticated-local-
    // publish case the issue's own "Options" section names as the reason
    // this hook might have been left out) -> check-name-collision.mjs exits
    // 2 -> still must not reach `npm run build`. This is the three-state
    // contract's middle case: "cannot run" must never look like "passed".
    {
      if (existsSync(buildSentinel)) rmSync(buildSentinel);
      const r = run("npm", ["run", "prepublishOnly", "--prefix", pkgDir], {
        cwd: pkgDir,
        env: { ...baseEnv, GH_FAKE_FAIL: "1", GH_FAKE_RESPONSE_FILE: join(dir, "unused.json") },
      });
      check(
        "a real `npm run prepublishOnly` is blocked when the collision check cannot run at all",
        r.code !== 0,
        `expected a nonzero exit, got ${r.code}: ${r.out.slice(-500)}`,
      );
      check("build never ran when the collision check could not run", !existsSync(buildSentinel), "BUILD_RAN sentinel exists — an indeterminate collision check silently passed");
    }

    // Case 3: the name is genuinely unused under the owner -> exits 0 -> the
    // chain proceeds and `npm run build` actually runs. Proves this hook
    // does not merely block everything; it lets a clean publish through.
    {
      if (existsSync(buildSentinel)) rmSync(buildSentinel);
      const responseFile = join(dir, "gh-response-safe.json");
      writeFileSync(responseFile, JSON.stringify([]));
      const r = run("npm", ["run", "prepublishOnly", "--prefix", pkgDir], {
        cwd: pkgDir,
        env: { ...baseEnv, GH_FAKE_RESPONSE_FILE: responseFile },
      });
      check("a real `npm run prepublishOnly` succeeds when the name is genuinely unused", r.code === 0, `expected exit 0, got ${r.code}: ${r.out.slice(-500)}`);
      check("build actually ran once the collision check cleared", existsSync(buildSentinel), "BUILD_RAN sentinel is missing — a clean check never reached build");
    }
  }

  // ------------------------------------------ root README parity (issue #28)
  console.log("\n# check-root-readme-parity: root README vs packages/");
  {
    const dir = join(work, "root-readme");
    const packagesDir = join(dir, "packages");
    mkdirSync(join(packagesDir, "alpha"), { recursive: true });
    mkdirSync(join(packagesDir, "beta"), { recursive: true });
    writeFileSync(join(packagesDir, "alpha", "package.json"), JSON.stringify({ name: `${FIXTURE_SCOPE}/alpha`, version: "1.0.0" }, null, 2) + "\n");
    writeFileSync(join(packagesDir, "beta", "package.json"), JSON.stringify({ name: `${FIXTURE_SCOPE}/beta`, version: "1.0.0" }, null, 2) + "\n");

    function writeReadme(rows) {
      writeFileSync(
        join(dir, "README.md"),
        ["## Packages", "", "| Package | What it does |", "| --- | --- |", ...rows, ""].join("\n"),
      );
    }

    // Sanity (real coverage): a table naming every real package passes, and
    // it does so because the scan actually walked packages/alpha and
    // packages/beta and read their real names — not because the fixture has
    // nothing to check. The next case mutates this exact fixture and shows
    // the same run catches the drift, which is what proves the pass above
    // wasn't just zero coverage in disguise.
    writeReadme([`| \`${FIXTURE_SCOPE}/alpha\` | does alpha things |`, `| \`${FIXTURE_SCOPE}/beta\` | does beta things |`]);
    const complete = run("node", [ROOT_README, dir]);
    check(
      "sanity: a table naming every real package passes, proving the scan reads real packages/ content rather than passing on zero coverage",
      complete.code === 0,
      `exit ${complete.code}: ${complete.out.slice(0, 300)}`,
    );

    // Same fixture, beta's row removed — structurally the same shape as
    // issue #28's actual defect (@example/copy/voice and
    // @example/strategy had no row at all).
    writeReadme([`| \`${FIXTURE_SCOPE}/alpha\` | does alpha things |`]);
    const missing = run("node", [ROOT_README, dir]);
    check(
      "catches a real package missing its README row",
      missing.code === 1 && missing.out.includes(`${FIXTURE_SCOPE}/beta`),
      `exit ${missing.code}: ${missing.out.slice(0, 300)}`,
    );

    // Mirror-image drift: a row names a package that no longer exists under
    // packages/ at all (removed from disk, never removed from the table).
    writeReadme([
      `| \`${FIXTURE_SCOPE}/alpha\` | does alpha things |`,
      `| \`${FIXTURE_SCOPE}/beta\` | does beta things |`,
      `| \`${FIXTURE_SCOPE}/retired\` | doesn't exist anymore |`,
    ]);
    const stale = run("node", [ROOT_README, dir]);
    check(
      "catches a README row naming a package that no longer exists under packages/",
      stale.code === 1 && stale.out.includes(`${FIXTURE_SCOPE}/retired`),
      `exit ${stale.code}: ${stale.out.slice(0, 300)}`,
    );

    // Fail-closed cases below. None of these may exit 0, and none may print
    // anything that reads as a pass — "could not check" and "checked and it
    // was fine" sharing an exit code is exactly how issue #28 survived.
    const passLooking = /\bOK\b|\bPASS\b/;

    const noHeading = join(work, "root-readme-no-heading");
    mkdirSync(join(noHeading, "packages", "alpha"), { recursive: true });
    writeFileSync(join(noHeading, "packages", "alpha", "package.json"), JSON.stringify({ name: `${FIXTURE_SCOPE}/alpha` }) + "\n");
    writeFileSync(join(noHeading, "README.md"), "# a README with no Packages heading at all\n");
    const rNoHeading = run("node", [ROOT_README, noHeading]);
    check("fails closed when README has no Packages heading", rNoHeading.code === 2, `exit was ${rNoHeading.code}`);
    check(
      "does not print a passing-looking result when it could not locate the table",
      !passLooking.test(rNoHeading.out),
      `output looked like a pass: ${rNoHeading.out.slice(0, 200)}`,
    );

    const noTable = join(work, "root-readme-no-table");
    mkdirSync(join(noTable, "packages", "alpha"), { recursive: true });
    writeFileSync(join(noTable, "packages", "alpha", "package.json"), JSON.stringify({ name: `${FIXTURE_SCOPE}/alpha` }) + "\n");
    writeFileSync(join(noTable, "README.md"), "## Packages\n\nprose, no table here.\n");
    const rNoTable = run("node", [ROOT_README, noTable]);
    check("fails closed when the Packages section has no parseable table (zero rows)", rNoTable.code === 2, `exit was ${rNoTable.code}`);
    check(
      "does not print a passing-looking result over zero parsed rows",
      !passLooking.test(rNoTable.out),
      `output looked like a pass: ${rNoTable.out.slice(0, 200)}`,
    );

    const noPackagesDir = join(work, "root-readme-no-packages-dir");
    mkdirSync(noPackagesDir, { recursive: true });
    writeFileSync(join(noPackagesDir, "README.md"), "## Packages\n\n| Package | What it does |\n| --- | --- |\n");
    const rNoPkgDir = run("node", [ROOT_README, noPackagesDir]);
    check("fails closed when packages/ does not exist", rNoPkgDir.code === 2, `exit was ${rNoPkgDir.code}`);

    const emptyPackagesDir = join(work, "root-readme-empty-packages-dir");
    mkdirSync(join(emptyPackagesDir, "packages"), { recursive: true });
    writeFileSync(
      join(emptyPackagesDir, "README.md"),
      "## Packages\n\n| Package | What it does |\n| --- | --- |\n| `@x/y` | thing |\n",
    );
    const rEmptyPkgDir = run("node", [ROOT_README, emptyPackagesDir]);
    check(
      "fails closed when packages/ has no real (scoped-named) package to compare against",
      rEmptyPkgDir.code === 2,
      `exit was ${rEmptyPkgDir.code}`,
    );
  }

  // ------------------------ root README parity: subpath claims (CHECK D)
  // A row's PACKAGE NAME can be exactly right (passing every check above)
  // while its PROSE lies about that package's shape. This is issue #28's
  // actual historical defect, reproduced structurally: the real
  // @example/ui row named the right package and said
  // "`blocks` and `views` are a planned future subpath, not built yet"
  // long after both had shipped as real `exports` keys.
  console.log("\n# check-root-readme-parity: subpath claims contradicting real exports (CHECK D)");
  {
    const dir = join(work, "root-readme-subpaths");
    mkdirSync(join(dir, "packages", "gamma"), { recursive: true });
    writeFileSync(
      join(dir, "packages", "gamma", "package.json"),
      JSON.stringify(
        {
          name: `${FIXTURE_SCOPE}/gamma`,
          version: "1.0.0",
          exports: {
            ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
            "./atoms": { types: "./dist/atoms/index.d.ts", import: "./dist/atoms/index.js" },
            "./blocks": { types: "./dist/blocks/index.d.ts", import: "./dist/blocks/index.js" },
          },
        },
        null,
        2,
      ) + "\n",
    );

    function writeGammaReadme(description) {
      writeFileSync(
        join(dir, "README.md"),
        ["## Packages", "", "| Package | What it does |", "| --- | --- |", `| \`${FIXTURE_SCOPE}/gamma\` | ${description} |`, ""].join("\n"),
      );
    }

    // D1 (positive): an explicit `./name` mention that isn't a real key in
    // this package's own "exports" — the row documents a subpath that does
    // not exist, the root-README mirror of check-readme-parity's CHECK C.
    writeGammaReadme("Ships \`./atoms\` and \`./blocks\`, plus \`./nonexistent\` for legacy imports.");
    const nonexistent = run("node", [ROOT_README, dir]);
    check(
      "D1: catches an explicit ./subpath mention that is not a real exports key",
      nonexistent.code === 1 && nonexistent.out.includes("./nonexistent"),
      `exit ${nonexistent.code}: ${nonexistent.out.slice(0, 300)}`,
    );

    // D2 (negative, the historical shape): a BARE word identical to a real
    // subpath name, in the same clause as a curated "doesn't exist yet"
    // phrase, while that subpath actually IS a real key. This is the exact
    // shape of the real @example/ui defect, reproduced with a
    // synthetic package and a synthetic subpath name.
    writeGammaReadme("Ships the \`atoms\` layer only; \`blocks\` is a planned future subpath, not built yet.");
    const falseAbsence = run("node", [ROOT_README, dir]);
    check(
      "D2: catches a bare mention of a REAL subpath negated by a curated 'not built yet' phrase (issue #28's actual historical shape)",
      falseAbsence.code === 1 && falseAbsence.out.includes('describes "blocks"'),
      `exit ${falseAbsence.code}: ${falseAbsence.out.slice(0, 300)}`,
    );

    // Precision: the negation phrase sits in a LATER clause than a
    // correctly-described real subpath in the same cell. The clause-scoped
    // match must not cross-contaminate — `atoms` is truthfully described as
    // shipped and must not be flagged just because `blocks` is falsely
    // negated two clauses later in the same row.
    check(
      "D2 is clause-scoped: a truthfully-described subpath earlier in the same cell is not flagged by a later clause's negation",
      !falseAbsence.out.includes('describes "atoms"'),
      `atoms was incorrectly flagged: ${falseAbsence.out.slice(0, 300)}`,
    );

    // Sanity (real coverage): the same real subpaths, truthfully described
    // with no negation phrase anywhere, passes — proving D1/D2 read the
    // real "exports" map and the real README prose rather than flagging
    // unconditionally once a negation-shaped fixture exists.
    writeGammaReadme("Ships \`./atoms\` and \`./blocks\`, the two layers this package has today.");
    const clean = run("node", [ROOT_README, dir]);
    check(
      "sanity: truthfully describing real subpaths with no negation phrase passes",
      clean.code === 0,
      `exit ${clean.code}: ${clean.out.slice(0, 300)}`,
    );

    // A negation phrase near a BARE word that is not a real subpath name at
    // all (ordinary prose) must never be flagged — CHECK D only fires when
    // the negated word is identical to a verified real "exports" key, never
    // as a general "this sentence sounds negative" scan.
    writeGammaReadme("The changelog format is not built yet for this package.");
    const ordinaryProse = run("node", [ROOT_README, dir]);
    check(
      "a negation phrase near ordinary prose (no real-subpath-named word involved) is not flagged",
      ordinaryProse.code === 0,
      `exit ${ordinaryProse.code}: ${ordinaryProse.out.slice(0, 300)}`,
    );
  }

  // ============================================================
  // Everything below this line is a clearly separate block appended for
  // GH issues #1 and #2. Kept isolated at the end on purpose: other work
  // also appends to this file, and a self-contained block here keeps any
  // merge conflict trivial.
  // ============================================================

  // -------------------------- denylist quality: self-scope (issue #1) -----
  console.log("\n# denylist quality — self-scope (a term matching this repo's own scope/package names)");
  {
    // A synthetic scope config + one synthetic package, structurally
    // identical to the real package-scope.json + packages/*/package.json
    // layout but under a scope that appears in no real denylist term.
    const scopeDir = join(work, "self-scope-fixture");
    mkdirSync(join(scopeDir, "packages", "gadget"), { recursive: true });
    const scopeConfigPath = join(scopeDir, "package-scope.json");
    writeFileSync(scopeConfigPath, JSON.stringify({ scope: "@widgetco-fixture", registry: "https://example.invalid" }));
    writeFileSync(
      join(scopeDir, "packages", "gadget", "package.json"),
      JSON.stringify({ name: "@widgetco-fixture/gadget", version: "1.0.0" }),
    );

    const runQuality = (denylistObj, extraArgs = []) => {
      const p = join(scopeDir, `dl-${Math.random().toString(36).slice(2)}.json`);
      writeFileSync(p, JSON.stringify(denylistObj));
      const r = run("node", [QUALITY, "--denylist", p, "--scope-config", scopeConfigPath, "--json", ...extraArgs]);
      let report;
      try {
        report = JSON.parse(r.out);
      } catch {
        report = null;
      }
      return { ...r, report };
    };

    // Violation: the term's pattern matches the fixture's own scope string.
    const scopeHit = runQuality({
      version: "t",
      terms: [{ pattern: "widgetco-fixture", why: "synthetic self-scope violation (scope string)", severity: "high" }],
    });
    check(
      "flags a term matching this repo's own configured scope",
      scopeHit.code === 1 && (scopeHit.report?.findings ?? []).some((f) => f.rule === "self-scope" && f.index === 0),
      `expected a self-scope finding at index 0, got ${JSON.stringify(scopeHit.report?.findings)}`,
    );

    // Violation, different source: the term's pattern matches a PACKAGE NAME
    // under the scope, not the bare scope string itself — proves coverage
    // isn't limited to the one obvious candidate (the incident this
    // reproduces was 59 files of package-NAME hits, not just the scope).
    const packageHit = runQuality({
      version: "t",
      terms: [{ pattern: "widgetco-fixture/gadget", why: "synthetic self-scope violation (package name)", severity: "high" }],
    });
    check(
      "flags a term matching a package name published under this repo's own scope",
      packageHit.code === 1 && (packageHit.report?.findings ?? []).some((f) => f.rule === "self-scope" && f.index === 0),
      `expected a self-scope finding at index 0, got ${JSON.stringify(packageHit.report?.findings)}`,
    );

    // Sanity (real coverage, not zero coverage): an unrelated term over the
    // SAME fixture does not trip self-scope — proving the prior two cases
    // failed because of what they matched, not because this fixture flags
    // everything indiscriminately.
    const clean = runQuality({
      version: "t",
      terms: [{ pattern: "unrelatedthing", why: "synthetic unrelated term", severity: "high" }],
    });
    check(
      "sanity: an unrelated term over the same scope fixture is NOT flagged for self-scope, and the scan finds nothing — proving the self-scope check inspects the actual candidate set rather than failing everything",
      clean.code === 0 && !(clean.report?.findings ?? []).some((f) => f.rule === "self-scope"),
      `expected no self-scope finding, got ${JSON.stringify(clean.report?.findings)}`,
    );

    // Coverage reporting (audit finding): the candidate-set size is reported
    // unconditionally, not just implied by a pass/fail. This fixture has
    // exactly one package under packages/*, so the count is pinned exactly —
    // a regression that silently drops package-name coverage (e.g. a typo'd
    // packagesDir) would still report SOME candidates (the bare scope) and
    // pass every other check here without this explicit count.
    check(
      "self-scope coverage reports the exact candidate/package counts for this fixture (1 package under packages/*)",
      clean.report?.selfScopeCoverage?.packageNamesFound === 1 &&
        clean.report?.selfScopeCoverage?.scopeAndPackageCandidates === 4,
      `expected packageNamesFound:1, scopeAndPackageCandidates:4, got ${JSON.stringify(clean.report?.selfScopeCoverage)}`,
    );

    // The documented, at-add-time override: selfScopeJustification turns the
    // match into an ACKNOWLEDGED entry rather than a failing finding.
    // Pattern covers both the separated and compound form of its own literal
    // (optional hyphen) so this case isolates the self-scope acknowledgement
    // from the unrelated separator-optional pattern-shape finding.
    const justified = runQuality({
      version: "t",
      terms: [
        {
          pattern: "widgetco-?fixture",
          why: "synthetic self-scope, deliberately justified",
          severity: "high",
          selfScopeJustification: "synthetic: deliberate, reviewed exception for this fixture",
        },
      ],
    });
    check(
      "selfScopeJustification acknowledges the match instead of failing",
      justified.code === 0 &&
        !(justified.report?.findings ?? []).some((f) => f.rule === "self-scope") &&
        (justified.report?.selfScopeAcknowledged ?? []).some((a) => a.index === 0),
      `expected an acknowledged self-scope entry and no failing finding, got ${JSON.stringify(justified.report)}`,
    );

    // ---------------------------------------------- fail-closed: self-scope
    // "Could not check" and "checked, and it was fine" must never share an
    // exit code — same standard the denylist-loading fail-closed cases hold
    // check-public-safety.mjs to.
    const missingScopeConfig = run("node", [
      QUALITY,
      "--denylist",
      (() => {
        const p = join(scopeDir, "dl-missing-scope.json");
        writeFileSync(p, JSON.stringify({ version: "t", terms: [{ pattern: "unrelatedthing", why: "x", severity: "high" }] }));
        return p;
      })(),
      "--scope-config",
      join(scopeDir, "does-not-exist.json"),
    ]);
    check(
      "fails closed (exit 2) when the scope config cannot be loaded",
      missingScopeConfig.code === 2,
      `exit was ${missingScopeConfig.code}: ${missingScopeConfig.out.slice(0, 300)}`,
    );

    const noScopeField = join(scopeDir, "no-scope-field.json");
    writeFileSync(noScopeField, JSON.stringify({ registry: "https://example.invalid" }));
    const badScopeConfig = run("node", [
      QUALITY,
      "--denylist",
      join(scopeDir, "dl-missing-scope.json"),
      "--scope-config",
      noScopeField,
    ]);
    check(
      "fails closed (exit 2) when the scope config has no `scope` string",
      badScopeConfig.code === 2,
      `exit was ${badScopeConfig.code}: ${badScopeConfig.out.slice(0, 300)}`,
    );
  }

  // ---------------------- denylist quality: self-containment (issue #2) ---
  console.log("\n# denylist quality — self-containment (a term's why/boundaryJustification leaking another term's value)");
  {
    const containDir = join(work, "self-containment-fixture");
    mkdirSync(containDir, { recursive: true });
    // Reuse the same harmless scope fixture shape from above so this block
    // never depends on the earlier one's temp files still existing.
    const scopeConfigPath = join(containDir, "package-scope.json");
    writeFileSync(scopeConfigPath, JSON.stringify({ scope: "@containment-fixture-scope", registry: "https://example.invalid" }));

    const runQuality = (denylistObj) => {
      const p = join(containDir, `dl-${Math.random().toString(36).slice(2)}.json`);
      writeFileSync(p, JSON.stringify(denylistObj));
      const r = run("node", [QUALITY, "--denylist", p, "--scope-config", scopeConfigPath, "--json"]);
      let report;
      try {
        report = JSON.parse(r.out);
      } catch {
        report = null;
      }
      return { ...r, report };
    };

    // Violation: term #1's `why` literally contains term #0's value
    // ("acmecorp" — single-word compound so this case isolates
    // self-containment from the separator-optional pattern-shape check
    // above, which is a different finding about a different property).
    const whyLeak = runQuality({
      version: "t",
      terms: [
        { pattern: "acmecorp", why: "synthetic sibling product", severity: "high" },
        { pattern: "zetaindustries", why: "this description mentions acmecorp by name, which it must not", severity: "medium" },
      ],
    });
    check(
      "flags a `why` field that contains another term's literal value",
      whyLeak.code === 1 &&
        (whyLeak.report?.findings ?? []).some((f) => f.rule === "self-containment" && f.index === 1),
      `expected a self-containment finding at index 1, got ${JSON.stringify(whyLeak.report?.findings)}`,
    );

    // Violation via the other field this rule covers: boundaryJustification.
    const boundaryLeak = runQuality({
      version: "t",
      terms: [
        { pattern: "acmecorp", why: "synthetic sibling product", severity: "high" },
        {
          pattern: "\\bzetaindustries\\b",
          why: "synthetic ordinary compound word",
          severity: "medium",
          boundaryJustification: "kept anchored on purpose — also mentions acmecorp here, which it must not",
        },
      ],
    });
    check(
      "flags a `boundaryJustification` field that contains another term's literal value",
      boundaryLeak.code === 1 &&
        (boundaryLeak.report?.findings ?? []).some((f) => f.rule === "self-containment" && f.index === 1),
      `expected a self-containment finding at index 1, got ${JSON.stringify(boundaryLeak.report?.findings)}`,
    );

    // Sanity (real coverage, not zero coverage): swapping which term's text
    // carries the leak moves the flagged index with it — proving the check
    // is actually comparing content pairwise, not hardcoded to one index.
    const swapped = runQuality({
      version: "t",
      terms: [
        { pattern: "zetaindustries", why: "this description mentions acmecorp by name, which it must not", severity: "medium" },
        { pattern: "acmecorp", why: "synthetic sibling product", severity: "high" },
      ],
    });
    check(
      "sanity: the flagged index follows the leak, not a fixed position — proving the scan inspects real content rather than passing on zero coverage",
      swapped.code === 1 && (swapped.report?.findings ?? []).some((f) => f.rule === "self-containment" && f.index === 0),
      `expected a self-containment finding at index 0, got ${JSON.stringify(swapped.report?.findings)}`,
    );

    // Clean: two terms whose text never references each other's value.
    const clean = runQuality({
      version: "t",
      terms: [
        { pattern: "acmecorp", why: "synthetic sibling product", severity: "high" },
        { pattern: "zetaindustries", why: "synthetic unrelated product, no overlap with anything else here", severity: "medium" },
      ],
    });
    check(
      "does not flag terms whose why text never contains another term's value",
      clean.code === 0 && !(clean.report?.findings ?? []).some((f) => f.rule === "self-containment"),
      `expected no self-containment finding, got ${JSON.stringify(clean.report?.findings)}`,
    );

    // ---------------------------------------------- coverage exclusion (audit)
    // Regression for the audit finding: a term whose pattern is a short
    // opaque handle (a single literal chunk under the 6-char threshold) is
    // excluded from the SOURCE side of the comparison on purpose — but that
    // exclusion must be REPORTED, never silent. Reproduced here with
    // invented values (never the real denylist): term #1 is the short
    // handle, term #2's `why` embeds it verbatim — the exact leak shape
    // issue #2 exists to catch, and the exact shape that must NOT read as
    // "self-containment ran and found nothing."
    const excludedLeak = runQuality({
      version: "t",
      terms: [
        { pattern: "qz7mx", why: "synthetic short opaque handle, sub-threshold on purpose", severity: "critical" },
        { pattern: "unrelatedfiller", why: "this description mentions the handle qz7mx by name, which it must not", severity: "high" },
      ],
    });
    check(
      "a sub-threshold term's value leaking into another term's why is NOT raised as a self-containment finding (the excluded case, not a false negative fix)",
      !(excludedLeak.report?.findings ?? []).some((f) => f.rule === "self-containment"),
      `expected no self-containment finding for the excluded source, got ${JSON.stringify(excludedLeak.report?.findings)}`,
    );
    check(
      "...but that exclusion IS reported, by index and reason, so the miss is visible rather than silent",
      (excludedLeak.report?.selfContainmentExcluded ?? []).some((e) => e.index === 0),
      `expected selfContainmentExcluded to name index 0, got ${JSON.stringify(excludedLeak.report?.selfContainmentExcluded)}`,
    );
    check(
      "the exclusion alone does not fail the run (would be noise on legitimate short terms)",
      excludedLeak.code === 0,
      `exit was ${excludedLeak.code}, expected 0 — an excluded term should not fail the run by itself`,
    );

    // The coverage line is unconditional: present even when nothing is
    // excluded, so "zero excluded" and "the field was never computed" are
    // also distinguishable.
    check(
      "selfContainmentExcluded is present (as an empty array) even when nothing is excluded",
      Array.isArray(clean.report?.selfContainmentExcluded) && clean.report.selfContainmentExcluded.length === 0,
      `expected an empty selfContainmentExcluded array, got ${JSON.stringify(clean.report?.selfContainmentExcluded)}`,
    );

    // self-scope coverage is reported unconditionally too (audited for the
    // same shape): every query in this block used a scope fixture with no
    // packages/ directory, so packageNamesFound must read 0 rather than
    // being silently absent from the report.
    check(
      "self-scope coverage counts are reported even when zero packages were found under packages/*",
      clean.report?.selfScopeCoverage?.packageNamesFound === 0 &&
        typeof clean.report?.selfScopeCoverage?.scopeAndPackageCandidates === "number",
      `expected selfScopeCoverage.packageNamesFound === 0, got ${JSON.stringify(clean.report?.selfScopeCoverage)}`,
    );
  }

  // ------------------------------------------- check-typechecked-assertions (issue #24)
  //
  // HERMETIC BY CONSTRUCTION: this gate's whole job is to shell out to a real
  // `tsc` binary, but the `safety` CI job that runs `check:gates` never runs
  // `npm ci` -- every script under scripts/ is zero-dependency Node
  // specifically so those gates can run with no install at all. Calling the
  // real toolchain from THIS suite would violate that on the spot. Every
  // case below instead points the gate at FOUNDRY_TYPECHECK_TSC_OVERRIDE, a
  // tiny stub tsc (a `#!/usr/bin/env node` script this suite writes and
  // chmods executable) that prints a scripted file list and exits with a
  // scripted code -- so what's under test is this gate's own parsing and
  // set-comparison logic, pinned against a known answer, never a real
  // compiler. A separate, single case further down (gated on a real tsc
  // actually being present, loudly SKIPped otherwise) proves the stub isn't
  // lying about what real tsc would say.
  console.log("\n# check-typechecked-assertions — inert type-level assertions (issue #24)");
  {
    const dir = join(work, "typechecked-assertions");
    mkdirSync(dir, { recursive: true });
    let stubCounter = 0;

    // A minimal but real tsconfig, shaped exactly like every package's own
    // (see packages/*/tsconfig.json): `**/*.test.ts` excluded from
    // `include`, which is the entire mechanism this gate exists to police.
    // Its CONTENT is cosmetic for the stubbed cases below (the stub, not a
    // real tsc, decides what "compiled" means for them) but it still has to
    // exist as a file, since the gate checks for that before ever invoking
    // tsc.
    const FIXTURE_TSCONFIG = JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          strict: true,
          skipLibCheck: true,
          outDir: "./dist",
          rootDir: "./src",
          noEmit: true,
        },
        include: ["src/**/*"],
        exclude: ["node_modules", "dist", "**/*.test.ts"],
      },
      null,
      2,
    );

    function makeFixturePackage(name) {
      const pkgDir = join(dir, name);
      mkdirSync(join(pkgDir, "src"), { recursive: true });
      writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: `${FIXTURE_SCOPE}/${name}`, version: "1.0.0" }));
      writeFileSync(join(pkgDir, "tsconfig.json"), FIXTURE_TSCONFIG);
      return pkgDir;
    }

    // Writes an executable stand-in for `tsc -p ... --listFilesOnly`: prints
    // `files` (already-absolute paths) one per line to stdout, then exits
    // `exitCode`. Real tsc's own --listFilesOnly output is exactly this
    // shape (a newline-separated file list, nothing else on success), so
    // this is a faithful stand-in for what this gate actually parses, not a
    // simplification of it.
    function makeStubTsc({ files = [], exitCode = 0, stderr = "" } = {}) {
      const stubPath = join(dir, `tsc-stub-${stubCounter++}.mjs`);
      const lines = [
        "#!/usr/bin/env node",
        `const files = ${JSON.stringify(files)};`,
        "for (const f of files) process.stdout.write(f + \"\\n\");",
        stderr ? `process.stderr.write(${JSON.stringify(stderr)});` : "",
        `process.exit(${exitCode});`,
        "",
      ];
      writeFileSync(stubPath, lines.join("\n"));
      chmodSync(stubPath, 0o755);
      return stubPath;
    }

    function runWithStub(pkgDir, stubPath, extraArgs = []) {
      return run("node", [TYPECHECKED, pkgDir, ...extraArgs], {
        env: { ...process.env, FOUNDRY_TYPECHECK_TSC_OVERRIDE: stubPath },
      });
    }

    // Happy path: a real `@ts-expect-error` living in a *.check.ts file (the
    // convention this gate is meant to protect). The stub reports it as
    // compiled -- exactly what real tsc would say, since *.check.ts falls
    // outside every package's own **/*.test.ts(x) exclude -- so it must
    // pass clean.
    {
      const pkgDir = makeFixturePackage("happy");
      const indexPath = join(pkgDir, "src", "index.ts");
      writeFileSync(indexPath, "export const x = 1;\n");
      mkdirSync(join(pkgDir, "src", "internal"), { recursive: true });
      const checkPath = join(pkgDir, "src", "internal", "contract.check.ts");
      writeFileSync(checkPath, '// @ts-expect-error -- fixture: a real, compiled contract check\nconst wrong: number = "not a number";\n');
      const stub = makeStubTsc({ files: [indexPath, checkPath] });
      const r = runWithStub(pkgDir, stub, ["--json"]);
      let report;
      try { report = JSON.parse(r.out); } catch { report = null; }
      check("passes a real assertion the stub reports as compiled", r.code === 0 && report?.ok === true, `exit ${r.code}: ${r.out.slice(0, 300)}`);
      check("counts the real assertion as protected, not a finding", report?.findings?.length === 0, `expected zero findings, got ${JSON.stringify(report?.findings)}`);
    }

    // The core regression: the exact same directive shape, but the stub
    // reports it as NOT compiled -- exactly what real tsc would say for a
    // *.test.ts file, since every package's tsconfig excludes it -- so it
    // must be caught.
    {
      const pkgDir = makeFixturePackage("inert");
      const indexPath = join(pkgDir, "src", "index.ts");
      writeFileSync(indexPath, "export const x = 1;\n");
      writeFileSync(
        join(pkgDir, "src", "index.test.ts"),
        [
          'import { describe, it } from "vitest";',
          'describe("x", () => {',
          '  it("is inert", () => {',
          "    // @ts-expect-error -- fixture: this directive is inert, index.test.ts is excluded from tsc",
          '    const wrong: number = "not a number";',
          "  });",
          "});",
          "",
        ].join("\n"),
      );
      // index.test.ts deliberately absent from the stub's file list -- the
      // stand-in for tsc excluding it, same as a real tsconfig would.
      const stub = makeStubTsc({ files: [indexPath] });
      const r = runWithStub(pkgDir, stub, ["--json"]);
      let report;
      try { report = JSON.parse(r.out); } catch { report = null; }
      check("catches a @ts-expect-error the stub reports as NOT compiled", r.code === 1 && report?.ok === false, `exit ${r.code}: ${r.out.slice(0, 300)}`);
      check(
        "names the exact inert file and line",
        (report?.findings ?? []).some((f) => f.file === "src/index.test.ts" && f.line === 4),
        `expected a finding at src/index.test.ts:4, got ${JSON.stringify(report?.findings)}`,
      );
    }

    // A comment that merely TALKS ABOUT the directive (backtick-quoted,
    // mid-sentence) must not be mistaken for the directive itself -- the
    // same shape as this repo's own packages/ui/src/atoms/Icon.test.tsx.
    // Regression guard for the gate's own false-positive rate. The stub's
    // file list is irrelevant here (no marker exists to misjudge either
    // way), so it just needs to be non-empty and valid.
    {
      const pkgDir = makeFixturePackage("prose");
      const indexPath = join(pkgDir, "src", "index.ts");
      writeFileSync(indexPath, "export const x = 1;\n");
      writeFileSync(
        join(pkgDir, "src", "index.test.ts"),
        [
          'import { it } from "vitest";',
          'it("mentions the directive without using it", () => {',
          "  // `@ts-expect-error` written here would be inert -- this comment",
          "  // just explains that, it is not itself a directive.",
          "  const ok: number = 1;",
          "});",
          "",
        ].join("\n"),
      );
      const stub = makeStubTsc({ files: [indexPath] });
      const r = runWithStub(pkgDir, stub, ["--json"]);
      let report;
      try { report = JSON.parse(r.out); } catch { report = null; }
      check("does not flag prose that only mentions @ts-expect-error", r.code === 0 && report?.ok === true, `exit ${r.code}: ${r.out.slice(0, 300)}`);
    }

    // Fail-closed: every way this gate can fail to determine an answer must
    // exit 2, never share an exit code with a real pass (0) or finding (1).
    const failClosedRuns = [];
    {
      // Missing tsconfig.json / missing src/ die BEFORE this gate ever looks
      // at a tsc binary (real or stubbed) -- no override needed, and these
      // stay hermetic in every environment on their own.
      const missingTsconfig = join(dir, "missing-tsconfig");
      mkdirSync(join(missingTsconfig, "src"), { recursive: true });
      writeFileSync(join(missingTsconfig, "package.json"), '{"name":"x"}');
      writeFileSync(join(missingTsconfig, "src", "index.ts"), "export const x = 1;\n");
      const r1 = run("node", [TYPECHECKED, missingTsconfig]);
      check("fails closed when tsconfig.json is missing", r1.code === 2, `exit was ${r1.code}`);
      failClosedRuns.push(r1);

      const missingSrc = join(dir, "missing-src");
      mkdirSync(missingSrc, { recursive: true });
      writeFileSync(join(missingSrc, "package.json"), '{"name":"x"}');
      writeFileSync(join(missingSrc, "tsconfig.json"), FIXTURE_TSCONFIG);
      const r2 = run("node", [TYPECHECKED, missingSrc]);
      check("fails closed when src/ is missing", r2.code === 2, `exit was ${r2.code}`);
      failClosedRuns.push(r2);

      // Stub exits non-zero, the same shape a real tsc hitting an
      // unparseable tsconfig.json would (see the real-tsc integration case
      // below for that exact scenario against the genuine binary).
      const brokenTsconfig = join(dir, "broken-tsconfig");
      mkdirSync(join(brokenTsconfig, "src"), { recursive: true });
      writeFileSync(join(brokenTsconfig, "package.json"), '{"name":"x"}');
      writeFileSync(join(brokenTsconfig, "tsconfig.json"), "not valid json");
      writeFileSync(join(brokenTsconfig, "src", "index.ts"), "export const x = 1;\n");
      const brokenStub = makeStubTsc({ exitCode: 1, stderr: "tsconfig.json(1,1): error TS1005: fixture parse failure\n" });
      const r3 = runWithStub(brokenTsconfig, brokenStub);
      check("fails closed when tsc exits non-zero (e.g. an unparseable tsconfig)", r3.code === 2, `exit was ${r3.code}`);
      failClosedRuns.push(r3);

      // Stub exits 0 but reports zero files under src/ -- the shape a real
      // tsconfig with an include pattern matching nothing would produce.
      const emptySrc = join(dir, "empty-src");
      mkdirSync(join(emptySrc, "src"), { recursive: true });
      writeFileSync(join(emptySrc, "package.json"), '{"name":"x"}');
      writeFileSync(join(emptySrc, "tsconfig.json"), FIXTURE_TSCONFIG);
      const emptyStub = makeStubTsc({ files: [] });
      const r4 = runWithStub(emptySrc, emptyStub);
      check("fails closed when tsc resolves zero files under src/", r4.code === 2, `exit was ${r4.code}`);
      failClosedRuns.push(r4);

      // The exact path CI's `safety` job exercises for real: no override,
      // and (in that job) no `node_modules/.bin/tsc` at all. Reproduced here
      // by pointing the override at a path that does not exist, which hits
      // the identical `!existsSync(tscBin)` branch the real no-install
      // environment hits -- deterministic and hermetic either way.
      const noTscBinary = join(dir, "no-tsc-binary");
      mkdirSync(join(noTscBinary, "src"), { recursive: true });
      writeFileSync(join(noTscBinary, "package.json"), '{"name":"x"}');
      writeFileSync(join(noTscBinary, "tsconfig.json"), FIXTURE_TSCONFIG);
      writeFileSync(join(noTscBinary, "src", "index.ts"), "export const x = 1;\n");
      const nonexistentTscPath = join(dir, "nonexistent", "tsc");
      const r5 = run("node", [TYPECHECKED, noTscBinary], {
        env: { ...process.env, FOUNDRY_TYPECHECK_TSC_OVERRIDE: nonexistentTscPath },
      });
      check("fails closed when the tsc binary itself is missing", r5.code === 2 && /no tsc binary/.test(r5.out), `exit ${r5.code}: ${r5.out.slice(0, 200)}`);
      failClosedRuns.push(r5);

      for (const r of failClosedRuns) {
        check("a fail-closed case never prints a bare PASS", !/^check-typechecked-assertions: OK\.$/m.test(r.out), "a fail-closed case's output looked like a pass");
      }
    }
  }

  // ---------------------------- check-typechecked-assertions: real-tsc integration
  //
  // Everything above pins this gate's OWN logic against a scripted stub. This
  // case is the other half: it proves the stub's contract (files it reports
  // as compiled are treated as protected, files it omits are treated as
  // inert) is what a REAL tsc actually does, not just what the stub claims.
  // Gated on a real tsc binary being present, since this suite otherwise has
  // to stay runnable with zero installs (see the header above this
  // sub-section). If it's absent, this SKIPs loudly -- printed unconditionally,
  // counted separately from pass/fail -- rather than being silently omitted,
  // which would be exactly the "looks green, checks nothing" failure class
  // this whole batch of issues is about.
  console.log("\n# check-typechecked-assertions — real tsc integration (proves the stub isn't lying)");
  {
    const realTscBin = join(repoRoot, "node_modules", ".bin", "tsc");
    if (!existsSync(realTscBin)) {
      skipped++;
      console.log(
        `  SKIP real-tsc integration case — no tsc binary at ${realTscBin} (this environment has no ` +
          `npm ci; exactly what CI's \`safety\` job looks like). The hermetic stub-based cases above still ` +
          `cover this gate's own logic. Re-run \`node scripts/test-gates.mjs\` after \`npm ci\` (e.g. CI's ` +
          `\`build\` job, or a normal local \`npm run check\`) to actually exercise this case.`,
      );
    } else {
      const dir = join(work, "typechecked-assertions-real");
      mkdirSync(dir, { recursive: true });

      // The real tsconfig shape every package in this repo actually ships,
      // not the stub-only fixture above -- this is what makes the case an
      // integration test of the real convention, not another unit test.
      const REAL_TSCONFIG = JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "Bundler",
            strict: true,
            skipLibCheck: true,
            outDir: "./dist",
            rootDir: "./src",
            noEmit: true,
          },
          include: ["src/**/*"],
          exclude: ["node_modules", "dist", "**/*.test.ts"],
        },
        null,
        2,
      );

      function makeRealFixture(name) {
        const pkgDir = join(dir, name);
        mkdirSync(join(pkgDir, "src"), { recursive: true });
        writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: `${FIXTURE_SCOPE}/${name}`, version: "1.0.0" }));
        writeFileSync(join(pkgDir, "tsconfig.json"), REAL_TSCONFIG);
        return pkgDir;
      }

      // No FOUNDRY_TYPECHECK_TSC_OVERRIDE set -- this invokes the gate's
      // default code path, the real node_modules/.bin/tsc, exactly as
      // production does.
      {
        const pkgDir = makeRealFixture("real-happy");
        writeFileSync(join(pkgDir, "src", "index.ts"), "export const x = 1;\n");
        mkdirSync(join(pkgDir, "src", "internal"), { recursive: true });
        writeFileSync(
          join(pkgDir, "src", "internal", "contract.check.ts"),
          '// @ts-expect-error -- fixture: a real, compiled contract check\nconst wrong: number = "not a number";\n',
        );
        const r = run("node", [TYPECHECKED, pkgDir, "--json"]);
        let report;
        try { report = JSON.parse(r.out); } catch { report = null; }
        check("[real tsc] passes a real assertion actually compiled by tsc", r.code === 0 && report?.ok === true, `exit ${r.code}: ${r.out.slice(0, 300)}`);
      }

      {
        const pkgDir = makeRealFixture("real-inert");
        writeFileSync(join(pkgDir, "src", "index.ts"), "export const x = 1;\n");
        writeFileSync(
          join(pkgDir, "src", "index.test.ts"),
          [
            'import { describe, it } from "vitest";',
            'describe("x", () => {',
            '  it("is inert", () => {',
            "    // @ts-expect-error -- fixture: this directive is inert, index.test.ts is excluded from tsc",
            '    const wrong: number = "not a number";',
            "  });",
            "});",
            "",
          ].join("\n"),
        );
        const r = run("node", [TYPECHECKED, pkgDir, "--json"]);
        let report;
        try { report = JSON.parse(r.out); } catch { report = null; }
        check(
          "[real tsc] catches a @ts-expect-error real tsc actually excludes",
          r.code === 1 && report?.ok === false && (report?.findings ?? []).some((f) => f.file === "src/index.test.ts"),
          `exit ${r.code}: ${r.out.slice(0, 300)}`,
        );
      }
    }
  }

  // ----------------- check-commit-messages: hash label survives a real MULTI-commit range
  //
  // The bug this guards against is invisible on a single commit — that's
  // exactly how it hid. `git log --format=%H%x01%B%x00` (the pre-fix format)
  // relies on %x00 as a record terminator, but `--format=` implies
  // `tformat:`, which always appends its OWN trailing "\n" after each
  // commit's expansion unless the format ends in %n. This one ends in %B, so
  // that automatic newline always fires — landing right after our %x00, i.e.
  // at the front of the NEXT record once split on \0. Every hash but the
  // newest commit's comes out prefixed with a stray "\n", which still slices
  // to a plausible-looking 12-character label, so nothing downstream ever
  // complains. A single-commit range never exercises the "next record"
  // boundary at all, so it can't catch this — which is precisely why this
  // case builds a real fixture repo with three commits and checks every one
  // of them, not just the tip.
  console.log("\n# check-commit-messages: reported hash label is correct across a multi-commit range");
  {
    const dir = join(work, "commit-messages-multi");
    mkdirSync(dir, { recursive: true });
    run("git", ["-C", dir, "init", "-q"]);
    run("git", ["-C", dir, "config", "user.email", "t@t"]);
    run("git", ["-C", dir, "config", "user.name", "t"]);
    // Every commit's message carries a synthetic denylist term (see
    // SYNTH_DENYLIST above) so every commit produces a finding, and every
    // finding's label is printed — that's the only way this gate ever
    // surfaces a hash to compare against reality.
    const commitMessages = [
      "first change: mentions acme-corp",
      "second change: mentions acme-corp",
      "third change: mentions acme-corp",
    ];
    for (let i = 0; i < commitMessages.length; i++) {
      writeFileSync(join(dir, `file-${i}.txt`), `content ${i}\n`);
      run("git", ["-C", dir, "add", "-A"]);
      run("git", ["-C", dir, "commit", "-qm", commitMessages[i]]);
    }
    const trueHashes = run("git", ["-C", dir, "log", "--format=%H"])
      .out.trim()
      .split("\n")
      .filter((h) => h.length > 0);
    check("fixture actually produced 3 commits", trueHashes.length === 3, `got ${trueHashes.length}: ${trueHashes.join(",")}`);

    const r = run("node", [COMMIT_MESSAGES, "HEAD", ...DL, ...EX, "--require-denylist"], { cwd: dir });
    check(
      "gate reports FAIL (every commit's message matches the synthetic denylist term)",
      r.code === 1,
      `expected exit 1, got ${r.code}: ${r.out}`,
    );
    for (const trueHash of trueHashes) {
      const want = trueHash.slice(0, 12);
      check(
        `label for commit ${want} matches its real hash, not a corrupted one`,
        r.out.includes(`commit ${want}:`),
        `expected "commit ${want}:" in output, got:\n${r.out}`,
      );
    }
    // The corruption specifically glues a literal "\n" onto the front of the
    // hash — assert that never appears anywhere in a "commit " label line,
    // which is a more direct way of saying "no hash was split across two
    // printed lines."
    check(
      "no commit label contains an embedded newline",
      !/commit \n/.test(r.out),
      `found a "commit \\n..." label in output:\n${r.out}`,
    );
  }

  // ------------------------------------------ check-conversation-safety
  // GH gap: every gate above scans a directory of FILES. Nothing ever
  // scanned GitHub's conversation surface — issue bodies, PR bodies, issue
  // comments, PR review comments — until this gate, and an audit of this
  // repository's own history found 214 private-identity findings sitting
  // there while the tree itself was clean.
  //
  // Most of these cases exercise DRAFT mode (--file and stdin): it needs no
  // `gh` authentication and no network access, so it is the mode a hermetic
  // test suite can exercise most directly — and, not coincidentally, it is
  // also the single most valuable mode the gate has, since it PREVENTS
  // disclosure (scanning text before it is posted) rather than merely
  // detecting it after the fact. The --issue/--pr/--all fetch paths are
  // exercised further down, via a fake `gh` placed on PATH — the same
  // fixture-injection seam check-name-collision.mjs's --packages-json uses.
  console.log("\n# check-conversation-safety: draft mode");
  {
    function listConversationTmpDirs() {
      try {
        return new Set(readdirSync(tmpdir()).filter((e) => e.startsWith("conversation-safety-")));
      } catch {
        return new Set();
      }
    }

    // Compare by set difference, not size. A stale conversation-safety-*
    // dir left behind by some other invocation (an earlier interrupted
    // run of this suite, a concurrent run, a manual run of the gate) sits
    // in both `before` and `after` and must not count against this run;
    // only a dir that is new in `after` — one this run's own child
    // process created and failed to remove — is a real leak. Comparing
    // `after.size === before.size` instead is spuriously sensitive to that
    // shared, unowned state: a stale dir vanishing between snapshots (e.g.
    // another process cleaning up) can mask a genuine leak by coincidence,
    // and one appearing from a concurrent run can fail an otherwise-clean
    // run.
    function newTmpDirs(before, after) {
      return [...after].filter((dir) => !before.has(dir));
    }

    // ---- detects a planted identity term piped in as a draft, and reports
    // it as a category label + location, never as the matched text itself.
    const before1 = listConversationTmpDirs();
    const planted = run("node", [CONVERSATION, "--denylist", synthPath, "--require-denylist", "--json"], {
      input: "Please review the acme-corp integration notes before merging.\n",
    });
    const after1 = listConversationTmpDirs();
    let plantedReport;
    try {
      plantedReport = JSON.parse(planted.out);
    } catch {
      plantedReport = null;
    }
    check("draft mode exits 1 on a planted identity term", planted.code === 1, `exit was ${planted.code}: ${planted.out.slice(0, 300)}`);
    check(
      "draft mode reports the finding as a category label + location, not raw text",
      (plantedReport?.findings ?? []).some(
        (f) => f.kind === "identity" && f.detail === "synthetic sibling product" && f.location === "draft (not yet posted)",
      ),
      `findings: ${JSON.stringify(plantedReport?.findings)}`,
    );
    check(
      "draft mode never echoes the matched string anywhere in its output",
      !planted.out.includes("acme-corp"),
      `matched term leaked into output: ${planted.out}`,
    );
    const leaked1 = newTmpDirs(before1, after1);
    check(
      "draft mode cleans up its temp dir after a FAILING run",
      leaked1.length === 0,
      `left behind: ${JSON.stringify(leaked1)}`,
    );

    // ---- a clean draft passes, and still cleans up
    const before2 = listConversationTmpDirs();
    const clean = run("node", [CONVERSATION, "--denylist", synthPath, "--require-denylist", "--json"], {
      input: "This is an ordinary comment about a bug fix, nothing sensitive.\n",
    });
    const after2 = listConversationTmpDirs();
    check("draft mode exits 0 on clean text", clean.code === 0, `exit was ${clean.code}: ${clean.out.slice(0, 300)}`);
    const leaked2 = newTmpDirs(before2, after2);
    check(
      "draft mode cleans up its temp dir after a PASSING run",
      leaked2.length === 0,
      `left behind: ${JSON.stringify(leaked2)}`,
    );

    // ---- FULL mode required, no denylist available -> exit 2 (could not
    // run), never a silent pass. Same fail-closed contract check-public-
    // safety.mjs itself makes, delegated through rather than reimplemented.
    const before3 = listConversationTmpDirs();
    const noDenylistEnv = { ...process.env };
    delete noDenylistEnv.PUBLIC_SAFETY_DENYLIST;
    const requirePartial = run("node", [CONVERSATION, "--require-denylist"], {
      input: "hello\n",
      env: noDenylistEnv,
    });
    const after3 = listConversationTmpDirs();
    check(
      "--require-denylist exits 2 rather than passing when no denylist is available",
      requirePartial.code === 2,
      `exit was ${requirePartial.code}: ${requirePartial.out.slice(0, 300)}`,
    );
    const leaked3 = newTmpDirs(before3, after3);
    check(
      "draft mode cleans up its temp dir even on the FULL-mode-required failure path",
      leaked3.length === 0,
      `left behind: ${JSON.stringify(leaked3)}`,
    );

    // ---- PARTIAL mode (no denylist, not required) still exits 0 but never
    // claims a bare, unqualified PASS.
    const partial = run("node", [CONVERSATION], { input: "hello\n", env: noDenylistEnv });
    check(
      "PARTIAL mode (no denylist, not required) exits 0 but the banner says so",
      partial.code === 0 && /PARTIAL SCAN/.test(partial.out),
      `exit ${partial.code}: ${partial.out.slice(0, 300)}`,
    );

    // ---- --file mode: same scan, a real path instead of stdin, and the
    // reported source names the draft file rather than a temp filename.
    const draftPath = join(work, "conversation-draft.md");
    writeFileSync(draftPath, "Mentions acme-corp in a file this time.\n");
    const fileMode = run("node", [CONVERSATION, "--file", draftPath, "--denylist", synthPath, "--require-denylist", "--json"]);
    let fileReport;
    try {
      fileReport = JSON.parse(fileMode.out);
    } catch {
      fileReport = null;
    }
    check("--file mode exits 1 on a planted identity term", fileMode.code === 1, `exit was ${fileMode.code}: ${fileMode.out.slice(0, 300)}`);
    check(
      "--file mode reports the draft file's own path as the source, not a temp filename",
      fileReport?.source === `draft file ${draftPath}`,
      `source: ${JSON.stringify(fileReport?.source)}`,
    );
    check(
      "--file mode never echoes the matched string either",
      !fileMode.out.includes("acme-corp"),
      `matched term leaked into output: ${fileMode.out}`,
    );

    // ---- LARGE-REPORT REGRESSION. Every assertion above uses a tiny draft,
    // and that is exactly how the original defect shipped green: the leak
    // only appears once the inner --json report outgrows a pipe's buffer.
    //
    // Two distinct bugs, both found by review, both reproduced with the
    // draft below:
    //   1. check-public-safety.mjs wrote its report with console.log and then
    //      called process.exit(), truncating a piped report at ~64 KB. The
    //      reader then had invalid JSON.
    //   2. check-conversation-safety.mjs, on failing to parse that report,
    //      printed the raw payload — which still carried the matched lines in
    //      each finding's `text` field — straight to stderr, i.e. into the
    //      public CI log the whole script exists to protect.
    // Together they turned the gate into a disclosure channel precisely when
    // it had the most to disclose. A small fixture cannot catch either.
    // Its own directory, not `work`: scanning `work` would sweep in every
    // other fixture in this file and make the report's size depend on
    // unrelated tests. This case is about one very large document.
    const bigDir = join(work, "big-report-fixture");
    mkdirSync(bigDir, { recursive: true });
    const bigDraftPath = join(bigDir, "big-draft.md");
    writeFileSync(bigDraftPath, Array.from({ length: 20000 }, (_, i) => `partner acme-corp row ${i}`).join("\n"));

    const bigReport = run("node", [SAFETY, bigDir, "--no-gitignore", "--allow-changelogs", "--json", ...DL]);
    let bigParsed = null;
    try {
      bigParsed = JSON.parse(bigReport.out);
    } catch {
      bigParsed = null;
    }
    check(
      "check-public-safety --json survives a pipe when the report is megabytes long",
      bigParsed !== null && Array.isArray(bigParsed.failures) && bigParsed.failures.length > 1000,
      `report did not parse or was truncated: ${bigReport.out.length} bytes captured`,
    );

    const bigConv = run("node", [CONVERSATION, "--file", bigDraftPath, "--denylist", synthPath, "--require-denylist"]);
    check(
      "conversation gate still reports a finding on a very large draft",
      bigConv.code === 1,
      `expected exit 1, got ${bigConv.code}: ${bigConv.out.slice(0, 400)}`,
    );
    check(
      "conversation gate never echoes the matched string on a very large draft",
      !bigConv.out.includes("acme-corp"),
      `matched term leaked ${(bigConv.out.match(/acme-corp/g) || []).length} time(s) into output`,
    );

    // ---- TITLE COVERAGE REGRESSION. --issue/--pr/--all fetched only
    // `.body` at first — an issue or PR's TITLE never reached the scanner in
    // retrospective mode, even though the live workflow correctly folds
    // title into the scanned text for the same two events. Caught by hand
    // (a manual export of every title in this repo, run through draft mode)
    // only after the tool had already reported a clean sweep that silently
    // never looked at any of them. A fake `gh` on PATH, standing in for the
    // real CLI, is what lets this be a real regression test instead of
    // needing network + a live issue to plant a term in.
    {
      const ghFixtureDir = join(work, "gh-title-fixture");
      mkdirSync(ghFixtureDir, { recursive: true });
      const fakeGhPath = join(ghFixtureDir, "gh");
      // One shim, routed by path shape, standing in for every `gh api` call
      // fetchIssue/fetchPr/fetchAll can make — a listing (`?state=all`), a
      // paginated sub-collection (path ends in /comments or /reviews), or a
      // single object (a bare issues/N or pulls/N). This is deliberately the
      // SAME shim for all three modes below: title-folding at one call site
      // regressing while the other two stay fixed is exactly the gap a
      // prior review caught (only --issue was covered, and reverting the
      // fold in fetchPr or fetchAll alone still passed 155/155) — one shared
      // fixture exercised by three independent assertions is what actually
      // closes that.
      writeFileSync(
        fakeGhPath,
        [
          "#!/usr/bin/env node",
          'const args = process.argv.slice(2);',
          'if (args[0] !== "api") { process.exit(1); }',
          'const path = args[1] || "";',
          'if (path.includes("?state=all")) {',
          "  process.stdout.write(JSON.stringify([[{",
          "    number: 1,",
          '    html_url: "https://example.invalid/issues/1",',
          '    title: "planted-title-term-acme-corp",',
          '    body: "ordinary body text, nothing interesting here",',
          "  }]]));", // one page, one issue entry — --slurp shape
          '} else if (path.endsWith("/comments") || path.endsWith("/reviews")) {',
          '  process.stdout.write(JSON.stringify([[]]));', // one empty page
          "} else {",
          "  process.stdout.write(JSON.stringify({",
          '    title: "planted-title-term-acme-corp",',
          '    body: "ordinary body text, nothing interesting here",',
          '    html_url: "https://example.invalid/issues/1",',
          "  }));", // a bare issues/N or pulls/N — single-object shape
          "}",
          "process.exit(0);",
        ].join("\n"),
        "utf8",
      );
      chmodSync(fakeGhPath, 0o755);

      const env = { ...process.env, PATH: `${ghFixtureDir}:${process.env.PATH}` };
      const modes = [
        ["--issue", "1"],
        ["--pr", "1"],
        ["--all"],
      ];
      for (const modeArgs of modes) {
        const label = modeArgs[0];
        const result = run("node", [CONVERSATION, ...modeArgs, "--repo", "x/y", "--denylist", synthPath, "--require-denylist"], { env });
        check(
          `a title-only match is caught by ${label} mode (title reaches the scanner, not just body)`,
          result.code === 1,
          `expected exit 1 (title term should have been flagged), got ${result.code}: ${result.out.slice(0, 300)}`,
        );
        check(`the title match is still never echoed in ${label} mode`, !result.out.includes("acme-corp"), `matched title term leaked into ${label} output: ${result.out}`);
      }
    }

    // ---- SINCE/UPDATED_AT REGRESSION (issue #589). --since used to filter
    // comments/reviews on created_at (or, for a review, submitted_at) ONLY —
    // an item created long before the cutoff but EDITED after it evaded a
    // bounded retrospective scan entirely, the exact false-clean AGENTS.md's
    // "Conversation surface" section warns about (an edit after posting does
    // not undo the notification already sent, and GitHub keeps the pre-edit
    // revision visible in its own edit-history). Real provider field shapes,
    // verified against the live GitHub REST API before writing this fixture
    // (not assumed): an issue comment and a PR review (inline diff) comment
    // both carry `created_at` AND `updated_at`; a PR review carries ONLY
    // `submitted_at` — GitHub's review object has no updated_at at all, so
    // "old-created/new-updated" cannot be literally constructed for that one
    // type. Its regression is instead: (a) submitted_at is still honored
    // on its own, both to include and to exclude, and (b) a review with NO
    // usable timestamp field is INCLUDED (fail-closed), never silently
    // dropped as "before the cutoff".
    {
      const SINCE_CUTOFF = "2024-06-15T00:00:00Z";
      const OLD_CREATED = "2024-01-01T00:00:00Z"; // before the cutoff
      const NEW_UPDATED = "2024-07-01T00:00:00Z"; // after the cutoff — the edit
      const OLD_UPDATED = "2024-01-02T00:00:00Z"; // before the cutoff — never edited
      const REVIEW_SUBMITTED_INCLUDED = "2024-07-01T00:00:00Z"; // after cutoff
      const REVIEW_SUBMITTED_EXCLUDED = "2024-01-01T00:00:00Z"; // before cutoff

      const ghFixtureDir = join(work, "gh-since-fixture");
      mkdirSync(ghFixtureDir, { recursive: true });
      const fakeGhPath = join(ghFixtureDir, "gh");
      // Routed by path shape, same seam as the title-regression fixture
      // above. Order matters: the PR-scoped `/comments` and `/reviews`
      // checks must run before the generic `.endsWith("/comments")` check,
      // since `repos/x/y/pulls/1/comments` also ends with `/comments`.
      writeFileSync(
        fakeGhPath,
        [
          "#!/usr/bin/env node",
          "const args = process.argv.slice(2);",
          'if (args[0] !== "api") { process.exit(1); }',
          'const path = args[1] || "";',
          `const OLD_CREATED = ${JSON.stringify(OLD_CREATED)};`,
          `const NEW_UPDATED = ${JSON.stringify(NEW_UPDATED)};`,
          `const OLD_UPDATED = ${JSON.stringify(OLD_UPDATED)};`,
          `const REVIEW_SUBMITTED_INCLUDED = ${JSON.stringify(REVIEW_SUBMITTED_INCLUDED)};`,
          `const REVIEW_SUBMITTED_EXCLUDED = ${JSON.stringify(REVIEW_SUBMITTED_EXCLUDED)};`,
          "if (/\\/pulls\\/\\d+\\/comments$/.test(path)) {",
          "  // PR review (inline diff) comments — created_at AND updated_at, verified live.",
          "  process.stdout.write(JSON.stringify([[",
          '    { id: 101, html_url: "https://example.invalid/rc/101", body: "review comment edited after cutoff, mentions acme-corp", created_at: OLD_CREATED, updated_at: NEW_UPDATED },',
          '    { id: 102, html_url: "https://example.invalid/rc/102", body: "review comment never edited, mentions acme-corp", created_at: OLD_CREATED, updated_at: OLD_UPDATED },',
          "  ]]));",
          "} else if (/\\/pulls\\/\\d+\\/reviews$/.test(path)) {",
          "  // PR reviews — submitted_at only, no created_at/updated_at, verified live.",
          "  process.stdout.write(JSON.stringify([[",
          '    { id: 201, html_url: "https://example.invalid/rv/201", body: "review submitted after cutoff, mentions acme-corp", submitted_at: REVIEW_SUBMITTED_INCLUDED },',
          '    { id: 202, html_url: "https://example.invalid/rv/202", body: "review submitted before cutoff, mentions acme-corp", submitted_at: REVIEW_SUBMITTED_EXCLUDED },',
          '    { id: 203, html_url: "https://example.invalid/rv/203", body: "review with no usable timestamp at all, mentions acme-corp" },',
          "  ]]));",
          '} else if (path.endsWith("/comments")) {',
          "  // issue comments (and a PR's issue-style comments) — created_at AND updated_at, verified live.",
          "  process.stdout.write(JSON.stringify([[",
          '    { id: 301, html_url: "https://example.invalid/ic/301", body: "issue comment edited after cutoff, mentions acme-corp", created_at: OLD_CREATED, updated_at: NEW_UPDATED },',
          '    { id: 302, html_url: "https://example.invalid/ic/302", body: "issue comment never edited, mentions acme-corp", created_at: OLD_CREATED, updated_at: OLD_UPDATED },',
          "  ]]));",
          "} else {",
          "  // a bare issues/N or pulls/N — the object's own body, deliberately clean",
          "  // so every finding below is attributable to a comment/review, not the body.",
          "  process.stdout.write(JSON.stringify({",
          '    title: "ordinary title, nothing planted",',
          '    body: "ordinary body text, nothing planted",',
          '    html_url: "https://example.invalid/n",',
          "  }));",
          "}",
          "process.exit(0);",
        ].join("\n"),
        "utf8",
      );
      chmodSync(fakeGhPath, 0o755);

      const env = { ...process.env, PATH: `${ghFixtureDir}:${process.env.PATH}` };

      function findingLocations(modeArgs) {
        const result = run(
          "node",
          [CONVERSATION, ...modeArgs, "--repo", "x/y", "--since", SINCE_CUTOFF, "--denylist", synthPath, "--require-denylist", "--json"],
          { env },
        );
        let parsed = null;
        try {
          parsed = JSON.parse(result.out);
        } catch {
          parsed = null;
        }
        return { result, locations: parsed ? parsed.findings.map((f) => f.location) : null };
      }

      {
        const { result, locations } = findingLocations(["--issue", "1"]);
        check(
          "--since --issue: an issue comment CREATED before the cutoff but UPDATED after it is scanned",
          locations !== null && locations.some((l) => l.includes("comment 301")),
          `expected comment 301 among findings, got: ${JSON.stringify(locations)} (raw: ${result.out.slice(0, 300)})`,
        );
        check(
          "--since --issue: an issue comment entirely before the cutoff (never edited) is still excluded",
          locations !== null && !locations.some((l) => l.includes("comment 302")),
          `comment 302 (entirely before cutoff) should have been excluded, got: ${JSON.stringify(locations)}`,
        );
      }

      {
        const { result, locations } = findingLocations(["--pr", "1"]);
        check(
          "--since --pr: a PR (issue-style) comment CREATED before the cutoff but UPDATED after it is scanned",
          locations !== null && locations.some((l) => l.includes("comment 301")),
          `expected comment 301 among findings, got: ${JSON.stringify(locations)} (raw: ${result.out.slice(0, 300)})`,
        );
        check(
          "--since --pr: a review comment CREATED before the cutoff but UPDATED after it is scanned",
          locations !== null && locations.some((l) => l.includes("review comment 101")),
          `expected review comment 101 among findings, got: ${JSON.stringify(locations)} (raw: ${result.out.slice(0, 300)})`,
        );
        check(
          "--since --pr: a review comment entirely before the cutoff (never edited) is still excluded",
          locations !== null && !locations.some((l) => l.includes("review comment 102")),
          `review comment 102 (entirely before cutoff) should have been excluded, got: ${JSON.stringify(locations)}`,
        );
        check(
          "--since --pr: a review submitted after the cutoff is scanned (submitted_at fallback still works)",
          locations !== null && locations.some((l) => l.includes("review 201") && !l.includes("comment")),
          `expected review 201 among findings, got: ${JSON.stringify(locations)} (raw: ${result.out.slice(0, 300)})`,
        );
        check(
          "--since --pr: a review submitted before the cutoff is excluded",
          locations !== null && !locations.some((l) => l.includes("review 202") && !l.includes("comment")),
          `review 202 (submitted before cutoff) should have been excluded, got: ${JSON.stringify(locations)}`,
        );
        check(
          "--since --pr: a review with NO usable timestamp at all is INCLUDED (fail closed, never silently dropped)",
          locations !== null && locations.some((l) => l.includes("review 203") && !l.includes("comment")),
          `expected review 203 (unresolvable timestamp) to be included by fail-closed handling, got: ${JSON.stringify(locations)} (raw: ${result.out.slice(0, 300)})`,
        );
        check(`--since --pr: no matched text is echoed into output`, !result.out.includes("acme-corp"), `matched term leaked into --pr --since output: ${result.out}`);
      }
    }

    // ---- #923: `--help` used to have no handler at all, so it silently
    // fell through into draft mode — reading zero bytes of stdin (or, with
    // a real terminal attached, blocking forever) and reporting a FULL-mode
    // PASS over a run that examined nothing. Now `--help` is handled first,
    // before stdin is ever touched, and any other unrecognised flag is
    // refused (exit 2, naming the flag) rather than silently treated as
    // "read stdin instead".
    {
      // No `input` option here at all (not even ""), matching the run()
      // helper's own contract above: without `input`, child stdio[0] is
      // "ignore" rather than piped/inherited — this is what actually stood
      // in for the reported terminal-hang report while staying hermetic
      // (an "ignore"d stdin behaves like /dev/null: an immediate EOF, not a
      // blocking read). The defect this regression-tests is not "does it
      // hang" so much as "does --help even get recognised before stdin is
      // consulted at all" — and that is exactly what the old code failed to
      // do, whether stdin was a live terminal or already closed.
      const help = run("node", [CONVERSATION, "--help"]);
      check("--help exits 0", help.code === 0, `exit was ${help.code}: ${help.out.slice(0, 300)}`);
      check(
        "--help prints usage and says nothing about a scan (never reads stdin, never emits a verdict)",
        /Usage:/.test(help.out) && !/scanned \d+ conversation item/.test(help.out) && !/PASS|FAIL|NOT-APPLICABLE/.test(help.out),
        `output: ${help.out.slice(0, 400)}`,
      );

      const unknown = run("node", [CONVERSATION, "--bogus-flag"]);
      check(
        "an unrecognised flag exits 2 (could not run) rather than falling through to stdin/draft mode",
        unknown.code === 2,
        `exit was ${unknown.code}: ${unknown.out.slice(0, 300)}`,
      );
      check("the unrecognised-flag message names the offending flag", unknown.out.includes("--bogus-flag"), `output: ${unknown.out}`);

      // ---- "scanned 0 items" must read as not-applicable, never as PASS
      // (docs/LIFECYCLE.md's eighth value: `not-applicable, with a reason`
      // is a distinct verdict from a pass, because nothing was examined).
      const emptyDraft = run("node", [CONVERSATION, "--denylist", synthPath, "--require-denylist", "--json"], { input: "" });
      let emptyReport = null;
      try {
        emptyReport = JSON.parse(emptyDraft.out);
      } catch {
        emptyReport = null;
      }
      check("scanning 0 items still exits 0 — it is a legitimate no-op, not a failure", emptyDraft.code === 0, `exit was ${emptyDraft.code}: ${emptyDraft.out.slice(0, 300)}`);
      check(
        "scanning 0 items reports verdict not-applicable in --json, never pass",
        emptyReport?.scanned === 0 && emptyReport?.verdict === "not-applicable",
        `report: ${JSON.stringify(emptyReport)}`,
      );

      const emptyDraftText = run("node", [CONVERSATION, "--denylist", synthPath, "--require-denylist"], { input: "" });
      check(
        "scanning 0 items in text mode prints NOT-APPLICABLE, never a bare PASS line",
        /NOT-APPLICABLE/.test(emptyDraftText.out) && !/^PASS/m.test(emptyDraftText.out),
        `output: ${emptyDraftText.out}`,
      );

      // ---- the legitimate empty-draft no-op is the ONLY thing that
      // changed. A real, non-empty draft must still scan normally and still
      // report an ordinary PASS when clean — this is the regression check
      // that the not-applicable change above didn't also swallow real scans.
      const realDraft = run("node", [CONVERSATION, "--denylist", synthPath, "--require-denylist", "--json"], {
        input: "An ordinary, unremarkable comment about a bug fix.\n",
      });
      let realReport = null;
      try {
        realReport = JSON.parse(realDraft.out);
      } catch {
        realReport = null;
      }
      check(
        "a real (non-empty) draft still scans normally and reports verdict pass",
        realDraft.code === 0 && realReport?.scanned === 1 && realReport?.verdict === "pass",
        `report: ${JSON.stringify(realReport)}`,
      );

      // ---- stdin mode remains genuinely intended and unbroken: piping
      // real, non-empty text with no --file still works end to end.
      const stdinDraft = run("node", [CONVERSATION, "--denylist", synthPath, "--require-denylist"], { input: "hello from stdin\n" });
      check(
        "stdin mode (no --file) still scans a genuinely piped draft and passes",
        stdinDraft.code === 0 && /scanned 1 conversation item/.test(stdinDraft.out) && /PASS/.test(stdinDraft.out),
        `output: ${stdinDraft.out.slice(0, 300)}`,
      );
    }

    // ---- #335: BOT-AUTHORED COMMENTS ARE NOT EXEMPT, AND EVERY FINDING
    // CARRIES A MACHINE-READABLE ISSUE/PR NUMBER.
    //
    // #335 reported the conversation gate missing a denylisted identity in a
    // bot-authored comment and read that as an author exemption. There is no
    // author exemption — neither this scanner nor
    // .github/workflows/conversation-safety.yml has ever read a comment's
    // author, and #274 records the event workflow failing 12
    // `pull_request_review_comment` runs on bot-authored comments. The first
    // assertion below is the one #335 asks for verbatim ("feed a bot-authored
    // comment containing a denylisted fixture string and assert a finding"),
    // and it is here to keep that true rather than to have ever been false:
    // if someone later adds an author filter "to cut bot noise", this is what
    // refuses it.
    //
    // The real gap #335 measured is that a scan is a judgement against the
    // denylist OF THE MOMENT IT RAN, and nothing ever re-asks. That is closed
    // by .github/workflows/conversation-safety-sweep.yml, whose shape the
    // cases further below pin — and which needs `number` as DATA to know what
    // to label. Recovering it by regex from `location`'s prose would break
    // silently the day that wording changes, and a sweep that labels nothing
    // is indistinguishable from a sweep that found nothing.
    {
      const ghFixtureDir = join(work, "gh-bot-author-fixture");
      mkdirSync(ghFixtureDir, { recursive: true });
      const fakeGhPath = join(ghFixtureDir, "gh");
      // Routed by path shape, same seam as the fixtures above. The planted
      // term is the synthetic one this whole suite uses — never a real
      // denylist term; see SYNTH_DENYLIST's note at the top of this file.
      // Both bot-authored comment KINDS are planted: an issue-style comment
      // on the PR, and an inline review comment, because GitHub delivers
      // those through two different events and a filter added to one would
      // not necessarily show up in the other.
      writeFileSync(
        fakeGhPath,
        [
          "#!/usr/bin/env node",
          "const args = process.argv.slice(2);",
          'if (args[0] !== "api") { process.exit(1); }',
          'const path = args[1] || "";',
          'const BOT = { login: "some-review-bot[bot]", type: "Bot" };',
          'if (path.includes("/pulls/") && path.endsWith("/comments")) {',
          "  process.stdout.write(JSON.stringify([[{",
          "    id: 9001,",
          "    user: BOT,",
          '    html_url: "https://example.invalid/pull/77#discussion_r9001",',
          '    body: "Rate limit reached for acme-corp. Retrying later.",',
          "  }]]));",
          '} else if (path.includes("/pulls/") && path.endsWith("/reviews")) {',
          "  process.stdout.write(JSON.stringify([[]]));",
          '} else if (path.endsWith("/comments")) {',
          "  process.stdout.write(JSON.stringify([[{",
          "    id: 9002,",
          "    user: BOT,",
          '    html_url: "https://example.invalid/pull/77#issuecomment-9002",',
          '    body: "Automated status from acme-corp tooling.",',
          "  }]]));",
          "} else {",
          "  process.stdout.write(JSON.stringify({",
          '    title: "An ordinary pull request title",',
          '    body: "An ordinary pull request body.",',
          '    html_url: "https://example.invalid/pull/77",',
          "  }));",
          "}",
          "process.exit(0);",
        ].join("\n"),
        "utf8",
      );
      chmodSync(fakeGhPath, 0o755);

      const env = { ...process.env, PATH: `${ghFixtureDir}:${process.env.PATH}` };
      const result = run("node", [CONVERSATION, "--pr", "77", "--repo", "x/y", "--denylist", synthPath, "--require-denylist", "--json"], { env });
      let report = null;
      try {
        report = JSON.parse(result.out);
      } catch {
        report = null;
      }
      const findings = report?.findings ?? [];

      check(
        "#335: a BOT-authored PR comment carrying a denylisted term is a finding — comment authors are never exempt",
        result.code === 1 && findings.some((f) => String(f.location).includes("9002")),
        `expected exit 1 with a finding on comment 9002, got exit ${result.code}: ${result.out.slice(0, 400)}`,
      );
      check(
        "#335: a BOT-authored inline REVIEW comment carrying a denylisted term is a finding too",
        result.code === 1 && findings.some((f) => String(f.location).includes("9001")),
        `expected a finding on review comment 9001, got: ${JSON.stringify(findings.map((f) => f.location))}`,
      );
      check(
        "#335: the bot comment's matched term is still never echoed",
        !result.out.includes("acme-corp"),
        `matched term leaked into bot-comment output: ${result.out}`,
      );
      check(
        "every --json finding carries a machine-readable issue/PR `number`, so a sweep can label without regex-parsing prose",
        findings.length > 0 && findings.every((f) => f.number === 77),
        `expected every finding to carry number 77, got: ${JSON.stringify(findings.map((f) => ({ location: f.location, number: f.number })))}`,
      );

      // Draft mode has no issue/PR identity, so `number` must be null there
      // rather than absent or invented — a caller filtering on
      // Number.isInteger must not accidentally pick up a draft finding.
      const draft = run("node", [CONVERSATION, "--denylist", synthPath, "--require-denylist", "--json"], { input: "a draft mentioning acme-corp\n" });
      let draftReport = null;
      try {
        draftReport = JSON.parse(draft.out);
      } catch {
        draftReport = null;
      }
      check(
        "a draft-mode finding carries `number: null` — a draft has no issue/PR to label",
        draft.code === 1 && (draftReport?.findings ?? []).length > 0 && (draftReport?.findings ?? []).every((f) => f.number === null),
        `report: ${JSON.stringify(draftReport)}`,
      );
    }

    // ---- #944: pull_request_review must scan inline comments bundled with a
    // submitted review, not only the summary body. GitHub does not always emit
    // pull_request_review_comment for those; the live workflow uses
    // --pr --review to fetch them. Double-scan via the separate event is fine.
    {
      const ghFixtureDir = join(work, "gh-review-inline-fixture");
      mkdirSync(ghFixtureDir, { recursive: true });
      const fakeGhPath = join(ghFixtureDir, "gh");
      writeFileSync(
        fakeGhPath,
        [
          "#!/usr/bin/env node",
          "const args = process.argv.slice(2);",
          'if (args[0] !== "api") { process.exit(1); }',
          'const path = args[1] || "";',
          'const reviewMatch = path.match(/\\/pulls\\/(\\d+)\\/reviews\\/(\\d+)(\\/comments)?$/);',
          "if (reviewMatch) {",
          "  const reviewId = reviewMatch[2];",
          '  if (path.endsWith("/comments")) {',
          '    if (reviewId === "501") {',
          "      process.stdout.write(JSON.stringify([[{",
          "        id: 50101,",
          '        html_url: "https://example.invalid/pull/44#discussion_r50101",',
          '        body: "Inline note mentions acme-corp inside the submitted review.",',
          "      }]]));",
          "    } else {",
          '      process.stdout.write(JSON.stringify([[]]));',
          "    }",
          "  } else {",
          '    process.stdout.write(JSON.stringify({',
          '      id: Number(reviewId),',
          '      html_url: "https://example.invalid/pull/44#pullrequestreview-" + reviewId,',
          '      body: "",',
          "    }));",
          "  }",
          "  process.exit(0);",
          "}",
          "process.exit(1);",
        ].join("\n"),
        "utf8",
      );
      chmodSync(fakeGhPath, 0o755);

      const env = { ...process.env, PATH: `${ghFixtureDir}:${process.env.PATH}` };

      const withInline = run(
        "node",
        [CONVERSATION, "--pr", "44", "--review", "501", "--repo", "x/y", "--denylist", synthPath, "--require-denylist", "--json"],
        { env, input: "" },
      );
      let withInlineReport = null;
      try {
        withInlineReport = JSON.parse(withInline.out);
      } catch {
        withInlineReport = null;
      }
      check(
        "#944: empty review summary plus one non-empty inline comment carrying a denylisted term is a finding",
        withInline.code === 1 && (withInlineReport?.findings ?? []).some((f) => String(f.location).includes("50101")),
        `expected exit 1 with a finding on review comment 50101, got exit ${withInline.code}: ${withInline.out.slice(0, 400)}`,
      );
      check(
        "#944: the inline review comment finding is still never echoed",
        !withInline.out.includes("acme-corp"),
        `matched term leaked into --review output: ${withInline.out}`,
      );

      const noInline = run(
        "node",
        [CONVERSATION, "--pr", "44", "--review", "502", "--repo", "x/y", "--denylist", synthPath, "--require-denylist", "--json"],
        { env, input: "" },
      );
      let noInlineReport = null;
      try {
        noInlineReport = JSON.parse(noInline.out);
      } catch {
        noInlineReport = null;
      }
      check(
        "#944: empty review summary and no non-empty inline comments is not a finding",
        noInline.code === 0 && noInlineReport?.verdict === "not-applicable" && noInlineReport?.scanned === 0,
        `expected exit 0 not-applicable with scanned 0, got exit ${noInline.code}: ${JSON.stringify(noInlineReport)}`,
      );

      const summaryOnly = run(
        "node",
        [CONVERSATION, "--pr", "44", "--review", "502", "--repo", "x/y", "--denylist", synthPath, "--require-denylist", "--json"],
        { env, input: "Review summary mentions acme-corp.\n" },
      );
      let summaryOnlyReport = null;
      try {
        summaryOnlyReport = JSON.parse(summaryOnly.out);
      } catch {
        summaryOnlyReport = null;
      }
      check(
        "#944: a non-empty review summary is still scanned when the review has no inline comments",
        summaryOnly.code === 1 &&
          (summaryOnlyReport?.findings ?? []).some((f) => /review 502/.test(String(f.location)) && !/comment/.test(String(f.location))),
        `expected exit 1 on review 502's summary, got exit ${summaryOnly.code}: ${summaryOnly.out.slice(0, 400)}`,
      );
      check(
        "#944: the review summary finding is still never echoed",
        !summaryOnly.out.includes("acme-corp"),
        `matched term leaked into review-summary output: ${summaryOnly.out}`,
      );

      const summaryAndInline = run(
        "node",
        [CONVERSATION, "--pr", "44", "--review", "501", "--repo", "x/y", "--denylist", synthPath, "--require-denylist", "--json"],
        { env, input: "An ordinary summary with nothing planted.\n" },
      );
      let summaryAndInlineReport = null;
      try {
        summaryAndInlineReport = JSON.parse(summaryAndInline.out);
      } catch {
        summaryAndInlineReport = null;
      }
      check(
        "#944: inline comments are scanned even when the review summary is non-empty",
        summaryAndInline.code === 1 && (summaryAndInlineReport?.findings ?? []).some((f) => String(f.location).includes("50101")),
        `expected exit 1 on review comment 50101 alongside a clean summary, got exit ${summaryAndInline.code}: ${summaryAndInline.out.slice(0, 400)}`,
      );

      // Review events reach conversation-safety.yml through
      // conversation-safety-review-relay.yml and a workflow_run trigger, so
      // the subscription is asserted on the relay and the --pr --review scan
      // on the workflow_run branch of the gate step.
      const eventWorkflowPath = join(repoRoot, ".github", "workflows", "conversation-safety.yml");
      const eventWorkflow = readFileSync(eventWorkflowPath, "utf8");
      const relayWorkflow = readFileSync(join(repoRoot, ".github", "workflows", "conversation-safety-review-relay.yml"), "utf8");
      const gateStep = eventWorkflow.split("name: Run conversation safety gate")[1]?.split("- name: Redact denylist")[0] ?? "";
      const gateRun = gateStep.split("run: |")[1] ?? "";
      check(
        "#944: pull_request_review fetches and scans inline comments attached to a submitted review in this run",
        /inline comments attached to a submitted review are fetched and scanned in this run/i.test(eventWorkflow) &&
          /node scripts\/check-conversation-safety\.mjs --pr "\$RELAY_PR_NUMBER" --review "\$RELAY_REVIEW_ID" --edit-history --require-denylist/.test(gateRun) &&
          /^ {2}pull_request_review:\n {4}types: \[submitted, edited\]/m.test(relayWorkflow) &&
          !/still arrive as their own/.test(eventWorkflow) &&
          !/separate pull_request_review_comment events and are scanned by/.test(eventWorkflow),
        "conversation-safety.yml does not fetch this review's inline comments, or it still claims they always arrive as separate events",
      );
      check(
        "#944: pull_request_review_comment stays subscribed — a comment that also arrives on its own is still scanned",
        /^ {2}pull_request_review_comment:\n {4}types: \[created, edited\]/m.test(relayWorkflow),
        "the per-comment event was dropped from conversation-safety-review-relay.yml",
      );
      check(
        "#944: the gate run script does not interpolate event text via ${{ }}",
        gateRun.length > 0 && !/\$\{\{/.test(gateRun),
        "untrusted event text is interpolated into the gate run script",
      );
    }

    // ---- #335, second half: THE SWEEP MUST EXIST, BE SCHEDULED, AND NEVER
    // COMMENT.
    //
    // conversation-safety.yml scans text when it is posted, against the
    // denylist snapshot CI holds at that instant. A pull_request_review run
    // also fetches that review's inline comments, and a later
    // pull_request_review_comment for the same comment may scan it again;
    // that second scan is acceptable. When a term is added to the real denylist and the
    // PUBLIC_SAFETY_DENYLIST_B64 secret has not yet been refreshed, that gate
    // returns a correct, FULL-mode PASS for the question it was asked — and
    // nothing ever asks again, because the event is gone. The same silence
    // covers a run that was cancelled, an event that predates the workflow,
    // and an event GitHub never delivered.
    //
    // conversation-safety-sweep.yml is the only thing in this repository that
    // re-asks. These assertions are deliberately shape assertions on the
    // workflow file: its value is entirely in RUNNING ON A CADENCE, and a
    // sweep whose `schedule:` is quietly dropped still passes every scanner
    // test in this file while never running again.
    {
      const sweepPath = join(repoRoot, ".github", "workflows", "conversation-safety-sweep.yml");
      const exists = existsSync(sweepPath);
      check(
        "#335: a scheduled conversation-surface sweep workflow exists (the event gate alone can never re-scan under a newer denylist)",
        exists,
        `expected ${sweepPath} to exist`,
      );
      if (exists) {
        const sweep = readFileSync(sweepPath, "utf8");
        check(
          "the sweep runs on a schedule — an on-demand-only sweep is one nobody runs",
          /^\s*schedule:\s*$/m.test(sweep) && /^\s*-\s*cron:\s*["']/m.test(sweep),
          "no `schedule:` with a `- cron:` entry found in conversation-safety-sweep.yml",
        );
        check(
          "the sweep is also dispatchable on demand, for the deliberate full pass after a denylist change",
          /^\s*workflow_dispatch:/m.test(sweep),
          "no `workflow_dispatch:` trigger found in conversation-safety-sweep.yml",
        );
        check(
          "the sweep invokes check-conversation-safety.mjs in --all mode",
          /check-conversation-safety\.mjs --all/.test(sweep),
          "conversation-safety-sweep.yml does not run the scanner in --all mode",
        );
        check(
          "the sweep refuses to degrade to PARTIAL — a sweep that skips identity checks is the exact false clearance being fixed",
          /--require-denylist/.test(sweep),
          "conversation-safety-sweep.yml does not pass --require-denylist",
        );
        check(
          "the sweep labels its findings",
          /addLabels/.test(sweep),
          "conversation-safety-sweep.yml never calls addLabels — a finding nobody is told about is not a finding",
        );
        // The load-bearing negative. On a public repository an automated
        // "private identity detected here" reply is itself a public signal,
        // and points a reader at the edit history where the original text
        // still sits — see conversation-safety.yml's own note. This sweep
        // speaks about text that has been public for weeks, so it applies
        // with more force here, not less.
        check(
          "the sweep NEVER posts a comment — labeling is the whole remediation channel, deliberately",
          !/createComment|create_comment|gh (issue|pr) comment/.test(sweep),
          "conversation-safety-sweep.yml appears to post a comment; on a public repository that broadcasts the very finding it is meant to contain",
        );
      }
    }
  }

  // ------------------------------------------- check-foreign-references
  console.log("\n# check-foreign-references: naming an account or repository that is not this one");
  {
    // Every planted foreign name below is ASSEMBLED FROM FRAGMENTS at run
    // time, never written out whole. Same discipline as the credential
    // fixtures near the top of this file, and for a sharper reason here:
    // check-foreign-references scans THIS file, and a name that is genuinely
    // foreign — which is exactly what these cases need — would be caught by
    // the gate under test the moment it appeared as a complete literal in
    // tracked content. Fragments keep the fixtures honest without making the
    // suite fail itself.
    //
    // The fixture's OWN identity uses the already-admitted `gate-fixture`
    // placeholder, so the strings that DO appear whole here name nobody.
    const OWN_SCOPE_NAME = FIXTURE_SCOPE.slice(1); // "gate-fixture"
    const OWN_REPO = "own-repo";
    const PLANTED_SCOPE_NAME = "unadmit" + "ted-scope";
    const PLANTED_OWNER = "unadmit" + "ted-owner";
    const LOCKFILE_SCOPE_NAME = "vend" + "or-only-in-the-lockfile";
    const GH = "https://git" + "hub.com/";
    const PUBLIC_REGISTRY = "https://registry.npm" + "js.org/";

    // A fixture tree with the two declarations the gate derives identity from:
    // package-scope.json's scope, and a manifest's own repository.url.
    function makeTree(name, { docLines = [], lock = undefined, scope = FIXTURE_SCOPE, repoUrl } = {}) {
      const dir = join(work, `foreign-refs-${name}`);
      mkdirSync(join(dir, "packages", "thing"), { recursive: true });
      if (scope !== null) {
        writeFileSync(join(dir, "package-scope.json"), JSON.stringify({ scope, registry: "https://example.invalid" }, null, 2));
      }
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture-root", private: true }, null, 2));
      writeFileSync(
        join(dir, "packages", "thing", "package.json"),
        JSON.stringify(
          { name: `${FIXTURE_SCOPE}/thing`, version: "0.1.0", repository: { type: "git", url: repoUrl ?? `git+${GH}${OWN_SCOPE_NAME}/${OWN_REPO}.git` } },
          null,
          2,
        ),
      );
      writeFileSync(join(dir, "NOTES.md"), ["# notes", "", ...docLines, ""].join("\n"));
      if (lock !== undefined) writeFileSync(join(dir, "package-lock.json"), lock);
      return dir;
    }

    const clean = makeTree("clean", { docLines: ["Install it and read the docs.", `Ships as \`${FIXTURE_SCOPE}/thing\`.`] });
    {
      const result = run("node", [FOREIGN_REFS, clean]);
      check(
        "a tree naming only its own scope and repository passes",
        result.code === 0,
        `expected exit 0, got ${result.code}: ${result.out.slice(0, 600)}`,
      );
    }

    // ---- the two shapes the gate exists to catch
    {
      const dir = makeTree("foreign-scope", { docLines: [`Also re-exported by \`@${PLANTED_SCOPE_NAME}/consumer\`.`] });
      const result = run("node", [FOREIGN_REFS, dir]);
      check(
        "an npm scope that is not this repository's own is a finding",
        result.code === 1,
        `expected exit 1, got ${result.code}: ${result.out.slice(0, 600)}`,
      );
      check(
        "the finding names the offending scope and its location",
        result.out.includes(`@${PLANTED_SCOPE_NAME}`) && result.out.includes("NOTES.md:"),
        `report did not name the scope and file: ${result.out.slice(0, 600)}`,
      );
    }
    {
      // The shape the real leak had: an account named in a doc comment as an
      // "example scope", with NO package after it. A gate that only understood
      // `@scope/name` would pass this tree while looking like it worked.
      const dir = makeTree("bare-foreign-scope", { docLines: ["```js", `// The scope this package publishes under, e.g. \`@${PLANTED_SCOPE_NAME}\``, "```"] });
      const result = run("node", [FOREIGN_REFS, dir]);
      check(
        "a BARE `@<account>` with no package after it is a finding (the shape the real leak had)",
        result.code === 1,
        `expected exit 1, got ${result.code}: ${result.out.slice(0, 600)}`,
      );
      check(
        "the bare-form finding is reported as its own kind, not silently folded into the slashed one",
        result.out.includes("bare-scope"),
        `report did not distinguish the bare form: ${result.out.slice(0, 600)}`,
      );
    }
    {
      const dir = makeTree("foreign-owner", { docLines: [`Tracked at ${GH}${PLANTED_OWNER}/somewhere/issues/1.`] });
      const result = run("node", [FOREIGN_REFS, dir]);
      check(
        "a forge owner that is not this repository's own is a finding",
        result.code === 1,
        `expected exit 1, got ${result.code}: ${result.out.slice(0, 600)}`,
      );
      check("the finding names the offending owner", result.out.includes(PLANTED_OWNER), `report did not name the owner: ${result.out.slice(0, 600)}`);
    }
    {
      // "no account OTHER THAN ITS OWN" includes a sibling repository under the
      // same account: a private control-plane repo next door is exactly the
      // kind of thing this repository must not point a public reader at.
      const dir = makeTree("sibling-repo", { docLines: [`See ${GH}${OWN_SCOPE_NAME}/${"a-sib" + "ling-repo"}.`] });
      const result = run("node", [FOREIGN_REFS, dir]);
      check(
        "a DIFFERENT repository under this repository's own account is still a finding",
        result.code === 1,
        `expected exit 1, got ${result.code}: ${result.out.slice(0, 600)}`,
      );
    }
    {
      const dir = makeTree("uses", { docLines: ["```yaml", `      - uses: ${PLANTED_OWNER}/some-action@v1`, "```"] });
      const result = run("node", [FOREIGN_REFS, dir]);
      check(
        "a workflow `uses:` naming a foreign owner is a finding",
        result.code === 1,
        `expected exit 1, got ${result.code}: ${result.out.slice(0, 600)}`,
      );
    }

    // ---- admitted classes, each proved to be doing real work
    {
      const dir = makeTree("infrastructure", { docLines: ["```yaml", "      - uses: actions/checkout@v4", "```"] });
      const result = run("node", [FOREIGN_REFS, dir]);
      check(
        "an INFRASTRUCTURE_FORGE_OWNERS entry (the forge's own actions org) is admitted",
        result.code === 0,
        `expected exit 0, got ${result.code}: ${result.out.slice(0, 600)}`,
      );
    }
    {
      // The derived third-party set: a scope is admitted because THIS TREE'S
      // OWN lockfile resolves it from the public npm registry — not because
      // anyone listed it. Three trees, one difference each.
      const doc = [`Built on top of \`@${LOCKFILE_SCOPE_NAME}/tool\`.`];
      const lockEntry = (resolved) =>
        JSON.stringify({ name: "fixture-root", lockfileVersion: 3, packages: { "": {}, [`node_modules/@${LOCKFILE_SCOPE_NAME}/tool`]: { version: "1.0.0", resolved } } }, null, 2);

      const withPublic = makeTree("lock-public", { docLines: doc, lock: lockEntry(`${PUBLIC_REGISTRY}@${LOCKFILE_SCOPE_NAME}/tool/-/tool-1.0.0.tgz`) });
      check(
        "a scope this tree's lockfile resolves from the public npm registry is admitted",
        run("node", [FOREIGN_REFS, withPublic]).code === 0,
        `expected exit 0 for a publicly-resolved dependency scope: ${run("node", [FOREIGN_REFS, withPublic]).out.slice(0, 600)}`,
      );

      const withPrivate = makeTree("lock-private", { docLines: doc, lock: lockEntry("https://npm.example.invalid/@x/tool/-/tool-1.0.0.tgz") });
      check(
        "the SAME scope resolved from somewhere other than the public registry is NOT admitted",
        run("node", [FOREIGN_REFS, withPrivate]).code === 1,
        "a lockfile entry alone admitted a scope — the public-registry condition is not load-bearing",
      );

      const withoutLock = makeTree("lock-absent", { docLines: doc });
      check(
        "with no lockfile at all the same scope is NOT admitted (absence is the strict direction)",
        run("node", [FOREIGN_REFS, withoutLock]).code === 1,
        "a missing lockfile silently admitted a third-party scope",
      );
    }

    {
      // A single stray NUL byte must not switch this gate off for a whole file.
      // The ordinary `if (contents has a NUL) continue` binary heuristic does
      // exactly that, and it is not hypothetical: one source file in this
      // repository embeds a literal NUL as the needle of its own binary check,
      // and an early draft of check-foreign-references skipped that file
      // wholesale — the same file the leak that motivated the gate lived in. A
      // planted foreign scope in it was missed and the gate reported PASS.
      const dir = makeTree("nul-byte");
      writeFileSync(
        join(dir, "NOTES.md"),
        ["# notes", "", `A binary sentinel: "${String.fromCharCode(0)}" is one NUL.`, `Adopted by \`@${PLANTED_SCOPE_NAME}/consumer\`.`, ""].join("\n"),
        "utf8",
      );
      const result = run("node", [FOREIGN_REFS, dir]);
      check(
        "a stray NUL byte does not make a whole file invisible to the scan",
        result.code === 1 && result.out.includes(PLANTED_SCOPE_NAME),
        `expected exit 1 naming the planted scope, got ${result.code}: ${result.out.slice(0, 600)}`,
      );
    }

    // ---- shapes that LOOK like a scope and are not
    {
      const dir = makeTree("not-scopes", {
        docLines: [
          "Reach the maintainers at someone@example.invalid/inbox if needed.",
          "A @ts-expect-error/@ts-ignore/expectTypeOf marker is a type-level assertion.",
          "```css",
          "@layer base { @media (min-width: 40rem) { .a { color: red } } }",
          "```",
          "```js",
          "/** @param {string} a @returns {string} @deprecated @see @link */",
          "```",
        ],
      });
      const result = run("node", [FOREIGN_REFS, dir]);
      check(
        "email local parts, TypeScript directives, CSS at-rules and JSDoc tags are not read as accounts",
        result.code === 0,
        `expected exit 0, got ${result.code}: ${result.out.slice(0, 600)}`,
      );
    }

    // ---- deliberate scan exclusion, asserted so it stays deliberate
    {
      // package-lock.json is generated by npm from the public registry, and
      // every name in it follows from the dependency set the manifests already
      // declare (and which this gate DOES scan). Excluding it is a decision,
      // not an oversight — this case pins the decision so that changing it is
      // a visible change rather than a silent one.
      const dir = makeTree("lock-not-scanned", {
        lock: JSON.stringify(
          { name: "fixture-root", lockfileVersion: 3, packages: { "": { funding: `${GH}${PLANTED_OWNER}/tool` } } },
          null,
          2,
        ),
      });
      const result = run("node", [FOREIGN_REFS, dir]);
      check(
        "package-lock.json's own contents are deliberately not scanned",
        result.code === 0,
        `expected exit 0, got ${result.code}: ${result.out.slice(0, 600)}`,
      );
    }

    // ---- fail-closed: never a silent pass when identity cannot be established
    {
      const dir = makeTree("no-scope-config", { scope: null });
      rmSync(join(dir, "package-scope.json"), { force: true });
      // A tree with no package-scope.json ANYWHERE above it. The temp dir has
      // no repository above it, so the upward search genuinely finds nothing.
      const result = run("node", [FOREIGN_REFS, dir]);
      check(
        "a missing package-scope.json fails closed (exit 2), never a pass",
        result.code === 2,
        `expected exit 2, got ${result.code}: ${result.out.slice(0, 400)}`,
      );
    }
    {
      const dir = makeTree("bad-scope-config");
      writeFileSync(join(dir, "package-scope.json"), "{ not json");
      const result = run("node", [FOREIGN_REFS, dir]);
      check(
        "an unparsable package-scope.json fails closed (exit 2)",
        result.code === 2,
        `expected exit 2, got ${result.code}: ${result.out.slice(0, 400)}`,
      );
    }
    {
      const dir = makeTree("no-repository");
      writeFileSync(join(dir, "packages", "thing", "package.json"), JSON.stringify({ name: `${FIXTURE_SCOPE}/thing`, version: "0.1.0" }, null, 2));
      const result = run("node", [FOREIGN_REFS, dir]);
      check(
        "no manifest declaring repository.url fails closed (exit 2) rather than falling back to a hardcoded identity",
        result.code === 2,
        `expected exit 2, got ${result.code}: ${result.out.slice(0, 400)}`,
      );
    }
    {
      const dir = makeTree("disagreeing-manifests");
      mkdirSync(join(dir, "packages", "other"), { recursive: true });
      writeFileSync(
        join(dir, "packages", "other", "package.json"),
        JSON.stringify(
          { name: `${FIXTURE_SCOPE}/other`, version: "0.1.0", repository: { type: "git", url: `git+${GH}${OWN_SCOPE_NAME}/${"a-diff" + "erent-repo"}.git` } },
          null,
          2,
        ),
      );
      const result = run("node", [FOREIGN_REFS, dir]);
      check(
        "manifests disagreeing about which repository this is fails closed (exit 2)",
        result.code === 2,
        `expected exit 2, got ${result.code}: ${result.out.slice(0, 400)}`,
      );
    }
    {
      const dir = makeTree("contradictory-identity", { repoUrl: `git+${GH}${"a-diff" + "erent-account"}/${OWN_REPO}.git` });
      const result = run("node", [FOREIGN_REFS, dir]);
      check(
        "an npm scope and a forge account that contradict each other fail closed (exit 2), not a guess at which is right",
        result.code === 2,
        `expected exit 2, got ${result.code}: ${result.out.slice(0, 400)}`,
      );
    }
    {
      const dir = makeTree("bad-lock", { lock: "{ not json" });
      const result = run("node", [FOREIGN_REFS, dir]);
      check(
        "an unparsable package-lock.json fails closed (exit 2) rather than silently admitting no third-party scope",
        result.code === 2,
        `expected exit 2, got ${result.code}: ${result.out.slice(0, 400)}`,
      );
    }
    {
      const result = run("node", [FOREIGN_REFS, join(work, "foreign-refs-does-not-exist")]);
      check(
        "a missing scan root fails closed (exit 2)",
        result.code === 2,
        `expected exit 2, got ${result.code}: ${result.out.slice(0, 400)}`,
      );
    }
  }

  // ------------------------------------------------ artifact reproducibility
  //
  // ISSUE #893. A qualification record is immutable, and `dist/` is
  // gitignored — so a record can bind tarball bytes that no clean build of
  // the recorded commit reproduces while every tree-digest join stays green,
  // and that version is then permanently unpublishable. Two were burned that
  // way.
  //
  // The negative control has to plant a REAL stale artifact, not a mock one,
  // or it proves nothing. It plants it the way the real one arrives: build,
  // delete a source file, rebuild without cleaning. The build here is two
  // lines of node instead of tsc, but it has tsc's defining property — it
  // never removes an output whose source is gone.
  {
    const root = join(work, "reproducibility");
    const pkg = join(root, "packages", "demo");
    mkdirSync(join(pkg, "src"), { recursive: true });
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "gate-repro-fixture", version: "0.0.0", private: true, workspaces: ["packages/*"], scripts: { build: "node build.mjs" } }, null, 2));
    writeFileSync(
      join(root, "build.mjs"),
      'import { cpSync, mkdirSync, readdirSync } from "node:fs";\nimport { join } from "node:path";\n' +
        'for (const name of readdirSync("packages")) {\n  const src = join("packages", name, "src");\n  const dist = join("packages", name, "dist");\n' +
        '  mkdirSync(dist, { recursive: true });\n  for (const file of readdirSync(src)) cpSync(join(src, file), join(dist, file));\n}\n',
    );
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: `${FIXTURE_SCOPE}/demo`, version: "0.0.1", files: ["dist"] }, null, 2));
    writeFileSync(join(pkg, "src", "index.js"), "export const value = 1;\n");

    let staleDigests;
    let cleanDigests;
    try {
      cleanRebuildAndPack({ root, packageDir: "packages/demo" });
      writeFileSync(join(pkg, "src", "removed-later.js"), "export const removed = true;\n");
      cleanRebuildAndPack({ root, packageDir: "packages/demo" });
      rmSync(join(pkg, "src", "removed-later.js"));
      // The developer-machine rebuild: incremental, uncleaned. dist/ keeps an
      // output whose source no longer exists, and that output packs.
      run("npm", ["run", "build"], { cwd: root });
      staleDigests = packAsIs({ root, packageDir: "packages/demo" });
      cleanDigests = cleanRebuildAndPack({ root, packageDir: "packages/demo" });
    } catch (error) {
      check("artifact reproducibility fixture builds and packs", false, error instanceof Error ? error.message : String(error));
    }

    if (staleDigests && cleanDigests) {
      check(
        "the stale-dist fixture really is stale — it packs different bytes than a clean build",
        staleDigests.sha256 !== cleanDigests.sha256,
        "the fixture failed to produce a stale artifact, so the control below would prove nothing",
      );

      let refused = null;
      try { assertTarballReproducible({ root, packageDir: "packages/demo", expected: staleDigests, requireReleaseRuntime: false }); }
      catch (error) { refused = error; }
      check(
        "a tarball packed from a stale dist/ is refused (issue #893)",
        refused instanceof ReproducibilityMismatch,
        `expected a ReproducibilityMismatch, got: ${refused ? refused.constructor.name + " " + refused.message.slice(0, 200) : "no error at all"}`,
      );

      let accepted = null;
      try { accepted = assertTarballReproducible({ root, packageDir: "packages/demo", expected: cleanDigests, requireReleaseRuntime: false }); }
      catch (error) { accepted = error; }
      check(
        "a tarball packed from a clean build is accepted, so the gate is not simply refusing everything",
        accepted && !(accepted instanceof Error) && accepted.sha256 === cleanDigests.sha256,
        `expected acceptance, got: ${accepted instanceof Error ? accepted.message.slice(0, 300) : JSON.stringify(accepted)}`,
      );
    }
  }

} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log(
  `\n${failures.length ? "FAIL" : "PASS"} — ${passed} assertion(s) passed, ${failures.length} failed` +
    (skipped ? `, ${skipped} skipped (see SKIP line(s) above — not counted as passing).` : `.`),
);
process.exit(failures.length ? 1 : 0);
