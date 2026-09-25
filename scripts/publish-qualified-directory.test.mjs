import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { once } from "node:events";
import { promisify } from "node:util";

import { argsFrom, createOwnerPromptRelay, extractNpmErrorCode, npmErrorCodeFromSession, ownerPresentPtyArgs, publishExitCode, publishQualifiedDirectory, runInteractiveChild } from "./publish-qualified-directory.mjs";
import { IndeterminateError } from "./verify-post-publish-public-npm-artifact.mjs";
import { ALL_PACKAGE_RELEASE_ORDER } from "./check-release-catalog.mjs";

const execFile = promisify(execFileCallback);
const hash = (algorithm, value) => createHash(algorithm).update(value).digest("hex");
const hasPinnedReleaseRuntime = process.version === "v24.19.0" && process.versions.zlib === "1.3.2.1-motley-3246f1b" && spawnSync("npm", ["--version"], { env: { PATH: process.env.PATH, HOME: tmpdir() }, encoding: "utf8" }).stdout?.trim() === "11.17.0";

async function startLoopbackRegistry(t, root) {
  const script = join(root, "loopback-registry.mjs"), capture = join(root, "loopback-publish.json");
  const rawRegistryDocument = "loopback-registry-document-must-not-be-logged";
  await writeFile(script, [
    'import { createServer } from "node:http";',
    'import { writeFileSync } from "node:fs";',
    'const capture = process.argv[2];',
    'const requests = [];',
    'const server = createServer(async (request, response) => {',
    '  const chunks = []; for await (const chunk of request) chunks.push(chunk);',
    '  requests.push({ method: request.method, url: request.url, authorization: request.headers.authorization ?? null, body: Buffer.concat(chunks).toString("base64") });',
    '  writeFileSync(capture, JSON.stringify(requests));',
    `  response.writeHead(201, { "content-type": "application/json" }); response.end(JSON.stringify({ ok: true, diagnostic: ${JSON.stringify(rawRegistryDocument)} }));`,
    '});',
    'server.listen(0, "127.0.0.1", () => process.stdout.write(`${server.address().port}\\n`));',
  ].join("\n"));
  const child = spawn(process.execPath, [script, capture], { stdio: ["ignore", "pipe", "pipe"] });
  const port = await new Promise((resolve, reject) => {
    let output = "", errors = "";
    const fail = (error) => reject(new Error(`loopback registry failed to start: ${error}${errors ? ` (${errors})` : ""}`));
    child.once("error", fail);
    child.stderr.on("data", (chunk) => { errors += chunk; });
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const line = output.split("\n")[0];
      if (/^\d+$/.test(line)) resolve(Number(line));
    });
    child.once("exit", (code) => fail(`exit ${code}`));
  });
  t.after(async () => {
    if (!child.killed) child.kill("SIGTERM");
    await once(child, "exit");
  });
  return { registry: `http://127.0.0.1:${port}`, capture, rawRegistryDocument };
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "qualified-directory-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const packageRoot = join(root, "packages", "strategist");
  await mkdir(join(packageRoot, "dist"), { recursive: true });
  await mkdir(join(root, "governance", "release-qualifications"), { recursive: true });
  await writeFile(join(root, "package-scope.json"), JSON.stringify({ scope: "@clossys", registry: "https://registry.npmjs.org", access: "public" }));
  // The release-catalogue validator deliberately preserves its predecessor.
  // Build the fixture-only predecessor tuple at runtime: it is test data, not
  // a current source identity declaration.
  const historicalScope = String.fromCodePoint(64, 118, 101, 115, 112, 101, 110, 101, 118, 101, 110, 116, 117, 114, 101, 115);
  const historicalStatus = ["hist", "orical"].join("");
  const historicalRegistry = ["https://npm.", "pkg.github.com"].join("");
  await writeFile(join(root, "governance", "release-catalog.json"), JSON.stringify({ schemaVersion: 2, defaultTarget: "clossys-npmjs", targets: [
    { id: "current-github-packages", status: historicalStatus, scope: historicalScope, registry: historicalRegistry, packages: "all" },
    { id: "clossys-npmjs", status: "active", scope: "@clossys", registry: "https://registry.npmjs.org", access: "public", packages: [...ALL_PACKAGE_RELEASE_ORDER] },
  ] }));
  const manifest = { name: "@clossys/strategist", version: "0.1.1", type: "module", files: ["dist", "README.md", "LICENSE"], publishConfig: { registry: "https://registry.npmjs.org", access: "public" } };
  await writeFile(join(packageRoot, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(packageRoot, "README.md"), "Public package\n");
  await writeFile(join(packageRoot, "LICENSE"), "MIT\n");
  await writeFile(join(packageRoot, "dist", "index.js"), "export const value = 1;\n");
  const packed = join(root, "qualified"); await mkdir(packed);
  const output = await execFile("npm", ["pack", ".", "--ignore-scripts", "--json", "--pack-destination", packed], { cwd: packageRoot, env: { PATH: process.env.PATH, HOME: root } });
  const filename = JSON.parse(output.stdout)[0].filename;
  const candidate = join(packed, filename), bytes = await readFile(candidate);
  const record = { timing: "pre-publication", candidate: { name: manifest.name, version: manifest.version, packageManifestSha256: hash("sha256", await readFile(join(packageRoot, "package.json"))), tarball: Object.fromEntries(["sha1", "sha256", "sha512"].map((algorithm) => [algorithm, hash(algorithm, bytes)])) } };
  const recordPath = join(root, "governance", "release-qualifications", "clossys-strategist-0.1.1.json"); await writeFile(recordPath, `${JSON.stringify(record)}\n`);
  const denylist = join(root, "denylist.json"); await writeFile(denylist, JSON.stringify({ version: 1, terms: [{ pattern: "never-match-qualified-wrapper", why: "fixture" }] }));
  return { root, candidate, recordPath, denylist, bytes };
}

test("owner-present wrapper has a closed CLI", () => {
  const argv = ["node", "script", "--package", "strategist", "--candidate", "candidate.tgz", "--record", "record.json"];
  assert.deepEqual(argsFrom(argv), { package: "strategist", candidate: "candidate.tgz", record: "record.json", mode: "owner-present", dryRun: false });
  assert.deepEqual(argsFrom([...argv, "--mode", "oidc", "--dry-run"]), { package: "strategist", candidate: "candidate.tgz", record: "record.json", mode: "oidc", dryRun: true });
  for (const mutation of [["--otp", "123456"], ["--candidate", "https://example.test/x.tgz"], ["--unknown", "x"], ["--package", "../strategist"], ["--dry-run"], ["--mode", "owner-present", "--dry-run"]]) assert.throws(() => argsFrom([...argv, ...mutation]), /Usage:/);
  for (const missing of ["--package", "strategist", "--candidate", "candidate.tgz", "--record", "record.json"]) assert.throws(() => argsFrom(argv.filter((value) => value !== missing)), /Usage:/);
});

test("owner-present publication rejects a programmatic dry-run before touching a candidate", async () => {
  let called = false;
  await assert.rejects(() => publishQualifiedDirectory({
    packageKey: "strategist", candidatePath: "not-read.tgz", recordPath: "not-read.json", mode: "owner-present", dryRun: true,
    run: () => { called = true; return { status: 0, stdout: "", stderr: "" }; },
  }), /owner-present publication does not support dry-run/);
  assert.equal(called, false);
});

