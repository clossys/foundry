// `launcher-apply-plan body` (issue #1716, RFC apply-approved-plan section 6): the body of the pull request for one stored
// change set, bound by what the hub decides now, with the hash of exactly the printed bytes recorded as the set's
// `pullRequest.bodySha256`. An approval must bind exactly the body that is opened: any ambiguity refuses, and a refusal prints
// nothing on standard output and one line of fixed tokens on standard error.
//
//   B1. The binding is what runPreconditions decides now, from the hub. It is never an option, an argument or a stored value; a
//       refusal of the preconditions keeps its own token and its own exit code.
//   B2. A stored planned bundle that lists this set holds a binding for it; that binding must be exactly B1's, else
//       `binding-mismatch`. A bundle that is absent, not planned, or does not list the set records no binding to hold it to.
//   B3. The body is renderPullRequest over the stored set (read again here, so what is rendered is what is stored), B1's binding,
//       the task record and the superseded numbers: nothing else.
//   B4. `bodySha256` is the SHA-256 of exactly the bytes printed, recorded after rendering by bindChangeSetBody, which replaces
//       the one stored file atomically, refuses a symbolic link, and changes nothing else. Another recorded value is
//       `body-bound`; the same value is a no-op.
//   B5. `--supersedes` numbers are distinct positive safe integers other than the task record (the renderer refuses the rest as
//       `supersedes-invalid`), and the set must have another stored set of its repository to replace, else `supersedes-unfounded`.
//   B6. Every refusal is empty standard output and one standard error line naming a fixed token, never an argument, a path, an id
//       or tool output.

import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import type { ReadinessRunner } from "./admission.js";
import { BodyBoundError, bindChangeSetBody, readStoredApplyBundle, readStoredChangeSet } from "./apply-store.js";
import type { ApprovalBinding, RepositoryChangeSet } from "./change-set-contract.js";
import { validateRepositoryChangeSet } from "./change-set-contract.js";
import { changeSetDigest } from "./change-set-digest.js";
import { runPreconditions } from "./materialize.js";
import { renderPullRequest } from "./pull-request-body.js";
import { safeReason } from "./status.js";

/** What `body` reads: no member can carry a binding. */
export interface BodyInput {
  readonly clone: string;
  readonly hub: string;
  readonly set: RepositoryChangeSet;
  readonly heldChangeSets: readonly RepositoryChangeSet[];
  /** The number of the task-record issue in the target repository. */
  readonly taskRecord: number;
  /** The numbers of the pull requests of older change sets this one replaces. */
  readonly supersedes?: readonly number[];
  readonly now?: () => Date;
  readonly runReadiness?: ReadinessRunner;
}

export type BodyOutcome =
  | { readonly exitCode: 0; readonly body: string }
  | { readonly exitCode: 1 | 2; readonly reason: string };

export class BodyUsageError extends Error {}

export const BODY_USAGE = "launcher-apply-plan body --repo <id> --task-record <n> [--supersedes <n>]...";

export interface BodyArgs {
  readonly help: false;
  readonly id: string;
  readonly taskRecord: number;
  readonly supersedes: readonly number[];
}

const REPO_ID_SHAPE = /^[^/]+\/[^/]+$/u;
const WHOLE_NUMBER = /^(?:0|[1-9][0-9]{0,15})$/u;

function wholeNumber(text: string | undefined): number {
  if (text === undefined || !WHOLE_NUMBER.test(text)) throw new BodyUsageError();
  const value = Number(text);
  if (!Number.isSafeInteger(value)) throw new BodyUsageError();
  return value;
}

/**
 * Reads `--repo`, `--task-record` and any number of `--supersedes`. A usage error carries no message: nothing the caller typed is
 * ever echoed. A number is digits only, so a sign, an exponent, a space or a leading zero is a usage error; whether it is a
 * positive number that is not the task record is the renderer's judgment (`supersedes-invalid`, `task-record-invalid`).
 */
