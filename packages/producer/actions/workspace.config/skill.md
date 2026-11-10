# workspace.config

Decide the workspace config: which folder is the consumer workspace and the settings the CLI reads.

- The file marks the workspace root; keep it the only config the CLI discovers.
- Add a key only when a step reads it; an unread key is noise.
- The file is `clossys/clossys.config.ts`; `clossys check` must pass.
