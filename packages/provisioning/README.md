# @vespeneventures/provisioning

An idempotent engine for applying a provisioning manifest to a machine, and for
checking afterwards whether the machine still agrees with it.

```bash
npm install @vespeneventures/provisioning
```

## The problem this closes

Provisioning is the only kind of configuration whose target is a machine rather
than a repository or a registry, and the only kind that mutates state outside
version control. That makes two failures easy and both quiet.

The first is a check that reads the manifest instead of the machine. A manifest
always says the installation is correct — that is what a manifest is. Only the
destinations can say whether it is, and only by being read.

The second is an installer that guesses. An installer that infers its own source
root, invents a workspace root when none was declared, or leaves an unexpanded
placeholder in a file cannot be reasoned about: it produces a confident result
that is wrong in a way nothing downstream can detect.

This engine refuses both. Planning is pure and explicit; verification reads the
filesystem.

## What it is not

It owns no manifest, ships no defaults, and knows nothing about any particular
document set. It is neutral machinery — pointing it at a manifest is the only
way to make it do anything, which is what lets two parties who do not govern
each other use the same engine on different content.

If you want a set of agent conventions to install with it, that is
[`@vespeneventures/conventions`](https://github.com/vespeneventures/foundry/tree/main/packages/conventions),
a separate package with no dependency in either direction.

## Usage

```ts
import {
  applyInstallation,
  createNodeFileSystem,
  createRuntimeContext,
  loadManifest,
  planInstallation,
  verifyInstallation,
} from "@vespeneventures/provisioning";

const manifest = loadManifest(JSON.parse(rawManifestJson));

// Nothing is inferred: the home directory and the source root are yours to
// resolve, including whatever rule you use to prefer a durable checkout over a
// throwaway one.
const runtime = createRuntimeContext(manifest, {
  home: os.homedir(),
  sourceRoot: myCanonicalCheckout,
});

// Pure. Touches no filesystem, so it can be printed or reviewed first.
const plan = planInstallation(manifest, runtime);

const fs = createNodeFileSystem();
const result = applyInstallation(plan, fs, {
  backupRoot: `${runtime.home}/.config-backups/${stamp}`,
});
console.log(`${result.changed.length} changed, ${result.unchanged.length} already correct.`);

// Later, or in a drift check: reads the machine, not the manifest.
const findings = verifyInstallation(plan, fs);
for (const f of findings) console.error(`[${f.severity}] ${f.rule}: ${f.message}`);
```

## Manifest format

```jsonc
{
  "version": 1,
  "defaults": { "workspaceRoot": "${HOME}/code" },
  "links": [
    { "source": "sources/guidance.txt", "destination": "${HOME}/.agents/guidance.txt" },
    { "target": "${HOME}/.agents/skills", "destination": "${HOME}/.agent/skills" }
  ],
  "copies": [
    { "source": "sources/loader.txt", "destination": "${HOME}/.agent/loader.txt", "mode": "600" },
    { "source": "sources/guidance.txt", "destination": "${HOME}/.agents/guidance.txt", "template": true }
  ],
  "managedBlocks": [
    {
      "source": "adapters/shell.zsh",
      "destination": "${HOME}/.zshrc",
      "startMarker": "# >>> managed >>>",
      "endMarker": "# <<< managed <<<"
    }
  ],
  "privateDirectories": [{ "path": "${WORKSPACE_ROOT}/personal", "create": false }]
}
```

| Collection | Behavior |
| --- | --- |
| `links` | A symlink from `destination` to `source` (relative to the source root) or to an already-resolved `target`. Edits at the destination are edits to the source, which is usually the point |
| `copies` | A real file. Byte-compared on every run, `mode` re-applied on every run, and `template: true` expands `${TOKEN}` placeholders first |
| `managedBlocks` | A marker-delimited region inside a file the engine does not otherwise own, such as a shell startup file. Updated in place; surrounding content is preserved |
| `privateDirectories` | Held at `0700`. `create: false` means an absent directory is not a finding — it is one this operator has not needed yet |

### Tokens

`${HOME}`, `${SOURCE_ROOT}`, and `${WORKSPACE_ROOT}` are always available, plus
anything passed as `extraTokens`. The workspace root comes from the caller, then
the manifest default, and there is deliberately no third fallback.

The grammar is exact — `${` then all-caps and underscores then `}`. Anything
else is content: a templated shell file keeps its `${VAR:-default}` untouched.
The collision runs the other way, though — a *braced all-caps* shell variable is
indistinguishable from a token and will be substituted, so a file meant to
survive templating writes `$VAR`, including inside its comments.

### A templated source can never be a link

`loadManifest` rejects `template: true` on a `links` entry. A symlink has no
content of its own, so there is nothing to expand, and the reader would get the
literal `${WORKSPACE_ROOT}` — which reads like a real instruction and is worse
than an obviously missing file. Install a templated source as a copy or a
managed block.

This is the one real cost of templating a document rather than hardcoding a
default into it: the destination stops being live-edited through a symlink and
only changes on reinstall.

## Safety properties

- **Nothing is overwritten before it is backed up.** `backupRoot` is required,
  not optional. What gets overwritten lives outside version control and has no
  other copy.
- **Private directories are handled first**, so anything written into them lands
  somewhere already restricted rather than sitting world-readable for the length
  of the run.
- **Chained links are applied last.** A `links` entry declared with `target`
  points at another managed destination, not at the source tree, so it runs
  after copies and managed blocks. Manifest order does not matter: you can chain
  a link onto a templated copy and list it first.
- **A managed copy stays a regular file.** A same-content symlink at a copy
  destination is replaced rather than accepted, because the `chmod` that follows
  would otherwise change the permissions of whatever it points at.
- **Ambiguous markers are refused, not guessed.** Duplicated or malformed
  markers mean picking one region to overwrite and silently discarding what sat
  between them, in a file the engine does not own.
- **Applying throws; verifying reports.** There is no useful "continue with the
  parts that parsed" when mutating a machine — a half-applied manifest is the
  state hardest to reason about later. A drift report, by contrast, is most
  useful complete.

## API

| Export | Kind | Description |
| --- | --- | --- |
| `loadManifest(raw)` | function | Validates a parsed manifest object and returns it normalized. Pure — never reads a file. Throws on a duplicate destination, a templated link, a malformed marker pair, or a non-octal mode |
| `createRuntimeContext(manifest, options)` | function | Resolves the home directory, source root, workspace root, and token table. Throws rather than inventing a workspace root |
| `planInstallation(manifest, runtime)` | function | Resolves every entry to absolute paths with no filesystem access. The same plan drives applying and verifying |
| `expandTokens(value, tokens)` | function | Expands `${TOKEN}` placeholders; throws on an unknown token |
| `applyInstallation(plan, fs, options)` | function | Applies a plan through the injected port, backing up every replaced destination. Returns changed and unchanged operations |
| `verifyInstallation(plan, fs)` | function | Reads the machine and returns `Finding[]`. Empty means the machine agrees |
| `createNodeFileSystem()` | function | The default `FileSystemPort`, backed by `node:fs` |
| `renderManagedBlock(body, start, end)` | function | The marker-delimited block text |
| `withoutManagedBlock(contents, start, end)` | function | Content with the managed region removed; throws on duplicated or malformed markers |
| `composeManagedBlock(existing, body, start, end, legacyBody?)` | function | The exact content a destination should hold. `legacyBody` recognizes a pre-marker wholesale copy so it is replaced once rather than duplicated |
| `hasExactlyOneBlock(contents, body, start, end)` | function | Whether the destination holds exactly one well-formed copy of the expected block |
| `PRIVATE_DIRECTORY_MODE` | `number` | `0o700` |
| `Manifest` | type | `{ version, defaults?, links, copies, managedBlocks, privateDirectories }` |
| `LinkEntry` | type | `{ source? , target?, destination }` |
| `CopyEntry` | type | `{ source, destination, mode?, template? }` |
| `ManagedBlockEntry` | type | `{ source, destination, startMarker, endMarker, template? }` |
| `PrivateDirectoryEntry` | type | `{ path, create }` |
| `RuntimeContext` | type | `{ home, workspaceRoot, sourceRoot, tokens }` |
| `RuntimeOptions` | type | `{ home, sourceRoot, workspaceRoot?, extraTokens? }` |
| `Plan` | type | `{ runtime, operations }` |
| `PlanOperation` | type | One resolved unit of work. `chained: true` marks a link whose source is another managed destination, which is what defers it to the end |
| `OperationKind` | type | `"link" \| "copy" \| "managed-block" \| "private-directory"` |
| `FileSystemPort` | type | The injected filesystem interface |
| `FileStats` | type | `{ isFile, isDirectory, isSymbolicLink, mode }` |
| `ApplyOptions` | type | `{ backupRoot }` |
| `ApplyResult` | type | `{ changed, unchanged, backupRoot }` |
| `Finding` | type | `{ rule, severity, message }` |
| `Severity` | type | `"high" \| "medium" \| "low"` |

## Injecting a different filesystem

`FileSystemPort` is a small synchronous interface, so a caller can supply an
audit wrapper, a sandboxed root, or an in-memory implementation. This package's
own test suite runs entirely against an in-memory port — the alternative,
exercising an installer against a real home directory, is a test that can damage
the machine running it.

## Requirements

Node.js >= 20. No runtime dependencies.

## Licence

MIT
