# Skill naming and ownership

Name every first-party skill with:

```text
<owner>-<verb>-<what>
```

The prefix identifies the GitHub account that owns the workflow, the verb is a
simple action, and the final term is the concrete subject. The directory and
frontmatter `name` must be identical.

Each account registers exactly one prefix, and each prefix belongs to exactly
one account. The allocation itself is a declaration owned by the plane that
governs the account, not a convention: this document defines the grammar the
allocation must satisfy, and each plane registers its own entry.

A registered prefix must be a short lowercase abbreviation of its account, and
must not collide with a provider namespace already in use. A skill carrying an
account's prefix must verify it is operating on a repository that account
declares before it reads, changes, or invokes repository-specific commands —
the prefix is a safety boundary, not a label.

The canonical home for a prefixed skill is that account's control plane when
the workflow spans more than one of the account's repositories, and the owning
repository otherwise.

## Scope tiers

That canonical-home choice is exactly the test the skill registry's `scope`
field encodes (see `conventions/documents/skill-registry.md`): every
first-party skill is either `account`-scoped — spans more than one of that
account's own repositories — or `repo`-scoped — lives inside, and never
claims coverage outside, the one repository that owns it. A skill copied in
from an external source instead of grown from one account's own review is
`third-party`-scoped, and has no owning account at all: it keeps the
namespace its maintaining provider chose (below) rather than a registered
prefix, and the registry neither requires nor accepts a repository for it.

These three tiers are exhaustive on purpose. There is no fourth, "machine",
tier: a skill's naming grammar exists to bind it to the one account whose
workflow it encodes, and "the machine" is not an account with a workflow of
its own to encode — it is the shared substrate several accounts' skills
happen to run on. A skill that tried to claim machine scope would either be
restating one account's own `account`-scoped skill under a different name, or
claiming judgment about repositories nobody who wrote it actually reviewed.

Use a small, literal verb vocabulary: `audit`, `clean`, `close`, `create`,
`diagnose`, `expand`, `groom`, `ingest`, `map`, `plan`, `reconcile`, `review`,
`ship`, `sync`, and `verify`. Prefer a specific, descriptive name to an
ambiguous one that hides what the skill does.

Third-party skills retain the namespace chosen by their maintaining provider;
do not rename or fork them just to fit this convention. A locally copied
provider skill must remain clearly marked as third-party in validation and
documentation.

The final `what` answers what the skill acts on, not the repository it happens
to run in. Keep a skill only when it captures a proven repeated workflow;
standing policy belongs in `AGENTS.md`, deterministic enforcement belongs in
scripts or CI, and repository-specific implementation guidance belongs with
the code it governs.
