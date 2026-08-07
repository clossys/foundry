import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// `globals: false` in vitest.config.ts (deliberate — see that file) means
// @testing-library/react's own auto-cleanup, which only registers itself
// when it finds a GLOBAL `afterEach`, never fires on its own. Without this,
// every rendered tree leaks into the next test in the same file, which is
// exactly what multi-render tests (Button's variant sweep, Badge's variant
// sweep) and any two tests querying the same accessible name both do.
afterEach(cleanup);
