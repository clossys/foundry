/**
 * Preloaded into a traced child process (`NODE_OPTIONS=--import <this file>`): observes the
 * process's file reads and writes and, on exit, appends them as one line to the sink file the
 * tracing parent named in CLOSSYS_TRACE_SINK. The parent turns the lines into the run record
 * (trace.ts). Grandchildren inherit NODE_OPTIONS and the sink, so they are observed too.
 */
import { appendFileSync } from "node:fs";
import { observe, sinkLine, SINK_ENV } from "./trace.js";

const sink = process.env[SINK_ENV];
if (sink) {
  const watch = observe();
  process.once("exit", () => {
    const seen = watch.stop();
    try { appendFileSync(sink, sinkLine(seen)); } catch { /* the parent reports a missing observation as an empty run */ }
  });
}
