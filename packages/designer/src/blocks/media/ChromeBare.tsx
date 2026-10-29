import type { ReactNode } from "react";
import { SemanticContent } from "../../components/SemanticContent.js";

/** An unadorned media region with no imposed crop or height. */
export function ChromeBare({ children }: { children: ReactNode }) {
  return <SemanticContent as="div" data-screenshot-chrome="bare" className="min-w-0 w-full">{children}</SemanticContent>;
}