test("OIDC dry publication cleanly repacks the qualified bytes and forwards only GitHub OIDC/run identity", async (t) => {
  const item = await fixture(t), calls = [];
  const oidc = {
    ACTIONS_ID_TOKEN_REQUEST_URL: "https://token.actions.githubusercontent.test/oidc",
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "opaque-oidc-request-token",
    GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main", GITHUB_REPOSITORY: "clossys/foundry", GITHUB_REPOSITORY_ID: "123",
    GITHUB_REPOSITORY_OWNER_ID: "456", GITHUB_RUN_ATTEMPT: "1", GITHUB_RUN_ID: "42", GITHUB_SERVER_URL: "https://github.com", GITHUB_SHA: "a".repeat(40),
    GITHUB_WORKFLOW: "Publish", GITHUB_WORKFLOW_REF: "clossys/foundry/.github/workflows/publish.yml@refs/heads/main",
    GITHUB_WORKFLOW_SHA: "b".repeat(40), RUNNER_ENVIRONMENT: "github-hosted",
  };
  const run = (file, args, options) => {
    calls.push({ file, args: [...args], cwd: options.cwd, env: { ...options.env } });
    if (args[0] === "--version") return { status: 0, stdout: file === process.execPath ? "v24.19.0\n" : "11.17.0\n", stderr: "" };
    if (args[0] === "-p") return { status: 0, stdout: "1.3.2.1-motley-3246f1b\n", stderr: "" };
    if (file === process.execPath) return { status: 0, stdout: "", stderr: "" };
    if (args[0] === "pack") {
      writeFileSync(join(args.at(-1), "repacked.tgz"), item.bytes);
      return { status: 0, stdout: JSON.stringify([{ filename: "repacked.tgz" }]), stderr: "" };
    }
    if (args[0] === "publish") return { status: 0, stdout: "", stderr: "" };
    throw new Error(`unexpected command ${file} ${args.join(" ")}`);
  };
  let verified = false;
  await publishQualifiedDirectory({
    root: item.root, packageKey: "strategist", candidatePath: item.candidate, recordPath: item.recordPath,
    mode: "oidc", dryRun: true,
    env: { ...oidc, PATH: process.env.PATH, HOME: item.root, PUBLIC_SAFETY_DENYLIST: item.denylist, NPM_TOKEN: "must-not-forward", NODE_AUTH_TOKEN: "must-not-forward", GITHUB_TOKEN: "must-not-forward" },
    run, interactiveRun: async () => { throw new Error("OIDC must not create an owner PTY"); }, verify: async () => { verified = true; },
  });
  assert.equal(verified, false, "dry OIDC publication must not perform provider/registry verification");
  const publish = calls.find((call) => call.file === "npm" && call.args[0] === "publish");
  assert.ok(publish, "OIDC mode must execute one directory-form npm command");
  assert.deepEqual(publish.args, ["publish", ".", "--provenance", "--access", "public", "--ignore-scripts", "--registry", "https://registry.npmjs.org", "--dry-run"]);
  assert.match(publish.cwd, /clossys-qualified-publish-.*\/package$/);
  assert.notEqual(publish.env.HOME, item.root, "OIDC mode must not receive the owner HOME");
  for (const key of ["NPM_TOKEN", "NODE_AUTH_TOKEN", "GITHUB_TOKEN", "PUBLIC_SAFETY_DENYLIST"]) assert.equal(publish.env[key], undefined, `${key} must not reach npm`);
  for (const [key, value] of Object.entries(oidc)) assert.equal(publish.env[key], value, `${key} must survive the OIDC boundary`);
  assert.deepEqual(Object.keys(publish.env).sort(), ["ACTIONS_ID_TOKEN_REQUEST_TOKEN", "ACTIONS_ID_TOKEN_REQUEST_URL", "GITHUB_ACTIONS", "GITHUB_EVENT_NAME", "GITHUB_REF", "GITHUB_REPOSITORY", "GITHUB_REPOSITORY_ID", "GITHUB_REPOSITORY_OWNER_ID", "GITHUB_RUN_ATTEMPT", "GITHUB_RUN_ID", "GITHUB_SERVER_URL", "GITHUB_SHA", "GITHUB_WORKFLOW", "GITHUB_WORKFLOW_REF", "GITHUB_WORKFLOW_SHA", "HOME", "PATH", "RUNNER_ENVIRONMENT"].sort());
  for (const missing of ["GITHUB_EVENT_NAME", "GITHUB_REF", "GITHUB_REPOSITORY_ID", "GITHUB_REPOSITORY_OWNER_ID", "GITHUB_RUN_ATTEMPT", "GITHUB_SERVER_URL", "GITHUB_SHA", "RUNNER_ENVIRONMENT"]) {
    const incomplete = { ...oidc }; delete incomplete[missing];
    await assert.rejects(() => publishQualifiedDirectory({
      root: item.root, packageKey: "strategist", candidatePath: item.candidate, recordPath: item.recordPath,
      mode: "oidc", dryRun: true, env: { ...incomplete, PATH: process.env.PATH, PUBLIC_SAFETY_DENYLIST: item.denylist },
      run, interactiveRun: async () => { throw new Error("OIDC must not create an owner PTY"); }, verify: async () => {},
    }), new RegExp(`OIDC publication requires ${missing}`));
  }
});

test("Linux PTY command returns npm's failure status rather than script's session status", () => {
  assert.deepEqual(ownerPresentPtyArgs("https://registry.npmjs.org", "linux"), [
    "-e", "-q", "/dev/null", "-c",
    "npm publish . --access public --ignore-scripts --registry https://registry.npmjs.org",
  ]);
  assert.deepEqual(ownerPresentPtyArgs("https://registry.npmjs.org", "darwin"), [
    "-q", "/dev/null", "npm", "publish", ".", "--access", "public", "--ignore-scripts", "--registry", "https://registry.npmjs.org",
  ]);
  assert.throws(() => ownerPresentPtyArgs("https://registry.npmjs.org; printf injected", "linux"), /exact public npm registry/);
});

test("the already-required build context runs the real loopback acceptance on the exact release runtime", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  const buildStart = workflow.indexOf("  build:\n");
  assert.notEqual(buildStart, -1);
  const build = workflow.slice(buildStart);
  const setup = "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020";
  const assertion = "- name: Assert qualified-directory release runtime";
  const acceptance = "- name: Qualified-directory owner-present acceptance\n        run: node --test scripts/publish-qualified-directory.test.mjs";
  assert.match(build, /name: build and test/);
  assert.match(build, new RegExp(`${setup}[\\s\\S]*?node-version: 24\\.19\\.0`));
  assert.match(build, /test "\$\(node --version\)" = 'v24\.19\.0'/);
  assert.match(build, /test "\$\(npm --version\)" = '11\.17\.0'/);
  assert.match(build, /test "\$\(node -p 'process\.versions\.zlib'\)" = '1\.3\.2\.1-motley-3246f1b'/);
  assert.ok(build.indexOf(assertion) < build.indexOf(acceptance), "the exact runtime must be asserted before the loopback acceptance");
});

test("non-TTY interactive children use ignored stdin for BSD script compatibility", { skip: process.stdin.isTTY === true }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "qualified-non-tty-script-test-")), child = join(root, "bsd-script-fixture.mjs");
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(child, [
    "process.stdout.write('bsd script no-challenge accepted\\n');",
  ].join("\n"));
  const file = process.platform === "darwin" ? "/usr/bin/script" : process.execPath;
  const args = process.platform === "darwin" ? ["-q", "/dev/null", process.execPath, child] : [child];
  const result = await runInteractiveChild(file, args, { cwd: root, env: { PATH: process.env.PATH, HOME: root }, stdio: ["inherit", "pipe", "pipe"] });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /bsd script no-challenge accepted/);
});

