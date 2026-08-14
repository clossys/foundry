export PATH="$HOME/.local/bin:$PATH"

# Secrets remain in their owning product or process injector. Empty registry
# placeholders let package-manager configuration resolve without storing a
# credential in a repository or in this shell file.
export NODE_AUTH_TOKEN="${NODE_AUTH_TOKEN:-}"
export NPM_TOKEN="${NPM_TOKEN:-}"

# A machine-level resource default, not a project requirement. Override it per
# project where a project genuinely needs more.
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=1024}"
ulimit -n 8192

# Agent tasks establish repository scope on their own. Shell integration here is
# navigation only, and must never be required for an agent to load project
# context -- an agent launched outside this shell has to behave identically.
export CODE_WORKSPACE_ROOT="${CODE_WORKSPACE_ROOT:-${WORKSPACE_ROOT}}"
_agent_workspace_shell="$CODE_WORKSPACE_ROOT/scripts/workspace-shell.zsh"
if [[ -r "$_agent_workspace_shell" ]]; then
  source "$_agent_workspace_shell"
fi
unset _agent_workspace_shell
