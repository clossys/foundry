import { expect, it } from "vitest";
import { ADMIN_COMMON_COPY_EN, getAdminCopyRecord, resolveAdminCopyRef } from "@clossys/writer/admin-copy";
import { readRouteStudioLabel } from "./route-labels.js";
import { StudioCopyNeedsError, type StudioCopyRef } from "./copy-binding.js";

it("resolves the System stop directly from shipped common copy without approving its draft", () => {
  const record = getAdminCopyRecord("st.0mvj7s905h");
  expect(ADMIN_COMMON_COPY_EN.records).toContain(record);
  expect(record).toMatchObject({
    id: "st.0mvj7s905h", text: "System", leaf: "strings.common",
    origin: "foundry-default", status: "draft",
  });
  const calls: StudioCopyRef[] = [];
  const resolutions: ReturnType<typeof resolveAdminCopyRef>[] = [];
  const text = readRouteStudioLabel({
    locale: "en",
    resolver(ref) {
      calls.push(ref);
      const result = resolveAdminCopyRef(ref);
      resolutions.push(result);
      return result;
    },
  }, "system.stops.system");

  expect(text).toBe("System");
  expect(calls).toEqual([{ id: "st.0mvj7s905h", locale: "en" }]);
  expect(resolutions).toEqual([{
    ref: { id: "st.0mvj7s905h", locale: "en" }, text: "System",
    servedLocale: "en", status: "draft", activation: "none",
  }]);
  expect(getAdminCopyRecord("st.0mvj7s905h")).toBe(record);
  expect(record?.status).toBe("draft");
});

it("leaves legacy IDs and unavailable common copy unresolved", () => {
  expect(getAdminCopyRecord("st.nbe4p50nrx")).toBeUndefined();
  expect(resolveAdminCopyRef({ id: "st.nbe4p50nrx", locale: "en" })).toBeUndefined();
  expect(() => readRouteStudioLabel({ locale: "en", resolver: () => undefined }, "system.stops.system"))
    .toThrow(StudioCopyNeedsError);
});
