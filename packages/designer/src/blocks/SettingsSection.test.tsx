import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import * as blocks from "./index.js";
import type { SettingsSectionProps } from "./SettingsSection.js";
import { settingsSectionSample } from "./settings-section/sample.js";

const SettingsSection = (blocks as Record<string, unknown>).SettingsSection as (props: SettingsSectionProps) => JSX.Element;

describe("SettingsSection", () => {
  it("is a public blocks export: a named section with one fieldset per settings group", () => {
    render(<SettingsSection {...settingsSectionSample} />);
    const section = screen.getByRole("region", { name: "Workspace settings" });
    expect(section.tagName).toBe("SECTION");
    const groups = within(section).getAllByRole("group");
    expect(groups.map(group => group.tagName)).toEqual(["FIELDSET", "FIELDSET"]);
    expect(groups[0]).toHaveAccessibleName(/General/);
    expect(within(groups[0]!).getByRole("textbox", { name: "Workspace name" })).toBeInTheDocument();
  });

  it("marks only dirty groups with the unsaved label, as text a screen reader reads with the legend", () => {
    render(<SettingsSection {...settingsSectionSample} />);
    const [general, notifications] = screen.getAllByRole("group");
    expect(general).toHaveAccessibleName("General Unsaved changes");
    expect(notifications).toHaveAccessibleName("Notifications");
  });

  it("renders the save bar as a labelled region only when supplied and something is dirty", () => {
    const { rerender } = render(<SettingsSection {...settingsSectionSample} />);
    expect(screen.getByRole("region", { name: "Save changes" })).toContainElement(screen.getByRole("button", { name: "Save" }));
    rerender(<SettingsSection {...settingsSectionSample} dirty={[]} />);
    expect(screen.queryByRole("region", { name: "Save changes" })).toBeNull();
    rerender(<SettingsSection {...settingsSectionSample} saveBar={undefined} />);
    expect(screen.queryByRole("region", { name: "Save changes" })).toBeNull();
  });

  it("refuses a dirty id that names no group", () => {
    expect(() => render(<SettingsSection {...settingsSectionSample} dirty={["missing"]} />)).toThrow(/SettingsSection: unknown dirty group missing/);
  });
});
