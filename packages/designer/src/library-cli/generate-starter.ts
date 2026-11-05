import { identityStarterChange } from "../catalog-assets/identity.js";
import { LibraryInputError } from "./fs-library.js";
import { applyAgentChange, readAgentLibrary, type AgentChangeInput } from "./reselect.js";

export async function generateStarter(input: AgentChangeInput) {
  const library = await readAgentLibrary(input);
  const values = "values" in library ? { ...library.values, source: library.source, adoptedAt: library.adoptedAt } : library;
  let operation: ReturnType<typeof identityStarterChange>;
  try { operation = identityStarterChange(input.catalog.values, values, input.leaf); }
  catch { throw new LibraryInputError(`generate-starter unavailable for ${input.leaf}`); }
  return applyAgentChange(input, library, operation, { command: "designer-library generate-starter", inputs: { leaf: input.leaf } });
}