export function parseBodyArgs(argv: readonly string[]): { help: true } | BodyArgs {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) return { help: true };
  let id: string | undefined;
  let taskRecord: string | undefined;
  const supersedes: number[] = [];
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (value === undefined) throw new BodyUsageError();
    if (name === "--repo" && id === undefined) id = value;
    else if (name === "--task-record" && taskRecord === undefined) taskRecord = value;
    else if (name === "--supersedes") supersedes.push(wholeNumber(value));
    else throw new BodyUsageError();
  }
  if (id === undefined || taskRecord === undefined) throw new BodyUsageError();
  const name = id.slice(id.indexOf("/") + 1);
  if (!REPO_ID_SHAPE.test(id) || name === "." || name === "..") throw new BodyUsageError();
  return { help: false, id, taskRecord: wholeNumber(taskRecord), supersedes };
}

const refuse = (reason: string): BodyOutcome => ({ exitCode: 1, reason });
const indeterminate = (reason: string): BodyOutcome => ({ exitCode: 2, reason });

const sameBinding = (left: ApprovalBinding, right: ApprovalBinding): boolean =>
  left.kind === right.kind &&
  left.subjectDigest === right.subjectDigest &&
  (left.kind !== "admitted" || (right.kind === "admitted" && left.setupChangeSet === right.setupChangeSet));

/** Whether the hub holds a set of this repository, other than this one, that verifies under its own digest. */
function hasAnotherSet(set: RepositoryChangeSet, held: readonly RepositoryChangeSet[]): boolean {
  return held.some((other) => {
    if (other.repository.id !== set.repository.id || other.changeSetDigest === set.changeSetDigest) return false;
    return validateRepositoryChangeSet(other).valid && changeSetDigest(other) === other.changeSetDigest;
  });
}

/** Renders, binds and returns the body; never throws. */
export async function bodyRepository(input: BodyInput): Promise<BodyOutcome> {
  try {
    const hub = realpathSync(input.hub);
    let stored: RepositoryChangeSet | null;
    try {
      stored = readStoredChangeSet(hub, input.set.changeSetDigest);
    } catch {
      return indeterminate("store-unreadable");
    }
    if (stored === null || stored.repository.id !== input.set.repository.id) return indeterminate("change-set-absent");

    // B1
    const pre = await runPreconditions(input.clone, input.hub, stored, input.heldChangeSets, { now: input.now, runReadiness: input.runReadiness });
    if ("exitCode" in pre) return pre.exitCode === 1 ? refuse(safeReason(pre.reason)) : indeterminate(safeReason(pre.reason));

    // B2
    let bundle;
    try {
      bundle = readStoredApplyBundle(hub, stored.bundle);
    } catch {
      return indeterminate("bundle-unreadable");
    }
    if (bundle !== null && bundle.mode === "planned") {
      for (const entry of bundle.repositories) {
        if (!("changeSet" in entry) || entry.changeSet !== stored.changeSetDigest) continue;
        const recorded = "binding" in entry ? entry.binding : undefined;
        if (entry.id !== stored.repository.id || recorded === undefined || !sameBinding(recorded, pre.binding)) return refuse("binding-mismatch");
      }
    }

    // B5
    const supersedes = input.supersedes ?? [];
    if (supersedes.length > 0 && !hasAnotherSet(stored, input.heldChangeSets)) return refuse("supersedes-unfounded");

    // B3
    const rendered = renderPullRequest({ set: stored, binding: pre.binding, taskRecord: input.taskRecord, ...(supersedes.length === 0 ? {} : { supersedes }) });
    if (rendered.state === "refused") return refuse(safeReason(rendered.reason));

    // B4: the hash of exactly the bytes that will be printed.
    const hash = `sha256:${createHash("sha256").update(Buffer.from(rendered.body, "utf8")).digest("hex")}`;
    if (hash !== rendered.bodySha256) return refuse("render-failed");
    try {
      bindChangeSetBody(hub, stored.changeSetDigest, hash);
    } catch (cause) {
      return cause instanceof BodyBoundError ? refuse("body-bound") : indeterminate("store-failed");
    }
    return { exitCode: 0, body: rendered.body };
  } catch {
    return indeterminate("body-failed");
  }
}
