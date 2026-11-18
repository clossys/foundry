/**
 * The `advisor` command's verbs and the flags each takes: the one table the CLI parses with and the L0-L3 round
 * checks the tree and loops against. A verb added here without an L3 (or an L3 or loop step naming a verb not
 * here) turns the round red.
 */
export const VERB_FLAGS = {
  doctor: ["--root"],
  install: ["--root", "--from"],
  init: ["--root"],
  intake: ["--root", "--answers", "--observed"],
  update: ["--root", "--from"],
  relations: ["--root", "--set"],
  conform: ["--root"],
} as const satisfies Record<string, readonly string[]>;

export type Verb = keyof typeof VERB_FLAGS;
export const CLI_VERBS = Object.keys(VERB_FLAGS) as Verb[];
/** Verbs that act on the workspace; conform checks Advisor's own data and has no L3. */
export const FRONT_DOOR_VERBS: readonly Verb[] = CLI_VERBS.filter(verb => verb !== "conform");
/** The tree's own verb for loop slots: a loop runs front-door verbs and is not itself a command. */
export const LOOP_VERB = "loop";