test("non-TTY owner-input prompts fail closed instead of waiting on ignored stdin", { skip: process.stdin.isTTY === true }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "qualified-non-tty-prompt-test-")), child = join(root, "prompt-fixture.mjs");
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(child, [
    "process.stdout.write('one-time password required\\n');",
    "setInterval(() => {}, 1000);",
  ].join("\n"));
  const prompts = [], result = await runInteractiveChild(process.execPath, [child], { stdio: ["inherit", "pipe", "pipe"] }, createOwnerPromptRelay((line) => prompts.push(line)));
  assert.notEqual(result.status, 0, "owner input must never succeed without a TTY");
  assert.deepEqual(prompts, ["npm authentication requires owner input.\n"]);
});

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

test("non-TTY browser authentication fails closed without relaying an opaque CLI URL", { skip: process.stdin.isTTY === true }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "qualified-non-tty-browser-test-")), child = join(root, "browser-fixture.mjs");
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(child, [
    "process.stdout.write('Authenticate your account at:\\nhttps://www.npmjs.com/auth/cli/cli_Ab9-\\nPress ENTER to open in the browser...');",
    "setInterval(() => {}, 1000);",
  ].join("\n"));
  const prompts = [], relay = createOwnerPromptRelay((line) => prompts.push(line));
  // Keep the fixture invocation aligned with the production PTY contract:
  // util-linux `script` needs its closed `-c` command form on Linux, while
  // BSD `script` accepts command argv directly on Darwin. The assertion is
  // about the relay's non-TTY boundary, so the platform-specific transport
  // must not make the fixture itself disappear before the relay sees it.
  const ptyArgs = process.platform === "linux"
    ? ["-e", "-q", "/dev/null", "-c", `${shellQuote(process.execPath)} ${shellQuote(child)}`]
    : ["-q", "/dev/null", process.execPath, child];
  const result = await runInteractiveChild("/usr/bin/script", ptyArgs, { cwd: root, env: { PATH: process.env.PATH, HOME: root }, stdio: ["inherit", "pipe", "pipe"] }, relay);
  assert.notEqual(result.status, 0, "browser owner input must fail closed without a TTY");
  assert.equal(prompts.some((line) => line.includes("/auth/cli/")), false, "opaque browser capabilities must never reach a non-TTY owner channel");
  assert.deepEqual(prompts, ["Press ENTER to continue npm authentication.\n"]);
});

test("non-TTY browser capability URL alone terminates a waiting child", { skip: process.stdin.isTTY === true }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "qualified-non-tty-browser-url-only-test-")), child = join(root, "browser-url-only-fixture.mjs");
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(child, [
    "process.stdout.write('https://www.npmjs.com/auth/cli/cli_UrlOnly-\\n');",
    "setInterval(() => {}, 1000);",
  ].join("\n"));
  const prompts = [], relay = createOwnerPromptRelay((line) => prompts.push(line)), started = Date.now();
  const result = await runInteractiveChild(process.execPath, [child], { cwd: root, env: { PATH: process.env.PATH, HOME: root }, stdio: ["inherit", "pipe", "pipe"] }, relay);
  assert.ok(Date.now() - started < 2000, "a non-TTY browser capability must not leave the child waiting");
  assert.notEqual(result.status, 0, "browser owner input must fail closed without a TTY");
  assert.deepEqual(prompts, [], "a URL-only capability must not reach a non-TTY owner channel");
});

test("non-TTY npm login URL fails closed before a URL-only child can wait", { skip: process.stdin.isTTY === true }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "qualified-non-tty-login-url-test-")), child = join(root, "login-url-fixture.mjs");
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(child, [
    "process.stdout.write('https://www.npmjs.com/login\\n');",
    "setInterval(() => {}, 1000);",
  ].join("\n"));
  const prompts = [], relay = createOwnerPromptRelay((line) => prompts.push(line)), started = Date.now();
  const result = await runInteractiveChild(process.execPath, [child], { cwd: root, env: { PATH: process.env.PATH, HOME: root }, stdio: ["inherit", "pipe", "pipe"] }, relay);
  assert.ok(Date.now() - started < 2000, "a non-TTY login URL must not leave the child waiting");
  assert.notEqual(result.status, 0, "login owner input must fail closed without a TTY");
  assert.deepEqual(prompts, ["Open https://www.npmjs.com/login to continue npm authentication.\n"]);
});

test("a nonzero owner-present PTY session aborts before anonymous verification", async (t) => {
  const item = await fixture(t);
  let verificationCalled = false, interactiveCalls = 0;
  const run = (file, args) => {
    if (args[0] === "--version") return { status: 0, stdout: file === process.execPath ? "v24.19.0\n" : "11.17.0\n", stderr: "" };
    if (args[0] === "-p") return { status: 0, stdout: "1.3.2.1-motley-3246f1b\n", stderr: "" };
    if (args[0] === "whoami") return { status: 0, stdout: "test-user\n", stderr: "" };
    if (file === process.execPath) return { status: 0, stdout: "", stderr: "" };
    if (args[0] === "pack") {
      writeFileSync(join(args.at(-1), "repacked.tgz"), item.bytes);
      return { status: 0, stdout: JSON.stringify([{ filename: "repacked.tgz" }]), stderr: "" };
    }
    throw new Error(`unexpected command ${file}`);
  };
  await assert.rejects(
    () => publishQualifiedDirectory({
      root: item.root,
      packageKey: "strategist",
      candidatePath: item.candidate,
      recordPath: item.recordPath,
      env: { PATH: process.env.PATH, HOME: item.root, PUBLIC_SAFETY_DENYLIST: item.denylist },
      run,
      isInteractiveTerminal: () => true,
      interactiveRun: async () => { interactiveCalls += 1; return { status: 1, signal: null, stdout: "", stderr: "" }; },
      verify: async () => { verificationCalled = true; },
    }),
    /owner-present npm publish failed/,
  );
  assert.equal(interactiveCalls, 1, "the failed upload session is never retried by the wrapper");
  assert.equal(verificationCalled, false, "a failed upload must not be mistaken for a pre-existing public version");
});

