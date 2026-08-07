import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// `globals: false` in vitest.config.ts (deliberate — matches
// @vespeneventures/ui's own reasoning) means @testing-library/react's own
// auto-cleanup never registers itself, since it only does that when it
// finds a GLOBAL `afterEach`. Without this, every rendered tree leaks into
// the next test in the same file.
afterEach(cleanup);
