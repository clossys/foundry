/** The `clossys check --fast` lines of `clossys check --help` (cli/args.ts USAGE) and of its own usage errors. */
export const FAST_USAGE = "Fast: clossys check --fast [--base <ref>] [--json] [--file-requests [--root <workspace>]] (Reviewer's quick gate over\n"
  + "  git diff <base>...HEAD, stopping on the first red: 1. typecheck each touched workspace package; 2. related: the test files\n"
  + "  that reach a changed file in each touched package (vitest, direct importers first, sharded across cores by vitest's\n"
  + "  pool), and for changed files outside any package their node tests and the root check scripts that read them, in a\n"
  + "  5 min budget; 3. alone: each failing test file again by itself, once; one that also fails alone at the merge-base\n"
  + "  (a temporary detached tree, no stored baseline) is base-red and does not fail the run. --base defaults to the\n"
  + "  merge-base with the branch's upstream and refuses when there is none. Prints one line per step and FAST PASS|FAIL\n"
  + "  <sha>; past the budget FAST INCOMPLETE <sha> with the files left unrun; a run that executes nothing is FAST FAIL.\n"
  + "  Any test file over 2s run alone is listed under slow: (it never fails the run); --file-requests files one clossys\n"
  + "  request (--kind report --about agent/<owner> --what gap) per slow test, owner from the test's package, into the\n"
  + "  workspace at --root (default: the one around the repository). --json prints the same record. Exit 0 PASS, 1 FAIL or\n"
  + "  INCOMPLETE, 2 usage)";
