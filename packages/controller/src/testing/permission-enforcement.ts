// Test-only support module. Excluded from the package build by
// tsconfig.json's "src/testing/**" exclude — it never ships in dist and is
// not part of this package's public surface.
//
// See issue #825: a chmod-000 fixture only proves "this process could not
// read that path" when permission bits are actually enforced against the
// process running the test. A process with uid 0 (root) — the default
// identity inside many container/CI/agent sandboxes — ignores POSIX
// permission bits for its own reads entirely, so `chmodSync(path, 0o000)`
// followed by a read from that same process silently succeeds instead of
// throwing EACCES/EPERM. A test written to assert "an unreadable path is
// handled" then either fails on a real assertion mismatch (the path never
// actually became unreadable) or, if written carelessly, could pass without
// having exercised the condition it claims to cover at all.
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const PERMISSION_BITS_NOT_ENFORCED_REASON =
  "chmod 0o000 did not block this process's own read of a file it just wrote " +
  "(this process bypasses POSIX permission bits — typically uid 0/root inside " +
  "a container sandbox). A chmod-000 fixture cannot exercise 'unreadable' in " +
  "this environment, so this test is skipped rather than asserting against a " +
  "fixture that never actually became unreadable. See issue #825.";

/**
 * True when chmod 0o000 on a file this process owns actually blocks that
 * same process from reading it back — i.e. when POSIX permission bits are
 * genuinely enforced against this process.
 *
 * This probes the real, current behavior directly (writes a throwaway file,
 * chmods it 0o000, tries to read it back) rather than only checking
 * `process.getuid?.() === 0`. A direct probe also catches any other
 * configuration that produces the same "chmod 000 doesn't actually block my
 * own read" symptom — not just plain root — and it needs no platform-
 * specific privilege API.
 */
export function permissionBitsAreEnforced(): boolean {
  const dir = mkdtempSync(join(tmpdir(), "controller-permission-probe-"));
  const probePath = join(dir, "probe");
  try {
    writeFileSync(probePath, "probe", "utf8");
    chmodSync(probePath, 0o000);
    try {
      readFileSync(probePath);
      // The read succeeded despite chmod 0o000: this process bypasses
      // permission bits in this environment.
      return false;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EACCES" || code === "EPERM") return true;
      // An unexpected failure mode (e.g. ENOENT from a broken probe) means
      // this probe itself is unreliable here — surface it rather than
      // silently reporting either answer.
      throw error;
    }
  } finally {
    // Restore permissions before cleanup so rmSync can actually delete it.
    chmodSync(probePath, 0o644);
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Call at the top of a test whose chmod-000 fixture depends on permission
 * bits actually being enforced against this process. When they are not
 * (e.g. this process is running as root), this skips the test loudly —
 * vitest records `reason` in its report as a skipped test, distinct from
 * a pass — instead of letting the rest of the test run its assertions
 * against a fixture that never actually became unreadable.
 *
 * Pass a test context's own `skip` (e.g. `(ctx) =>
 * skipUnlessPermissionBitsAreEnforced(ctx.skip)`), not a home-grown
 * conditional return — vitest's `ctx.skip()` is what makes the skip and its
 * reason show up in the test report; a plain early `return` would be
 * exactly the silent skip this exists to avoid.
 */
export function skipUnlessPermissionBitsAreEnforced(skip: (note?: string) => never): void {
  if (!permissionBitsAreEnforced()) {
    skip(PERMISSION_BITS_NOT_ENFORCED_REASON);
  }
}
