# release

Plumb recipe for the `release` standard. A release manifest is computed, never crafted: the plumb
action `publisher.release` builds the publication from the pins as they resolve, writes the manifest
candidate through the one candidate writer (its `submit` event cites that action), and runs every
release gate. No stage calls a model, so this recipe records no craft events (R15.7) and keeps no
axes. It holds no rubric: the `release` standard is the judge (R15.5, R16). `<pub>` is the
publication id, and `release.<pub>` is its release slot (or the slot `publisher/ia.json` names).

Each stage is one clossys verb. A non-zero exit stops the run at that stage. Fix the input it names
(a pin, a page, the build), then run the stage again. Never edit a manifest by hand.

### 1. build (deterministic)

Build the publication from the current pins into `.clossys/builds/<id8>/` (the first eight characters
of the build digest).

```sh
clossys release <pub> --build
```

### 2. manifest (deterministic)

Write the manifest candidate `publisher/release.<pub>/candidates/<pub>-v<n>.json` for the latest
build. If the latest manifest already lists this build, it is reused and nothing is written.

```sh
clossys release <pub> --manifest
```

### 3. gates (deterministic)

Run every release gate against the latest manifest. Any failure exits 1, and no flag skips a gate.

```sh
clossys release <pub> --gates
```

### 4. validate (deterministic)

Run the constitution on the release slot before anyone asks for the ready-pin. The owner writes the
ready-pin through `clossys pin`, never this recipe.

```sh
clossys check --constitution --slot publisher/release.<pub>
```
