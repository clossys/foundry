/** Type-level proof that removed, undeclared Button treatments cannot be requested. */
import type { ButtonProps } from "../Button.js";

// @ts-expect-error tonal is not a components.button contract treatment
const tonal: ButtonProps = { variant: "tonal" };
// @ts-expect-error quiet is not a components.button contract treatment
const quiet: ButtonProps = { variant: "quiet" };
void [tonal, quiet];
