# Agent interoperability

The durable system is a protocol stack, not a Codex/Claude mirror. Parity
means that every coding agent receives the same durable policy, repository
commands, safety boundaries, and acceptance tests. It does not mean copying
product state or pretending every product exposes identical features.

## Canonical layers

| Layer | Canonical source | Product adapters |
| --- | --- | --- |
| Standing policy | Layered `AGENTS.md` | Thin `CLAUDE.md`, `GEMINI.md`, or Copilot imports only when required |
| Mechanical safety | Shared policy plus deterministic tests | Codex rules and Claude hooks; never divergent behavioral prose |
| Reusable workflows | `.agents/skills/<name>/SKILL.md` | Native discovery links; do not duplicate skills |
| External tools | MCP or a documented CLI/API | Provider-owned OAuth, permissions, and secrets |
| Work tracking | GitHub Issues, PRs, and Discussions | Agent-specific dispatch is optional |
| Deterministic behavior | Repository scripts, hooks, and CI | Product hooks may call the same scripts |
| Quality contract | Tests, types, lint, security, accessibility, and evals | The same merge gates judge every agent |

Repository instructions own scoped guidance beneath the shared skills layer.
Across every layer, product adapters exist only for discovery, permissions,
hooks, and UI metadata; they never carry independent behavioral prose.

## Supported surfaces

- Codex and Claude are the primary interactive coding agents.
- GitHub is the shared coordination, review, automation, and audit surface.
- Copilot, Gemini, Devin, CodeRabbit, or a future agent may join by consuming
  the canonical contract and passing the same checks.
- Capability-specific native integrations are allowed. Their credentials,
  sessions, caches, and plugin state remain in the owning product.
- Codex and Claude connector parity is declared by the operator's non-secret
  connector policy. Both agents must support the selected context; neither
  agent may borrow the other's auth state or rely on an ambient cross-context
  credential.
- Cloud sessions are separate execution surfaces. They may use only
  provider-managed OAuth, a repository-scoped GitHub App, or short-lived OIDC;
  local Keychain, shell, CLI, and browser credentials never travel to cloud
  sessions.

## Admission test for another agent

Before calling a new platform supported, verify that it can:

1. load or be pointed to layered `AGENTS.md` guidance;
2. discover shared skills or invoke equivalent repository scripts;
3. use least-privilege MCP/CLI/API integrations without committed secrets;
4. work through GitHub issues, branches, PRs, and required checks;
5. honor repository boundaries and user-owned dirty worktrees;
6. produce changes that pass the same CI and product evals.

When a platform cannot satisfy a layer natively, use the smallest generated or
import-only adapter and test it for drift. Do not fork the canonical policy.

## Continuous review

- Monthly: review official Codex, Claude Code, GitHub Copilot, Gemini, MCP, and
  Agent Skills documentation for changed discovery paths or capabilities.
- On every adapter change: run portable installation tests and workspace drift
  checks, then verify one representative task in each primary agent.
- Quarterly: score optional agents against the admission test above; adopt one
  only when it adds a distinct workflow or measurably better signal.
- In CI: validate loader imports, shared-skill identity, forbidden duplicated
  policy, unpinned actions, secret leakage, and required repository commands.

Track protocols and conformance, not model names. Model selection can change
without changing the workspace contract.

## Skill policy

Install proven general skills from maintained vendors or communities. Create a
local skill only for a repeated workflow that depends on this workspace's
topology, governance, product boundaries, or cross-platform orchestration.

Account-owned skills stay intentionally narrow: real, repeated workflows tied
to that account's own topology, governance, or distinctive process.
Third-party skills remain provider-owned and retain their vendor name.
Build a new local skill only after at least two real uses demonstrate stable
steps worth encoding. Prefer a repository-scoped skill when its topology,
commands, or acceptance criteria belong to one project.

## Connector conformance

- The operator's connector policy declares context-scoped connector
  capability; it contains names, scopes, and references only, never live
  credentials.
- Test Codex and Claude separately in both their local and cloud execution
  surfaces. Equivalent capability means each can select the same context and
  provider boundary, not that their product-managed OAuth internals match.
- Before a cloud connector is admitted, verify its repository context,
  provider account/team, least-privilege scope, and evidence output. Reject a
  connector that forwards local credentials or silently falls back to another
  context.
