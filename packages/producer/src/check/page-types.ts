export type PageCheckExitCode = 0 | 1 | 2;

export interface PageTarget {
  url: string;
  cellIds: string[];
}

export interface PageManifest {
  schemaVersion: 1;
  sourceHead: string;
  pages: PageTarget[];
}

export interface PageFinding {
  rule: string;
  url: string;
  message: string;
  evidence?: string;
}

/** Visible content and actual browser observations, never retained PASS flags. */
export interface PageSnapshot {
  url: string;
  inspected: boolean;
  text: string;
  headings: string[];
  images: { src: string; complete: boolean; naturalWidth: number }[];
  missingAssets: string[];
  responses: { url: string; status: number }[];
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: { url: string; error: string }[];
}

export interface PageResult {
  url: string;
  inspected: boolean;
  findings: PageFinding[];
}

export interface PageLintReport {
  schemaVersion: 1;
  gate: "PROC-5";
  sourceHead: string;
  sourceDirty: boolean;
  startedAt: string;
  finishedAt: string;
  status: "PASS" | "FAIL" | "ERROR";
  exitCode: PageCheckExitCode;
  pages: PageResult[];
  findings: PageFinding[];
}

export interface PageLintOptions {
  sourceHead: string;
  sourceDirty: boolean;
  timeoutMs?: number;
  executablePath?: string;
}
