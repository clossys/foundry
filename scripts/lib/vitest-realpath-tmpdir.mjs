// Vitest setup file: root every test temp dir at the real path of the OS temp dir.
// On macOS TMPDIR (/var/folders/...) sits under the /var symlink into /private/var.
// Producer and Designer refuse to write through a symlinked ancestor by design, so
// the tests resolve their temp root instead of relaxing that refusal.
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";

process.env.TMPDIR = realpathSync(tmpdir());
