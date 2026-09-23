import { describe, expect, it } from "vitest";
import { controllerHeartbeatSchedule, validateHeartbeatSchedule } from "./schedule.js";
import type { ScheduleRegistry } from "../conventions/types.js";

const REGISTRY: ScheduleRegistry = { repositories: ["foundry"], hosts: ["github-actions"] };

describe("controllerHeartbeatSchedule", () => {
  it("builds a declaration that validates cleanly against a registry that governs its scope", () => {
    const declaration = controllerHeartbeatSchedule(["foundry"]);
    expect(declaration.id).toBe("controller-heartbeat");
    expect(declaration.executionHost).toBe("github-actions");
    expect(declaration.artifact).toBe("scripts/run-heartbeat.mjs");
    expect(validateHeartbeatSchedule(declaration, REGISTRY)).toEqual([]);
  });

  it("is zero-token and business-days-only per #1259's sub-hourly-cron rule", () => {
    const declaration = controllerHeartbeatSchedule(["foundry"]);
    expect(declaration.cadence).toBe("0 13 * * 1-5");
    expect(declaration.purpose).toContain("Zero-token");
    expect(declaration.purpose.toLowerCase()).toContain("not sub-hourly");
  });

  it("validateHeartbeatSchedule surfaces a scope the registry does not govern", () => {
    const declaration = controllerHeartbeatSchedule(["an-unlisted-repository"]);
    const findings = validateHeartbeatSchedule(declaration, REGISTRY);
    expect(findings.some((finding) => finding.rule === "schedule/scope-outside-plane")).toBe(true);
  });
});
