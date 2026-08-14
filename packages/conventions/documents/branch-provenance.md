# Agent branch naming

Every branch an agent creates must be attributable from its name:

```text
codex/<short-slug>   # Codex
claude/<short-slug>  # Claude
```

The slug describes the work in lowercase kebab case. Branch taxonomy is not
provenance: do not use `agent/`, `feat/`, `fix/`, `chore/`, or `task/` for an
agent-created branch. Default branches retain their repository-defined names.

This rule applies prospectively. Do not rename an existing branch just to
conform; preserve its history and use the correct prefix for the next branch.

Claude's local command hook rejects non-`claude/` branch creation in the
configured workspace. Codex follows the same durable policy through the
shared `AGENTS.md` guidance and its own Desktop branch convention.
