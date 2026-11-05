/** Public diagnostics are closed strings; exception messages, stacks and payloads stay private. */
export type CliDiagnosticCategory = "invalid-input" | "invalid-json" | "conflict";
const details = {
  "invalid-input": "invalid input or unavailable operation; check accepted inputs",
  "invalid-json": "invalid JSON; check the document syntax",
  conflict: "library conflict; reload the current library and prepare changes against its current baseHash",
} as const;
const fileErrors: Readonly<Record<string, string>> = {
  ENOENT: "input not found; check the input paths",
  EACCES: "permission denied; check input access permissions",
  EPERM: "operation not permitted; check input access permissions",
  EISDIR: "expected a regular input file",
  ENOTDIR: "expected an input directory",
  ELOOP: "input path contains an unsupported symbolic link",
};
export function cliErrorDetail(error: unknown, category?: CliDiagnosticCategory): string {
  if (category) return details[category];
  try {
    if (error instanceof SyntaxError) return details["invalid-json"];
    if (error && typeof error === "object") {
      // Read only an own data property; do not invoke a thrown object's code getter.
      const code = Object.getOwnPropertyDescriptor(error, "code")?.value as unknown;
      if (typeof code === "string" && Object.hasOwn(fileErrors, code)) return fileErrors[code]!;
    }
  } catch { /* An opaque thrown object may refuse even property inspection. */ }
  return "unexpected error; the operation could not complete";
}
const remedies = {
  "designer-library": "Check the library root and input files. For a conflict, reload the library and prepare changes against its current baseHash. Resolve failed findings before applying or emitting.",
  "designer-token-check": "Choose an existing source directory, supply a valid JSON token registry when requested, and resolve reported findings and unchecked constructs.",
} as const;
export function cliRemedy(command: keyof typeof remedies): string {
  return `Remedy: ${remedies[command]} Run ${command} --help for accepted inputs.`;
}
