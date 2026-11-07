import { Button } from "../../components/preview-runtime/components/button/button.js";
import { Switch } from "../../components/Switch.js";
import { TextField } from "../../components/TextField.js";
import type { SettingsSectionProps } from "../SettingsSection.js";

export const settingsSectionSample: SettingsSectionProps = {
  heading: "Workspace settings",
  description: "Changes apply to everyone in the workspace.",
  groups: [
    { id: "general", legend: "General", children: <><TextField label="Workspace name" defaultValue="Northwind" /><TextField label="Support email" defaultValue="help@example.com" /></> },
    { id: "notifications", legend: "Notifications", children: <><Switch defaultSelected>Weekly summary</Switch><Switch>Product updates</Switch></> },
  ],
  dirty: ["general"],
  saveBar: <><Button variant="secondary">Discard</Button><Button>Save</Button></>,
  labels: { unsaved: "Unsaved changes", saveBar: "Save changes" },
};
