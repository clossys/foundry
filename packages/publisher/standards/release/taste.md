# release (publisher)

<!-- DRAFT copy (foundry-build-0048 U32): every line below awaits owner approval. -->

Taste criteria for the critic (R15.4): scored 1 to 5, never pass or fail.

## traceability

- 1: A reader cannot tell which inputs went into the release.
- 2: The main inputs are named; the rest are implied.
- 3: Every input is named; a few are hard to trace to their source.
- 4: Every input is named and traceable; one needs a second lookup.
- 5: Every input is named once, with the exact version a reader can trace in one step.

## change-clarity

- 1: A reader cannot tell what changed since the last release.
- 2: The change is visible only by comparing two releases by hand.
- 3: The change is listed, but mixed with what stayed the same.
- 4: The change is listed on its own; one entry is hard to read.
- 5: Only what changed is listed, each entry from one version to the next.

## reproducibility

- 1: Nothing in the release says how to make it again.
- 2: The build is named, but not what it read.
- 3: The build and its inputs are named; the checks it passed are not.
- 4: The build, its inputs and its checks are named; one detail is left to memory.
- 5: The build, every input and every check it passed are recorded, so the same release can be made again.
