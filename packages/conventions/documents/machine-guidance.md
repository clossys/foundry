# Shared machine-wide agent guidance

This is the durable, agent-neutral instruction source for every coding agent
on this machine. Keep product-specific configuration, permissions, hooks,
authentication, session history, caches, and plugins in their native runtime
locations; do not duplicate those mechanisms here.

## Workspace navigation

- `$CODE_WORKSPACE_ROOT` is the canonical local workspace control plane. On
  this machine it resolves to `${WORKSPACE_ROOT}`.
- The standards checkout referenced by the workspace policy is the versioned
  source for machine and workspace standards; its install location is resolved
  dynamically. Change canonical standards there first, then run its installer
  and validator.
- Before cross-repository, workspace-topology, or mixed personal/work tasks,
  read the workspace control plane's own `AGENTS.md`, `README.md`, and
  workspace policy document.
- For ordinary project work, start in the applicable canonical repository and
  follow its local instructions. Repository policy takes precedence inside that
  repository.
- Preserve repository boundaries, existing user changes, and ephemeral
  worktrees. Do not create scratch material at the workspace root.
- Treat the workspace's `personal` subtree as private and non-published.

## Shared workflows and parity

- `AGENTS.md` is the shared durable guidance. A product loader file must import
  it instead of carrying a divergent second copy.
- Put reusable user-authored workflows under the neutral shared skills tree in
  the operator's home. Each agent's own skills directory must resolve to that
  tree rather than holding a second copy. Do not duplicate a skill in either
  runtime.
- Keep repeatable workflows agent-neutral. Product-specific rules and hooks
  may enforce the same policy mechanically, but must not introduce a second
  source of behavioral prose.
- Choose the smallest durable surface: repository instructions for standing
  context, a skill for a repeated workflow, a hook or rule for mechanical
  enforcement, a connector for authorized live data, and an automation only
  for genuinely recurring work.
- Keep topology, ports, launch commands, and repository ownership in the
  workspace's versioned control-plane files. Do not restate them here.

## Recurring work

- Work that runs without a model is a schedule and belongs to the system that
  runs it. Work that needs a session to exercise judgment is a routine, and is
  declared by the plane that owns the procedure it invokes.
- A routine declaration is a pointer: an identifier, a cadence, a scope, and
  one target. Never inline a procedure into a trigger, never write an absolute
  path into one, and never name a repository in a routine body — scope is
  resolved from the owning plane's registry when the routine is materialized.
- A declaration is intent. Whether a routine is installed, enabled, or firing
  is state held by the scheduler, so never report a passing declaration check
  as evidence that the work runs. Where the scheduler belongs to the same
  principal that owns the plane, reconcile against it rather than assuming.

## Session handoffs

- Treat an agent task as scoped to one repository and one work context. Do not
  require a terminal launcher or shell environment to establish that scope.
- When a fresh task would reduce scope confusion — especially for a repository,
  context, browser identity, or materially different goal change — stop and ask
  the user to start one in the target repository. Provide a ready-to-paste
  prompt with the repository path, goal, current status, key decisions,
  changed files, validation, and the next action.
- Do not create a handoff Markdown file by default. The target repository and
  the paste-ready prompt are the handoff; create a durable handoff artifact
  only when the user asks for one.
- Do not create a tracking issue solely to hand off a session. Include an
  existing issue in the prompt when relevant; create a new issue only when the
  work itself merits durable tracking or the user requests it.

## Branch provenance

- Every agent-created branch must state the creating agent in its first path
  segment. Never use generic agent branch prefixes such as `agent/`, `feat/`,
  `fix/`, `chore/`, or `task/`.
- This is a provenance rule, not a task taxonomy. Put the task description in
  the short slug and use the repository's default branch unchanged.
- Do not rename, force-push, or otherwise rewrite an existing branch merely
  to retrofit this rule. Apply it to every new agent branch.

## Ephemeral task worktrees

- An agent may maintain its own ephemeral, tool-managed worktree location
  outside the canonical worktree tree — a directory under its own dot-directory
  in the operator's home, or one nested inside the repository itself. This
  placement is a harness default, not a second workspace convention, and
  generally cannot be redirected.
- The branch and slug created there must still follow this workspace's naming
  and branch-provenance rules above; never substitute an unrelated name.
- Treat these as strictly ephemeral: remove them when the task finishes. They
  must not accumulate as untracked clutter beside the canonical worktree tree,
  and they are never a substitute for it.

## Resource discipline

- Before memory-intensive, long-running, or concurrent work, follow the
  machine baseline: inspect active processes and local services and choose a
  safe level of parallelism.
- Scope searches and commands to the smallest relevant path. Avoid broad,
  recursive scans through repositories, archives, generated output, dependency
  directories, caches, or personal records.
- Prefer existing project scripts and documented validation commands. Stop or
  reduce local work when it risks starving active development services.

## Privacy, credentials, and safety

- Never read, print, paste, commit, or transmit credentials, tokens, private
  keys, connection strings, or the contents of secret stores unless the user
  explicitly requires a narrowly scoped secure operation.
- Treat the operator's secret directory, `.env` files, runtime authentication
  stores, browser profiles, session history, and application databases as
  sensitive. Keep them outside repositories and out of agent instructions and
  skills.
- Do not manually merge, symlink, or edit an agent's or a forge's
  authentication, session, cache, cookie, database, or plugin-managed state.
  Normalize durable policy and workflows only.
- Resolve exact targets before destructive actions. Prefer recoverable changes,
  preserve user work, and verify the result proportionally to the risk.

## Configuration boundaries

- Each product's mechanics belong in that product's own dot-directory in the
  operator's home. Version-control and forge configuration remain tool-specific
  infrastructure.
- Machine-wide guidance must be concise and stable. Project-specific policy,
  package-release guidance, and operational details belong in their owning
  versioned workspace or repository.
