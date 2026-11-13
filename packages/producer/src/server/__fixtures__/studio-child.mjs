import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

// A test double for the Studio child. It must never outlive the test that started it:
// it records its pid where the test run's reaper looks (studio-child-reaper.ts), and it exits on
// its own once the process that spawned it is gone (a killed worker or Producer leaves it orphaned).
const pids = process.env.CLOSSYS_STUDIO_CHILD_PIDS;
const record = pids ? join(pids, String(process.pid)) : undefined;
if (record) { mkdirSync(pids, { recursive: true }); writeFileSync(record, `${process.ppid}\n`); }
const done = code => { if (record) rmSync(record, { force: true }); process.exit(code); };

const server = createServer((request, response) => {
  if (request.url === "/fixture-exit") {
    response.end("{}"); server.close(() => done(1)); return;
  }
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify({
    studio: true, path: request.url, method: request.method,
    headers: request.headers, origin: process.env.CLOSSYS_PRODUCER_ORIGIN,
  }));
});
server.listen(Number(process.env.PORT), process.env.HOSTNAME);
process.once("SIGTERM", () => server.close(() => done(0)));

const parent = process.ppid;
const orphaned = () => { try { process.kill(parent, 0); return process.ppid !== parent; } catch { return true; } };
setInterval(() => { if (orphaned()) done(0); }, 200).unref();