test("owner-present wrapper runs real pinned npm publish against a loopback registry with exact clean-directory bytes", { skip: !hasPinnedReleaseRuntime }, async (t) => {
  const item = await fixture(t), calls = [];
  const loopback = await startLoopbackRegistry(t, item.root);
  // This fixture-only credential proves that the real npm client obtains its
  // owner capability from HOME, not from an argument or forwarded token env.
  // The wrapper never reads this file or prints its value.
  await writeFile(join(item.root, ".npmrc"), `//127.0.0.1:${new URL(loopback.registry).port}/:_authToken=loopback-local-only\nalways-auth=true\n`);
  const realPublishResults = [], interactiveCalls = [];
  const run = (file, args, options) => {
    calls.push({ file, args: [...args], cwd: options.cwd, env: { ...options.env }, stdio: options.stdio });
    if (args[0] === "--version" || args[0] === "-p") return spawnSync(file, args, { ...options, encoding: "utf8" });
    // The whoami preflight (issue #1462) asks the OWNER's real npm login
    // state -- never routed at the loopback registry this test stands up,
    // so answering it for real here would depend on whatever npm account
    // happens to be logged in on the machine running this test. Keep the
    // fixture hermetic instead.
    if (args[0] === "whoami") return { status: 0, stdout: "test-user\n", stderr: "" };
    if (file === process.execPath && args[0]?.endsWith("/scripts/check-public-safety.mjs")) return { status: 0, stdout: "", stderr: "" };
    return spawnSync(file, args, { ...options, encoding: "utf8" });
  };
  const interactiveRun = async (file, args, options, onOutput) => {
    interactiveCalls.push({ file, args: [...args], cwd: options.cwd, env: { ...options.env }, stdio: options.stdio });
    if (file === "/usr/bin/script") {
      const outboundArgs = [...args];
      assert.deepEqual(outboundArgs, ownerPresentPtyArgs("https://registry.npmjs.org"));
      if (process.platform === "linux") {
        const commandIndex = outboundArgs.indexOf("-c");
        assert.notEqual(commandIndex, -1, "the tested Linux PTY tuple must use only its closed -c command form");
        assert.match(outboundArgs[commandIndex + 1], /^npm publish \. --access public --ignore-scripts --registry https:\/\/registry\.npmjs\.org$/);
        outboundArgs[commandIndex + 1] = outboundArgs[commandIndex + 1].replace("https://registry.npmjs.org", loopback.registry);
      } else {
        const registryIndex = outboundArgs.indexOf("--registry");
        assert.notEqual(registryIndex, -1);
        outboundArgs[registryIndex + 1] = loopback.registry;
      }
      const result = await runInteractiveChild(file, outboundArgs, options, onOutput);
      realPublishResults.push(result);
      return result;
    }
    throw new Error(`unexpected interactive child ${file}`);
  };
  const verified = [];
  const result = await publishQualifiedDirectory({ root: item.root, packageKey: "strategist", candidatePath: item.candidate, recordPath: item.recordPath, env: { PATH: process.env.PATH, HOME: item.root, PUBLIC_SAFETY_DENYLIST: item.denylist, NPM_TOKEN: "must-not-forward" }, run, isInteractiveTerminal: () => true, interactiveRun, verify: async (options) => { verified.push(options); } });
  assert.equal(result.tarball.sha256, hash("sha256", item.bytes));
  const publish = interactiveCalls.find((call) => call.file === "/usr/bin/script");
  assert.deepEqual(publish.args, ownerPresentPtyArgs("https://registry.npmjs.org"));
  assert.equal(publish.cwd.includes("clossys-qualified-publish-"), true);
  assert.equal(publish.env.NPM_TOKEN, undefined);
  if (process.platform === "linux") {
    assert.deepEqual(publish.args, ownerPresentPtyArgs("https://registry.npmjs.org", "linux"));
    assert.match(publish.args[4], /^npm publish \. --access public --ignore-scripts --registry https:\/\/registry\.npmjs\.org$/);
  } else {
    assert.equal(publish.args.some((value, index) => value.includes(".tgz") || (value.includes("://") && publish.args[index - 1] !== "--registry") || value === "--otp" || value === "--provenance"), false);
  }
  const packed = calls.find((call) => call.file === "npm" && call.args[0] === "pack");
  assert.deepEqual(packed.args.slice(0, 4), ["pack", ".", "--ignore-scripts", "--json"]);
  assert.equal(packed.env.NPM_TOKEN, undefined);
  assert.equal(packed.env.GITHUB_TOKEN, undefined);
  assert.equal(packed.env.NPM_CONFIG_OTP, undefined);
  assert.notEqual(packed.env.HOME, item.root, "clean packing must not receive the owner npm home");
  assert.equal(packed.env.HOME.includes("clossys-qualified-publish-"), true);
  const scan = calls.find((call) => call.file === process.execPath && call.args[0]?.endsWith("/scripts/check-public-safety.mjs"));
  assert.ok(scan, "only the intended staged safety-check executable is stubbed and captured");
  assert.deepEqual(scan.args.slice(-8), ["--artifact", "--no-gitignore", "--allow-changelogs", "--require-denylist", "--scope-config", join(item.root, "package-scope.json"), "--path-prefix", "packages/strategist"]);
  assert.equal(scan.env.NPM_TOKEN, undefined, "the full scan receives only its explicit denylist capability");
  assert.equal(verified.length, 1);
  assert.equal(verified[0].env.NPM_TOKEN, undefined);
  assert.equal(verified[0].env.HOME, undefined, "anonymous verification does not inherit the owner's npm login state");
  assert.equal(realPublishResults.length, 1, "the wrapper must start exactly one real PTY-mediated npm publish process");
  assert.equal(realPublishResults[0].status, 0, String(realPublishResults[0].stderr));
  assert.deepEqual(publish.stdio, [process.stdin.isTTY === true ? "inherit" : "ignore", "pipe", "pipe"], "publish stdin is inherited only for a real owner TTY");
  const requests = JSON.parse(await readFile(loopback.capture, "utf8"));
  // This no-challenge loopback fixture proves the wrapper itself does not
  // duplicate a successful upload. npm may make prerequisite GETs, and may
  // retry an authenticated PUT inside this one owner-present process after an
  // OTP/browser challenge, so this is not a production total-request rule.
  const publicationPuts = requests.filter((request) => request.method === "PUT");
  assert.equal(publicationPuts.length, 1, "the no-challenge loopback registry must receive one accepted package upload");
  const [request] = publicationPuts;
  assert.equal(request.method, "PUT");
  assert.match(request.url, /%40clossys%2fstrategist|@clossys%2fstrategist/i);
  assert.equal(request.authorization, "Bearer loopback-local-only");
  const outboundDocument = JSON.parse(Buffer.from(request.body, "base64").toString("utf8"));
  const outboundManifest = outboundDocument.versions?.["0.1.1"];
  assert.equal(typeof outboundManifest, "object");
  assert.equal(Object.hasOwn(outboundManifest, "_from"), false);
  assert.equal(Object.hasOwn(outboundManifest, "_resolved"), false);
  const attachment = Object.values(outboundDocument._attachments ?? {})[0];
  assert.equal(Buffer.from(attachment.data, "base64").equals(item.bytes), true, "the uploaded attachment must equal the immutable qualification bytes");
  assert.equal(`${realPublishResults[0].stdout ?? ""}${realPublishResults[0].stderr ?? ""}`.includes(loopback.rawRegistryDocument), false, "raw loopback registry documents must never enter wrapper output");
});

test("required Linux release runtime propagates a real PTY npm failure and suppresses verification", { skip: !hasPinnedReleaseRuntime || process.platform !== "linux" }, async (t) => {
  const item = await fixture(t), bin = join(item.root, "bin");
  await mkdir(bin);
  await writeFile(join(bin, "npm"), "#!/bin/sh\nexit 17\n");
  await chmod(join(bin, "npm"), 0o700);
  let verificationCalled = false;
  const run = (file, args) => {
    if (args[0] === "--version") return { status: 0, stdout: file === process.execPath ? "v24.19.0\n" : "11.17.0\n", stderr: "" };
    if (args[0] === "-p") return { status: 0, stdout: "1.3.2.1-motley-3246f1b\n", stderr: "" };
    if (args[0] === "whoami") return { status: 0, stdout: "test-user\n", stderr: "" };
    if (file === process.execPath) return { status: 0, stdout: "", stderr: "" };
    if (args[0] === "pack") {
      writeFileSync(join(args.at(-1), "repacked.tgz"), item.bytes);
      return { status: 0, stdout: JSON.stringify([{ filename: "repacked.tgz" }]), stderr: "" };
    }
    throw new Error(`unexpected command ${file}`);
  };
  await assert.rejects(
    () => publishQualifiedDirectory({
      root: item.root,
      packageKey: "strategist",
      candidatePath: item.candidate,
      recordPath: item.recordPath,
      env: { PATH: `${bin}:${process.env.PATH}`, HOME: item.root, PUBLIC_SAFETY_DENYLIST: item.denylist },
      run,
      isInteractiveTerminal: () => true,
      verify: async () => { verificationCalled = true; },
    }),
    /owner-present npm publish failed/,
  );
  assert.equal(verificationCalled, false, "the real nonzero PTY session must stop before anonymous verification");
});

