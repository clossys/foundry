<!--
Before you post — this becomes public and permanent

This repository is public (see AGENTS.md). The instant you open this PR,
GitHub emails the full title and description to every watcher, and even if
you edit it afterward, GitHub keeps prior revisions visible in the
edit-history dropdown. `scripts/check-public-safety.mjs` and CI's `safety`
job scan the FILES this PR changes, in FULL mode once a maintainer confirms
it isn't running on a fork — but neither one reads this description box.
This template is the only check that text gets before it's world-readable,
short of running `scripts/check-conversation-safety.mjs` against a draft
yourself first.

Never include in this description (or in any commit message — a commit
message is exactly as public and exactly as permanent as any file it
changes; editing a later commit does not remove an earlier one from
history):
- The name of a private sibling repository or product — this repository
  names only itself.
- A private npm scope or package name that isn't published from this
  repository.
- A cross-repository issue/PR reference to a private repo (e.g.
  `org/private-repo#12`) — the number alone tells a reader that repo exists.
- An absolute path into your own machine (anything rooted at your home
  directory or drive letter, rather than relative to the repository) — it
  can disclose your username or internal machine layout.
- Any credential — API key, token, password, connection string. If one is
  already posted anywhere, rotate it immediately regardless of what happens
  to this PR.
- A client, customer, or personal name.

Reporting a security vulnerability? Stop — close this PR and use private
vulnerability reporting instead (Security → Report a vulnerability). See
SECURITY.md. A patch that describes the vulnerability it fixes, opened as a
public PR before a private report exists, discloses the vulnerability itself.
-->

## What does this change?

## Why?

<!--
What breaks, or what stays broken, without this change? Link an issue if one
exists — but only if it's an issue on THIS repository. A reference to an
issue on a private repository (`org/private-repo#N`) discloses that repo by
itself, even with no other detail attached.
-->

## Checks

- [ ] `PUBLIC_SAFETY_DENYLIST=~/.config/public-safety/denylist-foundry.json npm run check` passes locally (or I understand CI will run it in PARTIAL mode on this fork PR, and a maintainer must re-run FULL mode before merge — see CONTRIBUTING.md).
- [ ] I reviewed this description, my commit messages, and my diff against the "never include" list above.
- [ ] If this touches a published package's public API, the README is updated in this same PR (`check-readme-parity.mjs` verifies this mechanically).
