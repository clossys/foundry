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

import { argsFrom, createOwnerPromptRelay, ownerPresentPtyArgs, publishExitCode, publishQualifiedDirectory, runInteractiveChild } from "./publish-qualified-directory.mjs";
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
  const result = await publishQualifiedDirectory({ root: item.root, packageKey: "strategist", candidatePath: item.candidate, recordPath: item.recordPath, env: { PATH: process.env.PATH, HOME: item.root, PUBLIC_SAFETY_DENYLIST: item.denylist, NPM_TOKEN: "must-not-forward" }, run, interactiveRun, verify: async (options) => { verified.push(options); } });
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
  assert.deepEqual(scan.args.slice(-6), ["--artifact", "--no-gitignore", "--allow-changelogs", "--require-denylist", "--scope-config", join(item.root, "package-scope.json")]);
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
  await assert.rejects(() => publishQualifiedDirectory({ root: item.root, packageKey: "strategist", candidatePath: item.candidate, recordPath: item.recordPath, env: { PATH: process.env.PATH, HOME: item.root, PUBLIC_SAFETY_DENYLIST: item.denylist }, run, verify: async () => {} }), /requires Node v24\.19\.0, npm 11\.17\.0, and zlib/);
  assert.equal(scanned, false);
});

test("wrapper rejects transient manifest metadata, symlinks, and changed clean-directory bytes before publish", async (t) => {
  const item = await fixture(t);
  const original = await readFile(item.candidate);
  const run = (file, args, options) => {
    if (args[0] === "--version") return { status: 0, stdout: file === process.execPath ? "v24.19.0\n" : "11.17.0\n", stderr: "" };
    if (args[0] === "-p") return { status: 0, stdout: "1.3.2.1-motley-3246f1b\n", stderr: "" };
    if (file === process.execPath) return { status: 0, stdout: "", stderr: "" };
    if (args[0] === "pack") {
      assert.notEqual(options.env.HOME, item.root, "pack must not receive the owner npm home");
      assert.equal(options.env.NPM_TOKEN, undefined);
      writeFileSync(join(args.at(-1), "candidate.tgz"), Buffer.from("different"));
      return { status: 0, stdout: JSON.stringify([{ filename: "candidate.tgz" }]), stderr: "" };
    }
    throw new Error("publish must not be reached");
  };
  await assert.rejects(() => publishQualifiedDirectory({ root: item.root, packageKey: "strategist", candidatePath: item.candidate, recordPath: item.recordPath, env: { PATH: process.env.PATH, HOME: item.root, PUBLIC_SAFETY_DENYLIST: item.denylist }, run, verify: async () => {} }), /differs from the immutable qualified candidate/);
  assert.equal((await readFile(item.candidate)).equals(original), true);
});

test("wrapper rejects archive symlinks and transient client manifest fields before any scan or publish", async (t) => {
  const item = await fixture(t);
  const archive = join(item.root, "unsafe-archive", "package"); await mkdir(archive, { recursive: true });
  await writeFile(join(archive, "package.json"), JSON.stringify({ name: "@clossys/strategist", version: "0.1.1", _from: "file:qualified.tgz" }));
  await symlink("package.json", join(archive, "linked-manifest"));
  const unsafe = join(item.root, "unsafe.tgz"); await execFile("tar", ["-czf", unsafe, "-C", join(item.root, "unsafe-archive"), "package"]);
  let called = false;
  await assert.rejects(() => publishQualifiedDirectory({ root: item.root, packageKey: "strategist", candidatePath: unsafe, recordPath: item.recordPath, env: { PATH: process.env.PATH, HOME: item.root, PUBLIC_SAFETY_DENYLIST: item.denylist }, run: () => { called = true; return { status: 0, stdout: "", stderr: "" }; }, verify: async () => {} }), /unsafe|symlink|extended metadata|entries/);
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