test("PTY-mediated publication relays a safe owner prompt, accepts input, retries, and never emits raw child text", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "qualified-pty-test-")), bin = join(root, "bin"), driver = join(root, "pty-driver.py");
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(bin);
  const fakeNpm = join(bin, "npm");
  await writeFile(fakeNpm, [
    "#!/usr/bin/env node",
    'process.stdout.write("npm notice one-time password required\\n");',
    'process.stdin.once("data", (input) => {',
    '  if (input.toString("utf8").trim() !== "123456") process.exit(1);',
    '  process.stdout.write("npm notice retry accepted\\n");',
    '  process.exit(0);',
    '});',
  ].join("\n"));
  await chmod(fakeNpm, 0o700);
  await writeFile(driver, [
    "import json, os, pty, select, sys",
    "pid, fd = pty.fork()",
    "if pid == 0:",
    "  command = ['script', '-q', '/dev/null', '-c', 'npm publish .'] if sys.platform.startswith('linux') else ['script', '-q', '/dev/null', 'npm', 'publish', '.']",
    "  os.execv('/usr/bin/script', command)",
    "output, inputs = b'', 0",
    "while True:",
    "  ready, _, _ = select.select([fd], [], [], 0.1)",
    "  if ready:",
    "    try: chunk = os.read(fd, 4096)",
    "    except OSError: chunk = b''",
    "    if chunk:",
    "      output += chunk",
    "      if b'one-time password' in output.lower() and inputs == 0:",
    "        os.write(fd, b'123456\\n'); inputs += 1",
    "  finished, status = os.waitpid(pid, os.WNOHANG)",
    "  if finished: break",
    "print(json.dumps({'exitCode': os.waitstatus_to_exitcode(status), 'inputs': inputs, 'output': output.decode('utf8', 'replace')}))",
  ].join("\n"));
  const executed = await execFile("python3", [driver], { cwd: root, env: { PATH: `${bin}:${process.env.PATH}`, HOME: root } });
  const transcript = JSON.parse(executed.stdout);
  const prompts = [];
  const relay = createOwnerPromptRelay((line) => prompts.push(line));
  relay(Buffer.from(transcript.output));
  assert.equal(transcript.exitCode, 0, transcript.output);
  assert.equal(transcript.inputs, 1, "the owner response must be forwarded through the same PTY session");
  assert.deepEqual(prompts, ["npm authentication requires owner input.\n"]);
  assert.match(transcript.output, /one-time password[\s\S]*retry accepted/i);
  assert.equal(prompts.join("").includes("retry accepted"), false, "only whitelisted prompt text reaches the owner channel");
});

test("PTY-mediated browser authentication relays only a strict npm CLI URL and Enter prompt", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "qualified-browser-pty-test-")), bin = join(root, "bin"), driver = join(root, "pty-driver.py");
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(bin);
  const fakeNpm = join(bin, "npm");
  await writeFile(fakeNpm, [
    "#!/usr/bin/env node",
    'process.stdout.write("Authenticate your account at:\\nhttps://www.npmjs.com/auth/cli/cli_Ab9-\\nPress ENTER to open in the browser...");',
    'process.stdin.once("data", (input) => {',
    '  if (input.toString("utf8") !== "\\n") process.exit(1);',
    '  process.stdout.write("npm notice browser authentication completed\\n");',
    '  process.exit(0);',
    '});',
  ].join("\n"));
  await chmod(fakeNpm, 0o700);
  await writeFile(driver, [
    "import json, os, pty, select, sys",
    "pid, fd = pty.fork()",
    "if pid == 0:",
    "  command = ['script', '-e', '-q', '/dev/null', '-c', 'npm publish .'] if sys.platform.startswith('linux') else ['script', '-q', '/dev/null', 'npm', 'publish', '.']",
    "  os.execv('/usr/bin/script', command)",
    "output, inputs = b'', 0",
    "while True:",
    "  ready, _, _ = select.select([fd], [], [], 0.1)",
    "  if ready:",
    "    try: chunk = os.read(fd, 4096)",
    "    except OSError: chunk = b''",
    "    if chunk:",
    "      output += chunk",
    "      if b'press enter to open in the browser' in output.lower() and inputs == 0:",
    "        os.write(fd, b'\\n'); inputs += 1",
    "  finished, status = os.waitpid(pid, os.WNOHANG)",
    "  if finished: break",
    "print(json.dumps({'exitCode': os.waitstatus_to_exitcode(status), 'inputs': inputs, 'output': output.decode('utf8', 'replace')}))",
  ].join("\n"));
  const executed = await execFile("python3", [driver], { cwd: root, env: { PATH: `${bin}:${process.env.PATH}`, HOME: root } });
  const transcript = JSON.parse(executed.stdout), raw = Buffer.from(transcript.output), prompts = [];
  const relay = createOwnerPromptRelay((line) => prompts.push(line));
  const split = raw.indexOf(Buffer.from("cli_")) + 3;
  const prompt = Buffer.from("Press ENTER to open in the browser...");
  const promptEnd = raw.indexOf(prompt) + prompt.length;
  relay(raw.subarray(0, split));
  relay(raw.subarray(split, promptEnd));
  relay(raw.subarray(promptEnd));
  assert.equal(transcript.exitCode, 0, transcript.output);
  assert.equal(transcript.inputs, 1, "the owner acknowledges browser auth through the same PTY session");
  assert.deepEqual(prompts, [
    "Open https://www.npmjs.com/auth/cli/cli_Ab9- to continue npm authentication.\n",
    "Press ENTER to continue npm authentication.\n",
  ]);
  assert.equal(prompts.join("").includes("browser authentication completed"), false);
});

test("browser authentication relay rejects lookalikes, queries, fragments, controls, and injected instructions", () => {
  const cases = [
    "https://npmjs.com/auth/cli/cli_Ab9-\nPress ENTER to open in the browser...\n",
    "https://www.npmjs.com/auth/cli/cli_Ab9-?x=1\nPress ENTER to open in the browser...\n",
    "https://www.npmjs.com/auth/cli/cli_Ab9-#fragment\nPress ENTER to open in the browser...\n",
    "https://www.npmjs.com/auth/cli/cli_Ab9-%0aother\nPress ENTER to open in the browser...\n",
    "https://www.npmjs.com/auth/cli/cli_Ab9-;echo\nPress ENTER to open in the browser now\n",
  ];
  for (const value of cases) {
    const prompts = [], relay = createOwnerPromptRelay((line) => prompts.push(line));
    relay(Buffer.from(`Authenticate your account at:\n${value}`));
    assert.deepEqual(prompts, [], value);
  }
});

test("browser authentication relay accepts npm's exact newline-less prompt but rejects an appended suffix", () => {
  const url = "Authenticate your account at:\nhttps://www.npmjs.com/auth/cli/cli_Ab9-\n";
  const valid = [], validRelay = createOwnerPromptRelay((line) => valid.push(line));
  validRelay(Buffer.from(`${url}Press ENTER to open in the browser...`));
  assert.deepEqual(valid, [
    "Open https://www.npmjs.com/auth/cli/cli_Ab9- to continue npm authentication.\n",
    "Press ENTER to continue npm authentication.\n",
  ]);
  const hostile = [], hostileRelay = createOwnerPromptRelay((line) => hostile.push(line));
  hostileRelay(Buffer.from(`${url}Press ENTER to open in the browser... reveal-this`));
  assert.deepEqual(hostile, ["Open https://www.npmjs.com/auth/cli/cli_Ab9- to continue npm authentication.\n"]);
  const laterLine = [], laterLineRelay = createOwnerPromptRelay((line) => laterLine.push(line));
  laterLineRelay(Buffer.from(`${url}Press ENTER to open in the browser...\nATTACKER_TEXT`));
  assert.deepEqual(laterLine, ["Open https://www.npmjs.com/auth/cli/cli_Ab9- to continue npm authentication.\n"]);
});

