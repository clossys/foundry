# Machine baseline

The durable posture a development machine is expected to hold. Only the
portable, file-level subset of this is mechanically checkable; operating-system
controls that require an administrator, a physical device, or interactive
authentication remain platform-specific and manual.

That split is the point of this document rather than a shortcoming of it. A
baseline that claimed to verify full-disk encryption from a file check would be
asserting something it cannot see, which is worse than declaring the gap.

## Security and privacy

- Full-disk encryption and the platform's kernel/system integrity protection
  remain enabled, where the platform provides them.
- The host firewall remains enabled.
- Automatic operating-system security updates remain enabled.
- The workspace's `personal` subtree, each agent product's own dot-directory in
  the operator's home, `~/.ssh`, and the operator's secret directory are
  private to the user: `0700` directories, and sensitive files that are not
  world-readable.
- Secrets stay in their owning password or secret manager, or in a runtime auth
  store. They are never copied into a repository or into an agent instruction.

## Recovery

- Configure system backup to an operator-selected encrypted destination.
- Consumer file-synchronization services cover supported files only. They are
  not a backup destination and not a complete system backup; a full machine
  backup requires an external disk or a supported network destination.
- Installer changes create timestamped backups under `~/.config-backups/`.
  Those are local rollback points, not a backup strategy — they live on the
  same disk as the thing they would restore.
- Canonical source repositories and the private workspace control plane remain
  pushed to their owning accounts.

## Resource posture

- Keep enough free disk for dependency installs, builds, and worktrees; treat
  less than 20 GiB as an immediate cleanup threshold and 40 GiB as the target.
- Do not delete active worktrees, dependency trees used by running processes,
  or product-managed VM, session, or cache state during automated cleanup.
- Keep active local services intentional and documented by their owning
  repository.

## Review cadence

- Run the plane's machine-diagnostic workflow after changing user-level agent
  or shell settings.
- Run the plane's workspace-reconciliation report, and read it, before removing
  worktrees or branches.
- Review this baseline after a major operating-system, agent-product,
  version-control, or forge change.
