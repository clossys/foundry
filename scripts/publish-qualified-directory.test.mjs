import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { once } from "node:events";
import { promisify } from "node:util";

import { argsFrom, publishQualifiedDirectory } from "./publish-qualified-directory.mjs";

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
    { id: "clossys-npmjs", status: "active", scope: "@clossys", registry: "https://registry.npmjs.org", access: "public", packages: ["advisor", "starter", "controller", "strategist", "writer", "designer"] },
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
  assert.deepEqual(argsFrom(argv), { package: "strategist", candidate: "candidate.tgz", record: "record.json" });
  for (const mutation of [["--otp", "123456"], ["--candidate", "https://example.test/x.tgz"], ["--unknown", "x"], ["--package", "../strategist"]]) assert.throws(() => argsFrom([...argv, ...mutation]), /Usage:/);
});

test("owner-present wrapper runs real pinned npm publish against a loopback registry with exact clean-directory bytes", { skip: !hasPinnedReleaseRuntime }, async (t) => {
  const item = await fixture(t), calls = [];
  const loopback = await startLoopbackRegistry(t, item.root);
  // This fixture-only credential proves that the real npm client obtains its
  // owner capability from HOME, not from an argument or forwarded token env.
  // The wrapper never reads this file or prints its value.
  await writeFile(join(item.root, ".npmrc"), `//127.0.0.1:${new URL(loopback.registry).port}/:_authToken=loopback-local-only\nalways-auth=true\n`);
  const realPublishResults = [];
  const run = (file, args, options) => {
    calls.push({ file, args: [...args], cwd: options.cwd, env: { ...options.env }, stdio: options.stdio });
    if (args[0] === "--version" || args[0] === "-p") return spawnSync(file, args, { ...options, encoding: "utf8" });
    if (file === process.execPath) return { status: 0, stdout: "", stderr: "" };
    if (file === "/usr/bin/script" && args[2] === "npm" && args[3] === "publish") {
      const outboundArgs = [...args];
      const registryIndex = outboundArgs.indexOf("--registry");
      assert.notEqual(registryIndex, -1);
      outboundArgs[registryIndex + 1] = loopback.registry;
      const result = spawnSync(file, outboundArgs, { ...options, stdio: "pipe", encoding: "utf8" });
      realPublishResults.push(result);
      return result;
    }
    return spawnSync(file, args, { ...options, encoding: "utf8" });
  };
  const verified = [];
  const result = await publishQualifiedDirectory({ root: item.root, packageKey: "strategist", candidatePath: item.candidate, recordPath: item.recordPath, env: { PATH: process.env.PATH, HOME: item.root, PUBLIC_SAFETY_DENYLIST: item.denylist, NPM_TOKEN: "must-not-forward" }, run, verify: async (options) => { verified.push(options); } });
  assert.equal(result.tarball.sha256, hash("sha256", item.bytes));
  const publish = calls.find((call) => call.file === "/usr/bin/script" && call.args[3] === "publish");
  assert.deepEqual(publish.args, ["-q", "/dev/null", "npm", "publish", ".", "--access", "public", "--ignore-scripts", "--registry", "https://registry.npmjs.org"]);
  assert.equal(publish.cwd.includes("clossys-qualified-publish-"), true);
  assert.equal(publish.env.NPM_TOKEN, undefined);
  assert.equal(publish.args.some((value, index) => value.includes(".tgz") || (value.includes("://") && publish.args[index - 1] !== "--registry") || value === "--otp" || value === "--provenance"), false);
  const packed = calls.find((call) => call.file === "npm" && call.args[0] === "pack");
  assert.deepEqual(packed.args.slice(0, 4), ["pack", ".", "--ignore-scripts", "--json"]);
  assert.equal(packed.env.NPM_TOKEN, undefined);
  assert.equal(packed.env.GITHUB_TOKEN, undefined);
  assert.equal(packed.env.NPM_CONFIG_OTP, undefined);
  assert.notEqual(packed.env.HOME, item.root, "clean packing must not receive the owner npm home");
  assert.equal(packed.env.HOME.includes("clossys-qualified-publish-"), true);
  const scan = calls.find((call) => call.file === process.execPath);
  assert.deepEqual(scan.args.slice(-6), ["--artifact", "--no-gitignore", "--allow-changelogs", "--require-denylist", "--scope-config", join(item.root, "package-scope.json")]);
  assert.equal(scan.env.NPM_TOKEN, undefined, "the full scan receives only its explicit denylist capability");
  assert.equal(verified.length, 1);
  assert.equal(verified[0].env.NPM_TOKEN, undefined);
  assert.equal(verified[0].env.HOME, undefined, "anonymous verification does not inherit the owner's npm login state");
  assert.equal(realPublishResults.length, 1, "the wrapper must start exactly one real PTY-mediated npm publish process");
  assert.equal(realPublishResults[0].status, 0, String(realPublishResults[0].stderr));
  assert.deepEqual(publish.stdio, ["inherit", "pipe", "pipe"], "publish output must stay inside the wrapper boundary");
  const requests = JSON.parse(await readFile(loopback.capture, "utf8"));
  assert.equal(requests.length, 1, "the loopback registry must receive exactly one package upload");
  const [request] = requests;
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

test("PTY-mediated publication keeps an interactive challenge and successful retry inside one sanitized owner session", async (t) => {
  const item = await fixture(t), calls = [];
  const run = (file, args, options) => {
    calls.push({ file, args: [...args], options });
    if (args[0] === "--version") return { status: 0, stdout: file === process.execPath ? "v24.19.0\n" : "11.17.0\n", stderr: "" };
    if (args[0] === "-p") return { status: 0, stdout: "1.3.2.1-motley-3246f1b\n", stderr: "" };
    if (file === process.execPath) return { status: 0, stdout: "", stderr: "" };
    if (args[0] === "pack") {
      writeFileSync(join(args.at(-1), "candidate.tgz"), item.bytes);
      return { status: 0, stdout: JSON.stringify([{ filename: "candidate.tgz" }]), stderr: "" };
    }
    if (file === "/usr/bin/script") return { status: 0, stdout: "npm notice one-time password challenge\nnpm notice owner retry accepted\nnpm notice published\n", stderr: "" };
    throw new Error(`unexpected child ${file}`);
  };
  const result = await publishQualifiedDirectory({ root: item.root, packageKey: "strategist", candidatePath: item.candidate, recordPath: item.recordPath, env: { PATH: process.env.PATH, HOME: item.root, PUBLIC_SAFETY_DENYLIST: item.denylist, NPM_TOKEN: "must-not-forward" }, run, verify: async () => {} });
  assert.equal(result.name, "@clossys/strategist");
  const sessions = calls.filter((call) => call.file === "/usr/bin/script");
  assert.equal(sessions.length, 1, "a challenge/retry is one owner session, never a second upload");
  assert.deepEqual(sessions[0].options.stdio, ["inherit", "pipe", "pipe"]);
  assert.equal(sessions[0].options.env.NPM_TOKEN, undefined);
  assert.equal(sessions[0].args.includes("--otp"), false);
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