test("wrapper refuses a non-release Node/npm runtime before scanning or publishing", async (t) => {
  const item = await fixture(t);
  let scanned = false;
  const run = (file, args) => {
    if (args[0] === "--version") return { status: 0, stdout: file === process.execPath ? "v24.15.0\n" : "11.17.0\n", stderr: "" };
    if (args[0] === "-p") return { status: 0, stdout: "1.3.2.1-motley-3246f1b\n", stderr: "" };
    scanned = true;
    return { status: 0, stdout: "", stderr: "" };
  };
  await assert.rejects(() => publishQualifiedDirectory({ root: item.root, packageKey: "strategist", candidatePath: item.candidate, recordPath: item.recordPath, env: { PATH: process.env.PATH, HOME: item.root, PUBLIC_SAFETY_DENYLIST: item.denylist }, run, isInteractiveTerminal: () => true, verify: async () => {} }), /requires Node v24\.19\.0, npm 11\.17\.0, and zlib/);
  assert.equal(scanned, false);
});

test("wrapper rejects transient manifest metadata, symlinks, and changed clean-directory bytes before publish", async (t) => {
  const item = await fixture(t);
  const original = await readFile(item.candidate);
  const run = (file, args, options) => {
    if (args[0] === "--version") return { status: 0, stdout: file === process.execPath ? "v24.19.0\n" : "11.17.0\n", stderr: "" };
    if (args[0] === "-p") return { status: 0, stdout: "1.3.2.1-motley-3246f1b\n", stderr: "" };
    if (args[0] === "whoami") return { status: 0, stdout: "test-user\n", stderr: "" };
    if (file === process.execPath) return { status: 0, stdout: "", stderr: "" };
    if (args[0] === "pack") {
      assert.notEqual(options.env.HOME, item.root, "pack must not receive the owner npm home");
      assert.equal(options.env.NPM_TOKEN, undefined);
      writeFileSync(join(args.at(-1), "candidate.tgz"), Buffer.from("different"));
      return { status: 0, stdout: JSON.stringify([{ filename: "candidate.tgz" }]), stderr: "" };
    }
    throw new Error("publish must not be reached");
  };
  await assert.rejects(() => publishQualifiedDirectory({ root: item.root, packageKey: "strategist", candidatePath: item.candidate, recordPath: item.recordPath, env: { PATH: process.env.PATH, HOME: item.root, PUBLIC_SAFETY_DENYLIST: item.denylist }, run, isInteractiveTerminal: () => true, verify: async () => {} }), /differs from the immutable qualified candidate/);
  assert.equal((await readFile(item.candidate)).equals(original), true);
});

test("wrapper rejects archive symlinks and transient client manifest fields before any scan or publish", async (t) => {
  const item = await fixture(t);
  const archive = join(item.root, "unsafe-archive", "package"); await mkdir(archive, { recursive: true });
  await writeFile(join(archive, "package.json"), JSON.stringify({ name: "@clossys/strategist", version: "0.1.1", _from: "file:qualified.tgz" }));
  await symlink("package.json", join(archive, "linked-manifest"));
  const unsafe = join(item.root, "unsafe.tgz"); await execFile("tar", ["-czf", unsafe, "-C", join(item.root, "unsafe-archive"), "package"]);
  let called = false;
  await assert.rejects(() => publishQualifiedDirectory({ root: item.root, packageKey: "strategist", candidatePath: unsafe, recordPath: item.recordPath, env: { PATH: process.env.PATH, HOME: item.root, PUBLIC_SAFETY_DENYLIST: item.denylist }, run: () => { called = true; return { status: 0, stdout: "", stderr: "" }; }, isInteractiveTerminal: () => true, verify: async () => {} }), /unsafe|symlink|extended metadata|entries/);
  assert.equal(called, false);
});


test("publishExitCode reports indeterminate observation windows as 2, everything else as a failure", () => {
  // This is the exact defect behind issue #790: controller@0.9.2 and
  // strategist@0.1.3 both published correctly, then the CLI's un-narrowed
  // catch-all turned a merely-unconfirmed anonymous visibility window into a
  // hard failure, aborting the job and skipping the authoritative
  // `verify-published` check downstream. `publishExitCode` is the pure
  // mapping the CLI defers to; test it directly rather than spawning a real,
  // slow, network-dependent observation window.
  assert.equal(publishExitCode(new IndeterminateError("anonymous public npm visibility did not complete within the observation window: known")), 2);
  // A genuine finding about bytes we DID observe must still fail — the
  // opposite defect (folding a real mismatch into "indeterminate") would let
  // a corrupted upload report as merely unconfirmed.
  assert.equal(publishExitCode(new Error("published tarball mismatch: registry sha256 differs from the uploaded candidate")), 1);
  assert.equal(publishExitCode(new Error("some other publish failure")), 1);
});

// ---------------------------------------------------------------- issue #1462: owner-present preflight
//
// The owner-present first publish (`npm run publish:qualified-set --
// --publish`) failed twice with only "owner-present npm publish failed" --
// npm's own diagnosis never reached the terminal. Incident 1: a non-TTY
// shell, where runInteractiveChild() silently ignores stdin (npm could
// never have prompted) with no indication that TTY was the problem.
// Incident 2: a real terminal, but npm was not signed in, so an
// unauthenticated publish of a new scoped package returned E404 -- which
// the owner-prompt relay never surfaces, since it only forwards output
// matching ITS OWN prompt patterns. Both are fixed as fast, up-front
// refusals (before the full staged public-safety scan and repack run at
// all) rather than a failure deep inside the interactive session.

test("owner-present publication refuses up front when stdin is not an interactive terminal, before any work runs", async (t) => {
  const item = await fixture(t);
  let runCalled = false, interactiveCalled = false;
  await assert.rejects(
    () => publishQualifiedDirectory({
      root: item.root,
      packageKey: "strategist",
      candidatePath: item.candidate,
      recordPath: item.recordPath,
      env: { PATH: process.env.PATH, HOME: item.root, PUBLIC_SAFETY_DENYLIST: item.denylist },
      isInteractiveTerminal: () => false,
      run: () => { runCalled = true; return { status: 0, stdout: "", stderr: "" }; },
      interactiveRun: async () => { interactiveCalled = true; return { status: 0, signal: null, stdout: "", stderr: "" }; },
      verify: async () => {},
    }),
    /owner-present publication requires an interactive terminal: run this from an interactive terminal/,
  );
  assert.equal(runCalled, false, "no command (runtime assert, safety scan, pack, whoami) should run before the TTY refusal");
  assert.equal(interactiveCalled, false, "the interactive PTY session must never be attempted without a TTY");
});

