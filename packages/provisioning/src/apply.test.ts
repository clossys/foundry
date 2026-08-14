import { describe, expect, it } from "vitest";
import { applyInstallation } from "./apply.js";
import { loadManifest } from "./manifest.js";
import { createRuntimeContext, planInstallation } from "./runtime.js";
import { verifyInstallation } from "./verify.js";
import { createMemoryFileSystem } from "./memory-fs.test-helper.js";
import type { MemoryFileSystem } from "./memory-fs.test-helper.js";

const home = "/home/op";
const sourceRoot = "/src/plane";
const backupRoot = `${home}/.config-backups/run`;

function setup(raw: Record<string, unknown>): {
  fs: MemoryFileSystem;
  plan: ReturnType<typeof planInstallation>;
} {
  const manifest = loadManifest({
    version: 1,
    defaults: { workspaceRoot: "${HOME}/code" },
    ...raw,
  });
  const runtime = createRuntimeContext(manifest, { home, sourceRoot });
  const fs = createMemoryFileSystem();
  return { fs, plan: planInstallation(manifest, runtime) };
}

describe("applyInstallation", () => {
  it("creates a link and reports it unchanged on a second run", () => {
    const { fs, plan } = setup({
      links: [{ source: "guidance.txt", destination: "${HOME}/.agents/guidance.txt" }],
    });
    fs.set(`${sourceRoot}/guidance.txt`, "guidance");

    expect(applyInstallation(plan, fs, { backupRoot }).changed).toHaveLength(1);
    expect(applyInstallation(plan, fs, { backupRoot }).changed).toHaveLength(0);
    expect(verifyInstallation(plan, fs)).toEqual([]);
  });

  it("expands tokens in a templated copy", () => {
    const { fs, plan } = setup({
      copies: [
        { source: "guidance.txt", destination: "${HOME}/.agents/guidance.txt", template: true, mode: "600" },
      ],
    });
    fs.set(`${sourceRoot}/guidance.txt`, "workspace is ${WORKSPACE_ROOT}\n");

    applyInstallation(plan, fs, { backupRoot });
    expect(fs.read(`${home}/.agents/guidance.txt`)).toBe("workspace is /home/op/code\n");
    expect(fs.lstat(`${home}/.agents/guidance.txt`)?.mode).toBe(0o600);
    expect(verifyInstallation(plan, fs)).toEqual([]);
  });

  it("backs up the previous content before replacing it", () => {
    const { fs, plan } = setup({
      copies: [{ source: "guidance.txt", destination: "${HOME}/.agents/guidance.txt" }],
    });
    fs.set(`${sourceRoot}/guidance.txt`, "new");
    fs.set(`${home}/.agents/guidance.txt`, "the operator's own edits");

    applyInstallation(plan, fs, { backupRoot });
    expect(fs.read(`${backupRoot}${home}/.agents/guidance.txt`)).toBe("the operator's own edits");
    expect(fs.read(`${home}/.agents/guidance.txt`)).toBe("new");
  });

  // A same-content symlink left in place would take the chmod below and change
  // the permissions of whatever it points at instead.
  it("replaces a same-content symlink at a copy destination with a real file", () => {
    const { fs, plan } = setup({
      copies: [{ source: "guidance.txt", destination: "${HOME}/.agents/guidance.txt", mode: "600" }],
    });
    fs.set(`${sourceRoot}/guidance.txt`, "guidance");
    fs.setSymlink(`${home}/.agents/guidance.txt`, `${sourceRoot}/guidance.txt`);

    applyInstallation(plan, fs, { backupRoot });
    const stat = fs.lstat(`${home}/.agents/guidance.txt`);
    expect(stat?.isSymbolicLink).toBe(false);
    expect(stat?.isFile).toBe(true);
    expect(fs.lstat(`${sourceRoot}/guidance.txt`)?.mode).toBe(0o644);
  });

  it("adds a managed block without disturbing the operator's own lines", () => {
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
    fs.set(`${home}/.zshrc`, "alias mine=something\n");

    applyInstallation(plan, fs, { backupRoot });
    const contents = fs.read(`${home}/.zshrc`) ?? "";
    expect(contents).toContain("alias mine=something");
    expect(contents).toContain("# >>> managed >>>\nexport PATH=x\n# <<< managed <<<");

    expect(applyInstallation(plan, fs, { backupRoot }).changed).toHaveLength(0);
    expect(verifyInstallation(plan, fs)).toEqual([]);
  });

  it("updates a managed block in place rather than appending a second one", () => {
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
    fs.set(`${sourceRoot}/shell.zsh`, "export PATH=old\n");
    applyInstallation(plan, fs, { backupRoot });

    fs.set(`${sourceRoot}/shell.zsh`, "export PATH=new\n");
    applyInstallation(plan, fs, { backupRoot });

    const contents = fs.read(`${home}/.zshrc`) ?? "";
    expect(contents.split("# >>> managed >>>")).toHaveLength(2);
    expect(contents).toContain("export PATH=new");
    expect(contents).not.toContain("export PATH=old");
  });

  it("creates a private directory at 0700 and tightens a loose one", () => {
    const { fs, plan } = setup({
      privateDirectories: [
        { path: "${HOME}/.agent", create: true },
        { path: "${HOME}/.ssh", create: false },
      ],
    });
    fs.setDirectory(`${home}/.ssh`, 0o755);

    applyInstallation(plan, fs, { backupRoot });
    expect(fs.lstat(`${home}/.agent`)?.mode).toBe(0o700);
    expect(fs.lstat(`${home}/.ssh`)?.mode).toBe(0o700);
  });

  it("refuses a private directory that is a symlink", () => {
    const { fs, plan } = setup({
      privateDirectories: [{ path: "${HOME}/.agent", create: true }],
    });
    fs.setSymlink(`${home}/.agent`, "/somewhere/else");
    expect(() => applyInstallation(plan, fs, { backupRoot })).toThrow(/must not be a symlink/);
  });

  it("does not create a private directory declared create:false", () => {
    const { fs, plan } = setup({
      privateDirectories: [{ path: "${HOME}/.secrets", create: false }],
    });
    applyInstallation(plan, fs, { backupRoot });
    expect(fs.lstat(`${home}/.secrets`)).toBeUndefined();
    expect(verifyInstallation(plan, fs)).toEqual([]);
  });

  // The defect this ordering exists to prevent: a chained link whose target is
  // produced by a COPY. While every chained target happened to be produced by
  // another link, applying all links together worked by luck.
  it("applies a link chained onto a copy, whichever order the manifest lists them", () => {
    const { fs, plan } = setup({
      copies: [
        { source: "guidance.txt", destination: "${HOME}/.agents/guidance.txt", template: true },
      ],
      links: [
        { target: "${HOME}/.agents/guidance.txt", destination: "${HOME}/.other/guidance.txt" },
      ],
    });
    fs.set(`${sourceRoot}/guidance.txt`, "workspace is ${WORKSPACE_ROOT}\n");

    applyInstallation(plan, fs, { backupRoot });

    const chained = `${home}/.other/guidance.txt`;
    expect(fs.lstat(chained)?.isSymbolicLink).toBe(true);
    expect(fs.realpath(chained)).toBe(`${home}/.agents/guidance.txt`);
    // Reading through the chain must reach expanded content, not a token.
    expect(fs.read(`${home}/.agents/guidance.txt`)).toBe("workspace is /home/op/code\n");
    expect(verifyInstallation(plan, fs)).toEqual([]);
  });

  it("applies a link chained onto a managed block", () => {
    const { fs, plan } = setup({
      managedBlocks: [
        {
          source: "shell.zsh",
          destination: "${HOME}/.zshrc",
          startMarker: "# >>> managed >>>",
          endMarker: "# <<< managed <<<",
        },
      ],
      links: [{ target: "${HOME}/.zshrc", destination: "${HOME}/.zshrc.link" }],
    });
    fs.set(`${sourceRoot}/shell.zsh`, "export PATH=x\n");

    applyInstallation(plan, fs, { backupRoot });
    expect(fs.realpath(`${home}/.zshrc.link`)).toBe(`${home}/.zshrc`);
    expect(verifyInstallation(plan, fs)).toEqual([]);
  });

  it("fails loudly when a link source is missing", () => {
    const { fs, plan } = setup({
      links: [{ source: "absent.txt", destination: "${HOME}/.agents/guidance.txt" }],
    });
    expect(() => applyInstallation(plan, fs, { backupRoot })).toThrow(/source does not exist/);
  });

  it("fails loudly when a templated source carries an unknown token", () => {
    const { fs, plan } = setup({
      copies: [{ source: "guidance.txt", destination: "${HOME}/g.txt", template: true }],
    });
    fs.set(`${sourceRoot}/guidance.txt`, "points at ${NOT_A_TOKEN}\n");
    expect(() => applyInstallation(plan, fs, { backupRoot })).toThrow(/Unknown path token/);
  });
});
