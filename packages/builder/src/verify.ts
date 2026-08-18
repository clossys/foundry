import { hasExactlyOneBlock } from "./blocks.js";
import { PRIVATE_DIRECTORY_MODE } from "./apply.js";
import { expandTokens } from "./runtime.js";
import type { FileSystemPort, Finding, Plan, PlanOperation } from "./types.js";

/**
 * Verifying an installation against the machine.
 *
 * This reads the destinations, never the manifest's claims about them. That
 * distinction is the entire value of the check: a manifest always says the
 * installation is correct, because that is what a manifest is. Only the machine
 * can say whether it is.
 *
 * Unlike applying, verifying returns findings instead of throwing. A drift
 * report is most useful complete -- stopping at the first difference tells an
 * operator to fix one thing and run again, repeatedly.
 */

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

function expectedContents(
  operation: PlanOperation,
  fs: FileSystemPort,
  tokens: Readonly<Record<string, string>>,
): Uint8Array {
  const raw = fs.readFile(operation.sourcePath as string);
  if (!operation.template) return raw;
  return encoder.encode(expandTokens(decoder.decode(raw), tokens));
}

function verifyLink(operation: PlanOperation, fs: FileSystemPort): Finding[] {
  const stat = fs.lstat(operation.destinationPath);
  if (!stat) {
    return [
      {
        rule: "install/link-missing",
        severity: "high",
        message: `${operation.destinationPath}: missing`,
      },
    ];
  }
  if (!stat.isSymbolicLink) {
    return [
      {
        rule: "install/link-not-a-symlink",
        severity: "high",
        message: `${operation.destinationPath}: must be a symlink, found a real file or directory`,
      },
    ];
  }
  const actual = fs.realpath(operation.destinationPath);
  const expected = fs.realpath(operation.sourcePath as string);
  if (actual === undefined) {
    return [
      {
        rule: "install/link-broken",
        severity: "high",
        message: `${operation.destinationPath}: symlink target does not resolve`,
      },
    ];
  }
  if (actual !== expected) {
    return [
      {
        rule: "install/link-drift",
        severity: "high",
        message: `${operation.destinationPath}: points at ${actual}, expected ${expected ?? operation.sourcePath}`,
      },
    ];
  }
  return [];
}

function verifyCopy(
  operation: PlanOperation,
  fs: FileSystemPort,
  tokens: Readonly<Record<string, string>>,
): Finding[] {
  const findings: Finding[] = [];
  const stat = fs.lstat(operation.destinationPath);
  if (!stat) {
    return [
      {
        rule: "install/copy-missing",
        severity: "high",
        message: `${operation.destinationPath}: missing`,
      },
    ];
  }
  if (!stat.isFile || stat.isSymbolicLink) {
    return [
      {
        rule: "install/copy-not-a-regular-file",
        severity: "high",
        message: `${operation.destinationPath}: installed copy must be a regular file`,
      },
    ];
  }
  if (!equal(expectedContents(operation, fs, tokens), fs.readFile(operation.destinationPath))) {
    findings.push({
      rule: "install/copy-drift",
      severity: "high",
      message: `${operation.destinationPath}: content differs from its source`,
    });
  }
  if (operation.mode !== undefined) {
    const expected = Number.parseInt(operation.mode, 8);
    if (stat.mode !== expected) {
      findings.push({
        rule: "install/copy-mode",
        severity: "medium",
        message: `${operation.destinationPath}: expected mode ${operation.mode}, found ${stat.mode.toString(8)}`,
      });
    }
  }
  return findings;
}

function verifyManagedBlock(
  operation: PlanOperation,
  fs: FileSystemPort,
  tokens: Readonly<Record<string, string>>,
): Finding[] {
  const stat = fs.lstat(operation.destinationPath);
  if (!stat) {
    return [
      {
        rule: "install/block-missing",
        severity: "high",
        message: `${operation.destinationPath}: missing`,
      },
    ];
  }
  if (!stat.isFile || stat.isSymbolicLink) {
    return [
      {
        rule: "install/block-destination-not-a-regular-file",
        severity: "high",
        message: `${operation.destinationPath}: managed block destination must be a regular file`,
      },
    ];
  }
  const body = decoder.decode(expectedContents(operation, fs, tokens));
  const contents = decoder.decode(fs.readFile(operation.destinationPath));
  if (
    !hasExactlyOneBlock(
      contents,
      body,
      operation.startMarker as string,
      operation.endMarker as string,
    )
  ) {
    return [
      {
        rule: "install/block-drift",
        severity: "high",
        message: `${operation.destinationPath}: managed block missing, duplicated, or drifted`,
      },
    ];
  }
  return [];
}

function verifyPrivateDirectory(operation: PlanOperation, fs: FileSystemPort): Finding[] {
  const stat = fs.lstat(operation.destinationPath);
  if (!stat) {
    // An absent directory the manifest does not create is not a defect. It is
    // a directory this operator has not needed yet.
    if (!operation.create) return [];
    return [
      {
        rule: "install/private-directory-missing",
        severity: "high",
        message: `${operation.destinationPath}: missing`,
      },
    ];
  }
  if (!stat.isDirectory || stat.isSymbolicLink) {
    return [
      {
        rule: "install/private-directory-not-a-directory",
        severity: "high",
        message: `${operation.destinationPath}: expected a directory that is not a symlink`,
      },
    ];
  }
  if (stat.mode !== PRIVATE_DIRECTORY_MODE) {
    return [
      {
        rule: "install/private-directory-mode",
        severity: "high",
        message: `${operation.destinationPath}: expected mode 700, found ${stat.mode.toString(8)}`,
      },
    ];
  }
  return [];
}

/** Verify every operation in a plan. Returns an empty array when the machine agrees. */
export function verifyInstallation(plan: Plan, fs: FileSystemPort): Finding[] {
  const findings: Finding[] = [];
  for (const operation of plan.operations) {
    try {
      switch (operation.kind) {
        case "link":
          findings.push(...verifyLink(operation, fs));
          break;
        case "copy":
          findings.push(...verifyCopy(operation, fs, plan.runtime.tokens));
          break;
        case "managed-block":
          findings.push(...verifyManagedBlock(operation, fs, plan.runtime.tokens));
          break;
        case "private-directory":
          findings.push(...verifyPrivateDirectory(operation, fs));
          break;
      }
    } catch (error) {
      // An unreadable source is a real finding, not a crash: it usually means
      // the checkout the installation points at has moved or been deleted,
      // which is exactly the drift this is looking for.
      findings.push({
        rule: "install/unreadable",
        severity: "high",
        message: `${operation.destinationPath}: ${(error as Error).message}`,
      });
    }
  }
  return findings;
}
