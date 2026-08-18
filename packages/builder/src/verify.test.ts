import { describe, expect, it } from "vitest";
import { applyInstallation } from "./apply.js";
import { loadManifest } from "./manifest.js";
import { createRuntimeContext, planInstallation } from "./runtime.js";
import { verifyInstallation } from "./verify.js";
import { createMemoryFileSystem } from "./memory-fs.test-helper.js";

const home = "/home/op";
const sourceRoot = "/src/plane";
const backupRoot = `${home}/.config-backups/run`;

function setup(raw: Record<string, unknown>) {
  const manifest = loadManifest({ version: 1, defaults: { workspaceRoot: "${HOME}/code" }, ...raw });
  const runtime = createRuntimeContext(manifest, { home, sourceRoot });
  return { fs: createMemoryFileSystem(), plan: planInstallation(manifest, runtime) };
}

describe("verifyInstallation", () => {
  it("reports a missing destination", () => {
    const { fs, plan } = setup({
      links: [{ source: "g.txt", destination: "${HOME}/.agents/guidance.txt" }],
    });
    fs.set(`${sourceRoot}/g.txt`, "guidance");
    expect(verifyInstallation(plan, fs).map((f) => f.rule)).toEqual(["install/link-missing"]);
  });

  it("reports a link replaced by a real file", () => {
    const { fs, plan } = setup({
      links: [{ source: "g.txt", destination: "${HOME}/.agents/guidance.txt" }],
    });
    fs.set(`${sourceRoot}/g.txt`, "guidance");
    fs.set(`${home}/.agents/guidance.txt`, "someone replaced the link");
    expect(verifyInstallation(plan, fs).map((f) => f.rule)).toEqual(["install/link-not-a-symlink"]);
  });

  it("reports a link pointing somewhere else", () => {
    const { fs, plan } = setup({
      links: [{ source: "g.txt", destination: "${HOME}/.agents/guidance.txt" }],
    });
    fs.set(`${sourceRoot}/g.txt`, "guidance");
    fs.set("/elsewhere/other.txt", "other");
    fs.setSymlink(`${home}/.agents/guidance.txt`, "/elsewhere/other.txt");
    expect(verifyInstallation(plan, fs).map((f) => f.rule)).toEqual(["install/link-drift"]);
  });

  // The failure this whole design exists to catch: the manifest still says the
  // installation is correct, because that is what a manifest is.
  it("reports content drift at a copy destination", () => {
    const { fs, plan } = setup({
      copies: [{ source: "g.txt", destination: "${HOME}/.agents/guidance.txt" }],
    });
    fs.set(`${sourceRoot}/g.txt`, "canonical");
    applyInstallation(plan, fs, { backupRoot });
    fs.set(`${home}/.agents/guidance.txt`, "edited by hand");

    expect(verifyInstallation(plan, fs).map((f) => f.rule)).toEqual(["install/copy-drift"]);
  });

  it("reports a mode that has been loosened", () => {
    const { fs, plan } = setup({
      copies: [{ source: "g.txt", destination: "${HOME}/g.txt", mode: "600" }],
    });
    fs.set(`${sourceRoot}/g.txt`, "guidance");
    applyInstallation(plan, fs, { backupRoot });
    fs.chmod(`${home}/g.txt`, 0o644);

    expect(verifyInstallation(plan, fs).map((f) => f.rule)).toEqual(["install/copy-mode"]);
  });

  it("reports a duplicated managed block", () => {
    const { fs, plan } = setup({
      managedBlocks: [
        {
          source: "shell.zsh",
          destination: "${HOME}/.zshrc",
          startMarker: "# >>> managed >>>",
          endMarker: "# <<< managed <<<",
        },
      ],
    });
    fs.set(`${sourceRoot}/shell.zsh`, "export PATH=x\n");
    applyInstallation(plan, fs, { backupRoot });
    const contents = fs.read(`${home}/.zshrc`) ?? "";
    fs.set(`${home}/.zshrc`, `${contents}\n${contents}`);

    expect(verifyInstallation(plan, fs).map((f) => f.rule)).toEqual(["install/block-drift"]);
  });

  it("reports a private directory whose mode was loosened", () => {
    const { fs, plan } = setup({ privateDirectories: [{ path: "${HOME}/.agent", create: true }] });
    applyInstallation(plan, fs, { backupRoot });
    fs.chmod(`${home}/.agent`, 0o755);

    expect(verifyInstallation(plan, fs).map((f) => f.rule)).toEqual([
      "install/private-directory-mode",
    ]);
  });

  // A drift report is most useful complete; stopping at the first difference
  // tells an operator to fix one thing and run again, repeatedly.
  it("reports every operation rather than stopping at the first", () => {
    const { fs, plan } = setup({
      links: [{ source: "a.txt", destination: "${HOME}/a.txt" }],
      copies: [{ source: "b.txt", destination: "${HOME}/b.txt" }],
      privateDirectories: [{ path: "${HOME}/.agent", create: true }],
    });
    fs.set(`${sourceRoot}/a.txt`, "a");
    fs.set(`${sourceRoot}/b.txt`, "b");

    expect(verifyInstallation(plan, fs)).toHaveLength(3);
  });

  it("turns an unreadable source into a finding rather than a crash", () => {
    const { fs, plan } = setup({ copies: [{ source: "gone.txt", destination: "${HOME}/g.txt" }] });
    fs.set(`${home}/g.txt`, "something");
    expect(verifyInstallation(plan, fs).map((f) => f.rule)).toEqual(["install/unreadable"]);
  });
});
