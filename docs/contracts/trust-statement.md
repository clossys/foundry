<!--
Client-facing content (#1225, #1226). This is the source text a repository's
setup step composes into whatever a client actually reads -- Launcher is the
one owner of that compose-time step, and it is not part of this pull request
(see the follow-up comment recorded on #1225). Written for a non-technical
client, in client vocabulary only: team, roles, loop, kit, brief. Says
"Clossys," never "Foundry" -- Foundry is this repository's own internal name
and never appears in text a client reads. No internal jargon, no package
names, no repository names.
-->

# What your Clossys team can do, and where your information goes

Your Clossys team is a set of roles that work in your own repository, using
the coding agent you already use. This page says plainly what they do on
their own, what they always ask you about first, and what they never do.

## What the team does without asking you first

The team reads your repository, drafts changes, and runs your own checks
against a draft before proposing it. None of that changes anything you have
not seen yet.

## What always becomes a pull request

Every change the team proposes arrives as a pull request in your own
repository -- the same kind of request any contributor would open. Nothing
takes effect until you approve it. That is true for a small wording fix and
a large one alike.

## What always needs your approval first, even before a draft

Some things are not undone by simply not merging a pull request, so the team
asks you before doing them at all:

- spending your money, or authorizing a purchase;
- sending a message to someone outside the team on your behalf -- an email,
  a social post, anything that cannot be taken back once sent;
  changing a live system your repository does not itself contain -- a
  deployment, a domain, a setting on another service you use;
- accepting terms, or granting a permission to another service (an OAuth or
  single sign-on grant).

## What the team never does

- **It never handles your credentials.** Passwords, tokens, and connection
  strings never enter your repository and are never typed in by the team.
  A separate, locked-away credential holder is the only place they live.
- **It never merges its own work.** A merge either needs your approval or an
  independent review -- never the same role that proposed the change.
- **It never bypasses your own required checks.** If your repository
  requires a review or a passing check before a merge, the team never skips
  that requirement to move faster.
- **It never force-pushes or rewrites history that is already shared,** and
  it never permanently deletes your data.
- **It never changes your account or security settings.**

## Where your content goes

Clossys packages themselves send nothing anywhere. Your content flows only
to the model provider behind the coding agent you already chose to use --
the same place it already goes when you use that agent yourself. Clossys
does not add a second destination.

## The audit trail

Everything the team does is visible in your own repository's history: git
history for every change, plus each role's own decision log for why it
proposed what it proposed. There is no separate, hidden record.

## How this is enforced, not just promised

This page states intent in plain language. The actual rules -- who may do
what in your repository -- are enforced separately, by your repository's own
access controls and required checks, not by this page alone. If the two
ever disagree, your repository's own enforced rules are what actually
happened.
