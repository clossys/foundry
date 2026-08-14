import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import type { ConventionAdapter, ConventionDocument } from "./types.js";

/**
 * The documents and adapter files this package ships as defaults.
 *
 * They are shipped as real files rather than embedded strings for one reason:
 * the thing that consumes them is a provisioning step that copies or templates
 * a file onto a machine. Handing it a path is the natural interface; handing it
 * a string would make every consumer write the file back out itself.
 *
 * Resolving a path is not I/O -- nothing here opens, reads, or stats anything.
 * Reading the file is the caller's business, which keeps this package free of
 * filesystem behavior the way its siblings are.
 */

const here = dirname(fileURLToPath(import.meta.url));

/**
 * `dist/` and `src/` are both one level below the package root, so the same
 * relative hop works whether this module was imported as compiled output or as
 * source (a consumer using source maps, or this package's own tests).
 */
const packageRoot = resolve(here, "..");

export const DOCUMENTS_ROOT: string = join(packageRoot, "documents");
export const ADAPTERS_ROOT: string = join(packageRoot, "adapters");

export const CONVENTION_DOCUMENTS: readonly ConventionDocument[] = Object.freeze([
  Object.freeze({
    id: "branch-provenance",
    filename: "branch-provenance.md",
    title: "Agent branch naming",
    templated: false,
  }),
  Object.freeze({
    id: "skill-grammar",
    filename: "skill-grammar.md",
    title: "Skill naming and ownership",
    templated: false,
  }),
  Object.freeze({
    id: "agent-interoperability",
    filename: "agent-interoperability.md",
    title: "Agent interoperability",
    templated: false,
  }),
  Object.freeze({
    id: "routine-declaration",
    filename: "routine-declaration.md",
    title: "Routine declarations",
    templated: false,
  }),
  Object.freeze({
    id: "skill-registry",
    filename: "skill-registry.md",
    title: "Capability-first skill registry",
    templated: false,
  }),
  Object.freeze({
    id: "machine-guidance",
    filename: "machine-guidance.md",
    title: "Shared machine-wide agent guidance",
    // Carries ${WORKSPACE_ROOT}. Install it as a templated copy, never a link.
    templated: true,
  }),
  Object.freeze({
    id: "machine-baseline",
    filename: "machine-baseline.md",
    title: "Machine baseline",
    templated: false,
  }),
]);

export const CONVENTION_ADAPTERS: readonly ConventionAdapter[] = Object.freeze([
  Object.freeze({
    id: "agent-policy-rules",
    filename: "agent-policy.rules",
    description:
      "Execution-policy rules for destructive and publishing commands, for an engine that reads this rule format.",
    templated: false,
    mode: "600",
  }),
  Object.freeze({
    id: "shell-integration",
    filename: "shell-integration.zsh",
    description:
      "Navigation-only shell integration. Carries ${WORKSPACE_ROOT}; install as a managed block or templated copy, never a link.",
    templated: true,
  }),
  Object.freeze({
    id: "branch-provenance-hook",
    filename: "branch-provenance-hook.sh",
    description:
      "Pre-tool-use hook enforcing branch provenance and default-branch protection. Configured entirely through the environment so it encodes no operator topology.",
    templated: false,
    mode: "755",
  }),
]);

function findDocument(id: string): ConventionDocument | undefined {
  return CONVENTION_DOCUMENTS.find((entry) => entry.id === id);
}

function findAdapter(id: string): ConventionAdapter | undefined {
  return CONVENTION_ADAPTERS.find((entry) => entry.id === id);
}

/**
 * Absolute path to a shipped document. Throws on an unknown id rather than
 * returning a path that does not exist: a caller about to copy a file onto a
 * machine should fail at the lookup, not produce an empty destination.
 */
export function documentPath(id: string): string {
  const document = findDocument(id);
  if (!document) {
    throw new Error(
      `Unknown convention document: ${id}. Known ids: ${CONVENTION_DOCUMENTS.map((d) => d.id).join(", ")}`,
    );
  }
  return join(DOCUMENTS_ROOT, document.filename);
}

/** Absolute path to a shipped adapter file. Throws on an unknown id. */
export function adapterPath(id: string): string {
  const adapter = findAdapter(id);
  if (!adapter) {
    throw new Error(
      `Unknown convention adapter: ${id}. Known ids: ${CONVENTION_ADAPTERS.map((a) => a.id).join(", ")}`,
    );
  }
  return join(ADAPTERS_ROOT, adapter.filename);
}

/**
 * Every shipped file that must be expanded before its content is correct.
 * A provisioning step should refuse to symlink any of these.
 */
export function templatedFilenames(): readonly string[] {
  return Object.freeze([
    ...CONVENTION_DOCUMENTS.filter((d) => d.templated).map((d) => d.filename),
    ...CONVENTION_ADAPTERS.filter((a) => a.templated).map((a) => a.filename),
  ]);
}