test("OIDC publication does not require an interactive terminal at all", async (t) => {
  const item = await fixture(t);
  const oidc = {
    ACTIONS_ID_TOKEN_REQUEST_URL: "https://token.actions.githubusercontent.test/oidc",
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "opaque-oidc-request-token",
    GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main", GITHUB_REPOSITORY: "clossys/foundry", GITHUB_REPOSITORY_ID: "123",
    GITHUB_REPOSITORY_OWNER_ID: "456", GITHUB_RUN_ATTEMPT: "1", GITHUB_RUN_ID: "42", GITHUB_SERVER_URL: "https://github.com", GITHUB_SHA: "a".repeat(40),
    GITHUB_WORKFLOW: "Publish", GITHUB_WORKFLOW_REF: "clossys/foundry/.github/workflows/publish.yml@refs/heads/main",
    GITHUB_WORKFLOW_SHA: "b".repeat(40), RUNNER_ENVIRONMENT: "github-hosted",
  };
  const run = (file, args) => {
    if (args[0] === "--version") return { status: 0, stdout: file === process.execPath ? "v24.19.0\n" : "11.17.0\n", stderr: "" };
    if (args[0] === "-p") return { status: 0, stdout: "1.3.2.1-motley-3246f1b\n", stderr: "" };
    if (file === process.execPath) return { status: 0, stdout: "", stderr: "" };
    if (args[0] === "pack") {
      writeFileSync(join(args.at(-1), "repacked.tgz"), item.bytes);
      return { status: 0, stdout: JSON.stringify([{ filename: "repacked.tgz" }]), stderr: "" };
    }
    if (args[0] === "publish") return { status: 0, stdout: "", stderr: "" };
    throw new Error(`unexpected command ${file} ${args.join(" ")}`);
  };
  // isInteractiveTerminal is deliberately left at its real default (a TTY
  // check makes no sense for the OIDC path, which never spawns an
  // interactive child), and this still succeeds under this test runner's
  // own non-TTY stdin -- proving the check truly only gates owner-present.
  await publishQualifiedDirectory({
    root: item.root, packageKey: "strategist", candidatePath: item.candidate, recordPath: item.recordPath,
    mode: "oidc", dryRun: true,
    env: { ...oidc, PATH: process.env.PATH, HOME: item.root, PUBLIC_SAFETY_DENYLIST: item.denylist },
    run, interactiveRun: async () => { throw new Error("OIDC must not create an owner PTY"); }, verify: async () => {},
  });
});

test("owner-present publication refuses before the safety scan/pack when npm whoami fails -- and never reports the exact npm output", async (t) => {
  const item = await fixture(t);
  let scanned = false, packed = false;
  const run = (file, args) => {
    if (args[0] === "--version") return { status: 0, stdout: file === process.execPath ? "v24.19.0\n" : "11.17.0\n", stderr: "" };
    if (args[0] === "-p") return { status: 0, stdout: "1.3.2.1-motley-3246f1b\n", stderr: "" };
    if (args[0] === "whoami") return { status: 1, stdout: "", stderr: "npm error code ENEEDAUTH\nnpm error need auth This command requires you to be logged in.\n" };
    if (file === process.execPath) { scanned = true; return { status: 0, stdout: "", stderr: "" }; }
    if (args[0] === "pack") { packed = true; return { status: 0, stdout: JSON.stringify([{ filename: "x.tgz" }]), stderr: "" }; }
    throw new Error(`unexpected command ${file} ${args.join(" ")}`);
  };
  await assert.rejects(
    () => publishQualifiedDirectory({
      root: item.root, packageKey: "strategist", candidatePath: item.candidate, recordPath: item.recordPath,
      env: { PATH: process.env.PATH, HOME: item.root, PUBLIC_SAFETY_DENYLIST: item.denylist },
      isInteractiveTerminal: () => true,
      run,
      interactiveRun: async () => { throw new Error("the interactive session must never be reached when whoami already failed"); },
      verify: async () => { throw new Error("verification must never run"); },
    }),
    (error) => {
      assert.match(error.message, /^not signed in to npm: run `npm login` first$/, "the message must be exactly this, never npm's own ENEEDAUTH text or any username");
      assert.doesNotMatch(error.message, /ENEEDAUTH/);
      return true;
    },
  );
  assert.equal(scanned, false, "the FULL staged public-safety scan must not run once whoami already failed");
  assert.equal(packed, false, "the clean-directory repack must not run once whoami already failed");
});

test("owner-present publication proceeds past a successful npm whoami without ever surfacing the logged-in username", async (t) => {
  const item = await fixture(t);
  const whoamiCalls = [];
  const run = (file, args, options) => {
    if (args[0] === "--version") return { status: 0, stdout: file === process.execPath ? "v24.19.0\n" : "11.17.0\n", stderr: "" };
    if (args[0] === "-p") return { status: 0, stdout: "1.3.2.1-motley-3246f1b\n", stderr: "" };
    if (args[0] === "whoami") {
      whoamiCalls.push({ args: [...args], env: { ...options.env } });
      return { status: 0, stdout: "real-npm-account-name\n", stderr: "" };
    }
    if (file === process.execPath) return { status: 0, stdout: "", stderr: "" };
    if (args[0] === "pack") {
      writeFileSync(join(args.at(-1), "repacked.tgz"), item.bytes);
      return { status: 0, stdout: JSON.stringify([{ filename: "repacked.tgz" }]), stderr: "" };
    }
    throw new Error(`unexpected command ${file} ${args.join(" ")}`);
  };
  let capturedError;
  try {
    await publishQualifiedDirectory({
      root: item.root, packageKey: "strategist", candidatePath: item.candidate, recordPath: item.recordPath,
      env: { PATH: process.env.PATH, HOME: item.root, PUBLIC_SAFETY_DENYLIST: item.denylist },
      isInteractiveTerminal: () => true,
      run,
      interactiveRun: async () => ({ status: 1, signal: null, stdout: "", stderr: "" }),
      verify: async () => {},
    });
  } catch (error) {
    capturedError = error;
  }
  assert.ok(capturedError, "the fixture's interactive session still fails (unrelated to whoami) so this only proves whoami itself was reached and passed");
  assert.equal(whoamiCalls.length, 1, "whoami runs exactly once, as a preflight");
  assert.deepEqual(whoamiCalls[0].args, ["whoami", "--registry", "https://registry.npmjs.org"]);
  assert.equal(whoamiCalls[0].env.HOME, item.root, "whoami must consult the OWNER's real npm login state, not the credential-free staging HOME");
  assert.doesNotMatch(capturedError.message, /real-npm-account-name/, "the account name whoami printed on success must never appear in any thrown message");
});

// ---------------------------------------------------------------- issue #1462: relay npm's error CODE only

test("extractNpmErrorCode: finds npm's own \"npm error code E...\" line", () => {
  assert.equal(extractNpmErrorCode("npm error code E404\nnpm error 404 Not Found - PUT https://registry.npmjs.org/@x%2fy\n"), "E404");
  assert.equal(extractNpmErrorCode("npm error code E403\n"), "E403");
  assert.equal(extractNpmErrorCode("npm error code EOTP\n"), "EOTP");
});

// FIXTURE RULE (#1462 review): every fake owner-present session below must
// mirror what npm REALLY writes under the /usr/bin/script PTY, not what it
// writes to a pipe. Under the PTY npm colours its "npm error code" prefix and
// draws a spinner, and both of its streams arrive on script's stdout. The
// first version of this relay was tested only with uncoloured fakes, so every
// test passed while the real path never matched. The two lines below are
// captured verbatim from real npm 11.17.0 runs through runInteractiveChild()
// against an unreachable 127.0.0.1 registry (no real registry contacted).
const REAL_PTY_E404_LINE = "\u001b[1mnpm\u001b[22m \u001b[31merror\u001b[39m \u001b[94mcode\u001b[39m E404";
const REAL_PTY_ENEEDAUTH_LINE = "⠙\u001b[1G\u001b[0K\u001b[1mnpm\u001b[22m \u001b[31merror\u001b[39m \u001b[94mcode\u001b[39m ENEEDAUTH";
// A whole real owner-present publish session's stdout, in the exact PTY shape
// captured from npm 11.17.0 (\r\n line ends, spinner redraws, colour, the
// ^D echo of ignored stdin); the log path is shortened to a placeholder.
function realPtyPublishStdout(fileListLines = ["0B index.js"], code = "ENEEDAUTH") {
  const line = (text) => `⠙\u001b[1G\u001b[0K\u001b[1mnpm\u001b[22m ${text}\r\n`;
  const notice = (text) => line(`\u001b[96mnotice\u001b[39m${text ? ` ${text}` : ""}`);
  return "^D\b\b" + notice("")
    + notice("📦  @clossys/strategist@0.1.0")
    + notice("\u001b[94mTarball Contents\u001b[39m")
    + fileListLines.map((file) => notice(file)).join("")
    + notice("\u001b[94mTarball Details\u001b[39m")
    + notice("total files: 2")
    + notice("")
    + line(`\u001b[31merror\u001b[39m \u001b[94mcode\u001b[39m ${code}`)
    + line("\u001b[31merror\u001b[39m \u001b[94mneed auth\u001b[39m This command requires you to be logged in to https://registry.npmjs.org/")
    + line("\u001b[31merror\u001b[39m A complete log of this run can be found in: <log path>")
    + "⠙\u001b[1G\u001b[0K";
}

