# Foundry Launcher

Foundry Launcher (`@clossys/launcher`) is executable tooling
that makes one GitHub repository the account workspace hub. It is not a role
and does not claim adoption, grounding, or closure.

The hub inventories where Foundry packages are installed and coordinates
engagement. It is not a product application and does not receive a dump of
the catalogue.

## Install

The get-started command is the package name:

```bash
npx @clossys/launcher
```

Public npm reads are credentialless. Packages publish to
`https://registry.npmjs.org`. Do not add a token or private registry
mapping for `@clossys`. Pin an exact version once you depend on the library
API:

```bash
npm install --save-dev --save-exact @clossys/launcher@0.1.1
```

## How to run it

There is no `--org` flag. Owner is inferred from authenticated `gh` and from
the current git remote. If more than one GitHub owner is visible, the
command asks which one should hold the hub. Non-interactive runs may set
`CLOSSYS_OWNER`.

GitHub-only. A GitLab, self-hosted, or other remote is a refusal, not a
silent fallback.

| Current directory | What happens |
| --- | --- |
| Empty | Creates `{owner}/workspace` from the in-package skeleton, or clones that hub if it already exists. |
| Already a hub (generated marker; packed template `skeleton/.clossys/workspace.json`) | Resumes. No new repository. |
| Any other GitHub repository you control | Appoints it as the account hub. Keeps the existing name and files. Writes the hub marker. Leaves an existing `@clossys/advisor` pin in whichever bucket it already occupies; pins live Advisor in `devDependencies` only when missing. Refuses if the generated hub inventory is missing or empty (packed template `skeleton/.clossys/inventory.json`; that generated path does not ship) unless `--inventory <path>` supplies a populated document. Does not rewrite the lockfile or dump the catalogue. Prints a read-only health report. |

It does not have to be a brand-new exclusive repository, and it does not
have to already match a Foundry layout. Informal "workspace-looking" trees
are appointed by writing the hub contract, not assumed to be hubs already.
Product applications may be appointed: they become the hub **and** remain
the product. Sister repositories still pin their own roles. Appoint does
not install packages.

Do not run this inside the Foundry supplier tree.

Open the resulting folder in your coding agent. Advisor stays read-only
until you approve a next action. The same command resumes later.

## CLI

```bash
launcher
launcher --inventory path/to/inventory.json
launcher --help
launcher-check --help
launcher-check --input observation.json
```

Exit codes preserve the ternary:

| Exit | State | Meaning |
| --- | --- | --- |
| `0` | `satisfied` | Created, resumed, or appointed the hub. The message includes a read-only health report. |
| `1` | `violated` | Known refusal: not GitHub, not empty, missing appoint inventory, or the supplier tree. |
| `2` | `indeterminate` | Missing `gh`, unreadable registry pin, or an owner that could not be inferred. |

`launcher-check` grades a captured observation JSON through `planWorkspace` and does not create a hub. Same ternary: 0 is a create/resume/adopt plan, 1 is a known refusal, 2 could not run or could not decide. Appoint grades as a plan only when the observation already records a populated inventory; `--inventory` is a live CLI flag, not a check-cli input.

## API

| Export | Description |
| --- | --- |
| `planWorkspace()` | Decides create, resume, or adopt from a cwd observation. Optional `{ inventoryPath }` is the only way to appoint without a populated on-disk inventory. |
| `applyWorkspacePlan()` | Copies the in-package skeleton or hub marker through a host port and returns a `WorkspaceApplyResult` with health. Resume does not write. |
| `observeWorkspace()` | Reads `gh`, git remotes, cwd, inventory classification, and the public Advisor version. |
| `parseGitHubRemote()` | Parses a github.com remote and rejects any other host. |
| `isHubDocument()` | Type guard for the generated hub marker (packed template: `skeleton/.clossys/workspace.json`). |
| `inspectInventory()` | Classifies inventory JSON as missing, empty, or populated. |
| `reportHubHealth()` | Read-only pin and inventory report. Does not install or uninstall. |
| `formatHubHealth()` | Human lines plus a `health:` JSON line for the same report. |
| `DEFAULT_REPOSITORY_NAME` | Default new-hub repository name (`workspace`). Used only when creating, never when appointing. |
| `WORKSPACE_MARKER_REL` | Relative path of the hub marker. |
| `WORKSPACE_INVENTORY_REL` | Relative path of the hub inventory. |
| `CommandResult` / `CwdObservation` / `HubDocument` / `HubHealthReport` / `InventoryObservation` / `WorkspaceApplyResult` / `WorkspaceDecision` / `WorkspaceHost` / `WorkspaceObservation` / `WorkspacePlan` / `WorkspaceRefusal` / `WorkspaceState` | Typed host, observation, plan, health, and outcome contracts. |

## Why this is not Advisor, Starter, Builder, installer, creator, or a connector

Advisor is the engagement engine: it grades evidence and names a next
action. It has no GitHub I/O, and must not grow any. A remote chat
connector is a separately deployed product surface for that engine, not a
repo scaffolder.

Starter (`@clossys/starter`) is the protected-base **activation** gate.
Its only v1 subcommand is `decide`. It joins a pull-request snapshot to
fixed install evidence, Advisor readiness, and one target CLI. It refuses
commands, shell, and caller-selected paths. That is why get-started is not
`npx @clossys/starter`: a no-argument Starter invocation that created a
GitHub repository would be a contract break, and stuffing `gh repo create`
into `foundry-starter decide` would be the same defect. Starter starts the
trusted-base **loop in CI**, after a hub and a workflow already exist. It
does not start the human.

Builder realizes declared live state later in operating control. A new
hub has no declared topology yet.

This package is not named installer: an install is not adoption, Starter
already owns install-evidence joins, and the hub must not dump the
catalogue. It is not named creator: that reads as a role. Launcher is the
get-started bin that puts a hub on disk so a coding agent can open it.

This package exists because `npx` runs a **package name**. Step 0 is a
bin and a skeleton, not a role. It stays executable tooling so Starter's
`decide` contract, Advisor's engine boundary, and Builder's loop stay
intact.

## Requirements

Node.js 20+, ESM, GitHub `gh`, and no runtime dependencies. Creating a new
hub needs permission to create a private repository under the inferred
owner. Appointing uses the current checkout and does not create a second
repository.

## Licence

MIT.
