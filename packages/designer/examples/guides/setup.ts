import { assertTokenStylesLoaded } from "@clossys/designer/tokens";

// Call once, near your app's root — never as a side effect of importing
// the package, and never something that renders into the page.
assertTokenStylesLoaded();
