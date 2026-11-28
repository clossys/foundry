// The vitest reporter `clossys check --fast` runs its test files with (src/check/fast-run.ts). It appends one JSON line
// per finished test file to the file named by CLOSSYS_FAST_RESULTS as soon as that file ends, so a run the time budget
// stops still leaves the results of every file that finished, and the files with no line are the ones left unrun.
// Plain JavaScript beside the TypeScript sources so the same path loads from src and from an installed package.
import { appendFileSync } from "node:fs";

const MESSAGES = 3;

const firstLine = (error) => String(error?.message ?? error ?? "").split("\n")[0].slice(0, 400);

export default class FastReporter {
  constructor() {
    this.out = process.env.CLOSSYS_FAST_RESULTS;
  }

  onTestModuleEnd(module) {
    if (!this.out) return;
    const state = module.state();
    const diagnostic = module.diagnostic();
    const messages = [];
    for (const error of module.errors()) if (messages.length < MESSAGES) messages.push(firstLine(error));
    for (const test of module.children.allTests("failed")) {
      if (messages.length >= MESSAGES) break;
      const error = test.result().errors?.[0];
      messages.push(`${test.fullName}: ${firstLine(error)}`);
    }
    const ms = Math.round(diagnostic.setupDuration + diagnostic.collectDuration + diagnostic.duration);
    appendFileSync(this.out, `${JSON.stringify({ file: module.moduleId, state, ms, messages })}\n`);
  }
}
