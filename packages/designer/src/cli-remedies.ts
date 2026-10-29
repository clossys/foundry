/** Fixed next steps never interpolate rejected arguments, documents, or exception payloads. */
const remedies: Readonly<Record<string, string>> = {
  "designer-library": "Check the library root and input files. For a conflict, reload the current library and prepare changes against its current baseHash. For a failed check, resolve the reported findings before applying or emitting.",
  "designer-token-check": "Choose an existing source directory containing supported styling files, supply a valid token registry if needed, and replace reported literals with bound tokens. Resolve unchecked constructs before rerunning.",
  "designer-brand-check": "Supply readable brand CSS with a :root block, bind the required token keys, and resolve unparsed declarations before rerunning.",
  "designer-contrast-check": "Supply readable brand CSS and resolvable foreground/background token pairs. Fix reported contrast failures and unchecked pairs before rerunning.",
  "designer-environment-check": "Check the selected mode and input paths. Supply supported route sources and resolve reported findings or indeterminate inputs before rerunning.",
  "designer-hero-css-check": "Supply a readable hero CSS contract and resolve the reported CSS findings before rerunning.",
  "designer-fold-check": "Supply a valid fold contract and the required measurements, then resolve the reported fold findings before rerunning.",
  "designer-type-check": "Supply a valid type record and readable overlay CSS when requested, then resolve the reported type findings before rerunning.",
  "designer-rate-check": "Supply a readable assessment JSON file with independent observations. Resolve violated or indeterminate evidence before reassessing.",
};
export function cliRemedy(command: string): string {
  return `Remedy: ${remedies[command] ?? "Check the input files and resolve the reported findings before rerunning."} Run ${command} --help for accepted inputs.`;
}
/** JSON parser diagnostics can include rejected document bytes. Keep those bytes out of CLI errors. */
export function cliErrorDetail(error: unknown): string {
  if (error instanceof SyntaxError) return "invalid JSON; check the document syntax";
  return error instanceof Error ? error.message : "unavailable input";
}
