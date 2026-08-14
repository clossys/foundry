import { dirname, join } from "node:path";
import { composeManagedBlock } from "./blocks.js";
import { expandTokens } from "./runtime.js";
import type {
  ApplyOptions,
  ApplyResult,
  FileSystemPort,
  Plan,
  PlanOperation,
} from "./types.js";

/**
 * Applying a plan to a machine. Every mutation goes through the injected port,
 * and every destination that already exists is backed up before it is touched.
 */

export const PRIVATE_DIRECTORY_MODE = 0o700;

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function sourceContents(
  operation: PlanOperation,
  fs: FileSystemPort,
  tokens: Readonly<Record<string, string>>,
): Uint8Array {
  const raw = fs.readFile(operation.sourcePath as string);
  if (!operation.template) return raw;
  return encoder.encode(expandTokens(decoder.decode(raw), tokens));
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

function backupPathFor(backupRoot: string, destination: string): string {
  return join(backupRoot, destination.replace(/^\/+/, ""));
}

function backup(destination: string, backupRoot: string, fs: FileSystemPort): void {
  const stat = fs.lstat(destination);
  if (!stat) return;
  const target = backupPathFor(backupRoot, destination);
  fs.mkdir(dirname(target), PRIVATE_DIRECTORY_MODE);
  if (stat.isSymbolicLink) {
    fs.symlink(fs.readlink(destination), target);
  } else {
    fs.copy(destination, target);
  }
}

function removeExisting(destination: string, fs: FileSystemPort): void {
  if (fs.lstat(destination)) fs.remove(destination);
}

function replace(destination: string, backupRoot: string, fs: FileSystemPort): void {
  backup(destination, backupRoot, fs);
  removeExisting(destination, fs);
  fs.mkdir(dirname(destination));
}

function applyLink(operation: PlanOperation, backupRoot: string, fs: FileSystemPort): boolean {
  const source = operation.sourcePath as string;
  const sourceReal = fs.realpath(source);
  if (sourceReal === undefined) {
    throw new Error(`Link source does not exist: ${source}`);
  }

  const stat = fs.lstat(operation.destinationPath);
  if (stat?.isSymbolicLink && fs.realpath(operation.destinationPath) === sourceReal) return false;

  replace(operation.destinationPath, backupRoot, fs);
  fs.symlink(source, operation.destinationPath);
  return true;
}

function applyCopy(
  operation: PlanOperation,
  backupRoot: string,
  fs: FileSystemPort,
  tokens: Readonly<Record<string, string>>,
): boolean {
  const expected = sourceContents(operation, fs, tokens);
  const stat = fs.lstat(operation.destinationPath);

  // A managed copy must remain a regular file. In particular, never leave a
  // same-content symlink in place: the chmod below would follow it and change
  // the permissions of whatever it points at instead.
  const unchanged =
    stat?.isFile === true &&
    stat.isSymbolicLink === false &&
    equal(expected, fs.readFile(operation.destinationPath));

  if (!unchanged) {
    replace(operation.destinationPath, backupRoot, fs);
    fs.writeFile(operation.destinationPath, expected);
  }

  if (operation.mode !== undefined) {
    const mode = Number.parseInt(operation.mode, 8);
    const current = fs.lstat(operation.destinationPath);
    if (!unchanged || current?.mode !== mode) {
      fs.chmod(operation.destinationPath, mode);
      return true;
    }
  }
  return !unchanged;
}

function applyManagedBlock(
  operation: PlanOperation,
  backupRoot: string,
  fs: FileSystemPort,
  tokens: Readonly<Record<string, string>>,
): boolean {
  const body = decoder.decode(sourceContents(operation, fs, tokens));
  const stat = fs.lstat(operation.destinationPath);

  if (stat && !stat.isFile && !stat.isSymbolicLink) {
    throw new Error(
      `${operation.destinationPath}: managed block destination must be a regular file or symlink`,
    );
  }

  let existing = "";
  let mode = 0o644;
  if (stat) {
    mode = stat.isSymbolicLink ? 0o644 : stat.mode;
    try {
      existing = decoder.decode(fs.readFile(operation.destinationPath));
    } catch (error) {
      // A managed symlink can be left dangling when its source is renamed. Its
      // content is replaced by the new block once the link itself is backed up.
      if (!stat.isSymbolicLink) throw error;
    }
  }

  const expected = composeManagedBlock(
    existing,
    body,
    operation.startMarker as string,
    operation.endMarker as string,
    body,
  );

  if (stat?.isFile === true && stat.isSymbolicLink === false && existing === expected) return false;

  replace(operation.destinationPath, backupRoot, fs);
  fs.writeFile(operation.destinationPath, encoder.encode(expected));
  fs.chmod(operation.destinationPath, mode);
  return true;
}

function applyPrivateDirectory(operation: PlanOperation, fs: FileSystemPort): boolean {
  const stat = fs.lstat(operation.destinationPath);
  if (stat && (!stat.isDirectory || stat.isSymbolicLink)) {
    throw new Error(
      `${operation.destinationPath}: private directory must not be a symlink or a non-directory`,
    );
  }
  if (!stat) {
    if (!operation.create) return false;
    fs.mkdir(operation.destinationPath, PRIVATE_DIRECTORY_MODE);
    fs.chmod(operation.destinationPath, PRIVATE_DIRECTORY_MODE);
    return true;
  }
  if (stat.mode !== PRIVATE_DIRECTORY_MODE) {
    fs.chmod(operation.destinationPath, PRIVATE_DIRECTORY_MODE);
    return true;
  }
  return false;
}

/**
 * Apply a plan.
 *
 * Private directories are handled first so that anything written into them
 * lands somewhere already restricted, rather than sitting world-readable for
 * the duration of the run.
 */
export function applyInstallation(
  plan: Plan,
  fs: FileSystemPort,
  options: ApplyOptions,
): ApplyResult {
  const changed: PlanOperation[] = [];
  const unchanged: PlanOperation[] = [];
  const { backupRoot } = options;

  fs.mkdir(backupRoot, PRIVATE_DIRECTORY_MODE);
  fs.chmod(backupRoot, PRIVATE_DIRECTORY_MODE);

  const order: PlanOperation["kind"][] = ["private-directory", "link", "copy", "managed-block"];
  for (const kind of order) {
    for (const operation of plan.operations.filter((o) => o.kind === kind)) {
      let didChange: boolean;
      switch (operation.kind) {
        case "private-directory":
          didChange = applyPrivateDirectory(operation, fs);
          break;
        case "link":
          didChange = applyLink(operation, backupRoot, fs);
          break;
        case "copy":
          didChange = applyCopy(operation, backupRoot, fs, plan.runtime.tokens);
          break;
        case "managed-block":
          didChange = applyManagedBlock(operation, backupRoot, fs, plan.runtime.tokens);
          break;
      }
      (didChange ? changed : unchanged).push(operation);
    }
  }

  return { changed, unchanged, backupRoot };
}
