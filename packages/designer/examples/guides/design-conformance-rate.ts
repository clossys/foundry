const input: unknown = { asOf: "2026-01-01T00:00:00Z", declaredSurfaces: [], observations: [] };

import { assessDesignConformanceRate } from "@clossys/designer/gate";

const report = assessDesignConformanceRate(input);
export { report };
