/**
 * A full command line as an owner option or interview call writes it (`["clossys", "<verb>", ...]`) is not the argv a
 * verb runs: its first word names the program. `verbArgv` is the one place that reads that word off, so no parser
 * takes the program name for a verb.
 */
export function verbArgv(command: readonly string[]): readonly string[] | undefined {
  const [program, ...argv] = command;
  return program === "clossys" ? argv : undefined;
}