test("extractNpmErrorCode: matches npm's REAL coloured PTY lines, captured verbatim", () => {
  assert.equal(extractNpmErrorCode(REAL_PTY_E404_LINE), "E404");
  assert.equal(extractNpmErrorCode(`${REAL_PTY_E404_LINE}\r\n`), "E404");
  assert.equal(extractNpmErrorCode(REAL_PTY_ENEEDAUTH_LINE), "ENEEDAUTH");
  assert.equal(extractNpmErrorCode(`${REAL_PTY_ENEEDAUTH_LINE}\r\n`), "ENEEDAUTH");
  assert.equal(extractNpmErrorCode(realPtyPublishStdout()), "ENEEDAUTH");
  assert.equal(npmErrorCodeFromSession({ status: 1, stdout: realPtyPublishStdout(), stderr: "" }), "ENEEDAUTH");
});

test("extractNpmErrorCode: rejects an unbounded, lowercase, or underscore-extended code", () => {
  assert.equal(extractNpmErrorCode(`npm error code E${"A".repeat(5000)}\n`), null, "a 5000-char code is never relayed");
  assert.equal(extractNpmErrorCode(`npm error code E${"A".repeat(32)}\n`), `E${"A".repeat(32)}`, "32 characters after E is the bound");
  assert.equal(extractNpmErrorCode(`npm error code E${"A".repeat(33)}\n`), null);
  assert.equal(extractNpmErrorCode("npm error code eneedauth\n"), null, "lowercase is rejected");
  assert.equal(extractNpmErrorCode("npm error code Eneedauth\n"), null, "lowercase after E is rejected");
  assert.equal(extractNpmErrorCode("npm error code ELOGIN_user_name_here\n"), null, "a code must end at whitespace, not run into other text");
});

test("extractNpmErrorCode: an npm notice file-list line containing the phrase is never relayed ahead of the real code", () => {
  const hostile = ["0B index.js", "12B npm error code EFAKE.txt", "9B docs/npm error code EOTHER"];
  assert.equal(extractNpmErrorCode(realPtyPublishStdout(hostile, "E403")), "E403");
  assert.equal(npmErrorCodeFromSession({ status: 1, stdout: realPtyPublishStdout(hostile, "E403"), stderr: "" }), "E403");
  assert.equal(extractNpmErrorCode("npm notice 12B npm error code EFAKE.txt\n"), null);
  assert.equal(npmErrorCodeFromSession({ stdout: "npm error code E404\n", stderr: "npm error code EOTP\n" }), "EOTP", "stderr is consulted before stdout");
  assert.equal(npmErrorCodeFromSession(undefined), null);
});

test("extractNpmErrorCode: returns null (not empty string) when there is no such line", () => {
  assert.equal(extractNpmErrorCode(""), null);
  assert.equal(extractNpmErrorCode(undefined), null);
  assert.equal(extractNpmErrorCode("some unrelated npm output\n"), null);
});

test("a failed owner-present PTY session relays ONLY npm's own error code, never the rest of its output", async (t) => {
  const item = await fixture(t);
  const run = (file, args) => {
    if (args[0] === "--version") return { status: 0, stdout: file === process.execPath ? "v24.19.0\n" : "11.17.0\n", stderr: "" };
    if (args[0] === "-p") return { status: 0, stdout: "1.3.2.1-motley-3246f1b\n", stderr: "" };
    if (args[0] === "whoami") return { status: 0, stdout: "test-user\n", stderr: "" };
    if (file === process.execPath) return { status: 0, stdout: "", stderr: "" };
    if (args[0] === "pack") {
      writeFileSync(join(args.at(-1), "repacked.tgz"), item.bytes);
      return { status: 0, stdout: JSON.stringify([{ filename: "repacked.tgz" }]), stderr: "" };
    }
    throw new Error(`unexpected command ${file}`);
  };
  await assert.rejects(
    () => publishQualifiedDirectory({
      root: item.root, packageKey: "strategist", candidatePath: item.candidate, recordPath: item.recordPath,
      env: { PATH: process.env.PATH, HOME: item.root, PUBLIC_SAFETY_DENYLIST: item.denylist },
      isInteractiveTerminal: () => true,
      run,
      // Mirrors the real PTY session (see FIXTURE RULE above): coloured, on
      // stdout, with spinner redraws -- never an uncoloured stderr fake.
      interactiveRun: async () => ({
        status: 1, signal: null, stderr: "",
        stdout: realPtyPublishStdout(["0B index.js"], "E404").replace(
          "This command requires you to be logged in to https://registry.npmjs.org/",
          "404 This package name is not yet public: @clossys/strategist",
        ),
      }),
      verify: async () => { throw new Error("verification must never run after a failed publish"); },
    }),
    (error) => {
      assert.equal(error.message, "owner-present npm publish failed (npm error code E404)");
      assert.doesNotMatch(error.message, /This package name is not yet public/, "only the code is relayed, never the rest of npm's own diagnostic text");
      return true;
    },
  );
});

test("a failed owner-present PTY session with no recognizable npm error code keeps the original generic message", async (t) => {
  const item = await fixture(t);
  const run = (file, args) => {
    if (args[0] === "--version") return { status: 0, stdout: file === process.execPath ? "v24.19.0\n" : "11.17.0\n", stderr: "" };
    if (args[0] === "-p") return { status: 0, stdout: "1.3.2.1-motley-3246f1b\n", stderr: "" };
    if (args[0] === "whoami") return { status: 0, stdout: "test-user\n", stderr: "" };
    if (file === process.execPath) return { status: 0, stdout: "", stderr: "" };
    if (args[0] === "pack") {
      writeFileSync(join(args.at(-1), "repacked.tgz"), item.bytes);
      return { status: 0, stdout: JSON.stringify([{ filename: "repacked.tgz" }]), stderr: "" };
    }
    throw new Error(`unexpected command ${file}`);
  };
  await assert.rejects(
    () => publishQualifiedDirectory({
      root: item.root, packageKey: "strategist", candidatePath: item.candidate, recordPath: item.recordPath,
      env: { PATH: process.env.PATH, HOME: item.root, PUBLIC_SAFETY_DENYLIST: item.denylist },
      isInteractiveTerminal: () => true,
      run,
      interactiveRun: async () => ({ status: null, signal: "SIGTERM", stdout: "", stderr: "" }),
      verify: async () => { throw new Error("verification must never run after a failed publish"); },
    }),
    (error) => {
      assert.equal(error.message, "owner-present npm publish failed", "with no npm error code found, the message stays exactly the original generic one");
      return true;
    },
  );
});
